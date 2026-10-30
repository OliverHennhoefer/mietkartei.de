<script lang="ts">
	import { enhance } from '$app/forms';
	import CreateButton from '#lib/components/CreateButton.svelte';
	import EditDialog from '#lib/components/EditDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Field from '#lib/components/Field.svelte';
	import Money from '#lib/components/Money.svelte';
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
				service: data.editing.service ?? '',
				phone: data.editing.phone ?? '',
				email: data.editing.email ?? '',
				note: data.editing.note ?? ''
			})
	);

	/** Names what keeps the Dienstleister today; there the name is cleared. */
	function deleteMessage(provider: NonNullable<typeof data.editing>): string {
		const uses = [
			provider.taskCount > 0 ? pluralize(provider.taskCount, 'Aufgabe', 'Aufgaben') : '',
			provider.expenses.count > 0 ? pluralize(provider.expenses.count, 'Ausgabe', 'Ausgaben') : ''
		].filter(Boolean);
		if (uses.length === 0) return `„${provider.name}“ löschen?`;
		const one = uses.length === 1 && provider.taskCount + provider.expenses.count === 1;
		return `„${provider.name}“ löschen? ${uses.join(' und ')} ${one ? 'nennt' : 'nennen'} diesen Dienstleister; dort gilt er dann als unbekannt.`;
	}
</script>

<PageHeader title="Dienstleister">
	{#snippet actions()}
		<CreateButton href="#dienstleister-anlegen" label="Dienstleister anlegen" />
	{/snippet}
</PageHeader>

{#if data.serviceProviders.length === 0}
	<EmptyState
		title="Noch keine Dienstleister"
		text="Lege die Betriebe und Personen an, die du beauftragst; danach wählst du sie bei einer Aufgabe oder Ausgabe aus."
	/>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Dienstleister">
			<thead>
				<tr>
					<th>Name</th>
					<th>Leistung</th>
					<th>Telefon</th>
					<th>E-Mail</th>
					<th class="num">Aufgaben</th>
					<th class="num">Ausgaben gesamt</th>
				</tr>
			</thead>
			<tbody>
				{#each data.serviceProviders as serviceProvider (serviceProvider.id)}
					<tr>
						<td>
							<a href="?bearbeiten={serviceProvider.id}" data-sveltekit-reset="false"
								>{serviceProvider.name}</a
							>
						</td>
						<td>{serviceProvider.service ?? ''}</td>
						<td class="phone">
							{#if serviceProvider.phone}<a href="tel:{serviceProvider.phone}"
									>{serviceProvider.phone}</a
								>{/if}
						</td>
						<td>
							{#if serviceProvider.email}<a href="mailto:{serviceProvider.email}"
									>{serviceProvider.email}</a
								>{/if}
						</td>
						<td class="num">{serviceProvider.taskCount}</td>
						<td class="num">
							{#if serviceProvider.expenses.count > 0}<Money
									cents={serviceProvider.expenses.total}
								/>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2 id="dienstleister-anlegen">Dienstleister anlegen</h2>
<form method="POST" action="?/create" class="card" use:enhance>
	{@render serviceProviderFields(values, errors)}
	<div class="form-actions form-wide">
		<button type="submit">Dienstleister anlegen</button>
	</div>
	{#if form && 'created' in form}
		<p class="form-actions form-wide" role="status">„{form.created}“ wurde angelegt.</p>
	{/if}
</form>

{#snippet serviceProviderFields(
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
	<Field label="Leistung (optional)" error={errors?.service}>
		<input
			name="service"
			defaultValue={values?.service ?? ''}
			placeholder="z. B. Sanitär, Hausmeisterdienst"
			aria-invalid={errors?.service ? 'true' : undefined}
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
			title="Dienstleister bearbeiten"
			action="?/update"
			deleteAction="?/delete"
			deleteMessage={deleteMessage(data.editing)}
			close="/dienstleister"
		>
			<input type="hidden" name="id" value={data.editing.id} />
			{@render serviceProviderFields(editValues, editRefused?.errors)}
		</EditDialog>
	{/key}
{/if}

<style>
	.phone {
		white-space: nowrap;
	}
</style>
