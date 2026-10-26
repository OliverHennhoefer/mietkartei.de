// Takes the screenshots of the README (assets/screenshots/), the homepage (website/assets/screenshots/)
// and the guides of the documentation (docs/assets/screenshots/) from a production build with the
// demo data of an empty account. Run `npm run build` first, then `npm run screenshots`. The server runs
// on a fresh database in a temporary folder; PLAYWRIGHT_CHROMIUM_PATH names another Chromium.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = 4180;
const baseURL = `http://localhost:${port}`;
const output = path.resolve(import.meta.dirname, '../../assets/screenshots');
const docsOutput = path.resolve(import.meta.dirname, '../../docs/assets/screenshots');
const websiteOutput = path.resolve(import.meta.dirname, '../../website/assets/screenshots');
// Launched first, so a missing browser fails before the server starts.
const browser = await chromium.launch(
	process.env.PLAYWRIGHT_CHROMIUM_PATH
		? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
		: {}
);
const data = mkdtempSync(path.join(tmpdir(), 'mietkartei-screenshots-'));

const server = spawn('node', ['server.js'], {
	cwd: path.resolve(import.meta.dirname, '..'),
	env: {
		...process.env,
		DATABASE_PATH: path.join(data, 'app.db'),
		DATA_DIR: path.join(data, 'documents'),
		MAIL_TRANSPORT: 'outbox',
		PORT: String(port)
	},
	stdio: 'inherit'
});

async function waitForServer() {
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			if ((await fetch(`${baseURL}/health`)).ok) return;
		} catch {
			// not listening yet
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error('The server did not start.');
}

