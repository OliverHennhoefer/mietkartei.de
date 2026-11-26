import { addresseeLine, greeting as addresseeGreeting } from './addressee';
import { giroCode, paymentPurpose } from './girocode';
import { formatDate, formatMonth, today } from '../dates';
import { formatArea, formatNumber, personName, pluralize } from '../format';
import { formatCents } from '../money';
import type { Letter, PdfTable } from './letters';
import { balanceLabel, changeLabel, DUE_DAYS, periodLabel, type LeaseStatement } from './statement';

// The letter of the operating cost statement for one lease, built from the frozen result alone.
// Pure, so the app's PDF route and the free statement tool on mietkartei.de print the same letter.

/** The letter's note for a tenant who buys gas or heat directly from the supplier. */
const OWN_HEATING_CONTRACT =
	'Ihre Heizung betreiben Sie mit einem eigenen Liefervertrag. Die Kosten für Gas oder Wärme rechnet Ihr Versorger direkt mit Ihnen ab; sie sind nicht Teil dieser Abrechnung.';

function lines(...parts: (string | null | undefined)[]): string[] {
	return parts.filter((part): part is string => Boolean(part && part.trim()));
}

function greeting(statement: LeaseStatement): string {
	if (statement.namesOneTenant) return addresseeGreeting(statement.tenants);
	const names = statement.tenants.map((tenant) => {
		const salutation = tenant.salutation === 'Frau' || tenant.salutation === 'Herr';
		return salutation ? `${tenant.salutation} ${tenant.lastName}` : personName(tenant);
	});
	return names.length > 0 ? `Guten Tag ${names.join(', ')},` : 'Guten Tag,';
}

/** The subject line of the letter, also the start of the file name. */
function statementSubject(statement: LeaseStatement): string {
	return `Betriebskostenabrechnung ${periodLabel(statement.period.start, statement.period.end)}`;
}

export function statementFilename(statement: LeaseStatement): string {
	const unitNames = statement.units.map((unit) => unit.name).join(' ');
	return `${statementSubject(statement)} ${unitNames}.pdf`;
}

/**
 * The letter for one lease, built from the frozen result alone: sender, recipient, the cost table
 * with Gesamtkosten, Umlageschlüssel and the tenant's share, the CO2 disclosure, the paid
 * prepayments and the balance with when it is due. PDFs write "CO2", the renderer has no
 * subscript glyph.
 */
export type LetterOptions = {
	/**
	 * Where the paid prepayments come from: the lease's rent account (the app) or the monthly
	 * amounts the landlord typed in (the statement tool on mietkartei.de). Default: rent account.
	 */
	prepayments?: 'rent_account' | 'entered';
};

