PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cost_item_unit_amounts` (
	`account_id` text NOT NULL,
	`cost_item_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`lease_id` text,
	`amount` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cost_item_id`) REFERENCES `cost_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_cost_item_unit_amounts`("account_id", "cost_item_id", "unit_id", "lease_id", "amount") SELECT "account_id", "cost_item_id", "unit_id", NULL, "amount" FROM `cost_item_unit_amounts`;--> statement-breakpoint
DROP TABLE `cost_item_unit_amounts`;--> statement-breakpoint
ALTER TABLE `__new_cost_item_unit_amounts` RENAME TO `cost_item_unit_amounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cost_item_unit_amounts_cost_item_id_idx` ON `cost_item_unit_amounts` (`cost_item_id`);--> statement-breakpoint
CREATE INDEX `cost_item_unit_amounts_account_id_idx` ON `cost_item_unit_amounts` (`account_id`);