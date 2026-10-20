<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Snippet } from 'svelte';
	import type { DocumentLinkOptions } from '../domain/documents';

	// The upload form of /dokumente and of a lease's Dokumente tab. With `options` it offers the
	// link selects (property, lease, tenant); without, the page fixes the links itself and passes
	// its hidden inputs as children. `errors` and `values` come from a failed action.
	let {
		action,
		errors,
		values,
		options,
		uploaded,
		children
	}: {
		action: string;
		errors?: Partial<Record<string, string>>;
		values?: Record<string, string>;
		options?: DocumentLinkOptions;
		/** The name of the document the last submit stored, shown as a status line. */
		uploaded?: string;
		children?: Snippet;
	} = $props();

	const selects = $derived(
		options
			? [
					{ name: 'propertyId', label: 'Objekt', options: options.properties },
					{ name: 'leaseId', label: 'Mietvertrag', options: options.leases },
					{ name: 'tenantId', label: 'Mieter', options: options.tenants }
				]
			: []
	);
</script>

<form
	method="POST"
	{action}
	enctype="multipart/form-data"
	class="card"
	aria-label="Dokument hochladen"
	use:enhance
>
	{#if children}{@render children()}{/if}
	<label class="form-wide">
		Datei
		<input type="file" name="file" aria-invalid={errors?.file ? 'true' : undefined} required />
		{#if errors?.file}
			<span class="error">{errors.file}</span>
		{:else}
			<span class="muted small">Höchstens 10 MB.</span>
		{/if}
	</label>
	<label>
		Name (optional)
		<input
			name="name"
			defaultValue={values?.name ?? ''}
			placeholder="sonst der Dateiname"
			aria-invalid={errors?.name ? 'true' : undefined}
		/>
		{#if errors?.name}<span class="error">{errors.name}</span>{/if}
	</label>
	{#each selects as select (select.name)}
		<label>
			{select.label}
			<select name={select.name} aria-invalid={errors?.[select.name] ? 'true' : undefined}>
				<option value="">Keine Verknüpfung</option>
				{#each select.options as option (option.id)}
					<option value={option.id} selected={values?.[select.name] === option.id}>
						{option.label}
					</option>
				{/each}
			</select>
			{#if errors?.[select.name]}<span class="error">{errors[select.name]}</span>{/if}
		</label>
	{/each}
	<div class="form-actions">
		<button type="submit">Hochladen</button>
		{#if uploaded}<span role="status">„{uploaded}“ wurde hochgeladen.</span>{/if}
	</div>
</form>
