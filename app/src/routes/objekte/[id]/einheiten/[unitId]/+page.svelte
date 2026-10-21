<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { formatArea, formatNumber, personName } from '#lib/format.ts';
	import { unitKindLabels } from '#lib/units.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const vacant = $derived(!data.leases.some((lease) => lease.active));
	const base = $derived(`/objekte/${data.property.id}/einheiten/${data.unit.id}`);
</script>

<!-- The heading and address come from +layout.svelte. -->
<div class="toolbar">
	<a class="button secondary" href="{base}/bearbeiten">Bearbeiten</a>
	<a href="/objekte/{data.property.id}">Alle Einheiten</a>
	{#if vacant}
		<a href="/vertraege/neu?unitId={data.unit.id}">Mietvertrag anlegen</a>
	{/if}
</div>

<h2>Einheit {data.unit.name}</h2>
<div class="card">
	<dl class="details">
		<dt>Art</dt>
		<dd>{unitKindLabels[data.unit.kind]}</dd>
		<dt>Fläche</dt>
		<dd>{data.unit.floorArea === null ? '–' : formatArea(data.unit.floorArea)}</dd>
		<dt>Etage</dt>
		<dd>{data.unit.floor ?? '–'}</dd>
		<dt>Zimmer</dt>
		<dd>{data.unit.rooms === null ? '–' : formatNumber(data.unit.rooms)}</dd>
		<dt>Belegung</dt>
		<dd>
			{#if vacant}<Badge tone="warning">Leerstand</Badge>{:else}<Badge tone="success"
					>Vermietet</Badge
				>{/if}
		</dd>
		{#if data.unit.notes}
			<dt>Notizen</dt>
			<dd class="notes">{data.unit.notes}</dd>
		{/if}
	</dl>
</div>

<h2>Mietverträge</h2>
{#if data.leases.length === 0}
	<p>Auf dieser Einheit liegt noch kein Mietvertrag.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Mietverträge">
			<thead>
				<tr>
					<th>Mieter</th>
					<th>Zeitraum</th>
					<th>Rolle</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
				{#each data.leases as lease (lease.id)}
					<tr>
						<td>
							<a href="/vertraege/{lease.id}">
								{lease.tenants.length > 0
									? lease.tenants.map(personName).join(', ')
									: 'Mietvertrag ohne Mieter'}
							</a>
						</td>
						<td>
							seit {formatDate(lease.startDate)}{#if lease.endDate}
								bis {formatDate(lease.endDate)}{/if}
						</td>
						<td>{lease.main ? 'Haupteinheit' : 'Mitvermietet'}</td>
						<td>
							{#if lease.active}<Badge tone="success">Aktiv</Badge>{:else if lease.upcoming}<Badge
									tone="info">Beginnt später</Badge
								>{:else}<Badge>Beendet</Badge>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Einheit löschen</h2>
{#if form?.deleteError}
	<Alert tone="danger"><p>{form.deleteError}</p></Alert>
{/if}
<p class="muted">
	Eine Einheit, auf der ein Mietvertrag liegt, auch ein beendeter, kann nicht gelöscht werden.
</p>
<ConfirmButton
	action="?/delete"
	label="Einheit löschen"
	message="Einheit „{data.unit.name}“ löschen? Das lässt sich nicht rückgängig machen."
/>

<style>
	.notes {
		white-space: pre-line;
	}
</style>
