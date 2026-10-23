ALTER TABLE `tasks` ADD `category` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `repeat_months` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `follow_up_id` text;