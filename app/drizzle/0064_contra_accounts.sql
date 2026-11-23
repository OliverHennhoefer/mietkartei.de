CREATE TABLE `contra_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`number` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`expense_category` text,
	`property_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contra_accounts_account_id_idx` ON `contra_accounts` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contra_accounts_number_unique` ON `contra_accounts` (`account_id`,`number`) WHERE "contra_accounts"."number" is not null;--> statement-breakpoint
CREATE INDEX `contra_accounts_property_id_idx` ON `contra_accounts` (`property_id`);--> statement-breakpoint
CREATE TABLE `other_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`contra_account_id` text,
	`property_id` text,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`bank_transaction_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contra_account_id`) REFERENCES `contra_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bank_transaction_id`) REFERENCES `bank_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `other_bookings_account_id_date_idx` ON `other_bookings` (`account_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `other_bookings_bank_transaction_unique` ON `other_bookings` (`bank_transaction_id`);--> statement-breakpoint
CREATE INDEX `other_bookings_contra_account_id_idx` ON `other_bookings` (`contra_account_id`);--> statement-breakpoint
CREATE INDEX `other_bookings_property_id_idx` ON `other_bookings` (`property_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_matching_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text,
	`contra_account_id` text,
	`name` text,
	`field` text NOT NULL,
	`pattern` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contra_account_id`) REFERENCES `contra_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_matching_rules`("id", "account_id", "lease_id", "contra_account_id", "name", "field", "pattern", "confirmed", "created_at") SELECT "id", "account_id", "lease_id", NULL, (SELECT 'Miete ' || `units`.`name` FROM `leases` JOIN `units` ON `units`.`id` = `leases`.`unit_id` WHERE `leases`.`id` = `matching_rules`.`lease_id`), "field", "pattern", "confirmed", "created_at" FROM `matching_rules`;--> statement-breakpoint
DROP TABLE `matching_rules`;--> statement-breakpoint
ALTER TABLE `__new_matching_rules` RENAME TO `matching_rules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `matching_rules_account_id_idx` ON `matching_rules` (`account_id`);--> statement-breakpoint
CREATE INDEX `matching_rules_lease_id_idx` ON `matching_rules` (`lease_id`);--> statement-breakpoint
CREATE INDEX `matching_rules_contra_account_id_idx` ON `matching_rules` (`contra_account_id`);--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `ledger_number` text;--> statement-breakpoint
ALTER TABLE `deposit_transactions` ADD `contra_account_id` text REFERENCES contra_accounts(id);--> statement-breakpoint
CREATE INDEX `deposit_transactions_contra_account_id_idx` ON `deposit_transactions` (`contra_account_id`);--> statement-breakpoint
ALTER TABLE `expenses` ADD `contra_account_id` text REFERENCES contra_accounts(id);--> statement-breakpoint
CREATE INDEX `expenses_contra_account_id_idx` ON `expenses` (`contra_account_id`);--> statement-breakpoint
ALTER TABLE `payments` ADD `contra_account_id` text REFERENCES contra_accounts(id);--> statement-breakpoint
CREATE INDEX `payments_contra_account_id_idx` ON `payments` (`contra_account_id`);