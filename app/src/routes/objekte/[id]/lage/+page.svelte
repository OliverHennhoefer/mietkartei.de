<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import { formatIndexValue, formatPercent } from '#lib/domain/index-rent.ts';
	import { deviation } from '#lib/domain/rent-level.ts';
	import { formatArea, formatNumber, personName, pluralize } from '#lib/format.ts';
	import { stateLabels } from '#lib/labels.ts';
	import { formatCents } from '#lib/money.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const municipality = $derived(data.municipality);
	const average = $derived(municipality?.rentPerSquareMetre ?? null);
	const own = $derived(data.rentLevel);
</script>

<!-- The heading and tab bar come from the layout; this page is the "Lage" tab. -->
<h2>Gemeinde</h2>
{#if municipality}
	<p>
		<strong>{municipality.name}</strong>
		<span class="muted">
			· {stateLabels[municipality.state]} · Gemeindeschlüssel {municipality.key}
		</span>
	</p>
	{#if !municipality.byName}
		<p class="muted small">
			Der Ort „{data.property.city}“ passt zu keiner Gemeinde; zugeordnet ist die Gemeinde an der
			Postleitzahl {data.property.postalCode}.
		</p>
	{/if}
{:else}
	<Alert tone="info">
		<p>
			Zu {data.property.postalCode}
			{data.property.city} haben wir keine Gemeinde gefunden. Prüfe Postleitzahl und Ort unter
			<a href="/objekte/{data.property.id}/bearbeiten">Bearbeiten</a>.
		</p>
	</Alert>
{/if}

<h2>Mietniveau</h2>
<dl class="details">
	<dt>Durchschnitt in der Gemeinde</dt>
	<dd>
		{#if average !== null}
			{formatCents(average)} je m² Kaltmiete
		{:else}
			keine Angabe
		{/if}
	</dd>
	<dt>Deine Wohnungen</dt>
	<dd>
		{#if own}
			{formatCents(own.perSquareMetre)} je m²
			<span class="muted">
				({pluralize(own.count, 'Mietvertrag', 'Mietverträge')}, {formatArea(own.area)})
			</span>
			{#if average !== null}
				{@const difference = deviation(own.perSquareMetre, average)}
				<strong>
					{difference === 0
						? 'genau im Durchschnitt'
						: `${formatNumber(Math.abs(difference), 1)} % ${difference > 0 ? 'darüber' : 'darunter'}`}
				</strong>
			{/if}
		{:else}
			kein laufender Mietvertrag über eine Wohnung mit Wohnfläche
		{/if}
	</dd>
</dl>
<p class="muted small">
	Der Durchschnitt stammt aus dem Zensus 2022 und gilt für alle vermieteten Wohnungen der Gemeinde
	am 15. Mai 2022, alte wie neue Verträge. Er ist keine ortsübliche Vergleichsmiete und ersetzt
	keinen Mietspiegel.
</p>

<h2>Grundsteuer</h2>
<p>
	{#if municipality?.propertyTaxRate != null}
		Hebesatz der Grundsteuer B: <strong>{formatNumber(municipality.propertyTaxRate, 0)} %</strong
		>{#if data.propertyTaxYear}<span class="muted"> ({data.propertyTaxYear})</span>{/if}
	{:else}
		Zum Hebesatz der Grundsteuer B liegt keine Angabe vor.
	{/if}
</p>
<p class="muted small">
	Manche Länder erlauben seit 2025 getrennte Hebesätze für Wohn- und Nichtwohngrundstücke; dann
	steht hier der allgemeine Satz. Maßgeblich ist der Grundsteuerbescheid.
</p>

<h2>Indexmieten</h2>
{#if data.indexLeases.length === 0}
	<p>In diesem Objekt läuft kein Mietvertrag mit Indexmiete.</p>
{:else}
	<ul class="list" aria-label="Indexmieten">
		{#each data.indexLeases as lease (lease.id)}
			<li class="card">
				<div>
					<a href="/vertraege/{lease.id}/miethoehe"><strong>{lease.unitName}</strong></a>
					<span class="muted">
						· {lease.tenants.length > 0
							? lease.tenants.map(personName).join(', ')
							: 'Mietvertrag ohne Mieter'}
					</span>
				</div>
				<div>
					{#if lease.proposal}
						Erhöhung möglich: {formatCents(lease.proposal.currentBaseRent)} →
						<strong>{formatCents(lease.proposal.newBaseRent)}</strong>
						<span class="muted">
							({formatPercent(lease.proposal.percent)}, VPI {formatIndexValue(
								lease.proposal.latest.value
							)})
						</span>
					{:else}
						<span class="muted">{lease.refusal}</span>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}

<p class="muted small sources">
	Datenquellen: Statistische Ämter des Bundes und der Länder, Zensus 2022; Statistisches Bundesamt
	(Destatis), Gemeindeverzeichnis und Hebesätze der Realsteuern; Verbraucherpreisindex aus
	GENESIS-Online, Tabelle 61111-0002;
	<a href="https://www.govdata.de/dl-de/by-2-0" rel="external noopener" target="_blank"
		>Datenlizenz Deutschland – Namensnennung – Version 2.0</a
	>. Postleitzahlen: GeoNames (CC BY 4.0).
</p>

<style>
	.sources {
		margin-top: 2rem;
	}
</style>
