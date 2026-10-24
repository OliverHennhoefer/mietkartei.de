import {
	MAX_PHOTO_BYTES,
	MAX_PHOTOS,
	type DamageReportInput,
	type DamageReportUpdate
} from '../server/damage-reports';
import { damageReportStatuses } from '../server/db/schema';
import { FormParser, type FieldErrors, type ParseResult } from './fields';

// Parses the report form of the Mieterportal and the landlord's status form. Whether a photo
// really is an image is checked by its bytes in the server module; here only the declared type
// and the size.

export type DamageReportForm = DamageReportInput & { photos: File[] };

export type DamageReportFormErrors = FieldErrors<DamageReportForm>;

const MAX_PHOTO_MEGABYTES = Math.round(MAX_PHOTO_BYTES / 1024 / 1024);

export function parseDamageReport(form: FormData): ParseResult<DamageReportForm> {
	const parser = new FormParser<DamageReportForm>(form);
	const title = parser.text('title', { max: 120 });
	const description = parser.text('description', { max: 4000 });
	const location = parser.optionalText('location', 200);
	const urgent = parser.flag('urgent');
	const reporterName = parser.optionalText('reporterName', 200);
	const reporterPhone = parser.optionalText('reporterPhone', 50);

	const photos = form
		.getAll('photos')
		.filter((value): value is File => value instanceof File && value.size > 0 && !!value.name);
	if (photos.length > MAX_PHOTOS) {
		parser.fail('photos', `Höchstens ${MAX_PHOTOS} Fotos.`);
	} else if (photos.some((photo) => !photo.type.startsWith('image/'))) {
		parser.fail('photos', 'Bitte nur Fotos anhängen (JPEG, PNG, GIF oder WebP).');
	} else if (photos.some((photo) => photo.size > MAX_PHOTO_BYTES)) {
		parser.fail('photos', `Ein Foto ist zu groß (höchstens ${MAX_PHOTO_MEGABYTES} MB je Foto).`);
	}

	return parser.result(() => ({
		title,
		description,
		location,
		urgent,
		reporterName,
		reporterPhone,
		photos
	}));
}

export function parseDamageReportUpdate(form: FormData): ParseResult<DamageReportUpdate> {
	const parser = new FormParser<DamageReportUpdate>(form);
	const status = parser.oneOf('status', damageReportStatuses);
	const reply = parser.optionalText('reply', 2000);
	return parser.result(() => ({ status: status!, reply }));
}
