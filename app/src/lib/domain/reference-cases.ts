import { monthsInRange, monthOf, type IsoDate } from '../dates';
import type { AllocationKeyKind, Fuel, MeterKind } from '../server/db/schema';
import { defaultMeterUnit } from './operating-costs';
import { monthlyAmounts } from './rents';
import type {
	LedgerCharge,
	StatementCategory,
	StatementInput,
	StatementKey,
	StatementLease
} from './statement';

// The public reference cases (Rechenbeispiele) of the operating cost statement. Each case is a
// small house with one year of costs, and the result every tenant must get, recomputed apart from
// mietkartei with exact fractions from BetrKV, HeizKV and CO2KostAufG (see `check`). The spec runs
// computeStatement on each case and compares it with these figures to the cent; it also writes
// the case and the computed statement to website/rechenbeispiele/faelle.json, from which
// scripts/build_reference_cases.py builds the pages on mietkartei.de/rechenbeispiele/.

export type ReferenceCategory =
	'grundsteuer' | 'wasser' | 'abwasser' | 'muell' | 'hausmeister' | 'versicherung' | 'heizung';

export type ReferenceCase = {
	slug: string;
	title: string;
	/** One sentence for the overview. */
	summary: string;
	/** What the case shows, a few sentences for the start of its page. */
	intro: string;
	/** The statement period. */
	year: number;
	property: { name: string; street: string; postalCode: string; city: string };
	units: { id: string; name: string; area: number }[];
	leases: {
		id: string;
		unitId: string;
		tenant: { salutation: string; firstName: string; lastName: string };
		start: IsoDate;
		end: IsoDate | null;
		persons: number;
		/** Cents per month; a partial month is prorated by its days, like the rent account. */
		baseRent: number;
		operatingCostPrepayment: number;
		heatingCostPrepayment: number;
	}[];
	items: {
		id: string;
		description: string;
		/** A word or two for the step navigation on the page. */
		label: string;
		category: ReferenceCategory;
		key: AllocationKeyKind;
		/** For a `mixed` key: the share by consumption. */
		consumptionPercent?: number;
		periodStart: IsoDate;
		periodEnd: IsoDate;
		amount: number;
		co2?: { fuel: Fuel; fuelKwh: number; co2Kg: number; co2Cost: number };
	}[];
	/** The units' meters of the kind the consumption keys read, read on the year's first and last day. */
	meters?: { unitId: string; kind: MeterKind; start: number; end: number }[];
	/** The independent result: each lease's share per item and its paid prepayments, in cents. */
	expected: {
		leases: Record<string, { shares: Record<string, number>; prepayments: number }>;
		landlordCo2Share: number;
		/** What the landlord bears for the days a unit stood empty. */
		vacancyShare: number;
	};
	/** How the expected figures were obtained, for the page. */
	check: string[];
	/** The rules the case rests on. */
	sources: { label: string; url: string }[];
};

const categories: Record<ReferenceCategory, StatementCategory> = {
	grundsteuer: {
		id: 'grundsteuer',
		name: 'Grundsteuer',
		betrkvItem: 1,
		allocable: true,
		consumptionBased: false
	},
	wasser: {
		id: 'wasser',
		name: 'Wasserversorgung',
		betrkvItem: 2,
		allocable: true,
		consumptionBased: false
	},
	abwasser: {
		id: 'abwasser',
		name: 'Entwässerung',
		betrkvItem: 3,
		allocable: true,
		consumptionBased: false
	},
	heizung: {
		id: 'heizung',
		name: 'Heizung',
		betrkvItem: 4,
		allocable: true,
		consumptionBased: true
	},
	muell: {
		id: 'muell',
		name: 'Müllbeseitigung',
		betrkvItem: 8,
		allocable: true,
		consumptionBased: false
	},
	versicherung: {
		id: 'versicherung',
		name: 'Sach- und Haftpflichtversicherung',
		betrkvItem: 13,
		allocable: true,
		consumptionBased: false
	},
	hausmeister: {
		id: 'hausmeister',
		name: 'Hauswart',
		betrkvItem: 14,
		allocable: true,
		consumptionBased: false
	}
};

