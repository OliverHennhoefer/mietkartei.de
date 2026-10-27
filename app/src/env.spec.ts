import { describe, expect, it } from 'vitest';
import { variables } from './env';

function read(name: keyof typeof variables, value: string | undefined) {
	const schema = variables[name].schema as {
		'~standard': { validate(value: unknown): { value?: unknown; issues?: { message: string }[] } };
	};
	return schema['~standard'].validate(value);
}

describe('environment variables', () => {
	it('falls back to the defaults of a self-hosted instance', () => {
		expect(read('DATABASE_PATH', undefined)).toEqual({ value: './data/mietkartei.db' });
		expect(read('MAIL_TRANSPORT', '')).toEqual({ value: 'console' });
		expect(read('MAIL_FROM', '')).toEqual({ value: 'mietkartei <noreply@mietkartei.de>' });
		expect(read('STRIPE_API_BASE', '')).toEqual({ value: 'https://api.stripe.com' });
		expect(read('ORIGIN', undefined)).toEqual({ value: '' });
	});

	it('lets every variable be unset', () => {
		for (const name of Object.keys(variables) as (keyof typeof variables)[]) {
			expect(read(name, undefined).issues).toBeUndefined();
		}
	});

	it('takes only the known mail transports', () => {
		expect(read('MAIL_TRANSPORT', 'resend')).toEqual({ value: 'resend' });
		expect(read('MAIL_TRANSPORT', 'smtp')).toEqual({
			issues: [{ message: 'MAIL_TRANSPORT is "console", "resend" or "outbox"' }]
		});
	});

	it('turns on billing, the demo, the hosted variant and the test routes only with "true"', () => {
		for (const name of ['BILLING_REQUIRED', 'DEMO', 'E2E', 'HOSTED'] as const) {
			expect(read(name, 'true')).toEqual({ value: true });
			expect(read(name, '1')).toEqual({ value: false });
		}
	});
});
