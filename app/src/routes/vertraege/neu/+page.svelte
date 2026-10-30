<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import LeaseForm from '#lib/components/LeaseForm.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<PageHeader title="Mietvertrag anlegen" back={{ href: '/vertraege', label: 'Alle Mietverträge' }} />

{#if data.units.length === 0}
	<EmptyState
		title="Du hast noch keine Einheit angelegt."
		text="Ein Mietvertrag gehört zu einer Einheit eines Objekts."
	>
		<a href="/objekte" class="button">Objekt und Einheit anlegen</a>
	</EmptyState>
{:else if data.tenants.length === 0}
	<EmptyState
		title="Du hast noch keinen Mieter angelegt."
		text="Lege zuerst den Mieter an; danach geht es hier weiter."
	>
		<a href="/mieter/neu?return=/vertraege/neu" class="button">Mieter anlegen</a>
	</EmptyState>
{:else}
	<LeaseForm
		mode="create"
		action="?/create"
		values={form?.values ?? data.defaults}
		errors={form?.errors ?? {}}
		depositWarning={form?.depositWarning}
		units={data.units}
		tenants={data.tenants}
		submitLabel="Mietvertrag anlegen"
		cancelHref="/vertraege"
	/>
{/if}
