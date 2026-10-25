// Takes the screenshots of the README (assets/screenshots/) and the guides of the documentation
// (docs/assets/screenshots/) from a production build with the demo
// data of an empty account. Run `npm run build` first, then `npm run screenshots`. The server runs
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
	const context = await browser.newContext({
		baseURL,
		viewport: { width: 1280, height: 800 },
		deviceScaleFactor: 2,
		locale: 'de-DE',
		colorScheme: 'light'
	});
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

	// The guides: the bank page while its suggestions are still open, then the setup pages.
	await shoot('bankumsaetze', '/bank', docsOutput);
	await shoot('umlageschluessel', '/betriebskosten/schluessel', docsOutput);
	await shoot('datenuebernahme', '/datenuebernahme', docsOutput);

	// The open rent payments of October go to their leases, so the rent ledger shows the two
	// leases really in arrears rather than every one.
	for (const [payer, lastName] of [
		['Anna Schmidt', 'Schmidt'],
		['Murat Yilmaz', 'Yılmaz']
	]) {
		await page.goto('/bank');
		const card = page.getByRole('listitem').filter({ hasText: payer });
		const lease = card.locator('select[name="leaseId"]');
		const option = await lease
			.locator('option')
			.filter({ hasText: lastName })
			.first()
			.getAttribute('value');
		await lease.selectOption(option ?? '');
		await card.getByRole('button', { name: 'Zuordnen', exact: true }).click();
		await card.waitFor({ state: 'detached' });
	}
	await shoot('uebersicht', '/');
	await shoot('mietkonto', '/mietkonto');

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
	await page.evaluate(() => window.scrollTo(0, 0));
	await shoot('abrechnung-entwurf', undefined, docsOutput);
} finally {
	await browser.close();
	server.kill();
	rmSync(data, { recursive: true, force: true });
}
