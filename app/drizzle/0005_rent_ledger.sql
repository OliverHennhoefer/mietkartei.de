CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payments_account_id_idx` ON `payments` (`account_id`);--> statement-breakpoint
CREATE INDEX `payments_lease_id_date_idx` ON `payments` (`lease_id`,`date`);--> statement-breakpoint
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
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rent_charges_account_id_idx` ON `rent_charges` (`account_id`);--> statement-breakpoint
CREATE INDEX `rent_charges_lease_id_period_idx` ON `rent_charges` (`lease_id`,`period`);--> statement-breakpoint
CREATE UNIQUE INDEX `rent_charges_rent_unique` ON `rent_charges` (`lease_id`,`period`) WHERE "rent_charges"."kind" = 'rent';--> statement-breakpoint
ALTER TABLE `leases` ADD `rent_due_day` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `leases` ADD `ledger_start` text;