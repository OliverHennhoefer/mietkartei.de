CREATE TABLE `contractors` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`trade` text,
	`phone` text,
	`email` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contractors_account_id_idx` ON `contractors` (`account_id`);--> statement-breakpoint
ALTER TABLE `expenses` ADD `task_id` text REFERENCES tasks(id);--> statement-breakpoint
CREATE INDEX `expenses_task_id_idx` ON `expenses` (`task_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `contractor_id` text REFERENCES contractors(id);