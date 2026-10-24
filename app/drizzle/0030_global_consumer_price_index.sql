CREATE TABLE `consumer_price_index_fetches` (
	`id` text PRIMARY KEY NOT NULL,
	`attempted_at` integer NOT NULL,
	`succeeded_at` integer,
	`error` text
);
--> statement-breakpoint
DROP TABLE `consumer_price_index`;--> statement-breakpoint
CREATE TABLE `consumer_price_index` (
	`base_year` text NOT NULL,
	`month` text NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`base_year`, `month`)
);
