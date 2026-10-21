-- Leases that existed before the rent history: their rent becomes the `initial` change, their
-- persons count the first lease_persons row, and their kind follows the unit.
INSERT INTO `rent_changes` (`id`, `account_id`, `lease_id`, `valid_from`, `base_rent`, `operating_cost_prepayment`, `heating_cost_prepayment`, `reason`, `status`, `created_at`)
SELECT lower(hex(randomblob(16))), `account_id`, `id`, `start_date`, `base_rent`, `operating_cost_prepayment`, `heating_cost_prepayment`, 'initial', 'approved', `created_at`
FROM `leases`
WHERE `id` NOT IN (SELECT `lease_id` FROM `rent_changes` WHERE `reason` = 'initial');--> statement-breakpoint
INSERT INTO `lease_persons` (`id`, `account_id`, `lease_id`, `valid_from`, `persons`, `created_at`)
SELECT lower(hex(randomblob(16))), `account_id`, `id`, `start_date`, `persons`, `created_at`
FROM `leases`
WHERE `id` NOT IN (SELECT `lease_id` FROM `lease_persons`);--> statement-breakpoint
UPDATE `leases` SET `kind` = (
	SELECT CASE `units`.`kind` WHEN 'commercial' THEN 'commercial' WHEN 'parking' THEN 'parking' ELSE 'residential' END
	FROM `units` WHERE `units`.`id` = `leases`.`unit_id`
) WHERE `kind` = 'residential';
