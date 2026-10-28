<script lang="ts">
	import CostCategoryForm from '#lib/components/CostCategoryForm.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const keyName = (id: string | null) => data.keys.find((key) => key.id === id)?.name ?? '–';
	const circleName = (id: string | null) => {
		const circle = data.circles.find((candidate) => candidate.id === id);
		return circle ? `${circle.propertyName} – ${circle.name}` : 'alle Einheiten';
	};
	const sort = new TableSort<PageProps['data']['categories'][number]>({
		item: byText((category) => category.betrkvItem?.toString()),
		name: byText((category) => category.name),
		allocable: byNumber((category) => (category.allocable ? 1 : 0)),
		consumption: byNumber((category) => (category.consumptionBased ? 1 : 0)),
		key: byText((category) => (category.allocable ? keyName(category.allocationKeyId) : null)),
		circle: byText((category) =>
			category.allocable ? circleName(category.billingCircleId) : null
		),
		items: byNumber((category) => category.costItemCount)
	});
</script>

<h2 class="visually-hidden">Kostenarten</h2>
<p class="muted">
	Die 17 Kostenarten aus § 2 Betriebskostenverordnung sind vorbelegt. Der Standardschlüssel und der
	Standardkreis werden in jeden neuen Beleg der Kostenart übernommen.
</p>

<div class="table-wrap">
	<table class="table" aria-label="Kostenarten">
		<thead>
			<tr>
				<SortHeader {sort} key="item" class="num">Nr.</SortHeader>
				<SortHeader {sort} key="name">Kostenart</SortHeader>
				<SortHeader {sort} key="allocable">umlagefähig</SortHeader>
				<SortHeader {sort} key="consumption">verbrauchsabhängig</SortHeader>
				<SortHeader {sort} key="key">Standardschlüssel</SortHeader>
				<SortHeader {sort} key="circle">Standardkreis</SortHeader>
				<SortHeader {sort} key="items" class="num">Belege</SortHeader>
			</tr>
		</thead>
		<tbody>
			{#each sort.rows(data.categories) as category (category.id)}
				<tr>
					<td class="num">{category.betrkvItem ?? ''}</td>
					<td><a href="/betriebskosten/kostenarten/{category.id}">{category.name}</a></td>
					<td>{category.allocable ? 'ja' : 'nein'}</td>
					<td>{category.consumptionBased ? 'ja' : 'nein'}</td>
					<td>{category.allocable ? keyName(category.allocationKeyId) : '–'}</td>
					<td>{category.allocable ? circleName(category.billingCircleId) : '–'}</td>
					<td class="num">{category.costItemCount}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<h2>Kostenart anlegen</h2>
<CostCategoryForm
	action="?/create"
	submitLabel="Kostenart anlegen"
	keys={data.keys}
	circles={data.circles}
	errors={form?.errors}
	values={form?.values}
/>
