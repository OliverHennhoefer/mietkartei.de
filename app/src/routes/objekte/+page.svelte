<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	// Fields use defaultValue, not value, so that hydration keeps anything typed before it.
</script>

<svelte:head>
	<title>Objekte · mietkartei</title>
</svelte:head>

<h1>Objekte</h1>
<p class="muted">Gebäude und Grundstücke, die du vermietest.</p>

{#if data.properties.length === 0}
	<p>Du hast noch keine Objekte angelegt.</p>
{:else}
	<ul class="list" aria-label="Objekte">
		{#each data.properties as property (property.id)}
			<li class="card">
				<a href={resolve('/objekte/[id]', { id: property.id })}><strong>{property.name}</strong></a>
				<div class="muted">{property.street}, {property.postalCode} {property.city}</div>
			</li>
		{/each}
	</ul>
{/if}

<h2>Objekt anlegen</h2>
<form method="POST" action="?/create" class="card" use:enhance>
	<label>
		Bezeichnung
		<input
			name="name"
			defaultValue={form?.values?.name ?? ''}
			placeholder="z. B. Mehrfamilienhaus Lindenstraße"
			aria-invalid={form?.errors?.name ? 'true' : undefined}
			required
		/>
		{#if form?.errors?.name}<span class="error">{form.errors.name}</span>{/if}
	</label>
	<label>
		Straße und Hausnummer
		<input
			name="street"
			defaultValue={form?.values?.street ?? ''}
			autocomplete="street-address"
			aria-invalid={form?.errors?.street ? 'true' : undefined}
			required
		/>
		{#if form?.errors?.street}<span class="error">{form.errors.street}</span>{/if}
	</label>
	<label>
		Postleitzahl
		<input
			name="postalCode"
			defaultValue={form?.values?.postalCode ?? ''}
			inputmode="numeric"
			autocomplete="postal-code"
			aria-invalid={form?.errors?.postalCode ? 'true' : undefined}
			required
		/>
		{#if form?.errors?.postalCode}<span class="error">{form.errors.postalCode}</span>{/if}
	</label>
	<label>
		Ort
		<input
			name="city"
			defaultValue={form?.values?.city ?? ''}
			autocomplete="address-level2"
			aria-invalid={form?.errors?.city ? 'true' : undefined}
			required
		/>
		{#if form?.errors?.city}<span class="error">{form.errors.city}</span>{/if}
	</label>
	<div class="form-actions">
		<button type="submit">Objekt anlegen</button>
	</div>
</form>
