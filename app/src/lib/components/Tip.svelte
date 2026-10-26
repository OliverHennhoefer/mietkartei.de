<script lang="ts">
	// A (?) next to a field title: the help text shows on hover, and on click, tap or Enter until
	// the next click, Escape or leaving the button. The bubble is positioned against the nearest
	// positioned ancestor, the field, so it spans the field's width and stays on screen on phones.
	// The button is named "Hinweis" alone: with the field title in its name it would match the
	// field's label too. The help text is its description.
	let { text }: { text: string } = $props();

	const id = $props.id();
	// Pinned by a click or tap; shown while the mouse rests on it. Escape hides both (WCAG 1.4.13).
	let open = $state(false);
	let hover = $state(false);
	let root: HTMLElement;
</script>

<svelte:window
	onclick={(event) => {
		if (open && !root.contains(event.target as Node)) open = false;
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') open = hover = false;
	}}
/>

<span
	class="tip"
	class:open={open || hover}
	bind:this={root}
	role="presentation"
	onpointerenter={(event) => {
		if (event.pointerType === 'mouse') hover = true;
	}}
	onpointerleave={() => (hover = false)}
>
	<button
		type="button"
		aria-label="Hinweis"
		aria-expanded={open}
		aria-describedby={id}
		onclick={() => (open = !open)}
		onblur={() => (open = false)}
	>
		<span class="mark" aria-hidden="true">?</span>
	</button>
	<span class="bubble" role="tooltip" {id}>{text}</span>
</span>

<style>
	.tip {
		display: inline-flex;
	}
	/* Not the dark default button: the global hover background would fill the circle. */
	.tip button {
		display: inline-grid;
		align-self: center;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		min-height: 0;
		margin: -0.3rem 0;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--color-muted);
		cursor: help;
	}
	button:focus-visible {
		outline-offset: 0;
	}
	.mark {
		display: inline-grid;
		place-items: center;
		width: 1rem;
		height: 1rem;
		border: 1.5px solid currentColor;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1;
	}
	.tip button:hover,
	.tip.open button {
		background: transparent;
		color: var(--color-text);
	}
	.bubble {
		display: none;
		position: absolute;
		top: 1.6rem;
		left: 0;
		z-index: 30;
		width: max-content;
		max-width: min(24rem, 100%);
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface);
		box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
		color: var(--color-text);
		font-size: 0.85rem;
		font-weight: 400;
		line-height: 1.45;
		white-space: normal;
	}
	.open .bubble {
		display: block;
	}
</style>
