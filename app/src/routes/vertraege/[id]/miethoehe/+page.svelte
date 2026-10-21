<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
	import { formatDate, formatMonth, isIsoDate } from '#lib/dates.ts';
	import { effectiveFrom, formatIndexValue, formatPercent } from '#lib/domain/index-rent.ts';
	import { rentOn, total } from '#lib/domain/rents.ts';
	import { rentChangeReasonLabels, rentModelLabels } from '#lib/labels.ts';
	import { formatCents, formatCentsPlain, parseCents } from '#lib/money.ts';
	import type { PageProps } from './$types';

	// The "Miethöhe" tab under /vertraege/[id]: the heading and tab bar come from the layout.
	let { data, form }: PageProps = $props();

	const lease = $derived(data.lease);
	const current = $derived(rentOn(data.changes, data.today));
	const pending = $derived(data.changes.find((change) => change.status === 'proposed'));
	// § 557a Abs. 2 / § 557b Abs. 2 BGB: no § 558 increase on a residential Staffel or index rent.
	const restricted = $derived(lease.kind === 'residential' && lease.rentModel !== 'fixed');

	// Every action answers with its source, so each form shows only its own errors and values.
	type FieldErrors = Partial<Record<string, string>>;
	const errorsFor = (source: string): FieldErrors | undefined =>
		form?.source === source && 'errors' in form ? (form.errors as FieldErrors) : undefined;
	const valuesFor = (source: string): Record<string, string> | undefined =>
		form?.source === source && 'values' in form ? form.values : undefined;
	const refusalFor = (source: string) =>
		form?.source === source && 'refusal' in form ? form.refusal : undefined;
	const savedFor = (source: string) => form?.source === source && 'saved' in form;

	const changeErrors = $derived(errorsFor('change'));
	const changeValues = $derived(valuesFor('change'));
	const stepErrors = $derived(errorsFor('step'));
	const stepValues = $derived(valuesFor('step'));
	const approveErrors = $derived(errorsFor('approve'));

	// The approval form: the effective date follows the delivery date (§ 557b Abs. 3 BGB).
	let deliveredOn = $state(untrack(() => data.today));
	let chosenFrom = $state(untrack(() => effectiveFrom(data.today)));
	const approvalFrom = $derived(
		lease.kind === 'residential'
			? isIsoDate(deliveredOn)
				? effectiveFrom(deliveredOn)
				: undefined
			: isIsoDate(chosenFrom)
				? chosenFrom
				: undefined
	);
	const approvalMessage = $derived(
		pending && approvalFrom
			? `Kaltmiete ${formatCents(pending.baseRent)} ab ${formatDate(approvalFrom)} freigeben? ` +
					`Das Schreiben gilt als am ${formatDate(deliveredOn)} zugestellt.`
			: 'Erhöhung freigeben?'
	);

	const steps = $derived(data.changes.filter((change) => change.reason === 'graduated'));

	// The Staffel form confirms with the new Kaltmiete and its first day; both are typed in.
	let stepFrom = $state(untrack(() => stepValues?.validFrom ?? data.nextStepAllowed ?? ''));
	let stepRent = $state(untrack(() => stepValues?.baseRent ?? ''));
	const stepMessage = $derived.by(() => {
		const rent = parseCents(stepRent);
		return isIsoDate(stepFrom) && rent !== undefined
			? `Staffel ab ${formatDate(stepFrom)} mit Kaltmiete ${formatCents(rent)} anlegen? Die Sollstellungen werden neu berechnet.`
			: 'Staffel anlegen? Die Sollstellungen werden neu berechnet.';
	});
	const situation = $derived(data.situation);

	/** An approved change stays while a later index or Staffel change builds on it. */
	function deletable(change: (typeof data.changes)[number]): boolean {
		if (change.reason === 'initial') return false;
		if (change.status === 'proposed') return true;
		return !data.changes.some(
			(other) =>
				other.status === 'approved' &&
				other.validFrom > change.validFrom &&
				(other.reason === 'indexed' || other.reason === 'graduated')
		);
	}

	function deleteMessage(change: (typeof data.changes)[number]): string {
		return change.status === 'proposed'
			? `Vorschlag vom ${formatDate(change.validFrom)} löschen?`
			: `Mietänderung ab ${formatDate(change.validFrom)} löschen? Die Sollstellungen werden neu berechnet.`;
	}
