CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_account_id_at_idx` ON `audit_log` (`account_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `properties` ADD `building_use` text DEFAULT 'residential' NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `vacancy_persons` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `units` ADD `floor` text;--> statement-breakpoint
ALTER TABLE `units` ADD `rooms` real;--> statement-breakpoint
ALTER TABLE `units` ADD `notes` text;