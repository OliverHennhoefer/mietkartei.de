CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `trial_ends_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `subscription_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `current_period_end` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_stripe_customer_unique` ON `accounts` (`stripe_customer_id`) WHERE "accounts"."stripe_customer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_stripe_subscription_unique` ON `accounts` (`stripe_subscription_id`) WHERE "accounts"."stripe_subscription_id" is not null;