<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/Alert.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PreviewLink from '#lib/components/PreviewLink.svelte';
	import { dayOf, formatDate } from '#lib/dates.ts';
	import { leaseTenantName } from '#lib/domain/addressee.ts';
	import { PORTAL_MONTHS_AFTER_END } from '#lib/domain/tenant-portal.ts';
	import { qrPath } from '#lib/domain/qr.ts';
	import { formatNumber } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const viewer = $derived(data.role === 'viewer');
	const linkUrl = $derived(form && 'linkUrl' in form ? (form.linkUrl ?? '') : '');
	const qr = $derived(linkUrl ? qrPath(linkUrl) : undefined);
	const names = $derived(leaseTenantName(data.lease.tenants) ?? '');
	const email = $derived(data.lease.tenants.map((tenant) => tenant.email).find(Boolean) ?? '');
	const mail = $derived(
		linkUrl
			? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Ihr Mieterportal für ${data.lease.unit.name}`)}&body=${encodeURIComponent(
					`Guten Tag ${names},\n\nüber diesen Link sehen Sie Ihre Betriebskostenabrechnungen und Dokumente zu Ihrem Mietvertrag und können Zählerstände und Schäden melden:\n\n${linkUrl}\n\nBitte geben Sie den Link nicht weiter.\n\nMit freundlichen Grüßen`
				)}`
			: ''
	);
	const shared = $derived(data.documents.filter((document) => document.shared).length);

	let copied = $state(false);
	async function copy(url: string) {
		await navigator.clipboard.writeText(url);
		copied = true;
	}
</script>

<h2 class="visually-hidden">Mieterportal</h2>

