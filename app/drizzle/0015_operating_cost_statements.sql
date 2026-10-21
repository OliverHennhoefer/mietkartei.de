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
CREATE INDEX `statement_results_account_id_idx` ON `statement_results` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `statement_results_unique` ON `statement_results` (`statement_id`,`lease_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `iban` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `bank_name` text;--> statement-breakpoint
ALTER TABLE `rent_charges` ADD `reference_id` text;--> statement-breakpoint
ALTER TABLE `rent_charges` ADD `reverses_charge_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `rent_charges_reference_unique` ON `rent_charges` (`lease_id`,`reference_id`) WHERE "rent_charges"."reference_id" is not null and "rent_charges"."reverses_charge_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `rent_charges_reversal_unique` ON `rent_charges` (`reverses_charge_id`,`reference_id`) WHERE "rent_charges"."reverses_charge_id" is not null;