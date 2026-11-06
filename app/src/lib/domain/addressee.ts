import { personName } from '../format';

// A lease names one tenant: in its letters (window, greeting) and wherever a list names the lease
// by its tenants. When every tenant of the lease has the same last name, that is the family
// ("Familie Muster"); else the main tenant, who comes first (mainFirst). The other tenants stay
// parties to the lease and show on its page.

export type AddressedTenant = { salutation: string | null; firstName: string; lastName: string };

export type Addressee<T> = {
	/** The last name all tenants share, null for the main tenant alone. */
	family: string | null;
	/** The main tenant, whose address the letters use. */
	tenant: T;
};

/** Who the letters and lists of a lease with these tenants (main tenant first) name. */
export function addressee<T extends AddressedTenant>(
	tenants: readonly T[]
): Addressee<T> | undefined {
	const [tenant] = tenants;
	if (!tenant) return undefined;
	const lastName = tenant.lastName.trim();
	const family =
		tenants.length > 1 &&
		lastName !== '' &&
		tenants.every(
			(other) => other.lastName.trim().toLocaleLowerCase('de') === lastName.toLocaleLowerCase('de')
		);
	return { family: family ? lastName : null, tenant };
}

/** The tenants as a list names the lease: "Familie Muster" or "Erika Muster"; empty for none. */
export function leaseTenantName(tenants: readonly AddressedTenant[]): string {
	const named = addressee(tenants);
	if (!named) return '';
	return named.family ? `Familie ${named.family}` : personName(named.tenant);
}

/** The first line of the window: "Familie Muster" or "Frau Erika Muster". */
export function addresseeLine(tenants: readonly AddressedTenant[]): string | undefined {
	const named = addressee(tenants);
	if (!named) return undefined;
	if (named.family) return `Familie ${named.family}`;
	return [named.tenant.salutation, personName(named.tenant)].filter(Boolean).join(' ');
}

/**
 * "Guten Tag Familie Muster,", "Guten Tag Frau Muster," or "Guten Tag Erika Muster,": the letters
 * to tenants address them formally ("Sie"); "Guten Tag" keeps the greeting plain rather than the
 * stiff "Sehr geehrte".
 */
export function greeting(tenants: readonly AddressedTenant[]): string {
	const named = addressee(tenants);
	if (!named) return 'Guten Tag,';
	if (named.family) return `Guten Tag Familie ${named.family},`;
	const salutation = (named.tenant.salutation ?? '').trim();
	if (salutation === 'Frau' || salutation === 'Herr') {
		return `Guten Tag ${salutation} ${named.tenant.lastName},`;
	}
	return `Guten Tag ${personName(named.tenant)},`;
}

/** The tenants (or their rows) with the main tenant first, the others in their order. */
export function mainFirst<T>(
	items: readonly T[],
	mainTenantId: string | null,
	tenantIdOf: (item: T) => string
): T[] {
	const main = items.find((item) => tenantIdOf(item) === mainTenantId);
	return main ? [main, ...items.filter((item) => item !== main)] : [...items];
}
