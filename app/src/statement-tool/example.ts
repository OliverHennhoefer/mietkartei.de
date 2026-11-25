import {
	newTenancy,
	newToolState,
	type ToolState,
	type ToolTenancy,
	type ToolUnit
} from '../lib/domain/statement-tool';

// The example behind "Mit Beispiel ausprobieren": a house in Leipzig with three flats, a change of
// tenants in the upper floor, water by meter and gas heating under the Heizkostenverordnung with
// its CO₂ split. It shows in seconds what the tool prints; the numbers are invented.

function tenancy(fields: Partial<ToolTenancy>): ToolTenancy {
	return { ...newTenancy(), ...fields };
}

export function exampleToolState(today: string): ToolState {
	const state = newToolState(today);
	const year = state.periodStart.slice(0, 4);
	const ground: ToolUnit = {
		id: 'w-eg',
		name: 'Erdgeschoss',
		area: '80',
		tenancies: [
			tenancy({
				id: 'm-krueger',
				salutation: 'Herr',
				firstName: 'Jonas',
				lastName: 'Krüger',
				persons: '2',
				operatingCostPrepayment: '170',
				heatingCostPrepayment: '170'
			})
		]
	};
	const upper: ToolUnit = {
		id: 'w-og',
		name: 'Obergeschoss',
		area: '60',
		tenancies: [
			tenancy({
				id: 'm-schulz',
				salutation: 'Frau',
				firstName: 'Petra',
				lastName: 'Schulz',
				end: `${year}-07-15`,
				persons: '1',
				operatingCostPrepayment: '130',
				heatingCostPrepayment: '100'
			}),
			tenancy({
				id: 'm-yilmaz',
				salutation: 'Herr',
				firstName: 'Deniz',
				lastName: 'Yilmaz',
				start: `${year}-07-16`,
				persons: '3',
				operatingCostPrepayment: '120',
				heatingCostPrepayment: '100'
			})
		]
	};
	const attic: ToolUnit = {
		id: 'w-dg',
		name: 'Dachgeschoss',
		area: '60',
		tenancies: [
			tenancy({
				id: 'm-weber',
				salutation: 'Frau',
				firstName: 'Lena',
				lastName: 'Weber',
				persons: '2',
				operatingCostPrepayment: '110',
				heatingCostPrepayment: '85'
			})
		]
	};

	const amounts: Record<number, [string, string]> = {
		1: ['720,00', `Grundsteuer ${year}`],
		2: ['420,00', 'Frischwasser'],
		3: ['290,00', 'Schmutz- und Niederschlagswasser'],
		4: ['3.860,00', 'Gas und Wartung'],
		8: ['547,50', 'Müllabfuhr'],
		9: ['624,00', 'Treppenhausreinigung'],
		11: ['186,40', 'Allgemeinstrom'],
		13: ['1.064,00', 'Gebäudeversicherung'],
		14: ['480,00', 'Hausmeisterdienst']
	};
	const items = state.items.map((item) => {
		const entry = amounts[item.category];
		if (!entry) return item;
		const [amount, description] = entry;
		const filled = { ...item, amount, description };
		// Water by the flats' meters, waste by persons, as many houses split them.
		if (item.category === 2 || item.category === 3) {
			return { ...filled, key: 'consumption' as const, meter: 'cold_water' as const };
		}
		if (item.category === 8) return { ...filled, key: 'persons' as const };
		if (item.category === 4) {
			return {
				...filled,
				key: 'mixed' as const,
				consumptionPercent: 70,
				meter: 'heat' as const,
				co2: { fuel: 'gas' as const, fuelKwh: '28400', co2Kg: '', co2Cost: '312,40' }
			};
		}
		return filled;
	});

	return {
		...state,
		landlord: {
			name: 'Eva Beispiel',
			street: 'Lindenallee 3',
			postalCode: '04107',
			city: 'Leipzig',
			iban: 'DE02 1203 0000 0000 2020 51'
		},
		property: {
			name: 'Gartenstraße 12',
			street: 'Gartenstraße 12',
			postalCode: '04107',
			city: 'Leipzig'
		},
		units: [ground, upper, attic],
		items,
		consumption: {
			cold_water: { 'w-eg': '92', 'w-og': '59', 'w-dg': '76' },
			hot_water: {},
			heat: { 'w-eg': '9850', 'w-og': '6060', 'w-dg': '6410' }
		},
		heatUnit: 'kWh'
	};
}
