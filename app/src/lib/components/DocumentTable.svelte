<script lang="ts">
	import ConfirmButton from './ConfirmButton.svelte';
	import DocumentLink from './DocumentLink.svelte';
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
	// upload time, the links as text, download and delete. `deleteAction` is the page's action
	// that takes the hidden `documentId`; `omit` hides link kinds the page already shows.
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
					<td><DocumentLink {document} /></td>
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
							<ConfirmButton
								action={deleteAction}
								label="Löschen"
								small
								message={`Dokument „${document.name}“ wirklich löschen?`}
							>
								<input type="hidden" name="documentId" value={document.id} />
							</ConfirmButton>
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.links {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.125rem;
	}
</style>
