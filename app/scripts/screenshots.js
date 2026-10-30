// Takes the frames of the README's tour (assets/screenshots/rundgang/), the homepage (website/assets/screenshots/)
// and the guides of the documentation (docs/assets/screenshots/) from a production build with the
// demo data of an empty account. Run `npm run build` first, then `npm run screenshots`. The server runs
// on a fresh database in a temporary folder; PLAYWRIGHT_CHROMIUM_PATH names another Chromium.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = 4180;
const baseURL = `http://localhost:${port}`;
const tourOutput = path.resolve(import.meta.dirname, '../../assets/screenshots/rundgang');
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
	await page.waitForURL(/\/aufgaben$/);
	await page.goto('/einstellungen/konto');
	await page.getByRole('button', { name: 'Demodaten anlegen' }).click();
	await page.getByRole('button', { name: 'Demodaten anlegen' }).waitFor({ state: 'detached' });

	// The screenshots of the guides all have the same size.
	/** @param {string} name @param {string | undefined} url @param {string} folder */
	async function shoot(name, url, folder) {
		if (url) await page.goto(url);
		await page.screenshot({
			path: path.join(folder, `${name}.png`),
			clip: { x: 0, y: 0, width: 1280, height: 640 }
		});
		console.log(
			path.relative(path.resolve(import.meta.dirname, '../..'), path.join(folder, `${name}.png`))
		);
	}

	// The homepage screenshots: every one has the same 1600 × 1000 pixels. A whole screen is the
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
	// A rent payment from a known IBAN, with the lease already suggested: the whole card, the
	// payment on the left and its assignment on the right.
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
		['[data-slide]'],
		mark('li.transaction', 'Armin Schmidt')
	);

	// The guides: the bank page while its suggestions are still open, then the setup pages.
	await shoot('bankumsaetze', '/bank', docsOutput);
	await shoot('umlageschluessel', '/betriebskosten/schluessel', docsOutput);
	await shoot('datenuebernahme', '/einstellungen/datenuebernahme', docsOutput);

	// The leases in arrears, the October rent among them, whose payments still wait in the bank
	// transactions. The wider window keeps the row actions beside the reminders.
	await shootSlide('mietkonto', '/mietkonto?filter=rueckstaende', [], undefined, 1440);

	await page.goto('/betriebskosten');
	await page.getByRole('button', { name: 'Entwurf erstellen' }).click();
	await page.waitForURL(/\/betriebskosten\/abrechnungen\//);
	// The homepage shows the top of one tenant's share: the costs with their allocation keys.
	await shootSlide(
		'abrechnung-mieter',
		page.url(),
		['[data-slide] h3', '[data-slide] table tbody tr:nth-child(5)'],
		mark('section.lease', 'Armin Schmidt')
	);
	await page.evaluate(() => window.scrollTo(0, 0));
	await shoot('abrechnung-entwurf', undefined, docsOutput);

	// The README's tour: whole screens of the main pages in a 1440 × 900 window at twice the pixels,
	// numbered in the order of the animation that scripts/build_readme_animation.py makes of them.
	const tourContext = await browser.newContext({
		...contextOptions,
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2,
		storageState: await context.storageState()
	});
	const tourPage = await tourContext.newPage();
	/** @param {string} selector @param {string} [text] */
	const scrollTo = async (selector, text) => {
		const element = tourPage
			.locator(selector)
			.filter({ hasText: text ?? '' })
			.first();
		await element.evaluate((element) =>
			window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 24)
		);
	};
	// Nothing in a frame is cut by the window's edges: what starts above the top is blanked, and
	// whatever reaches past the bottom (rows, cards, a chart) goes from the bottom up, so tables and
	// cards close with their own border. A heading or table left without content goes too.
	function fitToWindow() {
		const main = /** @type {HTMLElement} */ (document.querySelector('main'));
		const limit = window.innerHeight - 16;
		const atomic =
			/^(TR|LI|P|H[1-6]|SVG|IMG|CANVAS|BUTTON|DETAILS|LABEL|DT|DD|A|PRE|FIGURE|SELECT|INPUT)$/;
		/** @param {Element} element */
		const shown = (element) =>
			element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
		/** @param {Element} element */
		const hide = (element) =>
			(element instanceof HTMLElement || element instanceof SVGElement) &&
			(element.style.display = 'none');
		const all = () =>
			[...main.querySelectorAll('*')].filter(
				(element) =>
					!(element.closest('svg') && element.tagName !== 'svg') &&
					!element.closest('details:not([open]) > :not(summary)') &&
					shown(element)
			);
		// The page keeps its height, so the window stays where it was scrolled to.
		main.style.minHeight = `${main.offsetHeight}px`;
		if (window.scrollY > 0) {
			const above = all().filter((element) => element.getBoundingClientRect().top < 0);
			for (const element of all()) {
				if (!(element instanceof HTMLElement)) continue;
				element.style.visibility = above.includes(element) ? 'hidden' : 'visible';
			}
		}
		for (let round = 0; round < 500; round++) {
			const past = all().filter((element) => element.getBoundingClientRect().bottom > limit);
			if (!past.length) break;
			const below = past.filter((element) => element.getBoundingClientRect().top >= limit);
			if (below.length) {
				for (const element of below) hide(element);
				continue;
			}
			const whole = past.find((element) => atomic.test(element.tagName.toUpperCase()));
			if (whole) {
				hide(whole);
				continue;
			}
			// A box whose padding alone reaches past the bottom loses its last child.
			const deepest = past.find(
				(element) => ![...element.children].some((child) => past.includes(child))
			);
			const children = [...(deepest?.children ?? [])].filter(shown);
			hide(children.length ? children[children.length - 1] : /** @type {Element} */ (deepest));
		}
		for (let round = 0; round < 10; round++) {
			const shownNow = all();
			const empty = shownNow.filter((element) => {
				if (element.tagName === 'TABLE')
					return !element.querySelector('tbody tr:not([style*="none"])');
				if (element.matches('.card, .table-wrap')) return ![...element.children].some(shown);
				if (!/^H[1-6]$/.test(element.tagName)) return false;
				const bottom = element.getBoundingClientRect().bottom;
				return !shownNow.some(
					(other) => !element.contains(other) && other.getBoundingClientRect().top >= bottom
				);
			});
			if (!empty.length) break;
			for (const element of empty) hide(element);
		}
	}
	/** @type {[string, string, () => Promise<void>][]} */
	const tour = [
		['aufgaben', '/aufgaben', async () => {}],
		['auswertung', '/auswertung?jahr=gesamt', () => scrollTo('ul.tiles')],
		['rendite', '/auswertung/rendite', () => scrollTo('ul.tiles')],
		['mietkonto', '/mietkonto', async () => {}],
		['bank', '/bank', async () => {}],
		['betriebskosten', '/betriebskosten', async () => {}],
		[
			'abrechnung',
			'/betriebskosten',
			async () => {
				await tourPage.getByRole('link', { name: 'Öffnen' }).first().click();
				await tourPage.waitForURL(/\/betriebskosten\/abrechnungen\//);
				await scrollTo('section.lease', 'Armin Schmidt');
			}
		],
		['nebenkosten', `/auswertung/nebenkosten?jahr=${year}`, () => scrollTo('ul.tiles')],
		['fristen', '/fristen', async () => {}],
		[
			'mieter',
			'/mieter',
			async () => {
				await tourPage.getByText('Lena Berger').first().click();
				await tourPage.waitForURL(/\/mieter\/.+/);
			}
		]
	];
	mkdirSync(tourOutput, { recursive: true });
	for (const [index, [name, url, prepare]] of tour.entries()) {
		await tourPage.goto(url);
		await prepare();
		await tourPage.waitForLoadState('networkidle');
		// Rows that slide in are measured where they end up.
		await tourPage.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
		await tourPage.evaluate(fitToWindow);
		const file = path.join(tourOutput, `${String(index + 1).padStart(2, '0')}-${name}.png`);
		await tourPage.screenshot({ path: file });
		console.log(path.relative(path.resolve(import.meta.dirname, '../..'), file));
	}
	await tourContext.close();
} finally {
	await browser.close();
	server.kill();
	rmSync(data, { recursive: true, force: true });
}
