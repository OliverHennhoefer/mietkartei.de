<script lang="ts" generics="T, K extends string">
	import type { Snippet } from 'svelte';
	import type { TableSort } from '#lib/table-sort.svelte.ts';

	// A column heading that sorts its table on click. It looks like any other heading: the arrow
	// shows only on hover, on focus and while the table is sorted by this column.
	let {
		sort,
		key,
		class: className,
		children,
		after
	}: {
		sort: TableSort<T, K>;
		key: K;
		class?: string;
		children: Snippet;
		/** Shown below the heading, outside the button: a legend of the column. */
		after?: Snippet;
	} = $props();

	const sorted = $derived(sort.key === key);
	// Unsorted, the arrow on hover points the way the first click sorts.
	const direction = $derived(sorted ? sort.direction : sort.first(key));
</script>

<th class={className} aria-sort={sort.ariaSort(key)}>
	<button type="button" class="sort-header" class:sorted onclick={() => sort.toggle(key)}
		>{@render children()}<svg
			class="arrow"
			class:desc={direction === 'desc'}
			viewBox="0 0 24 24"
			aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg
		></button
	>{@render after?.()}
</th>

<style>
	.sort-header {
		all: unset;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		cursor: pointer;
		color: inherit;
		font: inherit;
		white-space: nowrap;
	}
	th:global(.num) .sort-header {
		flex-direction: row-reverse;
	}
	.sort-header:hover,
	.sorted {
		color: var(--color-text);
	}
	.sort-header:focus-visible {
		outline: 2px solid var(--color-text);
		outline-offset: 2px;
		border-radius: 2px;
	}
	.arrow {
		width: 0.85em;
		height: 0.85em;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0;
		transition:
			opacity 120ms,
			transform 120ms;
	}
	.arrow.desc {
		transform: rotate(180deg);
	}
	.sort-header:hover .arrow,
	.sort-header:focus-visible .arrow {
		opacity: 0.45;
	}
	.sorted .arrow,
	.sorted:hover .arrow {
		opacity: 1;
	}
</style>
