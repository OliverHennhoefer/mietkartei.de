DROP INDEX `expenses_bank_transaction_unique`;--> statement-breakpoint
CREATE INDEX `expenses_bank_transaction_id_idx` ON `expenses` (`bank_transaction_id`);