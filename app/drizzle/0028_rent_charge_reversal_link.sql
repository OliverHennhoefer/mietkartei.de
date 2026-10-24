PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rent_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`period` text NOT NULL,
	`due_date` text,
	`base_rent` integer DEFAULT 0 NOT NULL,
	`operating_cost_prepayment` integer DEFAULT 0 NOT NULL,
	`heating_cost_prepayment` integer DEFAULT 0 NOT NULL,
	`amount` integer NOT NULL,
	`kind` text NOT NULL,
	`reference_id` text,
	`reverses_charge_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reverses_charge_id`) REFERENCES `__new_rent_charges`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_rent_charges`("id", "account_id", "lease_id", "period", "due_date", "base_rent", "operating_cost_prepayment", "heating_cost_prepayment", "amount", "kind", "reference_id", "reverses_charge_id", "note", "created_at") SELECT "id", "account_id", "lease_id", "period", "due_date", "base_rent", "operating_cost_prepayment", "heating_cost_prepayment", "amount", "kind", "reference_id", "reverses_charge_id", "note", "created_at" FROM `rent_charges`;--> statement-breakpoint
DROP TABLE `rent_charges`;--> statement-breakpoint
ALTER TABLE `__new_rent_charges` RENAME TO `rent_charges`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `rent_charges_account_id_idx` ON `rent_charges` (`account_id`);--> statement-breakpoint
CREATE INDEX `rent_charges_lease_id_period_idx` ON `rent_charges` (`lease_id`,`period`);--> statement-breakpoint
CREATE UNIQUE INDEX `rent_charges_rent_unique` ON `rent_charges` (`lease_id`,`period`) WHERE "rent_charges"."kind" = 'rent';--> statement-breakpoint
CREATE UNIQUE INDEX `rent_charges_reference_unique` ON `rent_charges` (`lease_id`,`reference_id`) WHERE "rent_charges"."reference_id" is not null and "rent_charges"."reverses_charge_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `rent_charges_reversal_unique` ON `rent_charges` (`reverses_charge_id`,`reference_id`) WHERE "rent_charges"."reverses_charge_id" is not null;