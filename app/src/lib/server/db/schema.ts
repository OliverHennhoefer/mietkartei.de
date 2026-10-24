import { sql } from 'drizzle-orm';
import {
	type AnySQLiteColumn,
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

export const subscriptionStatuses = ['none', 'trialing', 'active', 'past_due', 'canceled'] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const accounts = sqliteTable(
	'accounts',
	{
		id: id(),
		name: text('name').notNull(),
		/** The landlord as sender of letters and statements (Vermieter), all optional. */
		landlordName: text('landlord_name'),
		street: text('street'),
		postalCode: text('postal_code'),
		city: text('city'),
		/** Where tenants transfer a Nachzahlung to; printed on the statement. */
		iban: text('iban'),
		bankName: text('bank_name'),
		/** Set once the standard cost categories and keys are seeded, so they are seeded only once. */
		operatingCostDefaultsSeeded: bool('operating_cost_defaults_seeded', false),
		/** When the free trial ends; null: 30 days after the account was created. */
		trialEndsAt: integer('trial_ends_at', { mode: 'timestamp_ms' }),
		stripeCustomerId: text('stripe_customer_id'),
		stripeSubscriptionId: text('stripe_subscription_id'),
		subscriptionStatus: text('subscription_status', { enum: subscriptionStatuses })
			.notNull()
			.default('none'),
		currentPeriodEnd: integer('current_period_end', { mode: 'timestamp_ms' }),
		/**
		 * The Checkout session last opened for the account, until its webhook arrives. Another
		 * Checkout reuses it while it is open, so two sessions cannot both start a subscription.
		 */
		stripeCheckoutSessionId: text('stripe_checkout_session_id'),
		createdAt: createdAt()
	},
	(table) => [
		// The webhook looks accounts up by these, so they identify exactly one account.
		uniqueIndex('accounts_stripe_customer_unique')
			.on(table.stripeCustomerId)
			.where(sql`${table.stripeCustomerId} is not null`),
		uniqueIndex('accounts_stripe_subscription_unique')
			.on(table.stripeSubscriptionId)
			.where(sql`${table.stripeSubscriptionId} is not null`)
	]
);

/** Stripe webhook events already processed, so a retried delivery changes nothing twice. */
export const stripeEvents = sqliteTable('stripe_events', {
	/** The Stripe event id (evt_…). */
	id: text('id').primaryKey(),
	type: text('type').notNull(),
	receivedAt: createdAt()
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
	(table) => [
		index('lease_persons_account_id_idx').on(table.accountId),
		uniqueIndex('lease_persons_unique').on(table.leaseId, table.validFrom)
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
		index('lease_units_account_id_idx').on(table.accountId),
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
		bankTransactionId: text('bank_transaction_id').references(() => bankTransactions.id, {
			// Checked at the end of the statement, so deleting the whole account still works; a bank
			// account with assigned transactions is refused by the banking module before that.
			onDelete: 'no action'
		}),
		createdAt: createdAt()
	},
	(table) => [
		index('deposit_transactions_account_id_idx').on(table.accountId),
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

export const rentChargeKinds = [
	'rent',
	'statement_balance',
	'co2_reimbursement',
	'adjustment'
] as const;
export type RentChargeKind = (typeof rentChargeKinds)[number];

/**
 * Sollstellung: what the tenant owes for a month (kind `rent`, derived from the rent history and
 * kept in sync by the ledger module) or from a statement, a CO₂ split or a manual adjustment.
 * Positive = the tenant owes, negative = a credit to the tenant.
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
		/**
		 * Null while the charge is not due yet: a statement's Nachzahlung is due 30 days after the
		 * statement reached the tenant, which is not known before the delivery date is recorded.
		 */
		dueDate: text('due_date'),
		baseRent: integer('base_rent').notNull().default(0),
		operatingCostPrepayment: integer('operating_cost_prepayment').notNull().default(0),
		heatingCostPrepayment: integer('heating_cost_prepayment').notNull().default(0),
		/** The total of the charge. */
		amount: integer('amount').notNull(),
		kind: text('kind', { enum: rentChargeKinds }).notNull(),
		/** The statement or CO₂ split this charge comes from. */
		referenceId: text('reference_id'),
		/** A correction or a late delivery reverses a statement's charge: a row of its own. */
		reversesChargeId: text('reverses_charge_id').references((): AnySQLiteColumn => rentCharges.id, {
			onDelete: 'cascade'
		}),
		note: text('note'),
		createdAt: createdAt()
	},
	(table) => [
		index('rent_charges_account_id_idx').on(table.accountId),
		index('rent_charges_lease_id_period_idx').on(table.leaseId, table.period),
		// One rent charge per month, so generating charges is idempotent.
		uniqueIndex('rent_charges_rent_unique')
			.on(table.leaseId, table.period)
			.where(sql`${table.kind} = 'rent'`),
		// A statement or CO₂ split is posted once per lease; a statement reverses a charge at most once.
		uniqueIndex('rent_charges_reference_unique')
			.on(table.leaseId, table.referenceId)
			.where(sql`${table.referenceId} is not null and ${table.reversesChargeId} is null`),
		uniqueIndex('rent_charges_reversal_unique')
			.on(table.reversesChargeId, table.referenceId)
			.where(sql`${table.reversesChargeId} is not null`)
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
		bankTransactionId: text('bank_transaction_id').references(() => bankTransactions.id, {
			// Checked at the end of the statement, so deleting the whole account still works; a bank
			// account with assigned transactions is refused by the banking module before that.
			onDelete: 'no action'
		}),
		createdAt: createdAt()
	},
	(table) => [
		index('payments_account_id_idx').on(table.accountId),
		index('payments_lease_id_date_idx').on(table.leaseId, table.date),
		index('payments_bank_transaction_id_idx').on(table.bankTransactionId)
	]
);

/** 1 = Zahlungserinnerung, 2 = Mahnung, 3 = letzte Mahnung. */
export const reminderLevels = [1, 2, 3] as const;
export type ReminderLevel = (typeof reminderLevels)[number];

/**
 * Zahlungserinnerung or Mahnung: a letter about the overdue amounts of a lease. The open items
 * and the paragraphs are stored as written, so a later payment or correction cannot change a
 * letter that was already sent.
 */
export const paymentReminders = sqliteTable(
	'payment_reminders',
	{
		id: id(),
		accountId: accountId(),
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'cascade' }),
		level: integer('level').$type<ReminderLevel>().notNull(),
		/** The date of the letter; the open items are those on this day. */
		date: text('date').notNull(),
		/** The day the tenant is asked to pay by. */
		paymentDeadline: text('payment_deadline').notNull(),
		/** The overdue total on `date`. */
		amount: integer('amount').notNull(),
		/** Rows of the open items table: due date, posting, open amount. */
		items: text('items', { mode: 'json' }).notNull().$type<string[][]>(),
		letterText: text('letter_text').notNull(),
		createdAt: createdAt()
	},
	(table) => [
		index('payment_reminders_account_id_idx').on(table.accountId),
		index('payment_reminders_lease_id_date_idx').on(table.leaseId, table.date)
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

// Expenses (Ausgaben)

export const expenseCategories = [
	'operating_costs',
	'maintenance',
	'financing',
	'management',
	'modernization',
	'other'
] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];

/**
 * Ausgabe: money the landlord paid out, entered by hand or assigned from an outgoing bank
 * transaction. Positive = paid out, negative = a refund. Belongs to a unit, to a whole property
 * or (both null) to the portfolio as a whole; propertyId is set whenever unitId is.
 */
export const expenses = sqliteTable(
	'expenses',
	{
		id: id(),
		accountId: accountId(),
		propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
		unitId: text('unit_id').references(() => units.id, { onDelete: 'set null' }),
		date: text('date').notNull(),
		amount: integer('amount').notNull(),
		category: text('category', { enum: expenseCategories }).notNull(),
		description: text('description').notNull(),
		/** The bank transaction the expense was assigned from; no delete action, as for payments. */
		bankTransactionId: text('bank_transaction_id').references(() => bankTransactions.id, {
			// Checked at the end of the statement, so deleting the whole account still works; a bank
			// account with assigned transactions is refused by the banking module before that.
			onDelete: 'no action'
		}),
		createdAt: createdAt()
	},
	(table) => [
		index('expenses_account_id_date_idx').on(table.accountId, table.date),
		uniqueIndex('expenses_bank_transaction_unique')
			.on(table.bankTransactionId)
			.where(sql`${table.bankTransactionId} is not null`)
	]
);

// Operating costs (Betriebskosten)

/** Kostenart, usually one of the 17 items of § 2 BetrKV. */
export const costCategories = sqliteTable(
	'cost_categories',
	{
		id: id(),
		accountId: accountId(),
		name: text('name').notNull(),
		/** Number in § 2 BetrKV, null for costs outside the list. */
		betrkvItem: integer('betrkv_item'),
		/** Whether the cost may be passed on to tenants at all. */
		allocable: bool('allocable', true),
		/** Heating, hot water and water are split by consumption. */
		consumptionBased: bool('consumption_based', false),
		/** Defaults copied into a new cost item of this category (the agreed key). */
		allocationKeyId: text('allocation_key_id').references(() => allocationKeys.id, {
			onDelete: 'set null'
		}),
		billingCircleId: text('billing_circle_id').references(() => billingCircles.id, {
			onDelete: 'set null'
		}),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt()
	},
	(table) => [
		index('cost_categories_account_id_idx').on(table.accountId),
		// Seeding the standard categories is idempotent.
		uniqueIndex('cost_categories_name_unique').on(table.accountId, table.name)
	]
);

/**
 * area = by floor area, persons = by person-days, units = equal per unit, consumption = by meter,
 * mixed = consumption percent by meter and the rest by area (HeizKV), custom = fixed shares,
 * direct = amounts per unit entered on the cost item (e.g. the result of a Messdienstleister).
 */
export const allocationKeyKinds = [
	'area',
	'persons',
	'units',
	'consumption',
	'mixed',
	'custom',
	'direct'
] as const;
export type AllocationKeyKind = (typeof allocationKeyKinds)[number];

export const meterKinds = ['cold_water', 'hot_water', 'heat', 'gas', 'electricity'] as const;
export type MeterKind = (typeof meterKinds)[number];

/** Umlageschlüssel: how a cost is split over the units. */
export const allocationKeys = sqliteTable(
	'allocation_keys',
	{
		id: id(),
		accountId: accountId(),
		/** Null: usable for every property of the account. */
		propertyId: text('property_id').references(() => properties.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		kind: text('kind', { enum: allocationKeyKinds }).notNull(),
		/** For consumption and mixed keys: which meters count. */
		meterKind: text('meter_kind', { enum: meterKinds }),
		/** For mixed keys: percent by consumption, the rest by area (§§ 7, 8 HeizKV: 50–70). */
		consumptionPercent: integer('consumption_percent'),
		createdAt: createdAt()
	},
	(table) => [
		index('allocation_keys_account_id_idx').on(table.accountId),
		uniqueIndex('allocation_keys_name_unique').on(table.accountId, table.name)
	]
);

/** Shares of a custom key, e.g. Miteigentumsanteile. */
export const allocationKeyShares = sqliteTable(
	'allocation_key_shares',
	{
		accountId: accountId(),
		keyId: text('key_id')
			.notNull()
			.references(() => allocationKeys.id, { onDelete: 'cascade' }),
		unitId: text('unit_id')
			.notNull()
			.references(() => units.id, { onDelete: 'cascade' }),
		share: real('share').notNull()
	},
	(table) => [primaryKey({ columns: [table.keyId, table.unitId] })]
);

/** Abrechnungskreis: the subset of a property's units that shares a cost. */
export const billingCircles = sqliteTable(
	'billing_circles',
	{
		id: id(),
		accountId: accountId(),
		propertyId: text('property_id')
			.notNull()
			.references(() => properties.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		createdAt: createdAt()
	},
	(table) => [index('billing_circles_property_id_idx').on(table.propertyId)]
);

export const billingCircleUnits = sqliteTable(
	'billing_circle_units',
	{
		accountId: accountId(),
		circleId: text('circle_id')
			.notNull()
			.references(() => billingCircles.id, { onDelete: 'cascade' }),
		unitId: text('unit_id')
			.notNull()
			.references(() => units.id, { onDelete: 'cascade' })
	},
	(table) => [primaryKey({ columns: [table.circleId, table.unitId] })]
);

export const fuels = ['gas', 'oil', 'lpg', 'district_heating', 'other'] as const;
export type Fuel = (typeof fuels)[number];

/** Beleg: an invoice or cost of a property for a period. The receipt is a document with costItemId. */
export const costItems = sqliteTable(
	'cost_items',
	{
		id: id(),
		accountId: accountId(),
		propertyId: text('property_id')
			.notNull()
			.references(() => properties.id, { onDelete: 'cascade' }),
		categoryId: text('category_id')
			.notNull()
			.references(() => costCategories.id, { onDelete: 'restrict' }),
		allocationKeyId: text('allocation_key_id')
			.notNull()
			.references(() => allocationKeys.id, { onDelete: 'restrict' }),
		billingCircleId: text('billing_circle_id').references(() => billingCircles.id, {
			onDelete: 'set null'
		}),
		description: text('description').notNull(),
		supplier: text('supplier'),
		invoiceDate: text('invoice_date'),
		/** The period the cost covers; prorated by days into a statement period. */
		periodStart: text('period_start').notNull(),
		periodEnd: text('period_end').notNull(),
		amount: integer('amount').notNull(),
		allocable: bool('allocable', true),
		/**
		 * For a fuel bill of a central heating: what the supplier printed, so the statement can
		 * deduct the landlord's CO₂ share (CO2KostAufG) before allocating. All optional.
		 */
		fuel: text('fuel', { enum: fuels }),
		fuelKwh: real('fuel_kwh'),
		co2Kg: real('co2_kg'),
		co2Cost: integer('co2_cost'),
		/** The Versicherung whose premium this Beleg holds, when it was entered from the policy. */
		insurancePolicyId: text('insurance_policy_id').references(() => insurancePolicies.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt()
	},
	(table) => [
		index('cost_items_account_id_idx').on(table.accountId),
		index('cost_items_property_id_period_idx').on(table.propertyId, table.periodStart)
	]
);

/** Amounts per unit for a cost item with a `direct` key, e.g. from a Messdienstleister. */
export const costItemUnitAmounts = sqliteTable(
	'cost_item_unit_amounts',
	{
		accountId: accountId(),
		costItemId: text('cost_item_id')
			.notNull()
			.references(() => costItems.id, { onDelete: 'cascade' }),
		unitId: text('unit_id')
			.notNull()
			.references(() => units.id, { onDelete: 'cascade' }),
		amount: integer('amount').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.costItemId, table.unitId] }),
		index('cost_item_unit_amounts_account_id_idx').on(table.accountId)
	]
);

/**
 * Zähler: a meter of the building (unitId null) or of one unit. A replaced meter is closed with
 * removedAt and the new one opened with installedAt; consumption is clipped to that lifetime.
 */
export const meters = sqliteTable(
	'meters',
	{
		id: id(),
		accountId: accountId(),
		propertyId: text('property_id')
			.notNull()
			.references(() => properties.id, { onDelete: 'cascade' }),
		unitId: text('unit_id').references(() => units.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: meterKinds }).notNull(),
		serialNumber: text('serial_number'),
		/** m³, kWh or Einheiten (heat cost allocators). */
		unit: text('unit').notNull(),
		location: text('location'),
		installedAt: text('installed_at'),
		removedAt: text('removed_at'),
		createdAt: createdAt()
	},
	(table) => [
		index('meters_account_id_idx').on(table.accountId),
		index('meters_property_id_idx').on(table.propertyId)
	]
);

