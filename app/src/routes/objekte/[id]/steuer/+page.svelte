<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Field from '#lib/components/Field.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Money from '#lib/components/Money.svelte';
	import PreviewLink from '#lib/components/PreviewLink.svelte';
	import { FORM_YEAR, type TaxLine } from '#lib/domain/tax.ts';
	import { formatNumber } from '#lib/format.ts';
	import type { FieldErrors } from '#lib/forms/fields.ts';
	import type { LoanInterestForm } from '#lib/forms/tax.ts';
	import type { DepreciationInput } from '#lib/server/tax.ts';
	import { formatCentsPlain } from '#lib/money.ts';
	import { unitKindLabels } from '#lib/units.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const tax = $derived(data.tax);
	const property = $derived(data.property);
	const query = $derived(`?jahr=${data.year}`);
	// The errors of the form that was sent; the other form shows none.
	const depreciationErrors = $derived(
		form?.form === 'depreciation' ? (form.errors as FieldErrors<DepreciationInput>) : undefined
	);
	const depreciationValues = $derived(form?.form === 'depreciation' ? form.values : undefined);
	const interestErrors = $derived(
		form?.form === 'interest' ? (form.errors as FieldErrors<LoanInterestForm>) : undefined
	);
	const interestValues = $derived(form?.form === 'interest' ? form.values : undefined);

	const value = (values: Record<string, string> | undefined, name: string, fallback: string) =>
		values?.[name] ?? fallback;
	const decimal = (number: number | null) => (number === null ? '' : formatNumber(number));
	/** The line's own label repeats when one entry carries the whole line. */
	const showEntries = (line: TaxLine) =>
		line.entries.length > 1 || line.entries[0]?.label !== line.label;
</script>

