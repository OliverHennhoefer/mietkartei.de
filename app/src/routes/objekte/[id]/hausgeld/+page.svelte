<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import AssociationStatementForm from '#lib/components/AssociationStatementForm.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate, today } from '#lib/dates.ts';
	import { balanceText } from '#lib/domain/association.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The Hausgeldabrechnung most often entered is last year's.
	const defaultYear = Number(today().slice(0, 4)) - 1;
	const year = (start: string) => start.slice(0, 4);
</script>

<!-- The heading and tab bar come from the layout; this page is the "Hausgeld" tab. -->
<h2 class="visually-hidden">Hausgeldabrechnungen</h2>
<p class="muted">
	Die Hausgeldabrechnung des Verwalters mit dem Anteil der Wohnung: umlagefähige und nicht
	umlagefähige Kosten, die Zuführung zur Erhaltungsrücklage und das Hausgeld laut Wirtschaftsplan.
	mietkartei gleicht sie mit dem gezahlten Hausgeld ab, also deinen Ausgaben der Kategorie „Hausgeld
	(WEG)“, und mit den Belegen, die du mit den Zahlen der WEG für die Nebenkostenabrechnung erfasst
	hast.
</p>

{#if data.statements.length === 0}
	<p>Für dieses Objekt ist noch keine Hausgeldabrechnung erfasst.</p>
{:else}
	<ul class="list" aria-label="Hausgeldabrechnungen">
		{#each data.statements as statement (statement.id)}
			<li class="card statement">
				<div>
					<a href="/objekte/{data.property.id}/hausgeld/{statement.id}">
						<strong
							>Wirtschaftsjahr {formatDate(statement.periodStart)} – {formatDate(
								statement.periodEnd
							)}</strong
						>
					</a>
				</div>
				<dl class="details">
					<dt>Umlagefähige Kosten</dt>
					<dd>
						<Money cents={statement.allocableCosts} />
						<span class="muted small">
							· als Belege erfasst <Money cents={statement.allocableRecorded} /> ·
							<a
								href="/betriebskosten/belege?property={data.property.id}&year={year(
									statement.periodStart
								)}">Belege</a
							>
						</span>
					</dd>
					<dt>Nicht umlagefähige Kosten</dt>
					<dd><Money cents={statement.nonAllocableCosts} /></dd>
					<dt>Zuführung zur Rücklage</dt>
					<dd><Money cents={statement.reserveContribution} /></dd>
					<dt>Kosten gesamt</dt>
					<dd><Money cents={statement.costsTotal} /></dd>
					{#if statement.reserveWithdrawal}
						<dt>Entnahme aus der Rücklage</dt>
						<dd><Money cents={statement.reserveWithdrawal} /></dd>
					{/if}
					<dt>Hausgeld laut Wirtschaftsplan</dt>
					<dd><Money cents={statement.feesDue} /></dd>
					<dt>Abrechnungsspitze</dt>
					<dd>
						{balanceText(statement.statedBalance ?? statement.computedBalance)}
						<span class="muted small"
							>{statement.statedBalance === null ? '(errechnet)' : '(laut Verwalter)'}</span
						>
					</dd>
					<dt>Hausgeld gezahlt</dt>
					<dd>
						<Money cents={statement.feesPaid} />
						<span class="muted small">
							· <a href="/auswertung/ausgaben">Ausgaben</a>
						</span>
					</dd>
					<dt>Mit dem gezahlten Hausgeld</dt>
					<dd>{balanceText(statement.settlement)}</dd>
				</dl>
				{#each statement.findings as finding (finding.code)}
					<Alert tone="warning"><p>{finding.message}</p></Alert>
				{/each}
			</li>
		{/each}
	</ul>
{/if}

<h2 id="hausgeldabrechnung-erfassen">Hausgeldabrechnung erfassen</h2>
<AssociationStatementForm
	action="?/create"
	submitLabel="Hausgeldabrechnung erfassen"
	{defaultYear}
	errors={form?.errors}
	values={form?.values}
/>

<style>
	.statement {
		flex-direction: column;
		align-items: stretch;
	}
</style>
