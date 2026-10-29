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
		| 'arrow-left'
		| 'arrow-right'
		| 'check'
		| 'alert'
		| 'info'
		| 'user'
		| 'trend'
		| 'history'
		| 'download'
		| 'key'
		| 'calendar'
		| 'coins'
		| 'pie'
		| 'bars'
		| 'percent'
		| 'gauge'
		| 'chevron-right'
		| 'chevrons'
		| 'map'
		| 'wrench';
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
		'arrow-left': 'M19 12H5m5-5-5 5 5 5',
		'arrow-right': 'M5 12h14m-5-5 5 5-5 5',
		check: 'm5 12 4 4L19 6',
		'chevron-right': 'm9 6 6 6-6 6',
		chevrons: 'm7 15 5 5 5-5M7 9l5-5 5 5',
		map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
		wrench:
			'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94Z',
		alert: 'm12 3 10 18H2ZM12 9v4m0 4h.01',
		info: 'M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
		coins:
			'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3ZM4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
		pie: 'M21 12a9 9 0 1 1-9-9v9ZM15 3.5A9 9 0 0 1 20.5 9H15Z',
		bars: 'M3 21h18M6 17v-6m6 6V5m6 12V9',
		percent:
			'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm11 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
		gauge: 'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0',
		user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
		trend: 'm22 7-8.5 8.5-5-5L2 17M16 7h6v6',
		history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
		download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
		key: 'm15.5 7.5 3 3L22 7l-3-3m2-2-9.6 9.6M7.5 21a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z',
		calendar:
			'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM16 2v4M8 2v4M3 10h18'
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
