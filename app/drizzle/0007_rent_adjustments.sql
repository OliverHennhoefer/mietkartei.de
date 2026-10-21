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
ALTER TABLE `accounts` ADD `landlord_name` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `street` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `postal_code` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `city` text;--> statement-breakpoint
ALTER TABLE `leases` ADD `index_base_month` text;--> statement-breakpoint
ALTER TABLE `leases` ADD `index_base_value` real;--> statement-breakpoint
ALTER TABLE `leases` ADD `index_base_year` text DEFAULT '2020' NOT NULL;--> statement-breakpoint
ALTER TABLE `rent_changes` ADD `index_month` text;--> statement-breakpoint
ALTER TABLE `rent_changes` ADD `index_value` real;--> statement-breakpoint
ALTER TABLE `rent_changes` ADD `index_base_year` text DEFAULT '2020' NOT NULL;--> statement-breakpoint
ALTER TABLE `rent_changes` ADD `letter_text` text;--> statement-breakpoint
ALTER TABLE `rent_changes` ADD `letter_table` text;--> statement-breakpoint
ALTER TABLE `rent_changes` ADD `delivered_on` text;