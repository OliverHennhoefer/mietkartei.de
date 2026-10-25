CREATE TABLE `bank_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`aspsp_name` text NOT NULL,
	`aspsp_country` text NOT NULL,
	`state` text,
	`session_id` text,
	`account_uid` text,
	`valid_until` integer,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_connections_bank_account_unique` ON `bank_connections` (`bank_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bank_connections_state_unique` ON `bank_connections` (`state`) WHERE "bank_connections"."state" is not null;--> statement-breakpoint
CREATE INDEX `bank_connections_account_id_idx` ON `bank_connections` (`account_id`);