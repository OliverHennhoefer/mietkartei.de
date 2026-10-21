import { MAIL_API_KEY, MAIL_FROM, MAIL_TRANSPORT } from '$app/env/private';
import type { Database } from './db';
import { outbox } from './db/schema';

// Mails are plain text and German. The transport is chosen by MAIL_TRANSPORT, see env.ts.

export type Mail = { to: string; subject: string; text: string };

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
					text: mail.text
				})
			});
			if (!response.ok) {
				throw new Error(`Mail provider answered ${response.status}: ${await response.text()}`);
			}
			return;
		}
		case 'outbox':
			await db.insert(outbox).values(mail);
			return;
		default:
			console.log(`[mail] to ${mail.to}\nsubject: ${mail.subject}\n\n${mail.text}\n`);
	}
}
