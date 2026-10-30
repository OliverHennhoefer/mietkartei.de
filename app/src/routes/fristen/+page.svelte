<script lang="ts">
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { daysBetween, formatDate } from '#lib/dates.ts';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const monthFormat = new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' });
	const utc = (date: string) => new Date(`${date}T00:00:00Z`);

	/** "heute", "morgen", "in 7 Tagen", "in 3 Monaten" or "überfällig seit 2 Tagen". */
	function relative(date: string): string {
		const days = daysBetween(data.today, date);
		if (days < 0) return `überfällig seit ${pluralize(-days, 'Tag', 'Tagen')}`;
		if (days === 0) return 'heute';
		if (days === 1) return 'morgen';
		if (days < 60) return `in ${pluralize(days, 'Tag', 'Tagen')}`;
		return `in ${pluralize(Math.round(days / 30), 'Monat', 'Monaten')}`;
	}
	/** Due within two weeks: marked in neon. */
	const soon = (date: string) => daysBetween(data.today, date) <= 14;
</script>

<PageHeader title="Fristen" />

{#if data.deadlines.length === 0}
	<p class="muted">In den nächsten zwölf Monaten steht keine Frist an.</p>
{:else}
	<ul class="deadlines" aria-label="Fristen">
		{#each data.deadlines as deadline, index (index)}
			<li class="card deadline" class:overdue={deadline.overdue}>
				<span class="leaf" class:soon={!deadline.overdue && soon(deadline.date)} aria-hidden="true">
					<span class="month">{monthFormat.format(utc(deadline.date)).replace('.', '')}</span>
					<span class="day">{Number(deadline.date.slice(8))}</span>
				</span>
				<span class="body">
					<a href={deadline.href}><strong>{deadline.title}</strong></a>
					{#if deadline.detail}<span class="muted small">{deadline.detail}</span>{/if}
				</span>
				<span class="due">
					<span class="relative">{relative(deadline.date)}</span>
					<span class="muted">{formatDate(deadline.date)}</span>
				</span>
			</li>
		{/each}
	</ul>
{/if}

<style>
	/* When it is due: relative and in neon within two weeks, red once overdue, the date below. */
	.due {
		display: grid;
		justify-items: end;
		text-align: right;
		white-space: nowrap;
		line-height: 1.35;
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.due .relative {
		font-size: var(--text-base);
		font-weight: 600;
	}
	.overdue .due .relative {
		color: var(--color-danger);
	}
	.deadlines {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	/* The whole card leads to where the deadline is handled. */
	.deadline {
		position: relative;
		display: flex;
		align-items: center;
		gap: 1.1rem;
		padding: 0.85rem 1.25rem;
	}
	.deadline:hover {
		border-color: var(--color-text);
	}
	.deadline a {
		text-decoration: none;
	}
	.deadline a::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.deadline .body {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.1rem;
	}
	.deadline .due .relative {
		font-weight: 400;
		color: var(--color-muted);
	}
	.deadline.overdue .due .relative {
		font-weight: 600;
		color: var(--color-danger);
	}
	/* A calendar leaf: the month on the dark strip, neon when it is near, red when overdue. */
	.leaf {
		flex-shrink: 0;
		display: grid;
		width: 3.1rem;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		text-align: center;
		line-height: 1.1;
	}
	.leaf .month {
		padding: 0.2rem 0;
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		background: var(--color-accent);
		color: var(--color-accent-text);
	}
	.leaf .day {
		padding: 0.3rem 0 0.35rem;
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: -0.04em;
		font-variant-numeric: tabular-nums;
	}
	.leaf.soon .month {
		background: var(--color-highlight);
		color: var(--color-highlight-text);
	}
	.overdue .leaf .month {
		background: var(--color-danger);
		color: var(--color-background);
	}
	@media (max-width: 40rem) {
		.deadline {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: 1rem;
			align-items: flex-start;
			padding: 0.75rem 1rem;
		}
		.deadline .due {
			grid-column: 2;
			display: flex;
			gap: 0.5rem;
			margin-top: 0.3rem;
		}
	}
</style>
