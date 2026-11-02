import type { Mail } from './mail';

// The look of the account mails (registration, invitation, password reset, address change): the
// colours, type and wordmark of the app, as HTML that mail programs render, with a plain text part
// of the same content. The wordmark is text, not an image, so it shows without loading anything
// from outside: many mail programs block remote images, and the mail stays free of tracking.

export type MailContent = {
	to: string;
	subject: string;
	/** The line a mail program shows after the subject in its list. */
	preview: string;
	/** The title above the text; only in the HTML part, the subject says it in the text part. */
	heading: string;
	/** Paragraphs of the text, the first is usually "Hallo,". Plain text, escaped here. */
	paragraphs: string[];
	/** The one thing the mail asks for, as a button with its link and how long that link works. */
	action?: { label: string; url: string; validity: string };
	/** The quieter closing line, e.g. what to do if the mail was not expected. */
	note?: string;
};

/** The line under every mail. It names no address, so it holds for self-hosted instances too. */
export const MAIL_FOOTER = 'mietkartei · Open-Source-Hausverwaltung für Privatvermieter';

/** The colours of app.css, light and dark. The neon of the logo stays the same in both. */
const light = {
	page: '#f7f7f7',
	card: '#ffffff',
	border: '#e8e8e8',
	text: '#202020',
	muted: '#6b6b6b',
	button: '#202020',
	buttonText: '#ffffff'
};
const dark = {
	page: '#161719',
	card: '#242529',
	border: '#36383d',
	text: '#ececee',
	muted: '#a2a4aa',
	button: '#ececee',
	buttonText: '#1b1c1f'
};
const NEON = '#f5ff00';
const FONT = "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** The mail with both parts, built from the same content. */
export function layoutMail(content: MailContent): Mail {
	return {
		to: content.to,
		subject: content.subject,
		text: mailText(content),
		html: mailHtml(content)
	};
}

function mailText({ paragraphs, action, note }: MailContent): string {
	const blocks = [
		...paragraphs,
		...(action ? [`${action.label}:\n${action.url}`, action.validity] : []),
		...(note ? [note] : []),
		// "-- " is the signature delimiter mail programs recognise.
		`-- \n${MAIL_FOOTER}`
	];
	return `${blocks.join('\n\n')}\n`;
}

const DARK_STYLES = `
	:root { color-scheme: light dark; supported-color-schemes: light dark; }
	@media (prefers-color-scheme: dark) {
		.mk-page { background-color: ${dark.page} !important; }
		.mk-card { background-color: ${dark.card} !important; border-color: ${dark.border} !important; }
		.mk-text { color: ${dark.text} !important; }
		.mk-muted, .mk-muted a { color: ${dark.muted} !important; }
		.mk-rule { border-color: ${dark.border} !important; }
		.mk-button { background-color: ${dark.button} !important; }
		.mk-button a { color: ${dark.buttonText} !important; }
	}
	[data-ogsc] .mk-text { color: ${dark.text} !important; }
	[data-ogsc] .mk-muted, [data-ogsc] .mk-muted a { color: ${dark.muted} !important; }
	[data-ogsc] .mk-button a { color: ${dark.buttonText} !important; }
	[data-ogsb] .mk-page { background-color: ${dark.page} !important; }
	[data-ogsb] .mk-card { background-color: ${dark.card} !important; }
	[data-ogsb] .mk-button { background-color: ${dark.button} !important; }
	@media (max-width: 600px) {
		.mk-outer { padding: 16px 8px !important; }
		.mk-inner { padding: 28px 22px !important; }
		.mk-heading { font-size: 22px !important; }
	}
`;

function mailHtml({ subject, preview, heading, paragraphs, action, note }: MailContent): string {
	const paragraph = (text: string) =>
		`<p class="mk-text" style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${light.text};">${escapeHtml(text)}</p>`;
	const button = action
		? `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px;">
	<tr>
		<td class="mk-button" bgcolor="${light.button}" style="border-radius:10px;background-color:${light.button};mso-padding-alt:14px 24px;">
			<a href="${escapeHtml(action.url)}" target="_blank" style="display:inline-block;padding:14px 24px;font-family:${FONT};font-size:16px;font-weight:600;line-height:20px;color:${light.buttonText};text-decoration:none;border-radius:10px;">${escapeHtml(action.label)}&nbsp;&nbsp;&rarr;</a>
		</td>
	</tr>
</table>
<p class="mk-muted" style="margin:0 0 24px;font-size:14px;line-height:1.5;color:${light.muted};">${escapeHtml(action.validity)}</p>
<p class="mk-muted" style="margin:0;font-size:13px;line-height:1.5;color:${light.muted};">Falls der Knopf nicht funktioniert, kopiere diesen Link in deinen Browser:<br><a href="${escapeHtml(action.url)}" target="_blank" style="color:${light.muted};text-decoration:underline;word-break:break-all;">${escapeHtml(action.url)}</a></p>`
		: '';
	const closing = note
		? `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
	<tr><td class="mk-rule" style="border-top:1px solid ${light.border};font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
<p class="mk-muted" style="margin:20px 0 0;font-size:14px;line-height:1.5;color:${light.muted};">${escapeHtml(note)}</p>`
		: '';
	// Filler after the preview, so the list does not run on into the text of the mail.
	const filler = '&#847;&zwnj;&nbsp;'.repeat(60);
	return `<!doctype html>
<html lang="de" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>${DARK_STYLES}</style>
</head>
<body class="mk-page" style="margin:0;padding:0;background-color:${light.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preview)}${filler}</div>
<table role="presentation" class="mk-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${light.page}" style="background-color:${light.page};">
	<tr>
		<td class="mk-outer" align="center" style="padding:40px 16px;font-family:${FONT};">
			<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
				<tr>
					<td style="padding:0 4px 20px;">
						<span class="mk-text" style="font-family:${FONT};font-size:22px;font-weight:600;letter-spacing:-0.02em;line-height:30px;color:${light.text};">miet<span style="display:inline-block;padding:0 3px;background-color:${NEON};color:#000000;">kartei</span></span>
					</td>
				</tr>
				<tr>
					<td class="mk-card mk-inner" bgcolor="${light.card}" style="padding:36px 40px;background-color:${light.card};border:1px solid ${light.border};border-radius:14px;font-family:${FONT};">
						<h1 class="mk-text mk-heading" style="margin:0 0 20px;font-size:24px;font-weight:600;letter-spacing:-0.01em;line-height:1.3;color:${light.text};">${escapeHtml(heading)}</h1>
						${paragraphs.map(paragraph).join('\n\t\t\t\t\t\t')}
						${button}
						${closing}
					</td>
				</tr>
				<tr>
					<td class="mk-muted" style="padding:20px 4px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${light.muted};">${escapeHtml(MAIL_FOOTER)}</td>
				</tr>
			</table>
		</td>
	</tr>
</table>
</body>
</html>
`;
}
