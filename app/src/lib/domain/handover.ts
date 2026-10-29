import { formatDate, type IsoDate } from '../dates';
import { formatNumber } from '../format';
import { handoverKindLabels, roomConditionLabels } from '../labels';
import type { HandoverKey, HandoverKind, HandoverReading, HandoverRoom } from '../server/db/schema';
import type { LetterBlock } from '../server/pdf';

// Übergabeprotokoll: rooms with their condition, keys handed over and meter readings on the day
// the tenant moves in or out. Pure, so the form's defaults and the PDF share one shape. The
// move-out protocol shows the move-in condition next to each room and key, which is what a
// later dispute about damage turns on.

export const MAX_ROOMS = 15;
export const MAX_KEYS = 8;

export type HandoverContent = {
	kind: HandoverKind;
	date: IsoDate;
	attendees: string | null;
	rooms: HandoverRoom[];
	keys: HandoverKey[];
	readings: HandoverReading[];
	notes: string | null;
};

/** The rooms a form starts with: the usual ones and a room per room of the flat beyond two. */
export function defaultRooms(roomCount: number | null): HandoverRoom[] {
	const living = Math.max(1, Math.floor(roomCount ?? 2));
	const names = [
		'Flur',
		'Küche',
		'Bad',
		'Wohnzimmer',
		...(living >= 2 ? ['Schlafzimmer'] : []),
		...Array.from({ length: Math.max(0, living - 2) }, (_, index) => `Zimmer ${index + 3}`)
	];
	return names.map((name) => ({ name, condition: 'good', note: null }));
}

export const defaultKeys: HandoverKey[] = [
	{ label: 'Haustür', count: 2 },
	{ label: 'Wohnungstür', count: 2 },
	{ label: 'Briefkasten', count: 1 },
	{ label: 'Keller', count: 1 }
];

/**
 * What the form of a protocol starts with: the stored protocol, else for the move-out the rooms
 * and keys of the move-in (all in order until checked), else the defaults.
 */
export function protocolDefaults(
	stored: HandoverContent | undefined,
	moveIn: HandoverContent | undefined,
	roomCount: number | null
): Pick<HandoverContent, 'rooms' | 'keys'> {
	if (stored) return { rooms: stored.rooms, keys: stored.keys };
	if (moveIn) {
		return {
			rooms: moveIn.rooms.map((room) => ({ name: room.name, condition: 'good', note: null })),
			keys: moveIn.keys
		};
	}
	return { rooms: defaultRooms(roomCount), keys: defaultKeys };
}

/** The title of the protocol's PDF, e.g. "Übergabeprotokoll Einzug". */
export function protocolTitle(kind: HandoverKind): string {
	return `Übergabeprotokoll ${handoverKindLabels[kind]}`;
}

const condition = (room: HandoverRoom) =>
	room.note
		? `${roomConditionLabels[room.condition]}: ${room.note}`
		: roomConditionLabels[room.condition];

/**
 * The body of the protocol's PDF: rooms, keys, readings, notes and the lines to sign. With the
 * move-in protocol, rooms and keys of the move-out name what they were then.
 */
export function protocolBlocks(protocol: HandoverContent, moveIn?: HandoverContent): LetterBlock[] {
	const compare = protocol.kind === 'move_out' && moveIn !== undefined;
	const earlier = (name: string) => moveIn?.rooms.find((room) => room.name === name);
	const earlierKey = (label: string) => moveIn?.keys.find((key) => key.label === label);
	const blocks: LetterBlock[] = [
		{
			table: {
				title: 'Räume',
				columns: [
					{ label: 'Raum', width: 0.22 },
					{ label: 'Zustand' },
					...(compare ? [{ label: `Beim Einzug am ${formatDate(moveIn.date)}` }] : [])
				],
				rows: protocol.rooms.map((room) => {
					const before = earlier(room.name);
					return [
						room.name,
						condition(room),
						...(compare ? [before ? condition(before) : '–'] : [])
					];
				})
			}
		}
	];
	if (protocol.keys.length > 0) {
		blocks.push({
			table: {
				title: 'Schlüssel',
				columns: [
					{ label: 'Schlüssel' },
					{ label: 'Anzahl', align: 'right', width: 0.15 },
					...(compare ? [{ label: 'Beim Einzug', align: 'right' as const, width: 0.2 }] : [])
				],
				rows: protocol.keys.map((key) => [
					key.label,
					String(key.count),
					...(compare ? [String(earlierKey(key.label)?.count ?? '–')] : [])
				])
			}
		});
	}
	if (protocol.readings.length > 0) {
		blocks.push({
			table: {
				title: 'Zählerstände',
				columns: [{ label: 'Zähler' }, { label: 'Stand', align: 'right', width: 0.3 }],
				rows: protocol.readings.map((reading) => [
					reading.label,
					`${formatNumber(reading.value)} ${reading.unit}`
				])
			}
		});
	}
	if (protocol.notes)
		blocks.push({ paragraph: `Bemerkungen und Vereinbarungen:\n${protocol.notes}` });
	blocks.push({
		paragraph:
			'Die Beteiligten bestätigen den festgehaltenen Zustand mit ihrer Unterschrift.\n\n' +
			'Ort, Datum: ______________________________\n\n' +
			'Vermieter: ______________________________\n\n' +
			'Mieter: ______________________________'
	});
	return blocks;
}
