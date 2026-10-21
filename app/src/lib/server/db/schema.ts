import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { unitKinds } from '../../units';

// Every record belongs to an account. The hosted variant serves many accounts from one database;
// a self-hosted instance simply has a single account. Amounts are integer euro cents, dates are
// ISO strings (YYYY-MM-DD).

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

const bool = (name: string, fallback: boolean) =>
	integer(name, { mode: 'boolean' }).notNull().default(fallback);

export const accounts = sqliteTable('accounts', {
	id: id(),
	name: text('name').notNull(),
	/** The landlord as sender of letters (Vermieter), all optional. */
	landlordName: text('landlord_name'),
	street: text('street'),
	postalCode: text('postal_code'),
	city: text('city'),
	createdAt: createdAt()
});

export const buildingUses = ['residential', 'non_residential'] as const;
export type BuildingUse = (typeof buildingUses)[number];

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
		/** Wohngebäude or Nichtwohngebäude (§ 8 CO2KostAufG: 50/50 split for the latter). */
		buildingUse: text('building_use', { enum: buildingUses }).notNull().default('residential'),
		/** Persons a vacant unit counts with in the persons key; that share stays with the landlord. */
		vacancyPersons: integer('vacancy_persons').notNull().default(1),
		notes: text('notes'),
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
		floor: text('floor'),
		rooms: real('rooms'),
		notes: text('notes'),
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
		salutation: text('salutation'),
		firstName: text('first_name').notNull(),
		lastName: text('last_name').notNull(),
		email: text('email'),
		phone: text('phone'),
		/** Postal address for letters; usually the rented unit, so optional. */
		street: text('street'),
		postalCode: text('postal_code'),
		city: text('city'),
		notes: text('notes'),
		createdAt: createdAt()
	},
	(table) => [index('tenants_account_id_idx').on(table.accountId)]
);

export const leaseKinds = ['residential', 'commercial', 'parking'] as const;
export type LeaseKind = (typeof leaseKinds)[number];

export const rentModels = ['fixed', 'graduated', 'indexed'] as const;
export type RentModel = (typeof rentModels)[number];

/** Vorauszahlung (billed in the statement), Pauschale (never billed) or Inklusivmiete. */
export const operatingCostModels = ['prepayment', 'flat', 'inclusive'] as const;
export type OperatingCostModel = (typeof operatingCostModels)[number];

export const heatingCostModels = ['prepayment', 'flat'] as const;
export type HeatingCostModel = (typeof heatingCostModels)[number];

export const terminatedByParties = ['tenant', 'landlord'] as const;
export type TerminatedBy = (typeof terminatedByParties)[number];

/**
 * Mietvertrag: a lease for one main unit (plus extra units in lease_units). The rent and persons
 * columns hold the initial values; the values valid on a day come from rent_changes and
 * lease_persons. Amounts in euro cents.
 */
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
		heatingCostPrepayment: integer('heating_cost_prepayment').notNull().default(0),
		securityDeposit: integer('security_deposit').notNull().default(0),
		kind: text('kind', { enum: leaseKinds }).notNull().default('residential'),
		rentModel: text('rent_model', { enum: rentModels }).notNull().default('fixed'),
		operatingCostModel: text('operating_cost_model', { enum: operatingCostModels })
			.notNull()
			.default('prepayment'),
		heatingCostModel: text('heating_cost_model', { enum: heatingCostModels })
			.notNull()
			.default('prepayment'),
		/** Occupants at the start, for the persons allocation key; later values in lease_persons. */
		persons: integer('persons').notNull().default(1),
		/** The rent is due on the n-th working day of the month (§ 556b BGB: the third). */
		rentDueDay: integer('rent_due_day').notNull().default(3),
		/**
		 * The ledger starts here instead of at startDate when the lease is entered later, so a
		 * lease from 2015 does not show ten years of arrears. Null = startDate.
		 */
		ledgerStart: text('ledger_start'),
		/** ISO date notice was given and by whom, null while none. */
		terminatedAt: text('terminated_at'),
		terminatedBy: text('terminated_by', { enum: terminatedByParties }),
		/** For indexed rents: the VPI month and value the current rent is based on. */
		indexBaseMonth: text('index_base_month'),
		indexBaseValue: real('index_base_value'),
		/** The base year (= 100) of indexBaseValue; a proposal needs VPI values of the same year. */
		indexBaseYear: text('index_base_year').notNull().default('2020'),
		notes: text('notes'),
		createdAt: createdAt()
	},
	(table) => [
		index('leases_account_id_idx').on(table.accountId),
		index('leases_unit_id_idx').on(table.unitId)
	]
);

