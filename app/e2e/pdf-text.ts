import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream, type PDFPage } from 'pdf-lib';

/**
 * Extracts the text of a PDF rendered by src/lib/server/pdf.ts for assertions: the strings shown
 * by the `Tj` operators of every page's content streams, one per line, decoded from WinAnsi.
 * The same approach as src/lib/server/pdf.spec.ts.
 */

// The WinAnsi block 0x80–0x9F (`?` where the encoding has no character); all other bytes are Latin-1.
const WIN_ANSI_HIGH = '€?‚ƒ„…†‡ˆ‰Š‹Œ?Ž??‘’“”•–—˜™š›œ?žŸ';

function decodeWinAnsi(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) =>
		byte >= 0x80 && byte <= 0x9f ? WIN_ANSI_HIGH[byte - 0x80] : String.fromCharCode(byte)
	).join('');
}

function pageText(page: PDFPage): string {
	const contents = page.node.Contents();
	const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
	let text = '';
	for (const ref of refs) {
		const stream = page.doc.context.lookup(ref);
		if (!(stream instanceof PDFRawStream)) continue;
		const operators = decodeWinAnsi(decodePDFRawStream(stream).decode());
		for (const [, hex] of operators.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
			const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
			text += decodeWinAnsi(bytes) + '\n';
		}
	}
	return text;
}

/** The text of all pages, in order, one drawn string per line. */
export async function pdfText(bytes: Uint8Array | ArrayBuffer): Promise<string> {
	const doc = await PDFDocument.load(bytes);
	return doc.getPages().map(pageText).join('');
}
