<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import TaskFields from '#lib/components/TaskFields.svelte';
	import { linkValue } from '#lib/forms/tasks.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	// After a failed submit the typed values win; otherwise the form shows the task as stored.
	const values = $derived(
		form?.values ?? {
			title: data.task.title,
			category: data.task.category,
			dueDate: data.task.dueDate ?? '',
			repeatMonths: data.task.repeatMonths ? String(data.task.repeatMonths) : '',
			link: data.task.propertyId
				? linkValue('property', data.task.propertyId)
				: data.task.leaseId
					? linkValue('lease', data.task.leaseId)
					: '',
			note: data.task.note ?? ''
		}
	);
</script>

<PageHeader
	title={data.task.title}
	lead={data.task.done ? 'Erledigt' : 'Offen'}
	back={{ href: '/aufgaben', label: 'Alle Aufgaben' }}
/>

<h2>Aufgabe bearbeiten</h2>
<form method="POST" action="?/update" class="card" use:enhance>
	<TaskFields {values} {errors} properties={data.properties} leases={data.leases} />
	<div class="form-actions">
		<button type="submit">Speichern</button>
		<a href="/aufgaben" class="button secondary">Abbrechen</a>
	</div>
</form>

<div class="toolbar">
	<ConfirmButton
		action="?/delete"
		label="Aufgabe löschen"
		message="Aufgabe „{data.task.title}“ wirklich löschen?"
	/>
</div>

<style>
	.toolbar {
		margin-top: 1.5rem;
	}
</style>
