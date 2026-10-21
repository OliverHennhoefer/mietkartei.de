<script lang="ts">
	import { formatCents, formatCentsSigned } from '../money';

	// An amount in cents, right-aligned in tables, coloured when `signed` (credit green, debt red).
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
		color: #14532d;
	}
	.negative {
		color: var(--color-error);
	}
</style>
