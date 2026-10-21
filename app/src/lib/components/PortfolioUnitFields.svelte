<script lang="ts">
	import Field from './Field.svelte';
	import { unitKindLabels, unitKinds, type UnitKind } from '../units';

	// The fields of the unit form, shared by the create form on /objekte/[id] and the edit page.
	// `values` are the strings a failed submit sent back, `unit` the saved row when editing.
	let {
		values,
		errors,
		unit
	}: {
		values?: Record<string, string>;
		errors?: Partial<Record<string, string>>;
		unit?: {
			name: string;
			kind: UnitKind;
			floorArea: number | null;
			floor: string | null;
			rooms: number | null;
			notes: string | null;
		};
	} = $props();

	const decimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, useGrouping: false });

	function initial(name: string, saved: string | number | null | undefined): string {
		if (values && name in values) return values[name];
		if (saved === null || saved === undefined) return '';
		return typeof saved === 'number' ? decimal.format(saved) : saved;
	}
</script>

<Field label="Bezeichnung" error={errors?.name}>
	<input
		name="name"
		defaultValue={initial('name', unit?.name)}
		placeholder="z. B. Wohnung 1. OG links"
		aria-invalid={errors?.name ? 'true' : undefined}
		required
	/>
</Field>
<Field label="Art" error={errors?.kind}>
	<select name="kind" aria-invalid={errors?.kind ? 'true' : undefined} required>
		{#each unitKinds as kind (kind)}
			<option value={kind} selected={initial('kind', unit?.kind ?? 'apartment') === kind}>
				{unitKindLabels[kind]}
			</option>
		{/each}
	</select>
</Field>
<Field label="Fläche in m² (optional)" error={errors?.floorArea}>
	<input
		name="floorArea"
		defaultValue={initial('floorArea', unit?.floorArea)}
		inputmode="decimal"
		aria-invalid={errors?.floorArea ? 'true' : undefined}
	/>
</Field>
<Field label="Etage (optional)" error={errors?.floor}>
	<input
		name="floor"
		defaultValue={initial('floor', unit?.floor)}
		placeholder="z. B. 1. OG"
		aria-invalid={errors?.floor ? 'true' : undefined}
	/>
</Field>
<Field label="Zimmer (optional)" error={errors?.rooms}>
	<input
		name="rooms"
		defaultValue={initial('rooms', unit?.rooms)}
		inputmode="decimal"
		placeholder="z. B. 2,5"
		aria-invalid={errors?.rooms ? 'true' : undefined}
	/>
</Field>
<div class="form-wide">
	<Field label="Notizen" error={errors?.notes}>
		<textarea name="notes" defaultValue={initial('notes', unit?.notes)}></textarea>
	</Field>
</div>
