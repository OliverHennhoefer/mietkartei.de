import { encode } from 'uqr';

// A QR code as one SVG path, for links a landlord prints or shows on screen (the Mieterportal).

/** The dark modules of the code as one SVG path in module units, with its size in modules. */
export function qrPath(text: string): { size: number; path: string } {
	const modules = encode(text, { ecc: 'M', border: 0 }).data;
	const runs: string[] = [];
	modules.forEach((row, y) => {
		let x = 0;
		while (x < row.length) {
			if (!row[x]) {
				x++;
				continue;
			}
			const start = x;
			while (x < row.length && row[x]) x++;
			runs.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
		}
	});
	return { size: modules.length, path: runs.join('') };
}
