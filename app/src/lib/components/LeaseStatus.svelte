<script lang="ts">
	// A lease's status as a dot and a word: a filled green dot while it runs, a dashed ring before
	// it starts, a grey ring once it has ended. Quieter than a pill, so a list of ended leases
	// does not shout.
	let { status }: { status: 'active' | 'upcoming' | 'ended' } = $props();

	const labels = { active: 'Aktiv', upcoming: 'Beginnt später', ended: 'Beendet' };
</script>

<span class="lease-status {status}">{labels[status]}</span>

<style>
	.lease-status {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.lease-status::before {
		content: '';
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
	}
	.active {
		color: var(--color-success);
		font-weight: 500;
	}
	.active::before {
		background: var(--color-success);
		box-shadow: 0 0 0 3px var(--color-success-subtle);
	}
	.upcoming::before {
		border: 1.5px dashed currentColor;
	}
	.ended {
		color: var(--color-muted);
	}
	.ended::before {
		border: 1.5px solid currentColor;
	}
</style>
