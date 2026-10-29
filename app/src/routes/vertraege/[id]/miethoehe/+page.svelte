<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import Field from '#lib/components/Field.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PreviewLink from '#lib/components/PreviewLink.svelte';
	import Money from '#lib/components/Money.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { formatDate, formatMonth, isIsoDate } from '#lib/dates.ts';
	import {
		cappingPercents,
		comparativeEffectiveFrom,
		consentDeadline,
		lawsuitDeadline,
		perSquareMetre
	} from '#lib/domain/comparative-rent.ts';
	import { effectiveFrom, formatIndexValue, formatPercent } from '#lib/domain/index-rent.ts';
	import { formatArea } from '#lib/format.ts';
	import { rentOn, total } from '#lib/domain/rents.ts';
	import { comparisonSourceLabels, rentChangeReasonLabels, rentModelLabels } from '#lib/labels.ts';
	import { formatCents, formatCentsPlain, parseCents } from '#lib/money.ts';
	import { byDate, byNumber, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	// The "Miethöhe" tab under /vertraege/[id]: the heading and tab bar come from the layout.
	let { data, form }: PageProps = $props();

	const lease = $derived(data.lease);
	const current = $derived(rentOn(data.changes, data.today));
	const pending = $derived(data.changes.find((change) => change.status === 'proposed'));
	// § 557a Abs. 2 / § 557b Abs. 2 BGB: no § 558 increase on a residential Staffel or index rent.
	const restricted = $derived(lease.kind === 'residential' && lease.rentModel !== 'fixed');
	/** Opened from a statement's "Vorauszahlung anpassen" (§ 560 Abs. 4 BGB). */
	const fromStatement = $derived(data.prepayment !== null || data.heatingPrepayment !== null);
	const sort = new TableSort<PageProps['data']['changes'][number]>({
		validFrom: byDate((change) => change.validFrom),
		baseRent: byNumber((change) => change.baseRent),
		operating: byNumber((change) => change.operatingCostPrepayment),
		heating: byNumber((change) => change.heatingCostPrepayment),
		total: byNumber((change) => total(change)),
		reason: byText((change) => rentChangeReasonLabels[change.reason]),
		index: byNumber((change) => (change.indexMonth ? change.indexValue : null)),
		note: byText((change) => change.note)
	});

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

	// § 558: the demand form shows when the new rent would be due and until when the tenant may
	// consent, from the day it reaches the tenant.
	const comparative = $derived(data.comparative);
	const comparable = $derived(lease.kind === 'residential' && lease.rentModel === 'fixed');
	const floorArea = $derived(lease.unit.floorArea);
	const demanded = $derived(
		data.changes.find((change) => change.status === 'proposed' && change.reason === 'comparative')
	);
	const demandErrors = $derived(errorsFor('demand'));
	const demandValues = $derived(valuesFor('demand'));
	const consentErrors = $derived(errorsFor('consent'));
	const consentValues = $derived(valuesFor('consent'));
	let demandDeliveredOn = $state(untrack(() => demandValues?.deliveredOn ?? data.today));
	let demandSource = $state(
		untrack(() => demandValues?.comparisonSource ?? ('rent_index' as string))
	);
	const demandDue = $derived(
		isIsoDate(demandDeliveredOn)
			? comparativeEffectiveFrom(demandDeliveredOn, comparative.lastChange)
			: undefined
	);
	const sourceHints: Record<string, string> = {
		rent_index:
			'Name und Stand des Mietspiegels, das Feld der Wohnung und die Spanne, z. B. „Berliner Mietspiegel 2026, Feld H3, Spanne 7,80 – 10,20 € je m²“. Bei einem qualifizierten Mietspiegel müssen seine Werte im Schreiben stehen.',
		rent_database: 'Die Mietdatenbank und die Auskunft, auf die du dich stützt.',
		expert_opinion: 'Der Sachverständige und das Datum des Gutachtens; leg es dem Schreiben bei.',
		comparable_flats:
			'Mindestens drei vergleichbare Wohnungen mit Adresse, Lage im Haus, Größe und Miete je m².'
	};

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

	// ?bearbeiten=<id> opens a change that may be deleted in its dialog.
	const editing = $derived(
		data.changes.find(
			(change) => change.id === page.url.searchParams.get('bearbeiten') && deletable(change)
		)
	);

	// An approved index change keeps its letter's delivery date open to correction: the letter is
	// made at the approval, so the day it really reached the tenant may be known only later.
	const correctable = (change: (typeof data.changes)[number]) =>
		change.status === 'approved' && change.reason === 'indexed';
	const deliveryErrors = $derived(errorsFor('delivery'));
	const deliveryValues = $derived(valuesFor('delivery'));

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
<div class="table-wrap">
	<table class="table" aria-label="Mietänderungen">
		<thead>
			<tr>
				<SortHeader {sort} key="validFrom">Gültig ab</SortHeader>
				<SortHeader {sort} key="baseRent" class="num">Kaltmiete</SortHeader>
				<SortHeader {sort} key="operating" class="num">Betriebskosten</SortHeader>
				<SortHeader {sort} key="heating" class="num">Heizkosten</SortHeader>
				<SortHeader {sort} key="total" class="num">Gesamtmiete</SortHeader>
				<SortHeader {sort} key="reason">Grund</SortHeader>
				<SortHeader {sort} key="index">Index</SortHeader>
				<SortHeader {sort} key="note">Notiz</SortHeader>
				<th class="actions"></th>
			</tr>
		</thead>
		<tbody>
			{#each sort.rows(data.changes) as change (change.id)}
				<tr>
					<td>
						{#if deletable(change)}
							<a href="?bearbeiten={change.id}" data-sveltekit-reset="false"
								>{formatDate(change.validFrom)}</a
							>
						{:else}
							{formatDate(change.validFrom)}
						{/if}
						{#if change === current}<Badge tone="info">Aktuell</Badge>{/if}
						{#if change.status !== 'approved'}<Badge tone="warning">Vorschlag</Badge>{/if}
					</td>
					<td class="num"><Money cents={change.baseRent} /></td>
					<td class="num"><Money cents={change.operatingCostPrepayment} /></td>
					<td class="num"><Money cents={change.heatingCostPrepayment} /></td>
					<td class="num"><Money cents={total(change)} /></td>
					<td>{rentChangeReasonLabels[change.reason]}</td>
					<td>
						{#if change.indexMonth && change.indexValue !== null}
							{formatIndexValue(change.indexValue)}
							<span class="muted small nowrap">{formatMonth(change.indexMonth)}</span>
						{/if}
					</td>
					<td class="note">{change.note ?? ''}</td>
					<td class="actions">
						<div class="row-actions">
							{#if change.letterText}
								<PreviewLink
									href="/vertraege/{lease.id}/miethoehe/brief/{change.id}"
									text="/vertraege/{lease.id}/miethoehe/brief/{change.id}/text"
									title="Mieterhöhung zum {formatDate(change.validFrom)}"
									class="button secondary small"><Icon name="file" size={14} /> Brief</PreviewLink
								>
							{/if}
						</div>
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
			{:else}
				noch keine Werte
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
		{#if situation.proposal}
			<dt>Rechnung</dt>
			<dd>
				{formatCents(situation.proposal.currentBaseRent)} × {formatIndexValue(
					situation.proposal.latest.value
				)} ÷ {formatIndexValue(situation.proposal.reference.value)} =
				<strong>{formatCents(situation.proposal.newBaseRent)}</strong>
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
					<Field
						label="Zugang beim Mieter am"
						error={approveErrors?.deliveredOn}
						hint="Voraussichtlich; kommt das Schreiben an einem anderen Tag an, korrigierst du den Zugang danach in der Mietänderung."
					>
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
	<ConfirmButton action="?/step" label="Staffel anlegen" message={stepMessage} tone="primary" card>
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
	</ConfirmButton>
{/if}

{#if comparable}
	<h2>Mieterhöhung auf die Vergleichsmiete</h2>
	{@render notice(
		'demand',
		'Das Erhöhungsverlangen wurde gespeichert; das Schreiben steht oben als Brief bereit.'
	)}
	{@render notice(
		'consent',
		'Die Zustimmung wurde eingetragen; die neue Miete steht im Mietkonto.'
	)}
	<p class="muted">
		Nach § 558 BGB kannst du verlangen, dass der Mieter einer höheren Kaltmiete bis zur ortsüblichen
		Vergleichsmiete zustimmt. Die Miete muss dafür 15 Monate unverändert sein, und sie darf in drei
		Jahren höchstens um die Kappungsgrenze steigen.
	</p>
	<dl class="details">
		{#if comparative.currentBaseRent !== undefined}
			<dt>Kaltmiete</dt>
			<dd>
				<Money cents={comparative.currentBaseRent} />
				{#if floorArea}
					({formatCents(perSquareMetre(comparative.currentBaseRent, floorArea))} je m² bei {formatArea(
						floorArea
					)})
				{/if}
			</dd>
		{/if}
		{#if comparative.lastChange && comparative.demandFrom}
			<dt>Letzte Erhöhung</dt>
			<dd>
				{formatDate(comparative.lastChange)}; ein neues Verlangen ist ab dem {formatDate(
					comparative.demandFrom
				)} möglich (§ 558 Abs. 1 BGB)
			</dd>
		{/if}
		{#if comparative.caps && comparative.capBase !== undefined}
			<dt>Kappungsgrenze</dt>
			<dd>
				höchstens <Money cents={comparative.caps[20]} /> (20 %) oder <Money
					cents={comparative.caps[15]}
				/> (15 %), ausgehend von <Money cents={comparative.capBase} /> drei Jahre vor dem {formatDate(
					comparative.validFrom
				)}
			</dd>
		{/if}
	</dl>

	{#if demanded}
		<div class="card stack proposal">
			<p>
				<strong>Verlangt:</strong> Kaltmiete <Money cents={demanded.baseRent} />
				{#if comparative.currentBaseRent !== undefined}statt <Money
						cents={comparative.currentBaseRent}
					/>{/if}
				ab {formatDate(demanded.validFrom)}.
				{#if demanded.deliveredOn}
					Zugegangen am {formatDate(demanded.deliveredOn)}; der Mieter kann bis zum {formatDate(
						consentDeadline(demanded.deliveredOn)
					)} zustimmen. Ohne Zustimmung kannst du bis zum {formatDate(
						lawsuitDeadline(demanded.deliveredOn)
					)} auf Zustimmung klagen (§ 558b Abs. 2 BGB).
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
			<form method="POST" action="?/consent" use:enhance class="row approval">
				<input type="hidden" name="changeId" value={demanded.id} />
				<Field label="Zugestimmt am" error={consentErrors?.consentedOn}>
					<input
						type="date"
						name="consentedOn"
						defaultValue={consentValues?.consentedOn ?? data.today}
						aria-invalid={consentErrors?.consentedOn ? 'true' : undefined}
						required
					/>
				</Field>
				<Field
					label="Vereinbarte Kaltmiete"
					error={consentErrors?.baseRent}
					hint="Bei einer Teilzustimmung der niedrigere Betrag."
				>
					<input
						name="baseRent"
						inputmode="decimal"
						defaultValue={consentValues?.baseRent ?? formatCentsPlain(demanded.baseRent)}
						aria-invalid={consentErrors?.baseRent ? 'true' : undefined}
						required
					/>
				</Field>
				<button type="submit">Zustimmung eintragen</button>
			</form>
			<p class="muted small">
				Stimmt der Mieter nicht zu oder ziehst du das Verlangen zurück, lösche es in der Tabelle
				oben.
			</p>
		</div>
	{:else if comparative.refusal}
		<Alert tone="info"><p>{comparative.refusal}</p></Alert>
	{:else}
		<form method="POST" action="?/demand" class="card form" use:enhance>
			<Field
				label="Zugang beim Mieter am"
				error={demandErrors?.deliveredOn}
				hint={demandDue && isIsoDate(demandDeliveredOn)
					? `Neue Miete ab ${formatDate(demandDue)}, Zustimmung bis ${formatDate(consentDeadline(demandDeliveredOn))}.`
					: undefined}
			>
				<input
					type="date"
					name="deliveredOn"
					bind:value={demandDeliveredOn}
					aria-invalid={demandErrors?.deliveredOn ? 'true' : undefined}
					required
				/>
			</Field>
			<Field label="Neue Kaltmiete" error={demandErrors?.baseRent}>
				<input
					name="baseRent"
					inputmode="decimal"
					defaultValue={demandValues?.baseRent ?? ''}
					aria-invalid={demandErrors?.baseRent ? 'true' : undefined}
					required
				/>
			</Field>
			<Field label="Ortsübliche Vergleichsmiete je m²" error={demandErrors?.comparativeRent}>
				<input
					name="comparativeRent"
					inputmode="decimal"
					defaultValue={demandValues?.comparativeRent ?? ''}
					aria-invalid={demandErrors?.comparativeRent ? 'true' : undefined}
					required
				/>
			</Field>
			<Field
				label="Kappungsgrenze"
				error={demandErrors?.cappingPercent}
				hint="15 % in Gemeinden, die eine Verordnung des Landes nennt."
			>
				<select
					name="cappingPercent"
					aria-invalid={demandErrors?.cappingPercent ? 'true' : undefined}
				>
					{#each cappingPercents as percent (percent)}
						<option
							value={String(percent)}
							selected={(demandValues?.cappingPercent ?? '20') === String(percent)}
							>{percent} %</option
						>
					{/each}
				</select>
			</Field>
			<Field label="Begründung" error={demandErrors?.comparisonSource}>
				<select
					name="comparisonSource"
					bind:value={demandSource}
					aria-invalid={demandErrors?.comparisonSource ? 'true' : undefined}
				>
					{#each Object.entries(comparisonSourceLabels) as [source, label] (source)}
						<option value={source}>{label}</option>
					{/each}
				</select>
			</Field>
			<div class="form-wide">
				<Field
					label="Angaben zur Begründung"
					error={demandErrors?.comparisonDetails}
					hint={sourceHints[demandSource]}
				>
					<textarea
						name="comparisonDetails"
						defaultValue={demandValues?.comparisonDetails ?? ''}
						aria-invalid={demandErrors?.comparisonDetails ? 'true' : undefined}
						required></textarea>
				</Field>
			</div>
			{#if refusalFor('demand')}
				<div class="form-wide"><Alert tone="danger"><p>{refusalFor('demand')}</p></Alert></div>
			{/if}
			<div class="form-actions">
				<button type="submit">Erhöhung verlangen</button>
			</div>
		</form>
	{/if}
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
				<option
					value={reason}
					selected={(changeValues?.reason ?? (fromStatement ? 'statement' : 'manual')) === reason}
				>
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

{#if editing}
	{#key editing.id}
		<EditDialog
			title={editing.status === 'proposed'
				? `Vorschlag ab ${formatDate(editing.validFrom)}`
				: `Mietänderung ab ${formatDate(editing.validFrom)}`}
			action={correctable(editing) ? '?/delivery' : undefined}
			deleteAction="?/delete"
			deleteMessage={deleteMessage(editing)}
			close="/vertraege/{lease.id}/miethoehe"
			error={refusalFor('delete') ?? refusalFor('delivery')}
		>
			<input type="hidden" name="changeId" value={editing.id} />
			<dl class="details">
				<dt>Grund</dt>
				<dd>{rentChangeReasonLabels[editing.reason]}</dd>
				<dt>Kaltmiete</dt>
				<dd><Money cents={editing.baseRent} /></dd>
				<dt>Betriebskosten</dt>
				<dd><Money cents={editing.operatingCostPrepayment} /></dd>
				<dt>Heizkosten</dt>
				<dd><Money cents={editing.heatingCostPrepayment} /></dd>
				<dt>Gesamtmiete</dt>
				<dd><Money cents={total(editing)} /></dd>
				{#if editing.note}
					<dt>Notiz</dt>
					<dd>{editing.note}</dd>
				{/if}
			</dl>
			{#if correctable(editing)}
				<Field
					label="Zugang beim Mieter am"
					error={deliveryErrors?.deliveredOn}
					hint={lease.kind === 'residential'
						? 'Die neue Miete gilt ab dem Beginn des übernächsten Monats (§ 557b Abs. 3 BGB). Ändert sich dieser Tag, wird der Brief neu erstellt und die Sollstellungen werden neu berechnet.'
						: undefined}
				>
					<input
						type="date"
						name="deliveredOn"
						defaultValue={deliveryValues?.deliveredOn ?? editing.deliveredOn ?? ''}
						aria-invalid={deliveryErrors?.deliveredOn ? 'true' : undefined}
						required
					/>
				</Field>
				<p class="muted small">
					Die Beträge ändern sich nicht. Für andere Beträge lösche die Änderung und lege sie neu an.
				</p>
			{:else}
				<p class="muted small">
					Ändern lässt sich eine Mietänderung nicht. Lösche sie und lege sie unten neu an; die
					Sollstellungen werden neu berechnet.
				</p>
			{/if}
		</EditDialog>
	{/key}
{/if}

<style>
	.nowrap {
		display: block;
		white-space: nowrap;
	}
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
</style>
