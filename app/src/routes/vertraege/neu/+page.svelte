<script lang="ts">
	import Alert from '#lib/components/Alert.svelte';
	import CreateButton from '#lib/components/CreateButton.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import LeaseForm from '#lib/components/LeaseForm.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { personName } from '#lib/format.ts';
	import { FreshForm } from '#lib/fresh-form.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	// "Speichern und nächsten Mietvertrag" comes back here; the next lease starts empty.
	const fresh = new FreshForm();
	const savedText = (saved: { label: string; tenants: string[] }) =>
		`Der Mietvertrag ${saved.label}${saved.tenants.length > 0 ? ` mit ${saved.tenants.join(' und ')}` : ''} ist angelegt.`;
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
			{#if data.units.length > 0}Ziehen mehrere ein? Tipp die weiteren Namen unten bei Mieter ein ·{/if}
			<a href="/mieter/{data.created[0].id}">Mietvertrag später anlegen</a> ·
			<a href="/mieter/neu">Nächsten Mieter anlegen</a>
		</p>
	</Alert>
{/if}

{#if data.saved && !form}
	<Alert tone="success">
		<p>
			{savedText(data.saved)}
			<a href="/vertraege/{data.saved.id}">Mietvertrag ansehen</a>
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
	{#key fresh.visit}
		<LeaseForm
			mode="create"
			action="?/create"
			values={form?.values ?? data.defaults}
			errors={form?.errors ?? {}}
			depositWarning={form?.depositWarning}
			units={data.units}
			tenants={data.tenants}
			submitLabel="Mietvertrag anlegen"
			nextLabel="Speichern und nächsten Mietvertrag"
			cancelHref={data.created.length > 0 ? `/mieter/${data.created[0].id}` : '/vertraege'}
		/>
	{/key}
{/if}