try {
	await waitForServer();
	/** @type {import('@playwright/test').BrowserContextOptions} */
	const contextOptions = {
		baseURL,
		viewport: { width: 1280, height: 800 },
		locale: 'de-DE',
		colorScheme: 'light'
	};
	const context = await browser.newContext({ ...contextOptions, deviceScaleFactor: 2 });
	const page = await context.newPage();

	// The first visitor registers as the owner and loads the demo data into the empty account.
	await page.goto('/');
	await page.getByLabel('E-Mail-Adresse').fill('vermieterin@example.org');
	await page.getByLabel('Passwort').fill('ein-sicheres-passwort');
	await page.getByRole('button', { name: 'Konto anlegen' }).click();
	await page.waitForURL(/\/$/);
	await page.goto('/einstellungen/konto');
	await page.getByRole('button', { name: 'Demodaten anlegen' }).click();
	await page.getByRole('button', { name: 'Demodaten anlegen' }).waitFor({ state: 'detached' });

	// All screenshots have the same size, so the README can show them one below the other.
	/** @param {string} name @param {string} [url] @param {string} [folder] */
	async function shoot(name, url, folder = output) {
		if (url) await page.goto(url);
		await page.screenshot({
			path: path.join(folder, `${name}.png`),
			clip: { x: 0, y: 0, width: 1280, height: 640 }
		});
		console.log(
			path.relative(path.resolve(import.meta.dirname, '../..'), path.join(folder, `${name}.png`))
		);
	}

	// The homepage carousel: every slide has the same 1600 × 1000 pixels. A whole screen is the
	// 1280 × 800 window; a detail is a region of the page around the given elements, enlarged to the
	// same size. Each slide is taken in its own context, whose scale fits the region into the slide.
	const slideWidth = 1600;
	/**
	 * @param {string} name @param {string} url
	 * @param {string[]} [around] selectors of the elements a detail shows; none for the whole screen
	 * @param {(page: import('@playwright/test').Page) => Promise<void>} [prepare]
	 * @param {number} [screen] the window width of a whole screen
	 */
	async function shootSlide(name, url, around = [], prepare = async () => {}, screen = 1280) {
		let region = { x: 0, y: 0, width: screen, height: (screen * 5) / 8 };
		if (around.length) {
			await page.goto(url);
			await prepare(page);
			region = await page.evaluate(
				({ around, ratio }) => {
					const boxes = around.map((selector) => {
						const element = document.querySelector(selector);
						if (!element) throw new Error(`${selector} is missing.`);
						return element.getBoundingClientRect();
					});
					const pad = 24;
					const left = Math.min(...boxes.map((box) => box.left)) - pad;
					const top = Math.min(...boxes.map((box) => box.top)) - pad + window.scrollY;
					let width = Math.max(...boxes.map((box) => box.right)) + pad - left;
					let height = Math.max(...boxes.map((box) => box.bottom)) + pad + window.scrollY - top;
					// Widened or heightened to the slide's ratio around the same centre, in whole pixels.
					if (width / height < ratio) width = height * ratio;
					width = Math.ceil(width / 8) * 8;
					height = (width * 5) / 8;
					const x = (left + (Math.max(...boxes.map((box) => box.right)) + pad)) / 2 - width / 2;
					return {
						x: Math.round(x),
						y: Math.round(top),
						width: Math.round(width),
						height: Math.round(height)
					};
				},
				{ around, ratio: 1.6 }
			);
		}
		const slideContext = await browser.newContext({
			...contextOptions,
			viewport: around.length
				? contextOptions.viewport
				: { width: region.width, height: region.height },
			deviceScaleFactor: slideWidth / region.width,
			storageState: await context.storageState()
		});
		const slidePage = await slideContext.newPage();
		await slidePage.goto(url);
		await prepare(slidePage);
		await slidePage.evaluate((y) => window.scrollTo(0, y), region.y);
		const scrolled = await slidePage.evaluate(() => window.scrollY);
		const file = path.join(websiteOutput, `${name}.png`);
		await slidePage.screenshot({ path: file, clip: { ...region, y: region.y - scrolled } });
		await slideContext.close();
		console.log(path.relative(path.resolve(import.meta.dirname, '../..'), file));
	}

	// The Auswertung of the largest property in the last full year: its tabs, the figures and the
	// monthly chart in one frame. The page loses what would push the chart out of the frame: the
	// heading, the filters, the smaller figures and the notes.
	const year = new Date().getFullYear() - 1;
	await page.goto(`/auswertung?jahr=${year}`);
	const property = await page
		.locator('select[name="objekt"] option')
		.filter({ hasText: 'Lindenstraße 12' })
		.getAttribute('value');
	/** @param {import('@playwright/test').Page} page @param {number} top */
	async function focusEvaluation(page, top) {
		await page.evaluate((top) => {
			/** @param {Element | null} element */
			const hide = (element) => element instanceof HTMLElement && (element.style.display = 'none');
			const tabs = /** @type {HTMLElement} */ (document.querySelector('nav.tabs'));
			const tiles = /** @type {HTMLElement} */ (document.querySelector('ul.tiles'));
			const chart = /** @type {HTMLElement} */ (document.querySelector('#flow')?.parentElement);
			hide(document.querySelector('.page-header'));
			hide(document.querySelector('form.filters'));
			hide(document.querySelector('ul.tiles.small'));
			hide(chart.querySelector('#flow'));
			hide(chart.querySelector('.readout'));
			hide(chart.querySelector('details'));
			for (const pill of tiles.querySelectorAll('.pill')) hide(pill);
			tabs.style.marginBottom = '16px';
			tiles.style.marginBottom = '8px';
			window.scrollTo(0, tabs.getBoundingClientRect().top + window.scrollY - top);
		}, top);
	}
	await page.setViewportSize({ width: 1280, height: 640 });
	await page.goto(`/auswertung?jahr=${year}&objekt=${property}`);
	await focusEvaluation(page, 20);
	await page.screenshot({ path: path.join(output, 'auswertung.png') });
	console.log('assets/screenshots/auswertung.png');
	await page.setViewportSize({ width: 1280, height: 800 });
	await shootSlide('auswertung', `/auswertung?jahr=${year}&objekt=${property}`, [], (page) =>
		focusEvaluation(page, 40)
	);
	// Return and cash flow of the same property: its figures and the waterfall from rent to cash flow.
	await shootSlide(
		'rendite',
		`/auswertung/rendite?objekt=${property}`,
		['main ul.tiles', 'main svg'],
		async (page) => {
			await page.locator('form.filters').evaluate((form) => {
				if (form instanceof HTMLElement) form.style.visibility = 'hidden';
			});
		}
	);
	// A rent payment from a known IBAN, with the lease already suggested.
	/** @param {string} selector @param {string} text */
	const mark = (selector, text) => async (/** @type {import('@playwright/test').Page} */ page) => {
		await page
			.locator(selector)
			.filter({ hasText: text })
			.first()
			.evaluate((element) => {
				element.setAttribute('data-slide', '');
			});
	};
	await shootSlide(
		'bankumsaetze',
		'/bank',
		['[data-slide] .head', '[data-slide] button'],
		mark('li.transaction', 'Anna Schmidt')
	);

	// The guides: the bank page while its suggestions are still open, then the setup pages.
	await shoot('bankumsaetze', '/bank', docsOutput);
	await shoot('umlageschluessel', '/betriebskosten/schluessel', docsOutput);
	await shoot('datenuebernahme', '/einstellungen/datenuebernahme', docsOutput);

	// The leases in arrears, the October rent among them, whose payments still wait in the bank
	// transactions. The wider window keeps the row actions beside the reminders.
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/mietkonto?filter=rueckstaende');
	await page.screenshot({
		path: path.join(output, 'mietkonto.png'),
		clip: { x: 0, y: 0, width: 1440, height: 720 }
	});
	console.log('assets/screenshots/mietkonto.png');
	await page.setViewportSize({ width: 1280, height: 800 });
	await shootSlide('mietkonto', '/mietkonto?filter=rueckstaende', [], undefined, 1440);

	await page.goto('/betriebskosten');
	await page.getByRole('button', { name: 'Entwurf erstellen' }).click();
	await page.waitForURL(/\/betriebskosten\/abrechnungen\//);
	// One tenant's share, with the allocation key worked out per cost category, at the top below
	// the sticky header.
	const share = page.locator('section.lease').filter({ hasText: 'Anna Schmidt' });
	await share.evaluate((section) => {
		const header = document.querySelector('.site-header')?.getBoundingClientRect().height ?? 0;
		window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - header - 24);
	});
	await shoot('abrechnung-mieter');
	// The homepage shows the top of the share: the costs with their allocation keys.
	await shootSlide(
		'abrechnung-mieter',
		page.url(),
		['[data-slide] h3', '[data-slide] table tbody tr:nth-child(5)'],
		mark('section.lease', 'Anna Schmidt')
	);
	await page.evaluate(() => window.scrollTo(0, 0));
	await shoot('abrechnung-entwurf', undefined, docsOutput);
} finally {
	await browser.close();
	server.kill();
	rmSync(data, { recursive: true, force: true });
}
