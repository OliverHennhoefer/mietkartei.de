<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { unitKindLabels, unitKinds } from '#lib/units.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const area = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
</script>

<svelte:head>
	<title>{data.property.name} · mietkartei</title>
</svelte:head>

<p><a href={resolve('/objekte')}>← Alle Objekte</a></p>
<h1>{data.property.name}</h1>
<p class="muted">{data.property.street}, {data.property.postalCode} {data.property.city}</p>

<h2>Einheiten</h2>
{#if data.units.length === 0}
	<p>Dieses Objekt hat noch keine Einheiten.</p>
{:else}
	<ul class="list" aria-label="Einheiten">
		{#each data.units as unit (unit.id)}
			<li class="card">
				<strong>{unit.name}</strong>
				<span class="muted">
					· {unitKindLabels[unit.kind]}{#if unit.floorArea !== null}
						· {area.format(unit.floorArea)} m²{/if}
				</span>
			</li>
		{/each}
	</ul>
{/if}

<h2>Einheit anlegen</h2>
<form method="POST" action="?/createUnit" class="card" use:enhance>
	<label>
		Bezeichnung
		<input
			name="name"
			value={values?.name ?? ''}
			placeholder="z. B. Wohnung 1. OG links"
			aria-invalid={errors?.name ? 'true' : undefined}
			required
		/>
		{#if errors?.name}<span class="error">{errors.name}</span>{/if}
	</label>
	<label>
		Art
		<select name="kind" aria-invalid={errors?.kind ? 'true' : undefined} required>
			{#each unitKinds as kind (kind)}
				<option value={kind} selected={(values?.kind ?? 'apartment') === kind}>
					{unitKindLabels[kind]}
				</option>
			{/each}
		</select>
		{#if errors?.kind}<span class="error">{errors.kind}</span>{/if}
	</label>
	<label>
		Fläche in m² (optional)
		<input
			name="floorArea"
			value={values?.floorArea ?? ''}
			inputmode="decimal"
			aria-invalid={errors?.floorArea ? 'true' : undefined}
		/>
		{#if errors?.floorArea}<span class="error">{errors.floorArea}</span>{/if}
	</label>
	<div class="form-actions">
		<button type="submit">Einheit anlegen</button>
	</div>
	{#if form && 'created' in form}
		<p class="form-actions" role="status">„{form.created}“ wurde angelegt.</p>
	{/if}
</form>