/** Personenstand: how many people live in the unit from a date on, for the persons key. */
export const leasePersons = sqliteTable(
	'lease_persons',
	{
		id: id(),
		accountId: accountId(),
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'cascade' }),
		validFrom: text('valid_from').notNull(),
		persons: integer('persons').notNull(),
		note: text('note'),
		createdAt: createdAt()
	},
	(table) => [uniqueIndex('lease_persons_unique').on(table.leaseId, table.validFrom)]
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

/**
 * Extra units rented with the main unit, e.g. a parking space. The main unit is not repeated.
 * Changing the units of a running lease means ending it and starting a new one.
 */
export const leaseUnits = sqliteTable(
	'lease_units',
	{
		accountId: accountId(),
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'cascade' }),
		unitId: text('unit_id')
			.notNull()
			.references(() => units.id, { onDelete: 'restrict' })
	},
	(table) => [
		primaryKey({ columns: [table.leaseId, table.unitId] }),
		index('lease_units_unit_id_idx').on(table.unitId)
	]
);

export const rentChangeReasons = [
	'initial',
	'manual',
	'graduated',
	'indexed',
	'statement'
] as const;
export type RentChangeReason = (typeof rentChangeReasons)[number];

export const rentChangeStatuses = ['approved', 'proposed'] as const;

/**
 * Mietänderung: the rent history. The rent valid on a day is the approved row with the latest
 * validFrom on or before that day. Creating a lease inserts the `initial` row.
 */
export const rentChanges = sqliteTable(
	'rent_changes',
	{
		id: id(),
		accountId: accountId(),
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'cascade' }),
		validFrom: text('valid_from').notNull(),
		baseRent: integer('base_rent').notNull(),
		operatingCostPrepayment: integer('operating_cost_prepayment').notNull().default(0),
		heatingCostPrepayment: integer('heating_cost_prepayment').notNull().default(0),
		reason: text('reason', { enum: rentChangeReasons }).notNull(),
		status: text('status', { enum: rentChangeStatuses }).notNull().default('approved'),
		note: text('note'),
		/** For indexed changes: the VPI month and value the new rent is based on. */
		indexMonth: text('index_month'),
		indexValue: real('index_value'),
		/** The base year (= 100) of indexValue. */
		indexBaseYear: text('index_base_year').notNull().default('2020'),
		/**
		 * For indexed changes: the generated letter as approved, its paragraphs and the rows of its
		 * old/new table, and when it was (or is to be) delivered.
		 */
		letterText: text('letter_text'),
		letterTable: text('letter_table', { mode: 'json' }).$type<string[][]>(),
		deliveredOn: text('delivered_on'),
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(table) => [
		index('rent_changes_account_id_idx').on(table.accountId),
		index('rent_changes_lease_id_valid_from_idx').on(table.leaseId, table.validFrom),
		// "The rent on a day" must be one row, so two approved changes never share a date.
		uniqueIndex('rent_changes_approved_unique')
			.on(table.leaseId, table.validFrom)
			.where(sql`${table.status} = 'approved'`)
	]
);

export const depositTransactionKinds = ['received', 'interest', 'returned', 'withheld'] as const;
export type DepositTransactionKind = (typeof depositTransactionKinds)[number];

