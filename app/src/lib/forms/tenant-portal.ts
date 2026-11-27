import { isIsoDate } from '../dates';
import { MAX_DAMAGE_PHOTOS } from '../domain/tenant-portal';
import { MAX_DOCUMENT_BYTES } from '../server/documents';
import type { DamageReportInput, MeterReportInput, PortalPhoto } from '../server/tenant-portal';
import type { ParseResult } from './fields';

// The two forms of the Mieterportal. The tenants are addressed with "Sie", so the messages are
// written here instead of coming from FormParser, which speaks to the landlord.

const MAX_MEGABYTES = Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024);

function text(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value.trim() : '';
}

/** The chosen files of a field; a field left empty sends one nameless, empty file. */
function files(form: FormData, name: string): File[] {
	return form
		.getAll(name)
		.filter((value): value is File => value instanceof File && value.size > 0);
}

async function photosOf(chosen: File[], fail: (message: string) => void): Promise<PortalPhoto[]> {
	if (chosen.some((file) => file.size > MAX_DOCUMENT_BYTES)) {
		fail(`Ein Foto ist zu groß (höchstens ${MAX_MEGABYTES} MB).`);
		return [];
	}
	return Promise.all(
		chosen.map(async (file) => ({
			name: file.name,
			type: file.type,
			bytes: new Uint8Array(await file.arrayBuffer())
		}))
	);
}

/** A meter value with a German comma or a dot, e.g. "1.234,5" or "1234.5". */
function meterValue(raw: string): number | null {
	if (!raw) return null;
	const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
	if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
	const value = Number(normalized);
	return Number.isFinite(value) && value <= 1_000_000_000 ? value : null;
}

export async function parseMeterReport(form: FormData): Promise<ParseResult<MeterReportInput>> {
	const errors: Partial<Record<keyof MeterReportInput, string>> = {};
	const values = {
		meterId: text(form, 'meterId'),
		readAt: text(form, 'readAt'),
		value: text(form, 'value'),
		note: text(form, 'note')
	};
	if (!values.meterId || values.meterId.length > 64)
		errors.meterId = 'Bitte wählen Sie den Zähler.';
	if (!isIsoDate(values.readAt)) errors.readAt = 'Bitte geben Sie das Datum der Ablesung an.';
	const value = meterValue(values.value);
	if (value === null) errors.value = 'Bitte geben Sie den Zählerstand als Zahl an, z. B. 1234,5.';
	if (values.note.length > 500) errors.note = 'Höchstens 500 Zeichen.';
	const chosen = files(form, 'photo').slice(0, 1);
	const [photo] = await photosOf(chosen, (message) => (errors.photo = message));
	if (Object.keys(errors).length > 0) return { ok: false, errors, values };
	return {
		ok: true,
		data: {
			meterId: values.meterId,
			readAt: values.readAt,
			value: value!,
			note: values.note || null,
			photo: photo ?? null
		}
	};
}

export async function parseDamageReport(form: FormData): Promise<ParseResult<DamageReportInput>> {
	const errors: Partial<Record<keyof DamageReportInput, string>> = {};
	const values = {
		title: text(form, 'title'),
		description: text(form, 'description'),
		reporter: text(form, 'reporter'),
		phone: text(form, 'phone')
	};
	if (!values.title) errors.title = 'Bitte beschreiben Sie den Schaden in wenigen Worten.';
	else if (values.title.length > 100) errors.title = 'Höchstens 100 Zeichen.';
	if (!values.description) errors.description = 'Bitte beschreiben Sie, was passiert ist.';
	else if (values.description.length > 2000) errors.description = 'Höchstens 2000 Zeichen.';
	if (!values.reporter) errors.reporter = 'Bitte geben Sie Ihren Namen an.';
	else if (values.reporter.length > 100) errors.reporter = 'Höchstens 100 Zeichen.';
	if (values.phone.length > 40) errors.phone = 'Höchstens 40 Zeichen.';
	const chosen = files(form, 'photos');
	if (chosen.length > MAX_DAMAGE_PHOTOS) {
		errors.photos = `Bitte wählen Sie höchstens ${MAX_DAMAGE_PHOTOS} Fotos.`;
	} else if (chosen.reduce((sum, file) => sum + file.size, 0) > MAX_DOCUMENT_BYTES) {
		// One request carries all photos, and the self-hosted server accepts 12 MB per request.
		errors.photos = `Die Fotos sind zusammen zu groß (höchstens ${MAX_MEGABYTES} MB).`;
	}
	const photos = errors.photos
		? []
		: await photosOf(chosen, (message) => (errors.photos = message));
	if (Object.keys(errors).length > 0) return { ok: false, errors, values };
	return {
		ok: true,
		data: {
			title: values.title,
			description: values.description,
			reporter: values.reporter,
			phone: values.phone || null,
			photos
		}
	};
}
