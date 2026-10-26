// Renders the link preview images from the brand assets and the app screenshots: the Open Graph
// image of the websites (website/assets/social.png, 1200×630) and the GitHub social preview
// (assets/social-preview.png, 1280×640, uploaded by hand in the repository settings). Run
// `npm run social-images` after the screenshots or the brand change; PLAYWRIGHT_CHROMIUM_PATH
// names another Chromium.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../..');
const file = (relative) => pathToFileURL(path.join(root, relative)).href;

const images = [
	{
		output: 'website/assets/social.png',
		width: 1200,
		height: 630,
		footer: '<strong>mietkartei.de</strong> · Open Source · Daten in der EU'
	},
	{
		output: 'assets/social-preview.png',
		width: 1280,
		height: 640,
		footer: '<strong>Open Source</strong> · AGPL-3.0 · app.mietkartei.de'
	}
];

const page = ({ width, height, footer }) => `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<style>
	@font-face { font-family: Geist; src: url("${file('assets/brand/fonts/geist/Geist.ttf')}"); font-weight: 100 900; }
	* { box-sizing: border-box; }
	html, body { margin: 0; }
	body {
		position: relative; width: ${width}px; height: ${height}px; overflow: hidden;
		background: #fff; color: #202020; font-family: Geist, sans-serif;
		-webkit-font-smoothing: antialiased; font-synthesis: none;
	}
	.copy { position: absolute; left: 72px; top: 64px; bottom: 60px; width: 560px; display: flex; flex-direction: column; }
	.lockup { display: block; height: 58px; width: auto; align-self: flex-start; }
	h1 { margin: auto 0 0; font-size: 84px; font-weight: 500; letter-spacing: -.055em; line-height: 1.02; }
	p { margin: 26px 0 auto; font-size: 27px; line-height: 1.42; letter-spacing: -.015em; }
	mark { padding: .02em .12em; margin-inline: -.12em; background: #F5FF00; color: #000; font-weight: 600; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
	.footer { font-size: 20px; color: #6b6b6b; letter-spacing: -.01em; }
	.footer strong { color: #202020; font-weight: 600; }
	.shot { position: absolute; display: block; height: auto; border: 1px solid #e8e8e8; background: #fff; }
	/* The Auswertung without the app's sidebar, so its figures and chart fill the visible part. */
	.main { left: ${width - 560}px; top: 92px; width: 760px; height: 600px; overflow: hidden; border-radius: 14px; box-shadow: 0 1px 2px rgb(0 0 0 / .04), 0 28px 56px -18px rgb(0 0 0 / .18); }
	.main img { display: block; width: 957px; margin-left: -197px; }
</style>
</head>
<body>
	<div class="shot main"><img src="${file('website/assets/screenshots/auswertung.png')}" alt=""></div>
	<div class="copy">
		<img class="lockup" src="${file('assets/brand/lockup-highlight.svg')}" alt="">
		<h1>Vermieten.<br>Mit Überblick.</h1>
		<p>Mieten, Bankumsätze und<br><mark>die Betriebskostenabrechnung<br>ohne Excel&#8209;Chaos</mark> für private Vermieter.</p>
		<div class="footer">${footer}</div>
	</div>
</body>
</html>`;

const browser = await chromium.launch(
	process.env.PLAYWRIGHT_CHROMIUM_PATH
		? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
		: {}
);
// A file page, so the template may load the fonts and images from the repository.
const folder = mkdtempSync(path.join(tmpdir(), 'mietkartei-social-'));
try {
	for (const image of images) {
		const tab = await browser.newPage({ viewport: { width: image.width, height: image.height } });
		const html = path.join(folder, 'image.html');
		writeFileSync(html, page(image));
		await tab.goto(pathToFileURL(html).href, { waitUntil: 'load' });
		await tab.evaluate(() => document.fonts.ready);
		await tab.screenshot({ path: path.join(root, image.output) });
		await tab.close();
		console.log(`${image.output} (${image.width}×${image.height})`);
	}
} finally {
	await browser.close();
	rmSync(folder, { recursive: true, force: true });
}