</script>

{#snippet notice(source: string, saved: string)}
	{#if refusalFor(source)}
		<Alert tone="danger"><p>{refusalFor(source)}</p></Alert>
	{:else if savedFor(source)}
		<Alert tone="success"><p>{saved}</p></Alert>
	{/if}
{/snippet}

<h2>Mietänderungen</h2>
{@render notice('delete', 'Die Mietänderung wurde gelöscht.')}
<div class="table-wrap">
	<table class="table" aria-label="Mietänderungen">
		<thead>
			<tr>
				<th>Gültig ab</th>
				<th class="num">Kaltmiete</th>
				<th class="num">Betriebskosten</th>
				<th class="num">Heizkosten</th>
				<th class="num">Gesamtmiete</th>
				<th>Grund</th>
				<th>Status</th>
				<th>Index</th>
				<th>Notiz</th>
				<th class="actions"></th>
			</tr>
		</thead>
		<tbody>
			{#each data.changes as change (change.id)}
				<tr>
					<td>
						{formatDate(change.validFrom)}
						{#if change === current}<Badge tone="info">Aktuell</Badge>{/if}
					</td>
					<td class="num"><Money cents={change.baseRent} /></td>
					<td class="num"><Money cents={change.operatingCostPrepayment} /></td>
					<td class="num"><Money cents={change.heatingCostPrepayment} /></td>
					<td class="num"><Money cents={total(change)} /></td>
					<td>{rentChangeReasonLabels[change.reason]}</td>
					<td>
						{#if change.status === 'approved'}
							<Badge tone="success">Freigegeben</Badge>
						{:else}
							<Badge tone="warning">Vorschlag</Badge>
						{/if}
					</td>
					<td>
						{#if change.indexMonth && change.indexValue !== null}
							{formatIndexValue(change.indexValue)} ({formatMonth(change.indexMonth)})
						{/if}
					</td>
					<td class="note">{change.note ?? ''}</td>
					<td class="actions">
						{#if change.letterText}
							<a href="/vertraege/{lease.id}/miethoehe/brief/{change.id}">Brief</a>
						{/if}
						{#if deletable(change)}
							<ConfirmButton action="?/delete" label="Löschen" message={deleteMessage(change)}>
								<input type="hidden" name="changeId" value={change.id} />
							</ConfirmButton>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="muted small">
	Vorauszahlungen für Betriebs- und Heizkosten je Monat. Eine Änderung gilt auch für spätere
	Einträge, die den bisherigen Betrag übernommen hatten: Eine Anpassung der Vorauszahlungen gilt
	also auch nach einer schon angelegten Staffel. Die Miete bei Vertragsbeginn änderst du unter
	<a href="/vertraege/{lease.id}/bearbeiten">Mietvertrag bearbeiten</a>.
</p>

{#if lease.rentModel === 'indexed'}
	<h2>Indexmiete</h2>
	{@render notice('propose', 'Der Vorschlag wurde gespeichert. Gib ihn unten frei.')}
	{@render notice(
		'approve',
		'Die Erhöhung wurde freigegeben; das Schreiben steht als Brief bereit.'
	)}
	<dl class="details">
		<dt>Bezugsindex</dt>
		<dd>
			{#if situation.reference}
				{formatIndexValue(situation.reference.value)} ({formatMonth(situation.reference.month)})
			{:else}
				nicht hinterlegt
			{/if}
		</dd>
		<dt>Aktueller VPI</dt>
		<dd>
			{#if situation.latest.ok}
				{formatIndexValue(situation.latest.latest.value)} ({formatMonth(
					situation.latest.latest.month
				)}, Basisjahr {situation.latest.latest.baseYear})
			{:else if situation.latest.reason === 'none'}
				keine Werte eingetragen
			{:else}
				mehrere Basisjahre ({situation.latest.baseYears.join(', ')})
			{/if}
			· <a href="/einstellungen/vpi">VPI-Werte</a>
		</dd>
		{#if lease.kind === 'residential'}
			<dt>Wartefrist</dt>
			<dd>
				{#if !situation.waitingUntil}
					keine
				{:else if situation.waitingUntil <= situation.provisionalFrom}
					abgelaufen (ein Jahr seit der letzten Änderung, § 557b Abs. 2 BGB)
				{:else}
					bis {formatDate(situation.waitingUntil)} (§ 557b Abs. 2 BGB)
				{/if}
			</dd>
		{/if}
		{#if situation.proposal && current}
			<dt>Rechnung</dt>
			<dd>
				{formatCents(current.baseRent)} × {formatIndexValue(situation.proposal.latest.value)} ÷ {formatIndexValue(
					situation.proposal.reference.value
				)} = <strong>{formatCents(situation.proposal.newBaseRent)}</strong>
				({formatPercent(situation.proposal.percent)}, {situation.proposal.increase >= 0
					? '+'
					: ''}{formatCents(situation.proposal.increase)})
			</dd>
		{/if}
	</dl>

	{#if pending}
		<div class="card stack proposal">
			<p>
				<strong>Vorschlag:</strong> Kaltmiete <Money cents={pending.baseRent} />
				{#if current}statt <Money cents={current.baseRent} />{/if}
				{#if pending.indexMonth && pending.indexValue !== null}
					nach dem Index {formatIndexValue(pending.indexValue)} ({formatMonth(pending.indexMonth)}).
				{/if}
			</p>
			{#if !data.landlordComplete}
				<Alert tone="warning">
					<p>
						Der Absender für das Schreiben ist unvollständig.
						<a href="/einstellungen/profil">Vermieterdaten ergänzen</a>
					</p>
				</Alert>
			{/if}
			<ConfirmButton
				action="?/approve"
				label="Erhöhung freigeben"
				message={approvalMessage}
				tone="primary"
			>
				<input type="hidden" name="changeId" value={pending.id} />
				<div class="row approval">
					<Field label="Schreiben zugestellt am" error={approveErrors?.deliveredOn}>
						<input
							type="date"
							name="deliveredOn"
							bind:value={deliveredOn}
							aria-invalid={approveErrors?.deliveredOn ? 'true' : undefined}
							required
						/>
					</Field>
					{#if lease.kind === 'residential'}
						<p class="from">
							Gilt ab {approvalFrom ? formatDate(approvalFrom) : '–'} (§ 557b Abs. 3 BGB)
						</p>
					{:else}
						<Field label="Gilt ab" error={approveErrors?.validFrom}>
							<input
								type="date"
								name="validFrom"
								bind:value={chosenFrom}
								aria-invalid={approveErrors?.validFrom ? 'true' : undefined}
								required
							/>
						</Field>
					{/if}
				</div>
			</ConfirmButton>
		</div>
	{:else if situation.refusal}
		<Alert tone="info"><p>{situation.refusal}</p></Alert>
	{:else}
		<form method="POST" action="?/propose" use:enhance class="toolbar">
			<button type="submit">Erhöhung vorschlagen</button>
		</form>
	{/if}
{/if}

{#if lease.rentModel === 'graduated'}
	<h2>Staffelmiete</h2>
	{@render notice('step', 'Die Staffel wurde angelegt.')}
	<p class="muted">
		Jede Staffel gilt sofort.
		{#if lease.kind === 'residential'}
			Zwischen zwei Staffeln muss mindestens ein Jahr liegen (§ 557a Abs. 2 BGB){#if data.nextStepAllowed};
				die nächste Staffel kann frühestens am {formatDate(data.nextStepAllowed)} beginnen{/if}.
		{/if}
	</p>
	{#if steps.length === 0}
		<p>Noch keine Staffel angelegt.</p>
	{:else}
		<ul class="list" aria-label="Staffeln">
			{#each steps as step (step.id)}
				<li class="card">
					<span>ab {formatDate(step.validFrom)}</span>
					<span>Kaltmiete <Money cents={step.baseRent} /></span>
				</li>
			{/each}
		</ul>
	{/if}
	<ConfirmButton action="?/step" label="Staffel anlegen" message={stepMessage} tone="primary">
		<div class="card step-form">
			<Field label="Beginn der Staffel" error={stepErrors?.validFrom}>
				<input
					type="date"
					name="validFrom"
					bind:value={stepFrom}
					aria-invalid={stepErrors?.validFrom ? 'true' : undefined}
					required
				/>
			</Field>
			<Field label="Neue Kaltmiete" error={stepErrors?.baseRent}>
				<input
					name="baseRent"
					inputmode="decimal"
					bind:value={stepRent}
					aria-invalid={stepErrors?.baseRent ? 'true' : undefined}
					required
				/>
			</Field>
		</div>
	</ConfirmButton>
{/if}

<h2>Änderung ab Datum</h2>
{@render notice('change', 'Die Änderung wurde gespeichert.')}
{#if restricted}
	<Alert tone="warning">
		<p>
			Bei einer {rentModelLabels[lease.rentModel]} ist eine Mieterhöhung nach § 558 BGB ausgeschlossen
			({lease.rentModel === 'graduated' ? '§ 557a Abs. 2' : '§ 557b Abs. 2'} BGB). Eine Änderung der Kaltmiete
			braucht eine Begründung in der Notiz, etwa eine einvernehmliche Vereinbarung.
		</p>
	</Alert>
{/if}
<form method="POST" action="?/change" class="card" use:enhance>
	<Field label="Gültig ab" error={changeErrors?.validFrom}>
		<input
			type="date"
			name="validFrom"
			defaultValue={changeValues?.validFrom ?? data.changeFrom}
			aria-invalid={changeErrors?.validFrom ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Kaltmiete" error={changeErrors?.baseRent}>
		<input
			name="baseRent"
			inputmode="decimal"
			defaultValue={changeValues?.baseRent ?? formatCentsPlain(data.changeDefaults.baseRent)}
			aria-invalid={changeErrors?.baseRent ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Betriebskostenvorauszahlung" error={changeErrors?.operatingCostPrepayment}>
		<input
			name="operatingCostPrepayment"
			inputmode="decimal"
			defaultValue={changeValues?.operatingCostPrepayment ??
				formatCentsPlain(data.changeDefaults.operatingCostPrepayment)}
			aria-invalid={changeErrors?.operatingCostPrepayment ? 'true' : undefined}
		/>
	</Field>
	<Field label="Heizkostenvorauszahlung" error={changeErrors?.heatingCostPrepayment}>
		<input
			name="heatingCostPrepayment"
			inputmode="decimal"
			defaultValue={changeValues?.heatingCostPrepayment ??
				formatCentsPlain(data.changeDefaults.heatingCostPrepayment)}
			aria-invalid={changeErrors?.heatingCostPrepayment ? 'true' : undefined}
		/>
	</Field>
	<Field label="Grund" error={changeErrors?.reason}>
		<select name="reason" aria-invalid={changeErrors?.reason ? 'true' : undefined} required>
			{#each ['manual', 'statement'] as const as reason (reason)}
				<option value={reason} selected={(changeValues?.reason ?? 'manual') === reason}>
					{rentChangeReasonLabels[reason]}
				</option>
			{/each}
		</select>
	</Field>
	<div class="form-wide">
		<Field
			label="Notiz"
			error={changeErrors?.note}
			hint={restricted ? 'Pflicht, wenn sich die Kaltmiete ändert.' : undefined}
		>
			<textarea
				name="note"
				defaultValue={changeValues?.note ?? ''}
				aria-invalid={changeErrors?.note ? 'true' : undefined}></textarea>
		</Field>
	</div>
	<div class="form-actions">
		<button type="submit">Änderung speichern</button>
	</div>
</form>

<style>
	.note {
		max-width: 16rem;
		white-space: pre-line;
	}
	.actions :global(form) {
		margin-left: 0.5rem;
	}
	.proposal {
		margin: 1rem 0;
	}
	.approval {
		align-items: end;
		margin-bottom: 0.75rem;
	}
	.approval .from {
		margin: 0 0 0.5rem;
	}
	.step-form {
		display: grid;
		margin: 0 0 0.75rem;
	}
</style>
