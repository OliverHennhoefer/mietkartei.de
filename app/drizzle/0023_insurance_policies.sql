CREATE TABLE `insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`property_id` text NOT NULL,
	`kind` text NOT NULL,
	`insurer` text NOT NULL,
	`policy_number` text,
	`annual_premium` integer NOT NULL,
	`renewal_date` text NOT NULL,
	`notice_months` integer DEFAULT 3 NOT NULL,
	`end_date` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `insurance_policies_account_id_idx` ON `insurance_policies` (`account_id`);--> statement-breakpoint
CREATE INDEX `insurance_policies_property_id_idx` ON `insurance_policies` (`property_id`);