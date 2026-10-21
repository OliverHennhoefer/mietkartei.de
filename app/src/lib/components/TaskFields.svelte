<script lang="ts">
	import { linkValue, type TaskFormErrors } from '../forms/tasks';
	import Field from './Field.svelte';

	// The fields of the task form, shared by the list page (create) and the task page (edit).
	// `values` are the re-rendered form values after a failed submit, else the task's own.
	let {
		values,
		errors,
		properties,
		leases
	}: {
		values: Record<string, string>;
		errors?: TaskFormErrors;
		properties: { id: string; name: string }[];
		leases: { id: string; label: string; active: boolean }[];
	} = $props();
</script>

<Field label="Aufgabe" error={errors?.title}>
	<input
		name="title"
		defaultValue={values.title ?? ''}
		placeholder="z. B. Rauchmelder prüfen"
		aria-invalid={errors?.title ? 'true' : undefined}
		required
	/>
</Field>
<Field label="Fällig am (optional)" error={errors?.dueDate}>
	<input
		type="date"
		name="dueDate"
		defaultValue={values.dueDate ?? ''}
		aria-invalid={errors?.dueDate ? 'true' : undefined}
	/>
</Field>
<Field label="Gehört zu (optional)" error={errors?.link}>
	<select name="link" aria-invalid={errors?.link ? 'true' : undefined}>
		<option value="" selected={!values.link}>–</option>
		{#if properties.length > 0}
			<optgroup label="Objekte">
				{#each properties as property (property.id)}
					<option
						value={linkValue('property', property.id)}
						selected={values.link === linkValue('property', property.id)}
					>
						{property.name}
					</option>
				{/each}
			</optgroup>
		{/if}
		{#if leases.length > 0}
			<optgroup label="Mietverträge">
				{#each leases as lease (lease.id)}
					<option
						value={linkValue('lease', lease.id)}
						selected={values.link === linkValue('lease', lease.id)}
					>
						{lease.label}{lease.active ? '' : ' (beendet)'}
					</option>
				{/each}
			</optgroup>
		{/if}
	</select>
</Field>
<Field label="Notiz (optional)" error={errors?.note}>
	<textarea name="note" aria-invalid={errors?.note ? 'true' : undefined}
		>{values.note ?? ''}</textarea
	>
</Field>
