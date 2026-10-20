# Prototype design: the whole app in one branch

This branch builds the complete mietkartei app as a spike, so the PRD and TDD can be checked against
a running product. It is never merged as a whole: features are ported to `main` one at a time in
small PRs. This file is the shared design every part of the spike follows, so the parts fit
together. It is written for contributors and agents who build one feature each.

## Decisions that differ from the TDD

| TDD says                           | Spike does                                                         | Why                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Python, FastAPI, PostgreSQL, React | SvelteKit 3, Svelte 5, Drizzle, SQLite/D1                          | The stack decision on `main` and the owner's choice of Cloudflare + D1 win over the older TDD |
| Decimal/NUMERIC money              | Integer euro cents                                                 | SQLite has no decimal type; cents plus sum-preserving rounding is exact                       |
| FinTS via python-fints on Netcup   | CSV import and manual entry behind a bank adapter interface        | Workers cannot run FinTS; a FinTS adapter needs a product id and a long-running host          |
| restic + Hetzner Storage Box       | Not part of the app                                                | D1 has point-in-time restore; self-hosting keeps the backup section of SELF_HOSTING.md        |
| Netcup deployment                  | Cloudflare Workers (hosted) and Docker (self-hosted), as on `main` |                                                                                               |
| Files on a Netcup volume           | Storage adapter: filesystem (node) or R2 (cloudflare)              |                                                                                               |

Everything else in PRD.md and TDD.md is in scope. Where they are silent, this file decides, and the
PR lists every such assumption.

## Conventions

- **Language.** Code, comments, identifiers, commit messages: English. UI text, validation messages,
  PDF content: German, informal "du", as on `main`. Domain terms use the glossary in CONTRIBUTING.md,
  plus the terms added below.
- **Money** is an `integer` column in euro cents, named without a suffix (`baseRent`, `amount`),
  documented as cents in the schema comment. Formatting and parsing live in `src/lib/money.ts`:
  `formatCents(cents)` → `1.234,56 €`, `parseCents('1.234,56')` → `123456` (accepts `1234.56` too).
- **Distribution** of an amount over shares uses `distributeCents(total, weights)` from
  `src/lib/money.ts`: largest-remainder rounding, so the parts always sum to the total, ties broken
  by index, so the result is reproducible.
- **Dates** are ISO strings `YYYY-MM-DD` in `text` columns; months are `YYYY-MM`. Helpers in
  `src/lib/dates.ts`: `today()`, `addMonths`, `daysBetween`, `overlapDays(a, b)`, `monthsInRange`,
  `formatDate` → `31.12.2026`. Timestamps are `integer` `timestamp_ms` as on `main`.
- **Ids** are `crypto.randomUUID()` strings, as on `main`.
- **Every table** that holds account data has `accountId`, and every query filters by it. Server
  modules take `(db, accountId, ...)` explicitly, as `properties.ts` does. Lookups across tables
  (e.g. the lease of a payment) re-check the account id, never trust an id from a form.
- **Roles.** `users.role` is `owner` or `manager`. Managers edit everything except: invitations,
  bank accounts (adding/removing), billing, account deletion. `requireOwner(locals)` in
  `src/lib/server/session.ts` enforces that in load functions and actions.
- **Audit log.** Mutations of tenants, leases, rents, statements, payments, bank imports and
  settings call `logChange(db, { accountId, userId }, entity, entityId, action, summary)` from
  `src/lib/server/audit.ts`. The summary is one German sentence a landlord understands.
- **D1 limits.** No interactive transactions: multi-statement writes go through
  `runBatch(db, [stmt, ...])` from `src/lib/server/db/batch.ts`, which uses `db.batch` on D1 and a
  transaction on SQLite. At most 100 bound parameters per statement: insert at most 8 rows per
  `insert().values([...])` call (`chunk()` helper in `src/lib/server/db/batch.ts`).
