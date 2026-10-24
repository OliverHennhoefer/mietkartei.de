<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The setup checklist, in the order the data depends on each other; each step leads to the
	// page that creates what it asks for.
	const steps = $derived(
		data.firstRun
			? [
					{ done: data.firstRun.properties, href: '/objekte/neu', label: 'Objekt anlegen' },
					{
						done: data.firstRun.units,
						href: data.firstRun.firstPropertyId
							? `/objekte/${data.firstRun.firstPropertyId}`
							: '/objekte/neu',
						label: 'Einheit anlegen'
					},
					{ done: data.firstRun.tenants, href: '/mieter/neu', label: 'Mieter anlegen' },
					{
						done: data.firstRun.leases,
						href: '/vertraege/neu',
						label: 'Mietvertrag mit Miete und Kaution anlegen'
					},
					{
						done: data.firstRun.bankAccounts,
						href: '/bank/konten',
						label: 'Bankverbindung für den Umsatzabgleich anlegen'
					},
					{
						done: data.firstRun.categories,
						href: '/betriebskosten/kostenarten',
						label: 'Kostenarten und Umlageschlüssel prüfen'
					}
				]
			: []
	);
</script>

<PageHeader
	title="Übersicht"
	lead="Rückstände, Leerstand, Bankumsätze und Fristen auf einen Blick."
/>

{#if data.newDamageReports > 0}
	<Alert tone="warning">
		<a href="/schadensmeldungen"
			>{data.newDamageReports === 1
				? 'Eine neue Schadensmeldung'
				: `${data.newDamageReports} neue Schadensmeldungen`}</a
		> aus dem Mieterportal.
	</Alert>
{/if}

{#if data.firstRun}
	<section class="card first-run" aria-labelledby="first-run">
		<h2 id="first-run">Erste Schritte</h2>
		{#if !data.firstRun.properties}
			<p class="muted">
				Dein Bestand ist noch leer. So fängst du an{#if data.role === 'owner'}, oder du probierst
					mietkartei erst mit <a href="/einstellungen/konto">Demodaten</a> aus{/if}. Hast du die
				Daten schon in einer Tabelle, nimmt die <a href="/datenuebernahme">Datenübernahme</a> sie dir
				ab.
			</p>
		{:else}
			<p class="muted">
				Sobald ein Mietvertrag und eine Bankverbindung angelegt sind, siehst du hier Rückstände,
				Leerstand, Bankumsätze und Fristen. Hast du die Daten in einer Tabelle, nimmt die
				<a href="/datenuebernahme">Datenübernahme</a> sie dir ab.
			</p>
		{/if}
		<ol class="steps">
			{#each steps as step (step.label)}
				<li class:done={step.done}>
					<a href={step.href}>{step.label}</a>
					{#if step.done}<span class="muted">erledigt</span>{/if}
				</li>
			{/each}
		</ol>
	</section>
{:else}
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
					zu erledigen: {pluralize(data.tiles.overdue, 'überfällige Frist', 'überfällige Fristen')}
					und {pluralize(data.tiles.openTasks, 'offene Aufgabe', 'offene Aufgaben')} ·
					{pluralize(data.tiles.upcoming, 'Frist', 'Fristen')} in den nächsten 12 Monaten
				</span>
			</a>
		</li>
	</ul>
{/if}

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
