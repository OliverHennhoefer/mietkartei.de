CREATE TABLE `deposit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deposit_transactions_lease_id_idx` ON `deposit_transactions` (`lease_id`);--> statement-breakpoint
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
ALTER TABLE `leases` ADD `heating_cost_prepayment` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `kind` text DEFAULT 'residential' NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `rent_model` text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `operating_cost_model` text DEFAULT 'prepayment' NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `heating_cost_model` text DEFAULT 'prepayment' NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `persons` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `terminated_at` text;--> statement-breakpoint
ALTER TABLE `leases` ADD `terminated_by` text;--> statement-breakpoint
ALTER TABLE `leases` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `salutation` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `street` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `postal_code` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `city` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `notes` text;