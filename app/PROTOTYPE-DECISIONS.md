# Prototype decisions

Every product and technical decision the feature builds made where PRD.md, TDD.md and
[PROTOTYPE.md](PROTOTYPE.md) were silent, and what each build left out. The design-level
assumptions are in PROTOTYPE.md ("Assumptions and open questions"); this file is the detail per
feature. When a feature is ported to main, its section is the checklist of what to confirm.

## Decisions per feature

### E2E seed endpoint

- Owner lookup orders by `createdAt` then SQLite `rowid`, because `testDatabase()` inserts both users in one statement with identical timestamps; without the tie-break "first user" would be undefined. With no user it calls `ensureDefaultAccount` so inserts into `default` satisfy the FK, and uses `userId: null` as audit context.
- Table names for `rows`/`clear` accept either the schema export name (`costCategories`) or the SQL name (`cost_categories`); the check is `is(value, SQLiteTable)` (subclass of `Table`, which `db.insert` requires).
- `rows`: unknown column keys are refused with 400 naming the column (so a typo in a test fails loudly instead of being silently dropped by Drizzle); timestamp columns accept a number or ISO string and are converted to `Date`; tables without an `id` column (link tables) contribute nothing to `ids`; inserts go through `runBatch` in `rowsPerStatement` chunks for the D1 parameter limit. Non-account tables (e.g. `outbox`) are allowed for `rows`, only refused for `clear`.
- `clear` validates every name before deleting anything and runs the deletes atomically in the given order.
- `user` normalizes the email and returns 400 (not a thrown unique-constraint error) when the address is taken.
- Errors thrown while executing (constraint violations, wrong value types) are returned as `{ status: 500, body: { message } }` rather than crashing the route, so the Playwright helper's thrown error carries the cause.
- The lease defaults duplicate `leaseInput()` from testing.ts rather than importing it, because testing.ts imports the better-sqlite3 driver and must not end up in the Workers bundle. Tenant default last name is `Muster-<suffix>`.

### Layouts and navigation

- Lease lead format: `"<Vorname Nachname>, <…> · seit 01.01.2024"` plus `" bis 31.12.2026"` when `endDate` is set; the " · " separator mirrors `leaseLabel`. When the lease has no tenants the lead is just the "seit …" part.
- Tabs.svelte matches the first tab exactly and the other tabs by prefix (`path === href || path.startsWith(href + '/')`), so `/objekte/[id]/bearbeiten` and `/vertraege/[id]/bearbeiten` render inside the layout with no tab marked current; `/vertraege/[id]/miethoehe/...` subpages keep "Miethöhe" marked. Not changed.
- The tab hrefs are built from `data.property.id` / `data.lease.id` (not `page.params`) so the layouts do not depend on `$app/state`.

### Forms

- `kind`, `rentModel`, `operatingCostModel`, `heatingCostModel` are required (no silent fallback to the schema defaults); the CSV import must supply them per row.
- Index base fields are always format-checked when given (invalid month / non-positive value error even for a fixed rent) but are nulled in the data unless the rent is indexed. A zero index value gets "Der Indexwert muss größer als 0 sein."; a negative one gets the generic "Der Wert darf nicht unter 0 liegen." from `FormParser.number`.
- Termination is symmetric: `terminatedAt` without `terminatedBy` → "Bitte wähle aus, wer gekündigt hat." on `terminatedBy`; `terminatedBy` without `terminatedAt` → "Bitte gib an, wann gekündigt wurde." on `terminatedAt` (rather than silently dropping the party).
- `ledgerStart` is only range-checked when `startDate` parsed; the end bound is only applied when `endDate` parsed. No check that `terminatedAt` lies within the term.
- `extraUnitIds` are not de-duplicated or checked against `unitId` here; `createLease`/`updateLease` already do that.

### CSV parsing

- Windows-1252 fallback: on this Node (22.22, full ICU) `new TextDecoder('windows-1252')` decodes 0x80–0x9F as C1 control characters (U+0080…), so `€`, `„“` and `–` from bank exports came out wrong. `decodeCsv` still decodes with `TextDecoder('windows-1252')` as specified, then maps any U+0080–U+009F through the 32-entry WHATWG windows-1252 table (`WINDOWS_1252_C1`); on a runtime that decodes correctly this is a no-op. The spec covers `ü ß € „ “ –`.
- The BOM is stripped at byte level (EF BB BF) before decoding, so a BOM never leaks into the windows-1252 path.
- `parseCsv` also accepts CRLF/CR input directly (not only via `decodeCsv`); inside quoted fields line breaks come out as LF. Whitespace around a quoted field (`; " b " ;`) is dropped, the quoted content is kept verbatim. Malformed input (quote mid-field, text after a closing quote) is read leniently, never thrown.
- "Empty line" in `parseCsv` means a line that is blank (empty or whitespace only); a row like `;;` is kept by `parseCsv` and then skipped by `toRecords` (every cell `''`).
- `toRecords`: cells beyond the header are dropped, columns with an empty header name are dropped, for duplicate header names (ING has "Währung" twice) the first column wins, and an out-of-range `headerIndex` (e.g. an unchecked -1) throws a `RangeError` rather than returning garbage.
- `csvLine` additionally quotes a field with leading/trailing whitespace, so that `parseCsv` (which trims unquoted fields) reads it back unchanged; the round-trip test covers all three delimiters.
- `detectDelimiter` on a tie between `,` and `\t` (both beating `;`) picks `,` (candidate order `; , \t`).

