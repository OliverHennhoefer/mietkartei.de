<script lang="ts">
	import CostCategoryForm from '#lib/components/CostCategoryForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const keyName = (id: string | null) => data.keys.find((key) => key.id === id)?.name ?? '–';
	const circleName = (id: string | null) => {
		const circle = data.circles.find((candidate) => candidate.id === id);
		return circle ? `${circle.propertyName} – ${circle.name}` : 'alle Einheiten';
	};
</script>

<h2>Kostenarten</h2>
<p class="muted">
	Die 17 Kostenarten aus § 2 Betriebskostenverordnung sind vorbelegt. Der Standardschlüssel und der
	Standardkreis werden in jeden neuen Beleg der Kostenart übernommen.
</p>

<div class="table-wrap">
	<table class="table" aria-label="Kostenarten">
		<thead>
			<tr>
				<th class="num">Nr.</th>
				<th>Kostenart</th>
				<th>umlagefähig</th>
				<th>verbrauchsabhängig</th>
				<th>Standardschlüssel</th>
				<th>Standardkreis</th>
			</tr>
		</thead>
		<tbody>
			{#each data.categories as category (category.id)}
				<tr>
					<td class="num">{category.betrkvItem ?? ''}</td>
					<td><a href="/betriebskosten/kostenarten/{category.id}">{category.name}</a></td>
					<td>{category.allocable ? 'ja' : 'nein'}</td>
					<td>{category.consumptionBased ? 'ja' : 'nein'}</td>
					<td>{category.allocable ? keyName(category.allocationKeyId) : '–'}</td>
					<td>{category.allocable ? circleName(category.billingCircleId) : '–'}</td>
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
