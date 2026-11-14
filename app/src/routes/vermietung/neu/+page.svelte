<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Field from '#lib/components/Field.svelte';
	import FormSection from '#lib/components/FormSection.svelte';
	import LettingFields from '#lib/components/LettingFields.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const values = $derived<Record<string, string>>(form?.values ?? data.defaults);
	const errors = $derived(form?.errors);

	// The terms come from the unit's latest lease, so a new unit reloads the page with it.
	function chooseUnit(event: Event) {
		const unitId = (event.currentTarget as HTMLSelectElement).value;
		const query = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the resolved page with a query
		void goto(`${resolve('/vermietung/neu')}${query}`, { replaceState: true });
	}
</script>

<PageHeader title="Neuvermietung anlegen" back={{ href: '/vermietung', label: 'Neuvermietung' }} />

{#if data.units.length === 0}
	<p>Lege zuerst ein <a href="/objekte/neu">Objekt mit seinen Einheiten</a> an.</p>
{:else}
	{#key values}
		<form method="POST" action="?/create" class="card" use:enhance>
			<FormSection title="Einheit" description="Die Einheit, für die du einen neuen Mieter suchst.">
				<Field
					label="Einheit"
					error={errors?.unitId}
					note={data.openLettingId
						? 'Für diese Einheit läuft schon eine Neuvermietung.'
						: undefined}
				>
					<select
						name="unitId"
						onchange={chooseUnit}
						aria-invalid={errors?.unitId ? 'true' : undefined}
						required
					>
						<option value="" selected={!values.unitId}>Bitte wählen</option>
						{#each data.units as { unit, property } (unit.id)}
							<option value={unit.id} selected={values.unitId === unit.id}
								>{unit.name} · {property.name}</option
							>
						{/each}
					</select>
				</Field>
				{#if data.openLettingId}
					<p class="form-wide">
						<a href="/vermietung/{data.openLettingId}">Zur laufenden Neuvermietung</a>
					</p>
				{/if}
			</FormSection>
			<LettingFields {values} {errors} />
			<div class="form-actions form-wide">
				<button type="submit">Neuvermietung anlegen</button>
				<a class="button secondary" href="/vermietung">Abbrechen</a>
			</div>
		</form>
	{/key}
{/if}
