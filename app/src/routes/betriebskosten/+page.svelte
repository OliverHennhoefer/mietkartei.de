<script lang="ts">
	import { page } from '$app/state';
	import Field from '#lib/components/Field.svelte';
	import CreateButton from '#lib/components/CreateButton.svelte';
	import FormDialog from '#lib/components/FormDialog.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import Money from '#lib/components/Money.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import Alert from '#lib/components/Alert.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { statementStatusLabels } from '#lib/labels.ts';
	import { byDate, byNumber, bySeverity, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	// The "Abrechnungen" tab of /betriebskosten: the statements per property and the dialog for a
	// new draft. The heading and tab bar come from +layout.svelte.
	let { data, form }: PageProps = $props();

	// ?neu opens the create dialog; it stays open while the server refuses the input.
	const creating = $derived(page.url.searchParams.has('neu'));

	const errors = $derived(form?.errors);
	const values = $derived(form?.values);
	const withCostItems = $derived(data.properties.filter((property) => property.hasCostItems));
	type Statement = PageProps['data']['groups'][number]['statements'][number];
	// The last three years stay in view; older statements fold away under the table.
	const recentFrom = $derived(`${Number(data.defaults.periodEnd.slice(0, 4)) - 2}-01-01`);
	const recent = (statements: Statement[]) =>
		statements.filter((statement) => statement.periodEnd >= recentFrom);
	const older = (statements: Statement[]) =>
		statements.filter((statement) => statement.periodEnd < recentFrom);
	// The version matters only once a statement was corrected.
	const corrected = (statements: Statement[]) =>
		statements.some((statement) => statement.version > 1);
	const propertyName = (id: string) =>
		data.properties.find((property) => property.id === id)?.name ?? 'Objekt';

	// One order for the statements of all properties.
	const sort = new TableSort<PageProps['data']['groups'][number]['statements'][number]>({
		period: byDate((statement) => statement.periodStart),
		version: byNumber((statement) => statement.version),
		status: bySeverity((statement) =>
			statement.superseded ? 0 : statement.status === 'approved' ? 1 : 2
		),
		costs: byNumber((statement) => statement.costsTotal),
		allocable: byNumber((statement) => statement.allocableTotal),
		leases: byNumber((statement) => statement.leaseCount),
		nachzahlungen: byNumber((statement) => statement.nachzahlungen),
		guthaben: byNumber((statement) => statement.guthaben)
	});
</script>

<h2 class="visually-hidden">Abrechnungen</h2>
{#if data.groups.length === 0}
	<p class="muted">
		Noch keine Abrechnung. Lege unten einen Entwurf für ein Objekt und einen Zeitraum an.
	</p>
{/if}
{#if data.due.length > 0}
	<Alert tone={data.due.some((deadline) => deadline.overdue) ? 'danger' : 'warning'}>
		<ul class="due" aria-label="Fällige Abrechnungen">
			{#each data.due as deadline (`${deadline.propertyId} ${deadline.date}`)}
				<li>
					<strong>{deadline.title} · {propertyName(deadline.propertyId)}</strong>
					{deadline.overdue ? 'war fällig bis' : 'fällig bis'}
					{formatDate(deadline.date)}
					·
					<a href="?objekt={deadline.propertyId}&neu" data-sveltekit-reset="false"
						>Entwurf erstellen</a
					>
				</li>
			{/each}
		</ul>
	</Alert>
{/if}
{#each data.groups as group (group.property.id)}
	<h3><a href="/objekte/{group.property.id}">{group.property.name}</a></h3>
	{@render statements(group.property.name, recent(group.statements), corrected(group.statements))}
	{#if older(group.statements).length > 0}
		<details class="older">
			<summary>Ältere Abrechnungen ({older(group.statements).length})</summary>
			{@render statements(
				`${group.property.name}, ältere`,
				older(group.statements),
				corrected(group.statements)
			)}
		</details>
	{/if}
{/each}

{#snippet statements(name: string, rows: Statement[], withVersion: boolean)}
	<div class="table-wrap">
		<table class="table" aria-label="Abrechnungen {name}">
			<thead>
				<tr>
					<SortHeader {sort} key="period">Zeitraum</SortHeader>
					{#if withVersion}<SortHeader {sort} key="version">Version</SortHeader>{/if}
					<SortHeader {sort} key="status">Status</SortHeader>
					<SortHeader {sort} key="costs" class="num">Gesamtkosten</SortHeader>
					<SortHeader {sort} key="allocable" class="num">Umlagefähig</SortHeader>
					<SortHeader {sort} key="leases" class="num">Mietverträge</SortHeader>
					<SortHeader {sort} key="nachzahlungen" class="num">Nachzahlungen</SortHeader>
					<SortHeader {sort} key="guthaben" class="num">Guthaben</SortHeader>
				</tr>
			</thead>
			<tbody>
				{#each sort.rows(rows) as statement (statement.id)}
					<tr>
						<td>
							<a href="/betriebskosten/abrechnungen/{statement.id}">{statement.periodLabel}</a>
							<span class="muted small">
								({formatDate(statement.periodStart)} – {formatDate(statement.periodEnd)})
							</span>
						</td>
						{#if withVersion}<td>{statement.version}</td>{/if}
						<td>
							{#if statement.superseded}
								<Badge tone="neutral">Ersetzt</Badge>
							{:else if statement.status === 'approved'}
								<Badge tone="success">{statementStatusLabels.approved}</Badge>
							{:else}
								<Badge tone="warning">{statementStatusLabels.draft}</Badge>
							{/if}
						</td>
						<td class="num"><Money cents={statement.costsTotal} /></td>
						<td class="num"><Money cents={statement.allocableTotal} /></td>
						<td class="num">{statement.leaseCount}</td>
						<td class="num"><Money cents={statement.nachzahlungen} /></td>
						<td class="num"><Money cents={statement.guthaben} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

{#if creating}
	{#if withCostItems.length === 0}
		<FormDialog title="Neue Abrechnung" close="/betriebskosten">
			<p class="form-wide">
				Eine Abrechnung braucht Belege eines Objekts. Erfasse zuerst die Kosten des Jahres.
			</p>
			<p class="form-wide">
				<CreateButton href="/betriebskosten/belege/neu" label="Beleg erfassen" />
			</p>
		</FormDialog>
	{:else}
		<FormDialog
			title="Neue Abrechnung"
			action="?/create"
			submitLabel="Entwurf erstellen"
			close="/betriebskosten"
		>
			<Field label="Objekt" error={errors?.propertyId}>
				<select name="propertyId" aria-invalid={errors?.propertyId ? 'true' : undefined} required>
					{#each withCostItems as property (property.id)}
						<option
							value={property.id}
							selected={(values?.propertyId ?? data.defaults.propertyId) === property.id}
						>
							{property.name}
						</option>
					{/each}
				</select>
			</Field>
			<Field label="Zeitraum von" error={errors?.periodStart}>
				<input
					type="date"
					name="periodStart"
					defaultValue={values?.periodStart ?? data.defaults.periodStart}
					aria-invalid={errors?.periodStart ? 'true' : undefined}
					required
				/>
			</Field>
			<Field label="Zeitraum bis" error={errors?.periodEnd}>
				<input
					type="date"
					name="periodEnd"
					defaultValue={values?.periodEnd ?? data.defaults.periodEnd}
					aria-invalid={errors?.periodEnd ? 'true' : undefined}
					required
				/>
			</Field>
			<p class="muted small form-wide">
				Höchstens zwölf Monate; der Entwurf wird vor der Freigabe geprüft.
			</p>
		</FormDialog>
	{/if}
{/if}

<style>
	.due {
		margin: 0;
		padding-left: 1.1rem;
	}
	.older {
		margin: 0.75rem 0 1.5rem;
	}
	.older > summary {
		cursor: pointer;
	}
	.older .table-wrap {
		margin-top: 0.75rem;
	}
</style>
