<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import CreateButton from '#lib/components/CreateButton.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import LeaseForm from '#lib/components/LeaseForm.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { personName } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const createdNames = $derived(data.created.map((tenant) => personName(tenant)).join(' und '));
</script>

<PageHeader title="Mietvertrag anlegen" back={{ href: '/vertraege', label: 'Alle Mietverträge' }} />

{#if data.created.length > 0}
	<Alert tone="success">
		<p>
			{createdNames}
			{data.created.length === 1 ? 'ist' : 'sind'} angelegt. Jetzt fehlt noch der Mietvertrag: Er ordnet
			die Einheit zu, und von ihr kommt die Adresse für Schreiben.
		</p>
		<p>
			{#if data.units.length > 0}Ziehen mehrere ein? Tipp die weiteren Namen unten bei Mieter ein.{/if}
			<a href="/mieter/{data.created[0].id}">Später anlegen</a>
		</p>
	</Alert>
{/if}

{#if data.units.length === 0}
	<EmptyState
		title="Du hast noch keine Einheit angelegt."
		text="Ein Mietvertrag gehört zu einer Einheit eines Objekts."
	>
		<CreateButton href="/objekte" label="Objekt und Einheit anlegen" />
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
		cancelHref={data.created.length > 0 ? `/mieter/${data.created[0].id}` : '/vertraege'}
	/>
{/if}
