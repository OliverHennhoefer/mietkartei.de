CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`secret` text,
	`origin` text NOT NULL,
	`urgent_only` integer DEFAULT false NOT NULL,
	`details` integer DEFAULT false NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_sent_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_channels_account_id_idx` ON `notification_channels` (`account_id`);--> statement-breakpoint
CREATE INDEX `notification_channels_user_id_idx` ON `notification_channels` (`user_id`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`summary` text NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_deliveries_account_id_idx` ON `notification_deliveries` (`account_id`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_user_id_idx` ON `notification_deliveries` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_channel_id_idx` ON `notification_deliveries` (`channel_id`);--> statement-breakpoint
CREATE TABLE `notification_states` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`entry` text NOT NULL,
	`date` text NOT NULL,
	`stage` text,
	`snoozed_until` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_states_user_entry_unique` ON `notification_states` (`user_id`,`entry`);--> statement-breakpoint
CREATE INDEX `notification_states_account_id_idx` ON `notification_states` (`account_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `notification_hour` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notification_weekends` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `notifications_checked_on` text;