<script lang="ts">
	import { page } from '$app/state';
	import DocumentLink from './DocumentLink.svelte';
	import EditDialog from './EditDialog.svelte';
	import Icon from './Icon.svelte';
	import PreviewLink from './PreviewLink.svelte';
	import { formatDateTime } from '../dates';
	import {
		canInline,
		describeDocumentLinks,
		documentTypeLabel,
		formatFileSize,
		linkKindLabels,
		type DocumentLinkIds,
		type DocumentLinkOptions,
		type LinkKind
	} from '../domain/documents';

	// The list of documents on /dokumente and on a lease's Dokumente tab: name, type, size,
	// upload time, the links as text, view and download. The name opens the document's dialog
	// (?bearbeiten=<id>, the page's other parameters kept) with "Löschen". `deleteAction` is the
	// page's action that takes the hidden `documentId`; `omit` hides link kinds the page already
	// shows.
	type Row = DocumentLinkIds & {
		id: string;
		name: string;
		mimeType: string;
		size: number;
		createdAt: Date;
	};

	let {
		documents,
		options,
		deleteAction,
		omit = []
	}: {
		documents: Row[];
		options: DocumentLinkOptions;
		deleteAction: string;
		omit?: LinkKind[];
	} = $props();

	/** The page with its query, and the dialog of a document or none. */
	function withDocument(id?: string) {
		const query = new URLSearchParams(page.url.search);
		if (id) query.set('bearbeiten', id);
		else query.delete('bearbeiten');
		const search = query.toString();
		return `${page.url.pathname}${search ? `?${search}` : ''}`;
	}
	const opened = $derived(
		documents.find((document) => document.id === page.url.searchParams.get('bearbeiten'))
	);
</script>

<div class="table-wrap">
	<table class="table" aria-label="Dokumente">
		<thead>
			<tr>
				<th>Name</th>
				<th>Art</th>
				<th class="num">Größe</th>
				<th>Hochgeladen</th>
				<th>Verknüpft mit</th>
				<th class="actions"></th>
			</tr>
		</thead>
		<tbody>
			{#each documents as document (document.id)}
				{@const links = describeDocumentLinks(document, options, omit)}
				<tr>
					<td>
						<a href={withDocument(document.id)} data-sveltekit-reset="false">{document.name}</a>
					</td>
					<td>{documentTypeLabel(document.mimeType)}</td>
					<td class="num">{formatFileSize(document.size)}</td>
					<td>{formatDateTime(document.createdAt)}</td>
					<td>
						{#if links.length === 0}
							<span class="muted">–</span>
						{:else}
							<ul class="links">
								{#each links as link (link.kind)}
									<li>
										<span class="muted small">{linkKindLabels[link.kind]}</span>
										<a href={link.href}>{link.label}</a>
									</li>
								{/each}
							</ul>
						{/if}
					</td>
					<td class="actions">
						<div class="row-actions">
							{#if canInline(document.mimeType)}
								<PreviewLink
									href="/dokumente/{document.id}/herunterladen?inline=1"
									download="/dokumente/{document.id}/herunterladen"
									title={document.name}
									image={document.mimeType.startsWith('image/')}
									class="button secondary small"><Icon name="file" size={14} /> Ansehen</PreviewLink
								>
							{/if}
							<a href="/dokumente/{document.id}/herunterladen" class="button secondary small">
								<Icon name="download" size={14} /> Herunterladen
							</a>
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if opened}
	{@const links = describeDocumentLinks(opened, options, omit)}
	{#key opened.id}
		<EditDialog
			title={opened.name}
			{deleteAction}
			deleteMessage={`Dokument „${opened.name}“ wirklich löschen?`}
			close={withDocument()}
		>
			<input type="hidden" name="documentId" value={opened.id} />
			<dl class="details">
				<dt>Art</dt>
				<dd>{documentTypeLabel(opened.mimeType)}, {formatFileSize(opened.size)}</dd>
				<dt>Hochgeladen</dt>
				<dd>{formatDateTime(opened.createdAt)}</dd>
				{#each links as link (link.kind)}
					<dt>{linkKindLabels[link.kind]}</dt>
					<dd><a href={link.href}>{link.label}</a></dd>
				{/each}
				<dt>Datei</dt>
				<dd><DocumentLink document={opened} /></dd>
			</dl>
		</EditDialog>
	{/key}
{/if}

<style>
	.links {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.125rem;
	}
</style>