/** The key of an item, named as the account of the demo has it. */
export function referenceKey(item: ReferenceCase['items'][number]): {
	name: string;
	meterKind: MeterKind | null;
} {
	if (item.key === 'mixed')
		return {
			name: `Heizung ${item.consumptionPercent}/${100 - item.consumptionPercent!}`,
			meterKind: 'heat'
		};
	if (item.key === 'consumption')
		return { name: 'Kaltwasser nach Verbrauch', meterKind: 'cold_water' };
	const names: Partial<Record<AllocationKeyKind, string>> = {
		area: 'Wohnfläche',
		persons: 'Personen',
		units: 'Einheiten'
	};
	return { name: names[item.key]!, meterKind: null };
}

/** The case as the input of computeStatement: every prepayment charged and paid on time. */
export function referenceInput(c: ReferenceCase): StatementInput {
	const period = { start: `${c.year}-01-01`, end: `${c.year}-12-31` };
	const keys = new Map<string, StatementKey>();
	for (const item of c.items) {
		const { name, meterKind } = referenceKey(item);
		keys.set(name, {
			id: name,
			name,
			kind: item.key,
			meterKind,
			consumptionPercent: item.consumptionPercent ?? null,
			shares: []
		});
	}
	const leases = c.leases.map((lease): StatementLease => {
		const rentHistory = [
			{
				validFrom: lease.start,
				baseRent: lease.baseRent,
				operatingCostPrepayment: lease.operatingCostPrepayment,
				heatingCostPrepayment: lease.heatingCostPrepayment,
				status: 'approved' as const
			}
		];
		const term = { startDate: lease.start, endDate: lease.end };
		const charges: LedgerCharge[] = monthsInRange(
			monthOf(lease.start > period.start ? lease.start : period.start),
			monthOf(lease.end && lease.end < period.end ? lease.end : period.end)
		).map((month) => {
			const amounts = monthlyAmounts(rentHistory, term, month);
			return {
				kind: 'rent',
				period: month,
				dueDate: `${month}-03`,
				amount: amounts.baseRent + amounts.operatingCostPrepayment + amounts.heatingCostPrepayment,
				operatingCostPrepayment: amounts.operatingCostPrepayment,
				heatingCostPrepayment: amounts.heatingCostPrepayment
			};
		});
		return {
			id: lease.id,
			kind: 'residential',
			startDate: lease.start,
			endDate: lease.end,
			operatingCostModel: 'prepayment',
			heatingCostModel: 'prepayment',
			ledgerStart: null,
			unitIds: [lease.unitId],
			tenants: [{ ...lease.tenant, street: null, postalCode: null, city: null }],
			persons: [{ validFrom: lease.start, persons: lease.persons }],
			rentHistory,
			charges,
			payments: charges.map((charge) => ({ date: `${charge.period}-03`, amount: charge.amount }))
		};
	});
	return {
		property: { id: c.slug, ...c.property, vacancyPersons: 1, buildingUse: 'residential' },
		period,
		units: c.units.map((unit) => ({
			id: unit.id,
			name: unit.name,
			kind: 'apartment',
			floorArea: unit.area
		})),
		leases,
		items: c.items.map((item) => ({
			id: item.id,
			description: item.description,
			supplier: null,
			categoryId: item.category,
			allocationKeyId: referenceKey(item).name,
			billingCircleId: null,
			periodStart: item.periodStart,
			periodEnd: item.periodEnd,
			amount: item.amount,
			allocable: true,
			fuel: item.co2?.fuel ?? null,
			fuelKwh: item.co2?.fuelKwh ?? null,
			co2Kg: item.co2?.co2Kg ?? null,
			co2Cost: item.co2?.co2Cost ?? null,
			unitAmounts: [],
			association: null
		})),
		categories: [...new Set(c.items.map((item) => item.category))].map((id) => categories[id]),
		keys: [...keys.values()],
		circles: [],
		meters: (c.meters ?? []).map((meter) => ({
			id: `${meter.kind}-${meter.unitId}`,
			unitId: meter.unitId,
			kind: meter.kind,
			unit: defaultMeterUnit(meter.kind),
			installedAt: null,
			removedAt: null,
			readings: [
				{ readAt: period.start, value: meter.start, estimated: false },
				{ readAt: period.end, value: meter.end, estimated: false }
			]
		})),
		landlord: {
			name: 'Eva Beispiel',
			street: null,
			postalCode: null,
			city: null,
			iban: null,
			bankName: null
		}
	};
}

