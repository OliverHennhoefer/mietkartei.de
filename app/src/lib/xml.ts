// A small XML reader for the bank import's camt files. Neither Node nor Cloudflare Workers ship a
// DOMParser, and camt needs no more than elements, attributes and text: namespace prefixes are
// dropped, comments, processing instructions and CDATA are handled, a DOCTYPE is refused (no
// entity definitions, so no entity expansion to defend against).

export type XmlElement = {
	/** The local name, without a namespace prefix: `camt:Ntry` → `Ntry`. */
	name: string;
	attributes: Record<string, string>;
	children: XmlElement[];
	/** The element's own text, entities decoded, not trimmed. */
	text: string;
};

export class XmlError extends Error {}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'"
};

function decodeEntities(value: string): string {
	return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, entity: string) => {
		if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
		if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
		return NAMED_ENTITIES[entity] ?? whole;
	});
}

function localName(name: string): string {
	const colon = name.indexOf(':');
	return colon >= 0 ? name.slice(colon + 1) : name;
}

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The text of an XML document → its root element; throws XmlError on malformed markup. */
export function parseXml(text: string): XmlElement {
	const stack: XmlElement[] = [];
	let root: XmlElement | undefined;
	let position = 0;

	const appendText = (value: string) => {
		const current = stack.at(-1);
		if (current) current.text += value;
		else if (value.trim() !== '') throw new XmlError('Text außerhalb des Wurzelelements');
	};

	while (position < text.length) {
		const open = text.indexOf('<', position);
		if (open < 0) {
			appendText(decodeEntities(text.slice(position)));
			break;
		}
		if (open > position) appendText(decodeEntities(text.slice(position, open)));

		if (text.startsWith('<!--', open)) {
			const end = text.indexOf('-->', open + 4);
			if (end < 0) throw new XmlError('Kommentar ohne Ende');
			position = end + 3;
		} else if (text.startsWith('<![CDATA[', open)) {
			const end = text.indexOf(']]>', open + 9);
			if (end < 0) throw new XmlError('CDATA ohne Ende');
			appendText(text.slice(open + 9, end));
			position = end + 3;
		} else if (text.startsWith('<?', open)) {
			const end = text.indexOf('?>', open + 2);
			if (end < 0) throw new XmlError('Verarbeitungsanweisung ohne Ende');
			position = end + 2;
		} else if (text.startsWith('<!', open)) {
			throw new XmlError('DOCTYPE wird nicht unterstützt');
		} else if (text.startsWith('</', open)) {
			const end = text.indexOf('>', open);
			if (end < 0) throw new XmlError('Endtag ohne Ende');
			const name = localName(text.slice(open + 2, end).trim());
			const current = stack.pop();
			if (!current || current.name !== name) throw new XmlError(`Unerwartetes Endtag </${name}>`);
			position = end + 1;
		} else {
			const end = text.indexOf('>', open);
			if (end < 0) throw new XmlError('Starttag ohne Ende');
			const selfClosing = text[end - 1] === '/';
			const inner = text.slice(open + 1, selfClosing ? end - 1 : end);
			const nameEnd = inner.search(/[\s/]|$/);
			const element: XmlElement = {
				name: localName(inner.slice(0, nameEnd)),
				attributes: {},
				children: [],
				text: ''
			};
			if (!element.name) throw new XmlError('Element ohne Namen');
			for (const match of inner.slice(nameEnd).matchAll(ATTRIBUTE)) {
				element.attributes[localName(match[1])] = decodeEntities(match[2] ?? match[3]);
			}
			const parent = stack.at(-1);
			if (parent) parent.children.push(element);
			else if (root) throw new XmlError('Mehr als ein Wurzelelement');
			else root = element;
			if (!selfClosing) stack.push(element);
			position = end + 1;
		}
	}

	if (stack.length > 0) throw new XmlError(`Element <${stack.at(-1)!.name}> ohne Endtag`);
	if (!root) throw new XmlError('Kein Element');
	return root;
}

/** The first child with this local name, following a path: `child(entry, 'BookgDt', 'Dt')`. */
export function child(element: XmlElement | undefined, ...path: string[]): XmlElement | undefined {
	let current = element;
	for (const name of path) {
		current = current?.children.find((candidate) => candidate.name === name);
	}
	return current;
}

/** Every child with this local name. */
export function children(element: XmlElement | undefined, name: string): XmlElement[] {
	return element?.children.filter((candidate) => candidate.name === name) ?? [];
}

/** The trimmed text at the path, '' when the element is missing. */
export function textAt(element: XmlElement | undefined, ...path: string[]): string {
	return child(element, ...path)?.text.trim() ?? '';
}
