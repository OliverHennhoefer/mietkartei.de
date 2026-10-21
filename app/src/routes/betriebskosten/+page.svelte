<script lang="ts">
	import { enhance } from '$app/forms';
	import Badge from '#lib/components/Badge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { statementStatusLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	// The "Abrechnungen" tab of /betriebskosten: the statements per property and the form for a
	// new draft. The heading and tab bar come from +layout.svelte.
	let { data, form }: PageProps = $props();

	const errors = $derived(form?.errors);
	const values = $derived(form?.values);
	const withCostItems = $derived(data.properties.filter((property) => property.hasCostItems));
</script>

<div class="toolbar">
	<a class="button" href="#neue-abrechnung">Neue Abrechnung</a>
</div>

<h2>Abrechnungen</h2>
{#if data.groups.length === 0}
	<p class="muted">
		Noch keine Abrechnung. Lege unten einen Entwurf für ein Objekt und einen Zeitraum an.
	</p>
{/if}
{#each data.groups as group (group.property.id)}
	<h3><a href="/objekte/{group.property.id}">{group.property.name}</a></h3>
	<div class="table-wrap">
		<table class="table" aria-label="Abrechnungen {group.property.name}">
			<thead>
				<tr>
					<th>Zeitraum</th>
					<th>Version</th>
					<th>Status</th>
					<th class="num">Gesamtkosten</th>
					<th class="num">Umlagefähig</th>
					<th class="num">Mietverträge</th>
					<th class="num">Nachzahlungen</th>
					<th class="num">Guthaben</th>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each group.statements as statement (statement.id)}
					<tr>
						<td>
							{statement.periodLabel}
							<span class="muted small">
								({formatDate(statement.periodStart)} – {formatDate(statement.periodEnd)})
							</span>
						</td>
						<td>{statement.version}</td>
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
						<td class="actions">
							<a href="/betriebskosten/abrechnungen/{statement.id}">Öffnen</a>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/each}

<h2 id="neue-abrechnung">Neue Abrechnung</h2>
{#if withCostItems.length === 0}
	<EmptyState
		title="Noch keine Belege"
		text="Eine Abrechnung braucht Belege eines Objekts. Erfasse zuerst die Kosten des Jahres."
	>
		<a class="button" href="/betriebskosten/belege/neu">Beleg erfassen</a>
	</EmptyState>
{:else}
	<form method="POST" action="?/create" class="card" use:enhance>
		<label>
			Objekt
			<select name="propertyId" aria-invalid={errors?.propertyId ? 'true' : undefined} required>
				{#each withCostItems as property (property.id)}
					<option value={property.id} selected={values?.propertyId === property.id}>
						{property.name}
					</option>
				{/each}
			</select>
			{#if errors?.propertyId}<span class="error">{errors.propertyId}</span>{/if}
		</label>
		<label>
			Zeitraum von
			<input
				type="date"
				name="periodStart"
				defaultValue={values?.periodStart ?? data.defaults.periodStart}
				aria-invalid={errors?.periodStart ? 'true' : undefined}
				required
			/>
			{#if errors?.periodStart}<span class="error">{errors.periodStart}</span>{/if}
		</label>
		<label>
			Zeitraum bis
			<input
				type="date"
				name="periodEnd"
				defaultValue={values?.periodEnd ?? data.defaults.periodEnd}
				aria-invalid={errors?.periodEnd ? 'true' : undefined}
				required
			/>
			{#if errors?.periodEnd}<span class="error">{errors.periodEnd}</span>{/if}
		</label>
		<div class="form-actions">
			<button type="submit">Entwurf erstellen</button>
			<span class="muted small"
				>Höchstens zwölf Monate; der Entwurf wird vor der Freigabe geprüft.</span
			>
		</div>
	</form>
{/if}
