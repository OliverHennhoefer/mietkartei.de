CREATE TABLE `payment_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`level` integer NOT NULL,
	`date` text NOT NULL,
	`payment_deadline` text NOT NULL,
	`amount` integer NOT NULL,
	`items` text NOT NULL,
	`letter_text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_reminders_account_id_idx` ON `payment_reminders` (`account_id`);--> statement-breakpoint
CREATE INDEX `payment_reminders_lease_id_date_idx` ON `payment_reminders` (`lease_id`,`date`);