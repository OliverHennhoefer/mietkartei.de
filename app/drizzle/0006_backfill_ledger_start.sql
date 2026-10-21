-- Leases that existed before the rent ledger: like a lease entered today, their ledger starts
-- with the current month, so years without booked payments do not show up as arrears. Leases
-- that ended before this month keep their whole term.
UPDATE `leases` SET `ledger_start` = date('now', 'start of month')
WHERE `ledger_start` IS NULL
	AND `start_date` < date('now', 'start of month')
	AND (`end_date` IS NULL OR `end_date` >= date('now', 'start of month'));
