<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDate } from '../dates';
	import Alert from './Alert.svelte';
	import ConfirmButton from './ConfirmButton.svelte';
	import type { ArchiveCheck } from '../server/archive';

	// The "Archivieren" section of a property's or tenant's page: archived since when with the
	// button to restore, the leases that still run, or the button. The server checks again.
	let {
		heading,
		label,
		question,
		text,
		check,
		error
	}: {
		heading: string;
		/** The button, e.g. "Mieter archivieren". */
		label: string;
		/** The confirmation, e.g. "Mieter Erika Musterfrau archivieren?" */
		question: string;
		/** What archiving does, shown above the button. */
		text: string;
		check: ArchiveCheck;
		/** A refusal of the action, when the data changed after the page was loaded. */
		error?: string;
	} = $props();
</script>

<h2>{heading}</h2>
{#if error}
	<Alert tone="danger"><p>{error}</p></Alert>
{/if}
{#if check.archivedAt}
	<p>Archiviert am {formatDate(check.archivedAt)}.</p>
	<form method="POST" action="?/restore" use:enhance>
		<button type="submit" class="secondary">Aus dem Archiv holen</button>
	</form>
{:else if check.runningLeases.length > 0}
	<Alert>
		<p>
			Archivieren geht erst, wenn kein Mietvertrag mehr läuft oder später beginnt. Trag dafür das
			Vertragsende ein:
		</p>
		<ul aria-label="Was das Archivieren verhindert">
			{#each check.runningLeases as link (link.href)}
				<li><a href={link.href}>{link.label}</a></li>
			{/each}
		</ul>
	</Alert>
{:else}
	<p class="muted">{text}</p>
	<ConfirmButton action="?/archive" {label} message={question} tone="secondary" />
{/if}
