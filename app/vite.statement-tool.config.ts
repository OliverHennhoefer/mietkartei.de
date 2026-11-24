import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// The free statement tool on mietkartei.de/nebenkostenabrechnung/erstellen/: the app's
// computation and letter with a form of its own, built as static files for the website.
// scripts/build_homepage.py runs this build and links the entry from the manifest.
export default defineConfig({
	plugins: [svelte({ compilerOptions: { runes: true } })],
	// The page is served from the website; the files land under /assets/nebenkostenabrechnung/.
	base: '/',
	publicDir: false,
	build: {
		outDir: '../dist/statement-tool',
		emptyOutDir: true,
		manifest: true,
		target: 'es2022',
		rollupOptions: {
			input: 'src/statement-tool/main.ts',
			output: {
				entryFileNames: 'assets/nebenkostenabrechnung/[name]-[hash].js',
				chunkFileNames: 'assets/nebenkostenabrechnung/[name]-[hash].js',
				assetFileNames: 'assets/nebenkostenabrechnung/[name]-[hash][extname]'
			}
		}
	}
});
