<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Badge from '#lib/components/Badge.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import TaskFields from '#lib/components/TaskFields.svelte';
	import { dayOf, daysBetween, formatDate } from '#lib/dates.ts';
	import { pluralize } from '#lib/format.ts';
	import { linkValue } from '#lib/forms/tasks.ts';
	import { taskCategoryLabels } from '#lib/labels.ts';
	import { repeatLabel, taskTemplates } from '#lib/task-templates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// A refused edit belongs to the edit dialog, everything else to the create dialog.
	const editRefused = $derived(form && 'edit' in form ? form : undefined);
	const errors = $derived(form && 'errors' in form && !editRefused ? form.errors : undefined);
	const values = $derived((!editRefused && form?.values) || data.template || {});
	// After a refused save the typed values win; otherwise the dialog shows the task as stored.
	const editValues = $derived.by(() => {
		const task = data.editing;
		if (editRefused?.values) return editRefused.values;
		if (!task) return {};
		return {
			title: task.title,
			category: task.category,
			dueDate: task.dueDate ?? '',
			repeatMonths: task.repeatMonths ? String(task.repeatMonths) : '',
			link: task.propertyId
				? linkValue('property', task.propertyId)
				: task.leaseId
					? linkValue('lease', task.leaseId)
					: '',
			note: task.note ?? ''
		};
	});

	// The create form opens in a dialog: from the header's link, from a template (?vorlage=, which
	// keeps it open) and stays open when the server refuses the input. A page loaded with ?neu, a
	// template or refused input renders it open on the server, so it works without JavaScript too,
	// and makes it modal once mounted.
	let dialog = $state<HTMLDialogElement>();
	let created = $state<string>();
	const requested = $derived(
		page.url.searchParams.has('neu') || Boolean(data.template) || Boolean(errors)
	);
	onMount(() => {
		if (!requested || !dialog) return;
		if (dialog.open) dialog.close();
		dialog.showModal();
	});

	function openDialog(event: MouseEvent) {
		event.preventDefault();
		created = undefined;
		dialog?.showModal();
	}

	/** Drops ?neu and ?vorlage=, so a reload does not open the dialog again. */
	function closed() {
		if (page.url.search) goto(resolve('/aufgaben'), { replace: true, reset: false });
	}
	const nextDeadline = $derived(data.deadlines[0]);

	const weekdayFormat = new Intl.DateTimeFormat('de-DE', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
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

	// The setup checklist, in the order the data depends on each other; each step leads to the
	// page that creates what it asks for.
	const steps = $derived(
		data.firstRun
			? [
					{ done: data.firstRun.properties, href: '/objekte/neu', label: 'Objekt anlegen' },
					{
						done: data.firstRun.units,
						href: data.firstRun.firstPropertyId
							? `/objekte/${data.firstRun.firstPropertyId}`
							: '/objekte/neu',
						label: 'Einheit anlegen'
					},
					{ done: data.firstRun.tenants, href: '/mieter/neu', label: 'Mieter anlegen' },
					{
						done: data.firstRun.leases,
						href: '/vertraege/neu',
						label: 'Mietvertrag mit Miete und Kaution anlegen'
					},
					{
						done: data.firstRun.bankAccounts,
						href: '/bank/konten',
						label: 'Bankverbindung für den Umsatzabgleich anlegen'
					},
					{
						done: data.firstRun.categories,
						href: '/betriebskosten/kostenarten',
						label: 'Kostenarten und Umlageschlüssel prüfen'
					}
				]
			: []
	);
</script>

<PageHeader title="Aufgaben">
	{#snippet actions()}
		<a class="button" href="?neu" onclick={openDialog}
			><Icon name="plus" size={16} />Aufgabe anlegen</a
		>
	{/snippet}
</PageHeader>

{#if data.firstRun}
	<section class="card first-run" aria-labelledby="first-run">
		<h2 id="first-run">Erste Schritte</h2>
		{#if !data.firstRun.properties}
			<p class="muted">
				Dein Bestand ist noch leer. So fängst du an{#if data.role === 'owner'}, oder du probierst
					mietkartei erst mit <a href="/einstellungen/konto">Demodaten</a> aus{/if}. Hast du die
				Daten schon in einer Tabelle, nimmt die
				<a href="/einstellungen/datenuebernahme">Datenübernahme</a> sie dir ab.
			</p>
		{:else}
			<p class="muted">
				Sobald ein Mietvertrag und eine Bankverbindung angelegt sind, siehst du hier Rückstände und
				offene Bankumsätze. Hast du die Daten in einer Tabelle, nimmt die
				<a href="/einstellungen/datenuebernahme">Datenübernahme</a> sie dir ab.
			</p>
		{/if}
		<ol class="steps">
			{#each steps as step (step.label)}
				<li class:done={step.done}>
					<a href={step.href}>{step.label}</a>
					{#if step.done}<span class="muted">erledigt</span>{/if}
				</li>
			{/each}
		</ol>
		<p class="muted ai-hint">
			Tipp: Verbinde <a href="/einstellungen/ki-assistenten">Claude oder ChatGPT</a> mit mietkartei und
			frag dann einfach nach Rückständen, Fristen oder Abrechnungen.
		</p>
	</section>
{/if}

<!-- Once the first steps are done: the figures that need attention and the next deadline. -->
{#if !data.firstRun}
	<section class="stats overview" aria-label="Überblick">
		<p class="stats-kicker">{weekdayFormat.format(utc(data.today))}</p>
		<a class="stat" href="#offene-aufgaben">
			<span class="value">{data.open.length}</span>
			<span class="label">{data.open.length === 1 ? 'offene Aufgabe' : 'offene Aufgaben'}</span>
		</a>
		<a class="stat" href="/mietkonto?filter=rueckstaende">
			<span class="value"><Money cents={data.attention.arrearsTotal} /></span>
			<span class="label"
				>{data.attention.arrearsCount > 0
					? `Rückstände bei ${pluralize(data.attention.arrearsCount, 'Mietvertrag', 'Mietverträgen')}`
					: 'keine Rückstände'}</span
			>
		</a>
		<a class="stat" href="/bank">
			<span class="value">{data.attention.unmatched}</span>
			<span class="label"
				>{data.attention.unmatched === 1 ? 'offener Bankumsatz' : 'offene Bankumsätze'} zuordnen</span
			>
		</a>
		{#if nextDeadline}
			<a class="stat highlight" href={nextDeadline.href}>
				<span class="kicker">Nächste Frist · {relative(nextDeadline.date)}</span>
				<strong>{nextDeadline.title}</strong>
				<span class="label">{formatDate(nextDeadline.date)}</span>
			</a>
		{/if}
	</section>
{/if}

<h2 id="offene-aufgaben">Offene Aufgaben</h2>
{#if created ?? (form && 'created' in form ? form.created : undefined)}
	<p role="status" class="muted">
		„{created ?? (form && 'created' in form ? form.created : '')}“ wurde angelegt.
	</p>
{/if}
{#if form && 'message' in form}
	<p class="error" role="alert">{form.message}</p>
{/if}
{#if data.open.length === 0}
	<p class="muted">Keine offenen Aufgaben.</p>
{:else}
	<ul class="tasks" aria-label="Offene Aufgaben">
		{#each data.open as task (task.id)}
			{@const late = task.dueDate !== null && task.dueDate < data.today}
			<li class="task" class:late>
				<form method="POST" action="?/done" class="check" use:enhance>
					<input type="hidden" name="id" value={task.id} />
					<input type="hidden" name="done" value="true" />
					<label class="inline">
						<input
							type="checkbox"
							onchange={(event) => event.currentTarget.form?.requestSubmit()}
						/>
						<span class="visually-hidden">„{task.title}“ erledigt</span>
					</label>
				</form>
				<div class="body">
					<div class="title">
						<a href="?bearbeiten={task.id}" data-sveltekit-reset="false"
							><strong>{task.title}</strong></a
						>
						{#if task.category !== 'other'}<Badge>{taskCategoryLabels[task.category]}</Badge>{/if}
						{#if task.repeatMonths}<span class="repeat muted"
								><Icon name="history" size={12} />{repeatLabel(task.repeatMonths)}</span
							>{/if}
					</div>
					{#if task.property || task.lease}
						<span class="links muted">
							{#if task.property}<a href="/objekte/{task.property.id}"
									><Icon name="building" size={13} />{task.property.name}</a
								>{/if}
							{#if task.lease}<a href="/vertraege/{task.lease.id}"
									><Icon name="file" size={13} />{task.lease.label}</a
								>{/if}
						</span>
					{/if}
					{#if task.note}<p class="muted small note">{task.note}</p>{/if}
				</div>
				{#if task.dueDate}
					<div class="due" class:soon={!late && soon(task.dueDate)}>
						<span class="relative">{relative(task.dueDate)}</span>
						<span class="muted">bis {formatDate(task.dueDate)}</span>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if data.done.length > 0}
	<details class="done">
		<summary
			>{data.done.length === 1
				? 'Eine erledigte Aufgabe'
				: `${data.done.length} erledigte Aufgaben`}</summary
		>
		<ul class="list" aria-label="Erledigte Aufgaben">
			{#each data.done as task (task.id)}
				<li class="card task">
					<div class="body">
						<a href="?bearbeiten={task.id}" data-sveltekit-reset="false"><s>{task.title}</s></a>
						<span class="muted">
							{#if task.doneAt}· erledigt am {formatDate(dayOf(task.doneAt))}{/if}
							{#if task.property}· {task.property.name}{/if}
							{#if task.lease}· {task.lease.label}{/if}
						</span>
					</div>
					<form method="POST" action="?/done" use:enhance>
						<input type="hidden" name="id" value={task.id} />
						<input type="hidden" name="done" value="false" />
						<button type="submit" class="secondary small">wieder öffnen</button>
					</form>
				</li>
			{/each}
		</ul>
	</details>
{/if}

{#if data.attention.vacantCount > 0}
	<h2>Leerstand</h2>
	<ul class="list" aria-label="Leerstand">
		{#each data.attention.vacant as row (row.unitId)}
			<li class="card">
				<a href="/objekte/{row.propertyId}">{row.label}</a>
				<a href="/vertraege/neu?unitId={row.unitId}">Mietvertrag anlegen</a>
			</li>
		{/each}
		{#if data.attention.vacantCount > data.attention.vacant.length}
			<li class="card">
				<a href="/objekte"
					>{pluralize(
						data.attention.vacantCount - data.attention.vacant.length,
						'weitere Einheit',
						'weitere Einheiten'
					)}</a
				>
			</li>
		{/if}
	</ul>
{/if}

<h2>Fristen</h2>
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

<dialog
	bind:this={dialog}
	class="edit-dialog"
	aria-labelledby="task-dialog-title"
	open={import.meta.env.SSR && requested ? true : undefined}
	onclose={closed}
>
	<div class="dialog-head">
		<h2 id="task-dialog-title">Aufgabe anlegen</h2>
		<form method="dialog">
			<button type="submit" class="icon-button" aria-label="Schließen" title="Schließen"
				><Icon name="close" size={20} /></button
			>
		</form>
	</div>
	<p class="muted templates">
		Vorlagen für wiederkehrende Pflichten:
		{#each taskTemplates as template, index (template.key)}
			{index > 0 ? ' · ' : ''}<a
				href="?vorlage={template.key}"
				data-sveltekit-reset="false"
				data-sveltekit-replacestate
				aria-current={data.template?.key === template.key ? 'true' : undefined}>{template.title}</a
			>
		{/each}
	</p>
	<form
		method="POST"
		action="?/create"
		class="form"
		use:enhance={() =>
			async ({ result, update }) => {
				await update();
				if (result.type !== 'success') return;
				created = String(result.data?.created ?? '');
				dialog?.close();
			}}
	>
		<!-- Keyed, so choosing another template refills fields the browser has not touched yet. -->
		{#key data.template?.key}
			<TaskFields {values} {errors} properties={data.properties} leases={data.leases} />
		{/key}
		<div class="form-actions">
			<button type="submit">Aufgabe anlegen</button>
		</div>
	</form>
</dialog>

{#if data.editing}
	{#key data.editing.id}
		<EditDialog
			title="Aufgabe bearbeiten"
			action="?/update"
			deleteAction="?/delete"
			deleteMessage="Aufgabe „{data.editing.title}“ wirklich löschen?"
			close="/aufgaben"
			error={form && 'message' in form ? form.message : undefined}
		>
			<input type="hidden" name="id" value={data.editing.id} />
			<TaskFields
				values={editValues}
				errors={editRefused?.errors}
				properties={data.properties}
				leases={data.leases}
			/>
		</EditDialog>
	{/key}
{/if}

<style>
	.first-run {
		margin-bottom: 1.5rem;
	}
	.first-run h2 {
		margin-top: 0;
	}
	.steps {
		margin: 0;
		padding-left: 1.5rem;
		display: grid;
		gap: 0.5rem;
	}
	/* An open step sits on the neon block of the logo; a done one goes back to plain text. */
	.steps li:not(.done) a {
		padding: 0 0.2em;
		background: var(--color-highlight);
		color: var(--color-highlight-text);
		text-decoration-color: currentColor;
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
	}
	.steps .done a {
		text-decoration: line-through;
	}
	.ai-hint {
		margin: 1rem 0 0;
	}
	/* The open tasks form one block, a late one marked by a red edge. */
	.tasks {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: var(--shadow);
	}
	.task {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem 1.25rem;
		padding: 1.25rem 1.5rem;
		border-left: 3px solid transparent;
	}
	.task + .task {
		border-top: 1px solid var(--color-border);
	}
	.task.late {
		border-left-color: var(--color-danger);
	}
	.task .body {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 0.3rem;
	}
	.task a {
		text-decoration: none;
	}
	.task a:hover {
		text-decoration: underline;
	}
	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
	}
	.repeat,
	.links a {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.repeat {
		font-size: var(--text-xs);
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 1rem;
		font-size: var(--text-sm);
	}
	.task .note {
		margin: 0;
		white-space: pre-line;
	}
	.check label {
		padding-top: 0.2rem;
	}
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
	.due.soon .relative {
		padding: 0 0.35em;
		background: var(--color-highlight);
		color: var(--color-highlight-text);
	}
	.late .due .relative,
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
	/* The next deadline gets more room than the three figures. */
	@media (min-width: 60rem) {
		.overview:has(.highlight) {
			grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.4fr);
		}
	}
	.stat.highlight .kicker {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.stat.highlight strong {
		font-size: var(--text-lg);
		line-height: 1.3;
	}
	@media (max-width: 40rem) {
		.task {
			flex-wrap: wrap;
			padding: 1rem;
		}
		.task .body {
			flex-basis: calc(100% - 2.5rem);
		}
		.task .due {
			justify-items: start;
			margin-left: 2rem;
			text-align: left;
		}
		.deadline {
			align-items: flex-start;
			padding: 0.75rem 1rem;
		}
		.deadline {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: 1rem;
		}
		.deadline .due {
			grid-column: 2;
			display: flex;
			gap: 0.5rem;
			margin-top: 0.3rem;
		}
	}
	.done {
		margin-top: 1rem;
	}
	.done summary {
		cursor: pointer;
		color: var(--color-muted);
		margin-bottom: 0.5rem;
	}
	.templates [aria-current] {
		font-weight: 600;
	}
</style>
