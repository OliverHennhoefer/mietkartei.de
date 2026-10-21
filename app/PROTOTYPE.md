# Prototype design: the whole app in one branch

This branch builds the complete mietkartei app as a spike, so the PRD and TDD can be checked against
a running product. It is never merged as a whole: features are ported to `main` one at a time in
small PRs. This file is the shared design every part of the spike follows, so the parts fit
together. It is written for contributors and agents who build one feature each, and it was
revised after an adversarial review of the first draft (legal, runtime, data, coverage, build and
UX lenses); the findings that were accepted are folded in below, the ones that were not are listed
under "Assumptions and open questions".

## Decisions that differ from the TDD

| TDD says                           | Spike does                                                         | Why                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Python, FastAPI, PostgreSQL, React | SvelteKit 3, Svelte 5, Drizzle, SQLite/D1                          | The stack decision on `main` and the owner's choice of Cloudflare + D1 win over the older TDD |
| Decimal/NUMERIC money              | Integer euro cents                                                 | SQLite has no decimal type; cents plus sum-preserving rounding is exact                       |
| FinTS via python-fints on Netcup   | CSV import (bank presets) and manual entry behind a bank adapter   | Workers cannot run FinTS; a FinTS adapter needs a product id and a long-running host          |
| restic + Hetzner Storage Box       | Not part of the app                                                | D1 has point-in-time restore; self-hosting keeps the backup section of SELF_HOSTING.md        |
| Netcup deployment                  | Cloudflare Workers (hosted) and Docker (self-hosted), as on `main` |                                                                                               |
| Files on a Netcup volume           | Storage adapter: filesystem (node) or R2 (cloudflare)              |                                                                                               |
| VPI from GENESIS                   | VPI values entered by hand under `/einstellungen/vpi`              | No external fetch in the spike; a GENESIS import is a later feature                           |
| HAUS/DATEV import option           | Not built; the user maps a CSV export of the old software          | See `/import`                                                                                 |
| PDF rendering                      | `pdf-lib` (pure JS, runs on Workers and Node), Helvetica           | No headless browser on Workers; see "PDFs" below                                              |

Everything else in PRD.md and TDD.md is in scope. Where they are silent, this file decides, and the
PR lists every such assumption (section "Assumptions and open questions").

The migrations of this branch are throwaway: when a feature is ported, its schema additions are
copied into `main`'s `schema.ts` and `npm run db:generate` creates that PR's migration. Nobody
upgrades a database from this branch to `main`. The "additive only" rule still holds here, so a
database from `main` upgrades into the spike for testing.

## Conventions

- **Language.** Code, comments, identifiers, commit messages: English. UI text, validation
  messages, letters and PDF content: German, informal "du", as on `main`. Domain terms use the
  glossary in CONTRIBUTING.md plus the glossary below.
- **Money** is an `integer` column in euro cents, named without a suffix (`baseRent`, `amount`),
  documented as cents in the schema comment. Formatting and parsing live in `src/lib/money.ts`:
  `formatCents(cents)` → `1.234,56 €`, `formatCentsPlain`, `formatCentsSigned`,
  `parseCents('1.234,56')` → `123456` (accepts `1234.56` too), `proRata(amount, num, den)`
  (half-up; a negative half rounds away from zero, so a credit cancels its positive twin).
- **Distribution** of an amount over shares uses `distributeCents(total, weights)` from
  `src/lib/money.ts`: largest-remainder rounding, so the parts always sum to the total, ties broken
  by index, so the result is reproducible.
- **Dates** are ISO strings `YYYY-MM-DD` in `text` columns; months are `YYYY-MM`. Helpers in
  `src/lib/dates.ts`: `today()` (the date in Europe/Berlin, whatever time zone the server runs
  in; every "current date/month" check uses it), `addDays`, `addMonths`, `daysBetween`,
  `daysInclusive`, `overlap`/`overlapDays(a, b)` on closed ranges, `monthOf`, `firstOfMonth`,
  `lastOfMonth`, `monthRange`, `monthsInRange`, `nthWorkingDay(month, n)` (Monday–Friday, no
  holidays), `parseGermanDate('31.12.2026')`, `formatDate` → `31.12.2026`, `formatMonth` →
  `März 2026`. Timestamps are `integer` `timestamp_ms` as on `main`.
- **Ids** are `crypto.randomUUID()` strings, as on `main`.
- **Every table** that holds account data has `accountId`, including join tables, and every query
  filters by it. Server modules take `(db, accountId, ...)` for reads and
  `(db, context: AuditContext, ...)` for writes (`AuditContext = { accountId, userId }`, built by
  `auditContext(locals)` from `src/lib/server/session.ts`). Lookups across tables (the lease of a
  payment, the unit of a lease) re-check the account id, never trust an id from a form. Server
  modules load a page's data with a fixed number of queries (one per table, filtered by
  accountId/propertyId/`inArray` of ids), never one query per row: D1 counts queries per request.
- **Roles.** `users.role` is `owner` or `manager`. Managers edit everything except: invitations,
  bank accounts (adding/removing), billing, account deletion. `requireOwner(locals)` in
  `src/lib/server/session.ts` enforces that in load functions and actions; `requireAccount(locals)`
  and `requireUser(locals)` are the everyday guards.
- **Audit log.** Every change a landlord would want to look up later writes one line through
  `logChange(db, context, entity, entityId, action, summary)` or, inside a batch,
  `auditEntry(...)` from `src/lib/server/audit.ts`. `action` is a plain text verb (the known ones
  are listed in `auditActions` in `schema.ts`: create, update, delete, approve, correct, import,
  invite, post, assign, undo, ignore, upload, reset, export); the summary is one German sentence a
  landlord understands. Covered: properties/units, tenants, leases, rent changes, persons, deposit,
  payments and postings, bank imports/assignments, cost items, readings, keys/circles, statements,
  documents, tasks, invitations, password change/reset (userId null, no email in the summary),
  exports, settings.
- **D1 limits.** No interactive transactions: multi-statement writes go through
  `runBatch(db, [stmt, ...])` from `src/lib/server/db/batch.ts` (`db.batch` on D1, a synchronous
  transaction on SQLite). Statements are query builders (`db.insert(...).values(...)`, `.update`,
  `.delete`), never closures; every id used inside a batch is generated in JS before the batch,
  and no statement may depend on the result of an earlier one. At most 100 bound parameters per
  statement: bulk inserts are split with `chunk(rows, rowsPerStatement(table))`, `inArray` lists
  with `chunkIds(ids)`. A batch is all-or-nothing, so inserts that may hit a unique index on
  purpose (bank transactions, rent charges) use `.onConflictDoNothing()` and count duplicates by
  selecting first. Unit tests exercise the SQLite branch; the D1 branch is covered by the
  cloudflare e2e run, so every feature that writes a batch has an e2e test that performs that
  write.
- **Forms** are SvelteKit form actions with `use:enhance`, server-side validation in
  `src/lib/forms/<feature>.ts` built on `FormParser<T>` from `src/lib/forms/fields.ts`:
  `text`, `optionalText`, `money`, `number`, `date`, `month`, `oneOf`, `id`, `ids`, `email`,
  `iban`, `file`, `flag`, `fail`, `result(() => data)` → `ParseResult<T>` (`{ ok: true, data }` or
  `{ ok: false, errors, values }`). A failed action returns `fail(400, { errors, values })` and the
  page re-renders the values with `defaultValue`, as on `main`; `formDataOf()` builds a FormData in
  tests and in the CSV import. No client-side state libraries. Every state change is a POST form
  action; SvelteKit's origin check is the CSRF protection (so `ORIGIN` must be set behind a
  proxy); `/webhooks/stripe` verifies the Stripe signature instead and is the only POST without a
  session.
