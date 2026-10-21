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
ALTER TABLE `documents` ADD `cost_item_id` text;