/** Zählerstand on a date. An estimated reading stands in for a missing one (§ 9a HeizKV). */
export const meterReadings = sqliteTable(
	'meter_readings',
	{
		id: id(),
		accountId: accountId(),
		meterId: text('meter_id')
			.notNull()
			.references(() => meters.id, { onDelete: 'cascade' }),
		readAt: text('read_at').notNull(),
		value: real('value').notNull(),
		estimated: bool('estimated', false),
		note: text('note'),
		createdAt: createdAt()
	},
	(table) => [
		index('meter_readings_account_id_idx').on(table.accountId),
		uniqueIndex('meter_readings_unique').on(table.meterId, table.readAt)
	]
);

export const statementStatuses = ['draft', 'approved'] as const;
export type StatementStatus = (typeof statementStatuses)[number];

/**
 * Betriebskostenabrechnung for a property and period. Drafts are recomputed on every view; an
 * approved statement keeps its computed result frozen in `result` and is never changed again.
 * A correction is a new version with `correctsId` pointing at the version it replaces; "superseded"
 * is derived from the existence of an approved correction.
 */
export const operatingCostStatements = sqliteTable(
	'operating_cost_statements',
	{
		id: id(),
		accountId: accountId(),
		propertyId: text('property_id')
			.notNull()
			.references(() => properties.id, { onDelete: 'cascade' }),
		periodStart: text('period_start').notNull(),
		periodEnd: text('period_end').notNull(),
		version: integer('version').notNull().default(1),
		status: text('status', { enum: statementStatuses }).notNull().default('draft'),
		/** No foreign key: it points at an approved version, and approved versions are never deleted. */
		correctsId: text('corrects_id'),
		/** JSON of the computed StatementResult (property level): stored on creation, frozen on approval. */
		result: text('result'),
		/** Approval after the 12-month deadline with "Verspätung nicht zu vertreten" (§ 556 Abs. 3). */
		lateApprovalJustified: bool('late_approval_justified', false),
		approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
		approvedBy: text('approved_by').references(() => users.id, { onDelete: 'set null' }),
		note: text('note'),
		createdAt: createdAt()
	},
	(table) => [
		index('operating_cost_statements_account_id_idx').on(table.accountId),
		uniqueIndex('operating_cost_statements_version_unique').on(
			table.propertyId,
			table.periodStart,
			table.periodEnd,
			table.version
		)
	]
);

