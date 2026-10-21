<script lang="ts">
	import { formatCents, formatCentsSigned } from '../money';

	// Signed amounts keep their sign; debts are the one place amounts turn red.
	let { cents, signed = false }: { cents: number; signed?: boolean } = $props();
</script>

<span class="money" class:positive={signed && cents > 0} class:negative={signed && cents < 0}>
	{signed ? formatCentsSigned(cents) : formatCents(cents)}
</span>

<style>
	.money {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.positive {
		color: var(--color-text);
	}
	.negative {
		color: var(--color-danger);
		font-weight: 600;
	}
</style>