const betrkv = {
	label: '§ 2 Betriebskostenverordnung',
	url: 'https://www.gesetze-im-internet.de/betrkv/__2.html'
};
const bgb556a = {
	label: '§ 556a BGB: Abrechnungsmaßstab',
	url: 'https://www.gesetze-im-internet.de/bgb/__556a.html'
};
const exactCheck =
	'Nachgerechnet ohne mietkartei: mit exakten Brüchen statt Kommazahlen, jeder Betrag erst am Ende auf den Cent gerundet. Wo Cents übrig bleiben, bekommt sie der größte Rest (Restbetragsverfahren), sodass die Anteile genau die Rechnung ergeben.';

export const referenceCases: ReferenceCase[] = [
	{
		slug: 'mieterwechsel',
		title: 'Mieterwechsel mitten im Monat',
		summary:
			'Im Obergeschoss zieht die Mieterin am 15. Juli aus, am 16. Juli zieht eine Familie ein. Wer zahlt welchen Teil?',
		intro:
			'Ein Haus mit drei Wohnungen in Leipzig, abgerechnet wird das Jahr 2025. Im Obergeschoss endet ein Mietvertrag am 15. Juli, der nächste beginnt am 16. Juli. Jeder Beleg wird erst auf die Wohnungen verteilt und dann tagesgenau auf die beiden Mietverträge. Die Gebäudeversicherung läuft von Juli bis Juni, von beiden Policen gehört also nur ein Teil in das Jahr 2025.',
		year: 2025,
		property: {
			name: 'Gartenstraße 12',
			street: 'Gartenstraße 12',
			postalCode: '04107',
			city: 'Leipzig'
		},
		units: [
			{ id: 'eg', name: 'Erdgeschoss', area: 80 },
			{ id: 'og', name: 'Obergeschoss', area: 60 },
			{ id: 'dg', name: 'Dachgeschoss', area: 60 }
		],
		leases: [
			{
				id: 'krueger',
				unitId: 'eg',
				tenant: { salutation: 'Herr', firstName: 'Jonas', lastName: 'Krüger' },
				start: '2021-04-01',
				end: null,
				persons: 2,
				baseRent: 720_00,
				operatingCostPrepayment: 100_00,
				heatingCostPrepayment: 0
			},
			{
				id: 'schulz',
				unitId: 'og',
				tenant: { salutation: 'Frau', firstName: 'Petra', lastName: 'Schulz' },
				start: '2018-09-01',
				end: '2025-07-15',
				persons: 1,
				baseRent: 540_00,
				operatingCostPrepayment: 70_00,
				heatingCostPrepayment: 0
			},
			{
				id: 'yilmaz',
				unitId: 'og',
				tenant: { salutation: 'Herr', firstName: 'Deniz', lastName: 'Yılmaz' },
				start: '2025-07-16',
				end: null,
				persons: 3,
				baseRent: 590_00,
				operatingCostPrepayment: 90_00,
				heatingCostPrepayment: 0
			},
			{
				id: 'weber',
				unitId: 'dg',
				tenant: { salutation: 'Frau', firstName: 'Lena', lastName: 'Weber' },
				start: '2023-02-01',
				end: null,
				persons: 2,
				baseRent: 560_00,
				operatingCostPrepayment: 80_00,
				heatingCostPrepayment: 0
			}
		],
		items: [
			{
				id: 'grundsteuer',
				description: 'Grundsteuer 2025',
				label: 'Grundsteuer',
				category: 'grundsteuer',
				key: 'area',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 720_00
			},
			{
				id: 'muell',
				description: 'Müllabfuhr 2025',
				label: 'Müllabfuhr',
				category: 'muell',
				key: 'persons',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 547_50
			},
			{
				id: 'hausmeister',
				description: 'Hausmeisterdienst 2025',
				label: 'Hausmeister',
				category: 'hausmeister',
				key: 'units',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 1_095_00
			},
			{
				id: 'versicherung-2024',
				description: 'Gebäudeversicherung 07/2024 bis 06/2025',
				label: 'Versicherung 2024/25',
				category: 'versicherung',
				key: 'area',
				periodStart: '2024-07-01',
				periodEnd: '2025-06-30',
				amount: 1_022_00
			},
			{
				id: 'versicherung-2025',
				description: 'Gebäudeversicherung 07/2025 bis 06/2026',
				label: 'Versicherung 2025/26',
				category: 'versicherung',
				key: 'area',
				periodStart: '2025-07-01',
				periodEnd: '2026-06-30',
				amount: 1_095_00
			}
		],
		expected: {
			leases: {
				krueger: {
					shares: {
						grundsteuer: 288_00,
						muell: 184_78,
						hausmeister: 365_00,
						'versicherung-2024': 202_72,
						'versicherung-2025': 220_80
					},
					prepayments: 1_200_00
				},
				schulz: {
					shares: {
						grundsteuer: 115_99,
						muell: 49_61,
						hausmeister: 196_00,
						'versicherung-2024': 152_04,
						'versicherung-2025': 13_50
					},
					prepayments: 453_87
				},
				yilmaz: {
					shares: {
						grundsteuer: 100_01,
						muell: 128_33,
						hausmeister: 169_00,
						'versicherung-2025': 152_10
					},
					prepayments: 496_45
				},
				weber: {
					shares: {
						grundsteuer: 216_00,
						muell: 184_78,
						hausmeister: 365_00,
						'versicherung-2024': 152_04,
						'versicherung-2025': 165_60
					},
					prepayments: 960_00
				}
			},
			landlordCo2Share: 0,
			vacancyShare: 0
		},
		check: [
			exactCheck,
			'Der Anteil des Obergeschosses wird nach Tagen geteilt: Frau Schulz wohnte 196 der 365 Tage dort, Familie Yılmaz 169. Beim Müll zählen Personentage: 196 für Frau Schulz, 3 × 169 = 507 für die Familie.',
			'Von der Versicherung 07/2024 bis 06/2025 (365 Tage) gehören 181 Tage in das Jahr 2025, von der Police ab Juli 184 Tage. Die zweite Police teilen sich im Obergeschoss nur die Tage ab Juli: 15 für Frau Schulz, 169 für die Familie.',
			'Die Vorauszahlungen im Juli sind nach Tagen anteilig: 70 € × 15/31 = 33,87 € und 90 € × 16/31 = 46,45 €.'
		],
		sources: [
			betrkv,
			bgb556a,
			{
				label: '§ 556 Abs. 3 BGB: Abrechnungszeitraum und Frist',
				url: 'https://www.gesetze-im-internet.de/bgb/__556.html'
			}
		]
	},
	{
		slug: 'heizkosten-co2',
		title: 'Heizkosten mit CO₂-Aufteilung',
		summary:
			'Gasheizung für vier Wohnungen: Erst trägt der Vermieter seinen Teil der CO₂-Kosten, dann wird der Rest zu 70 % nach Verbrauch und zu 30 % nach Fläche verteilt.',
		intro:
			'Ein Haus mit vier Wohnungen in Kassel, beheizt mit Gas, abgerechnet wird das Jahr 2025. Die Gasrechnung über 3.600 € enthält 442,20 € CO₂-Kosten. Wie viel davon der Vermieter trägt, hängt am Ausstoß des Gebäudes je Quadratmeter (CO2KostAufG). Was bleibt, wird nach der Heizkostenverordnung verteilt: 70 % nach den Wärmezählern der Wohnungen, 30 % nach Wohnfläche.',
		year: 2025,
		property: { name: 'Am Hang 3', street: 'Am Hang 3', postalCode: '34119', city: 'Kassel' },
		units: [
			{ id: 'w1', name: 'Wohnung 1', area: 70 },
			{ id: 'w2', name: 'Wohnung 2', area: 70 },
			{ id: 'w3', name: 'Wohnung 3', area: 55 },
			{ id: 'w4', name: 'Wohnung 4', area: 55 }
		],
		leases: [
			{
				id: 'hoffmann',
				unitId: 'w1',
				tenant: { salutation: 'Frau', firstName: 'Sabine', lastName: 'Hoffmann' },
				start: '2019-05-01',
				end: null,
				persons: 2,
				baseRent: 610_00,
				operatingCostPrepayment: 0,
				heatingCostPrepayment: 85_00
			},
			{
				id: 'nowak',
				unitId: 'w2',
				tenant: { salutation: 'Herr', firstName: 'Tomasz', lastName: 'Nowak' },
				start: '2022-01-01',
				end: null,
				persons: 1,
				baseRent: 620_00,
				operatingCostPrepayment: 0,
				heatingCostPrepayment: 75_00
			},
			{
				id: 'becker',
				unitId: 'w3',
				tenant: { salutation: 'Herr', firstName: 'Paul', lastName: 'Becker' },
				start: '2020-10-01',
				end: null,
				persons: 1,
				baseRent: 480_00,
				operatingCostPrepayment: 0,
				heatingCostPrepayment: 60_00
			},
			{
				id: 'schmitt',
				unitId: 'w4',
				tenant: { salutation: 'Frau', firstName: 'Maria', lastName: 'Schmitt' },
				start: '2024-03-01',
				end: null,
				persons: 2,
				baseRent: 495_00,
				operatingCostPrepayment: 0,
				heatingCostPrepayment: 65_00
			}
		],
		items: [
			{
				id: 'gas',
				description: 'Gas 2025, 40.000 kWh',
				label: 'Gas',
				category: 'heizung',
				key: 'mixed',
				consumptionPercent: 70,
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 3_600_00,
				co2: { fuel: 'gas', fuelKwh: 40_000, co2Kg: 8_040, co2Cost: 442_20 }
			}
		],
		meters: [
			{ unitId: 'w1', kind: 'heat', start: 41_200, end: 50_200 },
			{ unitId: 'w2', kind: 'heat', start: 37_500, end: 45_500 },
			{ unitId: 'w3', kind: 'heat', start: 28_100, end: 34_100 },
			{ unitId: 'w4', kind: 'heat', start: 12_900, end: 19_900 }
		],
		expected: {
			leases: {
				hoffmann: { shares: { gas: 993_40 }, prepayments: 1_020_00 },
				nowak: { shares: { gas: 914_56 }, prepayments: 900_00 },
				becker: { shares: { gas: 696_05 }, prepayments: 720_00 },
				schmitt: { shares: { gas: 774_89 }, prepayments: 780_00 }
			},
			landlordCo2Share: 221_10,
			vacancyShare: 0
		},
		check: [
			exactCheck,
			'CO₂: 40.000 kWh Erdgas × 0,201 kg/kWh = 8.040 kg, auf 250 m² Wohnfläche 32,16 kg je m² und Jahr. Das ist die Stufe ab 32 kg mit 50 % Vermieteranteil, also 442,20 € × 50 % = 221,10 €. Bei 55 € je Tonne (BEHG 2025) kosten 8,04 t genau 442,20 €.',
			'Verteilt werden 3.600,00 € − 221,10 € = 3.378,90 €: 70 % = 2.365,23 € nach 30.000 kWh der Wärmezähler, 30 % = 1.013,67 € nach 250 m².',
			'Wohnung 1 zum Beispiel: 2.365,23 € × 9.000/30.000 = 709,57 € plus 1.013,67 € × 70/250 = 283,83 €, zusammen 993,40 €.'
		],
		sources: [
			{
				label: '§§ 7, 8 Heizkostenverordnung: 50 bis 70 % nach Verbrauch',
				url: 'https://www.gesetze-im-internet.de/heizkostenv/__7.html'
			},
			{
				label: 'Anlage zum CO2KostAufG: Stufenmodell',
				url: 'https://www.gesetze-im-internet.de/co2kostaufg/anlage.html'
			},
			{
				label: '§ 10 Abs. 2 BEHG: CO₂-Preis 2025',
				url: 'https://www.gesetze-im-internet.de/behg/__10.html'
			}
		]
	},
	{
		slug: 'leerstand',
		title: 'Leerstand: Was trägt der Vermieter?',
		summary:
			'Eine Wohnung steht drei Monate leer, eine andere ab September. Die Kosten der leeren Tage trägt der Vermieter, nicht die übrigen Mieter.',
		intro:
			'Ein Haus mit drei Wohnungen in Bremen, abgerechnet wird das Jahr 2025. Das Dachgeschoss wird bis Ende März renoviert und ist erst ab April vermietet. Im Erdgeschoss zieht der Mieter Ende August aus, danach bleibt die Wohnung bis Jahresende leer. Jeder Beleg wird zuerst auf alle drei Wohnungen verteilt, als wären sie bewohnt. Den Anteil der leeren Tage trägt der Vermieter; die Mieter zahlen nie mehr, weil eine Wohnung leer steht.',
		year: 2025,
		property: {
			name: 'Lindenweg 5',
			street: 'Lindenweg 5',
			postalCode: '28203',
			city: 'Bremen'
		},
		units: [
			{ id: 'eg', name: 'Erdgeschoss', area: 75 },
			{ id: 'og', name: 'Obergeschoss', area: 75 },
			{ id: 'dg', name: 'Dachgeschoss', area: 50 }
		],
		leases: [
			{
				id: 'klein',
				unitId: 'eg',
				tenant: { salutation: 'Herr', firstName: 'Bernd', lastName: 'Klein' },
				start: '2016-06-01',
				end: '2025-08-31',
				persons: 2,
				baseRent: 650_00,
				operatingCostPrepayment: 95_00,
				heatingCostPrepayment: 0
			},
			{
				id: 'arslan',
				unitId: 'og',
				tenant: { salutation: 'Frau', firstName: 'Elif', lastName: 'Arslan' },
				start: '2020-03-01',
				end: null,
				persons: 3,
				baseRent: 690_00,
				operatingCostPrepayment: 95_00,
				heatingCostPrepayment: 0
			},
			{
				id: 'vogel',
				unitId: 'dg',
				tenant: { salutation: 'Herr', firstName: 'Lukas', lastName: 'Vogel' },
				start: '2025-04-01',
				end: null,
				persons: 1,
				baseRent: 480_00,
				operatingCostPrepayment: 60_00,
				heatingCostPrepayment: 0
			}
		],
		items: [
			{
				id: 'grundsteuer',
				description: 'Grundsteuer 2025',
				label: 'Grundsteuer',
				category: 'grundsteuer',
				key: 'area',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 640_00
			},
			{
				id: 'muell',
				description: 'Müllabfuhr 2025',
				label: 'Müllabfuhr',
				category: 'muell',
				key: 'persons',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 594_00
			},
			{
				id: 'hausmeister',
				description: 'Hausmeisterdienst 2025',
				label: 'Hausmeister',
				category: 'hausmeister',
				key: 'units',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 960_00
			},
			{
				id: 'versicherung',
				description: 'Gebäudeversicherung 2025',
				label: 'Versicherung',
				category: 'versicherung',
				key: 'area',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 880_00
			}
		],
		expected: {
			leases: {
				klein: {
					shares: { grundsteuer: 159_78, muell: 139_60, hausmeister: 213_04, versicherung: 219_70 },
					prepayments: 760_00
				},
				arslan: {
					shares: { grundsteuer: 240_00, muell: 314_52, hausmeister: 320_00, versicherung: 330_00 },
					prepayments: 1_140_00
				},
				vogel: {
					shares: { grundsteuer: 120_55, muell: 78_99, hausmeister: 241_10, versicherung: 165_75 },
					prepayments: 540_00
				}
			},
			landlordCo2Share: 0,
			vacancyShare: 530_97
		},
		check: [
			exactCheck,
			'Zuerst bekommt jede Wohnung ihren Anteil, ob bewohnt oder nicht: nach Fläche das Erdgeschoss zum Beispiel 75 von 200 m². Erst dann wird der Anteil einer Wohnung nach Tagen geteilt. Herr Klein wohnte 243 Tage im Erdgeschoss, 122 Tage stand es leer; Herr Vogel wohnte 275 Tage im Dachgeschoss, 90 Tage stand es leer.',
			'Beim Müll zählt eine leere Wohnung wie eine Person (die Einstellung „Personen bei Leerstand“). So kommen auf das Erdgeschoss 2 × 243 + 1 × 122 = 608 Personentage und auf das Dachgeschoss 1 × 275 + 1 × 90 = 365. Würde der Leerstand mit 0 Personen zählen, trügen Frau Arslan und die anderen Mieter die Müllkosten der leeren Wohnungen mit.',
			'Der Vermieter trägt die Anteile der leeren Tage: im Erdgeschoss 80,22 € Grundsteuer, 35,04 € Müll, 106,96 € Hausmeister und 110,30 € Versicherung, zusammen 332,52 €; im Dachgeschoss 39,45 €, 25,85 €, 78,90 € und 54,25 €, zusammen 198,45 €. Das sind 530,97 €.'
		],
		sources: [betrkv, bgb556a]
	},
	{
		slug: 'wasser-nach-verbrauch',
		title: 'Wasser und Abwasser nach Zählern',
		summary:
			'Vier Wohnungen mit eigenen Wasserzählern: Frisch- und Schmutzwasser nach Kubikmetern, das Regenwasser nach Fläche.',
		intro:
			'Ein Haus mit vier Wohnungen in Freiburg, abgerechnet wird das Jahr 2025. Jede Wohnung hat einen Kaltwasserzähler, abgelesen am 1. Januar und am 31. Dezember. Wo der Verbrauch erfasst wird, muss nach Verbrauch abgerechnet werden (§ 556a Abs. 1 BGB): Frischwasser und Schmutzwasser folgen den Kubikmetern der Zähler. Die Gebühr für das Niederschlagswasser hängt an der versiegelten Fläche des Grundstücks, nicht am Verbrauch, und wird nach Wohnfläche verteilt.',
		year: 2025,
		property: {
			name: 'Mühlweg 8',
			street: 'Mühlweg 8',
			postalCode: '79098',
			city: 'Freiburg im Breisgau'
		},
		units: [
			{ id: 'w1', name: 'Wohnung 1', area: 85 },
			{ id: 'w2', name: 'Wohnung 2', area: 65 },
			{ id: 'w3', name: 'Wohnung 3', area: 65 },
			{ id: 'w4', name: 'Wohnung 4', area: 45 }
		],
		leases: [
			{
				id: 'brandt',
				unitId: 'w1',
				tenant: { salutation: 'Frau', firstName: 'Katrin', lastName: 'Brandt' },
				start: '2017-08-01',
				end: null,
				persons: 4,
				baseRent: 890_00,
				operatingCostPrepayment: 85_00,
				heatingCostPrepayment: 0
			},
			{
				id: 'lang',
				unitId: 'w2',
				tenant: { salutation: 'Herr', firstName: 'Florian', lastName: 'Lang' },
				start: '2021-11-01',
				end: null,
				persons: 2,
				baseRent: 720_00,
				operatingCostPrepayment: 55_00,
				heatingCostPrepayment: 0
			},
			{
				id: 'costa',
				unitId: 'w3',
				tenant: { salutation: 'Frau', firstName: 'Ana', lastName: 'Costa' },
				start: '2023-05-01',
				end: null,
				persons: 1,
				baseRent: 700_00,
				operatingCostPrepayment: 25_00,
				heatingCostPrepayment: 0
			},
			{
				id: 'wolf',
				unitId: 'w4',
				tenant: { salutation: 'Herr', firstName: 'Simon', lastName: 'Wolf' },
				start: '2019-02-01',
				end: null,
				persons: 2,
				baseRent: 520_00,
				operatingCostPrepayment: 45_00,
				heatingCostPrepayment: 0
			}
		],
		items: [
			{
				id: 'frischwasser',
				description: 'Frischwasser 2025, 378 m³',
				label: 'Frischwasser',
				category: 'wasser',
				key: 'consumption',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 1_247_40
			},
			{
				id: 'schmutzwasser',
				description: 'Schmutzwasser 2025, 378 m³',
				label: 'Schmutzwasser',
				category: 'abwasser',
				key: 'consumption',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 1_001_70
			},
			{
				id: 'niederschlagswasser',
				description: 'Niederschlagswasser 2025',
				label: 'Regenwasser',
				category: 'abwasser',
				key: 'area',
				periodStart: '2025-01-01',
				periodEnd: '2025-12-31',
				amount: 234_00
			}
		],
		meters: [
			{ unitId: 'w1', kind: 'cold_water', start: 1_204, end: 1_372 },
			{ unitId: 'w2', kind: 'cold_water', start: 655, end: 747 },
			{ unitId: 'w3', kind: 'cold_water', start: 118, end: 159 },
			{ unitId: 'w4', kind: 'cold_water', start: 893, end: 970 }
		],
		expected: {
			leases: {
				brandt: {
					shares: { frischwasser: 554_40, schmutzwasser: 445_20, niederschlagswasser: 76_50 },
					prepayments: 1_020_00
				},
				lang: {
					shares: { frischwasser: 303_60, schmutzwasser: 243_80, niederschlagswasser: 58_50 },
					prepayments: 660_00
				},
				costa: {
					shares: { frischwasser: 135_30, schmutzwasser: 108_65, niederschlagswasser: 58_50 },
					prepayments: 300_00
				},
				wolf: {
					shares: { frischwasser: 254_10, schmutzwasser: 204_05, niederschlagswasser: 40_50 },
					prepayments: 540_00
				}
			},
			landlordCo2Share: 0,
			vacancyShare: 0
		},
		check: [
			exactCheck,
			'Die Zähler zeigen zusammen 168 + 92 + 41 + 77 = 378 m³. Frischwasser kostet damit 1.247,40 € / 378 m³ = 3,30 € je m³, Schmutzwasser 1.001,70 € / 378 m³ = 2,65 € je m³. Wohnung 1 zum Beispiel: 168 m³ × 3,30 € = 554,40 € und 168 m³ × 2,65 € = 445,20 €.',
			'Das Niederschlagswasser verteilt sich auf 260 m² Wohnfläche, das sind 0,90 € je m²: 85 m² × 0,90 € = 76,50 € für Wohnung 1.',
			'Nach Personen wäre die Rechnung eine ganz andere: Frau Brandts vierköpfige Familie trüge dann 4 von 9 Teilen des Wassers, obwohl sie 168 von 378 m³ verbraucht hat. Zähler gehen vor.'
		],
		sources: [
			betrkv,
			bgb556a,
			{
				label: '§ 556a Abs. 1 Satz 2 BGB: erfasster Verbrauch',
				url: 'https://www.gesetze-im-internet.de/bgb/__556a.html'
			}
		]
	}
];