/** Kaution: movements on the deposit, kept apart from the rent ledger. Positive = received. */
export const depositTransactions = sqliteTable(
	'deposit_transactions',
	{
		id: id(),
		accountId: accountId(),
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'cascade' }),
		date: text('date').notNull(),
		amount: integer('amount').notNull(),
		kind: text('kind', { enum: depositTransactionKinds }).notNull(),
		note: text('note'),
		/**
		 * Set when the movement was assigned from a bank transaction. No delete action: SQLite adds
		 * the column with a bare REFERENCES, and a referenced transaction is never deleted (undo
		 * deletes the movement first, a bank account with matched transactions is kept).
		 */
		bankTransactionId: text('bank_transaction_id').references(() => bankTransactions.id),
		createdAt: createdAt()
	},
	(table) => [
		index('deposit_transactions_lease_id_idx').on(table.leaseId),
		uniqueIndex('deposit_transactions_bank_transaction_unique')
			.on(table.bankTransactionId)
			.where(sql`${table.bankTransactionId} is not null`)
	]
);

/** Verbraucherpreisindex values entered per account, for indexed rents. */
export const consumerPriceIndex = sqliteTable(
	'consumer_price_index',
	{
		id: id(),
		accountId: accountId(),
		/** YYYY-MM */
		month: text('month').notNull(),
		value: real('value').notNull(),
		baseYear: text('base_year').notNull().default('2020'),
		createdAt: createdAt()
	},
	(table) => [
		uniqueIndex('consumer_price_index_unique').on(table.accountId, table.baseYear, table.month)
	]
);

// Rent ledger (Mietkonto)

export const rentChargeKinds = ['rent', 'adjustment'] as const;
export type RentChargeKind = (typeof rentChargeKinds)[number];

/**
 * Sollstellung: what the tenant owes for a month (kind `rent`, derived from the rent history and
 * kept in sync by the ledger module) or from a manual adjustment. Positive = the tenant owes,
 * negative = a credit to the tenant.
 */
export const rentCharges = sqliteTable(
	'rent_charges',
	{
		id: id(),
		accountId: accountId(),
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'cascade' }),
		/** YYYY-MM */
		period: text('period').notNull(),
		dueDate: text('due_date').notNull(),
		baseRent: integer('base_rent').notNull().default(0),
		operatingCostPrepayment: integer('operating_cost_prepayment').notNull().default(0),
		heatingCostPrepayment: integer('heating_cost_prepayment').notNull().default(0),
		/** The total of the charge. */
		amount: integer('amount').notNull(),
		kind: text('kind', { enum: rentChargeKinds }).notNull(),
		note: text('note'),
		createdAt: createdAt()
	},
	(table) => [
		index('rent_charges_account_id_idx').on(table.accountId),
		index('rent_charges_lease_id_period_idx').on(table.leaseId, table.period),
		// One rent charge per month, so generating charges is idempotent.
		uniqueIndex('rent_charges_rent_unique')
			.on(table.leaseId, table.period)
			.where(sql`${table.kind} = 'rent'`)
	]
);

export const paymentSources = ['manual', 'bank'] as const;
export type PaymentSource = (typeof paymentSources)[number];

/**
 * Zahlung: money received for a lease. Positive = received, negative = refunded. One bank
 * transaction can be split over several leases (flat and separately leased garage).
 */
export const payments = sqliteTable(
	'payments',
	{
		id: id(),
		accountId: accountId(),
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'cascade' }),
		date: text('date').notNull(),
		amount: integer('amount').notNull(),
		note: text('note'),
		source: text('source', { enum: paymentSources }).notNull().default('manual'),
		/** The bank transaction the payment was assigned from; no delete action, as above. */
		bankTransactionId: text('bank_transaction_id').references(() => bankTransactions.id),
		createdAt: createdAt()
	},
	(table) => [
		index('payments_account_id_idx').on(table.accountId),
		index('payments_lease_id_date_idx').on(table.leaseId, table.date),
		index('payments_bank_transaction_id_idx').on(table.bankTransactionId)
	]
);

// Banking

export const bankAccounts = sqliteTable(
	'bank_accounts',
	{
		id: id(),
		accountId: accountId(),
		name: text('name').notNull(),
		iban: text('iban').notNull(),
		bic: text('bic'),
		holder: text('holder').notNull(),
		createdAt: createdAt()
	},
	(table) => [uniqueIndex('bank_accounts_iban_unique').on(table.accountId, table.iban)]
);

