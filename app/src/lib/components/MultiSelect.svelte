<script lang="ts">
	import { untrack } from 'svelte';
	import { matchOptions, type MultiSelectOption } from '../multi-select';
	import Tip from './Tip.svelte';

	// A searchable multi select: the chosen values are pills with a remove button, the search field
	// opens a list of the remaining options. Each chosen value is submitted as a hidden input under
	// `name`, the same as a group of checkboxes.
	let {
		name,
		label,
		options,
		selected = [],
		placeholder = 'Suchen …',
		empty = 'Keine Treffer.',
		hint,
		error
	}: {
		name: string;
		label: string;
		options: MultiSelectOption[];
		selected?: string[];
		placeholder?: string;
		empty?: string;
		hint?: string;
		error?: string;
	} = $props();

	const id = $props.id();
	const inputId = `${id}-input`;
	const listId = `${id}-list`;

	// The initial selection only: afterwards the field holds the state.
	let chosen = $state(
		untrack(() => selected.filter((value) => options.some((o) => o.value === value)))
	);
	let query = $state('');
	let open = $state(false);
	let active = $state(0);
	let input: HTMLInputElement;

	const byValue = $derived(new Map(options.map((option) => [option.value, option])));
	const matches = $derived(matchOptions(options, chosen, query));
	const activeIndex = $derived(Math.min(active, matches.length - 1));

	function add(option: MultiSelectOption) {
		chosen.push(option.value);
		query = '';
		active = 0;
		input.focus();
	}

	function remove(value: string) {
		chosen = chosen.filter((v) => v !== value);
		input.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!open) open = true;
			else if (matches.length) active = (activeIndex + 1) % matches.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (matches.length) active = (activeIndex - 1 + matches.length) % matches.length;
		} else if (event.key === 'Enter') {
			// Enter picks the active option and never submits the form from the search field.
			event.preventDefault();
			if (open && matches[activeIndex]) add(matches[activeIndex]);
			else open = true;
		} else if (event.key === 'Escape' && open) {
			event.preventDefault();
			open = false;
		} else if (event.key === 'Backspace' && query === '' && chosen.length) {
			chosen = chosen.slice(0, -1);
		}
	}

	function onfocusout(event: FocusEvent) {
		const next = event.relatedTarget as Node | null;
		if (!next || !(event.currentTarget as HTMLElement).contains(next)) open = false;
	}
</script>

<div class="multi-select form-wide" {onfocusout}>
	<div class="title">
		<label for={inputId}>{label}</label>
		{#if hint}<Tip text={hint} />{/if}
	</div>
	<!-- A click on the free space of the box goes to the search field; the keyboard reaches it directly. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="box"
		class:invalid={!!error}
		onclick={(event) => {
			if (event.target === event.currentTarget) input.focus();
		}}
	>
		{#each chosen as value (value)}
			{@const option = byValue.get(value)}
			<span class="pill">
				{option?.label ?? value}
				<button
					type="button"
					aria-label="{option?.label ?? value} entfernen"
					onclick={() => remove(value)}
				>
					<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
						<path d="M6 6l12 12M18 6 6 18" />
					</svg>
				</button>
				<input type="hidden" {name} {value} />
			</span>
		{/each}
		<input
			bind:this={input}
			id={inputId}
			type="text"
			role="combobox"
			autocomplete="off"
			aria-expanded={open}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={open && matches.length ? `${id}-option-${activeIndex}` : undefined}
			aria-invalid={error ? 'true' : undefined}
			placeholder={chosen.length ? '' : placeholder}
			bind:value={query}
			oninput={() => {
				open = true;
				active = 0;
			}}
			onfocus={() => (open = true)}
			onclick={() => (open = true)}
			{onkeydown}
		/>
	</div>
	{#if open}
		<ul class="options" id={listId} role="listbox" aria-label={label}>
			{#each matches as option, index (option.value)}
				<!-- Options are picked with the arrow keys and Enter in the search field. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="{id}-option-{index}"
					role="option"
					aria-selected={index === activeIndex}
					class:active={index === activeIndex}
					onmousedown={(event) => event.preventDefault()}
					onmousemove={() => (active = index)}
					onclick={() => add(option)}
				>
					{option.label}
					{#if option.hint}<span class="muted small">{option.hint}</span>{/if}
				</li>
			{:else}
				<li class="none muted small" role="presentation">
					{options.length && matches.length === 0 && !query ? 'Alle gewählt.' : empty}
				</li>
			{/each}
		</ul>
	{/if}
	{#if error}<span class="error">{error}</span>{/if}
</div>

<style>
	.multi-select {
		position: relative;
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	label {
		display: inline;
		font-weight: 500;
		font-size: 0.85rem;
	}
	.box {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.75rem;
		padding: 0.3rem 0.4rem;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background-color: var(--color-surface);
		box-shadow: var(--shadow);
		cursor: text;
		transition:
			border-color 140ms,
			box-shadow 140ms;
	}
	.box:hover {
		border-color: color-mix(in srgb, var(--color-muted), var(--color-border) 50%);
	}
	.box:focus-within {
		border-color: var(--color-text);
		box-shadow: 0 0 0 3px var(--color-focus-ring);
	}
	.box.invalid {
		border-color: var(--color-danger);
	}
	/* The search field is part of the box: no border of its own. */
	.box input[type='text'] {
		flex: 1 1 8rem;
		width: auto;
		min-height: 2rem;
		padding: 0.15rem 0.4rem;
		border: 0;
		background: transparent;
		box-shadow: none;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.2rem 0.2rem 0.2rem 0.65rem;
		border-radius: 999px;
		background: var(--color-hover);
		font-size: 0.9rem;
		line-height: 1.3;
		max-width: 100%;
	}
	.pill button {
		display: inline-grid;
		align-self: center;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		min-height: 0;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
	}
	.pill button:hover {
		background: var(--color-border);
		color: var(--color-text);
	}
	.pill button:focus-visible {
		outline-offset: 0;
	}
	.pill svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
	}
	.options {
		position: absolute;
		top: calc(100% - 0.25rem);
		left: 0;
		right: 0;
		z-index: 20;
		max-height: 16rem;
		overflow-y: auto;
		margin: 0.25rem 0 0;
		padding: 0.3rem;
		list-style: none;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface);
		box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
	}
	.options li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.5rem;
		padding: 0.6rem 0.7rem;
		border-radius: 6px;
		cursor: pointer;
	}
	.options li.active {
		background: var(--color-hover);
	}
	.options li.none {
		cursor: default;
	}
</style>
