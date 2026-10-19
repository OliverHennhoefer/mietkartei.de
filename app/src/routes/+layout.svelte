<script lang="ts">
	// The brand files are shared with the website and docs, see assets/brand/README.md.
	import favicon from '../../../assets/brand/favicon.svg';
	import logo from '../../../assets/brand/logo.svg';
	import { resolve } from '$app/paths';
	import '../app.css';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="site-header">
	<div class="container">
		<a href={resolve('/objekte')} class="brand"><img src={logo} alt="mietkartei" height="20" /></a>
		<nav aria-label="Hauptnavigation">
			<a href={resolve('/objekte')}>Objekte</a>
		</nav>
	</div>
</header>

<main class="container">
	{@render children()}
</main>
