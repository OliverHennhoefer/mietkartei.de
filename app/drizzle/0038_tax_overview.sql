CREATE TABLE `tax_years` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`year` integer NOT NULL,
	`loan_interest` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tax_years_account_id_idx` ON `tax_years` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tax_years_property_year_unique` ON `tax_years` (`property_id`,`year`);--> statement-breakpoint
ALTER TABLE `association_statements` ADD `reserve_withdrawal` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `acquisition_date` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `acquisition_cost` integer;--> statement-breakpoint
ALTER TABLE `properties` ADD `building_share` real;--> statement-breakpoint
ALTER TABLE `properties` ADD `depreciation_rate` real;--> statement-breakpoint
UPDATE `expenses` SET `category` = 'loan_payment' WHERE `category` = 'financing';