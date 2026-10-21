import type { Page } from '@playwright/test';

/** Collects the Content-Security-Policy violations the browser reports on the console. */
export function watchCspViolations(page: Page): string[] {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
	});
	return violations;
}
