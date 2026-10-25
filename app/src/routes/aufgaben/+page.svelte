<script lang="ts">
	import { enhance } from '$app/forms';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import TaskFields from '#lib/components/TaskFields.svelte';
	import { dayOf, formatDate } from '#lib/dates.ts';
	import { taskCategoryLabels } from '#lib/labels.ts';
	import { repeatLabel, taskTemplates } from '#lib/task-templates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form?.values ?? data.template ?? {});
	const overdue = $derived(data.deadlines.filter((deadline) => deadline.overdue).length);
</script>

<PageHeader
	title="Aufgaben"
	lead="Fristen, die sich aus deinen Verträgen und Abrechnungen ergeben, und was du dir selbst vornimmst."
/>

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

<h2>Aufgaben</h2>
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

<h2 id="anlegen">Aufgabe anlegen</h2>
<p class="muted templates">
	Vorlagen für wiederkehrende Pflichten:
	{#each taskTemplates as template, index (template.key)}
		{index > 0 ? ' · ' : ''}<a
			href="?vorlage={template.key}#anlegen"
			aria-current={data.template?.key === template.key ? 'true' : undefined}>{template.title}</a
		>
	{/each}
</p>
<form method="POST" action="?/create" class="card" use:enhance>
	<!-- Keyed, so choosing another template refills fields the browser has not touched yet. -->
	{#key data.template?.key}
		<TaskFields {values} {errors} properties={data.properties} leases={data.leases} />
	{/key}
	<div class="form-actions">
		<button type="submit">Aufgabe anlegen</button>
		{#if form && 'created' in form}
			<p role="status">„{form.created}“ wurde angelegt.</p>
		{/if}
	</div>
</form>

<style>
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
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
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
	.form-actions p {
		margin: 0;
	}
</style>
