<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDateTime } from '#lib/dates.ts';
	import { formatIndexValue } from '#lib/domain/index-rent.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const monthNames = [
		'Jan',
		'Feb',
		'Mär',
		'Apr',
		'Mai',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Okt',
		'Nov',
		'Dez'
	];

	// One row per year, newest first, with the twelve months as columns.
	const years = $derived.by(() => {
		const byYear: Record<string, (number | undefined)[]> = {};
		for (const { month, value } of data.values) {
			const [year, number] = month.split('-');
			byYear[year] ??= Array<number | undefined>(12).fill(undefined);
			byYear[year][Number(number) - 1] = value;
		}
		return Object.entries(byYear).sort(([a], [b]) => b.localeCompare(a));
	});
</script>

<PageHeader
	title="Verbraucherpreisindex"
	lead="Die Indexwerte, nach denen Indexmieten angepasst werden."
/>

<Alert tone="info">
	<p>
		Mietkartei ruft die Werte selbst beim Statistischen Bundesamt (Destatis) ab:
		Verbraucherpreisindex für Deutschland, Basisjahr 2020 = 100. Neue Monate erscheinen hier wenige
		Stunden nach der Veröffentlichung. Für einen Vorschlag zählt der neueste Monat.
	</p>
</Alert>

{#if !data.configured}
	<Alert tone="warning">
		<p>
			Auf dieser Installation ist kein Abruf eingerichtet. Dafür braucht es den API-Token eines
			kostenlosen Kontos bei GENESIS-Online in der Variablen <code>GENESIS_API_TOKEN</code>.
		</p>
	</Alert>
{:else if data.running}
	<Alert tone="info">
		<p>
			Mietkartei ruft die Werte gerade bei Destatis ab. Lade die Seite in einer Minute neu, um das
			Ergebnis zu sehen.
		</p>
	</Alert>
{:else if data.lastFetch?.error}
	<Alert tone="warning">
		<p>
			Der letzte Abruf am {formatDateTime(data.lastFetch.attemptedAt)} ist fehlgeschlagen: {data
				.lastFetch.error} Mietkartei versucht es in einer halben Stunde wieder.
		</p>
	</Alert>
{/if}

<h2>Werte</h2>
{#if years.length === 0}
	<p>Noch keine Werte abgerufen.</p>
{:else}
	<div class="table-wrap">
		<table class="table index-grid" aria-label="VPI-Werte">
			<thead>
				<tr>
					<th>Jahr</th>
					{#each monthNames as name (name)}
						<th class="num">{name}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each years as [year, months] (year)}
					<tr>
						<td>{year}</td>
						{#each months as value, index (index)}
							<td class="num">{value === undefined ? '' : formatIndexValue(value)}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
<p class="muted small">
	{#if data.lastFetch?.succeededAt}Zuletzt abgerufen am {formatDateTime(
			data.lastFetch.succeededAt
		)}.
	{/if}Datenquelle: Statistisches Bundesamt (Destatis), GENESIS-Online, Tabelle 61111-0002;
	<a href="https://www.govdata.de/dl-de/by-2-0" rel="external noopener" target="_blank"
		>Datenlizenz Deutschland – Namensnennung – Version 2.0</a
	>.
</p>

<style>
	/* Thirteen columns fit the settings dialog with narrower cells; a phone stacks them anyway. */
	@media (min-width: 40.0625rem) {
		.index-grid th,
		.index-grid td {
			padding: 0.6rem 0.3rem;
			font-size: var(--text-sm);
		}
		.index-grid th:first-child,
		.index-grid td:first-child {
			padding-left: 1rem;
		}
		.index-grid th:last-child,
		.index-grid td:last-child {
			padding-right: 1rem;
		}
	}
</style>
