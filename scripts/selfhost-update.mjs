// Updates a self-hosted copy of mietkartei on Cloudflare (see docs/selbst-hosten.md) to main of
// OliverHennhoefer/mietkartei.de, which the workflow Update (.github/workflows/selfhost-update.yml)
// fetched as FETCH_HEAD. The copy takes over every file of upstream except two: its workflows,
// since the token of a workflow may not push changes to them, and its wrangler.jsonc, which keeps
// the name and the ids Cloudflare gave it but takes the rest from upstream. The push then makes
// Cloudflare build and deploy the copy.
//
// The workflow runs this file as upstream has it, so changes here reach every copy. Plain
// JavaScript without dependencies, for whatever Node.js the runner has.
import { execFileSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{ binding: string, database_id?: string, database_name?: string }} D1Database
 * @typedef {{ binding: string, bucket_name?: string, jurisdiction?: string }} R2Bucket
 * @typedef {Record<string, unknown> & { d1_databases?: D1Database[], r2_buckets?: R2Bucket[] }} WranglerConfig
 */

/**
 * Parses JSON with comments and trailing commas, as wrangler.jsonc allows.
 * @param {string} text
 * @returns {WranglerConfig}
 */
export function parseJsonc(text) {
	let json = '';
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '"') {
			const start = index;
			for (index += 1; text[index] !== '"'; index += 1) if (text[index] === '\\') index += 1;
			json += text.slice(start, index + 1);
		} else if (char === '/' && text[index + 1] === '/') {
			while (index < text.length && text[index] !== '\n') index += 1;
			json += '\n';
		} else if (char === '/' && text[index + 1] === '*') {
			index = text.indexOf('*/', index + 2) + 1;
			if (index === 0) throw new Error('Unterminated comment');
		} else {
			json += char;
		}
	}
	return JSON.parse(json.replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * The upstream config with what belongs to the copy: the Worker's name, an account id, routes
 * of its own, and the database ids and bucket names of the bindings upstream still has.
 *
 * @param {WranglerConfig} own
 * @param {WranglerConfig} upstream
 * @returns {WranglerConfig}
 */
export function mergeWranglerConfig(own, upstream) {
	const merged = structuredClone(upstream);
	for (const key of ['name', 'account_id', 'routes', 'workers_dev']) {
		if (own[key] !== undefined) merged[key] = own[key];
	}
	for (const database of merged.d1_databases ?? []) {
		const mine = own.d1_databases?.find((entry) => entry.binding === database.binding);
		if (mine?.database_id) database.database_id = mine.database_id;
		if (mine?.database_name) database.database_name = mine.database_name;
	}
	for (const bucket of merged.r2_buckets ?? []) {
		const mine = own.r2_buckets?.find((entry) => entry.binding === bucket.binding);
		if (mine?.bucket_name) bucket.bucket_name = mine.bucket_name;
		if (mine?.jurisdiction) bucket.jurisdiction = mine.jurisdiction;
	}
	return merged;
}

/** @param {string[]} args */
function git(...args) {
	return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function update() {
	const upstream = git('rev-parse', 'FETCH_HEAD').trim();
	const own = parseJsonc(git('show', 'HEAD:wrangler.jsonc'));
	git('rm', '-rq', '--', '.', ':!:.github/workflows');
	git('checkout', upstream, '--', '.', ':!:.github/workflows');
	const merged = mergeWranglerConfig(own, parseJsonc(git('show', `${upstream}:wrangler.jsonc`)));
	writeFileSync(
		'wrangler.jsonc',
		'// Written by scripts/selfhost-update.mjs: the config of mietkartei.de with the name and ids\n' +
			'// of this copy.\n' +
			`${JSON.stringify(merged, null, '\t')}\n`
	);
	git('add', '-A', '--', '.', ':!:.github/workflows');
	if (git('status', '--porcelain', '--untracked-files=no').trim() === '') {
		console.log('mietkartei ist schon auf dem neuesten Stand.');
		return;
	}
	git(
		'-c',
		'user.name=github-actions[bot]',
		'-c',
		'user.email=41898282+github-actions[bot]@users.noreply.github.com',
		'commit',
		'-qm',
		`Update to mietkartei.de ${upstream.slice(0, 7)}`
	);
	git('push', '-q', 'origin', 'HEAD');
	console.log(`mietkartei ist jetzt auf dem Stand ${upstream.slice(0, 7)}; Cloudflare baut es neu.`);
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) update();