### Ledger (foundation)

- `ensureCharges` syncs up to max(untilMonth, latest stored rent period of the lease), so a call with an earlier horizon (e.g. `listBalances({ untilMonth })`) never deletes and re-creates rows within the term; rows outside the term are still removed. `inserted` counts planned inserts (an upper bound under concurrent syncs, because of `onConflictDoNothing`).
- `rentDueDay < 1` is treated as 1 (`nthWorkingDay(month, 0)` would never return). A `ledgerStart` before `startDate` is ignored; a mid-month `ledgerStart` prorates that month.
- `listLedger` window: lines before `from` are left out but still feed the running balance; `charged`/`paid` are sums of the returned lines; `balance` is the balance at the end of the window (carry-over + charged − paid); lines after `to` are ignored.
- Labels: charges `"<kind label> <Monat JJJJ>"` plus `": <note>"` when a note is set; payments: note, else `"Zahlung"` (`"Rückzahlung"` for negative amounts). Audit summaries (entity `lease`, id = leaseId): `"Korrektur Mai 2025 über 50,00 € gebucht"` / `"… als Gutschrift über 50,00 € gebucht"` (action `post`), `"… gelöscht"` (`delete`), `"Zahlung 650,00 € vom 03.04.2025 gebucht"` / `"Rückzahlung …"` (`create`), `"Zahlung … gelöscht"` (`delete`).
- `deletePayment` deletes any payment of the account including `bank`-sourced ones and does not touch `bank_transactions.status`; the banking undo should reset the status in its own batch.
- `listBalances` returns every lease of the account (zeros when nothing is booked), sorted by balance descending then leaseId; `lastPaymentDate` only counts positive amounts. `overdue` and `openSince` count only charges with `dueDate <= asOf` (default today), sorted by due date; payments and due credits settle the oldest due charges first, and `openSince` is the month of the due date of the first charge they do not cover (a Nachzahlung for period 2025-12 due in April 2026 is "offen seit April 2026"). `balance` still includes charges not due yet.

### Properties and units

- The create form moved from `/objekte` to `/objekte/neu`; `/objekte` keeps a toolbar link "Objekt anlegen" and the e2e test was adapted accordingly.
- Deleting a unit or property is refused while any lease references it, including ended leases (restrict FK; the history must stay). The refusal says so instead of suggesting to end the lease; the property's refusal counts and links the leases on its units (main or extra unit), the unit page lists them already.
- An ended lease still counts as "in use" for deletion, but vacancy/active counts use only leases running on `today()`.
- Extra-unit occupancy is shown as "(mitvermietet)" in the units list and "Mitvermietet" on the unit detail; a vacant unit shows Badge "Leerstand" plus "Mietvertrag anlegen".
- `vacancyPersons` is limited to 0–10 (integer); rooms 0–100 (decimal, e.g. 2,5); notes up to 2000 characters; floor is free text (50 chars).
- `parseUnit` now uses FormParser.number, which treats "." as a thousands separator ("72.5" becomes 725); the German comma is the documented input.
- Audit summaries: "Objekt <Name> angelegt/geändert/gelöscht", "Einheit <Name> in <Objekt> angelegt/geändert/gelöscht".
- validation.ts is loaded in the browser (registrieren page), so the building-use enum comes from `buildingUseLabels` in labels.ts, not from the server schema.

### Tenants, leases, deposit

