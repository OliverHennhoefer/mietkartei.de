<script lang="ts">
	import { formatCents } from '../money';

	// A Mietkonto balance from the tenant's side, like a bank account: a Guthaben `+12,00 €` in green,
	// a Rückstand `−12,00 €` in red. The sign carries the meaning and the colour only backs it up;
	// the word is spelled out for screen readers, or shown with `label`.
	let {
		cents,
		overdue = true,
		label = false,
		tone = true
	}: {
		/** The ledger balance: charged − paid, so positive = owed, negative = Guthaben. */
		cents: number;
		/** Whether an owed balance is due; one that is not stays out of the red. */
		overdue?: boolean;
		label?: boolean;
		/** False for a running balance, where colour on every line would be noise. */
		tone?: boolean;
	} = $props();

	const kind = $derived(cents < 0 ? 'credit' : cents > 0 ? (overdue ? 'arrears' : 'open') : 'even');
	const words = {
		credit: 'Guthaben',
		arrears: 'Rückstand',
		open: 'offen',
		even: 'ausgeglichen'
	};
	const text = $derived(
		cents < 0 ? `+${formatCents(-cents)}` : cents > 0 ? `−${formatCents(cents)}` : formatCents(0)
	);
</script>

<span class="balance {tone ? kind : ''}"
	><span class="amount">{text}</span>
	<span class={label ? 'word' : 'sr-only'}>{words[kind]}</span></span
>

<style>
	.balance {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.credit .amount {
		color: var(--color-success);
	}
	.arrears .amount {
		color: var(--color-danger);
		font-weight: 600;
	}
	.word {
		color: var(--color-muted);
		font-size: 0.85em;
		font-weight: 400;
	}
</style>
