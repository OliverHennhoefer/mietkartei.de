<script lang="ts">
	import { enhance } from '$app/forms';
	import type { FieldErrors } from '../forms/fields';
	import { insuranceKindLabels } from '../labels';
	import { formatCentsPlain } from '../money';
	import type { InsuranceKind } from '../server/db/schema';
	import type { InsurancePolicy, InsurancePolicyInput } from '../server/insurance';
	import Field from './Field.svelte';

	// The form of a Versicherung, for creating (the tab) and editing (the policy's page).
	let {
		action,
		submitLabel,
		policy,
		errors,
		values
	}: {
		action: string;
		submitLabel: string;
		policy?: InsurancePolicy;
		errors?: FieldErrors<InsurancePolicyInput>;
		values?: Record<string, string>;
	} = $props();

	// From the label table: a component must not import the server schema.
	const kinds = Object.keys(insuranceKindLabels) as InsuranceKind[];

	const value = (name: string, fallback: string) => values?.[name] ?? fallback;
	const kindChoice = $derived(value('kind', policy?.kind ?? 'building'));
</script>

<form method="POST" {action} class="card" use:enhance>
	<Field label="Art" error={errors?.kind}>
		<select name="kind" aria-invalid={errors?.kind ? 'true' : undefined}>
			{#each kinds as kind (kind)}
				<option value={kind} selected={kindChoice === kind}>{insuranceKindLabels[kind]}</option>
			{/each}
		</select>
	</Field>
	<Field label="Versicherer" error={errors?.insurer}>
		<input
			name="insurer"
			defaultValue={value('insurer', policy?.insurer ?? '')}
			aria-invalid={errors?.insurer ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Versicherungsnummer (optional)" error={errors?.policyNumber}>
		<input
			name="policyNumber"
			defaultValue={value('policyNumber', policy?.policyNumber ?? '')}
			aria-invalid={errors?.policyNumber ? 'true' : undefined}
		/>
	</Field>
	<Field label="Jahresbeitrag in €" error={errors?.annualPremium}>
		<input
			name="annualPremium"
			inputmode="decimal"
			defaultValue={value('annualPremium', policy ? formatCentsPlain(policy.annualPremium) : '')}
			aria-invalid={errors?.annualPremium ? 'true' : undefined}
			required
		/>
	</Field>
	<Field
		label="Hauptfälligkeit"
		hint="Beginn eines Versicherungsjahres, steht im Versicherungsschein."
		error={errors?.renewalDate}
	>
		<input
			type="date"
			name="renewalDate"
			defaultValue={value('renewalDate', policy?.renewalDate ?? '')}
			aria-invalid={errors?.renewalDate ? 'true' : undefined}
			required
		/>
	</Field>
	<Field
		label="Kündigungsfrist in Monaten"
		hint="Meist drei Monate vor Ablauf des Versicherungsjahres."
		error={errors?.noticeMonths}
	>
		<input
			name="noticeMonths"
			inputmode="numeric"
			defaultValue={value('noticeMonths', String(policy?.noticeMonths ?? 3))}
			aria-invalid={errors?.noticeMonths ? 'true' : undefined}
			required
		/>
	</Field>
	<Field
		label="Gekündigt zum (optional)"
		hint="Letzter Tag des Versicherungsschutzes."
		error={errors?.endDate}
	>
		<input
			type="date"
			name="endDate"
			defaultValue={value('endDate', policy?.endDate ?? '')}
			aria-invalid={errors?.endDate ? 'true' : undefined}
		/>
	</Field>
	<Field label="Notiz (optional)" error={errors?.note}>
		<textarea name="note" aria-invalid={errors?.note ? 'true' : undefined}
			>{value('note', policy?.note ?? '')}</textarea
		>
	</Field>
	<div class="form-actions">
		<button type="submit">{submitLabel}</button>
	</div>
</form>