- **Pages** use the shared components in `src/lib/components/`: `PageHeader` (title, lead, back,
  actions snippet; sets the `<title>`), `Tabs`, `EmptyState`, `ConfirmButton` (a POST form with a
  confirm dialog), `Field` (label + error + hint), `Badge`, `Money`, `Alert`, and the classes in
  `app.css` (`.table-wrap` + `table.table` + `.num`, `.stats`/`.stat`, `form.card`,
  `.form-actions`, `.toolbar`, `.row`, `.between`, `.stack`, `dl.details`, button variants
  `.secondary`, `.danger`, `.link`, `.small`). There is no `DataTable` component; tables are plain
  `<table class="table">`. Feature components are prefixed with the feature name
  (`BankTransactionRow.svelte`). Feature-specific styles go into the page's own `<style>` block.
  Links use plain `href` strings; the ESLint rule allows it.
- **Edit convention.** A detail page shows, a `/bearbeiten` sibling edits, deletes are a
  `ConfirmButton` on the detail page. Pages under a tabbed layout (see "Layouts") render only `h2`
  sections and put their primary actions in a `<div class="toolbar">`, not in a `PageHeader`.
- **PDFs** are rendered with `renderLetter(letter)` from `src/lib/server/pdf.ts` (pdf-lib,
  Helvetica, WinAnsi): the renderer maps characters WinAnsi cannot encode (`₂` → `2`), so letters
  and statements write "CO2" in PDFs and "CO₂" on pages. `pdfResponse(bytes, filename)` builds the
  download response.
- **CSV** files are decoded and parsed with `src/lib/csv.ts` (`decodeCsv` UTF-8 with BOM, falling
  back to windows-1252; `parseCsv` with `;`/`,`/tab detection and RFC 4180 quoting; `findHeaderRow`,
  `toRecords`, `csvLine`). Amounts are parsed with `parseCents`, dates with `parseGermanDate`.
- **Tests.** Pure logic in `src/lib/domain/*` has unit tests with reference numbers worked out by
  hand in the test. Server modules are tested against `testDatabase()` from
  `src/lib/server/testing.ts` (in-memory SQLite with accounts `a` and `b`, one owner each, plus
  `seedUnit`, `seedTenant`, `leaseInput`, `contextA`/`contextB`), always including a "does not leak
  into another account" case. Every route with an id parameter answers 404 for another account's
  id (the layout or load function does it; the e2e of the owning feature checks it once). Each
  feature has at least one end-to-end test in `e2e/<feature>.e2e.ts`, run in the `signed in`
  project on both targets; it seeds what it does not own through `e2e/seed.ts` (`seedLease`,
  `seedRows`, `seedUser`, `clearTables`, backed by `POST /__e2e/seed`, only when `E2E=true`) and
  drives only its own pages. A feature test never changes the owner's email or password and never
  deletes the account; the auth feature's `manager.e2e.ts` (role) and `konto.e2e.ts` (account
  deletion, runs last) have their own Playwright projects.

## Glossary (code term → German UI word)

| Code                       | UI                                                |
| -------------------------- | ------------------------------------------------- |
| property / unit            | Objekt / Einheit                                  |
| tenant / lease             | Mieter / Mietvertrag                              |
| rentChange                 | Mietänderung (tab "Miethöhe")                     |
| baseRent                   | Kaltmiete (Nettokaltmiete)                        |
| operatingCostPrepayment    | Betriebskostenvorauszahlung                       |
| heatingCostPrepayment      | Heizkostenvorauszahlung                           |
| total of a rent charge     | Gesamtmiete                                       |
| operatingCostModel flat    | Betriebskostenpauschale; inclusive: Inklusivmiete |
| rentCharge                 | Sollstellung (column "Fällig")                    |
| payment                    | Zahlung                                           |
| balance                    | Saldo; positive: Rückstand, negative: Guthaben    |
| ledger / ledgerStart       | Mietkonto / "Mietkonto führen ab"                 |
| openingBalance             | Anfangssaldo                                      |
| securityDeposit            | Kaution                                           |
| graduated / indexed        | Staffelmiete / Indexmiete                         |
| bankTransaction            | Umsatz                                            |
| matchingRule (assign)      | Zuordnungsregel (zuordnen, Zuordnung aufheben)    |
| costItem                   | Beleg                                             |
| costCategory               | Kostenart                                         |
| allocationKey              | Umlageschlüssel                                   |
| billingCircle              | Abrechnungskreis                                  |
| meter / meterReading       | Zähler / Zählerstand (interim: Zwischenablesung)  |
| operatingCostStatement     | Betriebskostenabrechnung (short: Abrechnung)      |
| statementBalance           | Nachzahlung / Guthaben                            |
| vacancy                    | Leerstand                                         |
| degreeDayShares            | Gradtagszahlen                                    |
| co2CostSplit               | CO₂-Kostenaufteilung                              |
| manager / owner            | Mitverwalter / Vermieter                          |
| task / computed deadline   | Aufgabe / Frist                                   |
| document                   | Dokument                                          |
| landlord (account address) | Vermieter (Absender)                              |

## Data model

Existing tables on `main` stay as they are: `accounts`, `users`, `sessions`, `properties`, `units`,
`tenants`, `leases`, `lease_tenants`. The spike adds columns and tables in `0002_prototype.sql`
(generated with `npm run db:generate`) and backfills existing leases in `0003_backfill.sql`
(hand-written: the `initial` rent change and the first `lease_persons` row per lease, `kind` from
the unit). Only additive changes, so a database from `main` upgrades in place. `schema.ts` is the
source of truth; this section explains it.

### Accounts, users, access

