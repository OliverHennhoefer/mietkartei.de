<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import { formatDateTime } from '#lib/dates.ts';
	import { byDate, byText, TableSort } from '#lib/table-sort.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived(form && 'errors' in form ? form.errors : undefined);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const refused = $derived(form && 'refused' in form ? form.refused : undefined);
	const created = $derived(form && 'created' in form ? form.created : undefined);

	const scopeLabels: Record<string, string> = { read: 'Nur lesen', write: 'Lesen und schreiben' };
	// What was copied last: the server address or the new key.
	let copied = $state<'url' | 'key' | undefined>();

	type App = PageProps['data']['apps'][number];
	type Key = PageProps['data']['keys'][number];
	const appSort = new TableSort<App>({
		name: byText((app) => app.name),
		scope: byText((app) => scopeLabels[app.scope]),
		created: byDate((app) => app.createdAt),
		used: byDate((app) => app.lastUsedAt)
	});
	const keySort = new TableSort<Key>({
		name: byText((key) => key.name),
		prefix: byText((key) => key.prefix),
		scope: byText((key) => scopeLabels[key.scope]),
		expires: byDate((key) => key.expiresAt),
		used: byDate((key) => key.lastUsedAt)
	});

	async function copy(text: string, what: 'url' | 'key') {
		// The clipboard needs https; over plain http the text is selected by hand.
		try {
			await navigator.clipboard.writeText(text);
			copied = what;
		} catch {
			copied = undefined;
		}
	}
</script>

<PageHeader
	title="KI-Assistenten"
	lead="Verbinde Claude, ChatGPT oder einen anderen KI-Assistenten mit deinen Daten."
/>

{#if refused}
	<Alert tone="danger"><p>{refused}</p></Alert>
{:else if form && 'revoked' in form}
	<Alert tone="success"><p>Der Zugriff wurde widerrufen.</p></Alert>
{/if}

{#if created}
	<section class="card created">
		<h2>Dein neuer Schlüssel „{created.name}“</h2>
		<p>
			Kopiere ihn jetzt. Wir zeigen ihn nur dieses eine Mal an und speichern ihn nicht im Klartext.
		</p>
		<div class="key">
			<code>{created.key}</code>
			<button type="button" class="secondary small" onclick={() => copy(created.key, 'key')}>
				{copied === 'key' ? 'Kopiert' : 'Kopieren'}
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

<section class="card connect" aria-labelledby="connect-title">
	<h2 id="connect-title">Mit claude.ai, der Claude-App oder ChatGPT verbinden</h2>
	<p>
		Füge in deinem Assistenten einen eigenen Connector mit dieser Adresse hinzu. Beim Verbinden
		meldest du dich bei mietkartei an und wählst, ob der Assistent nur lesen oder auch eintragen
		darf. Einen Schlüssel brauchst du dafür nicht.
	</p>
	<div class="key address">
		<code>{data.origin}/mcp</code>
		<button type="button" class="secondary small" onclick={() => copy(`${data.origin}/mcp`, 'url')}>
			{copied === 'url' ? 'Kopiert' : 'Adresse kopieren'}
		</button>
	</div>
	<p class="muted">
		Danach fragst du etwa: „Wer ist mit der Miete im Rückstand?“, „Welche Fristen stehen in den
		nächsten drei Monaten an?“ oder „Trag die Grundsteuer 2026 über 612,40 € ein.“ Wie du andere
		Assistenten einrichtest und was der Assistent darf, steht in der
		<a href="https://docs.mietkartei.de/anleitungen/ki-assistenten/">Anleitung</a>.
	</p>
</section>

{#if data.apps.length > 0}
	<h2>Verbundene Apps</h2>
	<div class="table-wrap">
		<table class="table" aria-label="Verbundene Apps">
			<thead>
				<tr>
					<SortHeader sort={appSort} key="name">App</SortHeader>
					<SortHeader sort={appSort} key="scope">Rechte</SortHeader>
					<SortHeader sort={appSort} key="created">Verbunden seit</SortHeader>
					<SortHeader sort={appSort} key="used">Zuletzt genutzt</SortHeader>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each appSort.rows(data.apps) as app (app.id)}
					<tr>
						<td>{app.name}</td>
						<td>{scopeLabels[app.scope]}</td>
						<td>{formatDateTime(app.createdAt)}</td>
						<td>{app.lastUsedAt ? formatDateTime(app.lastUsedAt) : '–'}</td>
						<td class="actions">
							<ConfirmButton
								action="?/revoke"
								small
								label="Trennen"
								message="Verbindung mit „{app.name}“ trennen? Die App hat dann keinen Zugriff mehr."
							>
								<input type="hidden" name="keyId" value={app.id} />
							</ConfirmButton>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>API-Schlüssel</h2>
<p class="muted">
	Claude Code, Claude Desktop, Cursor und eigene Programme melden sich mit einem API-Schlüssel beim
	MCP-Server oder bei der REST-API an.
</p>
{#if data.keys.length === 0}
	<p class="muted">Du hast noch keinen API-Schlüssel.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="API-Schlüssel">
			<thead>
				<tr>
					<SortHeader sort={keySort} key="name">Name</SortHeader>
					<SortHeader sort={keySort} key="prefix">Schlüssel</SortHeader>
					<SortHeader sort={keySort} key="scope">Rechte</SortHeader>
					<SortHeader sort={keySort} key="expires">Gültig bis</SortHeader>
					<SortHeader sort={keySort} key="used">Zuletzt genutzt</SortHeader>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each keySort.rows(data.keys) as key (key.id)}
					<tr>
						<td>{key.name}</td>
						<td><code>{key.prefix}…</code></td>
						<td>{scopeLabels[key.scope]}</td>
						<td>{formatDateTime(key.expiresAt)}</td>
						<td>{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : '–'}</td>
						<td class="actions">
							<ConfirmButton
								action="?/revoke"
								small
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
	.created h2,
	.connect h2 {
		margin-top: 0;
	}
	.connect p {
		margin: 0 0 1rem;
	}
	.connect p:last-child {
		margin: 1rem 0 0;
	}
	.created h3 {
		margin: 1.25rem 0 0.5rem;
		font-size: var(--text-base);
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
		font-size: var(--text-xs);
	}
	code {
		font-size: 0.85em;
	}
</style>