- Ledger start default: when the start date is in the past and the field is empty, ledgerStart = first day of the current month, unless the lease ends before that (then left empty = start date).
- Opening balance is posted as a separate `postCharge` adjustment (period = month of the ledger start, due date = ledger start, note "Anfangssaldo") right after createLease; a zero opening balance posts nothing.
- Deposit instalment deadlines are the due dates of the first three months computed from the rent history (same rule as the ledger, ignoring ledgerStart), the first one never before the start date (§ 551 Abs. 2: at the start of the tenancy, as in deadlines.ts), split with distributeCents; shown while received < agreed, residential only.
- "Vertrag beenden" is prefilled for a tenant's notice received today; with JS the end date follows the receipt date and the party (landlord's 6/9 months included) and the hint names the earliest legal date. The action recomputes it and refuses an earlier end date unless "Früheres Ende vereinbart (Aufhebungsvertrag)" is ticked (noted in the audit line). The notice cutoff is the third Werktag counting Saturday (BGH VIII ZR 206/04), moved to Monday when it is a Saturday (§ 193 BGB); holidays are not modelled. Commercial leases follow § 580a Abs. 2 (third Werktag of a quarter, end of the next quarter, no landlord extension); parking leases keep the plain three months (§ 580a Abs. 1 Nr. 3).
- The Betriebskostenabrechnung deadline after a lease end is 12 months after 31 December of the end year.
- endLease refuses an end date before the start; it runs ensureCharges afterwards so months after the end leave the ledger immediately.
- Deposit movements assigned from a bank transaction cannot be deleted on the Kaution tab (sentence points to the banking pages).
- The first persons row (valid from the start date) belongs to the lease and cannot be deleted; later rows can.
- The lease edit form merges the units from the stored lease into the form data so parseLease validates the whole lease as on creation. The amounts, deposit and persons at the start are edited there (labelled "bei Vertragsbeginn"): updateLease moves the initial rent change and persons row and carries changed initial amounts into later rent rows that still held the old value. A new start date on or after a later approved rent change or persons row is refused with a field error naming the date (the unique indexes would otherwise fail the batch).
- `/mieter/neu?return=` accepts only paths starting with a single "/" and appends `tenantId=<id>` on return.

### Rent changes, index and graduated rent