- `accounts` + landlord sender block `landlordName`, `street`, `postalCode`, `city`, `iban`,
  `bankName` (all null; edited under `/einstellungen/profil`; letters and statements warn when
  empty and fall back to the user's name), billing columns `stripeCustomerId`,
  `stripeSubscriptionId` (both partial-unique), `subscriptionStatus`
  (`none` | `trialing` | `active` | `past_due` | `canceled`), `currentPeriodEnd`, `trialEndsAt`.
- `stripe_events`: id (the Stripe event id), type, receivedAt. The webhook inserts with
  `onConflictDoNothing` and skips processing when the row existed (retries are idempotent). It
  applies the subscription as `GET /v1/subscriptions/:id` returns it, never the event's payload,
  because Stripe delivers out of order. Deleting the account cancels a running subscription
  first (`DELETE /v1/subscriptions/:id`) and is refused while Stripe does not answer.
- `users` + `role` (`owner` | `manager`), `name`.
- `invitations`: id, accountId, email, role, tokenHash (unique), expiresAt, invitedBy, acceptedAt.
  `/einladung/<token>` registers the invitee into the inviting account regardless of
  `OPEN_REGISTRATION`; only the SHA-256 of the token is stored.
- `password_resets`: id (= SHA-256 of token), userId, expiresAt. One hour. A reset or a password
  change deletes all other sessions of the user and consumes the token.
- `login_attempts`: email, failures, firstFailureAt, lockedUntil. 5 failures within 15 minutes lock
  the address for 15 minutes; the reset form counts too.
- `outbox`: id, to, subject, text, createdAt. Mails stored by `MAIL_TRANSPORT=outbox`; the e2e tests
  read them through `GET /__e2e/outbox`.
- `audit_log`: id, accountId, userId (null for system), at, entity, entityId, action (text),
  summary.
- Every reference to `users` (`createdBy`, `invitedBy`, `importedBy`, `uploadedBy`, `approvedBy`,
  `audit_log.userId`) is nullable with `onDelete: set null`, so a removed manager leaves the history
  intact; the summaries carry the user's name as text where it matters.

### Portfolio (Bestand)

- `properties` + `buildingUse` (`residential` | `non_residential`, for the CO₂ split),
  `vacancyPersons` (integer, default 1: how many persons a vacant unit counts with in the persons
  key; that share stays with the landlord), `notes`.
- `units` + `floor`, `rooms`, `notes`. `kind` stays `apartment` | `commercial` | `parking`.
- `tenants` + `salutation`, `street`, `postalCode`, `city` (address on letters), `notes`.
- `leases`: `unitId` stays the main unit. Added: `kind` (`residential` | `commercial` | `parking`),
  `rentModel` (`fixed` | `graduated` | `indexed`), `operatingCostModel`
  (`prepayment` | `flat` | `inclusive`), `heatingCostModel` (`prepayment` | `flat`),
  `heatingCostPrepayment`, `persons` (initial value), `rentDueDay` (n-th working day, default 3),
  `ledgerStart` (date, null = startDate), `indexBaseMonth`, `indexBaseValue`, `terminatedAt`,
  `terminatedBy` (`tenant` | `landlord`), `notes`. `baseRent`, `operatingCostPrepayment`,
  `heatingCostPrepayment`, `securityDeposit` and `persons` are the values at the start (written on
  creation, corrected in the edit form together with the initial rent change and persons row) and
  never read for calculations; the values valid on a day come from `rent_changes` and
  `lease_persons`.
- `lease_units`: accountId, leaseId, unitId. Extra units rented with the main unit (parking). The
  main unit is not repeated; changing the units of a running lease means ending it and starting a
  new one. A unit occupied by a lease in a period means `leases.unitId = unit` or a `lease_units`
  row; extra units count 1 in the `units` key and contribute their area in the `area` key; billing
  circles keep parking out of building costs.
- `lease_persons` (Personenstand): id, accountId, leaseId, validFrom, persons, note; unique
  (leaseId, validFrom). Creating a lease inserts the first row; the lease overview edits the list
  ("ab Datum").
- `rent_changes` (the rent history): id, accountId, leaseId, validFrom, baseRent,
  operatingCostPrepayment, heatingCostPrepayment, reason
  (`initial` | `manual` | `graduated` | `indexed` | `statement`), status (`approved` | `proposed`),
  note, indexMonth, indexValue (the VPI the change was computed against; also recorded on a manual
  change of an indexed lease), letterText, deliveredOn, createdBy. Partial unique
  (leaseId, validFrom) where approved. The rent valid on a day is the approved change with the
  latest `validFrom <= day`. Each row stores all three amounts, so a write that changes a field
  from a date on also updates that field in the later approved rows that still held the old
  value, up to the first later row that set it itself (`laterRowUpdates` in
  `src/lib/domain/rents.ts`); deleting a change lets the rows that inherited from it fall back.
- `deposit_transactions` (Kaution): id, accountId, leaseId, date, amount (positive = received),
  kind (`received` | `interest` | `returned` | `withheld`), bankTransactionId (null, partial
  unique), note.
- `consumer_price_index` (VPI, per account): id, accountId, month, value, baseYear (default
  `2020`); unique (accountId, baseYear, month).

### Rent ledger (Mietkonto)

- `rent_charges` (Sollstellungen): id, accountId, leaseId, period, dueDate, baseRent,
  operatingCostPrepayment, heatingCostPrepayment, amount, kind
  (`rent` | `statement_balance` | `co2_reimbursement` | `adjustment`), referenceId (statement or
  CO₂ split id), reversesChargeId (a correction's reversal of an earlier posting), note. Partial
  unique indexes: one `rent` row per (leaseId, period); one posting per (leaseId, referenceId); a
  posting is reversed at most once.
- `rent` rows are derived data owned by `src/lib/server/ledger.ts`: `ensureCharges(db, accountId,
leaseIds, untilMonth)` recomputes every month from `max(startDate, ledgerStart)` to
  `min(untilMonth, endDate)` from the approved rent history (prorated by days when the lease starts
  or ends mid-month or the rent changes mid-month, see `monthlyAmounts` in
  `src/lib/domain/rents.ts`), inserts missing rows, updates rows whose amounts or due date differ
  (keeping their id), deletes `rent` rows for months now outside the term, and never touches other
  kinds. Every rent-change mutation and every page that shows balances calls it. `dueDate` =
  `nthWorkingDay(period, rentDueDay)`.
- **Ledger start.** A lease entered years after it began gets `ledgerStart` ("Mietkonto führen
  ab", default: the first day of the current month when the start date is in the past) and
  optionally an opening balance ("Anfangssaldo"): one `adjustment` row dated the ledger start,
  positive = Rückstand, negative = Guthaben. Prepayments of a statement period before `ledgerStart`
  come from the rent history, not from charges.
- `payments` (Ist): id, accountId, leaseId, date, amount (positive = received, negative = refund),
  source (`manual` | `bank`), bankTransactionId (null, indexed, not unique: one transfer can be
  split over two leases of the same tenant), note.
- Balance of a lease = sum(charges) − sum(payments); positive = Rückstand, negative = Guthaben.
  `listLedger` interleaves charges (by due date) and payments (by date) with a running balance;
  `listBalances` gives every lease's balance, the overdue part (charges due by today minus
  payments, at least 0: the Rückstand of the dashboard and `/mietkonto`, so a month's rent before
  its due day or a fresh Nachzahlung is owed but not yet Rückstand) and the month of the oldest
  due charge the payments do not cover (FIFO by due date; credits count like payments).
  Manual postings (`postCharge` kind `adjustment`) are for corrections and opening balances;
  statement balances and CO₂ credits are posted by their owners with `chargeEntry` inside their
  own batch.

### Banking

- `bank_accounts`: id, accountId, name, iban, bic, holder.
- `bank_imports`: id, accountId, bankAccountId, fileName, rowCount, importedCount, duplicateCount,
  importedBy.
- `bank_transactions`: id, accountId, bankAccountId, importId, bookingDate, valueDate, amount
  (signed cents), counterpartName, counterpartIban, purpose, fingerprint, occurrence, externalId,
  status (`unmatched` | `matched` | `ignored`). The fingerprint is SHA-256 over the normalized
  fields `bookingDate|amount|counterpartName|counterpartIban|purpose|occurrence`, where identical
  lines within one file are numbered 0, 1, 2 … so a tenant paying twice on one day is kept while a
  re-import of the same file adds nothing. Unique (bankAccountId, fingerprint); imports insert with
  `onConflictDoNothing` after selecting the existing fingerprints, `duplicateCount = rows −
new`. `matched` means at least one payment or deposit movement references the transaction; the
  banking module sets the status when it assigns or undoes.
- `matching_rules`: id, accountId, leaseId, field (`counterpartIban` | `counterpartName` |
  `purpose`), pattern (contains, case-insensitive), confirmed. Confirmed rules assign incoming
  amounts automatically on import; outgoing amounts are never auto-assigned, only suggested.

### Operating costs (Betriebskosten)

- `cost_categories` (Kostenarten): id, accountId, name, betrkvItem, allocable, consumptionBased
  (heating, hot water, water: split by consumption), allocationKeyId and billingCircleId (null;
  defaults copied into a new cost item), sortOrder; unique (accountId, name). Seeded per account
  on first use (`onConflictDoNothing`) with the 17 items of § 2 BetrKV plus "Verwaltungskosten
  (nicht umlagefähig)" and "Instandhaltung (nicht umlagefähig)".
- `allocation_keys` (Umlageschlüssel): id, accountId, propertyId (null = all properties), name,
  kind (`area` | `persons` | `units` | `consumption` | `mixed` | `custom` | `direct`), meterKind
  (for consumption/mixed), consumptionPercent (mixed: 50–70, validated for `heat` and `hot_water`
  meter kinds); unique (accountId, name). Seeded: Wohnfläche, Personen, Einheiten, Heizung 70/30,
  Warmwasser 70/30, Beträge je Einheit (direct).
- `allocation_key_shares`: accountId, keyId, unitId, share. Only for `custom` keys.
- `billing_circles`: id, accountId, propertyId, name; `billing_circle_units`: accountId, circleId,
  unitId. A cost item without a circle is shared by all units of the property.
- `cost_items` (Belege): id, accountId, propertyId, categoryId, allocationKeyId, billingCircleId,
  description, supplier, invoiceDate, periodStart, periodEnd, amount, allocable, and for a fuel
  bill of a central heating: fuel, fuelKwh, co2Kg, co2Cost (what the supplier printed). The
  receipt file is a `documents` row with `costItemId`.
- `cost_item_unit_amounts`: accountId, costItemId, unitId, amount. The split of a cost item with a
  `direct` key, e.g. the per-unit result of a Messdienstleister (ista, Techem, Brunata).
- `meters` (Zähler): id, accountId, propertyId, unitId (null = building meter), kind
  (`cold_water` | `hot_water` | `heat` | `gas` | `electricity`), serialNumber, unit, location,
  installedAt, removedAt. A replaced meter is closed and a new one opened; consumption is clipped
  to the lifetime and summed per unit and kind.
- `meter_readings`: id, accountId, meterId, readAt, value, estimated (§ 9a HeizKV estimate in
  place of a missing reading), note; unique (meterId, readAt).
- `operating_cost_statements`: id, accountId, propertyId, periodStart, periodEnd, version, status
  (`draft` | `approved`), correctsId (the version this one replaces), result (frozen property-level
  JSON), resultVersion, lateApprovalJustified, approvedAt, approvedBy, note; unique (propertyId,
  periodStart, periodEnd, version). Approved rows are never updated; "superseded" is derived from
  an approved correction.
- `statement_results`: id, accountId, statementId, leaseId, balance, result (frozen per-lease
  JSON, see "Statement result"), deliveredOn; unique (statementId, leaseId). The PDF reads only
  this row.
- `co2_cost_splits`: id, accountId, leaseId, year, fuel, fuelKwh, co2Kg, co2Cost, area,
  landlordPercent, amount, invoiceDate, claimedOn, chargeId; unique (leaseId, year).

### Documents, tasks

- `documents`: id, accountId, name, mimeType, size, storageKey, propertyId, unitId, leaseId,
  tenantId, costItemId (all nullable links, `set null`), uploadedBy. Stored via the adapter in
  `src/lib/server/storage/` under `<accountId>/<id>`; max 10 MB (checked in the action, and
  `server.js` raises the node body limit to 12 MB); served only to signed-in users of the same
  account; the object is deleted before the row, and account deletion deletes all objects first,
  in bulk deletes of up to 1000 keys (`Storage.deleteMany`; one R2 call each).
- `tasks` (Aufgaben): id, accountId, title, dueDate, done, doneAt, propertyId, leaseId, note.
  Deadlines that follow from the data are computed by `src/lib/server/deadlines.ts`, not stored.

### onDelete matrix

Cascade from leases to everything that hangs off them (rent_changes, lease_persons, lease_units,
lease_tenants, rent_charges, payments, deposit_transactions, matching_rules, co2_cost_splits), but
the app refuses to delete a lease that has money on it (`hasMoney` in `leases.ts`: payments,
deposit movements, postings other than `rent`, statement results) with a German sentence and
offers "Vertrag beenden" instead. Units and tenants are `restrict` from leases (a unit under a
lease cannot be deleted). `cost_items.categoryId` and `allocationKeyId` restrict (the app refuses
with a message naming the count), `billingCircleId` set null. `statement_results.leaseId`
restricts. Documents and tasks `set null`. Meters cascade to readings; properties cascade to units,
meters, keys, circles, cost items, statements. Bank accounts cascade to imports and transactions,
but the app refuses to delete a bank account with assigned transactions.

## Domain rules

### Rent

- **Rent valid on a day:** latest approved `rent_changes` row with `validFrom <= day`
  (`rentOn` in `src/lib/domain/rents.ts`). A change may start on any day; the ledger prorates the
  month by days.
- **Manual change** ("Änderung ab Datum"): any field, any reason note, prefilled with the rent
  valid on its default date. On a graduated or indexed residential lease a manual change of the
  base rent (against the rent valid on its date) shows a warning (§ 557a Abs. 2 / § 557b Abs. 2
  exclude § 558 increases) and requires a note.
- **Graduated rent (§ 557a BGB):** steps (date, new base rent) become `graduated` changes,
  approved immediately after a confirmation naming the rent and the date; at least one year
  between steps for residential leases (validation).
- **Index rent (§ 557b BGB):** the proposal page computes new base rent = current base rent ×
  (latest VPI value ÷ reference index), rounded half-up to cents, where the reference index is the
  `indexValue` of the latest approved change that carries one, else the lease's `indexBaseValue`.
  Both values come from the same `baseYear`; when the VPI table holds more than one base year the
  page refuses with a hint to enter the rebased value. Waiting period: 12 months after `validFrom`
  of the latest approved change whose base rent differs from its predecessor, ignoring reason
  `statement` (§ 560 prepayment changes do not count); residential only. Approving a proposal asks
  "Schreiben zugestellt am" (default today), stores it in `deliveredOn`, and sets
  `validFrom` = first day of the second month after delivery (`effectiveFrom(deliveredOn)`); for
  commercial leases the date is editable. The letter (rendered with `pdf.ts`, text stored in
  `letterText`) states old index (month, value), new index, the percentage, old rent, new rent, the
  increase as an amount, the effective date, and the landlord sender block.
- **Prepayment adjustment after a statement (§ 560 Abs. 4):** the approved statement page offers
  "Vorauszahlung anpassen" per lease that still runs, linking to
  `/vertraege/[id]/miethoehe?prepayment=<operating/12>&heating=<heating/12>` (the non-heating and
  the heating lines apart, a part-year lease scaled to 365 days; a kind without lines is left
  out and keeps its current prepayment) with reason `statement` preselected and valid-from the
  first of the month after next. A `statement` change changes only the prepayments; a different
  Kaltmiete is refused.
- **Rent due date:** the n-th working day of the month (`rentDueDay`, default 3; Saturday does not
  count; public holidays are ignored).
- **Deposit (§ 551 BGB):** warning (not an error) when a residential deposit exceeds three initial
  base rents; three instalments due with the first three rents, the first not before the start of
  the tenancy (shown as deadlines until
  `received` covers the amount). The deposit ledger is separate from the rent ledger; movements
  can be assigned from bank transactions.
- **Lease end:** "Vertrag beenden" on the lease overview: Kündigung erhalten am (`terminatedAt`),
  durch (`terminatedBy`), Vertragsende (`endDate`, prefilled per § 573c: notice by the third
  Werktag of a month, Saturday counting, a Saturday deadline moved to Monday, ends the lease at the
  end of the month after next; landlord notice after 5 / 8 years of tenancy adds 3 / 6 months;
  commercial leases per § 580a Abs. 2: by the third Werktag of a quarter to the end of the next
  quarter; the date follows the inputs and an earlier one is refused unless an earlier end was
  agreed), confirmed with `ConfirmButton`. Afterwards the
  overview shows the deadlines Zählerstände ablesen (end date), Kaution abrechnen (6 months after
  the end) and Betriebskostenabrechnung (12 months after the period end).
- **Rules by lease kind:** the deposit cap, the one-year Staffel rule, the index waiting period,
  the § 556 Abs. 3 statement deadline and the BetrKV allocability warnings apply to `residential`
  leases only; `commercial` and `parking` skip them.

### Operating cost statement (`src/lib/domain/statement.ts`, pure)

Input: the property (with `vacancyPersons`, `buildingUse`), its units with areas, the leases
occupying them in the period with their `lease_persons` history and cost models, the cost items
overlapping the period with categories, keys, shares, circles and direct amounts, meters with
readings, the prepayment charges per lease and month, the `today()` date.

1. **Cost per item in the period:** amount × overlap days ÷ cost period days (`proRata`). Items
   whose category or item is not allocable go to the landlord list. For a heating cost item with
   CO₂ data (`co2Kg`, `co2Cost`, landlord-supplied fuel), compute the building's emissions per m²
   of the circle's (or property's) total floor area (the kg of all its fuel bills, each prorated
   to the period, scaled to twelve months; a missing floor area blocks the approval), the
   landlord share per the CO2KostAufG tier
   (`landlordSharePercent` in `src/lib/domain/co2.ts`; non-residential building: 50 %), subtract
   that share of the CO₂ cost from the allocable amount, and keep the disclosure figures
   (emissions, kg/m², tier, landlord share) for the result.
2. **Weights per unit** (units of the item's circle, else all units of the property):
   - `area`: floor area (missing → warning, weight 0).
   - `persons`: person-days over the period: per day the sum of `persons` of the leases
     occupying the unit (from `lease_persons`, the row valid on that day); days without a lease
     count `property.vacancyPersons` and that weight is the landlord's vacancy share.
   - `units`: 1.
   - `consumption`: the unit's consumption of the key's meter kind in the period: sum over its
     meters, each clipped to `[installedAt, removedAt]`, consumption = reading interpolated at
     the period end − reading interpolated at the period start (a reading within 3 days of a
     bound is used exactly). A unit without a usable value is a warning that blocks approval until
     an `estimated` reading exists (§ 9a HeizKV); when estimated units exceed 25 % of the area the
     statement warns and splits that cost by floor area only (§ 9a Abs. 2 HeizKV).
   - `mixed`: `consumptionPercent` of the amount by consumption, the rest by area.
   - `custom`: shares. `direct`: the amounts from `cost_item_unit_amounts` (no weights); amounts
     above the bill block the approval, amounts below it leave the rest with the landlord.
3. **Distribute** the item amount over the units with `distributeCents`.
4. **Split each unit's amount over the leases** occupying it in the period and the vacancy:
   `area`, `units`, `custom`, `direct` → by occupancy days; `persons` → by person-days per lease;
   `consumption` and the consumption part of `mixed` → by each lease's consumption from readings
   interpolated at the lease boundaries (a reading within 3 days of the boundary is used exactly:
   the Zwischenablesung of § 9b HeizKV); without a reading near the boundary, `heat` meters split
   by Gradtagszahlen (monthly shares in `src/lib/domain/degree-days.ts`: Jan 170, Feb 150, Mär
   130, Apr 80, Mai 40, Jun 13, Jul 13, Aug 14, Sep 30, Okt 80, Nov 120, Dez 160 = 1000) and other
   kinds by days, with the warning "keine Zwischenablesung"; the method used is recorded in the
   result. Days without a lease are the landlord's vacancy share.
5. **Per lease:** lines per cost item with category, key, totals and the lease's share; leases with
   `operatingCostModel` `flat`/`inclusive` keep no share of non-heating items and leases with
   `heatingCostModel` `flat` no share of heating items (those shares go to the landlord list and
   the PDF omits them). Prepayments (Soll) = sum of the `operatingCostPrepayment +
heatingCostPrepayment` columns of the lease's `rent` charges in the period (`ensureCharges` first;
   months before `ledgerStart` from the rent history). Balance = costs − prepayments.
6. **Warnings** (shown on the draft as links to the fix): missing floor area, missing or estimated
   readings, no lease in the period, a heating/hot water item (category `consumptionBased`) whose
   key is not `consumption`/`mixed`/`direct` or whose `consumptionPercent` is outside 50–70
   (§ 12 HeizKV: 15 % Kürzungsrecht), Pauschale leases excluded, period longer than 12 months or
   not from the first to the last day of a month (validation error: prepayments are charged per
   month), a period overlapping another statement of the property (refused), 12-month deadline
   passed (residential leases only).
7. **Approval** (`ConfirmButton` naming the number of leases and the totals of Nachzahlungen and
   Guthaben): freezes the per-lease results into `statement_results` and the property result into
   `result`, and posts one `statement_balance` charge per lease (period = month of `periodEnd`,
   dueDate = approval date + 30 days, referenceId = statement id) in one batch with the audit
   entry. Residential lease and approval after the deadline: the Nachzahlung is posted only when
   "Verspätung nicht zu vertreten" is ticked (`lateApprovalJustified`, with a note), otherwise the
   posted charge is 0 and the computed amount stays in the result for information; a Guthaben is
   always posted. Per lease the page asks "zugestellt am" later (`deliveredOn`, not before the
   approval, not in the future), which starts the tenant's Einwendungsfrist (to the end of the
   twelfth month after it). A residential Nachzahlung delivered after the deadline is reversed in
   the same batch (`reversesChargeId`, referenceId = the statement), unless the approval was
   justified or the corrected version had reached the tenant in time.
