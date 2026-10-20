<script lang="ts">
	// The brand files are shared with the website and docs, see assets/brand/README.md.
	import favicon from '../../../assets/brand/favicon.svg';
	import logo from '../../../assets/brand/logo.svg';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import '../app.css';
	import Alert from '#lib/components/Alert.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let open = $state(false);

	const sections = [
		{ href: '/', label: 'Übersicht' },
		{ href: '/objekte', label: 'Objekte' },
		{ href: '/mieter', label: 'Mieter' },
		{ href: '/vertraege', label: 'Mietverträge' },
		{ href: '/mietkonto', label: 'Mietkonto' },
		{ href: '/bank', label: 'Bank' },
		{ href: '/betriebskosten', label: 'Betriebskosten' },
		{ href: '/dokumente', label: 'Dokumente' },
		{ href: '/aufgaben', label: 'Aufgaben' }
	];

	function current(href: string): 'page' | undefined {
		const path = page.url.pathname;
		if (href === '/') return path === '/' ? 'page' : undefined;
		return path === href || path.startsWith(`${href}/`) ? 'page' : undefined;
	}

	// Close the menu after navigating on a phone.
	$effect(() => {
		void page.url.pathname;
		open = false;
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="site-header">
	<div class="bar">
		<a href={resolve('/')} class="brand"><img src={logo} alt="mietkartei" height="20" /></a>
		{#if data.email}
			<button
				type="button"
				class="nav-toggle"
				aria-expanded={open}
				aria-controls="site-nav"
				onclick={() => (open = !open)}
			>
				Menü
			</button>
		{/if}
	</div>
</header>

<div class="site-layout">
	{#if data.email}
		<nav id="site-nav" class="site-nav" class:open aria-label="Hauptnavigation">
			{#each sections as section (section.href)}
				<a href={section.href} aria-current={current(section.href)}>{section.label}</a>
			{/each}
			<div class="nav-group">
				<a href={resolve('/einstellungen')} aria-current={current('/einstellungen')}>
					Einstellungen
				</a>
				{#if data.billingEnabled}
					<a href="/abo" aria-current={current('/abo')}>Abo</a>
				{/if}
			</div>
			<div class="nav-group">
				<p class="nav-user muted">{data.name ?? data.email}</p>
				<form method="POST" action={resolve('/abmelden')}>
					<button type="submit" class="link">Abmelden</button>
				</form>
			</div>
		</nav>
	{/if}
	<main class="site-main">
		{#if data.notice}
			<Alert tone={data.notice.tone}>
				<p>{data.notice.text} <a href={data.notice.href}>Zum Abo</a></p>
			</Alert>
		{/if}
		{@render children()}
	</main>
</div>
