import type { LandlordInput } from '../server/accounts';
import { MIN_PASSWORD_LENGTH } from '../validation';
import { FormParser, type ParseResult } from './fields';

// Parsers of the account pages: password reset, invitations, profile and the landlord sender
// block. Passwords are read without being remembered, so a failed form never sends one back to
// the browser.

const PASSWORD_TOO_SHORT = `Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`;
const PASSWORDS_DIFFER = 'Die Passwörter stimmen nicht überein.';

/** The raw password field, not recorded in `values`. */
function password(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

/** A new password and its repetition; both errors are reported on their own field. */
function newPassword<T extends { password: string; passwordConfirm: string }>(
	parser: FormParser<T>,
	form: FormData
): { password: string; passwordConfirm: string } {
	const value = password(form, 'password');
	const confirm = password(form, 'passwordConfirm');
	if (value.length < MIN_PASSWORD_LENGTH) parser.fail('password', PASSWORD_TOO_SHORT);
	else if (value.length > 200) parser.fail('password', 'Das Passwort ist zu lang.');
	else if (confirm !== value) parser.fail('passwordConfirm', PASSWORDS_DIFFER);
	return { password: value, passwordConfirm: confirm };
}

export type EmailInput = { email: string };

/** The "Passwort vergessen" form. */
export function parseEmailForm(form: FormData): ParseResult<EmailInput> {
	const parser = new FormParser<EmailInput>(form);
	const email = parser.email('email');
	return parser.result(() => ({ email }));
}

export type NewPasswordInput = { password: string; passwordConfirm: string };

/** The reset page: the new password twice. */
export function parseNewPassword(form: FormData): ParseResult<NewPasswordInput> {
	const parser = new FormParser<NewPasswordInput>(form);
	const fields = newPassword(parser, form);
	return parser.result(() => fields);
}

export type PasswordChangeInput = {
	currentPassword: string;
	password: string;
	passwordConfirm: string;
};

/** The profile page: current password plus the new one twice. */
export function parsePasswordChange(form: FormData): ParseResult<PasswordChangeInput> {
	const parser = new FormParser<PasswordChangeInput>(form);
	const currentPassword = password(form, 'currentPassword');
	if (!currentPassword) parser.fail('currentPassword', 'Bitte gib dein aktuelles Passwort an.');
	const fields = newPassword(parser, form);
	return parser.result(() => ({ currentPassword, ...fields }));
}

export type InvitationFormInput = { email: string; role: 'manager' };

/**
 * The "Einladen" form. An account has one owner, so invitations are for managers only: the form
 * has no role field, and a posted role other than manager is refused.
 */
export function parseInvitation(form: FormData): ParseResult<InvitationFormInput> {
	const parser = new FormParser<InvitationFormInput>(form);
	const email = parser.email('email');
	if (parser.raw('role')) parser.oneOf('role', ['manager'] as const);
	return parser.result(() => ({ email, role: 'manager' }));
}

export type AcceptInvitationInput = { name: string; password: string; passwordConfirm: string };

/** The registration form behind an invitation link; the address comes from the invitation. */
export function parseAcceptInvitation(form: FormData): ParseResult<AcceptInvitationInput> {
	const parser = new FormParser<AcceptInvitationInput>(form);
	const name = parser.text('name', { max: 100 });
	const fields = newPassword(parser, form);
	return parser.result(() => ({ name, ...fields }));
}

export type ProfileInput = { name: string | null; email: string; currentPassword: string };

/**
 * Name and address of the signed-in user. Changing the address needs the current password, so
 * the parser is told which address the user has now.
 */
export function parseProfile(form: FormData, currentEmail: string): ParseResult<ProfileInput> {
	const parser = new FormParser<ProfileInput>(form);
	const name = parser.optionalText('name', 100);
	const email = parser.email('email');
	const currentPassword = password(form, 'currentPassword');
	if (!parser.errors.email && email !== currentEmail && !currentPassword) {
		parser.fail('currentPassword', 'Zum Ändern der E-Mail-Adresse brauchen wir dein Passwort.');
	}
	return parser.result(() => ({ name, email, currentPassword }));
}

/** The landlord sender block; every field is optional, but a given postal code has five digits. */
export function parseLandlord(form: FormData): ParseResult<LandlordInput> {
	const parser = new FormParser<LandlordInput>(form);
	const landlordName = parser.optionalText('landlordName', 200);
	const street = parser.optionalText('street', 200);
	const postalCode = parser.optionalText('postalCode', 10);
	if (postalCode && !/^\d{5}$/.test(postalCode)) {
		parser.fail('postalCode', 'Die Postleitzahl hat fünf Ziffern.');
	}
	const city = parser.optionalText('city', 200);
	const iban = parser.iban('iban', { required: false });
	const bankName = parser.optionalText('bankName', 200);
	return parser.result(() => ({ landlordName, street, postalCode, city, iban, bankName }));
}

export type DeleteAccountInput = { password: string };

/** The "Konto löschen" form: the password again. */
export function parseDeleteAccount(form: FormData): ParseResult<DeleteAccountInput> {
	const parser = new FormParser<DeleteAccountInput>(form);
	const value = password(form, 'password');
	if (!value) parser.fail('password', 'Bitte gib dein Passwort an.');
	// No account has a longer password; refused before it is hashed.
	else if (value.length > 200) parser.fail('password', 'Das Passwort stimmt nicht.');
	return parser.result(() => ({ password: value }));
}
