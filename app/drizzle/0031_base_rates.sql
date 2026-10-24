CREATE TABLE `base_rates` (
	`valid_from` text PRIMARY KEY NOT NULL,
	`rate` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `public_data_fetches` (
	`id` text PRIMARY KEY NOT NULL,
	`attempted_at` integer NOT NULL,
	`succeeded_at` integer,
	`error` text
);

--> statement-breakpoint
-- Basiszinssatz since 2015 as published by the Deutsche Bundesbank, in basis points.
INSERT INTO `base_rates` (`valid_from`, `rate`) VALUES
	('2015-01-01', -83),
	('2015-07-01', -83),
	('2016-01-01', -83),
	('2016-07-01', -88),
	('2017-01-01', -88),
	('2017-07-01', -88),
	('2018-01-01', -88),
	('2018-07-01', -88),
	('2019-01-01', -88),
	('2019-07-01', -88),
	('2020-01-01', -88),
	('2020-07-01', -88),
	('2021-01-01', -88),
	('2021-07-01', -88),
	('2022-01-01', -88),
	('2022-07-01', -88),
	('2023-01-01', 162),
	('2023-07-01', 312),
	('2024-01-01', 362),
	('2024-07-01', 337),
	('2025-01-01', 227),
	('2025-07-01', 127),
	('2026-01-01', 127),
	('2026-07-01', 152);
