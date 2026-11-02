import { describe, expect, it } from 'vitest';
import { invitationMail } from './invitations';
import { escapeHtml, layoutMail, MAIL_FOOTER } from './mail-layout';

const content = {
	to: 'a@example.org',
	subject: 'Betreff | mietkartei',
	preview: 'Kurz gesagt',
	heading: 'Überschrift',
	paragraphs: ['Hallo,', 'erster Absatz.'],
	action: {
		label: 'Weiter',
		url: 'https://app.example/weg/t0k?a=1&b=2',
		validity: 'Der Link gilt einen Tag.'
	},
	note: 'Wenn du das nicht warst, ignoriere die E-Mail.'
};

describe('layoutMail', () => {
	it('writes the same content into the text part, with the link on its own line', () => {
		const mail = layoutMail(content);
		expect(mail.to).toBe('a@example.org');
		expect(mail.subject).toBe('Betreff | mietkartei');
		expect(mail.text).toBe(
			'Hallo,\n\nerster Absatz.\n\nWeiter:\nhttps://app.example/weg/t0k?a=1&b=2\n\n' +
				'Der Link gilt einen Tag.\n\nWenn du das nicht warst, ignoriere die E-Mail.\n\n' +
				`-- \n${MAIL_FOOTER}\n`
		);
	});

	it('lays out the HTML part with heading, preview, button and the link to copy', () => {
		const { html } = layoutMail(content);
		expect(html).toMatch(/^<!doctype html>/);
		expect(html).toContain('<html lang="de"');
		expect(html).toContain('<meta name="color-scheme" content="light dark">');
		expect(html).toContain('prefers-color-scheme: dark');
		expect(html).toContain('>Überschrift</h1>');
		expect(html).toContain('Kurz gesagt');
		// The button and the copyable fallback carry the same, escaped link.
		expect(html?.match(/href="https:\/\/app\.example\/weg\/t0k\?a=1&amp;b=2"/g)).toHaveLength(2);
		expect(html).toContain('Weiter&nbsp;&nbsp;&rarr;</a>');
		expect(html).toContain('Der Link gilt einen Tag.');
		expect(html).toContain('Wenn du das nicht warst, ignoriere die E-Mail.');
		// The wordmark is text on the neon of the logo, nothing loaded from outside.
		expect(html).toContain('#f5ff00');
		expect(html).not.toMatch(/<img|url\(/);
	});

	it('leaves out button and note when the mail has none', () => {
		const mail = layoutMail({ ...content, action: undefined, note: undefined });
		expect(mail.text).toBe(`Hallo,\n\nerster Absatz.\n\n-- \n${MAIL_FOOTER}\n`);
		expect(mail.html).not.toContain('<a ');
		expect(mail.html).not.toContain('class="mk-rule"');
	});

	it('escapes everything it prints into the HTML part', () => {
		const { html } = layoutMail({
			...content,
			subject: '<b>Betreff</b>',
			heading: 'A & B',
			paragraphs: ['<script>alert(1)</script>'],
			note: '"zitiert" & \'einfach\''
		});
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('<b>');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).toContain('>A &amp; B</h1>');
		expect(html).toContain('&quot;zitiert&quot; &amp; &#39;einfach&#39;');
	});

	it('escapes the name an inviter typed into their profile', () => {
		const { html } = invitationMail(
			'neu@example.org',
			'https://app.example/einladung/t0k',
			'<img src=x onerror=alert(1)> Erika',
			'manager'
		);
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; Erika lädt dich ein');
	});
});

describe('escapeHtml', () => {
	it('replaces the five characters that HTML gives a meaning', () => {
		expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
			'&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
		);
	});
});
