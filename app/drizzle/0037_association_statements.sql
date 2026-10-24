CREATE TABLE `association_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`allocable_costs` integer NOT NULL,
	`non_allocable_costs` integer NOT NULL,
	`reserve_contribution` integer NOT NULL,
	`fees_due` integer NOT NULL,
	`stated_balance` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `association_statements_account_id_idx` ON `association_statements` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `association_statements_period_unique` ON `association_statements` (`property_id`,`period_start`);