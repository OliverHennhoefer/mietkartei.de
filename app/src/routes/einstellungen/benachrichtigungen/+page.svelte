<script lang="ts">
	import Field from '#lib/components/Field.svelte';
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import PasswordField from '#lib/components/PasswordField.svelte';
	import { formatDate, formatDateTime } from '#lib/dates.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const refused = $derived(form && 'refused' in form ? form.refused : undefined);
	const secret = $derived(form && 'secret' in form ? form.secret : undefined);
	let copied = $state(false);

	const kindLabels: Record<string, string> = { email: 'E-Mail', ntfy: 'ntfy', webhook: 'Webhook' };
	const hasEmail = $derived(data.channels.some((channel) => channel.kind === 'email'));
	const full = $derived(data.channels.length >= data.maxChannels);
	const channelName = (id: string) => {
		const channel = data.channels.find((candidate) => candidate.id === id);
		return channel ? kindLabels[channel.kind] : '–';
	};
	const hours = $derived(
		Array.from(
			{ length: data.hours.max - data.hours.min + 1 },
			(_, index) => data.hours.min + index
		)
	);

	async function copy(text: string) {
		// The clipboard needs https; over plain http the text is selected by hand.
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
		} catch {
			copied = false;
		}
	}
</script>

<PageHeader title="Benachrichtigungen" />

<Alert tone="info">
	<p>
		mietkartei meldet sich von selbst, wenn bei einer Frist oder Aufgabe etwas ansteht: einmal mit
		Vorlauf (bei der Betriebskostenabrechnung sechs Wochen, bei Aufgaben eine Woche), bei
		gesetzlichen Fristen noch einmal drei Tage vorher und einmal, wenn sie überfällig ist. Was an
		einem Tag zusammenkommt, kommt in einer Nachricht. Ist nichts neu, kommt nichts.
	</p>
</Alert>

