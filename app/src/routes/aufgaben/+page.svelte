<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Money from '#lib/components/Money.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import TaskFields from '#lib/components/TaskFields.svelte';
	import { dayOf, formatDate } from '#lib/dates.ts';
	import { pluralize } from '#lib/format.ts';
	import { taskCategoryLabels } from '#lib/labels.ts';
	import { repeatLabel, taskTemplates } from '#lib/task-templates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form?.values ?? data.template ?? {});

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
	const overdue = $derived(data.deadlines.filter((deadline) => deadline.overdue).length);
	const attention = $derived(
		data.attention.arrearsCount > 0 ||
			data.attention.unmatched > 0 ||
			data.attention.vacantCount > 0
	);

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

<h2>Offene Aufgaben</h2>
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
	<ul class="list" aria-label="Offene Aufgaben">
		{#each data.open as task (task.id)}
			<li class="card task">
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
					<a href="/aufgaben/{task.id}"><strong>{task.title}</strong></a>
					{#if task.category !== 'other'}<Badge>{taskCategoryLabels[task.category]}</Badge>{/if}
					<span class="muted">
						{#if task.repeatMonths}· {repeatLabel(task.repeatMonths)}{/if}
						{#if task.dueDate}
							· bis {formatDate(task.dueDate)}
							{#if task.dueDate < data.today}<Badge tone="danger">überfällig</Badge>{/if}
						{/if}
						{#if task.property}
							· <a href="/objekte/{task.property.id}">{task.property.name}</a>
						{/if}
						{#if task.lease}
							· <a href="/vertraege/{task.lease.id}">{task.lease.label}</a>
						{/if}
					</span>
					{#if task.note}<p class="muted small note">{task.note}</p>{/if}
				</div>
				<ConfirmButton
					action="?/delete"
					label="Löschen"
					message="Aufgabe „{task.title}“ wirklich löschen?"
				>
					<input type="hidden" name="id" value={task.id} />
				</ConfirmButton>
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
						<s>{task.title}</s>
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
					<ConfirmButton
						action="?/delete"
						label="Löschen"
						message="Aufgabe „{task.title}“ wirklich löschen?"
					>
						<input type="hidden" name="id" value={task.id} />
					</ConfirmButton>
				</li>
			{/each}
		</ul>
	</details>
{/if}

{#if attention}
	<section aria-labelledby="attention">
		<h2 id="attention">Handlungsbedarf</h2>
		<ul class="list" aria-label="Handlungsbedarf">
			{#if data.attention.arrearsCount > 0}
				<li class="card">
					<a href="/mietkonto?filter=rueckstaende"
						>Rückstände bei {pluralize(
							data.attention.arrearsCount,
							'Mietvertrag',
							'Mietverträgen'
						)}</a
					>
					<Money cents={data.attention.arrearsTotal} />
				</li>
			{/if}
			{#if data.attention.unmatched > 0}
				<li class="card">
					<a href="/bank"
						>{pluralize(data.attention.unmatched, 'offener Bankumsatz', 'offene Bankumsätze')} zuordnen</a
					>
				</li>
			{/if}
			{#each data.attention.vacant as row (row.unitId)}
				<li class="card">
					<span>Leerstand: <a href="/objekte/{row.propertyId}">{row.label}</a></span>
					<a href="/vertraege/neu?unitId={row.unitId}">Mietvertrag anlegen</a>
				</li>
			{/each}
			{#if data.attention.vacantCount > data.attention.vacant.length}
				<li class="card">
					<a href="/objekte"
						>Leerstand: {pluralize(
							data.attention.vacantCount - data.attention.vacant.length,
							'weitere Einheit',
							'weitere Einheiten'
						)}</a
					>
				</li>
			{/if}
		</ul>
	</section>
{/if}

<h2>Fristen</h2>
{#if data.deadlines.length === 0}
	<p class="muted">In den nächsten zwölf Monaten steht keine Frist an.</p>
{:else}
	{#if overdue > 0}
		<p class="muted">
			{overdue === 1 ? 'Eine Frist ist' : `${overdue} Fristen sind`} überfällig.
		</p>
	{/if}
	<div class="table-wrap">
		<table class="table deadlines" aria-label="Fristen">
			<thead>
				<tr>
					<th>Datum</th>
					<th>Frist</th>
					<th>Betrifft</th>
				</tr>
			</thead>
			<tbody>
				{#each data.deadlines as deadline, index (index)}
					<tr>
						<td class="date">
							<span class="when">
								{formatDate(deadline.date)}
								{#if deadline.overdue}<Badge tone="danger">überfällig</Badge>{/if}
							</span>
						</td>
						<td><a href={deadline.href}>{deadline.title}</a></td>
						<td class="muted">{deadline.detail ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<dialog
	bind:this={dialog}
	class="task-dialog"
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
	.date {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.when {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	/* On phones each deadline becomes a block: date and badge, then title, then what it concerns. */
	@media (max-width: 40rem) {
		.deadlines thead {
			display: none;
		}
		.deadlines tbody tr {
			display: grid;
			gap: 0.3rem;
			padding: 0.9rem 1.25rem;
			border-bottom: 1px solid var(--color-border);
		}
		.deadlines tbody tr:last-child {
			border-bottom: 0;
		}
		.deadlines td {
			padding: 0;
			border: 0;
		}
		.deadlines .date {
			color: var(--color-muted);
			font-size: 0.8rem;
		}
		.deadlines td:empty {
			display: none;
		}
	}
	.task {
		align-items: flex-start;
		flex-wrap: nowrap;
	}
	.task .body {
		flex: 1;
		min-width: 0;
	}
	.task .note {
		margin: 0.25rem 0 0;
		white-space: pre-line;
	}
	.check label {
		padding-top: 0.2rem;
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
	.task-dialog {
		width: min(52rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		margin: auto;
		padding: 1.25rem 1.5rem 1.5rem;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: 0 24px 64px rgb(0 0 0 / 22%);
	}
	.task-dialog::backdrop {
		background: rgb(0 0 0 / 35%);
	}
	.dialog-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.dialog-head h2 {
		margin: 0;
	}
	@media (max-width: 40rem) {
		.task-dialog {
			width: 100vw;
			max-width: none;
			height: 100dvh;
			max-height: none;
			padding: 1rem;
			border: 0;
			border-radius: 0;
		}
	}
</style>