export function statementLetter(statement: LeaseStatement, options: LetterOptions = {}): Letter {
	const { landlord, property } = statement;
	const unitNames = statement.units.map((unit) => unit.name).join(' + ');
	const periodText = `${formatDate(statement.period.start)} bis ${formatDate(statement.period.end)}`;
	const addressTenant = statement.tenants.find((tenant) => tenant.street || tenant.city);
	const recipient = lines(
		...(statement.namesOneTenant
			? [addresseeLine(statement.tenants)]
			: statement.tenants.map((tenant) => lines(tenant.salutation, personName(tenant)).join(' '))),
		addressTenant?.street ?? property.street,
		addressTenant
			? lines(addressTenant.postalCode, addressTenant.city).join(' ')
			: `${property.postalCode} ${property.city}`
	);
	const date = `${landlord.city ?? property.city}, ${formatDate(statement.approvedOn ?? today())}`;

	const area = statement.units.reduce((sum, unit) => sum + (unit.floorArea ?? 0), 0);
	const persons = statement.persons
		.map((entry) =>
			statement.persons.length === 1
				? pluralize(entry.persons, 'Person', 'Personen')
				: `${pluralize(entry.persons, 'Person', 'Personen')} vom ${formatDate(entry.from)} bis ${formatDate(entry.to)}`
		)
		.join(', ');
	const intro = [
		greeting(statement),
		`hiermit rechnen wir die Betriebskosten für ${unitNames} im Objekt ${property.name}, ${property.street}, ${property.postalCode} ${property.city} für den Zeitraum ${periodText} ab. ` +
			`Nutzungszeitraum: ${formatDate(statement.occupancy.start)} bis ${formatDate(statement.occupancy.end)} (${statement.occupancy.days} von ${statement.period.days} Tagen), ` +
			`Fläche ${formatArea(area)}, ${persons}.`
	];

	const costTable: PdfTable = {
		title: 'Kostenaufstellung',
		columns: [
			// Wide enough for the bold "Gesamtkosten" header, which the renderer would otherwise cut.
			{ label: 'Kostenart', width: 0.28 },
			{ label: 'Gesamtkosten', align: 'right', width: 0.18 },
			{ label: 'Umlageschlüssel', width: 0.36 },
			{ label: 'Ihr Anteil', align: 'right', width: 0.18 }
		],
		rows: statement.lines.map((line) => [
			lines(
				line.categoryName,
				line.betrkvItem ? `§ 2 Nr. ${line.betrkvItem} BetrKV` : null,
				line.description !== line.categoryName ? line.description : null
			).join('\n'),
			lines(
				line.association ? `${formatCents(line.association.total)} WEG` : null,
				line.association ? `Anteil ${formatCents(line.itemTotal)}` : formatCents(line.itemTotal),
				line.allocated !== line.itemTotal
					? `− ${formatCents(line.itemTotal - line.allocated)} CO2\n= ${formatCents(line.allocated)}`
					: null
			).join('\n'),
			`${line.keyName}: ${line.keyTotal}\n${line.share}`,
			formatCents(line.amount)
		]),
		footer: ['Summe', '', '', formatCents(statement.costsTotal)]
	};

	const co2 = statement.lines
		.filter((line) => line.co2)
		.map((line) => {
			const data = line.co2!;
			return (
				`CO2-Kostenaufteilung (CO2KostAufG) für ${line.description}: ${formatNumber(data.co2Kg)} kg CO2 laut Beleg; ` +
				`das Gebäude stößt ${formatNumber(data.buildingCo2Kg)} kg CO2 im Jahr aus, bei ${formatArea(data.area)} Gebäudefläche ` +
				`${formatNumber(data.kgPerSquareMetre)} kg CO2 je m² und Jahr. Vermieteranteil ${data.landlordPercent} %: ` +
				`vom CO2-Preis ${formatCents(data.co2Cost)} trägt der Vermieter ${formatCents(data.landlordAmount)}; dieser Betrag ist von den Gesamtkosten abgezogen.`
			);
		});

	const chargedTotal = statement.prepayments.reduce((sum, month) => sum + month.charged, 0);
	const prepaymentTable: PdfTable = {
		title: 'Geleistete Vorauszahlungen',
		columns: [
			{ label: 'Monat', width: 0.24 },
			{ label: 'Soll', align: 'right', width: 0.19 },
			{ label: 'Betriebskosten', align: 'right', width: 0.19 },
			{ label: 'Heizkosten', align: 'right', width: 0.19 },
			{ label: 'Geleistet', align: 'right', width: 0.19 }
		],
		rows: statement.prepayments.map((month) => [
			formatMonth(month.period),
			formatCents(month.charged),
			formatCents(month.operatingCostPrepayment),
			formatCents(month.heatingCostPrepayment),
			formatCents(month.amount)
		]),
		footer: ['Summe', formatCents(chargedTotal), '', '', formatCents(statement.prepaymentsTotal)]
	};
	const unpaid =
		statement.unpaidPrepayments > 0
			? `Von den Vorauszahlungen für den Abrechnungszeitraum (${formatCents(chargedTotal)}) haben Sie ${formatCents(statement.unpaidPrepayments)} nicht geleistet. Die Abrechnung rechnet nur die geleisteten an; die offenen Vorauszahlungen sind im Ergebnis enthalten und werden nicht zusätzlich verlangt.`
			: null;

	const label = balanceLabel(statement.balance);
	const amount = formatCents(Math.abs(statement.balance));
	const result = `Kosten gesamt ${formatCents(statement.costsTotal)}, geleistete Vorauszahlungen ${formatCents(statement.prepaymentsTotal)}: ${label === 'ausgeglichen' ? 'Kosten und Vorauszahlungen gleichen sich aus.' : `${label} ${amount}.`}`;
	const dueDate = statement.dueDate ? formatDate(statement.dueDate) : null;
	// After the deadline (§ 556 Abs. 3 BGB) the claim can be less than the balance: a Nachzahlung
	// that is not claimed beyond the unpaid prepayments, or a late correction held to what was
	// claimed in time.
	const claimed = statement.posted ?? statement.balance;
	const late = 'Die Abrechnung erreicht Sie nach Ablauf der Abrechnungsfrist (§ 556 Abs. 3 BGB)';
	const limited =
		claimed >= statement.balance
			? null
			: claimed === 0
				? `${late}; die Nachzahlung von ${amount} wird nicht verlangt.`
				: claimed === statement.unpaidPrepayments
					? `${late}; von der Nachzahlung verlangen wir nur die ${formatCents(claimed)} Vorauszahlungen, die Sie nicht geleistet haben.`
					: 'Nach Ablauf der Abrechnungsfrist (§ 556 Abs. 3 BGB) gilt das rechtzeitig abgerechnete Ergebnis.';
	const claimedAmount = formatCents(Math.abs(claimed));
	let settlement: string;
	if (claimed > 0) {
		const account = lines(
			landlord.iban ? `IBAN ${landlord.iban}` : null,
			landlord.bankName ? `bei der ${landlord.bankName}` : null
		).join(' ');
		settlement =
			`Bitte überweisen Sie die Nachzahlung von ${claimedAmount} innerhalb von ${DUE_DAYS} Tagen nach Zugang dieser Abrechnung` +
			(account ? ` auf das Konto ${account}.` : '.');
	} else if (claimed < 0) {
		settlement = `Das Guthaben von ${claimedAmount} erstatten wir Ihnen${dueDate ? ` bis zum ${dueDate}` : ''} oder verrechnen es mit der nächsten Miete.`;
	} else {
		settlement = limited ? '' : 'Es ist nichts zu zahlen und nichts zu erstatten.';
	}
	settlement = [limited, settlement].filter(Boolean).join(' ');
	const code =
		claimed > 0
			? giroCode({
					name: landlord.name,
					iban: landlord.iban,
					amount: claimed,
					purpose: paymentPurpose(
						`Nachzahlung ${statementSubject(statement)}`,
						statement.units.map((unit) => unit.name),
						statement.tenants.map((tenant) => tenant.lastName)
					)
				})
			: undefined;

	// The Vorjahresvergleich: the Gesamtkosten of the lease's Kostenarten in both periods.
	const comparison = statement.comparison;
	const comparisonTable: PdfTable | null = comparison && {
		title: `Vergleich mit der Abrechnung ${periodLabel(comparison.previous.start, comparison.previous.end)}`,
		columns: [
			{ label: 'Kostenart', width: 0.4 },
			{
				label: periodLabel(comparison.previous.start, comparison.previous.end),
				align: 'right',
				width: 0.2
			},
			{
				label: periodLabel(statement.period.start, statement.period.end),
				align: 'right',
				width: 0.2
			},
			{ label: 'Veränderung', align: 'right', width: 0.2 }
		],
		rows: comparison.rows.map((row) => [
			row.categoryName,
			row.previous === null ? '–' : formatCents(row.previous),
			row.current === null ? '–' : formatCents(row.current),
			changeLabel(row.previous, row.current)
		])
	};

	const excluded =
		statement.excluded.length > 0
			? [
					`Nicht enthalten (${statement.excluded[0].reason}): ` +
						statement.excluded
							.map((line) => `${line.categoryName} ${formatCents(line.amount)}`)
							.join(', ') +
						'.'
				]
			: [];

	return {
		sender: lines(
			landlord.name,
			landlord.street,
			lines(landlord.postalCode, landlord.city).join(' ')
		),
		recipient,
		date,
		subject: `${statementSubject(statement)} – ${property.name}, ${unitNames}`,
		paragraphs: [],
		blocks: [
			...intro.map((paragraph) => ({ paragraph })),
			{ table: costTable },
			...co2.map((paragraph) => ({ paragraph })),
			...(statement.ownHeatingContract ? [{ paragraph: OWN_HEATING_CONTRACT }] : []),
			{ table: prepaymentTable },
			...(unpaid ? [{ paragraph: unpaid }] : []),
			{ paragraph: result },
			{ paragraph: settlement },
			...(code ? [{ giroCode: code }] : []),
			...excluded.map((paragraph) => ({ paragraph })),
			...(comparisonTable ? [{ table: comparisonTable }] : []),
			{
				paragraph:
					'Die Belege können Sie nach Absprache einsehen. Einwendungen gegen diese Abrechnung teilen Sie uns bitte innerhalb von zwölf Monaten nach Zugang mit (§ 556 Abs. 3 BGB).'
			}
		],
		closing: ['Mit freundlichen Grüßen', '', landlord.name],
		appendix: {
			title: 'Anlage: Prüfprotokoll',
			blocks: [
				{
					paragraph: 'Diese Abrechnung wurde vor dem Versand auf die folgenden Punkte geprüft.'
				},
				{
					table: {
						columns: [{ label: 'Prüfpunkt', width: 0.28 }, { label: 'Ergebnis' }],
						rows: checkRows(statement, options)
					}
				}
			]
		}
	};
}

