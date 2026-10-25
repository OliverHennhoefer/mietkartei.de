<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '#lib/components/Icon.svelte';
	import type { SettingsSection } from '#lib/settings.ts';

	// The settings as a modal dialog: the sections on the left, the open one on the right. The
	// server renders it open, so it shows without JavaScript too; once mounted it becomes modal,
	// which keeps focus inside and the page behind it inert.
	let {
		sections,
		current,
		onclose,
		onselect,
		children
	}: {
		sections: SettingsSection[];
		/** The href of the open section. */
		current: string | undefined;
		onclose: () => void;
		/** Called on a click on a section link, before the browser follows it. */
		onselect?: (event: MouseEvent, href: string) => void;
		children: Snippet;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	let content = $state<HTMLDivElement>();
	let nav = $state<HTMLElement>();

	$effect(() => {
		if (!dialog || dialog.matches(':modal')) return;
		dialog.close();
		dialog.showModal();
	});

	$effect(() => {
		void current;
		content?.scrollTo(0, 0);
		// On a phone the sections scroll sideways; the open one is kept in sight.
		nav
			?.querySelector('[aria-current="page"]')
			?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	});
</script>

<dialog
	bind:this={dialog}
	class="settings-dialog"
	aria-label="Einstellungen"
	open
	oncancel={(event) => {
		event.preventDefault();
		onclose();
	}}
	onclick={(event) => event.target === dialog && onclose()}
>
	<div class="settings-frame">
		<div class="settings-side">
			<p class="settings-title">Einstellungen</p>
			<nav bind:this={nav} aria-label="Einstellungen">
				{#each sections as section (section.href)}
					<!-- The dialog opens with focus on the open section. -->
					<!-- svelte-ignore a11y_autofocus -->
					<a
						href={section.href}
						aria-current={section.href === current ? 'page' : undefined}
						autofocus={section.href === current}
						onclick={(event) => onselect?.(event, section.href)}
						><Icon name={section.icon} />{section.label}</a
					>
				{/each}
			</nav>
		</div>
		<div class="settings-content" bind:this={content}>
			<button
				type="button"
				class="icon-button settings-close"
				aria-label="Einstellungen schließen"
				title="Schließen"
				onclick={onclose}><Icon name="close" size={20} /></button
			>
			{@render children()}
		</div>
	</div>
</dialog>
