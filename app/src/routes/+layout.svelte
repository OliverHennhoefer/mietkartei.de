<script lang="ts">
	// The brand files are shared with the website and docs, see assets/brand/README.md.
	import favicon from '../../../assets/brand/favicon.svg';
	import logo from '../../../assets/brand/logo.svg';
	import { resolve } from '$app/paths';
	import '../app.css';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="site-header">
	<div class="container">
		<a href={resolve('/objekte')} class="brand"><img src={logo} alt="mietkartei" height="20" /></a>
		{#if data.email}
			<nav aria-label="Hauptnavigation">
				<a href={resolve('/objekte')}>Objekte</a>
				<form method="POST" action={resolve('/abmelden')}>
					<span class="muted">{data.email}</span>
					<button type="submit" class="link">Abmelden</button>
				</form>
			</nav>
		{/if}
	</div>
</header>

<main class="container">
	{@render children()}
</main>