<!-- The heading and tab bar come from the layout; this page is the "Steuer" tab. -->
<form method="GET" class="toolbar filters">
	<label class="inline">
		Jahr
		<select name="jahr" onchange={(event) => event.currentTarget.form?.requestSubmit()}>
			{#each tax.years as year (year)}
				<option value={String(year)} selected={data.year === year}>{year}</option>
			{/each}
		</select>
	</label>
	<noscript><button type="submit" class="secondary small">Anzeigen</button></noscript>
	<PreviewLink
		class="button secondary small"
		href="/objekte/{property.id}/steuer/pdf{query}"
		title="Steuerübersicht {property.name} {data.year}"
		><Icon name="file" size={14} /> PDF</PreviewLink
	>
	<a class="button secondary small" href="/objekte/{property.id}/steuer/csv{query}" download
		><Icon name="download" size={14} /> CSV</a
	>
</form>

<Alert role="note">
	<p>
		Die Steuerübersicht hilft dir beim Ausfüllen der Anlage V und beim Gespräch mit deinem
		Steuerberater. Sie ist keine Steuerberatung und kennt nur, was in mietkartei gebucht ist.
		Einnahmen und Ausgaben zählen in dem Jahr, in dem das Geld geflossen ist. Die Zeilen folgen dem
		Vordruck {FORM_YEAR}; in anderen Jahren können die Nummern abweichen.
	</p>
</Alert>

{#each tax.findings as finding (finding.code)}
	<Alert tone="warning"><p>{finding.message}</p></Alert>
{/each}

<dl class="card details" aria-label="Ergebnis {data.year}">
	<dt>Summe der Einnahmen (Zeile 32)</dt>
	<dd><Money cents={tax.incomeTotal} /></dd>
	<dt>Summe der Werbungskosten (Zeile 83)</dt>
	<dd><Money cents={tax.costsTotal} /></dd>
	<dt>{tax.result < 0 ? 'Verlust' : 'Überschuss'} (Zeile 85)</dt>
	<dd><strong><Money cents={tax.result} signed /></strong></dd>
</dl>

{#snippet lineTable(title: string, lines: TaxLine[], totalLabel: string, total: number)}
	<section aria-label={title}>
		<h2>{title}</h2>
		{#if lines.length === 0}
			<p class="muted">Für {data.year} ist nichts gebucht.</p>
		{:else}
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Zeile</th>
							<th>Bezeichnung</th>
							<th class="number">Betrag</th>
						</tr>
					</thead>
					<tbody>
						{#each lines as line (line.key)}
							<tr>
								<td>{line.line}</td>
								<td>
									{line.label}
									{#if showEntries(line)}
										<ul class="entries muted small">
											{#each line.entries as entry (entry.label)}
												<li>{entry.label}: <Money cents={entry.amount} /></li>
											{/each}
										</ul>
									{/if}
								</td>
								<td class="number"><Money cents={line.amount} /></td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td></td>
							<th scope="row">{totalLabel}</th>
							<td class="number"><strong><Money cents={total} /></strong></td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</section>
{/snippet}

{@render lineTable('Einnahmen', tax.income, 'Summe der Einnahmen', tax.incomeTotal)}
{@render lineTable('Werbungskosten', tax.costs, 'Summe der Werbungskosten', tax.costsTotal)}

{#if tax.nonDeductible.length > 0}
	<section aria-labelledby="non-deductible">
		<h2 id="non-deductible">Gebucht, aber nicht sofort abziehbar</h2>
		<dl class="card details">
			{#each tax.nonDeductible as item (item.label)}
				<dt>{item.label}</dt>
				<dd><Money cents={item.amount} /> <span class="muted small">· {item.reason}</span></dd>
			{/each}
		</dl>
	</section>
{/if}

{#if tax.leases.length > 0}
	<section aria-labelledby="leases">
		<h2 id="leases">Einnahmen je Mietvertrag</h2>
		<p class="muted">
			Was {data.year} eingegangen ist, aufgeteilt wie die Sollstellungen der Monate {data.year}:
			Kaltmiete, Vorauszahlungen und Ergebnisse von Betriebskostenabrechnungen.
		</p>
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Mietvertrag</th>
						<th class="number">Soll</th>
						<th class="number">Eingang</th>
						<th class="number">Kaltmiete</th>
						<th class="number">Umlagen</th>
						<th class="number">Abrechnung und Sonstiges</th>
					</tr>
				</thead>
				<tbody>
					{#each tax.leases as lease (lease.leaseId)}
						<tr>
							<td>
								<a href="/vertraege/{lease.leaseId}/mietkonto">{lease.label}</a>
								<span class="muted small">· {unitKindLabels[lease.unitKind]}</span>
								{#if lease.prorated}<span class="muted small"> · anteilig aufgeteilt</span>{/if}
							</td>
							<td class="number"><Money cents={lease.charged} /></td>
							<td class="number"><Money cents={lease.received} /></td>
							<td class="number"><Money cents={lease.baseRent} /></td>
							<td class="number"><Money cents={lease.prepayments} /></td>
							<td class="number"><Money cents={lease.settlements + lease.other} /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

<section aria-labelledby="depreciation">
	<h2 id="depreciation">Abschreibung (AfA)</h2>
	{#if tax.depreciation}
		<p>
			Gebäudeanteil <Money cents={tax.depreciation.base} />, {formatNumber(
				property.depreciationRate ?? 0
			)} % im Jahr = <Money cents={tax.depreciation.yearly} />. {data.year}
			{tax.depreciation.months === 12 ? 'volles Jahr' : `${tax.depreciation.months} Monate`}:
			<Money cents={tax.depreciation.amount} />, danach noch <Money
				cents={tax.depreciation.remaining}
			/> abzuschreiben.
		</p>
	{/if}
	<form method="POST" action="?/depreciation" class="card" use:enhance>
		<input type="hidden" name="year" value={data.year} />
		<Field
			label="Kaufdatum"
			error={depreciationErrors?.acquisitionDate}
			hint="Übergang von Nutzen und Lasten laut Kaufvertrag."
		>
			<input
				type="date"
				name="acquisitionDate"
				defaultValue={value(depreciationValues, 'acquisitionDate', property.acquisitionDate ?? '')}
				aria-invalid={depreciationErrors?.acquisitionDate ? 'true' : undefined}
			/>
		</Field>
		<Field
			label="Anschaffungskosten in €"
			error={depreciationErrors?.acquisitionCost}
			hint="Kaufpreis plus Nebenkosten wie Grunderwerbsteuer, Notar, Grundbuch und Makler."
		>
			<input
				name="acquisitionCost"
				inputmode="decimal"
				defaultValue={value(
					depreciationValues,
					'acquisitionCost',
					property.acquisitionCost === null ? '' : formatCentsPlain(property.acquisitionCost)
				)}
				aria-invalid={depreciationErrors?.acquisitionCost ? 'true' : undefined}
			/>
		</Field>
		<Field
			label="Gebäudeanteil in %"
			error={depreciationErrors?.buildingShare}
			hint="Der Rest ist Grund und Boden und wird nicht abgeschrieben. Die Arbeitshilfe des BMF hilft bei der Aufteilung."
		>
			<input
				name="buildingShare"
				inputmode="decimal"
				defaultValue={value(depreciationValues, 'buildingShare', decimal(property.buildingShare))}
				aria-invalid={depreciationErrors?.buildingShare ? 'true' : undefined}
			/>
		</Field>
		<Field
			label="AfA-Satz in % im Jahr"
			error={depreciationErrors?.depreciationRate}
			hint="Meist 2 %, für vor 1925 fertiggestellte Gebäude 2,5 %, für ab 2023 fertiggestellte 3 %."
		>
			<input
				name="depreciationRate"
				inputmode="decimal"
				defaultValue={value(
					depreciationValues,
					'depreciationRate',
					decimal(property.depreciationRate)
				)}
				aria-invalid={depreciationErrors?.depreciationRate ? 'true' : undefined}
			/>
		</Field>
		<div class="form-actions">
			<button type="submit">AfA speichern</button>
		</div>
	</form>
</section>

<section aria-labelledby="interest">
	<h2 id="interest">Schuldzinsen {data.year}</h2>
	<p class="muted">
		Eine Darlehensrate enthält Zinsen und Tilgung, abziehbar sind nur die Zinsen. Buche die Raten
		als „Darlehensrate (Zins und Tilgung)“ und trag hier die Zinsen des Jahres aus der
		Zinsbescheinigung deiner Bank ein. Bucht deine Bank Zinsen und Tilgung getrennt ab, nimm
		stattdessen die Kategorien „Darlehenszinsen“ und „Tilgung“.
	</p>
	<form method="POST" action="?/interest" class="card" use:enhance>
		<input type="hidden" name="year" value={data.year} />
		<Field
			label="Zinsen {data.year} laut Zinsbescheinigung in €"
			error={interestErrors?.loanInterest ?? interestErrors?.year}
			hint="Leer lassen, wenn es keine gibt."
		>
			<input
				name="loanInterest"
				inputmode="decimal"
				defaultValue={value(
					interestValues,
					'loanInterest',
					tax.loanInterest === null ? '' : formatCentsPlain(tax.loanInterest)
				)}
				aria-invalid={interestErrors?.loanInterest ? 'true' : undefined}
			/>
		</Field>
		<div class="form-actions">
			<button type="submit">Zinsen speichern</button>
		</div>
	</form>
</section>

{#if property.kind === 'condominium'}
	<p class="muted">
		Das Hausgeld zählt ohne die Zuführung zur Erhaltungsrücklage; was der Verwalter aus der Rücklage
		für Erhaltung ausgegeben hat, zählt dafür im Jahr der Ausgabe. Beides kommt aus der
		<a href="/objekte/{property.id}/hausgeld">Hausgeldabrechnung</a>.
	</p>
{/if}

<style>
	.entries {
		margin: 0.25rem 0 0;
		padding-left: 1rem;
	}
</style>
