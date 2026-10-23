import { describe, expect, it } from 'vitest';
import { formDataOf } from './fields';
import { linkValue, parseTask } from './tasks';

function parse(entries: Record<string, string>) {
	return parseTask(formDataOf(entries));
}

function errorsOf(entries: Record<string, string>) {
	const result = parse(entries);
	expect(result.ok).toBe(false);
	return result.ok ? {} : result.errors;
}

describe('parseTask', () => {
	it('parses a task with a due date, a property link and a note', () => {
		const result = parse({
			title: '  Rauchmelder prüfen ',
			category: 'inspection',
			dueDate: '2026-11-30',
			repeatMonths: '12',
			link: linkValue('property', 'property-1'),
			note: 'Alle Wohnungen.'
		});
		expect(result).toEqual({
			ok: true,
			data: {
				title: 'Rauchmelder prüfen',
				category: 'inspection',
				dueDate: '2026-11-30',
				repeatMonths: 12,
				propertyId: 'property-1',
				leaseId: null,
				note: 'Alle Wohnungen.'
			},
			values: {
				title: 'Rauchmelder prüfen',
				category: 'inspection',
				dueDate: '2026-11-30',
				repeatMonths: '12',
				link: 'property:property-1',
				note: 'Alle Wohnungen.'
			}
		});
	});

	it('parses a lease link and leaves the optional fields null', () => {
		const result = parse({ title: 'Übergabeprotokoll', link: linkValue('lease', 'lease-1') });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data).toEqual({
			title: 'Übergabeprotokoll',
			category: 'other',
			dueDate: null,
			repeatMonths: null,
			propertyId: null,
			leaseId: 'lease-1',
			note: null
		});
	});

	it('accepts the empty link', () => {
		const result = parse({ title: 'Ohne Bezug', link: '' });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.propertyId).toBeNull();
		expect(result.data.leaseId).toBeNull();
	});

	it('requires a title', () => {
		expect(errorsOf({ title: '   ' })).toEqual({ title: 'Bitte fülle dieses Feld aus.' });
	});

	it('refuses a malformed date and a malformed link', () => {
		expect(errorsOf({ title: 'Aufgabe', dueDate: '30.11.2026' })).toEqual({
			dueDate: 'Bitte gib ein gültiges Datum an.'
		});
		expect(errorsOf({ title: 'Aufgabe', link: 'tenant:abc' })).toEqual({
			link: 'Bitte wähle einen gültigen Eintrag aus.'
		});
		expect(errorsOf({ title: 'Aufgabe', link: 'property:' })).toEqual({
			link: 'Bitte wähle einen gültigen Eintrag aus.'
		});
	});

	it('needs a due date to repeat and refuses unknown intervals and categories', () => {
		expect(errorsOf({ title: 'Aufgabe', repeatMonths: '12' })).toEqual({
			dueDate: 'Eine wiederkehrende Aufgabe braucht ein Fälligkeitsdatum.'
		});
		expect(errorsOf({ title: 'Aufgabe', dueDate: '2026-11-30', repeatMonths: '7' })).toEqual({
			repeatMonths: 'Bitte wähle einen gültigen Eintrag aus.'
		});
		expect(errorsOf({ title: 'Aufgabe', category: 'repair' })).toEqual({
			category: 'Bitte wähle einen gültigen Eintrag aus.'
		});
	});

	it('limits the note to 2000 characters and keeps the typed values', () => {
		const result = parse({ title: 'Aufgabe', note: 'x'.repeat(2001) });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({ note: 'Höchstens 2000 Zeichen.' });
		expect(result.values.title).toBe('Aufgabe');
	});
});
