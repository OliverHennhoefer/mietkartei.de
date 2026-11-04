<script lang="ts">
	import { page } from '$app/state';
	import Alert from './Alert.svelte';
	import Badge from './Badge.svelte';
	import Icon from './Icon.svelte';

	// The Hinweise of a check (Nebenkostenabrechnung, Hausgeld, Steuer) in one box, a note rather
	// than a status: they stand on the page and are not news. Each has an x
	// that hides it for the signed-in user right away and remembers that (routes/hinweise); closed
	// ones can be shown again. A Hinweis that blocks an approval has no x.
	type Hint = {
		key: string;
		message: string;
		href?: string;
		blocking?: boolean;
		dismissed: boolean;
	};

	let { hints, title = 'Hinweise' }: { hints: Hint[]; title?: string } = $props();

	// Closed (true) or shown again (false) on this page before the server has the hints anew.
	let changed = $state<Record<string, boolean>>({});

	const closed = (hint: Hint) => !hint.blocking && (changed[hint.key] ?? hint.dismissed);
	const shown = $derived(hints.filter((hint) => !closed(hint)));
	const hidden = $derived(hints.filter(closed));
	const back = $derived(page.url.pathname + page.url.search);

	// One post after the other, so that "wieder anzeigen" right after an x reaches the server
	// after the x and the stored state is the last click.
	let queue = Promise.resolve();

	/**
	 * Changes the list at once and sends the form with fetch. A failed post puts its Hinweise back,
	 * unless a later click changed them again.
	 */
	function send(event: SubmitEvent, keys: string[], dismissed: boolean) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		// Read now: the form of an x leaves the page with its Hinweis.
		const action = form.action;
		const body = new FormData(form);
		const before = Object.fromEntries(keys.map((key) => [key, changed[key]]));
		for (const key of keys) changed[key] = dismissed;
		queue = queue.then(async () => {
			try {
				const response = await fetch(action, {
					method: 'POST',
					body,
					headers: { accept: 'application/json' }
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
			} catch {
				for (const key of keys) {
					if (changed[key] !== dismissed) continue;
					if (before[key] === undefined) delete changed[key];
					else changed[key] = before[key];
				}
			}
		});
	}
</script>

{#snippet restore()}
	{#if hidden.length > 0}
		<form
			method="POST"
			action="/hinweise"
			class="own-view restore small muted"
			onsubmit={(event) =>
				send(
					event,
					hidden.map((hint) => hint.key),
					false
				)}
		>
			<input type="hidden" name="back" value={back} />
			<input type="hidden" name="restore" value="1" />
			{#each hidden as hint (hint.key)}
				<input type="hidden" name="key" value={hint.key} />
			{/each}
			{hidden.length === 1 ? 'Ein Hinweis ausgeblendet' : `${hidden.length} Hinweise ausgeblendet`}
			· <button type="submit" class="link">wieder anzeigen</button>
		</form>
	{/if}
{/snippet}

{#if shown.length > 0}
	<Alert tone="warning" role="note">
		<p><strong>{title}</strong></p>
		<ul class="hints">
			{#each shown as hint (hint.key)}
				<li>
					<div class="hint">
						<span>
							{#if hint.blocking}<Badge tone="danger">blockiert die Freigabe</Badge>{/if}
							{#if hint.href}
								<a href={hint.href}>{hint.message}</a>
							{:else}
								{hint.message}
							{/if}
						</span>
						{#if !hint.blocking}
							<form
								method="POST"
								action="/hinweise"
								class="own-view"
								onsubmit={(event) => send(event, [hint.key], true)}
							>
								<input type="hidden" name="back" value={back} />
								<input type="hidden" name="key" value={hint.key} />
								<button
									type="submit"
									class="icon-button dismiss"
									aria-label="Hinweis ausblenden"
									title="Hinweis ausblenden"
								>
									<Icon name="close" size={16} />
								</button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{@render restore()}
	</Alert>
{:else if hidden.length > 0}
	<div class="alone">{@render restore()}</div>
{/if}

<style>
	.hints {
		margin: 0.25rem 0 0;
		padding-left: 1.25rem;
	}
	.hints li {
		margin: 0.25rem 0;
	}
	.hint {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.hint > span {
		flex: 1;
		min-width: 0;
	}
	.hint form {
		flex: none;
		margin: -0.375rem -0.5rem -0.375rem 0;
	}
	.dismiss {
		min-height: 2rem;
		width: 2rem;
	}
	.restore {
		margin: 0.5rem 0 0;
	}
	.alone {
		margin: 0 0 1.5rem;
	}
</style>
