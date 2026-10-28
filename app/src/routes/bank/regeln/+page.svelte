<script lang="ts">
	import { enhance } from '$app/forms';
	import Badge from '#lib/components/Badge.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import { matchingFieldIds, matchingFieldLabels } from '#lib/domain/bank-matching.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// A refused edit belongs to the edit dialog, everything else to the create form.
	const editRefused = $derived(form && 'edit' in form ? form : undefined);
	const errors = $derived(form && 'errors' in form && !editRefused ? form.errors : undefined);
	const values = $derived(form && 'values' in form && !editRefused ? form.values : undefined);
	const editValues = $derived(
		editRefused?.values ??
			(data.editing && {
				leaseId: data.editing.leaseId,
				field: data.editing.field,
				pattern: data.editing.pattern,
				confirmed: data.editing.confirmed ? 'on' : ''
			})
	);
	const leaseLabels = $derived(new Map(data.leases.map((lease) => [lease.id, lease.label])));
</script>

<!-- The heading and the tab bar come from +layout.svelte; this page is the "Regeln" tab. -->
<h2 class="visually-hidden">Zuordnungsregeln</h2>
<p class="muted">
	Regeln gelten in der Reihenfolge, in der sie angelegt wurden; die erste passende gewinnt.
	Bestätigte Regeln ordnen eingehende Umsätze beim Import automatisch zu, unbestätigte machen nur
	einen Vorschlag. Ausgaben werden nie automatisch zugeordnet.
</p>
<p class="muted">
	Wenn du einen Umsatz als Miete einem Mietvertrag zuordnest, merkt sich Mietkartei die IBAN (ohne
	IBAN den Namen) als bestätigte Regel. Ordnest du einen Umsatz, zu dem eine Regel passt, einem
	anderen Mietvertrag zu, wird die Regel wieder zum Vorschlag – so landet Geld von einem Zahler für
	mehrere Mietverträge (etwa dem Jobcenter) nicht automatisch beim falschen.
</p>

{#if data.rules.length === 0}
	<EmptyState
		title="Noch keine Zuordnungsregeln"
		text="Lege eine Regel an oder ordne einen Umsatz als Miete zu; die Zuordnung wird dann gemerkt."
	/>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Zuordnungsregeln">
			<thead>
				<tr>
					<th>Mietvertrag</th>
					<th>Feld</th>
					<th>Enthält</th>
					<th>Status</th>
					<th class="actions"><span class="visually-hidden">Aktionen</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.rules as rule (rule.id)}
					<tr>
						<td>
							<a href="?bearbeiten={rule.id}" data-sveltekit-reset="false"
								>{leaseLabels.get(rule.leaseId) ?? 'Unbekannter Mietvertrag'}</a
							>
						</td>
						<td>{matchingFieldLabels[rule.field]}</td>
						<td>{rule.pattern}</td>
						<td>
							{#if rule.confirmed}
								<Badge tone="success">bestätigt</Badge>
							{:else}
								<Badge tone="warning">Vorschlag</Badge>
							{/if}
						</td>
						<td class="actions">
							{#if !rule.confirmed}
								<form method="POST" action="?/confirm" class="inline" use:enhance>
									<input type="hidden" name="id" value={rule.id} />
									<button type="submit" class="secondary small">Bestätigen</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Regel anlegen</h2>
{#if data.leases.length === 0}
	<EmptyState title="Noch kein Mietvertrag" text="Eine Regel ordnet einem Mietvertrag zu.">
		<a href="/vertraege/neu">Mietvertrag anlegen</a>
	</EmptyState>
{:else}
	<form method="POST" action="?/create" class="card" use:enhance>
		{@render ruleFields(values, errors)}
		<div class="form-actions form-wide">
			<button type="submit">Regel anlegen</button>
		</div>
		{#if form && 'created' in form}
			<p class="form-actions form-wide" role="status">Die Regel wurde angelegt.</p>
		{/if}
	</form>
{/if}

{#snippet ruleFields(
	values: Record<string, string> | undefined,
	errors: Partial<Record<string, string>> | undefined
)}
	<Field label="Mietvertrag" error={errors?.leaseId}>
		<select name="leaseId" aria-invalid={errors?.leaseId ? 'true' : undefined} required>
			{#each data.leases as lease (lease.id)}
				<option value={lease.id} selected={values?.leaseId === lease.id}>{lease.label}</option>
			{/each}
		</select>
	</Field>
	<Field label="Feld" error={errors?.field}>
		<select name="field" aria-invalid={errors?.field ? 'true' : undefined} required>
			{#each matchingFieldIds as field (field)}
				<option value={field} selected={(values?.field ?? 'counterpartIban') === field}>
					{matchingFieldLabels[field]}
				</option>
			{/each}
		</select>
	</Field>
	<Field label="Enthält" error={errors?.pattern} hint="Groß- und Kleinschreibung ist egal.">
		<input
			name="pattern"
			defaultValue={values?.pattern ?? ''}
			placeholder="z. B. DE12 5001 0517 5407 3249 31 oder Müller"
			aria-invalid={errors?.pattern ? 'true' : undefined}
			required
		/>
	</Field>
	<label class="inline form-wide">
		<input type="checkbox" name="confirmed" checked={values ? values.confirmed === 'on' : true} />
		Bestätigt: beim Import automatisch zuordnen
	</label>
{/snippet}

{#if data.editing && editValues}
	{#key data.editing.id}
		<EditDialog
			title="Regel bearbeiten"
			action="?/update"
			deleteAction="?/delete"
			deleteMessage="Regel „{matchingFieldLabels[data.editing.field]} enthält {data.editing
				.pattern}“ löschen?"
			close="/bank/regeln"
		>
			<input type="hidden" name="id" value={data.editing.id} />
			{@render ruleFields(editValues, editRefused?.errors)}
		</EditDialog>
	{/key}
{/if}

<style>
	.inline {
		display: inline;
		margin-right: 0.5rem;
	}
</style>
