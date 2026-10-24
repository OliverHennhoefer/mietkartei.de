<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import { formatDateTime } from '#lib/dates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const refused = $derived(form && 'refused' in form ? form.refused : undefined);
	const created = $derived(form && 'created' in form ? form.created : undefined);

	const scopeLabels: Record<string, string> = { read: 'Nur lesen', write: 'Lesen und schreiben' };
	let copied = $state(false);

	async function copy(text: string) {
		// The clipboard needs https; over plain http the key is selected by hand.
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
		} catch {
			copied = false;
		}
	}
</script>

<PageHeader
	title="API-Schlüssel"
	lead="Damit greifen eigene Programme oder ein KI-Assistent wie Claude auf deine Daten zu."
/>

{#if refused}
	<Alert tone="danger"><p>{refused}</p></Alert>
{:else if form && 'revoked' in form}
	<Alert tone="success"><p>Der API-Schlüssel wurde widerrufen.</p></Alert>
{/if}

{#if created}
	<section class="card created">
		<h2>Dein neuer Schlüssel „{created.name}“</h2>
		<p>
			Kopiere ihn jetzt. Wir zeigen ihn nur dieses eine Mal an und speichern ihn nicht im Klartext.
		</p>
		<div class="key">
			<code>{created.key}</code>
			<button type="button" class="secondary small" onclick={() => copy(created.key)}>
				{copied ? 'Kopiert' : 'Kopieren'}
			</button>
		</div>
		<h3>Claude Code</h3>
		<pre><code
				>claude mcp add --transport http mietkartei {data.origin}/mcp --header "Authorization: Bearer {created.key}"</code
			></pre>
		<h3>Andere MCP-Clients (Claude Desktop, Cursor)</h3>
		<pre><code
				>{JSON.stringify(
					{
						mcpServers: {
							mietkartei: {
								command: 'npx',
								args: [
									'mcp-remote',
									`${data.origin}/mcp`,
									'--header',
									`Authorization: Bearer ${created.key}`
								]
							}
						}
					},
					null,
					2
				)}</code
			></pre>
		<h3>REST-API</h3>
		<pre><code>curl -H "Authorization: Bearer {created.key}" {data.origin}/api/v1/leases</code
			></pre>
	</section>
{/if}

<h2>Deine Schlüssel</h2>
{#if data.keys.length === 0}
	<p class="muted">Du hast noch keinen API-Schlüssel.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="API-Schlüssel">
			<thead>
				<tr>
					<th>Name</th>
					<th>Schlüssel</th>
					<th>Rechte</th>
					<th>Gültig bis</th>
					<th>Zuletzt genutzt</th>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.keys as key (key.id)}
					<tr>
						<td>{key.name}</td>
						<td><code>{key.prefix}…</code></td>
						<td>{scopeLabels[key.scope]}</td>
						<td>{formatDateTime(key.expiresAt)}</td>
						<td>{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : '–'}</td>
						<td class="actions">
							<ConfirmButton
								action="?/revoke"
								label="Widerrufen"
								message="API-Schlüssel „{key.name}“ widerrufen? Programme, die ihn nutzen, haben dann keinen Zugriff mehr."
							>
								<input type="hidden" name="keyId" value={key.id} />
							</ConfirmButton>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Neuer Schlüssel</h2>
<p class="muted">
	Ein Schlüssel hat dieselben Rechte wie du und gibt Zugriff auf alle Daten deines Kontos, auch auf
	die persönlichen Daten deiner Mieter. Gib ihn nur Programmen, denen du vertraust. Wenn du dein
	Passwort änderst, werden alle deine Schlüssel widerrufen.
</p>
{#if data.scopes.length > 1}
	<p class="muted">
		Ein Schlüssel zum Schreiben darf zusätzlich Zahlungen buchen, Aufgaben anlegen und erledigen
		sowie Belege erfassen. Löschen oder ändern kann er nichts. Jede Änderung steht unter deinem
		Namen im Protokoll.
	</p>
{/if}
<form method="POST" action="?/create" class="card" use:enhance>
	<label>
		Name
		<input
			name="name"
			placeholder="z. B. Claude auf dem Laptop"
			defaultValue={values?.name ?? ''}
			aria-invalid={errors?.name ? 'true' : undefined}
			maxlength="100"
			required
		/>
		{#if errors?.name}<span class="error">{errors.name}</span>{/if}
	</label>
	{#if data.scopes.length > 1}
		<label>
			Rechte
			<select name="scope">
				{#each data.scopes as scope (scope)}
					<option value={scope} selected={(values?.scope ?? 'read') === scope}>
						{scopeLabels[scope]}
					</option>
				{/each}
			</select>
			{#if errors?.scope}<span class="error">{errors.scope}</span>{/if}
		</label>
	{/if}
	<label>
		Gültig für
		<select name="lifetimeDays">
			{#each data.lifetimes as days (days)}
				<option
					value={String(days)}
					selected={(values?.lifetimeDays ?? String(data.defaultLifetime)) === String(days)}
				>
					{days === 365 ? 'ein Jahr' : `${days} Tage`}
				</option>
			{/each}
		</select>
		{#if errors?.lifetimeDays}<span class="error">{errors.lifetimeDays}</span>{/if}
	</label>
	<div class="form-actions">
		<button type="submit">Schlüssel anlegen</button>
	</div>
</form>

<style>
	.created {
		margin-bottom: 1.5rem;
	}
	.created h2 {
		margin-top: 0;
	}
	.created h3 {
		margin: 1.25rem 0 0.5rem;
		font-size: 0.95rem;
	}
	.key {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.key code {
		word-break: break-all;
	}
	pre {
		margin: 0;
		padding: 0.75rem;
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-subtle);
		font-size: 0.8rem;
	}
	code {
		font-size: 0.85em;
	}
</style>
