<script lang="ts" module>
	export type IconName =
		| 'building'
		| 'people'
		| 'file'
		| 'wallet'
		| 'card'
		| 'bank'
		| 'receipt'
		| 'folder'
		| 'settings'
		| 'help'
		| 'logout'
		| 'menu'
		| 'close'
		| 'plus'
		| 'search'
		| 'arrow-right'
		| 'check'
		| 'alert'
		| 'info'
		| 'home';
</script>

<script lang="ts">
	let { name, size = 18 }: { name: IconName; size?: number } = $props();

	const paths: Record<IconName, string> = {
		building:
			'M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16M17 9h2a1 1 0 0 1 1 1v11M2 21h20M8 7h1m3 0h1M8 11h1m3 0h1M8 15h1m3 0h1M9 21v-3h3v3',
		people:
			'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M13 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
		file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8m-8 4h5',
		wallet:
			'M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6m18 7h-5v4h5',
		card: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM2 10h20M6 15h4',
		bank: 'm3 9 9-6 9 6ZM3 21h18M5 12v6m7-6v6m7-6v6',
		receipt: 'M4 3v18l4-2 4 2 4-2 4 2V3l-4 2-4-2-4 2ZM8 9h8m-8 4h8m-8 4h4',
		folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM3 9h18',
		settings:
			'M20 7h-9m-4 0H4m16 10h-3m-4 0H4M11 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0M17 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
		help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
		logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
		menu: 'M4 6h16M4 12h16M4 18h16',
		close: 'm6 6 12 12M6 18 18 6',
		plus: 'M12 5v14M5 12h14',
		search: 'm21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
		'arrow-right': 'M5 12h14m-5-5 5 5-5 5',
		check: 'm5 12 4 4L19 6',
		alert: 'm12 3 10 18H2ZM12 9v4m0 4h.01',
		info: 'M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
		home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z'
	};
</script>

<svg
	class="icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d={paths[name]} />
</svg>
