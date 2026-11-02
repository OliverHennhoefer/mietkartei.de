import { personName } from './format';

// A tenant typed into the lease form who does not exist yet. The tenant select submits them as
// `new:<first name>|<last name>` next to the ids of existing tenants; creating the lease creates
// them too (see createLease).

export const NEW_TENANT_PREFIX = 'new:';

type Name = { firstName: string; lastName: string };

export function newTenantValue(name: Name): string {
	const clean = (part: string) => part.replaceAll('|', ' ').replaceAll(',', ' ').trim();
	return `${NEW_TENANT_PREFIX}${clean(name.firstName)}|${clean(name.lastName)}`;
}

/** The name in a submitted value, or null for the id of an existing tenant. */
export function newTenantOf(value: string): Name | null {
	if (!value.startsWith(NEW_TENANT_PREFIX)) return null;
	const [firstName = '', lastName = ''] = value.slice(NEW_TENANT_PREFIX.length).split('|');
	return { firstName: firstName.trim(), lastName: lastName.trim() };
}

/** The pill of a new tenant in the select. */
export function newTenantLabel(value: string): string | undefined {
	const name = newTenantOf(value);
	return name ? `${personName(name)} (neu)` : undefined;
}