/**
 * One lease's part of an approved statement: the frozen per-lease result the PDF is printed
 * from, its balance, and when the statement reached the tenant (starts the Einwendungsfrist and
 * makes a Nachzahlung due).
 */
export const statementResults = sqliteTable(
	'statement_results',
	{
		id: id(),
		accountId: accountId(),
		statementId: text('statement_id')
			.notNull()
			.references(() => operatingCostStatements.id, { onDelete: 'cascade' }),
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'restrict' }),
		/** Positive = Nachzahlung, negative = Guthaben. */
		balance: integer('balance').notNull(),
		/** JSON of the frozen per-lease result (LeaseStatement). */
		result: text('result').notNull(),
		deliveredOn: text('delivered_on'),
		createdAt: createdAt()
	},
	(table) => [
		index('statement_results_account_id_idx').on(table.accountId),
		uniqueIndex('statement_results_unique').on(table.statementId, table.leaseId)
	]
);

/**
 * CO₂-Kostenaufteilung for a tenant with their own fuel contract (§ 6 CO2KostAufG): the inputs
 * and the result, so the amount can be re-derived and a year is settled once.
 */
export const co2CostSplits = sqliteTable(
	'co2_cost_splits',
	{
		id: id(),
		accountId: accountId(),
		leaseId: text('lease_id')
			.notNull()
			.references(() => leases.id, { onDelete: 'cascade' }),
		year: integer('year').notNull(),
		fuel: text('fuel', { enum: fuels }).notNull(),
		fuelKwh: real('fuel_kwh'),
		co2Kg: real('co2_kg').notNull(),
		co2Cost: integer('co2_cost').notNull(),
		/** The dwelling's floor area the emissions are measured against. */
		area: real('area').notNull(),
		landlordPercent: integer('landlord_percent').notNull(),
		/** The landlord's share in cents; posted as a `co2_reimbursement` credit. */
		amount: integer('amount').notNull(),
		invoiceDate: text('invoice_date'),
		/** When the tenant presented the claim; the landlord settles within 12 months. */
		claimedOn: text('claimed_on').notNull(),
		createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(table) => [
		index('co2_cost_splits_account_id_idx').on(table.accountId),
		uniqueIndex('co2_cost_splits_unique').on(table.leaseId, table.year)
	]
);

// Documents

/** An uploaded file, stored via the storage adapter under `<accountId>/<id>`. */
export const documents = sqliteTable(
	'documents',
	{
		id: id(),
		accountId: accountId(),
		name: text('name').notNull(),
		mimeType: text('mime_type').notNull(),
		size: integer('size').notNull(),
		storageKey: text('storage_key').notNull(),
		propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
		unitId: text('unit_id').references(() => units.id, { onDelete: 'set null' }),
		leaseId: text('lease_id').references(() => leases.id, { onDelete: 'set null' }),
		tenantId: text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
		costItemId: text('cost_item_id').references(() => costItems.id, { onDelete: 'set null' }),
		uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(table) => [
		index('documents_account_id_idx').on(table.accountId),
		index('documents_lease_id_idx').on(table.leaseId),
		index('documents_property_id_idx').on(table.propertyId)
	]
);

export const insuranceKinds = [
	'building',
	'liability',
	'glass',
	'oil_tank',
	'rent_loss',
	'legal',
	'other'
] as const;
export type InsuranceKind = (typeof insuranceKinds)[number];

/**
 * Versicherung of a property. It renews every year on `renewalDate` (Hauptfälligkeit) until
 * `endDate`; the notice deadline before each renewal is computed in deadlines.ts.
 */
export const insurancePolicies = sqliteTable(
	'insurance_policies',
	{
		id: id(),
		accountId: accountId(),
		propertyId: text('property_id')
			.notNull()
			.references(() => properties.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: insuranceKinds }).notNull(),
		insurer: text('insurer').notNull(),
		policyNumber: text('policy_number'),
		/** Premium per insurance year in cents. */
		annualPremium: integer('annual_premium').notNull(),
		/** The first day of an insurance year; later years start on the same day of the year. */
		renewalDate: text('renewal_date').notNull(),
		/** Months before the end of an insurance year by which a cancellation must arrive. */
		noticeMonths: integer('notice_months').notNull().default(3),
		/** The last day of cover once the policy is cancelled. */
		endDate: text('end_date'),
		note: text('note'),
		createdAt: createdAt()
	},
	(table) => [
		index('insurance_policies_account_id_idx').on(table.accountId),
		index('insurance_policies_property_id_idx').on(table.propertyId)
	]
);

export const taskCategories = ['maintenance', 'inspection', 'insurance', 'other'] as const;
export type TaskCategory = (typeof taskCategories)[number];

/** Aufgabe with an optional due date. Deadlines derived from the data are computed, not stored. */
export const tasks = sqliteTable(
	'tasks',
	{
		id: id(),
		accountId: accountId(),
		title: text('title').notNull(),
		category: text('category', { enum: taskCategories }).notNull().default('other'),
		dueDate: text('due_date'),
		/** Repeats every so many months from the due date; done, it leaves an open copy behind. */
		repeatMonths: integer('repeat_months'),
		/**
		 * The due date the series was set up with; occurrences are counted from it, so a series on
		 * the 31st returns to the 31st after a shorter month.
		 */
		repeatAnchor: text('repeat_anchor'),
		done: bool('done', false),
		doneAt: integer('done_at', { mode: 'timestamp_ms' }),
		/** The open copy created when this repeating task was done; reopening removes it again. */
		followUpId: text('follow_up_id'),
		propertyId: text('property_id').references(() => properties.id, { onDelete: 'set null' }),
		leaseId: text('lease_id').references(() => leases.id, { onDelete: 'set null' }),
		note: text('note'),
		createdAt: createdAt()
	},
	(table) => [index('tasks_account_id_idx').on(table.accountId)]
);

export const userRoles = ['owner', 'manager', 'viewer'] as const;
export type UserRole = (typeof userRoles)[number];
/** The roles an owner gives others: by invitation or by changing a member's role. */
export const memberRoles = ['manager', 'viewer'] as const;
export type MemberRole = (typeof memberRoles)[number];

/** A person who signs in. Each user works in exactly one account. */
export const users = sqliteTable(
	'users',
	{
		id: id(),
		accountId: accountId(),
		/** Stored trimmed and in lower case; unique across all accounts. */
		email: text('email').notNull().unique(),
		passwordHash: text('password_hash').notNull(),
		/**
		 * Owners manage invitations and bank accounts; managers edit everything else; viewers only
		 * read (the hook refuses their writes).
		 */
		role: text('role', { enum: userRoles }).notNull().default('owner'),
		name: text('name'),
		createdAt: createdAt()
	},
	(table) => [
		index('users_account_id_idx').on(table.accountId),
		// One owner per account. Invitations add managers only; the index also lets only one of two
		// simultaneous first registrations take over the default account.
		uniqueIndex('users_account_owner_unique')
			.on(table.accountId)
			.where(sql`${table.role} = 'owner'`)
	]
);

/**
 * The secret link of a user's calendar subscription (iCal) with the account's deadlines and tasks.
 * Only the hash of the link token is stored; a new link replaces the old one.
 */
export const calendarFeeds = sqliteTable('calendar_feeds', {
	id: id(),
	accountId: accountId(),
	userId: text('user_id')
		.notNull()
		.unique()
		.references(() => users.id, { onDelete: 'cascade' }),
	tokenHash: text('token_hash').notNull().unique(),
	createdAt: createdAt()
});

/** A signed-in browser. The id is the SHA-256 hash of the cookie token, never the token itself. */
export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		/** Sign-in time; renewals never extend a session past SESSION_MAX_AGE from here. */
		createdAt: createdAt()
	},
	(table) => [index('sessions_user_id_idx').on(table.userId)]
);

