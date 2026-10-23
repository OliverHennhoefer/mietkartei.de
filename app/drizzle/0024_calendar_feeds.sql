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
CREATE UNIQUE INDEX `calendar_feeds_token_hash_unique` ON `calendar_feeds` (`token_hash`);