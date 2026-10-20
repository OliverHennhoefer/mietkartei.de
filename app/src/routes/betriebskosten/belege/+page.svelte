<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** The current filter, for the "Beleg erfassen" link. */
	const query = $derived(
		[
			data.property ? `property=${encodeURIComponent(data.property.id)}` : '',
			data.year !== null ? `year=${data.year}` : ''
		]
			.filter(Boolean)
			.join('&')
	);
</script>

<h2>Belege</h2>

<div class="toolbar between">
	<form method="GET" class="row" aria-label="Filter">
		<label class="inline">
			Objekt
			<select name="property" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
				<option value="" selected={data.property === null}>alle Objekte</option>
				{#each data.properties as property (property.id)}
					<option value={property.id} selected={data.property?.id === property.id}>
						{property.name}
					</option>
				{/each}
			</select>
		</label>
		<label class="inline">
			Jahr
			<select name="year" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
				<option value="" selected={data.year === null}>alle Jahre</option>
				{#each data.years as year (year)}
					<option value={year} selected={data.year === year}>{year}</option>
				{/each}
			</select>
		</label>
		<noscript><button type="submit" class="secondary small">Anzeigen</button></noscript>
	</form>
	{#if data.properties.length > 0}
		<a class="button" href="/betriebskosten/belege/neu{query ? `?${query}` : ''}">Beleg erfassen</a>
	{/if}
</div>

{#if data.properties.length === 0}
	<EmptyState title="Noch kein Objekt" text="Belege gehören zu einem Objekt. Lege zuerst eines an.">
		<a class="button" href="/objekte">Objekt anlegen</a>
	</EmptyState>
{:else if data.items.length === 0}
	<EmptyState
		title="Keine Belege"
		text={data.year !== null
			? `Für ${data.year} sind noch keine Belege erfasst.`
			: 'Es sind noch keine Belege erfasst.'}
	/>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Belege">
			<thead>
				<tr>
					<th>Rechnungsdatum</th>
					<th>Beschreibung</th>
					<th>Lieferant</th>
					{#if !data.property}<th>Objekt</th>{/if}
					<th>Kostenart</th>
					<th>Umlageschlüssel</th>
					<th>Abrechnungskreis</th>
					<th>Zeitraum</th>
					<th class="num">Betrag</th>
					<th>Beleg</th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as item (item.id)}
					<tr>
						<td>{item.invoiceDate ? formatDate(item.invoiceDate) : '–'}</td>
						<td><a href="/betriebskosten/belege/{item.id}">{item.description}</a></td>
						<td>{item.supplier ?? '–'}</td>
						{#if !data.property}<td>{item.propertyName}</td>{/if}
						<td>{item.categoryName}</td>
						<td>{item.keyName}</td>
						<td>{item.circleName ?? 'alle Einheiten'}</td>
						<td class="nowrap">{formatDate(item.periodStart)} – {formatDate(item.periodEnd)}</td>
						<td class="num"><Money cents={item.amount} /></td>
						<td>
							{#each item.receipts as receipt (receipt.id)}
								<a href="/dokumente/{receipt.id}/download">{receipt.name}</a>
							{/each}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<td colspan={data.property ? 7 : 8}>Summe</td>
					<td class="num"><Money cents={data.total} /></td>
					<td></td>
				</tr>
			</tfoot>
		</table>
	</div>

	<h2>Summe je Kostenart</h2>
	<div class="table-wrap">
		<table class="table" aria-label="Summe je Kostenart">
			<thead>
				<tr>
					<th>Kostenart</th>
					<th class="num">Belege</th>
					<th class="num">Summe</th>
				</tr>
			</thead>
			<tbody>
				{#each data.totals as row (row.categoryName)}
					<tr>
						<td>{row.categoryName}</td>
						<td class="num">{row.count}</td>
						<td class="num"><Money cents={row.total} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.nowrap {
		white-space: nowrap;
	}
</style>
