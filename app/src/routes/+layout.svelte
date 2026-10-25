<script lang="ts">
	import favicon from '../../../assets/brand/favicon.svg';
	import lockup from '../../../assets/brand/lockup-highlight.svg';
	import lockupWhite from '../../../assets/brand/lockup-highlight-white.svg';
	import { untrack, type Component } from 'svelte';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import SettingsDialog from '#lib/components/SettingsDialog.svelte';
	import { settingsSectionOf, settingsSections } from '#lib/settings.ts';
	import { viewerWritesOn } from '#lib/viewer-paths.ts';
	import { goto, preloadData } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import '../app.css';
	import type { LayoutProps } from './$types';
	import Subscription from './abo/+page.svelte';
	import Account from './einstellungen/konto/+page.svelte';
	import Members from './einstellungen/zugaenge/+page.svelte';
	import ApiKeys from './einstellungen/api-schluessel/+page.svelte';
	import Export from './einstellungen/export/+page.svelte';
	import Profile from './einstellungen/profil/+page.svelte';
	import AuditLog from './einstellungen/protokoll/+page.svelte';
	import PriceIndex from './einstellungen/vpi/+page.svelte';

	let { data, children }: LayoutProps = $props();
	let open = $state(false);
	let menuButton = $state<HTMLButtonElement>();
	let accountOpen = $state(false);
	let accountButton = $state<HTMLButtonElement>();
	let accountMenu = $state<HTMLDivElement>();
	// The answer of the last form sent from the settings dialog; one from the page behind it is
	// not shown in the dialog.
	let settingsForm = $state<unknown>(null);
	// The tab title of the page behind the dialog, given back when the dialog closes.
	let pageTitle = { url: '', title: '' };
	let settingsRequest = 0;

	// The pages a settings section renders when it opens as a dialog over another page. Each one
	// gets the data its own load returned.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const settingsViews: Record<string, Component<any>> = {
		'/einstellungen/profil': Profile,
		'/einstellungen/zugaenge': Members,
		'/einstellungen/vpi': PriceIndex,
		'/einstellungen/protokoll': AuditLog,
		'/einstellungen/export': Export,
		'/einstellungen/api-schluessel': ApiKeys,
		'/abo': Subscription,
		'/einstellungen/konto': Account
	};

	const groups: { label: string; sections: { href: string; label: string; icon: IconName }[] }[] = [
		{
			label: 'Alltag',
			sections: [
				{ href: '/', label: 'Übersicht', icon: 'home' },
				{ href: '/aufgaben', label: 'Aufgaben', icon: 'check' }
			]
		},
		{
			label: 'Bestand',
			sections: [
				{ href: '/objekte', label: 'Objekte', icon: 'building' },
				{ href: '/mieter', label: 'Mieter', icon: 'people' },
				{ href: '/vertraege', label: 'Mietverträge', icon: 'file' }
			]
		},
		{
			label: 'Verwaltung',
			sections: [
				{ href: '/mietkonto', label: 'Mietkonto', icon: 'wallet' },
				{ href: '/bank', label: 'Bank', icon: 'bank' },
				{ href: '/betriebskosten', label: 'Betriebskosten', icon: 'receipt' },
				{ href: '/dokumente', label: 'Dokumente', icon: 'folder' },
				{ href: '/auswertung', label: 'Auswertung', icon: 'trend' }
			]
		}
	];

	function current(href: string): 'page' | undefined {
		const path = page.url.pathname;
		if (href === '/') return path === '/' ? 'page' : undefined;
		return path === href || path.startsWith(`${href}/`) ? 'page' : undefined;
	}

	// First letters of the first and last name ("Max Muster" → "MM"), else of the email address.
	const initials = $derived.by(() => {
		const words = (data.name ?? '').trim().split(/\s+/).filter(Boolean);
		if (words.length > 1) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
		return (words[0] ?? data.email ?? '').slice(0, 2).toUpperCase();
	});

	function closeMenu() {
		open = false;
		menuButton?.focus();
	}

	function closeAccountMenu() {
		accountOpen = false;
		accountButton?.focus();
	}

	$effect(() => {
		void page.url.pathname;
		open = false;
		accountOpen = false;
	});

	function setData(element: HTMLElement, key: string, value: string | undefined) {
		if (element.dataset[key] === value) return;
		if (value === undefined) delete element.dataset[key];
		else element.dataset[key] = value;
	}

	/** Labels every body and footer cell of a table with its column heading, for the stacked rows on a phone. */
	function labelTableCells() {
		for (const table of document.querySelectorAll<HTMLTableElement>('table.table')) {
			const headings = [...(table.tHead?.rows[0]?.cells ?? [])].flatMap((cell) =>
				Array<string>(cell.colSpan).fill(cell.textContent?.trim() ?? '')
			);
			for (const body of [...table.tBodies, ...(table.tFoot ? [table.tFoot] : [])]) {
				for (const row of body.rows) {
					let column = 0;
					for (const cell of row.cells) {
						// Actions and a lone button speak for themselves; an empty cell is left out.
						const action =
							cell.classList.contains('actions') ||
							cell.matches(':has(> form:only-child), :has(> button:only-child)');
						const blank =
							!cell.textContent?.trim() && !cell.querySelector('input, select, button, img, svg');
						const label = cell.colSpan === 1 && !action && !blank ? headings[column] : '';
						setData(cell, 'label', label || undefined);
						setData(cell, 'blank', blank ? '' : undefined);
						column += cell.colSpan;
					}
				}
			}
		}
	}

	// Tables come and go with navigation, forms and dialogs, so the labels follow every change.
	$effect(() => {
		let frame = 0;
		const observer = new MutationObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(labelTableCells);
		});
		labelTableCells();
		observer.observe(document.body, { childList: true, subtree: true });
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	});

	const sections = $derived(settingsSections(data.role, data.billingEnabled));
	// A settings page opened by its address renders the dialog itself (see SettingsFrame).
	const onSettingsPage = $derived(!!settingsSectionOf(page.url.pathname));
	const settings = $derived(onSettingsPage ? undefined : page.state.settings);
	const SettingsView = $derived(settings && settingsViews[settings.href]);

	/**
	 * Opens a settings section as a dialog over the current page: its data is loaded as for a
	 * navigation, then the address changes without leaving the page (shallow routing), so the
	 * back button closes the dialog and a reload opens the section as a page of its own.
	 */
	async function openSettings(href: string, replace: boolean) {
		// Only the latest request counts: one overtaken by another section, by closing the dialog
		// or by a navigation is dropped once its data arrives.
		const request = ++settingsRequest;
		const from = page.url.href;
		const result = await preloadData(href);
		if (request !== settingsRequest || page.url.href !== from || (replace && !settings)) return;
		if (href !== settings?.href) settingsForm = null;
		if (!settings) pageTitle = { url: page.url.href, title: document.title };
		if (result.type === 'loaded' && result.status === 200) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- a path from settings.ts
			await goto(href, {
				shallow: true,
				replace,
				state: { settings: { href, data: result.data } }
			});
		} else {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- a path from settings.ts
			await goto(href);
		}
	}

	/** Follows a settings link as a dialog; a click that opens a new tab stays with the browser. */
	function settingsLink(event: MouseEvent, href: string, replace: boolean) {
		accountOpen = false;
		if (
			onSettingsPage ||
			!settingsViews[href] ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey
		)
			return;
		event.preventDefault();
		void openSettings(href, replace);
	}

	function closeSettings() {
		settingsRequest++;
		history.back();
	}

	// A form in the dialog posts to the section's own page; once its answer is applied the
	// section's data is loaded again, the way the page itself would be after the submission.
	let seenForm = page.form;
	$effect(() => {
		const form = page.form;
		if (form === seenForm) return;
		seenForm = form;
		const open = untrack(() => settings);
		if (!open) return;
		settingsForm = form;
		void openSettings(open.href, true);
	});

	// The section's heading names the tab while the dialog is open. Once it is gone, the tab gets
	// back the title of the page behind it (unless a form led to another page), and focus goes back to the account button.
	let hadSettings = false;
	$effect(() => {
		const has = !!settings;
		if (hadSettings && !has) {
			settingsRequest++;
			if (page.url.href === pageTitle.url) document.title = pageTitle.title;
			accountButton?.focus();
		}
		hadSettings = has;
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#181818" media="(prefers-color-scheme: dark)" />
	<!-- The link preview of every app page; the demo page adds its own title and description. -->
	<meta property="og:site_name" content="mietkartei" />
	<meta property="og:locale" content="de_DE" />
	<meta property="og:image" content="https://mietkartei.de/assets/social.png?v=neon" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta
		property="og:image:alt"
		content="mietkartei: Vermieten. Mit Überblick. Mieten, Bankumsätze und die Betriebskostenabrechnung ohne Excel-Chaos, daneben die Übersicht der App."
	/>
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (event.key !== 'Escape') return;
		if (accountOpen) closeAccountMenu();
		else if (open) closeMenu();
	}}
	onclick={(event) => {
		const target = event.target as Node;
		if (accountOpen && !accountMenu?.contains(target) && !accountButton?.contains(target))
			accountOpen = false;
	}}
	onresize={() => {
		if (window.matchMedia('(min-width: 60rem)').matches) open = false;
	}}
