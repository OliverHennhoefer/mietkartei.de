import { afterEach, describe, expect, it, vi } from 'vitest';
import { statementFilename, statementLetter } from '../lib/domain/statement-letter';
import { computeTool, newToolState } from '../lib/domain/statement-tool';
import { download, downloadAll, downloadLetter } from './files';

const today = '2026-03-01';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

/** A document that records what the tool offers for download. */
function fakeDocument() {
	const downloads: { name: string; blob: Blob }[] = [];
	const blobs = new Map<string, Blob>();
	vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
		const url = `blob:${blobs.size}`;
		blobs.set(url, blob as Blob);
		return url;
	});
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void blobs.delete(url));
	vi.stubGlobal('document', {
		createElement: () => {
			const link = {
				href: '',
				download: '',
				click: () => downloads.push({ name: link.download, blob: blobs.get(link.href)! }),
				remove: () => undefined
			};
			return link;
		},
		body: { append: () => undefined }
	});
	return downloads;
}

function statement() {
	const state = newToolState(today);
	state.landlord.name = 'Eva Beispiel';
	state.property = { name: '', street: 'Gartenweg 5', postalCode: '04109', city: 'Leipzig' };
	state.units[0].area = '60';
	state.units[0].tenancies[0].lastName = 'Erdmann';
	state.items[0].amount = '1000';
	return computeTool(state, today).statement!;
}

describe('files', () => {
	it('offers text as a download and frees it afterwards', async () => {
		vi.useFakeTimers();
		const downloads = fakeDocument();
		download('{}', 'Abrechnung.json', 'application/json');
		expect(downloads[0].name).toBe('Abrechnung.json');
		expect(await downloads[0].blob.text()).toBe('{}');
		vi.runAllTimers();
	});

	it('offers the letter of one tenant and all letters in one PDF', async () => {
		const downloads = fakeDocument();
		const { leases } = statement();
		const letters = leases.map((lease) => statementLetter(lease, { prepayments: 'entered' }));
		await downloadLetter(letters[0], statementFilename(leases[0]));
		await downloadAll(letters, 'alle.pdf');
		expect(downloads.map((entry) => entry.name)).toEqual([
			'Betriebskostenabrechnung 2025 Wohnung 1.pdf',
			'alle.pdf'
		]);
		for (const entry of downloads) {
			expect(entry.blob.type).toBe('application/pdf');
			expect(await entry.blob.slice(0, 5).text()).toBe('%PDF-');
		}
	});
});