/**
 * The Prüfprotokoll of the letter: what the statement was checked for, each with what the frozen
 * result shows. Points that do not apply to the lease (no heating, no CO₂ cost) or did not pass
 * (the deadline) are left out rather than printed as failed: the letter says the rest.
 */
export function checkRows(statement: LeaseStatement, options: LetterOptions = {}): string[][] {
	const { period, occupancy } = statement;
	const rows: string[][] = [
		[
			'Abrechnungszeitraum',
			`${formatDate(period.start)} bis ${formatDate(period.end)}, ${period.days} Tage: nicht länger als zwölf Monate (§\u00a0556 Abs.\u00a03 Satz\u00a01 BGB).`
		]
	];
	if (statement.approvedOn && !statement.late) {
		rows.push([
			'Abrechnungsfrist',
			`Erstellt am ${formatDate(statement.approvedOn)}, die Frist endet am ${formatDate(statement.deadline)} (§\u00a0556 Abs.\u00a03 Satz\u00a02 BGB).`
		]);
	}
	rows.push([
		'Mindestangaben',
		'Je Kostenart die Gesamtkosten, der Umlageschlüssel und Ihr Anteil mit Rechenweg, dazu Ihre Vorauszahlungen.'
	]);
	rows.push([
		'Umlagefähigkeit',
		statement.lines.every((line) => line.betrkvItem !== null)
			? 'Nur Betriebskosten nach §\u00a02 Betriebskostenverordnung, jede Kostenart mit ihrer Nummer; ohne Verwaltung und Instandhaltung.'
			: 'Nur Betriebskosten nach §\u00a02 Betriebskostenverordnung; ohne Verwaltung und Instandhaltung.'
	]);
	const heating = statement.lines.filter((line) => line.heating);
	// Only when every heating line was split by consumption as the HeizkostenV wants: not after a
	// fallback to the floor area (§ 9a Abs. 2) or with a share outside 50–70 %.
	if (heating.length > 0 && heating.every((line) => line.heizkv)) {
		rows.push([
			'Heizkostenverordnung',
			'Heiz- und Warmwasserkosten nach Verbrauch verteilt (§§\u00a07, 8 HeizkostenV).'
		]);
	}
	if (statement.ownHeatingContract) {
		rows.push([
			'Heizkosten',
			'Eigener Liefervertrag des Mieters: Kosten für Gas oder Wärme sind nicht enthalten.'
		]);
	}
	const co2 = statement.lines.flatMap((line) => (line.co2 ? [line.co2] : []));
	if (co2.length > 0) {
		const percents = [...new Set(co2.map((entry) => `${entry.landlordPercent}\u00a0%`))].join(', ');
		rows.push([
			'CO2-Kosten',
			`Nach dem Stufenmodell des CO2-Kostenaufteilungsgesetzes aufgeteilt; der Anteil des Vermieters (${percents}) ist vor der Umlage abgezogen.`
		]);
	}
	rows.push([
		'Nutzungszeitraum',
		occupancy.days < period.days
			? `Tagesgenau: ${occupancy.days} von ${period.days} Tagen, ${formatDate(occupancy.start)} bis ${formatDate(occupancy.end)}.`
			: `Der ganze Abrechnungszeitraum, ${period.days} Tage.`
	]);
	const months = statement.prepayments.filter((month) => month.amount !== 0).length;
	rows.push([
		'Vorauszahlungen',
		`${options.prepayments === 'entered' ? 'Vereinbarte Vorauszahlungen angerechnet' : 'Aus dem Mietkonto angerechnet'}: ${pluralize(months, 'Monat', 'Monate')}, zusammen ${formatCents(statement.prepaymentsTotal)}.`
	]);
	return rows;
}
