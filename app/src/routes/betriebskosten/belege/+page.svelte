<script lang="ts">
	import DocumentLink from '#lib/components/DocumentLink.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { byDate, byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
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
	const sort = new TableSort<PageProps['data']['items'][number]>({
		invoiceDate: byDate((item) => item.invoiceDate),
		description: byText((item) => item.description),
		supplier: byText((item) => item.supplier),
		property: byText((item) => item.propertyName),
		category: byText((item) => item.categoryName),
		key: byText((item) => item.keyName),
		amount: byNumber((item) => item.amount),
		receipts: byNumber((item) => item.receipts.length)
	});
	const totalSort = new TableSort<PageProps['data']['totals'][number]>({
		category: byText((row) => row.categoryName),
		count: byNumber((row) => row.count),
		total: byNumber((row) => row.total)
	});
</script>

<h2 class="visually-hidden">Belege</h2>

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
					<SortHeader {sort} key="invoiceDate">Rechnungsdatum</SortHeader>
					<SortHeader {sort} key="description">Beschreibung</SortHeader>
					<SortHeader {sort} key="supplier">Lieferant</SortHeader>
					{#if !data.property}<SortHeader {sort} key="property">Objekt</SortHeader>{/if}
					<SortHeader {sort} key="category">Kostenart</SortHeader>
					<SortHeader {sort} key="key">Verteilung</SortHeader>
					<SortHeader {sort} key="amount" class="num">Betrag</SortHeader>
					<SortHeader {sort} key="receipts">Datei</SortHeader>
				</tr>
			</thead>
			<tbody>
				{#each sort.rows(data.items) as item (item.id)}
					<tr>
						<td>{item.invoiceDate ? formatDate(item.invoiceDate) : '–'}</td>
						<td>
							<a href="/betriebskosten/belege/{item.id}">{item.description}</a>
							<span class="detail nowrap">
								{formatDate(item.periodStart)} – {formatDate(item.periodEnd)}
							</span>
						</td>
						<td>{item.supplier ?? '–'}</td>
						{#if !data.property}<td>{item.propertyName}</td>{/if}
						<td>{item.categoryName}</td>
						<td>
							{item.keyName}
							<span class="detail">{item.circleName ?? 'alle Einheiten'}</span>
						</td>
						<td class="num"><Money cents={item.amount} /></td>
						<td>
							{#each item.receipts as receipt (receipt.id)}
								<DocumentLink document={receipt} />
							{/each}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<td colspan={data.property ? 5 : 6}>Summe</td>
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
					<SortHeader sort={totalSort} key="category">Kostenart</SortHeader>
					<SortHeader sort={totalSort} key="count" class="num">Belege</SortHeader>
					<SortHeader sort={totalSort} key="total" class="num">Summe</SortHeader>
				</tr>
			</thead>
			<tbody>
				{#each totalSort.rows(data.totals) as row (row.categoryName)}
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
	/* The second line of a cell: the period under the description, the circle under the key. */
	.detail {
		display: block;
		color: var(--color-muted);
		font-size: var(--text-sm);
	}
	.nowrap {
		white-space: nowrap;
	}
</style>
