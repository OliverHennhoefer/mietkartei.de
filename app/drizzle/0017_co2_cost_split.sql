CREATE TABLE `co2_cost_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`year` integer NOT NULL,
	`fuel` text NOT NULL,
	`fuel_kwh` real,
	`co2_kg` real NOT NULL,
	`co2_cost` integer NOT NULL,
	`area` real NOT NULL,
	`landlord_percent` integer NOT NULL,
	`amount` integer NOT NULL,
	`invoice_date` text,
	`claimed_on` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `co2_cost_splits_account_id_idx` ON `co2_cost_splits` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `co2_cost_splits_unique` ON `co2_cost_splits` (`lease_id`,`year`);--> statement-breakpoint
ALTER TABLE `cost_items` ADD `fuel` text;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `fuel_kwh` real;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `co2_kg` real;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `co2_cost` integer;