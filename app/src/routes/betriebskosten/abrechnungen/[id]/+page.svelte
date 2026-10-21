<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate, formatDateTime, formatMonth } from '#lib/dates.ts';
	import {
		balanceLabel,
		suggestedPrepayments,
		type LeaseStatement
	} from '#lib/domain/statement.ts';
	import { formatArea, personName, pluralize } from '#lib/format.ts';
	import { allocationKeyKindLabels, statementStatusLabels } from '#lib/labels.ts';
	import { formatCents } from '#lib/money.ts';
	import type { PageProps } from './$types';

	// One statement: a draft (recomputed on every load, warnings as links to the fix, approval)
	// or an approved one (frozen results, PDF per lease, delivery dates, correction).
	let { data, form }: PageProps = $props();

	const view = $derived(data.view);
	const statement = $derived(view.statement);
	const result = $derived(view.result);
	const property = $derived(result.property);
	const draft = $derived(statement.status === 'draft');
	const message = $derived(form && 'message' in form ? form.message : undefined);
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);

	const leaseResult = (leaseId: string) => view.leaseResults.find((row) => row.leaseId === leaseId);
	const unitNames = (lease: LeaseStatement) => lease.units.map((unit) => unit.name).join(' + ');
	const tenantNames = (lease: LeaseStatement) => lease.tenants.map(personName).join(', ');
	const leaseArea = (lease: LeaseStatement) =>
		lease.units.reduce((sum, unit) => sum + (unit.floorArea ?? 0), 0);
	/** § 560 Abs. 4 BGB: a twelfth of the year's costs, operating and heating cost apart. */
	const prepaymentHref = (lease: LeaseStatement) => {
		const { operating, heating } = suggestedPrepayments(lease);
		const query = [
			operating !== null ? `prepayment=${operating}` : null,
			heating !== null ? `heating=${heating}` : null
		].filter(Boolean);
		return query.length > 0 ? `/vertraege/${lease.leaseId}/miethoehe?${query.join('&')}` : null;
	};
	const reversedOnDelivery = $derived(
		form && 'reversed' in form && typeof form.reversed === 'number' ? form.reversed : 0
	);

	const approvalMessage = $derived(
		`Abrechnung ${view.periodLabel} für ${pluralize(property.leaseCount, 'Mietvertrag', 'Mietverträge')} freigeben? ` +
			`Nachzahlungen ${formatCents(property.nachzahlungen)}, Guthaben ${formatCents(property.guthaben)}. ` +
			'Die Ergebnisse werden eingefroren und auf den Mietkonten gebucht.'
	);
	const approveLabel = $derived(
		`Freigeben: ${pluralize(property.leaseCount, 'Mietvertrag', 'Mietverträge')}, Nachzahlungen ${formatCents(property.nachzahlungen)}, Guthaben ${formatCents(property.guthaben)}`
	);
</script>

