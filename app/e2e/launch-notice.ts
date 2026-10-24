import type { Page } from '@playwright/test';

/**
 * Closes the launch notice that the hosted variant shows over the sign-in page whenever it is in
 * the way. Delete this file and its uses with src/lib/launch.ts once mietkartei has launched.
 */
export async function closeLaunchNotice(page: Page) {
	const notice = page.getByRole('dialog', { name: /mietkartei startet/ });
	await page.addLocatorHandler(notice, () =>
		notice.getByRole('button', { name: 'Verstanden' }).click()
	);
}
