<script lang="ts">
	import CreateButton from '#lib/components/CreateButton.svelte';
	import { enhance } from '$app/forms';
	import Badge from '#lib/components/Badge.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { matchingFieldIds, matchingFieldLabels } from '#lib/domain/bank-matching.ts';
	import { bySeverity, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// A refused edit belongs to the edit dialog, everything else to the create form.
	const editRefused = $derived(form && 'edit' in form ? form : undefined);
	const errors = $derived(form && 'errors' in form && !editRefused ? form.errors : undefined);
	const values = $derived(form && 'values' in form && !editRefused ? form.values : undefined);
	const editValues = $derived(
		editRefused?.values ??
			(data.editing && {
				name: data.editing.name ?? '',
				target: data.editing.leaseId
					? `lease:${data.editing.leaseId}`
					: `contra:${data.editing.contraAccountId}`,
				field: data.editing.field,
				pattern: data.editing.pattern,
				confirmed: data.editing.confirmed ? 'on' : ''
			})
	);
	const leaseLabels = $derived(new Map(data.leases.map((lease) => [lease.id, lease.label])));
	type Rule = PageProps['data']['rules'][number];

	/** Where the rule books: „Miete · EG links – Müller“ or „Gegenkonto 4403 Wasser/Müll“. */
	function targetLabel(rule: Rule): string {
		if (rule.leaseId) {
			return `Miete · ${leaseLabels.get(rule.leaseId) ?? 'Unbekannter Mietvertrag'}`;
		}
		const contra = rule.contraAccountId ? data.contraLabels[rule.contraAccountId] : undefined;
		return `Gegenkonto ${contra ?? 'unbekannt'}`;
	}

	/** Rules from before names show where they book instead. */
	const nameOf = (rule: Rule) => rule.name || targetLabel(rule);

	const sort = new TableSort<Rule>({
		name: byText(nameOf),
		lease: byText(targetLabel),
		field: byText((rule) => matchingFieldLabels[rule.field]),
		pattern: byText((rule) => rule.pattern),
		status: bySeverity((rule) => (rule.confirmed ? 0 : 1))
	});
</script>

<!-- The heading and the tab bar come from +layout.svelte; this page is the "Regeln" tab. -->
<h2 class="visually-hidden">Zuordnungsregeln</h2>
<p class="muted">
	Regeln gelten in der Reihenfolge, in der sie angelegt wurden; die erste passende gewinnt.
	Bestätigte Regeln buchen Umsätze beim Import automatisch, unbestätigte machen nur einen Vorschlag.
	Eine Regel auf einen Mietvertrag bucht nur eingehende Umsätze, eine Regel auf ein Gegenkonto (etwa
	„4403 Stadtwerke“) beide Richtungen.
</p>
<p class="muted">
	Wenn du einen Umsatz als Miete einem Mietvertrag zuordnest oder auf ein Gegenkonto buchst, merkt
	sich Mietkartei die IBAN (ohne IBAN den Namen) als bestätigte Regel. Buchst du einen Umsatz, zu
	dem eine Regel passt, woandershin, wird die Regel wieder zum Vorschlag – so landet Geld von einem
	Zahler für mehrere Mietverträge (etwa dem Jobcenter) nicht automatisch beim falschen.
</p>

{#if data.rules.length === 0}
	<EmptyState
		title="Noch keine Zuordnungsregeln"
		text="Lege eine Regel an, ordne einen Umsatz als Miete zu oder buche ihn auf ein Gegenkonto; die Zuordnung wird dann gemerkt."
	/>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Zuordnungsregeln">
			<thead>
				<tr>
					<SortHeader {sort} key="name">Name</SortHeader>
					<SortHeader {sort} key="lease">Bucht auf</SortHeader>
					<SortHeader {sort} key="field">Feld</SortHeader>
					<SortHeader {sort} key="pattern">Enthält</SortHeader>
					<SortHeader {sort} key="status">Status</SortHeader>
					<th class="actions"><span class="visually-hidden">Aktionen</span></th>
				</tr>
			</thead>
			<tbody>
				{#each sort.rows(data.rules) as rule (rule.id)}
					<tr>
						<td>
							<a href="?bearbeiten={rule.id}" data-sveltekit-reset="false">{nameOf(rule)}</a>
						</td>
						<td>{targetLabel(rule)}</td>
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

<h2 id="regel-anlegen">Regel anlegen</h2>
{#if data.leases.length === 0 && data.contraAccounts.length === 0}
	<EmptyState
		title="Noch kein Mietvertrag"
		text="Eine Regel ordnet einem Mietvertrag oder einem Gegenkonto zu."
	>
		<CreateButton href="/vertraege/neu" label="Mietvertrag anlegen" />
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
	<Field label="Name" error={errors?.name} hint="Woran du die Regel erkennst.">
		<input
			name="name"
			maxlength="100"
			defaultValue={values?.name ?? ''}
			placeholder="z. B. Miete Müller oder Stadtwerke"
			aria-invalid={errors?.name ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Bucht auf" error={errors?.target}>
		<select name="target" aria-invalid={errors?.target ? 'true' : undefined} required>
			{#if data.leases.length}
				<optgroup label="Miete an Mietvertrag">
					{#each data.leases as lease (lease.id)}
						<option value="lease:{lease.id}" selected={values?.target === `lease:${lease.id}`}>
							{lease.label}
						</option>
					{/each}
				</optgroup>
			{/if}
			{#if data.contraAccounts.length}
				<optgroup label="Gegenkonto">
					{#each data.contraAccounts as account (account.id)}
						<option
							value="contra:{account.id}"
							selected={values?.target === `contra:${account.id}`}
						>
							{account.label}
						</option>
					{/each}
				</optgroup>
			{/if}
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
			deleteMessage="Regel „{data.editing.name ||
				`${matchingFieldLabels[data.editing.field]} enthält ${data.editing.pattern}`}“ löschen?"
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
