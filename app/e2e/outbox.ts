import { expect, type APIRequestContext } from '@playwright/test';

// The mails the test server stores instead of sending them (MAIL_TRANSPORT=outbox), newest first.

export type Mail = { to: string; subject: string; text: string };

export async function readOutbox(request: APIRequestContext): Promise<Mail[]> {
	const response = await request.get('/api/e2e/outbox');
	expect(response.ok()).toBe(true);
	return (await response.json()) as Mail[];
}

/** The newest mail to the address. Waits for it, because some mails go out after the response. */
export async function mailTo(request: APIRequestContext, to: string): Promise<Mail> {
	let mail: Mail | undefined;
	await expect(async () => {
		mail = (await readOutbox(request)).find((candidate) => candidate.to === to);
		expect(mail, `a mail to ${to}`).toBeDefined();
	}).toPass();
	return mail!;
}

/** The link to `path` (e.g. "/einladung/") in the newest mail to the address. */
export async function linkInMailTo(
	request: APIRequestContext,
	to: string,
	path: string
): Promise<string> {
	const mail = await mailTo(request, to);
	const link = mail.text.match(new RegExp(`https?://\\S+${path}[A-Za-z0-9_-]+`))?.[0];
	expect(link, `a link to ${path} in the mail to ${to}`).toBeDefined();
	return link!;
}
