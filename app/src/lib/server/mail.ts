import { MAIL_API_KEY, MAIL_FROM, MAIL_TRANSPORT } from '$app/env/private';
import type { Database } from './db';
import { outbox } from './db/schema';

// Mails are German, with a plain text part and, for the account mails, an HTML part laid out by
// mail-layout.ts. The transport is chosen by MAIL_TRANSPORT, see env.ts.

export type Mail = { to: string; subject: string; text: string; html?: string };

export async function sendMail(db: Database, mail: Mail): Promise<void> {
	switch (MAIL_TRANSPORT) {
		case 'resend': {
			const response = await fetch('https://api.resend.com/emails', {
				method: 'POST',
				headers: { authorization: `Bearer ${MAIL_API_KEY}`, 'content-type': 'application/json' },
				body: JSON.stringify({
					from: MAIL_FROM,
					to: [mail.to],
					subject: mail.subject,
					text: mail.text,
					...(mail.html ? { html: mail.html } : {})
				})
			});
			if (!response.ok) {
				throw new Error(`Mail provider answered ${response.status}: ${await response.text()}`);
			}
			return;
		}
		case 'outbox':
			// The end-to-end tests read the links from the text part.
			await db.insert(outbox).values({ to: mail.to, subject: mail.subject, text: mail.text });
			return;
		case 'console':
			// The links in the mails sign people in; the hosted variant must not log them.
			if (__DEPLOY_TARGET__ === 'cloudflare') {
				throw new Error('MAIL_TRANSPORT=console is refused on the cloudflare target');
			}
			console.log(`[mail] to ${mail.to}\nsubject: ${mail.subject}\n\n${mail.text}\n`);
	}
}

/**
 * Sends the mail without making the response wait for it. A failure is logged, never answered,
 * so a form that sends mail for some addresses only answers the same for every address.
 * `onFailure` then withdraws what the mail was for, e.g. the request behind its link.
 */
export async function sendMailInBackground(
	db: Database,
	mail: Mail,
	onFailure?: () => Promise<void>
): Promise<void> {
	const sending = sendMail(db, mail).catch(async (error: unknown) => {
		console.error(`[mail] "${mail.subject}" was not sent:`, error);
		await onFailure?.().catch((cleanup: unknown) =>
			console.error('[mail] Cleanup failed:', cleanup)
		);
	});
	// Workers stop a request's work with the response unless told to wait for it.
	if (__DEPLOY_TARGET__ === 'cloudflare') {
		const { waitUntil } = await import('cloudflare:workers');
		waitUntil(sending);
	}
}
