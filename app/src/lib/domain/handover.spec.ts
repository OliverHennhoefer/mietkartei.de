import { describe, expect, it } from 'vitest';
import {
	defaultKeys,
	defaultRooms,
	protocolBlocks,
	protocolDefaults,
	type HandoverContent
} from './handover';

const moveIn: HandoverContent = {
	kind: 'move_in',
	date: '2024-01-02',
	attendees: 'Vermieterin, Mieter',
	rooms: [
		{ name: 'Küche', condition: 'good', note: null },
		{ name: 'Bad', condition: 'worn', note: 'Fuge am Waschbecken' }
	],
	keys: [{ label: 'Wohnungstür', count: 2 }],
	readings: [{ meterId: 'm1', label: 'Kaltwasser 123', value: 12.5, unit: 'm³' }],
	notes: null
};

describe('defaults', () => {
	it('names a room per room of the flat', () => {
		expect(defaultRooms(1).map((room) => room.name)).toEqual([
			'Flur',
			'Küche',
			'Bad',
			'Wohnzimmer'
		]);
		expect(defaultRooms(3.5).map((room) => room.name)).toEqual([
			'Flur',
			'Küche',
			'Bad',
			'Wohnzimmer',
			'Schlafzimmer',
			'Zimmer 3'
		]);
		expect(defaultRooms(null)).toHaveLength(5);
	});

	it('starts the move-out from the move-in, all in order', () => {
		expect(protocolDefaults(undefined, undefined, 2)).toEqual({
			rooms: defaultRooms(2),
			keys: defaultKeys
		});
		expect(protocolDefaults(undefined, moveIn, 2)).toEqual({
			rooms: [
				{ name: 'Küche', condition: 'good', note: null },
				{ name: 'Bad', condition: 'good', note: null }
			],
			keys: moveIn.keys
		});
		expect(protocolDefaults(moveIn, undefined, 2).rooms).toBe(moveIn.rooms);
	});
});

describe('protocolBlocks', () => {
	it('lists rooms, keys, readings and the lines to sign', () => {
		const blocks = protocolBlocks(moveIn);
		expect(blocks).toHaveLength(4);
		expect(blocks[0]).toMatchObject({
			table: {
				title: 'Räume',
				rows: [
					['Küche', 'In Ordnung'],
					['Bad', 'Gebrauchsspuren: Fuge am Waschbecken']
				]
			}
		});
		expect(blocks[2]).toMatchObject({
			table: { title: 'Zählerstände', rows: [['Kaltwasser 123', '12,5 m³']] }
		});
		expect(blocks[3]).toMatchObject({ paragraph: expect.stringContaining('Vermieter: ____') });
	});

	it('puts the move-in condition next to the move-out', () => {
		const moveOut: HandoverContent = {
			...moveIn,
			kind: 'move_out',
			date: '2026-03-31',
			rooms: [
				{ name: 'Bad', condition: 'damaged', note: 'Badtür gesplittert' },
				{ name: 'Abstellraum', condition: 'good', note: null }
			],
			keys: [{ label: 'Wohnungstür', count: 1 }],
			readings: [],
			notes: 'Ein Schlüssel fehlt.'
		};
		const blocks = protocolBlocks(moveOut, moveIn);
		expect(blocks[0]).toMatchObject({
			table: {
				columns: [{}, {}, { label: 'Beim Einzug am 02.01.2024' }],
				rows: [
					['Bad', 'Mängel: Badtür gesplittert', 'Gebrauchsspuren: Fuge am Waschbecken'],
					['Abstellraum', 'In Ordnung', '–']
				]
			}
		});
		expect(blocks[1]).toMatchObject({ table: { rows: [['Wohnungstür', '1', '2']] } });
		expect(blocks[2]).toEqual({
			paragraph: 'Bemerkungen und Vereinbarungen:\nEin Schlüssel fehlt.'
		});
	});
});