/>

<div class="app-shell" class:authenticated={!!data.email}>
	<a class="skip-link" href="#main-content">Zum Inhalt</a>
	<!-- Signed out, the pages show only the logo above their form, no header. -->
	{#if data.email}
		<header class="site-header">
			<!-- The app shows no logo; the favicon names it. -->
			<div class="brand-bar">
				<button
					bind:this={menuButton}
					type="button"
					class="nav-toggle icon-button"
					aria-label={open ? 'Menü schließen' : 'Menü öffnen'}
					aria-expanded={open}
					aria-controls="site-nav"
					onclick={() => (open = !open)}
				>
					<Icon name={open ? 'close' : 'menu'} size={20} />
				</button>
			</div>
			<div class="workspace-bar">
				{#if data.demo}
					<p class="billing-notice info" role="note">
						<Icon name="info" size={16} />
						<span>Demo mit Beispieldaten, wird nach 24 Stunden gelöscht.</span>
						<a href="https://mietkartei.de">Mehr über mietkartei</a>
					</p>
				{/if}
				{#if data.role === 'viewer'}
					<p class="billing-notice info" role="note">
						<Icon name="info" size={16} />
						<span>Du hast Lesezugriff und kannst nichts ändern.</span>
					</p>
				{/if}
				{#if data.notice}
					<!-- The subscription notice stays in this bar, so it never pushes the page down. -->
					<p
						class="billing-notice {data.notice.tone}"
						class:highlight={data.notice.highlight}
						role="note"
					>
						<Icon name={data.notice.tone === 'info' ? 'info' : 'alert'} size={16} />
						<span>{data.notice.text}</span>
						<a
							href={data.notice.href}
							onclick={(event) => data.notice && settingsLink(event, data.notice.href, false)}
							>Zum Abo</a
						>
					</p>
				{/if}
				<div class="account">
					<button
						bind:this={accountButton}
						type="button"
						class="account-button"
						aria-label="Konto"
						aria-expanded={accountOpen}
						aria-controls="account-menu"
						onclick={() => (accountOpen = !accountOpen)}
					>
						<span class="avatar" aria-hidden="true">{initials}</span>
					</button>
					{#if accountOpen}
						<div bind:this={accountMenu} id="account-menu" class="account-menu">
							<div class="account-user">
								<span class="account-name" title={data.name ?? undefined}
									>{data.name ?? 'Dein Konto'}</span
								><span class="account-email" title={data.email}>{data.email}</span>
							</div>
							<a
								href={resolve('/einstellungen/profil')}
								onclick={(event) => settingsLink(event, '/einstellungen/profil', false)}
								><Icon name="settings" />Einstellungen</a
							>
							{#if data.billingEnabled}
								<a href={resolve('/abo')} onclick={(event) => settingsLink(event, '/abo', false)}
									><Icon name="card" />Abo</a
								>
							{/if}
							<a
								href="https://docs.mietkartei.de/"
								target="_blank"
								rel="noreferrer"
								aria-label="Hilfe und Dokumentation (neuer Tab)"
								onclick={() => (accountOpen = false)}><Icon name="help" />Hilfe</a
							>
							<form method="POST" action={resolve('/abmelden')}>
								<button type="submit"><Icon name="logout" />Abmelden</button>
							</form>
						</div>
					{/if}
				</div>
			</div>
		</header>
	{/if}

	<div class="site-layout">
		{#if data.email}
			{#if open}
				<button type="button" class="nav-backdrop" aria-label="Menü schließen" onclick={closeMenu}
				></button>
			{/if}
			<nav id="site-nav" class="site-nav" class:open aria-label="Hauptnavigation">
				{#each groups as group (group.label)}
					<div class="nav-group">
						<p class="nav-label">{group.label}</p>
						{#each group.sections as item (item.href)}
							<a href={item.href} aria-current={current(item.href)}
								><Icon name={item.icon} />{item.label}</a
							>
						{/each}
					</div>
				{/each}
				<p class="nav-version">
					<a
						href="https://github.com/OliverHennhoefer/mietkartei.de/releases"
						target="_blank"
						rel="noreferrer"
						aria-label="Version {__APP_VERSION__}, Versionshinweise auf GitHub (neuer Tab)"
						>Version {__APP_VERSION__}</a
					>
				</p>
			</nav>
		{/if}
		<!-- Viewers see forms that write without their buttons; the hook refuses them all the same.
		     Settings pages and the pages of viewer-paths.ts keep theirs, where viewers manage their
		     own sign-in, calendar link and API keys. -->
		<main
			id="main-content"
			class="site-main"
			class:read-only={data.role === 'viewer' &&
				!onSettingsPage &&
				!viewerWritesOn(page.url.pathname)}
			tabindex="-1"
			inert={open}
		>
			{#if !data.email}
				<!-- Signed out, / only leads back to /anmelden, so the logo goes to the homepage. -->
				<a href="https://mietkartei.de" class="auth-brand">
					<picture>
						<source media="(prefers-color-scheme: dark)" srcset={lockupWhite} />
						<img src={lockup} alt="mietkartei" width="489" height="96" />
					</picture>
				</a>
			{/if}
			{@render children()}
		</main>
	</div>
	{#if settings && SettingsView}
		<SettingsDialog
			{sections}
			current={settings.href}
			onclose={closeSettings}
			onselect={(event, href) => settingsLink(event, href, true)}
		>
			<SettingsView data={settings.data} form={settingsForm} />
		</SettingsDialog>
	{/if}
</div>
