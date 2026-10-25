ALTER TABLE `accounts` ADD `stripe_price_id` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `founder` integer DEFAULT false NOT NULL;