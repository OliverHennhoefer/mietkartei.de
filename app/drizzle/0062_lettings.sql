CREATE TABLE `applicants` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`letting_id` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`salutation` text,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text,
	`phone` text,
	`street` text,
	`postal_code` text,
	`city` text,
	`viewing_at` text,
	`birth_date` text,
	`adults` integer,
	`children` integer,
	`occupation` text,
	`employer` text,
	`net_income` integer,
	`pets` text,
	`insolvency` integer,
	`has_wbs` integer,
	`move_in_date` text,
	`co_first_name` text,
	`co_last_name` text,
	`co_birth_date` text,
	`co_occupation` text,
	`co_employer` text,
	`message` text,
	`notes` text,
	`rating` integer,
	`id_checked_on` text,
	`credit_proof_on` text,
	`income_proof_on` text,
	`wbs_proof_on` text,
	`disclosure_token_hash` text,
	`disclosure_expires_at` integer,
	`disclosure_submitted_at` integer,
	`decided_on` text,
	`tenant_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`letting_id`) REFERENCES `lettings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `applicants_account_id_idx` ON `applicants` (`account_id`);--> statement-breakpoint
CREATE INDEX `applicants_letting_id_idx` ON `applicants` (`letting_id`);--> statement-breakpoint
CREATE INDEX `applicants_tenant_id_idx` ON `applicants` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `applicants_disclosure_token_unique` ON `applicants` (`disclosure_token_hash`) WHERE "applicants"."disclosure_token_hash" is not null;--> statement-breakpoint
CREATE TABLE `lettings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`available_from` text,
	`base_rent` integer DEFAULT 0 NOT NULL,
	`operating_cost_prepayment` integer DEFAULT 0 NOT NULL,
	`heating_cost_prepayment` integer DEFAULT 0 NOT NULL,
	`security_deposit` integer DEFAULT 0 NOT NULL,
	`requires_wbs` integer DEFAULT false NOT NULL,
	`notes` text,
	`closed_at` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lettings_account_id_idx` ON `lettings` (`account_id`);--> statement-breakpoint
CREATE INDEX `lettings_unit_id_idx` ON `lettings` (`unit_id`);