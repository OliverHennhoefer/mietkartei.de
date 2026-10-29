# Database migrations

From 2 November 2026 on, every migration keeps the existing data: app.mietkartei.de, the self-hosted copies on Cloudflare and the Docker installations all upgrade their databases in place. This guide describes how to change the schema without losing data and how to recover when something goes wrong anyway.

## How migrations run

The schema lives in [`app/src/lib/server/db/schema.ts`](../app/src/lib/server/db/schema.ts). `npm run db:generate` in `app/` writes the difference as a new SQL file to `app/drizzle/` and records it in `app/drizzle/meta/_journal.json`. Both targets apply the same files:

- **Cloudflare (D1):** `wrangler d1 migrations apply DB --remote` in the deploy job (and in `npm run deploy` of a self-hosted copy) runs every file not yet listed in the database's `d1_migrations` table, by file name, before the new Worker goes live.
- **Node (Docker):** the app runs Drizzle's migrator when it opens the database. It records applied migrations in `__drizzle_migrations` by the journal timestamp and runs every migration newer than the last one applied, all in one transaction.

D1 always enforces foreign keys, and SQLite ignores `PRAGMA foreign_keys=OFF` inside a transaction. The `PRAGMA foreign_keys=OFF` lines that drizzle-kit writes therefore do nothing on either target.

## Rules

1. **Never change or delete a merged migration.** Deployed databases record it as applied and never run it again; a fix goes into a new migration. CI fails a pull request that changes or removes one.
2. **Only add.** New tables, new nullable columns or columns with a constant default, new indexes and data backfills are safe. The running Worker uses the new schema for a few seconds before the new code is live, so the old code must keep working with it.
3. **Remove in two steps (expand and contract).** To rename, retype or drop a column: add the new column and backfill it, release code that uses only the new column, and drop the old column in a later pull request. `ALTER TABLE … RENAME COLUMN` and `DROP COLUMN` work in place on both targets; `DROP COLUMN` needs the column's indexes dropped first.
4. **Never let drizzle-kit rebuild a referenced table as generated.** Changing a default, `NOT NULL`, a foreign key action or a column type makes drizzle-kit create `__new_<table>`, copy the rows, `DROP TABLE` the old one and rename. Dropping a table deletes its rows first, and that delete runs every `ON DELETE CASCADE` and `SET NULL` of the tables pointing at it, even with `PRAGMA defer_foreign_keys`. Rebuilding `meters` this way silently deletes every `meter_readings` row; rebuilding `accounts` deletes everything.
5. **Write data backfills in SQL in the migration**, not in app code at startup, so they run exactly once and in the same transaction as the schema change.

When a rebuild of a referenced table cannot be avoided, keep the dependent rows yourself in the same migration and put them back after the rename, for every table that cascades from it (recursively) and every `SET NULL` column pointing at it:

```sql
CREATE TABLE `__keep_meter_readings` AS SELECT * FROM `meter_readings`;--> statement-breakpoint
-- the generated CREATE TABLE `__new_meters`, INSERT … SELECT, DROP TABLE `meters`, RENAME
INSERT INTO `meter_readings` SELECT * FROM `__keep_meter_readings`;--> statement-breakpoint
DROP TABLE `__keep_meter_readings`;
```

## What CI checks

[`migrations.spec.ts`](../app/src/lib/server/db/migrations.spec.ts) applies all migrations one after the other to a database that has rows in every table, adding a row to each table before every step. It fails when a migration loses a row or a value in a column that still exists, or leaves a broken foreign key, so the cascade of rule 4 shows up before the merge. It also checks that the journal lists every file in order with increasing timestamps (the node migrator skips an older one) and that every foreign key column leads an index, so deleting a parent row does not scan the whole child table.

A migration that is meant to delete data is not allowed after 2 November 2026. Before that date, such migrations are listed in `intendedLosses` in the test.

Add a focused test to `migrations.spec.ts` for every migration that moves data, like the existing ones for `0028` and `0052`: realistic rows before, the expected rows after.

## Backups and restore

- **app.mietkartei.de and the demo:** D1 Time Travel restores a database to any minute of the last 30 days (7 days on the Workers Free plan). The deploy job writes the time before it applies migrations into its summary, with the command to return to it:

  ```sh
  npx wrangler d1 time-travel restore mietkartei --timestamp=<time from the job summary>
  ```

  A restore replaces the whole database, including what users entered after that time. Deploy the previous app version afterwards, as `d1_migrations` is restored as well and the next deploy applies the migration again.

- **Self-hosted on Cloudflare:** the same command with the copy's database name, in the copy's repository.

- **Docker:** before the app applies new migrations, it writes a snapshot of the database to `backups/mietkartei-before-<first new migration>.db` next to the database file (in the image: `/data/backups/`) and keeps the last three. To restore, stop the container, copy the snapshot over `mietkartei.db`, remove `mietkartei.db-wal` and `mietkartei.db-shm`, and start the previous image version. See [SELF_HOSTING.md](SELF_HOSTING.md#backups) for regular backups.
