ALTER TABLE `cost_items` ADD `association_total` integer;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `association_key` text;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `association_key_total` real;--> statement-breakpoint
ALTER TABLE `cost_items` ADD `association_key_share` real;--> statement-breakpoint
ALTER TABLE `properties` ADD `kind` text DEFAULT 'building' NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `association_manager` text;--> statement-breakpoint
ALTER TABLE `properties` ADD `ownership_share` real;--> statement-breakpoint
ALTER TABLE `properties` ADD `ownership_share_total` real;