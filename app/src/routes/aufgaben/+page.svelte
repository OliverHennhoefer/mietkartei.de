<script lang="ts">
	import { enhance } from '$app/forms';
	import Badge from '#lib/components/Badge.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import TaskFields from '#lib/components/TaskFields.svelte';
	import { formatDate } from '#lib/dates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form?.values ?? {});
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
		<table class="table" aria-label="Fristen">
			<thead>
				<tr>
					<th>Datum</th>
					<th>Frist</th>
					<th>Betrifft</th>
				</tr>
			</thead>
			<tbody>
				{#each data.deadlines as deadline (deadline.kind + deadline.href + deadline.date)}
					<tr>
						<td class="date">
							{formatDate(deadline.date)}
							{#if deadline.overdue}<Badge tone="danger">überfällig</Badge>{/if}
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
					<span class="muted">
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
							{#if task.doneAt}· erledigt am {formatDate(
									task.doneAt.toISOString().slice(0, 10)
								)}{/if}
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

<h2>Aufgabe anlegen</h2>
<form method="POST" action="?/create" class="card" use:enhance>
	<TaskFields {values} {errors} properties={data.properties} leases={data.leases} />
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
	.form-actions p {
		margin: 0;
	}
</style>
