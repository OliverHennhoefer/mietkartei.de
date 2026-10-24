<script lang="ts">
	import { dayOf, formatDate } from '../dates';
	import { damageReportStatusLabels } from '../labels';
	import type { DamageReportStatus } from '../server/db/schema';
	import Badge from './Badge.svelte';

	// The damage reports of /schadensmeldungen and of a lease's Mieterportal tab, one card each.
	let {
		reports,
		label,
		showLease = true
	}: {
		reports: {
			id: string;
			title: string;
			location: string | null;
			urgent: boolean;
			status: DamageReportStatus;
			createdAt: Date;
			lease: { id: string; label: string } | null;
		}[];
		label: string;
		showLease?: boolean;
	} = $props();

	function tone(status: DamageReportStatus) {
		return status === 'done' ? 'success' : status === 'in_progress' ? 'info' : 'warning';
	}
</script>

<ul class="list" aria-label={label}>
	{#each reports as report (report.id)}
		<li class="card report">
			<div class="body">
				<a href="/schadensmeldungen/{report.id}"><strong>{report.title}</strong></a>
				<span class="muted">
					· {formatDate(dayOf(report.createdAt))}
					{#if report.location}· {report.location}{/if}
					{#if showLease && report.lease}
						· <a href="/vertraege/{report.lease.id}">{report.lease.label}</a>
					{/if}
				</span>
			</div>
			<div class="badges">
				{#if report.urgent && report.status !== 'done'}<Badge tone="danger">dringend</Badge>{/if}
				<Badge tone={tone(report.status)}>{damageReportStatusLabels[report.status]}</Badge>
			</div>
		</li>
	{/each}
</ul>

<style>
	.report {
		align-items: flex-start;
		flex-wrap: nowrap;
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.badges {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
</style>