{#if refused}
	<Alert tone="danger"><p>{refused}</p></Alert>
{:else if form && 'tested' in form}
	<Alert tone="success"><p>Der Test ist angekommen.</p></Alert>
{:else if form && 'removed' in form}
	<Alert tone="success"><p>Der Kanal ist entfernt.</p></Alert>
{:else if form && 'added' in form && !secret}
	<Alert tone="success">
		<p>Der Kanal ist eingerichtet. Mit „Test senden“ prüfst du, ob Hinweise ankommen.</p>
	</Alert>
{/if}

{#if secret}
	<section class="card created">
		<h2>Der Schlüssel deines Webhooks</h2>
		<p>
			Jede Anfrage trägt die Kopfzeile <code>X-Mietkartei-Signature</code>, signiert mit diesem
			Schlüssel. Kopiere ihn jetzt in den Empfänger; er wird nur dieses eine Mal angezeigt.
		</p>
		<div class="key">
			<code>{secret}</code>
			<button type="button" class="secondary small" onclick={() => copy(secret)}>
				{copied ? 'Kopiert' : 'Kopieren'}
			</button>
		</div>
	</section>
{/if}

<h2>Wann</h2>
<form
	method="POST"
	action="?/timing"
	class="timing"
	use:enhance={() =>
		({ update }) =>
			update({ reset: false })}
>
	<Field label="Uhrzeit">
		<select name="hour">
			{#each hours as hour (hour)}
				<option value={String(hour)} selected={data.hour === hour}>ab {hour} Uhr</option>
			{/each}
		</select>
	</Field>
	<label class="inline">
		<input type="checkbox" name="weekends" checked={data.weekends} />
		Auch am Wochenende
	</label>
	<p class="muted hint">
		Ohne Wochenende kommt, was am Samstag oder Sonntag ansteht, am Montag zur gewählten Uhrzeit.
	</p>
	{#if form && 'timingSaved' in form}
		<Alert tone="success"><p>Gespeichert.</p></Alert>
	{/if}
	<div class="form-actions">
		<button type="submit">Speichern</button>
	</div>
</form>

<h2>Kanäle</h2>
{#if data.demo}
	<p class="muted">In der Demo werden keine Hinweise verschickt; der Verlauf unten ist erfunden.</p>
{/if}
{#if data.channels.length === 0}
	<p class="muted">Noch kein Kanal eingerichtet. Ohne Kanal kommen keine Hinweise.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Kanäle">
			<thead>
				<tr>
					<th>Kanal</th>
					<th>Ziel</th>
					<th>Was</th>
					<th>Stand</th>
					<th class="actions"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.channels as channel (channel.id)}
					<tr>
						<td>{kindLabels[channel.kind]}</td>
						<td class="target">{channel.kind === 'email' ? data.email : channel.url}</td>
						<td>
							{channel.urgentOnly ? 'Nur Dringendes' : 'Alle Hinweise'}{channel.kind !== 'email' &&
							channel.details
								? ', mit Namen'
								: ''}
						</td>
						<td>
							{#if channel.failures >= data.maxFailures}
								<span class="error">Pausiert: {channel.lastError}</span>
							{:else if channel.failures > 0}
								<span class="error">Fehler: {channel.lastError}</span>
							{:else if channel.lastSentAt}
								Zuletzt {formatDateTime(channel.lastSentAt)}
							{:else}
								<span class="muted">Noch nichts verschickt</span>
							{/if}
						</td>
						<td class="actions">
							<form method="POST" action="?/test" use:enhance>
								<input type="hidden" name="channelId" value={channel.id} />
								<button type="submit" class="secondary small">Test senden</button>
							</form>
							<ConfirmButton
								action="?/remove"
								small
								label="Entfernen"
								message="Diesen Kanal entfernen? Über ihn kommen dann keine Hinweise mehr."
							>
								<input type="hidden" name="channelId" value={channel.id} />
							</ConfirmButton>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if data.channels.some((channel) => channel.failures >= data.maxFailures)}
		<p class="muted">
			Nach {data.maxFailures} Fehlern in Folge pausiert ein Kanal. Ein erfolgreicher Test schaltet ihn
			wieder ein.
		</p>
	{/if}
{/if}

{#if !full}
	<h2>Kanal hinzufügen</h2>
	<div class="channels">
		{#if !hasEmail}
			<form method="POST" action="?/add" class="card" use:enhance>
				<h3>E-Mail</h3>
				<p class="muted">An {data.email}, mit Mieternamen und Links in die App.</p>
				<input type="hidden" name="kind" value="email" />
				<label class="inline">
					<input type="checkbox" name="urgentOnly" />
					Nur Dringendes (kurz vor gesetzlichen Fristen und überfällig)
				</label>
				<div class="form-actions">
					<button type="submit">Hinweise per E-Mail</button>
				</div>
			</form>
		{/if}

		<form method="POST" action="?/add" class="card" use:enhance>
			<h3>Push aufs Handy mit ntfy</h3>
			<p class="muted">
				Die kostenlose App ntfy (Android, iPhone) zeigt Hinweise als Mitteilung. Wähle dort ein
				Thema mit einem Namen, den niemand errät, und trage seine Adresse hier ein. Ohne „mit Namen“
				gehen nur Art, Datum und Link mit.
			</p>
			<input type="hidden" name="kind" value="ntfy" />
			<Field label="Adresse des Themas">
				<input
					name="url"
					type="url"
					placeholder="https://ntfy.sh/mietkartei-7f3k9q"
					maxlength="500"
					required
				/>
			</Field>
			<PasswordField
				label="Zugangstoken (nur bei geschütztem Thema)"
				subject="Token"
				name="token"
				autocomplete="off"
				maxlength={200}
			/>
			<label class="inline">
				<input type="checkbox" name="urgentOnly" checked />
				Nur Dringendes
			</label>
			<label class="inline">
				<input type="checkbox" name="details" />
				Mit Namen der Mieter
			</label>
			<div class="form-actions">
				<button type="submit">ntfy hinzufügen</button>
			</div>
		</form>

		<form method="POST" action="?/add" class="card" use:enhance>
			<h3>Webhook</h3>
			<p class="muted">
				mietkartei schickt jeden Hinweis als JSON an diese Adresse, signiert mit einem Schlüssel. So
				verbindest du n8n, Make, Zapier, Home Assistant oder Slack, und über sie auch WhatsApp oder
				Telegram.
				<a href="https://docs.mietkartei.de/anleitungen/benachrichtigungen/">Anleitung</a>
			</p>
			<input type="hidden" name="kind" value="webhook" />
			<Field label="Adresse">
				<input
					name="url"
					type="url"
					placeholder="https://n8n.example.de/webhook/mietkartei"
					maxlength="500"
					required
				/>
			</Field>
			{#if data.allowHttp}
				<p class="muted hint">Auch http geht, etwa für Home Assistant im eigenen Netz.</p>
			{/if}
			<label class="inline">
				<input type="checkbox" name="urgentOnly" />
				Nur Dringendes
			</label>
			<label class="inline">
				<input type="checkbox" name="details" />
				Mit Namen der Mieter
			</label>
			<div class="form-actions">
				<button type="submit">Webhook hinzufügen</button>
			</div>
		</form>
	</div>
{/if}

{#if data.history.length > 0}
	<h2>Verlauf</h2>
	<div class="table-wrap">
		<table class="table" aria-label="Verlauf">
			<thead>
				<tr>
					<th>Zeit</th>
					<th>Kanal</th>
					<th>Inhalt</th>
					<th>Ergebnis</th>
				</tr>
			</thead>
			<tbody>
				{#each data.history as delivery (delivery.id)}
					<tr>
						<td>{formatDateTime(delivery.createdAt)}</td>
						<td>{channelName(delivery.channelId)}</td>
						<td>{delivery.summary}</td>
						<td>
							{#if delivery.error}
								<span class="error">{delivery.error}</span>
							{:else}
								Zugestellt
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Wöchentliche Übersicht per E-Mail</h2>
<p>
	Jeden Montag eine Übersicht an {data.email}: die Fristen und deine offenen Aufgaben, die
	überfällig sind oder in den nächsten zwei Wochen anstehen, jeweils mit Link. Steht nichts an,
	kommt keine E-Mail.
</p>
{#if data.deadlineMail.on}
	<p>
		Die wöchentliche Übersicht ist eingeschaltet{data.deadlineMail.sentOn
			? `; zuletzt am ${formatDate(data.deadlineMail.sentOn)}`
			: ''}.
	</p>
{/if}
{#if form && 'mailSaved' in form}
	<Alert tone="success">
		<p>
			{form.mailSaved
				? 'Die wöchentliche Übersicht ist eingeschaltet. Die erste kommt mit dem nächsten Lauf, spätestens in einer Stunde.'
				: 'Die wöchentliche Übersicht ist ausgeschaltet.'}
		</p>
	</Alert>
{/if}
<form method="POST" action="?/mail" use:enhance class="form-actions">
	<input type="hidden" name="on" value={data.deadlineMail.on ? 'false' : 'true'} />
	<button type="submit" class={data.deadlineMail.on ? 'secondary' : undefined}>
		{data.deadlineMail.on ? 'Übersicht abbestellen' : 'Wöchentliche Übersicht einschalten'}
	</button>
</form>

<style>
	.created {
		margin-bottom: 1.5rem;
	}
	.timing label.inline {
		margin-top: 0.75rem;
	}
	.created h2 {
		margin-top: 0;
	}
	.channels {
		display: grid;
		gap: 1rem;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
	}
	.channels form.card {
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	.channels h3,
	.channels p {
		margin: 0;
	}
	.target {
		overflow-wrap: anywhere;
	}
	.actions form {
		display: inline;
	}
	.key {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.key code {
		word-break: break-all;
	}
</style>
