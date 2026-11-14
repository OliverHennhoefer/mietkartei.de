<script lang="ts">
	import Badge from '#lib/components/Badge.svelte';
	import CreateButton from '#lib/components/CreateButton.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDate, today } from '#lib/dates.ts';
	import { RETENTION_MONTHS } from '#lib/domain/applicants.ts';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const open = $derived(data.lettings.filter((letting) => !letting.closedAt));
	const closed = $derived(data.lettings.filter((letting) => letting.closedAt));
	const viewer = $derived(data.role === 'viewer');

	/** "3 Interessenten, 1 in engerer Wahl". */
	function summary(letting: (typeof data.lettings)[number]): string {
		if (letting.total === 0) return 'noch keine Interessenten';
		const parts = [pluralize(letting.total, 'Interessent', 'Interessenten')];
		if (letting.counts.shortlisted) parts.push(`${letting.counts.shortlisted} in engerer Wahl`);
		if (letting.counts.applied) {
			parts.push(
				`${pluralize(letting.counts.applied, 'Selbstauskunft', 'Selbstauskünfte')} zu prüfen`
			);
		}
		return parts.join(', ');
	}
</script>

<PageHeader
	title="Neuvermietung"
	lead="Interessenten für freie Wohnungen sammeln, ihre Selbstauskunft einholen, vergleichen und den neuen Mieter mit einem Klick übernehmen."
>
	{#snippet actions()}
		{#if !viewer}<CreateButton href="/vermietung/neu" label="Neuvermietung anlegen" />{/if}
	{/snippet}
</PageHeader>

{#if data.suggestions.length > 0 && !viewer}
	<h2>Bald frei</h2>
	<div class="table-wrap">
		<table class="table" aria-label="Bald frei">
			<thead>
				<tr>
					<th>Einheit</th>
					<th>Objekt</th>
					<th>Frei ab</th>
					<th class="action"><span class="visually-hidden">Aktion</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.suggestions as suggestion (suggestion.unit.id)}
					<tr>
						<td>
							<a href="/objekte/{suggestion.property.id}/einheiten/{suggestion.unit.id}"
								>{suggestion.unit.name}</a
							>
						</td>
						<td>{suggestion.property.name}</td>
						<td>
							{#if suggestion.freeFrom && suggestion.freeFrom > today()}{formatDate(
									suggestion.freeFrom
								)}{:else}<Badge tone="warning">Leerstand</Badge>{/if}
						</td>
						<td class="action">
							<a class="button secondary small" href="/vermietung/neu?unitId={suggestion.unit.id}"
								>Neuvermietung anlegen</a
							>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Laufend</h2>
{#if open.length === 0}
	<EmptyState
		title="Keine laufende Neuvermietung"
		text="Lege eine Neuvermietung an, sobald eine Einheit frei wird. Interessenten, ihre Selbstauskunft und die vorgelegten Nachweise sammelst du dann dort."
	/>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Laufende Neuvermietungen">
			<thead>
				<tr>
					<th>Einheit</th>
					<th>Frei ab</th>
					<th class="num">Kaltmiete</th>
					<th>Interessenten</th>
				</tr>
			</thead>
			<tbody>
				{#each open as letting (letting.id)}
					<tr>
						<td>
							<a href="/vermietung/{letting.id}">{letting.unit.name}</a>
							<span class="muted">· {letting.property.name}</span>
						</td>
						<td>{letting.availableFrom ? formatDate(letting.availableFrom) : 'nach Absprache'}</td>
						<td class="num"><Money cents={letting.baseRent} /></td>
						<td>{summary(letting)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if closed.length > 0}
	<h2>Abgeschlossen</h2>
	<p class="muted">
		Abgeschlossene Neuvermietungen werden {RETENTION_MONTHS} Monate nach dem Abschluss mit allen Interessenten
		und Selbstauskünften gelöscht.
	</p>
	<div class="table-wrap">
		<table class="table" aria-label="Abgeschlossene Neuvermietungen">
			<thead>
				<tr>
					<th>Einheit</th>
					<th>Abgeschlossen</th>
					<th>Ergebnis</th>
					<th>Wird gelöscht am</th>
				</tr>
			</thead>
			<tbody>
				{#each closed as letting (letting.id)}
					<tr>
						<td>
							<a href="/vermietung/{letting.id}">{letting.unit.name}</a>
							<span class="muted">· {letting.property.name}</span>
						</td>
						<td>{formatDate(letting.closedAt!)}</td>
						<td>
							{#if letting.counts.accepted}<Badge tone="success">Vermietet</Badge>{:else}<Badge
									>Ohne Zusage beendet</Badge
								>{/if}
						</td>
						<td>{formatDate(letting.deletesOn!)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
