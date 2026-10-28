<script lang="ts">
	import Badge from '#lib/components/Badge.svelte';
	import InsurancePolicyForm from '#lib/components/InsurancePolicyForm.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate } from '#lib/dates.ts';
	import { insuranceKindLabels } from '#lib/labels.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const receiptHref = (policyId: string, start: string) =>
		`/betriebskosten/belege/neu?versicherung=${policyId}&von=${start}`;
</script>

<!-- The heading and tab bar come from the layout; this page is the "Versicherungen" tab. -->
<h2 class="visually-hidden">Versicherungen</h2>
<p class="muted">
	Mit Hauptfälligkeit und Kündigungsfrist erscheint die Frist zum Kündigen unter Aufgaben. Den
	Beitrag eines Versicherungsjahres kannst du als Beleg übernehmen; die Abrechnung verteilt ihn
	taggenau auf die Kalenderjahre. Sach- und Haftpflichtversicherungen sind umlagefähig (§ 2 Nr. 13
	BetrKV), Mietausfall- und Rechtsschutzversicherung nicht.
</p>

{#if data.policies.length === 0}
	<p>Für dieses Objekt ist noch keine Versicherung erfasst.</p>
{:else}
	<ul class="list" aria-label="Versicherungen">
		{#each data.policies as policy (policy.id)}
			<li class="card policy">
				<div>
					<a href="/objekte/{data.property.id}/versicherungen/{policy.id}">
						<strong>{insuranceKindLabels[policy.kind]}</strong>
					</a>
					{#if policy.endDate}<Badge tone="warning"
							>gekündigt zum {formatDate(policy.endDate)}</Badge
						>{/if}
					<span class="muted">
						· {policy.insurer}{policy.policyNumber ? ` (${policy.policyNumber})` : ''} ·
						<Money cents={policy.annualPremium} /> im Jahr · Hauptfälligkeit {formatDate(
							policy.renewalDate
						).slice(0, 6)}
					</span>
				</div>
				{#if policy.years.length > 0}
					<ul class="years" aria-label="Belege zu {insuranceKindLabels[policy.kind]}">
						{#each policy.years as year (year.start)}
							<li>
								{formatDate(year.start)} bis {formatDate(year.end)}: <Money cents={year.amount} />
								{#if year.costItemId}
									<a href="/betriebskosten/belege/{year.costItemId}">Beleg erfasst</a>
								{:else}
									<a href={receiptHref(policy.id, year.start)}>als Beleg erfassen</a>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<h2 id="versicherung-anlegen">Versicherung anlegen</h2>
<InsurancePolicyForm
	action="?/create"
	submitLabel="Versicherung anlegen"
	errors={form?.errors}
	values={form?.values}
/>

<style>
	.policy {
		flex-direction: column;
		align-items: flex-start;
	}
	.years {
		margin: 0;
		padding-left: 1.25rem;
		font-size: var(--text-base);
	}
</style>
