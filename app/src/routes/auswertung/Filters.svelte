<script lang="ts">
	// The period and property selects above an Auswertung page. They submit on change, so the URL
	// always says what is shown; without JavaScript a button does it. `years` empty hides the year.
	let {
		years,
		period,
		propertyId,
		propertyOptions
	}: {
		years: number[];
		period: number | 'all';
		propertyId: string | null;
		propertyOptions: { id: string; name: string }[];
	} = $props();
</script>

{#if years.length > 0 || propertyOptions.length > 1}
	<form method="GET" class="toolbar filters">
		{#if years.length > 0}
			<label class="inline">
				Zeitraum
				<select name="jahr" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
					{#each years as year (year)}
						<option value={String(year)} selected={period === year}>{year}</option>
					{/each}
					<option value="gesamt" selected={period === 'all'}>Gesamt</option>
				</select>
			</label>
		{/if}
		{#if propertyOptions.length > 1}
			<label class="inline">
				Objekt
				<select name="objekt" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
					<option value="" selected={!propertyId}>alle Objekte</option>
					{#each propertyOptions as property (property.id)}
						<option value={property.id} selected={propertyId === property.id}>
							{property.name}
						</option>
					{/each}
				</select>
			</label>
		{/if}
		<noscript><button type="submit" class="secondary small">Anzeigen</button></noscript>
	</form>
{/if}

<style>
	.filters {
		margin-bottom: 1rem;
	}
</style>