export const bankImports = sqliteTable(
	'bank_imports',
	{
		id: id(),
		accountId: accountId(),
		bankAccountId: text('bank_account_id')
			.notNull()
			.references(() => bankAccounts.id, { onDelete: 'cascade' }),
		fileName: text('file_name').notNull(),
		rowCount: integer('row_count').notNull(),
		importedCount: integer('imported_count').notNull(),
		duplicateCount: integer('duplicate_count').notNull(),
		importedBy: text('imported_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(table) => [index('bank_imports_account_id_idx').on(table.accountId)]
);

export const bankTransactionStatuses = ['unmatched', 'matched', 'ignored'] as const;
export type BankTransactionStatus = (typeof bankTransactionStatuses)[number];

/** Umsatz: one line of a bank statement. Amount is signed cents; incoming rent is positive. */
export const bankTransactions = sqliteTable(
	'bank_transactions',
	{
		id: id(),
		accountId: accountId(),
		bankAccountId: text('bank_account_id')
			.notNull()
			.references(() => bankAccounts.id, { onDelete: 'cascade' }),
		importId: text('import_id').references(() => bankImports.id, { onDelete: 'set null' }),
		bookingDate: text('booking_date').notNull(),
		valueDate: text('value_date'),
		amount: integer('amount').notNull(),
		counterpartName: text('counterpart_name').notNull().default(''),
		counterpartIban: text('counterpart_iban'),
		purpose: text('purpose').notNull().default(''),
		/**
		 * SHA-256 of bookingDate|amount|counterpartName|counterpartIban|purpose|occurrence, over
		 * the normalized fields. Two identical lines in one file get occurrence 0 and 1, so a
		 * tenant paying twice on one day is kept while a re-import of the file adds nothing.
		 */
		fingerprint: text('fingerprint').notNull(),
		occurrence: integer('occurrence').notNull().default(0),
		/** The bank's own transaction id, when the export has one. */
		externalId: text('external_id'),
		/** matched = assigned to payments or a deposit movement; set by the banking module. */
		status: text('status', { enum: bankTransactionStatuses }).notNull().default('unmatched'),
		createdAt: createdAt()
	},
	(table) => [
		index('bank_transactions_account_id_idx').on(table.accountId),
		index('bank_transactions_status_idx').on(table.accountId, table.status),
		// The same statement line is never imported twice.
		uniqueIndex('bank_transactions_fingerprint_unique').on(table.bankAccountId, table.fingerprint)
	]
);

export const matchingFields = ['counterpartIban', 'counterpartName', 'purpose'] as const;
export type MatchingField = (typeof matchingFields)[number];

/** A rule "transactions whose <field> contains <pattern> belong to this lease". */
export const matchingRules = sqliteTable(
	'matching_rules',
	{
		id: id(),
		accountId: accountId(),
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'cascade' }),
		field: text('field', { enum: matchingFields }).notNull(),
		pattern: text('pattern').notNull(),
		/** Confirmed rules assign automatically on import; others only suggest. */
		confirmed: bool('confirmed', false),
		createdAt: createdAt()
	},
	(table) => [index('matching_rules_account_id_idx').on(table.accountId)]
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
	(table) => [
		index('users_account_id_idx').on(table.accountId),
		// Only one user can take over the data from before sign-in, even if two register at once.
		uniqueIndex('users_default_account_unique')
			.on(table.accountId)
			.where(sql`${table.accountId} = 'default'`)
	]
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

/**
 * The verbs used in audit_log.action. The column is plain text so a feature can add a verb
 * without a schema change.
 */
export type AuditAction =
	'create' | 'update' | 'delete' | 'post' | 'approve' | 'import' | 'assign' | 'undo' | 'ignore';

/** Who changed what, as one German sentence per change. */
export const auditLog = sqliteTable(
	'audit_log',
	{
		id: id(),
		accountId: accountId(),
		userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
		at: createdAt(),
		entity: text('entity').notNull(),
		entityId: text('entity_id').notNull(),
		action: text('action').notNull(),
		summary: text('summary').notNull()
	},
	(table) => [index('audit_log_account_id_at_idx').on(table.accountId, table.at)]
);
