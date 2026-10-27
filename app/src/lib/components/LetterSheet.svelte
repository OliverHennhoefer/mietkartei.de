<script lang="ts">
	import type { Letter, LetterBlock, PdfTable } from '#lib/server/pdf.ts';

	// A letter as an A4 sheet in HTML, laid out like renderLetter draws it (DIN 5008 form B, the
	// measures of pdf.ts), so its text can be edited where it stands. The paragraphs are editable;
	// sender, recipient, date, subject, tables and closing come from the data and stay as they are.
	// A longer letter makes the sheet longer instead of starting a second page.
	let {
		letter,
		paragraphs = $bindable()
	}: {
		letter: Letter & { blocks: LetterBlock[] };
		/** The text of each paragraph block, in order. */
		paragraphs: string[];
	} = $props();

	/** The blocks, each paragraph with its index in `paragraphs`. */
	const blocks = $derived.by(() => {
		let index = 0;
		return letter.blocks.map((block) =>
			'paragraph' in block ? { paragraph: index++ } : { table: block.table }
		);
	});

	/** Column widths as percentages, like columnWidths in pdf.ts. */
	function widths(table: PdfTable): number[] {
		const given = table.columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
		const missing = table.columns.filter((column) => column.width === undefined).length;
		const share = missing ? Math.max(0, 1 - given) / missing : 0;
		const scale = 100 / Math.max(1, given);
		return table.columns.map((column) => (column.width ?? share) * scale);
	}

	let width = $state(0);
	/** 210 mm at 96 dpi; the sheet is scaled down to fit narrower dialogs, by its units. */
	const scale = $derived(width ? Math.min(1, (width - 32) / 793.7) : 1);
</script>

<div class="desk" bind:clientWidth={width}>
	<article class="sheet" style:--scale={scale} aria-label={letter.subject}>
		<div class="sender">
			{#each letter.sender as line, index (index)}<div>{line}</div>{/each}
		</div>
		{#if letter.sender[0]}<div class="return-address">{letter.sender[0]}</div>{/if}
		<div class="recipient">
			{#each letter.recipient as line, index (index)}<div>{line}</div>{/each}
		</div>
		<div class="date">{letter.date}</div>

		<div class="body">
			<p class="subject">{letter.subject}</p>
			{#each blocks as block, index (index)}
				{#if 'paragraph' in block && block.paragraph !== undefined}
					<p
						class="editable"
						contenteditable="plaintext-only"
						spellcheck="true"
						lang="de"
						aria-label="Absatz {block.paragraph + 1}"
						bind:innerText={paragraphs[block.paragraph]}
					></p>
				{:else if block.table}
					{@const columns = widths(block.table)}
					<table>
						<colgroup>
							{#each columns as share, column (column)}<col style:width="{share}%" />{/each}
						</colgroup>
						<thead>
							<tr>
								{#each block.table.columns as column, column_index (column_index)}
									<th class:right={column.align === 'right'}>{column.label}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each block.table.rows as row, row_index (row_index)}
								<tr>
									{#each row as cell, cell_index (cell_index)}
										<td class:right={block.table.columns[cell_index]?.align === 'right'}>{cell}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
						{#if block.table.footer}
							<tfoot>
								<tr>
									{#each block.table.footer as cell, cell_index (cell_index)}
										<td class:right={block.table.columns[cell_index]?.align === 'right'}>{cell}</td>
									{/each}
								</tr>
							</tfoot>
						{/if}
					</table>
				{/if}
			{/each}
			{#if letter.closing}
				<div class="closing">
					{#each letter.closing as line, index (index)}<div>{line || ' '}</div>{/each}
				</div>
			{/if}
		</div>
	</article>
</div>

<style>
	.desk {
		padding: 1rem;
	}
	/* Paper stays white with black text in the dark theme too, as the printed letter will be. */
	.sheet {
		--mm: calc(1mm * var(--scale));
		--pt: calc(1pt * var(--scale));
		position: relative;
		width: calc(210 * var(--mm));
		min-height: calc(297 * var(--mm));
		margin: 0 auto;
		padding: 0 calc(20 * var(--mm)) calc(20 * var(--mm));
		box-sizing: border-box;
		background: #fff;
		color: #000;
		box-shadow: 0 2px 12px rgb(0 0 0 / 18%);
		font-family: Helvetica, Arial, sans-serif;
		font-size: calc(10.5 * var(--pt));
		line-height: calc(14 * var(--pt));
		text-align: left;
		white-space: normal;
	}
	.sender {
		position: absolute;
		top: calc(25 * var(--mm));
		right: calc(20 * var(--mm));
		text-align: right;
	}
	.return-address {
		position: absolute;
		top: calc(45 * var(--mm));
		left: calc(20 * var(--mm));
		color: #666;
		font-size: calc(7.5 * var(--pt));
		line-height: calc(7.5 * var(--pt));
	}
	.recipient {
		position: absolute;
		top: calc(50 * var(--mm));
		left: calc(20 * var(--mm));
	}
	.date {
		position: absolute;
		top: calc(50 * var(--mm));
		right: calc(20 * var(--mm));
	}
	.body {
		padding-top: calc(98.5 * var(--mm));
	}
	p {
		margin: 0 0 calc(14 * var(--pt));
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.subject {
		font-weight: bold;
	}
	.editable {
		margin-inline: calc(-2 * var(--mm));
		padding-inline: calc(2 * var(--mm));
		border-radius: 3px;
		outline: 1px dashed transparent;
		cursor: text;
		transition:
			background 120ms,
			outline-color 120ms;
	}
	.editable:hover {
		background: #fff8d6;
		outline-color: #d9c66a;
	}
	.editable:focus {
		background: #fffbe8;
		outline: 1px solid #c9a800;
	}
	table {
		width: 100%;
		margin-bottom: calc(14 * var(--pt));
		border-collapse: collapse;
		table-layout: fixed;
	}
	th,
	td {
		height: auto;
		background: none;
		color: inherit;
		font-size: inherit;
		font-weight: inherit;
		letter-spacing: normal;
		text-transform: none;
		line-height: inherit;
		padding: calc(2.5 * var(--pt)) calc(3 * var(--pt));
		vertical-align: top;
		text-align: left;
		overflow-wrap: anywhere;
	}
	th {
		border-bottom: calc(0.5 * var(--pt)) solid #666;
		font-weight: bold;
	}
	tfoot td {
		border-top: calc(0.5 * var(--pt)) solid #666;
		font-weight: bold;
	}
	.right {
		text-align: right;
	}
</style>
