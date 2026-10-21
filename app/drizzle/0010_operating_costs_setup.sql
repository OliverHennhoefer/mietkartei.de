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
ALTER TABLE `accounts` ADD `operating_cost_defaults_seeded` integer DEFAULT false NOT NULL;