<div class="card">
	<p>
		Über einen geheimen Link sehen die Mieter ihre Betriebskostenabrechnungen, sobald du die
		Zustellung eingetragen hast, und die Dokumente, die du unten freigibst. Sie melden dort
		Zählerstände und Schäden, ohne Konto. mietkartei verschickt den Link nicht: Du gibst ihn selbst
		weiter, etwa als QR-Code auf einem Brief, per E-Mail oder Messenger.
	</p>
	<p class="muted small">
		Der Link gilt, solange der Mietvertrag läuft, und noch {PORTAL_MONTHS_AFTER_END} Monate nach seinem
		Ende{data.openUntil ? `, also bis zum ${formatDate(data.openUntil)}` : ''}. Ein neuer Link
		ersetzt den alten.
	</p>
	{#if linkUrl}
		<Alert tone="success">
			<p>Der Link wird nur jetzt angezeigt; kopiere oder drucke ihn gleich.</p>
			<div class="share">
				{#if qr}
					<svg viewBox="0 0 {qr.size} {qr.size}" role="img" aria-label="QR-Code des Links">
						<path d={qr.path} />
					</svg>
				{/if}
				<div>
					<p>
						<input class="link" readonly value={linkUrl} aria-label="Link zum Mieterportal" />
					</p>
					<div class="toolbar">
						<button type="button" class="secondary" onclick={() => copy(linkUrl)}
							>{copied ? 'Kopiert' : 'Link kopieren'}</button
						>
						<a class="button secondary" href={mail}>Als E-Mail vorbereiten</a>
						<button type="button" class="secondary" onclick={() => print()}>Drucken</button>
					</div>
				</div>
			</div>
		</Alert>
	{:else if data.link}
		<p class="muted">Ein Link ist aktiv seit {formatDate(dayOf(data.link.createdAt))}.</p>
	{:else if form && 'revoked' in form}
		<p class="muted">Der Link ist gesperrt.</p>
	{/if}
	{#if !viewer}
		<div class="toolbar">
			<form method="POST" action="?/link" use:enhance>
				<button type="submit">{data.link ? 'Neuen Link erstellen' : 'Link erstellen'}</button>
			</form>
			{#if data.link}
				<form method="POST" action="?/revoke" use:enhance>
					<button type="submit" class="secondary">Link sperren</button>
				</form>
			{/if}
		</div>
	{/if}
</div>

<h2>Gemeldete Zählerstände</h2>
{#if data.meterReports.length === 0}
	<p class="muted">Keine offenen Meldungen.</p>
{:else}
	<div class="table-wrap">
		<table class="table" aria-label="Gemeldete Zählerstände">
			<thead>
				<tr>
					<th>Zähler</th>
					<th>Abgelesen am</th>
					<th class="num">Stand</th>
					<th>Foto</th>
					<th><span class="visually-hidden">Aktionen</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.meterReports as report (report.id)}
					<tr>
						<td>
							{report.meter}
							{#if report.note}<div class="muted small">{report.note}</div>{/if}
							{#if form && 'reportId' in form && form.reportId === report.id}
								<div class="error small">{form.message}</div>
							{/if}
						</td>
						<td>{formatDate(report.readAt)}</td>
						<td class="num">{formatNumber(report.value)} {report.unit}</td>
						<td>
							{#if report.documentId}
								<PreviewLink
									href="/dokumente/{report.documentId}/herunterladen?inline=1"
									download="/dokumente/{report.documentId}/herunterladen"
									title="Zählerfoto {report.meter}"
									image>Foto</PreviewLink
								>
							{:else}<span class="muted">–</span>{/if}
						</td>
						<td class="actions">
							{#if !viewer}
								<form method="POST" action="?/accept" use:enhance>
									<input type="hidden" name="reportId" value={report.id} />
									<button type="submit" class="small">Übernehmen</button>
								</form>
								<form method="POST" action="?/discard" use:enhance>
									<input type="hidden" name="reportId" value={report.id} />
									<button type="submit" class="small secondary">Verwerfen</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>Schadensmeldungen</h2>
{#if data.damages.length === 0}
	<p class="muted">Noch keine. Eine Meldung erscheint als Reparatur unter Aufgaben.</p>
{:else}
	<ul class="plain">
		{#each data.damages as damage (damage.id)}
			<li>
				<a href="/aufgaben?bearbeiten={damage.id}">{damage.title}</a>
				<span class="muted small">gemeldet am {formatDate(dayOf(damage.createdAt))}</span>
				{#if damage.done}<Badge tone="success">erledigt</Badge>{:else}<Badge tone="warning"
						>offen</Badge
					>{/if}
			</li>
		{/each}
	</ul>
{/if}

<h2>Dokumente im Mieterportal</h2>
{#if data.documents.length === 0}
	<EmptyState
		title="Noch keine Dokumente zu diesem Mietvertrag"
		text="Lade sie im Reiter Dokumente hoch und gib sie hier frei."
	/>
{:else}
	<p class="muted">
		{shared === 0
			? 'Die Mieter sehen noch kein Dokument.'
			: `Die Mieter sehen ${shared === 1 ? 'ein Dokument' : `${shared} Dokumente`}.`}
		Abrechnungen erscheinen von selbst.
	</p>
	<ul class="plain">
		{#each data.documents as document (document.id)}
			<li>
				<form method="POST" action="?/share" use:enhance>
					<input type="hidden" name="documentId" value={document.id} />
					<input type="hidden" name="shared" value={document.shared ? '0' : '1'} />
					<button
						type="submit"
						class="secondary small"
						disabled={viewer}
						aria-pressed={document.shared ? 'true' : 'false'}
						aria-label="{document.name} im Mieterportal zeigen"
						>{document.shared ? '✓' : '○'}</button
					>
				</form>
				<span>{document.name}</span>
				<span class="muted small"
					>{formatDate(dayOf(document.createdAt))}{document.fromTenant ? ' · vom Mieter' : ''}</span
				>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.share {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
	}
	.share svg {
		flex: none;
		width: 8rem;
		height: 8rem;
		padding: 0.5rem;
		background: #fff;
		fill: #000;
		shape-rendering: crispEdges;
	}
	.share > div {
		flex: 1 1 16rem;
		min-width: 0;
	}
	.link {
		width: 100%;
	}
	.plain {
		list-style: none;
		padding: 0;
	}
	.plain li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}
</style>
