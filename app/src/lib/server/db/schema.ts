import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { unitKinds } from '../../units';

// Every record belongs to an account. The hosted variant serves many accounts from one database;
// a self-hosted instance simply has a single account.

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);

const accountId = () =>
	text('account_id')
		.notNull()
		.references(() => accounts.id, { onDelete: 'cascade' });

export const accounts = sqliteTable('accounts', {
	id: id(),
	name: text('name').notNull(),
	createdAt: createdAt()
});

/** Objekt: a building or plot with one or more units. */
export const properties = sqliteTable(
	'properties',
	{
		id: id(),
		accountId: accountId(),
		name: text('name').notNull(),
		street: text('street').notNull(),
		postalCode: text('postal_code').notNull(),
		city: text('city').notNull(),
		createdAt: createdAt()
	},
	(table) => [index('properties_account_id_idx').on(table.accountId)]
);

/** Einheit: an apartment, commercial unit or parking space within a property. */
export const units = sqliteTable(
	'units',
	{
		id: id(),
		accountId: accountId(),
		propertyId: text('property_id')
			.notNull()
			.references(() => properties.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		kind: text('kind', { enum: unitKinds }).notNull(),
		/** Floor area in square metres. */
		floorArea: real('floor_area'),
		createdAt: createdAt()
	},
	(table) => [
		index('units_account_id_idx').on(table.accountId),
		index('units_property_id_idx').on(table.propertyId)
	]
);

/** Mieter: a party to a lease. */
export const tenants = sqliteTable(
	'tenants',
	{
		id: id(),
		accountId: accountId(),
		firstName: text('first_name').notNull(),
		lastName: text('last_name').notNull(),
		email: text('email'),
		phone: text('phone'),
		createdAt: createdAt()
	},
	(table) => [index('tenants_account_id_idx').on(table.accountId)]
);

/** Mietvertrag: a lease for one unit. Amounts are stored in euro cents. */
export const leases = sqliteTable(
	'leases',
	{
		id: id(),
		accountId: accountId(),
		unitId: text('unit_id')
			.notNull()
			.references(() => units.id, { onDelete: 'restrict' }),
		/** ISO date (YYYY-MM-DD). */
		startDate: text('start_date').notNull(),
		/** ISO date (YYYY-MM-DD); null while the lease runs indefinitely. */
		endDate: text('end_date'),
		baseRent: integer('base_rent').notNull(),
		operatingCostPrepayment: integer('operating_cost_prepayment').notNull().default(0),
		securityDeposit: integer('security_deposit').notNull().default(0),
		createdAt: createdAt()
	},
	(table) => [
		index('leases_account_id_idx').on(table.accountId),
		index('leases_unit_id_idx').on(table.unitId)
	]
);

/** A lease can have several tenants, and a tenant can have several leases. */
export const leaseTenants = sqliteTable(
	'lease_tenants',
	{
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'cascade' }),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenants.id, { onDelete: 'restrict' })
	},
	(table) => [
		primaryKey({ columns: [table.leaseId, table.tenantId] }),
		index('lease_tenants_tenant_id_idx').on(table.tenantId)
	]
);

/** A person who signs in. Each user works in exactly one account. */
export const users = sqliteTable(
	'users',
	{
		id: id(),
		accountId: accountId(),
		/** Stored trimmed and in lower case; unique across all accounts. */
		email: text('email').notNull().unique(),
		passwordHash: text('password_hash').notNull(),
		createdAt: createdAt()
	},
	(table) => [index('users_account_id_idx').on(table.accountId)]
);

/** A signed-in browser. The id is the SHA-256 hash of the cookie token, never the token itself. */
export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [index('sessions_user_id_idx').on(table.userId)]
);
