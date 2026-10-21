<script lang="ts">
	import favicon from '../../../assets/brand/favicon.svg';
	import logo from '../../../assets/brand/logo.svg';
	import logoWhite from '../../../assets/brand/logo-white.svg';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import '../app.css';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let open = $state(false);
	let menuButton = $state<HTMLButtonElement>();

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
				{ href: '/dokumente', label: 'Dokumente', icon: 'folder' }
			]
		}
	];

	function current(href: string): 'page' | undefined {
		const path = page.url.pathname;
		if (href === '/') return path === '/' ? 'page' : undefined;
		return path === href || path.startsWith(`${href}/`) ? 'page' : undefined;
	}

	const section = $derived(
		[
			...groups.flatMap((group) => group.sections),
			{ href: '/einstellungen', label: 'Einstellungen' }
		].find((item) => current(item.href))?.label ?? 'Arbeitsbereich'
	);
	const initials = $derived((data.name ?? data.email)?.slice(0, 2).toUpperCase());

	function closeMenu() {
		open = false;
		menuButton?.focus();
	}

	$effect(() => {
		void page.url.pathname;
		open = false;
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#181818" media="(prefers-color-scheme: dark)" />
</svelte:head>

<svelte:window
	onkeydown={(event) => event.key === 'Escape' && open && closeMenu()}
	onresize={() => {
		if (window.matchMedia('(min-width: 60rem)').matches) open = false;
	}}
/>

<div class="app-shell" class:authenticated={!!data.email}>
	<a class="skip-link" href="#main-content">Zum Inhalt</a>
	<header class="site-header">
		<div class="brand-bar">
			<a href={resolve('/')} class="brand">
				<picture>
					<source media="(prefers-color-scheme: dark)" srcset={logoWhite} />
					<img src={logo} alt="mietkartei" height="23" />
				</picture>
			</a>
			{#if data.email}
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
			{/if}
		</div>
		{#if data.email}
			<div class="workspace-bar">
				<div class="breadcrumb">
					<span>Mein Arbeitsbereich</span><span class="divider">/</span><span
						class="current-section">{section}</span
					>
				</div>
				<a
					class="help-link"
					href="https://docs.mietkartei.de/"
					target="_blank"
					rel="noreferrer"
					aria-label="Hilfe und Dokumentation (neuer Tab)"><Icon name="help" /><span>Hilfe</span></a
				>
			</div>
		{/if}
	</header>

	<div class="site-layout">
		{#if data.email}
			{#if open}
				<button type="button" class="nav-backdrop" aria-label="Menü schließen" onclick={closeMenu}
				></button>
			{/if}
			<nav id="site-nav" class="site-nav" class:open aria-label="Hauptnavigation">
				<div class="workspace-label">
					<span class="workspace-symbol"><Icon name="home" size={16} /></span><span
						>Mein Arbeitsbereich<small>Hausverwaltung</small></span
					>
				</div>
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
				<div class="nav-bottom">
					<a href={resolve('/einstellungen')} aria-current={current('/einstellungen')}
						><Icon name="settings" />Einstellungen</a
					>
					<div class="nav-account">
						<span class="avatar" aria-hidden="true">{initials}</span>
						<div class="nav-user">
							<span class="nav-name" title={data.name ?? undefined}
								>{data.name ?? 'Dein Konto'}</span
							><span class="nav-email" title={data.email}>{data.email}</span>
						</div>
						<form method="POST" action={resolve('/abmelden')}>
							<button type="submit" class="icon-button" aria-label="Abmelden" title="Abmelden"
								><Icon name="logout" size={16} /></button
							>
						</form>
					</div>
				</div>
			</nav>
		{/if}
		<main id="main-content" class="site-main" tabindex="-1" inert={open}>
			{@render children()}
		</main>
	</div>
</div>