- A manual change of the base rent on an indexed lease records the latest VPI month/value, so the next proposal starts from that rent and index; prepayment-only and `statement` changes record none.
- A proposal is refused (with a sentence) when the latest VPI month is not newer than the reference month or the index did not rise, when a proposal is already pending, and on residential leases while the provisional effective date is before the waiting period end.
- Approving re-checks the waiting period against the actual effective date; for commercial/parking leases the effective date is free but must be after the delivery date.
- Staffel steps keep the prepayments valid on the day of the step and are confirmed with a ConfirmButton naming the Kaltmiete and the date.
- Rent history rows store all three amounts, so every write carries the fields it changes into the later approved rows that still held the old value, up to the first later row that set the field itself (`laterRowUpdates`, `rent-history.ts`): a § 560 change after Staffel steps entered up front reaches the steps, a step or approved index change reaches a later § 560 row, a corrected initial amount reaches later rows, and deleting a change lets the rows that inherited from it fall back. An approved index change takes the prepayments valid on its effective date, not those copied at proposal time.
- A § 560 change (reason `statement`) changes only the prepayments: a Kaltmiete different from the one valid on its date is refused with a sentence. The change form is prefilled with the rent valid on its default date (not today's), and the § 557a/§ 557b note requirement compares with that rent. Changes and Staffel steps before the lease start are refused.
- An approved change cannot be deleted while a later approved index or Staffel change builds on it; proposals can always be deleted.
- The letter's base year is taken from the account's VPI table (fallback 2020); the recipient address is the first tenant with an address, else the property's; the letter date is the delivery date.
- VPI values: at most one decimal, base year four digits default 2020, one value per (base year, month), deletion via ConfirmButton.

### Mietkonto pages

- `/mietkonto` sorts leases in arrears first, then everything by label (`unit · property`, German collation); ended leases stay in the list with a Badge "beendet".
- The arrears filter is the query parameter `?filter=rueckstaende`, rendered as two links (Alle / nur Rückstände) in the toolbar.
- The stats block shows the sum and count of leases in arrears and with credit. Arrears (stats, sort, filter, dashboard tile) use `overdue`, not `balance`: a lease that only owes charges not due yet shows its balance with the badge "noch nicht fällig"; when only part of a balance is due, "davon fällig …" is shown under it. The "Offen seit" column shows the month only.
- The adjustment form is headed "Korrektur oder Anfangssaldo" (button "Korrektur buchen", messages "Korrektur gebucht/gelöscht.").
- The lease tab reads the ledger once from the range start without an upper bound, so the headline "Saldo" sentence is the lease's full balance (incl. postings after the range); the table footer shows Soll/Haben sums of the shown months and the balance at the range end.
- A manual payment may be negative (refund); zero is refused. An adjustment requires a note ("Anfangssaldo", "Mietminderung …"); its period is the month of its date and the due date is the date.
- Deleting a bank-sourced payment or a non-adjustment charge from the ledger tab is refused with a German sentence that points to /bank or to the posting feature; the buttons are not rendered for those rows.
- Charges with a negative amount (credits) appear in the Soll column with a minus sign; payments in Haben.

### Bank import and matching

- Bank account deletion is refused only while a transaction is `matched`; unmatched/ignored transactions are deleted with the account (cascade).
- Managers can open /bank/konten but see only the sentence "Bankverbindungen sind nur für Vermieter sichtbar, nicht für Mitverwalter."; all actions there call requireOwner.
- A split assignment is limited to two leases, only for target rent (a deposit is never split), and cannot be remembered as a rule.
- "Zuordnung merken" creates a confirmed rule on the counterpart IBAN when present, else on the counterpart name; nothing when both are empty.
- Rules order: `createdAt` then rowid; confirmed rules apply on import to incoming amounts only; suggestions use all rules (unconfirmed included), then IBAN of the latest earlier assignment, then tenant last name, then unit name (names under 3 characters are not searched).
- Payments from an assignment carry `source: 'bank'`, the booking date and the purpose as note; deposit movements get kind `received` (incoming) or `returned` (outgoing).
- DKB rows with Status "Vorgemerkt" are reported as invalid ("Noch nicht gebucht (vorgemerkt)") and skipped; comdirect's "Auftraggeber: … Buchungstext: … Ref. …" text is split into counterpart and purpose.
- Generic files: the header is the first row as wide as the widest row; the mapping needs at least the booking date and amount columns; the hidden base64 field carries the file (CSV limit 2 MB).
- The preview table shows at most 500 rows (counts cover all); the Umsätze list shows the newest 200 with a hint.
- Invalid rows are counted in the audit/import summary as skipped, not stored.
- A double commit of one file: the second batch's payments point at transactions the first one stored, so it fails on the foreign key; the import then runs once more and reports the rows as duplicates (with its own bank_imports row). Rule-hit payments and their audit lines are bulk inserts (per 100 parameters).
- The status guard of assign/undo/ignore/reopen is `INSERT INTO bank_transactions SELECT * … WHERE id = ? AND status <> ?`: when the status differs it copies the row onto its own primary key, which fails the batch; the function then re-reads the status and answers "nicht mehr offen" instead of a 500. The /bank buttons of a row are disabled while its form is on its way.

### Documents

- The download sends `Content-Encoding: identity` explicitly: Workers (and wrangler dev's proxy) otherwise gzip text files on the fly, chunked and without Content-Length, so the bytes and the header would differ between targets.
- `?inline=1` is honored only for PDFs and raster images (`canInline`); other types stay `attachment` so HTML or SVG uploads are never rendered in the app's origin. `X-Content-Type-Options: nosniff` is set.
- A typed name without the file's extension gets it appended (`Mietvertrag` + `scan.pdf` → `Mietvertrag.pdf`), so downloads open with the right program.
- The upload form offers property, lease and tenant links; unit and cost item links are set by their owning pages (filterable here, shown as link text). The lease tab fixes leaseId and copies the lease's propertyId; links fixed by the page win over form values.
- Link texts in the list: lease = `unit · property · tenants`, unit = `unit · property`, cost item = description; a link whose row is gone is omitted (set null semantics).
- Size formatting: B below 1 KB, KB below 1 MB, MB above, one decimal, German number format.
- Error page for the download route in a browser is SvelteKit's plain endpoint error page (message "Dieses Dokument gibt es nicht."), not `+error.svelte`; the e2e asserts the status and that sentence.

### Operating costs setup

- Standard categories and keys are seeded without audit lines (the standard list is not a change the landlord made); only landlord edits are logged.
- Default keys are assigned only where `allocationKeyId` is null, so a landlord's choice is never overwritten by a later ensureDefaults.
- Deleting a billing circle is never refused: cost items and categories that named it fall back to all units of the property (schema sets null); the page says so.
- Updating a key drops its shares when it stops being a custom key of the same property; updating a cost item drops the per-unit amounts when its key is no longer direct or the property changes.
- A unit with an empty or zero share/amount gets no row; shares are any positive decimal (e.g. Miteigentumsanteile), per-unit amounts may be negative (credit notes), and cost item amounts may be negative.
- In the cost item form, "Standard der Kostenart" for the circle takes the category's default circle, while "Alle Einheiten des Objekts" explicitly means no circle; for the key, "Standard der Kostenart" takes the category's key and the form refuses when neither names one.
- The CO₂ kg is prefilled from kWh × factor (gas/oil/lpg) only when the field is empty; fuel figures are stored only when a fuel is chosen.
- The cost item list filters by the calendar year a period overlaps (not the invoice date); a year without items that the URL asks for (e.g. after deleting the last item of a year) is still offered and shown as empty.
- Form actions on pages with query parameters (`?meter=`, `?unit=`, `?property=&year=`) carry the query in the action URL, because SvelteKit 3's enhance navigates to the action URL on a validation failure and would otherwise drop the expanded meter or the prefill.
- A reading on a date that already has one is refused ("Für dieses Datum gibt es schon einen Zählerstand."), not overwritten; delete it first.
- "Zähler ausbauen" sets removedAt and can be re-dated; the meter stays listed with its readings. Deleting a meter deletes its readings and the audit line names the count.
- Keys of one property are offered only for cost items of that property; the Kostenarten page lists every key with its property name as default options.

### Operating cost statements

- Cost items are prorated into the period by overlap days ÷ item days (proRata); an item without overlap is ignored.
- The landlord's CO₂ share is deducted from the item before allocation, measured against the floor area of the item's circle (or the property); for a `direct` key it is deducted from the unit amounts in proportion.
- A unit (other than parking) without a meter of the key's kind, or without a usable reading on a bound, blocks approval; parking spaces get 0 silently. Estimated readings warn, and estimates on more than 25 % of the area warn (§ 9a Abs. 2 HeizKV).
- At a tenant change, every meter in service must have a reading within 3 days of the change for the "readings" method; otherwise heat meters split by Gradtagszahlen, other kinds by days, with a non-blocking warning; the method is stored per cost line.
- Leases with Pauschale/Inklusivmiete that bill nothing at all get no LeaseStatement (warning only); mixed leases (e.g. Betriebskostenpauschale with heating prepayment) get a statement with the excluded shares listed; excluded and vacancy shares stay with the landlord and are shown in the property totals.
- Prepayments: the `rent` charge of each month in the lease's occupancy, else the rent history (months before ledgerStart); a Pauschale column counts 0.
- A draft stores its result at creation but is recomputed on every view; one statement per (property, period) — a second draft is refused, an approved one points to the correction; a correction increments the version and is refused while a correction draft exists.
- Approval: a residential lease's Nachzahlung after the deadline is posted as 0 unless `lateApprovalJustified` with a note (the computed balance stays in the frozen result, "posted" records the amount); Guthaben are always posted; dueDate = approval date + 30 days; the correction's reversal rows carry the correction's id as referenceId and the same due date.
- Deleting a draft is allowed any time; approved statements are never deleted.
- The PDF addresses the tenants at the first tenant address found, else the property address; the greeting uses "Frau/Herr Nachname" when the salutation is one of those; filename "Betriebskostenabrechnung <period> <unit names>.pdf".
- Statement list rows show the stored property totals (also for drafts, from creation time).
- A period runs from the first to the last day of a month (prepayments are charged per month, so a cut month would count in full), and it may not overlap another statement of the property (draft or approved); the same period is corrected instead.
- The CO₂ tier is taken once per circle (or property) from the kg of all its fuel bills, each prorated to the period and the sum scaled to the twelve months from the period start; each bill's prorated CO₂ cost gets that percent. The disclosure keeps the bill's kg (`co2Kg`) and the building's (`buildingCo2Kg`).
- Estimates on more than 25 % of the area move the consumption part of that cost item to the floor area (§ 9a Abs. 2 HeizKV); the share text says so.
- `direct` amounts are prorated on the running sum, so amounts that add up to the bill still add up to its share of the period; amounts above the bill block the approval.
- Lateness (§ 556 Abs. 3 BGB) is judged on the approval and again on the delivery date. A late correction posts min(balance, what the corrected version still claims); a Nachzahlung delivered after the deadline is reversed when the date is saved, and the date can then no longer be moved before the deadline. A correction of a version that reached the tenant in time is not reversed on its own late delivery.
- Both deadlines run to the end of the twelfth month ("bis zum Ablauf des zwölften Monats"): the statement deadline after the period end, the Einwendungsfrist after the delivery.
- "Vorauszahlung anpassen" passes operating and heating suggestions apart (`?prepayment=&heating=`), each a twelfth of the year's lines of that kind (a part-year lease scaled to 365 days), and is offered only for leases that still run on a statement that is not superseded.
- The statement actions answer 404 for an id of another account before reading the form.

### CO₂ cost split

- Year must be ≥ 2023 (first CO2KostAufG year) and not in the future; claimedOn must not precede invoiceDate, and with an invoice date a claim more than twelve months after it is refused (§ 6 Abs. 1 CO2KostAufG; the invoice date stands in for the receipt of the bill).
- co2Kg, co2Cost and area must be > 0; invoiceDate and fuelKwh are optional.
- A duplicate year is reported as a field error on "Jahr" with the hint to delete the existing split; the year can be re-entered after deletion.
- A split with landlord share 0 % (< 12 kg/m²) is still stored and a 0 € credit is posted, so the year is documented as settled.
- The list shows the tier as "Stufe 1–10" (residential) or "Nichtwohngebäude", the deadline gets a danger Badge "Frist abgelaufen" once passed; the toolbar links to the Mietkonto tab.
- The kg prefill is rounded to one decimal; the form keeps the other entered values when re-rendering with the hint.

### Tasks and deadlines

- "Indexanpassung frühestens möglich" is dated on the first day a proposal can be sent so that it takes effect when the waiting period ends (two months before, or one month before the following first of the month when the waiting period ends mid-month); the detail names both dates.
- Statement deadlines skip residential leases with Pauschale/Inklusivmiete for both cost groups (they get no statement).
- Statement deadlines are generated only for years from the lease's ledger start (max(startDate, ledgerStart)) up to the last ended calendar year, so a migrated lease does not produce years of overdue statements.
- Deadlines that only inform (Vertragsende, Einwendungsfrist, nächste Mietstaffel, Indexanpassung frühestens möglich, CO₂-Erstattung) disappear once their date has passed; deadlines that name something to do (Betriebskostenabrechnung, Kaution abrechnen, Kautionsraten, Zählerstände ablesen) stay and carry the "überfällig" badge.
- Deposit instalment due dates are computed from rentDueDay (nthWorkingDay of the first three months, never before the start date), not read from rent_charges; "received" covers instalments in order, interest does not count; residential leases only; nothing on an ended lease.
- Kaution abrechnen is listed for an ended lease with an agreed deposit until its movements net to zero (a lease with no movement at all counts as unsettled unless the agreed deposit is 0).
- Zählerstände ablesen appears only when the lease's units have meters and no reading exists within 3 days of the end date (same tolerance as the statement's Zwischenablesung).
- The index waiting period ignores reason `statement` and changes that leave the base rent unchanged; the initial rent counts as the first change.
- CO₂ reimbursement is listed until claimedOn + 12 months passes (no check against the charge/payment, as the task allowed).
- The Fristen table on /aufgaben shows the next 12 months plus everything overdue; task rows show their own "überfällig" badge when dueDate < today.
- A task links to either a property or a lease (one select with optgroups), stored in the matching column; a task page `/aufgaben/[id]` exists for editing (the e2e checks 404 there).

### Data import (CSV)

- Properties: rows with the same property name (and street) share one new property; an existing property with that name is reused (street breaks ties); a unit that already exists in the property is skipped; the row's own unit kind words (Wohnung/Gewerbe/Stellplatz, also Garage, Laden, Büro …) are accepted, blank = Wohnung.
- Tenants: a row whose first and last name already exist in the account is skipped as a duplicate (no update).
- Leases: tenants are matched by "Nachname, Vorname", e-mail, "Vorname Nachname" or an unambiguous last name; the lease kind follows the unit kind unless the row says otherwise; rent model is always `fixed`, rent due day 3; without "Mietkonto ab" a lease that began before the current month gets the first of the current month as ledger start (as the lease form proposes), an ended lease keeps its whole term; "Anfangssaldo" is posted as an `adjustment` dated the ledger start with note "Anfangssaldo"; a lease for the same unit with the same start date is a duplicate.
- Payments: candidate leases are those of the unit (main or extra unit) running on the date, else all leases of the unit; a last name narrows them; two candidates left refuse the row asking for the last name; a payment with the same lease, date, amount and note is a duplicate; source is `manual`.
- Commit refusal: while a required field has no column (e.g. a file whose headers match nothing) or no row is valid, the commit returns a German sentence and the mapping stays on screen.
- The file is limited to 2 MB and travels as a hidden base64 field; the preview shows the first 20 rows and only the mapped columns.
- Per-row audit lines are not written; each import writes one `import` audit entry ("CSV-Import: 1 Objekt und 2 Einheiten angelegt, 1 Zeile übersprungen"); leases additionally carry the "Mietvertrag angelegt" line createLease writes.
- A lease import is one batch: every lease with its tenants, initial rent, persons row, opening balance and the audit lines (`newLeaseStatements` in leases.ts, bulk inserts), so a failure leaves no lease without its Anfangssaldo. The units and tenants are not checked again: they come from the import context loaded in the same request. The rent charges are generated afterwards (derived data).

### Accounts, managers, export, password reset

- The first registered user keeps the data of the default account in an account of its own (new UUID), so managers can be invited.
- A reset request counts as a failed attempt (one per request), and a locked address gets no reset mail; the form answers the same sentence either way.
- Password change on /profil keeps the current browser's session and ends all others; reset ends all and signs the browser in fresh.
- An address with a user anywhere or an open invitation in the account cannot be invited again; revoking first allows re-inviting; expired invitations do not block.
- Only other users can be removed ("Entfernen"), never oneself; removal deletes the user's sessions and resets; the accepted invitation row stays (invitedBy/acceptedAt keep the history).
- Invitations may carry role owner or manager (select, default manager).
- The export ZIP is streamed (fflate `Zip`): export.json deflated, documents stored as they are, read chunk by chunk from the `listDocuments` rows while the browser downloads, so there is no Content-Length; the `export` audit entry is written when the last file is in, so it is not part of the exported log and an export that fails part-way is not logged. It always contains an empty `documents/` directory entry; documents whose object is missing stay in export.json only; file names are `documents/<id>-<name>` with path/reserved characters replaced by `_`; timestamps serialize as ISO strings; accounts row included under key `accounts`.
- The export download is a GET at /einstellungen/export/download (a form action cannot stream); the page's button is a GET form.
- After the last account is deleted the instance is empty, so /anmelden redirects to /registrieren; konto.e2e.ts proves the old credentials fail by posting the sign-in action with the use:enhance header and expecting a 400 failure.
- Protokoll filter options are the distinct entities present in the account's log, labelled by auditEntityLabels (unknown entities shown raw).
- The reset mail's link comes from `ORIGIN` when set, else from the request URL on Workers (the host Cloudflare routed) and on node only for a loopback host (localhost, 127.x, ::1): without ORIGIN the node server takes the client's Host header, which would let anyone send a victim a link to a foreign host. Other requests get "Passwort-Links per E-Mail sind hier noch nicht eingerichtet …" (503) before the address is looked up, so the answer reveals nothing about accounts; `server.js` warns at boot. Invitation mails keep `url.origin`, because only the signed-in owner sends them from their own browser.
- `?return=` of `/mieter/neu` is resolved like a browser resolves a link (`returnPath` in `src/lib/return-path.ts`) and refused when it leaves the app (`//`, `/\`, tabs and line breaks, other schemes).

### Subscription (Stripe test mode)

- Checkout carries the rest of the free trial as `subscription_data[trial_period_days]` (ceil of days left, ≥ 1); after the trial no trial parameter is sent, so the price's own settings apply.
- Canceled subscription shows "Dein Abo ist beendet. Du kannst nur noch lesen." (danger) with BILLING_REQUIRED, else info; expired trial likewise with the sentence from the task.
- Trial-end dates are shown as the calendar day in Europe/Berlin (`dayOf`).
- A `subscriptionStatus` of `trialing` (Stripe trial inside a subscription) counts as trialing but shows no trial notice and offers "Abo verwalten".
- Stripe statuses `incomplete` and `paused` keep the account's current status; the event is still recorded.
- Webhook idempotency: the event row is inserted in the same batch as the account update; an event for an unknown customer is recorded without any change and answered 200.
- Webhook ordering: `checkout.session.completed` and `customer.subscription.updated`/`deleted` only name the subscription; the app fetches it and applies Stripe's current status and period end, so a late or retried older event cannot bring back an old status. When Stripe does not answer the webhook fails (500) and Stripe delivers it again.
- Deleting the account cancels a subscription that still runs (`stripeSubscriptionId` set, status not `canceled`) with `DELETE /v1/subscriptions/:id`; a 404, or a subscription Stripe already reports as canceled, counts as done. Otherwise the deletion is refused (502) with "Stripe antwortet gerade nicht, darum ist dein Abo noch nicht gekündigt und dein Konto nicht gelöscht. …" and the account stays. The konto page says the subscription ends with the account.
- Read-only accounts (BILLING_REQUIRED) may still post `/einstellungen/konto?/delete` and `/einstellungen/profil?/profile` and `?/password`: leaving the service and securing the sign-in never depend on paying. Demo data and the sender block stay refused. The action name is read from the query as SvelteKit does (`actionName`).
- The price text is read from Stripe (`/v1/prices/:id`) once per /abo load and falls back to "monatlich" when Stripe does not answer.
- Stripe errors in the actions answer `fail(502)` with "Stripe antwortet gerade nicht. Bitte versuche es gleich noch einmal."
- Managers get on /abo: "Das Abo verwaltet der Vermieter des Kontos, nicht die Mitverwalter."; the actions require the owner (403 via requireOwner).
- Audit summaries: "Stripe-Kunde angelegt" (owner) and "Abo-Status von Stripe übernommen: <label> (bis <date>)" (userId null).

### Integration (dashboard, demo data)

- The dashboard has four tiles: Rückstände (sum and count, links to `/mietkonto?filter=rueckstaende`), Leerstand (units without an active lease, links to `/objekte`), offene Bankumsätze (links to `/bank`) and Fristen/Aufgaben (the number to do: overdue deadlines plus open tasks; the label names both and the deadlines of the next 12 months, links to `/aufgaben`). Up to five vacant units are listed below with a link into the lease form.
- The first-run checklist shows instead of the tiles until the account has a lease and a bank account: Objekt (`/objekte/neu`), Einheit (the first property's page, else `/objekte/neu`), Mieter (`/mieter/neu`), Mietvertrag (`/vertraege/neu`), Bankverbindung (`/bank/konten`), Kostenarten und Umlageschlüssel (`/betriebskosten/kostenarten`, ticked once the account has categories), each ticked when something exists. The link to the demo data shows only to the owner of an account without property (the only case the demo is offered); the CSV import is always linked.
- The settings hub leaves out the owner-only pages (Mitverwalter, Export) for managers.
- Demo data: two properties in Berlin and Potsdam, six units (one parking space), five tenants, four running leases (one indexed, one with the parking space as an extra unit) and one ended lease with its deposit returned, rent payments for the last 24 months (older leases get a ledger start there), one lease two months in arrears, a bank account with three open transactions this month, five cost items of last year and two tasks. Only offered to the owner of an account without any property; the account deletion is the way back. Written in one batch after the default categories and keys are seeded (idempotent), so a failure leaves the account empty; the last audit line ("Demodaten angelegt") is the guard against a double click: its summary is NULL unless the account then holds exactly the two demo properties, so a second concurrent run is rolled back and answered as "nur für ein leeres Konto".
- The billing banner above every page is `role="note"`, not a live status, so a page's own status messages stay the only `status` region.

## Known gaps per feature

### Properties and units

- No pagination on the property list; counts load all units/active leases of the account in 4 queries.
- The e2e test does not exercise a unit rented as an extra unit (covered in the unit spec only).

### Tenants, leases, deposit

- The lease edit e2e covers the due day, notes, deposit and the start-date refusal, not tenants or the notice fields; the "no tenants" and "no units" empty states of /vertraege/neu are not e2e-tested (the owner account already has data when the test runs).
- Landlord-notice end dates (6/9 months) are unit-tested; the e2e checks only that the form proposes 9 months for a nine-year lease.
- No deposit interest calculation; interest is entered as a movement.

### Rent changes, index and graduated rent

- The letter PDF's text is not extracted in the e2e test (status and content type only).
- No next-step/waiting-period deadlines are exported for the tasks feature; it can use `nextGraduatedStepAllowed`/`waitingPeriodEnd` from domain/index-rent.ts.

### Mietkonto pages

- A bank-sourced payment (Mietkonto) and deposit movement (Kaution) link to `/bank?umsatz=<id>`, which lists that one transaction whatever its status, so its assignment can be undone there (e2e: navigation.e2e.ts).
- The e2e test computes "four months ago" in Europe/Berlin like the server; a run in the last two hours UTC of a month end could see one month more or less of arrears.

### Bank import and matching

- The manager view of /bank/konten is not e2e-tested (manager project belongs to auth). The rule hit on import, the split, the deposit target and a double submit are e2e-tested; a real overlap of the two requests is not guaranteed there, the unit spec forces it.
- No pagination beyond the 200-row cap; no per-import listing page (bank_imports rows are written but not shown).
- The ING preset carries no counterpart IBAN (the export has none), so suggestions for ING rely on name/purpose.

### Documents

- No inline preview test for images (PDF only).
- Uploads are read fully into memory (`file.arrayBuffer()`) before `storeDocument`, as the server module's `bytes: Uint8Array` signature requires; fine at the 10 MB cap.
- The lease tab's `load` calls `loadDocumentLinkOptions` (five queries) for the link texts of property/unit/tenant/cost item; acceptable at D1's per-request limit but not minimal.

### Operating costs setup

- Meter editing (changing kind/unit/serial number) exists in the server module (`updateMeter`, tested) but has no page; the Zähler tab offers create, readings, "ausbauen" and delete.
- The e2e test does not exercise "Speichern und nächsten Beleg"; `updateMeter` has no page, so no e2e either.
- RouteId typings in the shared `node_modules/$app/types/index.d.ts` depend on whichever worktree synced last; nothing in this feature uses typed route ids.

### Operating cost statements

- Tested in unit tests but not in e2e: late approval with justification, late corrections and late deliveries (they need a fake today), delete draft, Pauschale exclusions. The reference scenario e2e covers consumption/mixed keys and the CO₂ lines of the PDF.
- A correction approved before the deadline that raises the Nachzahlung and reaches the tenant after it is not capped at the corrected version's amount (the reversal on delivery is all or nothing, one per posting).
- The e2e lease has ledgerStart null; prepayments in the test come from the rent history or charges depending on the ledger start rule of createLease (both give 2.400 €).
- svelte-check could only be run through a private tsconfig (see above), not through `npm run check`.

### CO₂ cost split

- The deadline appears in the list only; the tasks feature computes it for /aufgaben from `claimedOn` (not part of this feature).
- The e2e test does not open the Mietkonto tab (owned by ledger-ui); the credit posting is verified by the server spec.

### Tasks and deadlines

- Meter readings are loaded for the whole account (one fixed query), not narrowed to leases with an end date.
- The dashboard tiles themselves are the integration step's, not built here.
- The e2e does not exercise the "unknown property/lease" refusal of the link select (covered by the unit spec only).

### Data import (CSV)

- windows-1252 files and the `findHeaderRow` preamble handling are covered by unit tests only, not by the e2e fixtures (all UTF-8).
- Lease import does not support extra units, graduated/indexed rents, index base values or termination fields; rent due day is always 3.
- The e2e verifies results through the import page's summaries, duplicate detection and the imported lease's Mietkonto (ledger start, opening balance, payment, balance).
- The 404 check is for a path under /import (the feature has no id route).

### Accounts, managers, export, password reset

- The e2e for a reset link sent to a host from the request runs on node only; on Workers the host is the one Cloudflare routed.
- Lockout rows in login_attempts are never pruned.
- The password reset mail and invitation mail are plain text only.

### Subscription (Stripe test mode)

- No e2e of the Stripe-down (502) path of the /abo actions (the account deletion's is covered in konto.e2e.ts).
- `invoice.*` events are only recorded; past_due is derived from customer.subscription.updated.
- Real Stripe API not exercised; the fake answers a fixed subscription (sub_fake, active) and price (9,90 €).
