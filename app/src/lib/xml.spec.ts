import { describe, expect, it } from 'vitest';
import { child, children, parseXml, textAt, XmlError } from './xml';

describe('parseXml', () => {
	it('reads elements, attributes and text, without namespace prefixes', () => {
		const root = parseXml(
			`<?xml version="1.0" encoding="UTF-8"?>
			<!-- a comment -->
			<ns:Document xmlns:ns="urn:x"><ns:Amt Ccy='EUR'>850.00</ns:Amt><Empty/><Empty a="1" /></ns:Document>`
		);
		expect(root.name).toBe('Document');
		expect(child(root, 'Amt')?.attributes).toEqual({ Ccy: 'EUR' });
		expect(textAt(root, 'Amt')).toBe('850.00');
		expect(children(root, 'Empty').map((element) => element.attributes)).toEqual([{}, { a: '1' }]);
	});

	it('decodes entities and keeps CDATA as it is', () => {
		const root = parseXml(
			'<a><b>M&amp;M &lt;GmbH&gt; &#252;&#xFC; &quot;x&apos;</b><c><![CDATA[<raw> &amp;]]></c></a>'
		);
		expect(textAt(root, 'b')).toBe('M&M <GmbH> üü "x\'');
		expect(textAt(root, 'c')).toBe('<raw> &amp;');
	});

	it('follows paths and answers empty for missing elements', () => {
		const root = parseXml('<a><b><c>1</c></b></a>');
		expect(textAt(root, 'b', 'c')).toBe('1');
		expect(textAt(root, 'b', 'x')).toBe('');
		expect(child(root, 'x', 'c')).toBeUndefined();
	});

	it('refuses malformed markup and a DOCTYPE', () => {
		for (const text of [
			'<a><b></a>',
			'<a>',
			'<a/><b/>',
			'text',
			'',
			'<!DOCTYPE a [<!ENTITY x "y">]><a/>'
		]) {
			expect(() => parseXml(text), text).toThrow(XmlError);
		}
	});
});