export const apiKeyScopes = ['read', 'write'] as const;
export type ApiKeyScope = (typeof apiKeyScopes)[number];

/**
 * A key for the API and the MCP server, created by a user and acting with that user's rights. The
 * id is the SHA-256 hash of the key, never the key itself; `prefix` is its first characters, so
 * the list of keys can tell them apart.
 */
export const apiKeys = sqliteTable(
	'api_keys',
	{
		id: text('id').primaryKey(),
		accountId: accountId(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		prefix: text('prefix').notNull(),
		scope: text('scope', { enum: apiKeyScopes }).notNull().default('read'),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(table) => [
		index('api_keys_account_id_idx').on(table.accountId),
		index('api_keys_user_id_idx').on(table.userId)
	]
);

/**
 * An invitation to join the account as a manager or viewer. Only the hash of the link token is stored.
 * Revoked and resent invitations stay, so the daily limit of invitations counts them too; every
 * invitation is deleted a month after its expiry.
 */
export const invitations = sqliteTable(
	'invitations',
	{
		id: id(),
		accountId: accountId(),
		email: text('email').notNull(),
		role: text('role', { enum: memberRoles }).notNull().default('manager'),
		tokenHash: text('token_hash').notNull().unique(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
		acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
		revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(table) => [index('invitations_account_id_idx').on(table.accountId)]
);

/** A password reset link. The id is the SHA-256 hash of the token; valid for one hour. */
export const passwordResets = sqliteTable(
	'password_resets',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt()
	},
	(table) => [index('password_resets_user_id_idx').on(table.userId)]
);

/**
 * A new email address waiting for confirmation. The id is the SHA-256 hash of the token in the
 * link sent to the new address; valid for one day.
 */
export const emailChanges = sqliteTable(
	'email_changes',
	{
		id: text('id').primaryKey(),
		accountId: accountId(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt()
	},
	(table) => [
		index('email_changes_account_id_idx').on(table.accountId),
		index('email_changes_user_id_idx').on(table.userId)
	]
);

/**
 * A registration waiting for the link sent to its address. The id is the SHA-256 hash of the
 * token in the link; valid for one day. The password is chosen and the account created only on
 * the page of the link, so whoever requested it cannot set the password of someone else's address.
 */
export const registrationRequests = sqliteTable(
	'registration_requests',
	{
		id: text('id').primaryKey(),
		/** Stored trimmed and in lower case, like users.email. */
		email: text('email').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt()
	},
	(table) => [index('registration_requests_email_idx').on(table.email)]
);

/** Failed sign-ins per address; five within fifteen minutes lock the address for fifteen minutes. */
export const loginAttempts = sqliteTable('login_attempts', {
	email: text('email').primaryKey(),
	failures: integer('failures').notNull().default(0),
	firstFailureAt: integer('first_failure_at', { mode: 'timestamp_ms' }).notNull(),
	lockedUntil: integer('locked_until', { mode: 'timestamp_ms' })
});

/** Mails stored instead of sent, when MAIL_TRANSPORT=outbox (end-to-end tests). */
export const outbox = sqliteTable('outbox', {
	id: id(),
	to: text('to').notNull(),
	subject: text('subject').notNull(),
	text: text('text').notNull(),
	createdAt: createdAt()
});

/**
 * The verbs used in audit_log.action. The column is plain text so a feature can add a verb
 * without a schema change.
 */
export type AuditAction =
	| 'create'
	| 'update'
	| 'delete'
	| 'post'
	| 'approve'
	| 'correct'
	| 'import'
	| 'assign'
	| 'undo'
	| 'ignore'
	| 'upload'
	| 'invite'
	| 'reset'
	| 'export';

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
