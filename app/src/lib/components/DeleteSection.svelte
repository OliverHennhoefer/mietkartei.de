<script lang="ts">
	import Alert from './Alert.svelte';
	import ConfirmButton from './ConfirmButton.svelte';
	import type { DeletionCheck } from '../server/deletion';

	// The "Löschen" section of a record's page: what blocks the delete, with links to resolve it,
	// or what goes with the record and the button. The server runs the same check again on delete.
	let {
		heading,
		label,
		question,
		check,
		error,
		alternative
	}: {
		heading: string;
		/** The button, e.g. "Mieter löschen". */
		label: string;
		/** The confirmation's first sentence, e.g. "Mieter Erika Musterfrau löschen?" */
		question: string;
		check: DeletionCheck;
		/** A refusal of the action, when the data changed after the page was loaded. */
		error?: string;
		/** What to do instead while something blocks the delete, e.g. archiving. */
		alternative?: string;
	} = $props();

	const message = $derived(
		`${question}${check.removes.length > 0 ? ` Mitgelöscht ${check.removes.length === 1 ? 'wird' : 'werden'}: ${check.removes.join(', ')}.` : ''} Das lässt sich nicht rückgängig machen.`
	);
</script>

<h2>{heading}</h2>
{#if error}
	<Alert tone="danger"><p>{error}</p></Alert>
{/if}
{#if check.blockers.length > 0}
	<Alert>
		{#each check.blockers as blocker (blocker.text)}
			<p>{blocker.text}</p>
			{#if blocker.links.length > 0}
				<ul aria-label="Was das Löschen verhindert">
					{#each blocker.links as link (link.href)}
						<li><a href={link.href}>{link.label}</a></li>
					{/each}
				</ul>
			{/if}
		{/each}
		{#if alternative}<p>{alternative}</p>{/if}
	</Alert>
{:else}
	{#if check.removes.length > 0}
		<p class="muted">Mitgelöscht wird:</p>
		<ul class="muted" aria-label="Was mitgelöscht wird">
			{#each check.removes as item (item)}
				<li>{item}</li>
			{/each}
		</ul>
	{/if}
	{#each check.unlinks as item (item)}
		<p class="muted">{item}.</p>
	{/each}
	<ConfirmButton action="?/delete" {label} {message} />
{/if}