8. **Correction:** a new draft version with `correctsId`; approving it posts, in one batch, the
   reversal rows (`reversesChargeId` = the old charge, amount negated, referenceId = correction id;
   postings already reversed on a late delivery are skipped) and its own balances. A correction
   approved after the deadline posts per residential lease at most what the corrected version
   still claims (no higher Nachzahlung, no smaller Guthaben), unless the delay is justified.
9. **Deadline (§ 556 Abs. 3 BGB):** the statement must reach the tenant by the end of the twelfth
   month after the period ends (`statementDeadline`); `deadlines.ts` lists it per property with
   residential leases.

### Statement result (frozen JSON, `resultVersion` 1)

Per lease (`statement_results.result`, type `LeaseStatement` in `src/lib/domain/statement.ts`):
property name and address; period; the landlord sender block; the lease's tenants (salutation,
names, address as of approval), unit name(s) and area, occupancy days, persons per sub-period; per
cost item: description, category name, BetrKV item, key name and kind, item total in the period,
key total (e.g. `1.000,00 m²`, `3.650 Personentage`, `100 %`), the lease's share of the key (e.g.
`72,5 m² × 365 / 365 Tage`), the method used at a tenant change, amount; for CO₂: emissions, kg/m²,
tier, landlord share; prepayments as the list of charged months and amounts; costs total,
prepayments total, balance; Pauschale exclusions; warnings; the 12-month deadline date. The
property result (`operating_cost_statements.result`) holds the totals, the vacancy share, the
non-allocable total, the landlord's CO₂ share and the warnings. The PDF (`renderLetter`) prints
exactly these rows; the e2e test extracts the PDF text and checks the four elements a formally valid
statement needs (Gesamtkosten, Umlageschlüssel, Mieteranteil, Vorauszahlungen).

