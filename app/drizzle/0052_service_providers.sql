ALTER TABLE `contractors` RENAME TO `service_providers`;--> statement-breakpoint
ALTER TABLE `service_providers` RENAME COLUMN `trade` TO `service`;--> statement-breakpoint
DROP INDEX `contractors_account_id_idx`;--> statement-breakpoint
CREATE INDEX `service_providers_account_id_idx` ON `service_providers` (`account_id`);--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `contractor_id` TO `service_provider_id`;--> statement-breakpoint
ALTER TABLE `expenses` ADD `service_provider_id` text REFERENCES service_providers(id);--> statement-breakpoint
CREATE INDEX `expenses_service_provider_id_idx` ON `expenses` (`service_provider_id`);
