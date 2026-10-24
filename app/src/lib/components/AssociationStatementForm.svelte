<script lang="ts">
	import { enhance } from '$app/forms';
	import type { FieldErrors } from '../forms/fields';
	import type { AssociationStatementForm } from '../forms/association-statements';
	import { formatCentsPlain } from '../money';
	import type { AssociationStatement } from '../server/association-statements';
	import Field from './Field.svelte';

	// The form of a Hausgeldabrechnung, for creating (the Hausgeld tab) and editing (its page).
	// The amounts are the unit's share as the Verwalter printed it.
	let {
		action,
		submitLabel,
		statement,
		defaultYear,
		errors,
		values
	}: {
		action: string;
		submitLabel: string;
		statement?: AssociationStatement;
		/** The Wirtschaftsjahr a new statement starts with. */
		defaultYear?: number;
		errors?: FieldErrors<AssociationStatementForm>;
		values?: Record<string, string>;
	} = $props();

	const value = (name: string, fallback: string) => values?.[name] ?? fallback;
	const money = (name: keyof AssociationStatement, cents: number | null | undefined) =>
		value(name, cents === null || cents === undefined ? '' : formatCentsPlain(Math.abs(cents)));
	const balanceKind = $derived(
		value('balanceKind', (statement?.statedBalance ?? 0) < 0 ? 'credit' : 'due')
	);
</script>

<form method="POST" {action} class="card" use:enhance>
	<Field label="Wirtschaftsjahr von" error={errors?.periodStart}>
		<input
			type="date"
			name="periodStart"
			defaultValue={value('periodStart', statement?.periodStart ?? `${defaultYear}-01-01`)}
			aria-invalid={errors?.periodStart ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Wirtschaftsjahr bis" error={errors?.periodEnd}>
		<input
			type="date"
			name="periodEnd"
			defaultValue={value('periodEnd', statement?.periodEnd ?? `${defaultYear}-12-31`)}
			aria-invalid={errors?.periodEnd ? 'true' : undefined}
			required
		/>
	</Field>
	<Field
		label="Umlagefähige Kosten in €"
		error={errors?.allocableCosts}
		hint="Der Anteil der Wohnung an den umlagefähigen Kosten, meist als Summe ausgewiesen."
	>
		<input
			name="allocableCosts"
			inputmode="decimal"
			defaultValue={value(
				'allocableCosts',
				statement ? formatCentsPlain(statement.allocableCosts) : ''
			)}
			aria-invalid={errors?.allocableCosts ? 'true' : undefined}
		/>
	</Field>
	<Field
		label="Nicht umlagefähige Kosten in €"
		error={errors?.nonAllocableCosts}
		hint="Etwa Verwaltervergütung, Instandhaltung, Bankgebühren."
	>
		<input
			name="nonAllocableCosts"
			inputmode="decimal"
			defaultValue={value(
				'nonAllocableCosts',
				statement ? formatCentsPlain(statement.nonAllocableCosts) : ''
			)}
			aria-invalid={errors?.nonAllocableCosts ? 'true' : undefined}
		/>
	</Field>
	<Field label="Zuführung zur Erhaltungsrücklage in €" error={errors?.reserveContribution}>
		<input
			name="reserveContribution"
			inputmode="decimal"
			defaultValue={value(
				'reserveContribution',
				statement ? formatCentsPlain(statement.reserveContribution) : ''
			)}
			aria-invalid={errors?.reserveContribution ? 'true' : undefined}
		/>
	</Field>
	<Field
		label="Hausgeld laut Wirtschaftsplan in €"
		error={errors?.feesDue}
		hint="Die Vorauszahlungen des Jahres, die du hättest zahlen sollen (Soll)."
	>
		<input
			name="feesDue"
			inputmode="decimal"
			defaultValue={value('feesDue', statement ? formatCentsPlain(statement.feesDue) : '')}
			aria-invalid={errors?.feesDue ? 'true' : undefined}
		/>
	</Field>
	<Field
		label="Ergebnis laut Verwalter in € (optional)"
		error={errors?.statedBalance}
		hint="Die Abrechnungsspitze: Kosten abzüglich Hausgeld laut Wirtschaftsplan."
	>
		<input
			name="statedBalance"
			inputmode="decimal"
			defaultValue={money('statedBalance', statement?.statedBalance)}
			aria-invalid={errors?.statedBalance ? 'true' : undefined}
		/>
	</Field>
	<Field label="Ergebnis ist" error={errors?.balanceKind}>
		<select name="balanceKind">
			<option value="due" selected={balanceKind === 'due'}>Nachzahlung</option>
			<option value="credit" selected={balanceKind === 'credit'}>Guthaben</option>
		</select>
	</Field>
	<div class="form-wide">
		<Field label="Notiz (optional)" error={errors?.note}>
			<textarea name="note" defaultValue={value('note', statement?.note ?? '')}></textarea>
		</Field>
	</div>
	<div class="form-actions">
		<button type="submit">{submitLabel}</button>
	</div>
</form>