### CO₂ cost split (CO2KostAufG, `src/lib/domain/co2.ts`)

- `landlordSharePercent(kgPerSquareMetre, buildingUse)`: residential, per Anlage 1: < 12 kg → 0 %,
  12–<17 → 10 %, 17–<22 → 20 %, 22–<27 → 30 %, 27–<32 → 40 %, 32–<37 → 50 %, 37–<42 → 60 %,
  42–<47 → 70 %, 47–<52 → 80 %, ≥ 52 → 95 %; non-residential → 50 %.
- **Tenant with own fuel contract (§ 6):** `/vertraege/[id]/co2` asks for the year, fuel
  (`gas` 0.201 kg/kWh, `oil` 0.266, `lpg` 0.234, `district_heating`/`other`: enter kg), the CO₂
  kg and CO₂ cost printed on the supplier invoice (kWh × factor only prefills the kg), the invoice
  date and the date the tenant presented the claim (refused when more than twelve months after the
  invoice date, § 6 Abs. 1), and the floor area of the dwelling (prefilled
  from the lease's unit plus extra units, editable). Emissions per m² of that area → tier →
  landlord share → amount, stored in `co2_cost_splits` and posted as a `co2_reimbursement` credit
  (referenceId = split id). The landlord settles within 12 months of the claim (deadline).
- **Landlord-supplied fuel:** inside the statement, see step 1 above.

### Bank matching

On import, each new transaction is tested against confirmed rules (first match wins, in creation
order) and, for incoming amounts, gets a payment; otherwise the review list shows a suggestion:
unconfirmed rules, the IBAN of an earlier assignment, a tenant's last name or the unit name
contained in counterpart or purpose. Assigning chooses a lease and a target `rent` (payment) or
`deposit` (deposit movement, kind by sign), optionally split over several leases with amounts that
must sum to the transaction, and "Zuordnung merken" turns it into a confirmed rule. Undo deletes
the payments or deposit movements and sets the status back to `unmatched`. Assign, undo, ignore
and reopen check the status first and start their batch with a guard statement that fails the
batch when another request changed the status in between, so a double submit books once. One transfer that pays
flat and parking space is one payment on one lease when the parking space is an extra unit of that
lease (hint under "Weitere Einheiten" on the lease form); otherwise it is split.

### Deadlines (`src/lib/server/deadlines.ts`, computed, never stored)

Per account, for `/aufgaben` and the dashboard: statement deadline (period end + 12 months, per
property and year with residential leases, until an approved statement exists), Einwendungsfrist
(end of the twelfth month after `deliveredOn`), lease end, deposit instalments, deposit return
(6 months after the end), next Staffel step, earliest next index proposal (the first day a
proposal can be sent so it takes effect when the waiting period ends), CO₂ reimbursement
(`claimedOn` + 12 months), lease end proposal from a notice, Zählerstände ablesen at a lease end.

## Layouts and routes

### Layouts (foundation)

Tab bars and the 404 lookup exist once, in a `+layout.svelte` the feature pages render inside:

- `/vertraege/[id]`: header = lease label + tenants, tabs Übersicht | Miethöhe | Mietkonto |
  Kaution | CO₂ | Dokumente (`/vertraege/[id]`, `/miethoehe`, `/mietkonto`, `/kaution`, `/co2`,
  `/dokumente`). `+layout.server.ts` loads `{ lease }` (a `LeaseSummary`); pages use
  `await parent()` or `data.lease`.
- `/objekte/[id]`: header = property, tabs Einheiten | Zähler | Abrechnungskreise.
- `/betriebskosten`: tabs Abrechnungen | Belege | Kostenarten | Umlageschlüssel.
- `/bank`: tabs Umsätze | Import | Regeln | Konten.

### Routes

Public: `/anmelden`, `/registrieren`, `/abmelden`, `/passwort-vergessen`,
`/passwort-zuruecksetzen/[token]`, `/einladung/[token]`, `/webhooks/stripe`, `/health`,
`/__e2e/*` (E2E only).

Signed in (German paths; every page has a `<title>` ending in `· mietkartei`):

| Path                                                                    | Feature               | Content                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                     | integration           | Übersicht: tiles linking to their lists (Rückstände → `/mietkonto`, Leerstand → `/objekte`, offene Umsätze → `/bank`, Fristen/Aufgaben → `/aufgaben`); first-run checklist until a lease and a bank account exist |
| `/objekte`, `/objekte/neu`, `/objekte/[id]`, `/objekte/[id]/bearbeiten` | portfolio             | list, create, units tab (list, create, edit, delete), edit/delete property                                                                                                                                        |
| `/objekte/[id]/einheiten/[unitId]`, `…/bearbeiten`                      | portfolio             | unit detail: leases on it, link to meters; edit                                                                                                                                                                   |
| `/objekte/[id]/zaehler`                                                 | operating-costs-setup | meters and readings of the property (filter by unit, `?meter=`)                                                                                                                                                   |
| `/objekte/[id]/abrechnungskreise`                                       | operating-costs-setup | billing circles                                                                                                                                                                                                   |
| `/mieter`, `/mieter/neu`, `/mieter/[id]`, `/mieter/[id]/bearbeiten`     | tenants-leases        | tenants with their leases and a link to their documents                                                                                                                                                           |
| `/vertraege`, `/vertraege/neu`, `/vertraege/[id]`, `…/bearbeiten`       | tenants-leases        | list (active first), create (prefill `?unitId=`, `?tenantId=`), overview tab (current Gesamtmiete, Saldo, persons history, "Vertrag beenden", delete), edit                                                       |
| `/vertraege/[id]/kaution`                                               | tenants-leases        | deposit movements                                                                                                                                                                                                 |
| `/vertraege/[id]/miethoehe`                                             | rent                  | rent history, manual change, Staffel steps, index proposal, letter PDF                                                                                                                                            |
| `/vertraege/[id]/miethoehe/brief/[changeId]`                            | rent                  | the index letter as PDF                                                                                                                                                                                           |
| `/vertraege/[id]/mietkonto`                                             | ledger-ui             | ledger lines, payment form (date today, amount = Gesamtmiete or open balance), opening balance, adjustments                                                                                                       |
| `/vertraege/[id]/co2`                                                   | co2                   | CO₂ split for a tenant's own contract, posting                                                                                                                                                                    |
| `/vertraege/[id]/dokumente`                                             | documents             | documents of the lease, upload                                                                                                                                                                                    |
| `/mietkonto`                                                            | ledger-ui             | all leases with balances, arrears first, months not fully paid                                                                                                                                                    |
| `/bank`                                                                 | banking               | Umsätze (filter by status, default Offen): inline assign form, Ignorieren, undo; count in the header; EmptyState → Konten                                                                                         |
| `/bank/import`                                                          | banking               | choose account, upload CSV, preset detection or column mapping, preview (new/duplicates/rule hits), commit                                                                                                        |
| `/bank/regeln`, `/bank/konten`                                          | banking               | rules; bank accounts (owner)                                                                                                                                                                                      |
| `/betriebskosten`                                                       | statements            | statements per property and period, "Neue Abrechnung" (last calendar year, one property)                                                                                                                          |
| `/betriebskosten/abrechnungen/[id]`                                     | statements            | draft (recomputed, warnings as links), approve, correction, delivered dates, PDF per lease                                                                                                                        |
| `/betriebskosten/abrechnungen/[id]/pdf/[leaseId]`                       | statements            | PDF from the frozen result                                                                                                                                                                                        |
| `/betriebskosten/belege`, `/betriebskosten/belege/neu`, `…/[id]`        | operating-costs-setup | cost items filtered by property and year (sum per Kostenart); one form with receipt upload, defaults, "Speichern und nächsten Beleg"                                                                              |
| `/betriebskosten/kostenarten`, `/betriebskosten/schluessel`             | operating-costs-setup | categories, keys (shares for custom keys)                                                                                                                                                                         |
| `/dokumente`, `/dokumente/[id]/download`                                | documents             | all documents (filter by link), upload, delete; download                                                                                                                                                          |
| `/aufgaben`                                                             | tasks                 | tasks and computed deadlines                                                                                                                                                                                      |
| `/import`                                                               | import                | CSV import: properties/units, tenants, leases (with ledger start and opening balance), payments; mapping, preview, commit                                                                                         |
| `/einstellungen`                                                        | foundation            | hub linking the pages below and `/import`                                                                                                                                                                         |
| `/einstellungen/profil`                                                 | auth                  | name, email, password change, landlord sender block                                                                                                                                                               |
| `/einstellungen/mitverwalter`                                           | auth                  | invitations (owner)                                                                                                                                                                                               |
| `/einstellungen/vpi`                                                    | rent                  | VPI values                                                                                                                                                                                                        |
| `/einstellungen/export`                                                 | auth                  | ZIP export, streamed: `export.json` (every account table) + documents                                                                                                                                             |
| `/einstellungen/protokoll`                                              | auth                  | audit log                                                                                                                                                                                                         |
| `/einstellungen/konto`                                                  | auth                  | delete account (owner, re-enter password), demo data button (integration)                                                                                                                                         |
| `/abo`                                                                  | billing               | subscription (owner; only when Stripe is configured)                                                                                                                                                              |

### UI rules

- **Confirmations.** Approve statement, approve index/Staffel change (naming the new rent and the
  date), delete lease/property/unit/bank account/cost item/document/payment, undo an assignment,
  end a lease: `ConfirmButton`. Deletes refused by the rules above return a German sentence, never a
  database error, and the page offers the alternative (end the lease, delete the leases first);
  a property or unit with any lease, ended ones too, stays, so its refusal names and links those
  leases instead of suggesting to end them.
  Account deletion re-asks the password.
- **First run.** Until the account has a lease and a bank account, `/` shows a setup checklist instead of tiles:
  Objekt anlegen → Einheit anlegen → Mieter anlegen → Mietvertrag anlegen → Bankverbindung anlegen
  → Kostenarten und Umlageschlüssel prüfen, each marked done once data exists (the categories once
  `/betriebskosten` seeded them) and linked to the page that creates it. Unit rows get "Mietvertrag anlegen" (`/vertraege/neu?unitId=`),
  tenant pages the same with `?tenantId=`; `/vertraege/neu` without tenants links to
  `/mieter/neu?return=/vertraege/neu`. `EmptyState`s name the missing prerequisite and link to
  it; `/objekte` and `/mieter` empty states also link to `/import`.
- **Dashboard tiles** show the amount or count and link to their filtered list.
- **Statement draft** warnings link to the fix: missing reading → `/objekte/[id]/zaehler?meter=`,
  missing area → the unit's edit page, no lease → the unit.

## Module layout

```
src/lib/money.ts, dates.ts, format.ts, csv.ts   shared helpers (client + server)
src/lib/labels.ts                               German labels for every schema enum
src/lib/forms/fields.ts                         FormParser
src/lib/forms/tenants.ts, leases.ts             parsers shared by pages and the import (foundation)
src/lib/forms/<feature>.ts                      the feature's own parsers
src/lib/domain/<feature>.ts                     pure logic, no database, unit-tested
src/lib/domain/rents.ts, charges.ts, co2.ts     foundation: rent on a day, monthly amounts, expected charges, CO₂ tiers
src/lib/server/<feature>.ts                     database access, account-scoped
src/lib/server/tenants.ts, leases.ts, rents.ts  foundation: tenants, leases (+hasMoney), rent history
src/lib/server/ledger.ts                        foundation: ensureCharges, chargeEntry/postCharge, payments, listLedger, listBalances
src/lib/server/documents.ts                     foundation: store/open/list/delete documents, deleteAllDocuments
src/lib/server/pdf.ts                           foundation: renderLetter, pdfResponse (pdf-lib)
src/lib/server/accounts.ts                      foundation: default account, landlordAddress, deleteAccount
src/lib/server/audit.ts, session.ts, mail.ts    foundation
src/lib/server/billing.ts, stripe.ts            billing (billingEnabled, enforceBilling, billingNotice are called by the foundation)
src/lib/server/db/schema.ts, batch.ts           schema and the batch/chunk helpers
src/lib/server/storage/{index,fs,r2}.ts         document storage adapter
src/lib/server/e2e-seed.ts                      the seed operations behind POST /__e2e/seed
src/lib/server/testing.ts                       unit-test fixtures
src/lib/components/*.svelte                     shared UI
src/routes/...                                  pages, see the route table
e2e/<feature>.e2e.ts, e2e/seed.ts               end-to-end tests and the seed helper
```

## Environment variables and bindings

| Variable                                                        | Meaning                                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_PATH`, `OPEN_REGISTRATION`, `PORT`                    | as on main                                                                                                           |
| `ORIGIN`                                                        | as on main; the reset mail's link; without it on node only requests to localhost get one                             |
| `DATA_DIR`                                                      | node: directory for uploaded documents; default `documents/` next to the database file (Docker: `/data/documents`)   |
| `BODY_SIZE_LIMIT`                                               | node: set by `server.js` to `12M` unless given, for uploads                                                          |
| `MAIL_TRANSPORT`                                                | `console` (default: log the mail), `resend` (HTTP API), `outbox` (store in the `outbox` table; the e2e tests use it) |
| `MAIL_API_KEY`, `MAIL_FROM`                                     | for `resend`                                                                                                         |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | billing; all three unset = billing pages hidden; `STRIPE_API_BASE` points tests at a fake server                     |
| `BILLING_REQUIRED`                                              | `true`: no active subscription after the 30-day trial = read only (but leave, change login)                          |
| `E2E`                                                           | `true` enables `/__e2e/outbox` and `/__e2e/seed`; set by the Playwright web servers only                             |

Every variable is declared in `src/env.ts` with a schema that defaults it, so an unset variable
never fails the boot. On cloudflare, non-secrets live in `vars` of `wrangler.jsonc` and secrets in
`wrangler secret put`; the Playwright run passes `--var MAIL_TRANSPORT:outbox --var E2E:true`.
Bindings: `DB` (D1), `DOCUMENTS` (R2 bucket, local in `wrangler dev`).

## Reference scenario

The fixtures for `domain/statement.spec.ts`, `ledger.spec.ts`, the statement PDF e2e and the export
e2e share one hand-computed scenario, so results can be checked against each other: property
"Lindenstraße 4" (residential, `vacancyPersons` 1) with three units: EG (72.5 m², 2 persons, lease
all year, prepayments 150 + 50 €), OG (64 m², tenant change on 30 June: lease A 2 persons until
30 June, lease B 1 person from 1 July, heat meter reading on 30 June), DG (48 m², vacant from
1 September). Cost items for the year: Grundsteuer 1.200 € (area), Müll 600 € (persons), Hausmeister
900 € (units), Heizung 3.000 € (mixed 70/30, heat meters EG 1.000 kWh, OG 600 + 400 kWh, DG 200 kWh)
with CO₂ data 25.000 kWh gas / 5.025 kg / 300 € CO₂ cost, Verwaltung 500 € (not allocable). Lease
EG pays 11 of 12 rents (Teilzahlung in December). Each spec states the numbers it derives from
this scenario and the hand calculation next to them.

## How features are built in parallel

The foundation is committed first. Each feature then adds files under its own paths and does not
edit foundation files other than the ones listed as its own below; what a feature needs changed in
a foundation file it reports in its result, and the integration step applies it. Features never
edit `package.json` (the foundation installed `pdf-lib` and `fflate`; a feature that needs another
dependency reports it), `schema.ts`, `app.css`, `+layout.svelte`, `hooks.server.ts`,
`playwright.config.ts`, or another feature's files.

Shared paths each feature may add to: `src/routes/<its routes>`, `src/lib/domain/<feature>.ts`,
`src/lib/server/<feature>.ts`, `src/lib/forms/<feature>.ts`, `src/lib/components/<Feature>*.svelte`,
`e2e/<feature>.e2e.ts`, and `*.spec.ts` next to the code.

| Feature               | Also owns (may edit)                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| portfolio             | `src/lib/server/properties.ts`, `src/lib/validation.ts`, `src/routes/objekte/**` except `[id]/+layout.*`, `zaehler`, `abrechnungskreise`; `e2e/properties.e2e.ts`                                                                                                                                      |
| tenants-leases        | `src/lib/server/tenants.ts`, `leases.ts`, `src/lib/forms/tenants.ts`, `leases.ts`, `src/routes/mieter/**`, `src/routes/vertraege/**` except the `[id]` layout and the tabs owned by others                                                                                                             |
| rent                  | `src/lib/server/rents.ts` (append only), `src/routes/vertraege/[id]/miethoehe/**`, `src/routes/einstellungen/vpi/**`                                                                                                                                                                                   |
| ledger-ui             | `src/routes/mietkonto/**`, `src/routes/vertraege/[id]/mietkonto/**` (reads `ledger.ts`; reports changes it needs)                                                                                                                                                                                      |
| banking               | `src/routes/bank/**` except `+layout.svelte`, `src/lib/server/bank/**`                                                                                                                                                                                                                                 |
| operating-costs-setup | `src/routes/betriebskosten/{belege,kostenarten,schluessel}/**`, `src/routes/objekte/[id]/{zaehler,abrechnungskreise}/**`, `src/lib/server/operating-costs.ts` (categories, keys, circles, cost items, meters, readings, seeding)                                                                       |
| statements            | `src/lib/domain/statement.ts`, `degree-days.ts`, `consumption.ts`, `src/lib/server/statements.ts`, `src/routes/betriebskosten/+page.*`, `src/routes/betriebskosten/abrechnungen/**`                                                                                                                    |
| co2                   | `src/lib/server/co2.ts`, `src/routes/vertraege/[id]/co2/**`                                                                                                                                                                                                                                            |
| documents             | `src/routes/dokumente/**`, `src/routes/vertraege/[id]/dokumente/**`                                                                                                                                                                                                                                    |
| tasks                 | `src/lib/server/deadlines.ts`, `tasks.ts`, `src/routes/aufgaben/**`                                                                                                                                                                                                                                    |
| auth                  | `src/lib/server/auth.ts` (+spec), `accounts.ts` (deleteAccount), `src/routes/{anmelden,registrieren,abmelden,passwort-vergessen,passwort-zuruecksetzen,einladung}/**`, `src/routes/einstellungen/{profil,mitverwalter,export,protokoll,konto}/**`, `e2e/auth.e2e.ts`, `manager.e2e.ts`, `konto.e2e.ts` |
| billing               | `src/lib/server/billing.ts`, `stripe.ts`, `src/routes/abo/**`, `src/routes/webhooks/stripe/**`, `e2e/stripe-fake.ts`                                                                                                                                                                                   |
| import                | `src/lib/server/import.ts`, `src/routes/import/**`                                                                                                                                                                                                                                                     |
| integration (after)   | `src/routes/+page.*` (dashboard, first run), `src/lib/server/demo.ts` (demo data), README                                                                                                                                                                                                              |

`src/lib/server/ledger.ts`, `documents.ts`, `pdf.ts`, `csv.ts`, `rents.ts`, `leases.ts` are
imported by several features; the owner above may extend them (new exports), never change an
existing signature during the parallel phase.

## Assumptions and open questions

Listed for the PR; each is a product decision the PRD and TDD do not make.

1. Stack and infrastructure as in "Decisions that differ from the TDD".
2. Money as integer cents; rounding half-up for single amounts, largest remainder for splits.
3. Rent due on the n-th working day (default third), Saturday excluded, public holidays ignored;
   the notice cutoff of § 573c / § 580a counts Saturday (moved to Monday by § 193 BGB).
4. A rent change may start on any day; the month is prorated by days.
5. Ledger start and opening balance for migrated leases; charges before the ledger start are not
   generated.
6. Statement prepayments are the charged (Soll) prepayments, also for ended leases.
7. Nachzahlungen are due 30 days after approval.
8. Vacancy counts `vacancyPersons` (default 1) persons in the persons key; the vacancy share stays
   with the landlord.
9. At a tenant change without a Zwischenablesung: Gradtagszahlen for heat meters, days otherwise.
10. HeizKV: warnings only (no property flags for the mandatory 70 % case or the two-family
    exemption); the § 9 HeizKV split of a combined heating/hot-water bill is not computed (enter
    two cost items or use a `direct` key with the Messdienst result).
11. CO2KostAufG § 9 reductions (Denkmalschutz, Milieuschutz) are not modelled; fuel factors
    0.201 (gas), 0.266 (oil), 0.234 (LPG) kg/kWh prefill the kg when the invoice lacks them.
12. Commercial leases: no per-lease override of allocable categories; the BetrKV list applies.
13. Deposit return deadline 6 months after the lease end; three instalments with the first three
    rents.
14. VPI values are entered by hand; base-year rebasing is not converted (the page refuses mixed
    base years).
15. Bank import via CSV presets (Sparkasse, Volksbank, ING, DKB, comdirect, generic) and column
    mapping; no FinTS, no HAUS/DATEV.
16. Billing: Stripe Checkout + Customer Portal, one monthly price, 30-day trial, read-only after
    the trial when `BILLING_REQUIRED`; a self-hosted instance never sees billing.
17. The export is a ZIP with JSON and documents; there is no import of that export.
18. Demo data is created by a button on `/einstellungen/konto` for an empty account, on both
    targets.
