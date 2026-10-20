CREATE TABLE `allocation_key_shares` (
	`account_id` text NOT NULL,
	`key_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`share` real NOT NULL,
	PRIMARY KEY(`key_id`, `unit_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`key_id`) REFERENCES `allocation_keys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `allocation_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`meter_kind` text,
	`consumption_percent` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `allocation_keys_account_id_idx` ON `allocation_keys` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `allocation_keys_name_unique` ON `allocation_keys` (`account_id`,`name`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_account_id_at_idx` ON `audit_log` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`iban` text NOT NULL,
	`bic` text,
	`holder` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bank_accounts_account_id_idx` ON `bank_accounts` (`account_id`);--> statement-breakpoint
CREATE TABLE `bank_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`file_name` text NOT NULL,
	`row_count` integer NOT NULL,
	`imported_count` integer NOT NULL,
	`duplicate_count` integer NOT NULL,
	`imported_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bank_imports_account_id_idx` ON `bank_imports` (`account_id`);--> statement-breakpoint
CREATE TABLE `bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`import_id` text,
	`booking_date` text NOT NULL,
	`value_date` text,
	`amount` integer NOT NULL,
	`counterpart_name` text DEFAULT '' NOT NULL,
	`counterpart_iban` text,
	`purpose` text DEFAULT '' NOT NULL,
	`fingerprint` text NOT NULL,
	`occurrence` integer DEFAULT 0 NOT NULL,
	`external_id` text,
	`status` text DEFAULT 'unmatched' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `bank_imports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bank_transactions_account_id_idx` ON `bank_transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `bank_transactions_status_idx` ON `bank_transactions` (`account_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_transactions_fingerprint_unique` ON `bank_transactions` (`bank_account_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `billing_circle_units` (
	`account_id` text NOT NULL,
	`circle_id` text NOT NULL,
	`unit_id` text NOT NULL,
	PRIMARY KEY(`circle_id`, `unit_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`circle_id`) REFERENCES `billing_circles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `billing_circles` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_circles_property_id_idx` ON `billing_circles` (`property_id`);--> statement-breakpoint
CREATE TABLE `co2_cost_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`year` integer NOT NULL,
	`fuel` text DEFAULT 'gas' NOT NULL,
	`fuel_kwh` real,
	`co2_kg` real NOT NULL,
	`co2_cost` integer NOT NULL,
	`area` real NOT NULL,
	`landlord_percent` integer NOT NULL,
	`amount` integer NOT NULL,
	`invoice_date` text,
	`claimed_on` text,
	`charge_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `co2_cost_splits_unique` ON `co2_cost_splits` (`lease_id`,`year`);--> statement-breakpoint
CREATE TABLE `consumer_price_index` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`month` text NOT NULL,
	`value` real NOT NULL,
	`base_year` text DEFAULT '2020' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consumer_price_index_unique` ON `consumer_price_index` (`account_id`,`base_year`,`month`);--> statement-breakpoint
CREATE TABLE `cost_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`betrkv_item` integer,
	`allocable` integer DEFAULT true NOT NULL,
	`consumption_based` integer DEFAULT false NOT NULL,
	`allocation_key_id` text,
	`billing_circle_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`allocation_key_id`) REFERENCES `allocation_keys`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`billing_circle_id`) REFERENCES `billing_circles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cost_categories_account_id_idx` ON `cost_categories` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cost_categories_name_unique` ON `cost_categories` (`account_id`,`name`);--> statement-breakpoint
CREATE TABLE `cost_item_unit_amounts` (
	`account_id` text NOT NULL,
	`cost_item_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`amount` integer NOT NULL,
	PRIMARY KEY(`cost_item_id`, `unit_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cost_items` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`category_id` text NOT NULL,
	`allocation_key_id` text NOT NULL,
	`billing_circle_id` text,
	`description` text NOT NULL,
	`supplier` text,
	`invoice_date` text,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`amount` integer NOT NULL,
	`allocable` integer DEFAULT true NOT NULL,
	`fuel` text,
	`fuel_kwh` real,
	`co2_kg` real,
	`co2_cost` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `cost_categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`allocation_key_id`) REFERENCES `allocation_keys`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`billing_circle_id`) REFERENCES `billing_circles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cost_items_account_id_idx` ON `cost_items` (`account_id`);--> statement-breakpoint
CREATE INDEX `cost_items_property_id_period_idx` ON `cost_items` (`property_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `deposit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`kind` text NOT NULL,
	`bank_transaction_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_transaction_id`) REFERENCES `bank_transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deposit_transactions_lease_id_idx` ON `deposit_transactions` (`lease_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deposit_transactions_bank_transaction_unique` ON `deposit_transactions` (`bank_transaction_id`) WHERE "deposit_transactions"."bank_transaction_id" is not null;--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`property_id` text,
	`unit_id` text,
	`lease_id` text,
	`tenant_id` text,
	`cost_item_id` text,
	`uploaded_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `documents_account_id_idx` ON `documents` (`account_id`);--> statement-breakpoint
CREATE INDEX `documents_lease_id_idx` ON `documents` (`lease_id`);--> statement-breakpoint
CREATE INDEX `documents_property_id_idx` ON `documents` (`property_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'manager' NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`invited_by` text,
	`accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_account_id_idx` ON `invitations` (`account_id`);--> statement-breakpoint
CREATE TABLE `lease_persons` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`persons` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lease_persons_unique` ON `lease_persons` (`lease_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `lease_units` (
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`unit_id` text NOT NULL,
	PRIMARY KEY(`lease_id`, `unit_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `lease_units_unit_id_idx` ON `lease_units` (`unit_id`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`email` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`first_failure_at` integer NOT NULL,
	`locked_until` integer
);
--> statement-breakpoint
CREATE TABLE `matching_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`field` text NOT NULL,
	`pattern` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `matching_rules_account_id_idx` ON `matching_rules` (`account_id`);--> statement-breakpoint
CREATE TABLE `meter_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`read_at` text NOT NULL,
	`value` real NOT NULL,
	`estimated` integer DEFAULT false NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meter_readings_unique` ON `meter_readings` (`meter_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `meters` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`unit_id` text,
	`kind` text NOT NULL,
	`serial_number` text,
	`unit` text NOT NULL,
	`location` text,
	`installed_at` text,
	`removed_at` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meters_property_id_idx` ON `meters` (`property_id`);--> statement-breakpoint
CREATE TABLE `operating_cost_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`corrects_id` text,
	`result` text,
	`result_version` integer DEFAULT 1 NOT NULL,
	`late_approval_justified` integer DEFAULT false NOT NULL,
	`approved_at` integer,
	`approved_by` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `operating_cost_statements_account_id_idx` ON `operating_cost_statements` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `operating_cost_statements_version_unique` ON `operating_cost_statements` (`property_id`,`period_start`,`period_end`,`version`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `password_resets_user_id_idx` ON `password_resets` (`user_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`bank_transaction_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_transaction_id`) REFERENCES `bank_transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `payments_account_id_idx` ON `payments` (`account_id`);--> statement-breakpoint
CREATE INDEX `payments_lease_id_date_idx` ON `payments` (`lease_id`,`date`);--> statement-breakpoint
CREATE INDEX `payments_bank_transaction_id_idx` ON `payments` (`bank_transaction_id`);--> statement-breakpoint
CREATE TABLE `rent_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`valid_from` text NOT NULL,
	`base_rent` integer NOT NULL,
	`operating_cost_prepayment` integer DEFAULT 0 NOT NULL,
	`heating_cost_prepayment` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`note` text,
	`index_month` text,
	`index_value` real,
	`letter_text` text,
	`delivered_on` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `rent_changes_account_id_idx` ON `rent_changes` (`account_id`);--> statement-breakpoint
CREATE INDEX `rent_changes_lease_id_valid_from_idx` ON `rent_changes` (`lease_id`,`valid_from`);--> statement-breakpoint
CREATE UNIQUE INDEX `rent_changes_approved_unique` ON `rent_changes` (`lease_id`,`valid_from`) WHERE "rent_changes"."status" = 'approved';--> statement-breakpoint
CREATE TABLE `rent_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`period` text NOT NULL,
	`due_date` text NOT NULL,
	`base_rent` integer DEFAULT 0 NOT NULL,
	`operating_cost_prepayment` integer DEFAULT 0 NOT NULL,
	`heating_cost_prepayment` integer DEFAULT 0 NOT NULL,
	`amount` integer NOT NULL,
	`kind` text NOT NULL,
	`reference_id` text,
	`reverses_charge_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rent_charges_account_id_idx` ON `rent_charges` (`account_id`);--> statement-breakpoint
CREATE INDEX `rent_charges_lease_id_period_idx` ON `rent_charges` (`lease_id`,`period`);--> statement-breakpoint
CREATE UNIQUE INDEX `rent_charges_rent_unique` ON `rent_charges` (`lease_id`,`period`) WHERE "rent_charges"."kind" = 'rent';--> statement-breakpoint
CREATE UNIQUE INDEX `rent_charges_reference_unique` ON `rent_charges` (`lease_id`,`reference_id`) WHERE "rent_charges"."reference_id" is not null and "rent_charges"."reverses_charge_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `rent_charges_reversal_unique` ON `rent_charges` (`reverses_charge_id`) WHERE "rent_charges"."reverses_charge_id" is not null;--> statement-breakpoint
CREATE TABLE `statement_results` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`statement_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`balance` integer NOT NULL,
	`result` text NOT NULL,
	`delivered_on` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`statement_id`) REFERENCES `operating_cost_statements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `statement_results_unique` ON `statement_results` (`statement_id`,`lease_id`);--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`title` text NOT NULL,
	`due_date` text,
	`done` integer DEFAULT false NOT NULL,
	`done_at` integer,
	`property_id` text,
	`lease_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_account_id_due_date_idx` ON `tasks` (`account_id`,`due_date`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `landlord_name` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `street` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `postal_code` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `city` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `iban` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `bank_name` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `trial_ends_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `subscription_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `current_period_end` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_stripe_customer_unique` ON `accounts` (`stripe_customer_id`) WHERE "accounts"."stripe_customer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_stripe_subscription_unique` ON `accounts` (`stripe_subscription_id`) WHERE "accounts"."stripe_subscription_id" is not null;--> statement-breakpoint
ALTER TABLE `leases` ADD `heating_cost_prepayment` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `kind` text DEFAULT 'residential' NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `rent_model` text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `operating_cost_model` text DEFAULT 'prepayment' NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `heating_cost_model` text DEFAULT 'prepayment' NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `persons` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `rent_due_day` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `ledger_start` text;--> statement-breakpoint
ALTER TABLE `leases` ADD `index_base_month` text;--> statement-breakpoint
ALTER TABLE `leases` ADD `index_base_value` real;--> statement-breakpoint
ALTER TABLE `leases` ADD `terminated_at` text;--> statement-breakpoint
ALTER TABLE `leases` ADD `terminated_by` text;--> statement-breakpoint
ALTER TABLE `leases` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `building_use` text DEFAULT 'residential' NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `vacancy_persons` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `salutation` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `street` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `postal_code` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `city` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `units` ADD `floor` text;--> statement-breakpoint
ALTER TABLE `units` ADD `rooms` real;--> statement-breakpoint
ALTER TABLE `units` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `users` ADD `role` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `name` text;