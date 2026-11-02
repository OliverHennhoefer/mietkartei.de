ALTER TABLE `leases` ADD `parking_rent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rent_changes` ADD `parking_rent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rent_charges` ADD `parking_rent` integer DEFAULT 0 NOT NULL;