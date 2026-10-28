import { MAX_KEYS, MAX_ROOMS } from '../domain/handover';
import { roomConditions, type HandoverKey, type HandoverRoom } from '../server/db/schema';
import type { HandoverInput } from '../server/handovers';
import { FormParser, type ParseResult } from './fields';

// Parses the form of an Übergabeprotokoll: rows of rooms (room1, condition1, roomNote1, …), rows
// of keys (key1, keyCount1, …) and a reading per meter (reading-<meter id>). Empty rows are left
// out. The lease and the kind come from the route.

export type HandoverFields = HandoverInput & {
	[row: `room${number}` | `condition${number}` | `roomNote${number}`]: string;
	[row: `key${number}` | `keyCount${number}`]: string;
	[meter: `reading-${string}`]: string;
};

export function parseHandover(
	form: FormData,
	meterIds: readonly string[]
): ParseResult<HandoverFields> {
	const parser = new FormParser<HandoverFields>(form);
	const date = parser.date('date');
	const attendees = parser.optionalText('attendees', 300);
	const rooms: HandoverRoom[] = [];
	for (let row = 1; row <= MAX_ROOMS; row++) {
		const name = parser.text(`room${row}`, { required: false, max: 100 });
		const note = parser.optionalText(`roomNote${row}`, 500);
		const condition = parser.raw(`condition${row}`) || 'good';
		if (!name) {
			if (note) parser.fail(`room${row}`, 'Bitte gib den Raum an.');
			continue;
		}
		if (!(roomConditions as readonly string[]).includes(condition)) {
			parser.fail(`condition${row}`, 'Bitte wähle einen Zustand.');
			continue;
		}
		rooms.push({ name, condition: condition as HandoverRoom['condition'], note });
	}
	if (rooms.length === 0) parser.fail('room1', 'Bitte gib mindestens einen Raum an.');
	const keys: HandoverKey[] = [];
	for (let row = 1; row <= MAX_KEYS; row++) {
		const label = parser.text(`key${row}`, { required: false, max: 100 });
		const count = parser.number(`keyCount${row}`, { required: false, integer: true, max: 99 });
		if (!label) {
			if (count) parser.fail(`key${row}`, 'Bitte gib an, wofür der Schlüssel ist.');
			continue;
		}
		keys.push({ label, count: count ?? 0 });
	}
	const readings: Record<string, number> = {};
	for (const meterId of meterIds) {
		const value = parser.number(`reading-${meterId}`, { required: false });
		if (value !== null) readings[meterId] = value;
	}
	const notes = parser.optionalText('notes', 4000);
	return parser.result(() => ({
		date: date!,
		attendees,
		rooms,
		keys,
		readings,
		notes
	}));
}
