CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`title` text NOT NULL,
	`due_date` text,
	`done` integer DEFAULT false NOT NULL,
	`done_at` integer,
	`property_id` text,
	`lease_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_account_id_idx` ON `tasks` (`account_id`);