ALTER TABLE `notification_channels` ADD `label` text;--> statement-breakpoint
-- The Mitteilungen of the app replace ntfy. Its channels go with their history, as decided for
-- this release: they are settings of a user, not landlord data, and ntfy is not offered any more.
DELETE FROM `notification_channels` WHERE `kind` = 'ntfy';
