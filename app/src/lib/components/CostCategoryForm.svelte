<script lang="ts">
	import { enhance } from '$app/forms';
	import type { FieldErrors } from '../forms/fields';
	import type { CostCategory, CostCategoryInput } from '../server/operating-costs/categories';

	// The fields of a Kostenart, used by the list page (create) and the detail page (edit). Failed
	// submissions re-render the typed values; otherwise the existing category fills the form.
	let {
		action,
		submitLabel,
		keys,
		circles,
		category,
		errors,
		values
	}: {
		action: string;
		submitLabel: string;
		keys: { id: string; name: string; propertyName: string | null }[];
		circles: { id: string; name: string; propertyName: string }[];
		category?: CostCategory;
		errors?: FieldErrors<CostCategoryInput>;
		values?: Record<string, string>;
	} = $props();

	const value = (name: string, fallback: string) => values?.[name] ?? fallback;
	const checked = (name: string, fallback: boolean) => (values ? values[name] === 'on' : fallback);
</script>

<form method="POST" {action} class="card" use:enhance>
	<label>
		Bezeichnung
		<input
			name="name"
			defaultValue={value('name', category?.name ?? '')}
			aria-invalid={errors?.name ? 'true' : undefined}
			required
		/>
		{#if errors?.name}<span class="error">{errors.name}</span>{/if}
	</label>
	<label>
		Nummer in § 2 BetrKV (optional)
		<input
			name="betrkvItem"
			inputmode="numeric"
			defaultValue={value('betrkvItem', category?.betrkvItem?.toString() ?? '')}
			aria-invalid={errors?.betrkvItem ? 'true' : undefined}
		/>
		{#if errors?.betrkvItem}<span class="error">{errors.betrkvItem}</span>{/if}
	</label>
	<label>
		Standard-Umlageschlüssel
		<select name="allocationKeyId" aria-invalid={errors?.allocationKeyId ? 'true' : undefined}>
			<option value="" selected={value('allocationKeyId', category?.allocationKeyId ?? '') === ''}>
				Kein Standard
			</option>
			{#each keys as key (key.id)}
				<option
					value={key.id}
					selected={value('allocationKeyId', category?.allocationKeyId ?? '') === key.id}
				>
					{key.name}{key.propertyName ? ` (${key.propertyName})` : ''}
				</option>
			{/each}
		</select>
		{#if errors?.allocationKeyId}<span class="error">{errors.allocationKeyId}</span>{/if}
	</label>
	<label>
		Standard-Abrechnungskreis
		<select name="billingCircleId" aria-invalid={errors?.billingCircleId ? 'true' : undefined}>
			<option value="" selected={value('billingCircleId', category?.billingCircleId ?? '') === ''}>
				Alle Einheiten des Objekts
			</option>
			{#each circles as circle (circle.id)}
				<option
					value={circle.id}
					selected={value('billingCircleId', category?.billingCircleId ?? '') === circle.id}
				>
					{circle.propertyName} – {circle.name}
				</option>
			{/each}
		</select>
		{#if errors?.billingCircleId}<span class="error">{errors.billingCircleId}</span>{/if}
	</label>
	<label>
		Reihenfolge
		<input
			name="sortOrder"
			inputmode="numeric"
			defaultValue={value('sortOrder', String(category?.sortOrder ?? 20))}
			aria-invalid={errors?.sortOrder ? 'true' : undefined}
		/>
		{#if errors?.sortOrder}<span class="error">{errors.sortOrder}</span>{/if}
	</label>
	<div class="stack">
		<label class="inline">
			<input
				type="checkbox"
				name="allocable"
				checked={checked('allocable', category?.allocable ?? true)}
			/>
			umlagefähig
		</label>
		<label class="inline">
			<input
				type="checkbox"
				name="consumptionBased"
				checked={checked('consumptionBased', category?.consumptionBased ?? false)}
			/>
			verbrauchsabhängig (Heizung, Warmwasser)
		</label>
	</div>
	<div class="form-actions">
		<button type="submit">{submitLabel}</button>
	</div>
</form>