- **Forms** are SvelteKit form actions with `use:enhance`, server-side validation in
  `src/lib/forms/<feature>.ts` using the field helpers in `src/lib/forms/fields.ts`
  (`textField`, `moneyField`, `dateField`, `enumField`, `numberField`, `optional`). A failed action
  returns `fail(400, { errors, values })` and the page re-renders the values with `defaultValue`,
  as on `main`. No client-side state libraries.
- **Pages** use the shared components in `src/lib/components/` (`PageHeader`, `Tabs`, `EmptyState`,
  `ConfirmButton`, `Field`, `Badge`, `DataTable`) and the classes in `app.css`. Feature-specific
  styles go into the page's own `<style>` block.
- **Tests.** Pure logic in `src/lib/domain/*` has unit tests with reference numbers worked out by
  hand in the test. Server modules are tested against `createSqliteDatabase(':memory:')`, always
  including a "does not leak into another account" case. Each feature has at least one end-to-end
  test in `e2e/` that creates its own data with unique names and runs in the `signed in` project.

## Data model

Existing tables on `main` stay as they are: `accounts`, `users`, `sessions`, `properties`, `units`,
`tenants`, `leases`, `lease_tenants`. The spike adds columns and tables in one migration,
`0002_prototype.sql`, generated with `npm run db:generate`. Only additive changes (new tables, new
nullable or defaulted columns), so a database from `main` upgrades in place.

### Accounts, users, access

- `accounts` + `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus`
  (`none` | `trialing` | `active` | `past_due` | `canceled`, default `none`), `currentPeriodEnd`
  (timestamp, null), `trialEndsAt` (timestamp, null).
- `users` + `role` (`owner` | `manager`, default `owner`), `name` (text, null).
- `invitations`: id, accountId, email, role (`manager`), tokenHash, expiresAt, invitedBy (user id),
  acceptedAt (null), createdAt. The link `/einladung/<token>` lets the invitee register into the
  inviting account; only the SHA-256 of the token is stored, as for sessions.
- `password_resets`: id (= SHA-256 of token), userId, expiresAt, createdAt. One hour validity.
- `login_attempts`: email (primary key), failures, lockedUntil (timestamp, null), updatedAt.
  5 failures within 15 minutes lock the address for 15 minutes.
- `audit_log`: id, accountId, userId (null for system), at, entity (text, e.g. `lease`), entityId,
  action (`create` | `update` | `delete` | `approve` | `import` | ...), summary (German).

### Portfolio (Bestand)

- `properties` + `notes` (text, null).
- `units` + `floor` (text, null), `rooms` (real, null), `notes` (text, null). `kind` stays
  `apartment` | `commercial` | `parking`.
- `tenants` + `salutation` (text, null), `street`, `postalCode`, `city` (text, null, for the
  address on letters), `notes`.
- `leases`: `unitId` stays the main unit (Hauptmietsache). Added: `kind`
  (`residential` | `commercial` | `parking`, default `residential`; commercial is without VAT),
  `rentModel` (`fixed` | `graduated` | `indexed`, default `fixed`), `persons` (integer, default 1;
  occupants for the persons key), `rentDueDay` (integer, default 3), `indexBaseMonth` (`YYYY-MM`,
  null), `indexBaseValue` (real, null; VPI value the current rent is based on), `terminatedAt`
  (date, null; when notice was given), `notes`. `baseRent`, `operatingCostPrepayment` and
  `securityDeposit` stay, but the rent values are the _initial_ values; the current rent is read
  from `rent_changes`.
- `lease_units`: leaseId, unitId (primary key both). Additional units rented with the main unit,
  e.g. a parking space. The main unit is not repeated here.
- `rent_changes` (Mietänderungen, the rent history): id, accountId, leaseId, validFrom (date),
  baseRent, operatingCostPrepayment, heatingCostPrepayment (default 0), reason
  (`initial` | `manual` | `graduated` | `indexed` | `statement`), status (`approved` | `proposed`),
  note, indexMonth (`YYYY-MM`, null), indexValue (real, null), letterText (text, null; the index
  increase letter), createdBy, createdAt. Creating a lease inserts the `initial` change. The rent
  valid on a day is the approved change with the latest `validFrom <= day`.
