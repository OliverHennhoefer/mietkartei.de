CREATE TABLE `handover_protocols` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`attendees` text,
	`rooms` text NOT NULL,
	`keys` text NOT NULL,
	`readings` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `handover_protocols_account_id_idx` ON `handover_protocols` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `handover_protocols_lease_kind_unique` ON `handover_protocols` (`lease_id`,`kind`);