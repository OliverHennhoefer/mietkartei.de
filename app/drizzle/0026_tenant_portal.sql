CREATE TABLE `damage_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`location` text,
	`urgent` integer DEFAULT false NOT NULL,
	`reporter_name` text,
	`reporter_phone` text,
	`status` text DEFAULT 'new' NOT NULL,
	`reply` text,
	`task_id` text,
	`updated_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `damage_reports_account_id_idx` ON `damage_reports` (`account_id`);--> statement-breakpoint
CREATE INDEX `damage_reports_lease_id_idx` ON `damage_reports` (`lease_id`);--> statement-breakpoint
CREATE TABLE `portal_links` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_links_lease_id_unique` ON `portal_links` (`lease_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portal_links_token_hash_unique` ON `portal_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `portal_links_account_id_idx` ON `portal_links` (`account_id`);--> statement-breakpoint
ALTER TABLE `documents` ADD `damage_report_id` text REFERENCES damage_reports(id) ON UPDATE no action ON DELETE set null;