import { readdirSync, readFileSync } from 'node:fs';
import { parse, type AST } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

// A link to a page that does not exist only shows when someone clicks it. The lint rule
// svelte/no-navigation-without-resolve leaves links alone (see eslint.config.js), and a path in a
// string has no type. So this test collects every path the source spells out (in the markup, in
// the data of the navigation and the hints, in redirects and in the links of mails) and looks for
// its page or endpoint under src/routes.

/** Stands for a part only known at runtime, like the id in `/objekte/{property.id}`. */
const UNKNOWN = '*';

function filesIn(folder: string): string[] {
	return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? filesIn(`${folder}/${entry.name}`) : [`${folder}/${entry.name}`]
	);
}

/**
 * The paths a folder under src/routes answers: `/objekte/[id]/(tabs)/steuer` answers
 * `/objekte/x/steuer`. scripts/check_references.py reads the folders by the same rules.
 */
function routePattern(folder: string): RegExp {
	const pattern = folder
		.split('/')
		.filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment))
		.map((segment) => {
			if (/^\[\.\.\..+\]$/.test(segment)) return '(?:/.*)?';
			if (/^\[\[.+\]\]$/.test(segment)) return '(?:/[^/]+)?';
			const parts = segment.split(/(\[[^\]]+\])/);
			const literal = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			return `/${parts.map((part) => (part.startsWith('[') ? '[^/]+' : literal(part))).join('')}`;
		})
		.join('');
	return new RegExp(`^${pattern || '/'}$`);
}

/** The text of an attribute in the markup, with UNKNOWN for every part that is code. */
function attributeText(value: AST.Attribute['value']): string {
	if (value === true) return '';
	return (Array.isArray(value) ? value : [value])
		.map((part) => {
			if (part.type === 'Text') return part.data;
			const { expression } = part;
			if (expression.type === 'Literal' && typeof expression.value === 'string') {
				return expression.value;
			}
			if (expression.type === 'TemplateLiteral') {
				return expression.quasis.map((quasi) => quasi.value.cooked ?? '').join(UNKNOWN);
			}
			return UNKNOWN;
		})
		.join('');
}

/** Every attribute of every element and component below `node`. */
function attributesIn(node: unknown): AST.Attribute[] {
	if (Array.isArray(node)) return node.flatMap(attributesIn);
	if (node === null || typeof node !== 'object') return [];
	if ('type' in node && node.type === 'Attribute') return [node as AST.Attribute];
	return Object.values(node).flatMap(attributesIn);
}

/**
 * The paths in the markup of a component: whatever an attribute starts with a slash for, on
 * elements (`href`, `action`) and on components (`href`, `close`, `cancelHref`).
 */
function markupLinks(source: string): string[] {
	return attributesIn(parse(source, { modern: true }).fragment)
		.map((attribute) => attributeText(attribute.value))
		.filter((text) => /^\/(?!\/)/.test(text));
}

/** The source with UNKNOWN in place of every `${…}`, innermost first. */
function withoutInterpolations(source: string): string {
	let text = source;
	for (let before = ''; before !== text;) {
		before = text;
		text = text.replace(/\$\{[^{}]*\}/g, UNKNOWN);
	}
	return text;
}

/**
 * The paths in code: the target of a redirect, an `href` in data, and what follows the origin in
 * an absolute address, as the mails and the OAuth metadata build them.
 */
function scriptLinks(source: string): string[] {
	const text = withoutInterpolations(source);
	return [
		...text.matchAll(/\bredirect\(\s*30\d\s*,\s*(['"`])(\/[^'"`\n]*)\1/g),
		...text.matchAll(/\bhref\s*:\s*(['"`])(\/[^'"`\n]*)\1/g)
	]
		.map((match) => match[2])
		.concat(
			[...source.matchAll(/\$\{[\w.]*[oO]rigin\}(\/(?:[\w\-./]|\$\{[^{}]*\})*)/g)].map((match) =>
				withoutInterpolations(match[1]).replace(/\.$/, '')
			)
		);
}

/**
 * One path the link can lead to: without query and fragment, with "x" for an unknown segment,
 * also after a closing slash, where the code appends one.
 */
function samplePath(link: string): string {
	const [path] = link.split(/[?#]/);
	const segments = path.split('/').map((segment, index, all) => {
		if (segment === UNKNOWN || (segment === '' && index === all.length - 1 && index > 1)) {
			return 'x';
		}
		return segment.replaceAll(UNKNOWN, '');
	});
	return segments.join('/');
}

const sources = filesIn('src').filter(
	(file) => /\.(svelte|ts|js)$/.test(file) && !/\.spec\.ts$/.test(file)
);
const routes = sources
	.filter((file) => /^src\/routes\/(.*\/)?\+(page|server)[^/]*$/.test(file))
	.map((file) => routePattern(file.slice('src/routes'.length, file.lastIndexOf('/'))));

function hasPage(link: string): boolean {
	const path = samplePath(link);
	return routes.some((route) => route.test(path));
}

describe('the paths in the source', () => {
	it('are read from markup, data, redirects and absolute addresses', () => {
		expect(
			markupLinks(
				'<a href="/objekte/{id}/steuer/pdf{query}">PDF</a>' +
					'<a href={`/mieter/${tenant.id}`}>Mieter</a>' +
					'<a href="https://example.org/">Quelle</a><a href="?jahr=2025">2025</a>' +
					'<form method="post" action="/hinweise"></form>' +
					'<EditDialog close="/bank/konten" title="Konto" />'
			)
		).toEqual(['/objekte/*/steuer/pdf*', '/mieter/*', '/hinweise', '/bank/konten']);
		expect(
			scriptLinks(
				"redirect(303, `/vertraege/${lease.id}/kaution`); redirect(303, '/einladung/' + token);" +
					"const items = [{ href: '/bank/regeln', label: 'Regeln' }];" +
					'const text = `Abbestellen: ${origin}/einstellungen/benachrichtigungen.`;' +
					'const link = `${url.origin}/registrieren/${token}?neu=${fresh ? `${1}` : 0}`;'
			)
		).toEqual([
			'/vertraege/*/kaution',
			'/einladung/',
			'/bank/regeln',
			'/einstellungen/benachrichtigungen',
			'/registrieren/*'
		]);
	});

	it('are matched against the folders of src/routes', () => {
		const route = routePattern('/objekte/[id]/(tabs)/steuer/[[jahr]]');
		expect(route.test(samplePath('/objekte/*/steuer?jahr=2025'))).toBe(true);
		expect(route.test(samplePath('/objekte/*/steuer/*#summe'))).toBe(true);
		expect(route.test(samplePath('/objekte/*/steuern'))).toBe(false);
		expect(routePattern('/api/v1/[...path]').test(samplePath('/api/v1*'))).toBe(true);
		expect(routePattern('/einladung/[token]').test(samplePath('/einladung/'))).toBe(true);
		expect(routePattern('').test(samplePath('/'))).toBe(true);
		expect(hasPage('/betriebskosten')).toBe(true);
		expect(hasPage('/diese-seite-gibt-es-nicht')).toBe(false);
	});

	it('all lead to a page or an endpoint', () => {
		const links = sources.flatMap((file) => {
			const source = readFileSync(file, 'utf8');
			const found = file.endsWith('.svelte')
				? [...markupLinks(source), ...scriptLinks(source)]
				: scriptLinks(source);
			return found.map((link) => ({ file, link }));
		});
		// A change that makes the search above find nothing must not pass as "no broken link".
		expect(links.length).toBeGreaterThan(300);
		expect(links.filter(({ link }) => !hasPage(link))).toEqual([]);
	});
});
