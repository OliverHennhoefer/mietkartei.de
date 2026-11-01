<script lang="ts">
	import lockup from '../../../../assets/brand/lockup-highlight.svg';
	import lockupWhite from '../../../../assets/brand/lockup-highlight-white.svg';
</script>

<!-- The header of the website (website/_header.html), so the signed-out pages share its frame. -->
<header class="website-header">
	<a class="website-brand" href="https://mietkartei.de" aria-label="mietkartei — Startseite">
		<picture>
			<source media="(prefers-color-scheme: dark)" srcset={lockupWhite} />
			<img src={lockup} alt="mietkartei" width="489" height="96" />
		</picture>
	</a>
	<nav aria-label="Seitenlinks">
		<a
			class="website-github"
			href="https://github.com/OliverHennhoefer/mietkartei.de"
			aria-label="mietkartei auf GitHub"
			title="mietkartei auf GitHub"
		>
			<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"
				><path
					fill="currentColor"
					d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3"
				/></svg
			>
		</a>
	</nav>
</header>
