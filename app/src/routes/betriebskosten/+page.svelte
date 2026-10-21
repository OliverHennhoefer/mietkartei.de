<script lang="ts">
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	// The "Übersicht" tab of /betriebskosten: what is set up for the statements so far. The
	// heading and tab bar come from +layout.svelte.
	let { data }: PageProps = $props();
</script>

<h2>Stammdaten</h2>
<ul class="list" aria-label="Stammdaten">
	<li class="card">
		<a href="/betriebskosten/kostenarten"><strong>Kostenarten</strong></a>
		<span class="muted">
			{pluralize(data.categoryCount, 'Kostenart', 'Kostenarten')}, davon {data.allocableCount} umlagefähig
		</span>
	</li>
	<li class="card">
		<a href="/betriebskosten/schluessel"><strong>Umlageschlüssel</strong></a>
		<span class="muted">{pluralize(data.keyCount, 'Umlageschlüssel', 'Umlageschlüssel')}</span>
	</li>
</ul>

<h2>Abrechnungskreise</h2>
<p class="muted">Abrechnungskreise legst du je Objekt an, im Tab Abrechnungskreise des Objekts.</p>
{#if data.properties.length === 0}
	<p>Noch keine Objekte. <a href="/objekte/neu">Objekt anlegen</a></p>
{:else}
	<ul class="list" aria-label="Abrechnungskreise je Objekt">
		{#each data.properties as property (property.id)}
			<li class="card">
				<a href="/objekte/{property.id}/abrechnungskreise"><strong>{property.name}</strong></a>
				<span class="muted">
					{property.circleCount === 0
						? 'keine Abrechnungskreise'
						: pluralize(property.circleCount, 'Abrechnungskreis', 'Abrechnungskreise')}
				</span>
			</li>
		{/each}
	</ul>
{/if}
