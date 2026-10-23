CREATE TABLE `calendar_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_user_id_unique` ON `calendar_feeds` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_token_hash_unique` ON `calendar_feeds` (`token_hash`);--> statement-breakpoint
CREATE TABLE `insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`kind` text NOT NULL,
	`insurer` text NOT NULL,
	`policy_number` text,
	`annual_premium` integer NOT NULL,
	`renewal_date` text NOT NULL,
	`notice_months` integer DEFAULT 3 NOT NULL,
	`end_date` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `insurance_policies_account_id_idx` ON `insurance_policies` (`account_id`);--> statement-breakpoint
CREATE INDEX `insurance_policies_property_id_idx` ON `insurance_policies` (`property_id`);--> statement-breakpoint
ALTER TABLE `cost_items` ADD `insurance_policy_id` text REFERENCES insurance_policies(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `tasks` ADD `category` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `repeat_months` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `repeat_anchor` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `follow_up_id` text;