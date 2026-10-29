<script lang="ts">
	import { enhance } from '$app/forms';
	import CreateButton from '#lib/components/CreateButton.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { pluralize } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// A refused edit belongs to the edit dialog, everything else to the create form.
	const editRefused = $derived(form && 'edit' in form ? form : undefined);
	const errors = $derived(form && 'errors' in form && !editRefused ? form.errors : undefined);
	const values = $derived(form && 'values' in form && !editRefused ? form.values : undefined);
	const editValues = $derived(
		editRefused?.values ??
			(data.editing && {
				name: data.editing.name,
				trade: data.editing.trade ?? '',
				phone: data.editing.phone ?? '',
				email: data.editing.email ?? '',
				note: data.editing.note ?? ''
			})
	);
</script>

<PageHeader
	title="Handwerker"
	lead="Wer bei dir repariert und wartet, mit Gewerk und Kontakt. Eine Aufgabe nennt den Handwerker, der sie erledigt."
>
	{#snippet actions()}
		<a class="button secondary" href="/aufgaben">Zurück zu den Aufgaben</a>
		<CreateButton href="#handwerker-anlegen" label="Handwerker anlegen" />
	{/snippet}
</PageHeader>

{#if data.contractors.length === 0}
	<EmptyState
		title="Noch keine Handwerker"
		text="Lege die Handwerker an, die du beauftragst; danach wählst du sie bei einer Aufgabe aus."
	/>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Handwerker">
			<thead>
				<tr>
					<th>Name</th>
					<th>Gewerk</th>
					<th>Telefon</th>
					<th>E-Mail</th>
					<th class="number">Aufgaben</th>
				</tr>
			</thead>
			<tbody>
				{#each data.contractors as contractor (contractor.id)}
					<tr>
						<td>
							<a href="?bearbeiten={contractor.id}" data-sveltekit-reset="false"
								>{contractor.name}</a
							>
						</td>
						<td>{contractor.trade ?? ''}</td>
						<td>
							{#if contractor.phone}<a href="tel:{contractor.phone}">{contractor.phone}</a>{/if}
						</td>
						<td>
							{#if contractor.email}<a href="mailto:{contractor.email}">{contractor.email}</a>{/if}
						</td>
						<td class="number">{contractor.taskCount}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2 id="handwerker-anlegen">Handwerker anlegen</h2>
<form method="POST" action="?/create" class="card" use:enhance>
	{@render contractorFields(values, errors)}
	<div class="form-actions form-wide">
		<button type="submit">Handwerker anlegen</button>
	</div>
	{#if form && 'created' in form}
		<p class="form-actions form-wide" role="status">„{form.created}“ wurde angelegt.</p>
	{/if}
</form>

{#snippet contractorFields(
	values: Record<string, string> | undefined,
	errors: Partial<Record<string, string>> | undefined
)}
	<Field label="Name" error={errors?.name}>
		<input
			name="name"
			defaultValue={values?.name ?? ''}
			placeholder="z. B. Sanitär Krüger GmbH"
			aria-invalid={errors?.name ? 'true' : undefined}
			required
		/>
	</Field>
	<Field label="Gewerk (optional)" error={errors?.trade}>
		<input
			name="trade"
			defaultValue={values?.trade ?? ''}
			placeholder="z. B. Sanitär, Elektro, Dach"
			aria-invalid={errors?.trade ? 'true' : undefined}
		/>
	</Field>
	<Field label="Telefon (optional)" error={errors?.phone}>
		<input
			name="phone"
			type="tel"
			defaultValue={values?.phone ?? ''}
			aria-invalid={errors?.phone ? 'true' : undefined}
		/>
	</Field>
	<Field label="E-Mail (optional)" error={errors?.email}>
		<input
			name="email"
			type="email"
			defaultValue={values?.email ?? ''}
			aria-invalid={errors?.email ? 'true' : undefined}
		/>
	</Field>
	<Field label="Notiz (optional)" error={errors?.note}>
		<textarea name="note" aria-invalid={errors?.note ? 'true' : undefined}
			>{values?.note ?? ''}</textarea
		>
	</Field>
{/snippet}

{#if data.editing && editValues}
	{#key data.editing.id}
		<EditDialog
			title="Handwerker bearbeiten"
			action="?/update"
			deleteAction="?/delete"
			deleteMessage={data.editing.taskCount > 0
				? `„${data.editing.name}“ löschen? ${pluralize(data.editing.taskCount, 'Aufgabe nennt', 'Aufgaben nennen')} diesen Handwerker; dort entfällt dann der Name.`
				: `„${data.editing.name}“ löschen?`}
			close="/aufgaben/handwerker"
		>
			<input type="hidden" name="id" value={data.editing.id} />
			{@render contractorFields(editValues, editRefused?.errors)}
		</EditDialog>
	{/key}
{/if}
