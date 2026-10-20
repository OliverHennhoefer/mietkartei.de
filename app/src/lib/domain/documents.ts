// Pure helpers of the documents feature (Dokumente): the size and type shown in lists, the
// Content-Disposition header of the download route, and the texts of a document's links.

const oneDecimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** `1536` → `1,5 KB`: bytes below 1 KB, kilobytes below 1 MB, else megabytes, one decimal. */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}\u00a0B`;
	const kilobytes = bytes / 1024;
	if (kilobytes < 1024) return `${oneDecimal.format(kilobytes)}\u00a0KB`;
	return `${oneDecimal.format(kilobytes / 1024)}\u00a0MB`;
}

const typeLabels: [RegExp, string][] = [
	[/^application\/pdf$/, 'PDF'],
	[/^image\//, 'Bild'],
	[/^text\/plain$/, 'Text'],
	[/^text\/csv$/, 'CSV'],
	[
		/^application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml|vnd\.oasis\.opendocument\.text)/,
		'Textdokument'
	],
	[
		/^application\/(vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml|vnd\.oasis\.opendocument\.spreadsheet)/,
		'Tabelle'
	],
	[/^application\/(zip|x-zip-compressed)$/, 'ZIP'],
	[/^(message\/rfc822|application\/vnd\.ms-outlook)$/, 'E-Mail']
];

/** A short German word for the file type, `Datei` when the type is not a known one. */
export function documentTypeLabel(mimeType: string): string {
	const type = mimeType.toLowerCase().split(';')[0].trim();
	const match = typeLabels.find(([pattern]) => pattern.test(type));
	return match ? match[1] : 'Datei';
}

const inlineTypes = new Set([
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp'
]);

/** Whether the browser may show the file instead of saving it: PDFs and common images only. */
export function canInline(mimeType: string): boolean {
	return inlineTypes.has(mimeType.toLowerCase().split(';')[0].trim());
}

const transliterations: Record<string, string> = {
	ä: 'ae',
	ö: 'oe',
	ü: 'ue',
	Ä: 'Ae',
	Ö: 'Oe',
	Ü: 'Ue',
	ß: 'ss'
};

/** The file name for clients that read only the plain `filename` parameter: ASCII, no quotes. */
export function asciiFilename(filename: string): string {
	const ascii = filename
		.replace(/[äöüÄÖÜß]/g, (char) => transliterations[char])
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[^A-Za-z0-9 ._-]/g, '_')
		.trim();
	return ascii || 'Dokument';
}

/**
 * The Content-Disposition header of a download (RFC 6266): the ASCII name for old clients and
 * the real name percent-encoded as RFC 5987 wants it, which also covers `'`, `(`, `)` and `*`.
 */
export function contentDisposition(filename: string, inline = false): string {
	const encoded = encodeURIComponent(filename).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
	);
	const type = inline ? 'inline' : 'attachment';
	return `${type}; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encoded}`;
}

export type LinkOption = { id: string; label: string };
export type UnitOption = LinkOption & { propertyId: string };

/** The rows a document can be linked to, as options for selects and for the link texts. */
export type DocumentLinkOptions = {
	properties: LinkOption[];
	units: UnitOption[];
	leases: LinkOption[];
	tenants: LinkOption[];
	costItems: LinkOption[];
};

export type LinkKind = 'propertyId' | 'unitId' | 'leaseId' | 'tenantId' | 'costItemId';

export type DocumentLinkIds = Record<LinkKind, string | null>;

export type DocumentLink = { kind: LinkKind; label: string; href: string };

export const linkKindLabels: Record<LinkKind, string> = {
	propertyId: 'Objekt',
	unitId: 'Einheit',
	leaseId: 'Mietvertrag',
	tenantId: 'Mieter',
	costItemId: 'Beleg'
};

function option<T extends LinkOption>(list: T[], id: string | null): T | undefined {
	return id ? list.find((candidate) => candidate.id === id) : undefined;
}

/**
 * The links of a document as texts with the page they lead to, in the order property, unit,
 * lease, tenant, cost item. A link whose row is not among the options (gone, or of another
 * account) is left out; `omit` drops kinds the page already shows, such as the lease on its tab.
 */
export function describeDocumentLinks(
	document: DocumentLinkIds,
	options: DocumentLinkOptions,
	omit: LinkKind[] = []
): DocumentLink[] {
	const links: DocumentLink[] = [];
	const property = option(options.properties, document.propertyId);
	if (property && !omit.includes('propertyId')) {
		links.push({ kind: 'propertyId', label: property.label, href: `/objekte/${property.id}` });
	}
	const unit = option(options.units, document.unitId);
	if (unit && !omit.includes('unitId')) {
		links.push({
			kind: 'unitId',
			label: unit.label,
			href: `/objekte/${unit.propertyId}/einheiten/${unit.id}`
		});
	}
	const lease = option(options.leases, document.leaseId);
	if (lease && !omit.includes('leaseId')) {
		links.push({ kind: 'leaseId', label: lease.label, href: `/vertraege/${lease.id}` });
	}
	const tenant = option(options.tenants, document.tenantId);
	if (tenant && !omit.includes('tenantId')) {
		links.push({ kind: 'tenantId', label: tenant.label, href: `/mieter/${tenant.id}` });
	}
	const costItem = option(options.costItems, document.costItemId);
	if (costItem && !omit.includes('costItemId')) {
		links.push({
			kind: 'costItemId',
			label: costItem.label,
			href: `/betriebskosten/belege/${costItem.id}`
		});
	}
	return links;
}
