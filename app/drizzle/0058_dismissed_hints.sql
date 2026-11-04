CREATE TABLE `dismissed_hints` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dismissed_hints_user_key_unique` ON `dismissed_hints` (`user_id`,`key`);--> statement-breakpoint
CREATE INDEX `dismissed_hints_account_id_idx` ON `dismissed_hints` (`account_id`);