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
ALTER TABLE `deposit_transactions` ADD `bank_transaction_id` text REFERENCES bank_transactions(id);--> statement-breakpoint
CREATE UNIQUE INDEX `deposit_transactions_bank_transaction_unique` ON `deposit_transactions` (`bank_transaction_id`) WHERE "deposit_transactions"."bank_transaction_id" is not null;--> statement-breakpoint
ALTER TABLE `payments` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `bank_transaction_id` text REFERENCES bank_transactions(id);--> statement-breakpoint
CREATE INDEX `payments_bank_transaction_id_idx` ON `payments` (`bank_transaction_id`);