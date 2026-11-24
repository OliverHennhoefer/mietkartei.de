import { statementFilename, statementLetter } from '../lib/domain/statement-letter';
import type { LeaseStatement } from '../lib/domain/statement';

// What the tool hands the browser: the letters as PDF and the saved state as a file. pdf-lib is
// the largest part of the tool, so this module is loaded only when a PDF is asked for.

/** Offers bytes as a download under the file name. */
export function download(bytes: Uint8Array | string, filename: string, type: string): void {
	const blob = new Blob([bytes as BlobPart], { type });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The letter of one tenant, exactly as the app prints it. */
export async function downloadLetter(lease: LeaseStatement): Promise<void> {
	const { renderLetter } = await import('../lib/server/pdf');
	const bytes = await renderLetter(statementLetter(lease, { prepayments: 'entered' }));
	download(bytes, statementFilename(lease), 'application/pdf');
}

/** All letters in one PDF, one after the other, for printing them in one go. */
export async function downloadAll(leases: LeaseStatement[], filename: string): Promise<void> {
	const [{ renderLetter }, { PDFDocument }] = await Promise.all([
		import('../lib/server/pdf'),
		import('pdf-lib')
	]);
	const all = await PDFDocument.create();
	all.setTitle(filename.replace(/\.pdf$/, ''));
	all.setLanguage('de-DE');
	all.setCreator('mietkartei');
	all.setProducer('mietkartei');
	for (const lease of leases) {
		const letter = await PDFDocument.load(
			await renderLetter(statementLetter(lease, { prepayments: 'entered' }))
		);
		const pages = await all.copyPages(letter, letter.getPageIndices());
		for (const page of pages) all.addPage(page);
	}
	download(await all.save(), filename, 'application/pdf');
}
