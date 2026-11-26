import type { Letter } from '../lib/domain/letters';

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

/** The letter of one tenant, as the app prints it with the landlord's wording. */
export async function downloadLetter(letter: Letter, filename: string): Promise<void> {
	const { renderLetter } = await import('../lib/server/pdf');
	download(await renderLetter(letter), filename, 'application/pdf');
}

/** All letters in one PDF, one after the other, for printing them in one go. */
export async function downloadAll(letters: Letter[], filename: string): Promise<void> {
	const [{ renderLetter }, { PDFDocument }] = await Promise.all([
		import('../lib/server/pdf'),
		import('pdf-lib')
	]);
	const all = await PDFDocument.create();
	all.setTitle(filename.replace(/\.pdf$/, ''));
	all.setLanguage('de-DE');
	all.setCreator('mietkartei');
	all.setProducer('mietkartei');
	for (const letter of letters) {
		const rendered = await PDFDocument.load(await renderLetter(letter));
		const pages = await all.copyPages(rendered, rendered.getPageIndices());
		for (const page of pages) all.addPage(page);
	}
	download(await all.save(), filename, 'application/pdf');
}
