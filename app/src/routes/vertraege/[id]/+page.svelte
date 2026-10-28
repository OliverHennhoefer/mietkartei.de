<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import Alert from '#lib/components/Alert.svelte';
	import LeaseStatus from '#lib/components/LeaseStatus.svelte';
	import Balance from '#lib/components/Balance.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import DeleteSection from '#lib/components/DeleteSection.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { formatDate, formatMonth, isIsoDate } from '#lib/dates.ts';
	import { formatIndexValue } from '#lib/domain/index-rent.ts';
	import { proposedEndDate } from '#lib/domain/lease-end.ts';
	import { personName } from '#lib/format.ts';
	import {
		heatingCostModelLabels,
		leaseKindLabels,
		operatingCostModelLabels,
		rentModelLabels,
		terminatedByLabels
	} from '#lib/labels.ts';
	import { byDate, byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const lease = $derived(data.lease);
	const personsForm = $derived(form?.which === 'persons' && form.errors ? form : undefined);
	const endForm = $derived(form?.which === 'end' && form.errors ? form : undefined);
	const editPersonsForm = $derived(form?.which === 'editPersons' && form.errors ? form : undefined);
	// After a refused save the typed values win; otherwise the dialog shows the row as stored.
	const editValues = $derived(
		editPersonsForm?.values ??
			(data.editing && {
				validFrom: data.editing.validFrom,
				persons: String(data.editing.persons),
				note: data.editing.note ?? ''
			})
	);
	const endValues = $derived(endForm?.values ?? data.endProposal);
	const personSort = new TableSort<PageProps['data']['persons'][number]>({
		from: byDate((row) => row.validFrom),
		persons: byNumber((row) => row.persons),
		note: byText((row) => row.note)
	});
	const parties = Object.entries(terminatedByLabels) as [keyof typeof terminatedByLabels, string][];

	// "Vertrag beenden": the end date follows the receipt date and the party (§ 573c / § 580a
	// BGB) until it is typed over; changing either input proposes it again. The action checks it.
	// A value typed before hydration reaches the bound state, so the proposal follows it too.
	let endAt = $state(untrack(() => endValues.terminatedAt ?? ''));
	let endBy = $state(untrack(() => endValues.terminatedBy ?? 'tenant'));
	let endTyped = $state<string | undefined>(untrack(() => endForm?.values.endDate));
	const earliestEnd = $derived(
		isIsoDate(endAt) && (endBy === 'tenant' || endBy === 'landlord')
			? proposedEndDate({
					kind: lease.kind,
					startDate: lease.startDate,
					terminatedAt: endAt,
					terminatedBy: endBy,
					state: lease.property.state
				})
			: undefined
	);
	const endOn = $derived(endTyped ?? earliestEnd ?? endValues.endDate ?? '');
	function proposeEnd() {
		endTyped = undefined;
	}
	const law = $derived(lease.kind === 'commercial' ? '§ 580a Abs. 2 BGB' : '§ 573c BGB');
</script>

<!-- The heading, tenants and tab bar come from +layout.svelte; this page is the "Übersicht" tab. -->
<div class="toolbar">
	<a href="/vertraege/{lease.id}/bearbeiten" class="button">Bearbeiten</a>
	<LeaseStatus status={lease.active ? 'active' : lease.upcoming ? 'upcoming' : 'ended'} />
</div>

{#if form?.message}
	<Alert tone="danger"><p>{form.message}</p></Alert>
{/if}

<h2>Vertrag</h2>
<dl class="details">
	<dt>Einheiten</dt>
	<dd>
		<a href="/objekte/{lease.property.id}/einheiten/{lease.unit.id}">{lease.unit.name}</a> ·
		<a href="/objekte/{lease.property.id}">{lease.property.name}</a>
		{#each lease.extraUnits as unit (unit.id)}
			, <a href="/objekte/{unit.propertyId}/einheiten/{unit.id}">{unit.name}</a>
		{/each}
	</dd>
	<dt>Mieter</dt>
	<dd>
		{#each lease.tenants as tenant, index (tenant.id)}
			{#if index > 0},
			{/if}<a href="/mieter/{tenant.id}">{personName(tenant)}</a>
		{:else}
			–
		{/each}
	</dd>
	<dt>Laufzeit</dt>
	<dd>
		seit {formatDate(lease.startDate)}{#if lease.endDate}
			bis {formatDate(lease.endDate)}{:else}, unbefristet{/if}
	</dd>
	<dt>Art</dt>
	<dd>{leaseKindLabels[lease.kind]}</dd>
	<dt>Mietmodell</dt>
	<dd>{rentModelLabels[lease.rentModel]}</dd>
	<dt>Betriebskosten</dt>
	<dd>{operatingCostModelLabels[lease.operatingCostModel]}</dd>
	<dt>Heizkosten</dt>
	<dd>{heatingCostModelLabels[lease.heatingCostModel]}</dd>
	<dt>Fälligkeit</dt>
	<dd>am {lease.rentDueDay}. Werktag des Monats</dd>
	<dt>Mietkonto führen ab</dt>
	<dd>{formatDate(lease.ledgerStart ?? lease.startDate)}</dd>
	{#if lease.rentModel === 'indexed' && lease.indexBaseMonth}
		<dt>Indexbasis</dt>
		<dd>
			{formatMonth(lease.indexBaseMonth)}{#if lease.indexBaseValue !== null}: {formatIndexValue(
					lease.indexBaseValue
				)} (Basisjahr {lease.indexBaseYear}){/if}
		</dd>
	{/if}
	{#if lease.notes}
		<dt>Notizen</dt>
		<dd class="notes">{lease.notes}</dd>
	{/if}
</dl>

<h2>Aktuelle Miete</h2>
<dl class="details" aria-label="Aktuelle Miete">
	<dt>Kaltmiete</dt>
	<dd><Money cents={data.currentRent.baseRent} /></dd>
	<dt>Betriebskostenvorauszahlung</dt>
	<dd><Money cents={data.currentRent.operatingCostPrepayment} /></dd>
	<dt>Heizkostenvorauszahlung</dt>
	<dd><Money cents={data.currentRent.heatingCostPrepayment} /></dd>
	<dt>Gesamtmiete</dt>
	<dd><strong><Money cents={data.currentRent.total} /></strong></dd>
</dl>
<p><a href="/vertraege/{lease.id}/miethoehe">Miethöhe und Änderungen</a></p>

<h2>Saldo</h2>
<p aria-label="Saldo">
	<strong><Balance cents={data.balance} label /></strong>
	· <a href="/vertraege/{lease.id}/mietkonto">Mietkonto</a>
</p>

<h2>Kaution</h2>
<p aria-label="Kaution">
	Vereinbart <strong><Money cents={lease.securityDeposit} /></strong>, erhalten
	<strong><Money cents={data.deposit.received} /></strong>{#if data.deposit.outstanding > 0}, offen <Money
			cents={data.deposit.outstanding}
		/>{/if}
	· <a href="/vertraege/{lease.id}/kaution">Kaution</a>
</p>

<!-- The head count only feeds cost allocation by persons; a parking space has none. -->
{#if lease.kind !== 'parking'}
	<h2>Personen</h2>
	<div class="table-wrap">
		<table class="table" aria-label="Personenstand">
			<thead>
				<tr>
					<SortHeader sort={personSort} key="from">Ab</SortHeader>
					<SortHeader sort={personSort} key="persons" class="num">Personen</SortHeader>
					<SortHeader sort={personSort} key="note">Notiz</SortHeader>
				</tr>
			</thead>
			<tbody>
				{#each personSort.rows(data.persons) as row (row.id)}
					<tr>
						<td>
							<!-- Only later rows open in the dialog: the first one belongs to the lease. -->
							{#if row.id !== data.persons[0].id}
								<a href="?bearbeiten={row.id}" data-sveltekit-reset="false"
									>{formatDate(row.validFrom)}</a
								>
							{:else}
								{formatDate(row.validFrom)}
							{/if}
						</td>
						<td class="num">{row.persons}</td>
						<td>{row.note ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<form method="POST" action="?/addPersons" class="card form" use:enhance>
		{@render personsFields(personsForm?.values ?? {}, personsForm?.errors ?? {})}
		<div class="form-actions">
			<button type="submit">Personenstand eintragen</button>
		</div>
	</form>
{/if}

<h2>Vertragsende</h2>
{#if lease.terminatedAt && lease.terminatedBy}
	<dl class="details" aria-label="Kündigung">
		<dt>Kündigung erhalten am</dt>
		<dd>{formatDate(lease.terminatedAt)} {terminatedByLabels[lease.terminatedBy]}</dd>
		<dt>Vertragsende</dt>
		<dd>{lease.endDate ? formatDate(lease.endDate) : '–'}</dd>
	</dl>
{:else if lease.endDate}
	<p>Der Vertrag endet am {formatDate(lease.endDate)}.</p>
{/if}
{#if data.deadlines}
	<ul class="deadlines" aria-label="Fristen">
		<li>Zählerstände ablesen am {formatDate(data.deadlines.readMeters)}</li>
		<li>Kaution abrechnen bis {formatDate(data.deadlines.settleDeposit)}</li>
		<li>Betriebskostenabrechnung bis {formatDate(data.deadlines.operatingCostStatement)}</li>
	</ul>
{/if}
{#if !lease.terminatedAt}
	<ConfirmButton
		action="?/end"
		label="Vertrag beenden"
		message="Den Vertrag wirklich zu diesem Datum beenden? Die Sollstellungen nach dem Vertragsende entfallen."
		tone="primary"
		card
	>
		<p class="form-wide muted small end-note">
			{#if lease.kind === 'commercial'}
				Das Vertragsende folgt § 580a Abs. 2 BGB: Eine Kündigung, die bis zum dritten Werktag eines
				Quartals eingeht, beendet den Vertrag zum Ende des nächsten Quartals.
			{:else}
				Das Vertragsende folgt § 573c BGB: Eine Kündigung, die bis zum dritten Werktag eines Monats
				eingeht (der Samstag zählt mit, bundesweite Feiertage nicht), beendet den Vertrag zum Ende
				des übernächsten Monats. Bei einer Kündigung durch den Vermieter verlängert sich die Frist
				nach fünf und acht Jahren Mietdauer um drei und sechs Monate.
			{/if}
			Das Datum passt sich an, wenn du Eingang oder Partei änderst.
		</p>
		<Field label="Kündigung erhalten am" error={endForm?.errors.terminatedAt}>
			<input
				name="terminatedAt"
				type="date"
				bind:value={endAt}
				oninput={proposeEnd}
				aria-invalid={endForm?.errors.terminatedAt ? 'true' : undefined}
				required
			/>
		</Field>
		<Field label="Gekündigt" error={endForm?.errors.terminatedBy}>
			<select
				name="terminatedBy"
				bind:value={endBy}
				onchange={proposeEnd}
				aria-invalid={endForm?.errors.terminatedBy ? 'true' : undefined}
			>
				{#each parties as [party, label] (party)}
					<option value={party}>{label}</option>
				{/each}
			</select>
		</Field>
		<Field
			label="Vertragsende"
			error={endForm?.errors.endDate}
			note={earliestEnd ? `Nach ${law} frühestens am ${formatDate(earliestEnd)}.` : undefined}
		>
			<input
				name="endDate"
				type="date"
				value={endOn}
				oninput={(event) => (endTyped = event.currentTarget.value)}
				aria-invalid={endForm?.errors.endDate ? 'true' : undefined}
				required
			/>
		</Field>
		<label class="inline form-wide">
			<input
				type="checkbox"
				name="earlyEndAgreed"
				defaultChecked={endForm?.values.earlyEndAgreed === 'on'}
			/>
			Früheres Ende vereinbart (Aufhebungsvertrag)
		</label>
	</ConfirmButton>
{/if}

<DeleteSection
	heading="Löschen"
	label="Mietvertrag löschen"
	question="Mietvertrag {lease.unit.name} · {lease.property.name} löschen?"
	check={data.deletion}
	error={form && 'deleteError' in form ? form.deleteError : undefined}
/>

{#snippet personsFields(values: Record<string, string>, errors: Partial<Record<string, string>>)}
	<Field label="Personen ab Datum" error={errors.validFrom}>
		<input
			name="validFrom"
			type="date"
			defaultValue={values.validFrom ?? ''}
			aria-invalid={errors.validFrom ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Personen" error={errors.persons}>
		<input
			name="persons"
			type="number"
			min="0"
			max="20"
			defaultValue={values.persons ?? ''}
			aria-invalid={errors.persons ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Notiz (optional)" error={errors.note}>
		<input name="note" defaultValue={values.note ?? ''} />
	</Field>
{/snippet}

{#if data.editing && editValues}
	{#key data.editing.id}
		<EditDialog
			title="Personenstand bearbeiten"
			action="?/updatePersons"
			deleteAction="?/deletePersons"
			deleteMessage="Personenstand ab {formatDate(data.editing.validFrom)} wirklich entfernen?"
			close="/vertraege/{lease.id}"
			error={form && 'message' in form ? form.message : undefined}
		>
			<input type="hidden" name="rowId" value={data.editing.id} />
			{@render personsFields(editValues, editPersonsForm?.errors ?? {})}
		</EditDialog>
	{/key}
{/if}

<style>
	.notes {
		white-space: pre-line;
	}
	.deadlines {
		margin: 0 0 1rem;
		padding-left: 1.25rem;
	}
	.end-note {
		margin: 0;
	}
</style>
