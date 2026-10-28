CREATE TABLE `deposit_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`date` text NOT NULL,
	`payout` integer NOT NULL,
	`remaining` integer NOT NULL,
	`items` text NOT NULL,
	`letter_text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deposit_settlements_account_id_idx` ON `deposit_settlements` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deposit_settlements_lease_unique` ON `deposit_settlements` (`lease_id`);--> statement-breakpoint
ALTER TABLE `deposit_transactions` ADD `settlement_id` text REFERENCES deposit_settlements(id);--> statement-breakpoint
ALTER TABLE `payments` ADD `settlement_id` text REFERENCES deposit_settlements(id);