<div class="toolbar row between">
	<a href="/betriebskosten">← Alle Abrechnungen</a>
	<span class="row">
		{#if view.superseded}
			<Badge tone="neutral">Ersetzt</Badge>
		{:else if draft}
			<Badge tone="warning">{statementStatusLabels.draft}</Badge>
		{:else}
			<Badge tone="success">{statementStatusLabels.approved}</Badge>
		{/if}
		<span class="muted">Version {statement.version}</span>
	</span>
</div>

<h2>Abrechnung {view.periodLabel} · {view.property.name}</h2>
<p class="muted">
	{formatDate(statement.periodStart)} – {formatDate(statement.periodEnd)}
	({property.period.days} Tage)
	{#if statement.approvedAt}
		· freigegeben am {property.approvedOn
			? formatDate(property.approvedOn)
			: formatDateTime(statement.approvedAt)}
	{/if}
	{#if view.corrects}
		· korrigiert <a href="/betriebskosten/abrechnungen/{view.corrects.id}"
			>Version {view.corrects.version}</a
		>
	{/if}
	{#if view.correctedBy}
		· {view.correctedBy.status === 'approved' ? 'ersetzt durch' : 'Korrekturentwurf:'}
		<a href="/betriebskosten/abrechnungen/{view.correctedBy.id}"
			>Version {view.correctedBy.version}</a
		>
	{/if}
</p>

{#if message}
	<Alert tone="danger"><p>{message}</p></Alert>
{/if}
{#if reversedOnDelivery > 0}
	<Alert tone="warning">
		<p>
			Die Abrechnung hat den Mieter erst nach Ablauf der Abrechnungsfrist erreicht; die Nachzahlung
			ist in Höhe von {formatCents(reversedOnDelivery)} ausgeschlossen (§ 556 Abs. 3 BGB) und wurde auf
			dem Mietkonto storniert.
		</p>
	</Alert>
{/if}
{#if form && 'approved' in form}
	<Alert tone="success"><p>Die Abrechnung ist freigegeben und auf den Mietkonten gebucht.</p></Alert
	>
{/if}

{#if property.warnings.length > 0}
	<Alert tone="warning">
		<p><strong>Hinweise</strong></p>
		<ul class="warnings">
			{#each property.warnings as warning (warning.code + (warning.unitId ?? '') + (warning.leaseId ?? '') + (warning.meterId ?? '') + (warning.itemId ?? ''))}
				<li>
					{#if warning.blocking}<Badge tone="danger">blockiert die Freigabe</Badge>{/if}
					{#if warning.href}
						<a href={warning.href}>{warning.message}</a>
					{:else}
						{warning.message}
					{/if}
				</li>
			{/each}
		</ul>
	</Alert>
{/if}

<div class="stats">
	<div class="stat card">
		<span class="value"><Money cents={property.costsTotal} /></span>
		<span class="label">Gesamtkosten</span>
	</div>
	<div class="stat card">
		<span class="value"><Money cents={property.allocableTotal} /></span>
		<span class="label">Umlagefähig</span>
	</div>
	<div class="stat card">
		<span class="value"><Money cents={property.nonAllocableTotal} /></span>
		<span class="label">Nicht umlagefähig</span>
	</div>
	<div class="stat card">
		<span class="value"><Money cents={property.vacancyShare} /></span>
		<span class="label">Leerstand (Vermieter)</span>
	</div>
	{#if property.excludedTotal > 0}
		<div class="stat card">
			<span class="value"><Money cents={property.excludedTotal} /></span>
			<span class="label">Pauschalen (Vermieter)</span>
		</div>
	{/if}
	<div class="stat card">
		<span class="value"><Money cents={property.nachzahlungen} /></span>
		<span class="label">Nachzahlungen</span>
	</div>
	<div class="stat card">
		<span class="value"><Money cents={property.guthaben} /></span>
		<span class="label">Guthaben</span>
	</div>
</div>

<h3>Belege im Zeitraum</h3>
<div class="table-wrap">
	<table class="table" aria-label="Belege">
		<thead>
			<tr>
				<th>Beleg</th>
				<th>Kostenart</th>
				<th>Umlageschlüssel</th>
				<th class="num">Kosten im Zeitraum</th>
				<th class="num">Umgelegt</th>
			</tr>
		</thead>
		<tbody>
			{#each property.items as item (item.itemId)}
				<tr>
					<td><a href="/betriebskosten/belege/{item.itemId}">{item.description}</a></td>
					<td>{item.categoryName}</td>
					<td>
						{#if item.allocable}
							{item.keyName}
							<span class="muted small">({allocationKeyKindLabels[item.keyKind]})</span>
						{:else}
							<span class="muted">nicht umlagefähig</span>
						{/if}
					</td>
					<td class="num"><Money cents={item.total} /></td>
					<td class="num">
						{#if item.allocable}<Money cents={item.allocated} />{:else}–{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#each result.leases as lease (lease.leaseId)}
	{@const frozen = leaseResult(lease.leaseId)}
	<section class="lease card" aria-label="Mietvertrag {unitNames(lease)}">
		<h3>
			<a href="/vertraege/{lease.leaseId}">{unitNames(lease)}</a>
			{#if lease.tenants.length > 0}<span class="muted">· {tenantNames(lease)}</span>{/if}
		</h3>
		<dl class="details">
			<dt>Einheit{lease.units.length > 1 ? 'en' : ''}</dt>
			<dd>{unitNames(lease)}, {formatArea(leaseArea(lease))}</dd>
			<dt>Nutzung</dt>
			<dd>
				{formatDate(lease.occupancy.start)} – {formatDate(lease.occupancy.end)}
				({lease.occupancy.days} von {lease.period.days} Tagen)
			</dd>
			<dt>Personen</dt>
			<dd>
				{#each lease.persons as entry, index (entry.from)}
					{index > 0 ? ', ' : ''}{pluralize(entry.persons, 'Person', 'Personen')}
					{#if lease.persons.length > 1}
						({formatDate(entry.from)} – {formatDate(entry.to)})
					{/if}
				{/each}
			</dd>
		</dl>

		<div class="table-wrap">
			<table class="table" aria-label="Kosten {unitNames(lease)}">
				<thead>
					<tr>
						<th>Kostenart</th>
						<th class="num">Gesamtkosten</th>
						<th>Umlageschlüssel</th>
						<th class="num">Anteil</th>
					</tr>
				</thead>
				<tbody>
					{#each lease.lines as line (line.itemId)}
						<tr>
							<td>
								{line.categoryName}
								<span class="muted small">{line.description}</span>
							</td>
							<td class="num">
								<Money cents={line.itemTotal} />
							</td>
							<td>
								{line.keyName}: {line.keyTotal}
								<br /><span class="muted small">{line.share}</span>
							</td>
							<td class="num"><Money cents={line.amount} /></td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<td colspan="3">Kosten gesamt</td>
						<td class="num"><Money cents={lease.costsTotal} /></td>
					</tr>
				</tfoot>
			</table>
		</div>

		<details class="prepayments">
			<summary>
				Geleistete Vorauszahlungen <Money cents={lease.prepaymentsTotal} />
				<span class="muted small">({pluralize(lease.prepayments.length, 'Monat', 'Monate')})</span>
			</summary>
			<div class="table-wrap">
				<table class="table" aria-label="Vorauszahlungen {unitNames(lease)}">
					<thead>
						<tr>
							<th>Monat</th>
							<th class="num">Soll</th>
							<th class="num">Betriebskosten</th>
							<th class="num">Heizkosten</th>
							<th class="num">Geleistet</th>
							<th>Quelle</th>
						</tr>
					</thead>
					<tbody>
						{#each lease.prepayments as month (month.period)}
							<tr>
								<td>{formatMonth(month.period)}</td>
								<td class="num"><Money cents={month.charged} /></td>
								<td class="num"><Money cents={month.operatingCostPrepayment} /></td>
								<td class="num"><Money cents={month.heatingCostPrepayment} /></td>
								<td class="num"><Money cents={month.amount} /></td>
								<td class="muted small">
									{month.source === 'ledger' ? 'Mietkonto' : 'Miethistorie'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>

		<p class="balance">
			<strong>{balanceLabel(lease.balance)}</strong>
			{#if lease.balance !== 0}
				<strong><Money cents={Math.abs(lease.balance)} /></strong>
			{/if}
			<span class="muted small">
				(Kosten <Money cents={lease.costsTotal} /> − geleistete Vorauszahlungen <Money
					cents={lease.prepaymentsTotal}
				/>)
			</span>
			{#if lease.unpaidPrepayments > 0}
				<br /><span class="muted small">
					Darin <Money cents={lease.unpaidPrepayments} /> nicht geleistete Vorauszahlungen; sie stehen
					schon als Soll auf dem Mietkonto, gebucht wird nur der Rest.
				</span>
			{/if}
			{#if lease.posted === 0 && lease.balance > 0}
				<br /><span class="muted small">
					Nicht verlangt: Die Abrechnungsfrist war abgelaufen (§ 556 Abs. 3 BGB).
				</span>
			{:else if lease.posted !== null && lease.posted !== lease.balance}
				<br /><span class="muted small">
					Verlangt: <Money cents={lease.posted} />; nach Ablauf der Abrechnungsfrist (§ 556 Abs. 3
					BGB) bleibt es beim rechtzeitig abgerechneten Ergebnis und den nicht geleisteten
					Vorauszahlungen.
				</span>
			{/if}
			{#if frozen && frozen.reversedOnDelivery > 0}
				<br /><span class="muted small">
					Storniert: <Money cents={frozen.reversedOnDelivery} />, die Abrechnung hat den Mieter erst
					nach dem {formatDate(lease.deadline)} erreicht (§ 556 Abs. 3 BGB).
				</span>
			{/if}
		</p>

		{#if lease.excluded.length > 0}
			<p class="muted small">
				Nicht abgerechnet ({lease.excluded[0].reason}):
				{#each lease.excluded as line, index (line.itemId)}
					{index > 0 ? ', ' : ''}{line.categoryName} <Money cents={line.amount} />
				{/each}
			</p>
		{/if}

		{#if !draft && frozen}
			{@const adjustHref = frozen.active && !view.superseded ? prepaymentHref(lease) : null}
			<div class="row between lease-actions">
				<span class="row">
					<a
						class="button secondary small"
						href="/betriebskosten/abrechnungen/{statement.id}/pdf/{lease.leaseId}"
					>
						PDF
					</a>
					{#if adjustHref}
						<a class="button secondary small" href={adjustHref}>Vorauszahlung anpassen</a>
					{/if}
					{#if frozen.dueDate}
						<span class="muted small">fällig am {formatDate(frozen.dueDate)}</span>
					{:else if (lease.posted ?? lease.balance) > 0}
						<span class="muted small">fällig 30 Tage nach Zustellung</span>
					{/if}
				</span>
				<form method="POST" action="?/deliver" class="row deliver" use:enhance>
					<input type="hidden" name="leaseId" value={lease.leaseId} />
					<label class="inline">
						zugestellt am
						<input
							type="date"
							name="deliveredOn"
							defaultValue={frozen.deliveredOn ?? data.today}
							aria-label="zugestellt am {unitNames(lease)}"
							required
						/>
					</label>
					<button type="submit" class="secondary small">Speichern</button>
					{#if frozen.deliveredOn && frozen.objectionDeadline}
						<span class="muted small">
							Einwendungsfrist bis {formatDate(frozen.objectionDeadline)}
						</span>
					{/if}
				</form>
			</div>
		{/if}
	</section>
{/each}

{#if result.leases.length === 0}
	<p class="muted">Im Zeitraum gab es keinen Mietvertrag mit Vorauszahlungen.</p>
{/if}

{#if draft}
	<h3>Freigabe</h3>
	{#if view.blocking.length > 0}
		<p>
			Die Abrechnung kann noch nicht freigegeben werden: {view.blocking[0].message}
		</p>
	{:else}
		<ConfirmButton action="?/approve" label={approveLabel} message={approvalMessage} tone="primary">
			{#if property.late}
				<div class="late card">
					<p>
						Die Abrechnungsfrist ist am {formatDate(property.deadline)} abgelaufen (§ 556 Abs. 3 BGB).
						Nachzahlungen von Wohnraummietern werden nur gebucht, wenn du die Verspätung nicht zu vertreten
						hast.
					</p>
					<label class="inline">
						<input type="checkbox" name="lateApprovalJustified" />
						Verspätung nicht zu vertreten
					</label>
					<label>
						Begründung
						<textarea name="note" aria-invalid={errors?.note ? 'true' : undefined}></textarea>
						{#if errors?.note}<span class="error">{errors.note}</span>{/if}
					</label>
				</div>
			{/if}
		</ConfirmButton>
	{/if}
	<p class="small muted">
		Die Freigabe friert die Ergebnisse ein und bucht je Mietvertrag eine Sollstellung. Nachzahlungen
		sind 30 Tage nach Zugang beim Mieter fällig, sobald du das Zustelldatum einträgst; Guthaben 30
		Tage nach der Freigabe.
	</p>
	<ConfirmButton
		action="?/delete"
		label="Entwurf löschen"
		message="Diesen Entwurf löschen? Belege und Zählerstände bleiben erhalten."
	/>
{:else if !view.correctedBy}
	<h3>Korrektur</h3>
	<p class="small muted">
		Eine Korrektur erstellt einen neuen Entwurf mit den aktuellen Belegen und Zählerständen; ihre
		Freigabe storniert die Buchungen dieser Version.
	</p>
	<form method="POST" action="?/correct" use:enhance>
		<button type="submit" class="secondary">Korrektur erstellen</button>
	</form>
{/if}

<style>
	.toolbar {
		margin-bottom: 1rem;
	}
	.warnings {
		margin: 0.25rem 0 0;
		padding-left: 1.25rem;
	}
	.warnings li {
		margin: 0.25rem 0;
	}
	.lease {
		margin: 1.5rem 0;
		display: grid;
		gap: 0.75rem;
	}
	.lease h3 {
		margin: 0;
	}
	dl.details {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
		margin: 0;
		font-size: 0.95rem;
	}
	dl.details dt {
		color: var(--color-muted);
	}
	dl.details dd {
		margin: 0;
	}
	.prepayments summary {
		cursor: pointer;
	}
	.prepayments .table-wrap {
		margin-top: 0.5rem;
	}
	.balance {
		margin: 0;
		font-size: 1.1rem;
	}
	.lease-actions {
		border-top: 1px solid var(--color-border);
		padding-top: 0.75rem;
	}
	.deliver label {
		font-weight: 400;
	}
	.deliver input {
		width: auto;
	}
	.late {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		max-width: 36rem;
	}
	.late p {
		margin: 0;
	}
</style>
