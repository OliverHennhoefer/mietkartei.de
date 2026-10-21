<script lang="ts">
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const steps = $derived(
		data.firstRun
			? [
					{
						done: data.firstRun.properties,
						href: '/objekte',
						label: 'Ein Objekt mit seinen Einheiten anlegen'
					},
					{ done: data.firstRun.tenants, href: '/mieter', label: 'Die Mieter erfassen' },
					{
						done: data.firstRun.leases,
						href: '/vertraege',
						label: 'Die Mietverträge mit Miete und Kaution anlegen'
					},
					{
						done: data.firstRun.bankAccounts,
						href: '/bank/konten',
						label: 'Eine Bankverbindung für den Umsatzabgleich eintragen'
					}
				]
			: []
	);
</script>

<PageHeader
	title="Übersicht"
	lead="Rückstände, Leerstand, Bankumsätze und Fristen auf einen Blick."
/>

{#if data.firstRun}
	<section class="card first-run" aria-labelledby="first-run">
		<h2 id="first-run">Erste Schritte</h2>
		<p class="muted">
			Dein Bestand ist noch leer. So fängst du an, oder du probierst mietkartei erst mit
			<a href="/einstellungen/konto">Demodaten</a> aus. Hast du die Daten schon in einer Tabelle,
			nimmt die <a href="/import">Datenübernahme</a> sie dir ab.
		</p>
		<ol class="steps">
			{#each steps as step (step.href)}
				<li class:done={step.done}>
					<a href={step.href}>{step.label}</a>
					{#if step.done}<span class="muted">erledigt</span>{/if}
				</li>
			{/each}
		</ol>
	</section>
{/if}

<ul class="tiles" aria-label="Kennzahlen">
	<li class="card tile">
		<a href="/mietkonto?filter=rueckstaende">
			<span class="value"><Money cents={data.tiles.arrearsTotal} /></span>
			<span class="label">
				Rückstände · {pluralize(data.tiles.arrearsCount, 'Mietvertrag', 'Mietverträge')}
			</span>
		</a>
	</li>
	<li class="card tile">
		<a href="/objekte">
			<span class="value">{data.tiles.vacantCount}</span>
			<span class="label">
				Leerstand · von {pluralize(data.tiles.unitCount, 'Einheit', 'Einheiten')}
			</span>
		</a>
	</li>
	<li class="card tile">
		<a href="/bank">
			<span class="value">{data.tiles.unmatched}</span>
			<span class="label">
				{data.tiles.unmatched === 1 ? 'offener Bankumsatz' : 'offene Bankumsätze'}
			</span>
		</a>
	</li>
	<li class="card tile">
		<a href="/aufgaben">
			<span class="value">{data.tiles.overdue + data.tiles.openTasks}</span>
			<span class="label">
				{pluralize(data.tiles.overdue, 'überfällige Frist', 'überfällige Fristen')},
				{pluralize(data.tiles.openTasks, 'offene Aufgabe', 'offene Aufgaben')},
				{data.tiles.upcoming} in den nächsten 12 Monaten
			</span>
		</a>
	</li>
</ul>

{#if data.vacant.length > 0}
	<section aria-labelledby="vacant">
		<h2 id="vacant">Leer stehende Einheiten</h2>
		<ul class="list" aria-label="Leer stehende Einheiten">
			{#each data.vacant as row (row.unitId)}
				<li class="card">
					<a href="/objekte/{row.propertyId}">{row.label}</a>
					<a href="/vertraege/neu?unitId={row.unitId}">Mietvertrag anlegen</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.first-run {
		margin-bottom: 1.5rem;
	}
	.first-run h2 {
		margin-top: 0;
	}
	.steps {
		margin: 0;
		padding-left: 1.5rem;
		display: grid;
		gap: 0.5rem;
	}
	.steps .done a {
		text-decoration: line-through;
	}
	.tiles {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.75rem;
		margin: 0 0 1.5rem;
	}
	.tile a {
		display: grid;
		gap: 0.125rem;
		text-decoration: none;
		color: inherit;
	}
	.tile .value {
		font-size: 1.75rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.tile .label {
		color: var(--color-muted);
		font-size: 0.9rem;
	}
	.tile a:hover .value {
		text-decoration: underline;
	}
</style>
