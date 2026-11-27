CREATE TABLE `tenant_meter_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`read_at` text NOT NULL,
	`value` real NOT NULL,
	`note` text,
	`document_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tenant_meter_reports_account_id_idx` ON `tenant_meter_reports` (`account_id`);--> statement-breakpoint
CREATE INDEX `tenant_meter_reports_lease_id_idx` ON `tenant_meter_reports` (`lease_id`);--> statement-breakpoint
CREATE INDEX `tenant_meter_reports_meter_id_idx` ON `tenant_meter_reports` (`meter_id`);--> statement-breakpoint
CREATE INDEX `tenant_meter_reports_document_id_idx` ON `tenant_meter_reports` (`document_id`);--> statement-breakpoint
CREATE TABLE `tenant_portals` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `leases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_portals_lease_id_unique` ON `tenant_portals` (`lease_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_portals_token_hash_unique` ON `tenant_portals` (`token_hash`);--> statement-breakpoint
CREATE INDEX `tenant_portals_account_id_idx` ON `tenant_portals` (`account_id`);--> statement-breakpoint
ALTER TABLE `documents` ADD `task_id` text REFERENCES tasks(id);--> statement-breakpoint
ALTER TABLE `documents` ADD `shared_with_tenant` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `documents_task_id_idx` ON `documents` (`task_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `reported_by_tenant` integer DEFAULT false NOT NULL;