- `deposit_transactions` (Kaution): id, accountId, leaseId, date, amount (positive = received from
  tenant, negative = returned or withheld), kind (`received` | `interest` | `returned` | `withheld`),
  note, createdAt.
- `consumer_price_index` (VPI, per account so one account cannot alter another's figures): id,
  accountId, month (`YYYY-MM`), value (real), baseYear (text, e.g. `2020`), createdAt; unique
  (accountId, month, baseYear).

### Rent ledger (Mietkonto)

- `rent_charges` (Soll): id, accountId, leaseId, period (`YYYY-MM`), dueDate, baseRent,
  operatingCostPrepayment, heatingCostPrepayment, amount (the total; for non-rent kinds the whole
  amount, positive = tenant owes), kind (`rent` | `statement_balance` | `co2_reimbursement` |
  `adjustment`), referenceId (null; statement id for statement balances), note, createdAt. Unique
  (leaseId, period, kind) for kind `rent`. Monthly charges are generated on demand up to the current
  month from the rent history (`ensureCharges(db, accountId, leaseId, untilMonth)`), never for
  months outside the lease term.
- `payments` (Ist): id, accountId, leaseId, date, amount (positive = received), source
  (`manual` | `bank`), bankTransactionId (null, unique when set), note, createdAt.
- Balance of a lease = sum(payments.amount) − sum(rent_charges.amount). Negative = Rückstand,
  positive = Guthaben. Per-month view: charges and payments interleaved, running balance.

### Banking

- `bank_accounts`: id, accountId, name, iban, bic (null), holder, createdAt.
- `bank_imports`: id, accountId, bankAccountId, fileName, rowCount, importedCount, duplicateCount,
  importedBy, createdAt.
- `bank_transactions`: id, accountId, bankAccountId, importId (null for manual), bookingDate,
  valueDate (null), amount (signed cents), counterpartName, counterpartIban (null), purpose,
  fingerprint (SHA-256 of bookingDate|amount|counterpartName|counterpartIban|purpose), status
  (`unmatched` | `matched` | `ignored`), paymentId (null; the payment created from it), createdAt.
  Unique (bankAccountId, fingerprint), so re-importing the same file adds nothing.
- `matching_rules`: id, accountId, leaseId, field (`counterpartIban` | `counterpartName` |
  `purpose`), pattern (text, matched case-insensitively as "contains"), confirmed (bool),
  createdAt. Confirmed rules match automatically on import and create the payment; a suggestion
  (unconfirmed rule or a heuristic hit such as the tenant's last name in the counterpart) is shown
  in the review list and becomes a confirmed rule when the user assigns and ticks "merken".

### Operating costs (Betriebskosten)

- `cost_categories` (Kostenarten): id, accountId, name, betrkvItem (integer, null; number in
  § 2 BetrKV), allocable (bool, default true; false for e.g. Verwaltung, Instandhaltung),
  consumptionBased (bool, default false), sortOrder, createdAt. Seeded per account on first use with
  the 17 items of § 2 BetrKV plus "Verwaltungskosten (nicht umlagefähig)" and "Instandhaltung
  (nicht umlagefähig)".
- `allocation_keys` (Umlageschlüssel): id, accountId, propertyId (null = usable for all
  properties), name, kind (`area` | `persons` | `units` | `consumption` | `mixed` | `custom`),
  meterKind (null; for `consumption` and `mixed`: `cold_water` | `hot_water` | `heat` | `gas` |
  `electricity`), consumptionPercent (integer, null; for `mixed`: share by consumption, the rest by
  area; § 7 HeizKV requires 50–70 for heating), createdAt. Seeded per account: Wohnfläche,
  Personen, Einheiten, Heizung 70/30.
- `allocation_key_shares`: keyId, unitId, share (real). Only for `custom` keys (e.g. Miteigentums-
  anteile).
- `billing_circles` (Abrechnungskreise): id, accountId, propertyId, name; `billing_circle_units`:
  circleId, unitId. A cost item without a circle is shared by all units of the property.
- `cost_items` (Belege / Kosten): id, accountId, propertyId, categoryId, allocationKeyId,
  billingCircleId (null), description, supplier (null), invoiceDate (null), periodStart, periodEnd
  (the period the cost covers; prorated by days into the statement period), amount, allocable
  (bool; copied from the category, editable), documentId (null), createdAt.
- `meters` (Zähler): id, accountId, propertyId, unitId (null = building meter), kind (as meterKind),
  serialNumber (null), unit (text: `m³` | `kWh` | `Einheiten`), location (null), createdAt.
- `meter_readings`: id, accountId, meterId, readAt (date), value (real), note (null), createdAt.
  Consumption in a period is the difference of the readings interpolated linearly at the period
  bounds; a missing reading produces a warning in the statement, not a crash.
- `operating_cost_statements` (Abrechnungen): id, accountId, propertyId, periodStart, periodEnd,
  version (integer, 1 for the first, n+1 for a correction), status (`draft` | `approved`),
  supersededById (null; the correction that replaced this version), result (text JSON; the frozen
  computation, written on approval and recomputed for drafts), approvedAt, approvedBy, note,
  createdAt. Approval posts one `rent_charges` row of kind `statement_balance` per lease (positive
  = Nachzahlung, negative = Guthaben). A correction version reverses the previous posting with a
  negated row and posts its own.

### Documents, tasks

- `documents`: id, accountId, name, mimeType, size, storageKey, propertyId, unitId, leaseId,
  tenantId, costItemId (all null-able links), uploadedBy, createdAt. Stored via the adapter in
  `src/lib/server/storage/`; max 10 MB; only served to signed-in users of the same account.
- `tasks` (Aufgaben): id, accountId, title, dueDate (null), done (bool), doneAt (null), propertyId,
  leaseId (null-able links), note, createdAt. Deadlines that follow from the data (statement
  deadline 12 months after the period, lease ends, deposit return) are computed on the fly by
  `src/lib/server/deadlines.ts` and shown next to the tasks; they are not stored.

## Domain rules implemented

- **Rent valid on a day:** latest approved `rent_changes` row with `validFrom <= day`.
- **Graduated rent (Staffelmiete, § 557a BGB):** the user enters steps (date, new base rent);
  each becomes a `graduated` rent change, approved immediately. At least one year between steps
  for residential leases (validation).
- **Index rent (Indexmiete, § 557b BGB):** base month and base value on the lease. The proposal
  compares the latest VPI month entered with the base: new rent = base rent × (new index ÷ base
  index), rounded to cents. One increase per year, at least 12 months after the last change. The
  increase takes effect at the start of the second month after the letter is delivered
  (`effectiveFrom(deliveryDate)` = first day of month + 2). The letter text is generated in German
  and stored on the `proposed` change; approving sets `status = approved`. Commercial leases: no
  waiting periods, effective date editable.
- **Rent charges:** one per month of the lease term; the first and last month are prorated by
  days when the lease starts or ends mid-month.
- **Operating cost statement** (`src/lib/domain/statement.ts`, pure):
  1. For each cost item in the property, take the share of the amount that falls into the
     statement period (overlap days ÷ cost period days), skip non-allocable items (listed
     separately as landlord costs).
  2. Determine the units of the item's circle (or all units). Compute each unit's weight per key:
     area → floor area (missing area = warning, unit excluded); persons → person-days of the
     leases on the unit in the period, vacancy counts 0 (warning when no lease); units → 1;
     consumption → consumption of the unit's meters of the key's meter kind in the period
     (missing = warning, unit weight 0); mixed → `consumptionPercent` of the amount by consumption,
     remainder by area; custom → shares table.
  3. Distribute the item amount over the units with `distributeCents`.
  4. Split each unit's amount over the leases occupying the unit in the period by occupancy days;
     days without a lease are the landlord's vacancy share.
  5. Per lease: sum by category, prepayments = sum of monthly `operatingCostPrepayment +
heatingCostPrepayment` from the rent history over the occupied months (prorated), balance =
     costs − prepayments. Per property: totals, vacancy share, non-allocable total, warnings.
  6. Deadline: the statement must reach the tenant within 12 months after the period ends
     (§ 556 Abs. 3 BGB); the UI shows the date and warns when it has passed (no Nachforderung).
- **CO₂ cost split (CO2KostAufG)** for tenants with their own gas contract: input annual gas
  consumption in kWh, CO₂ cost paid, living area of the building; emission factor 0.201 kg/kWh
  (natural gas) → kg CO₂ per m² per year → landlord share per Anlage 1 (residential): < 12 kg: 0 %,
  12–<17: 10 %, 17–<22: 20 %, 22–<27: 30 %, 27–<32: 40 %, 32–<37: 50 %, 37–<42: 60 %, 42–<47: 70 %,
  47–<52: 80 %, ≥ 52: 95 %. The result can be posted to the ledger as a `co2_reimbursement`
  credit. Commercial leases: 50/50 (§ 8).
- **Deposit (§ 551 BGB):** at most three monthly base rents (validation warning), payable in three
  instalments; the deposit ledger is separate from the rent ledger.
- **Bank matching:** on import, each new transaction is tested against confirmed rules (first
  match wins, in creation order) and gets a payment; otherwise against suggestions: unconfirmed
  rules, IBAN of an earlier assignment, tenant last name or unit name contained in counterpart or
  purpose. Assignments can be undone (deletes the payment, status back to `unmatched`).

## Routes

Public: `/anmelden`, `/registrieren`, `/abmelden`, `/passwort-vergessen`,
`/passwort-zuruecksetzen/[token]`, `/einladung/[token]`, `/webhooks/stripe`, `/health`.

Signed in (German paths; every page has a `<title>` ending in `· mietkartei`):

| Path                                                                      | Feature               | Content                                                                                |
| ------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| `/`                                                                       | dashboard             | Übersicht: Rückstände, Leerstand, offene Bankumsätze, nächste Fristen, offene Aufgaben |
| `/objekte`, `/objekte/[id]`, `/objekte/[id]/bearbeiten`                   | portfolio             | as on main, plus edit/delete, units with edit, meters, billing circles                 |
| `/objekte/[id]/einheiten/[unitId]`                                        | portfolio             | unit detail: edit, leases on it, meters                                                |
| `/objekte/[id]/zaehler`                                                   | operating-costs-setup | meters and readings of the property                                                    |
| `/mieter`, `/mieter/neu`, `/mieter/[id]`                                  | tenants-leases        | tenants with their leases and documents                                                |
| `/vertraege`, `/vertraege/neu`, `/vertraege/[id]`                         | tenants-leases        | lease overview tab                                                                     |
| `/vertraege/[id]/miete`                                                   | rent                  | rent history, Staffel, Index proposal and letter                                       |
| `/vertraege/[id]/mietkonto`                                               | ledger                | charges, payments, running balance, manual payment                                     |
| `/vertraege/[id]/kaution`                                                 | tenants-leases        | deposit transactions                                                                   |
| `/vertraege/[id]/co2`                                                     | co2                   | CO₂ split calculator and posting                                                       |
| `/vertraege/[id]/dokumente`                                               | documents             | documents of the lease                                                                 |
| `/mietkonto`                                                              | ledger                | all leases with balances, arrears first                                                |
| `/bank`, `/bank/konten`, `/bank/import`, `/bank/umsaetze`, `/bank/regeln` | banking               |                                                                                        |
| `/betriebskosten`                                                         | statements            | statements per property and period, new statement                                      |
| `/betriebskosten/abrechnungen/[id]`                                       | statements            | draft/approved result, approve, correct, PDF per lease                                 |
| `/betriebskosten/abrechnungen/[id]/pdf/[leaseId]`                         | statements            | PDF download                                                                           |
| `/betriebskosten/kosten`, `/betriebskosten/kosten/neu`                    | operating-costs-setup | cost items                                                                             |
| `/betriebskosten/kostenarten`, `/betriebskosten/schluessel`               | operating-costs-setup | categories, keys                                                                       |
| `/dokumente`, `/dokumente/[id]/download`                                  | documents             | all documents, upload, delete                                                          |
| `/aufgaben`                                                               | tasks                 | tasks and computed deadlines                                                           |
| `/import`                                                                 | import                | CSV import of properties/units and tenants with field mapping and preview              |
| `/einstellungen`                                                          | foundation            | hub linking the pages below                                                            |
| `/einstellungen/profil`                                                   | auth                  | name, email, password change                                                           |
| `/einstellungen/mitverwalter`                                             | auth                  | invitations (owner)                                                                    |
| `/einstellungen/vpi`                                                      | rent                  | VPI values                                                                             |
| `/einstellungen/export`                                                   | auth                  | JSON export of the account                                                             |
| `/einstellungen/protokoll`                                                | auth                  | audit log                                                                              |
| `/einstellungen/konto`                                                    | auth                  | delete account (owner)                                                                 |
| `/abo`                                                                    | billing               | subscription (owner; only when Stripe is configured)                                   |

## Module layout

```
src/lib/money.ts, dates.ts, format.ts        shared helpers (client + server)
src/lib/forms/fields.ts, <feature>.ts        form parsing and validation
src/lib/domain/<feature>.ts                  pure logic, no database, unit-tested
src/lib/server/<feature>.ts                  database access, account-scoped
src/lib/server/db/schema.ts, batch.ts        schema and the batch/chunk helpers
src/lib/server/storage/{index,fs,r2}.ts      document storage adapter
src/lib/server/mail.ts                       mail adapter: Resend HTTP API, console, or outbox table
src/lib/server/billing.ts, stripe.ts         Stripe via fetch (works on Workers and Node)
src/lib/components/*.svelte                  shared UI
src/routes/...                               pages, see the route table
e2e/<feature>.e2e.ts                         end-to-end tests
```

## Environment variables

| Variable                                                        | Meaning                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `DATABASE_PATH`, `OPEN_REGISTRATION`, `ORIGIN`, `PORT`          | as on main                                                                                                    |
| `DATA_DIR`                                                      | node: directory for uploaded documents, default `./data/documents`                                            |
| `MAIL_TRANSPORT`                                                | `console` (default: log the mail), `resend` (HTTP API), `outbox` (store in the `outbox` table, used by tests) |
| `MAIL_API_KEY`, `MAIL_FROM`                                     | for `resend`                                                                                                  |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | billing; unset = billing pages hidden                                                                         |
| `BILLING_REQUIRED`                                              | `true`: accounts without an active subscription after the 30-day trial can only read                          |
| `PUBLIC_APP_NAME`                                               | not used; the brand is fixed                                                                                  |

Cloudflare bindings: `DB` (D1), `DOCUMENTS` (R2 bucket, local in `wrangler dev`).

## How features are built in parallel

The foundation (schema, migration, env, hooks, layout, shared helpers and components, tenants and
leases server modules) is committed first. Each feature then adds files under its own paths and
does not edit the foundation files; what a feature needs changed in them it reports, and the
integration step applies it. Shared paths each feature may add to: `src/routes/<its routes>`,
`src/lib/domain/<feature>.ts`, `src/lib/server/<feature>.ts`, `src/lib/forms/<feature>.ts`,
`src/lib/components/<Feature>*.svelte`, `e2e/<feature>.e2e.ts`, and `*.spec.ts` next to the code.
