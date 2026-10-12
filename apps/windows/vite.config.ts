import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const tauriConfig = JSON.parse(readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

export default defineConfig({
	plugins: [react()],
	clearScreen: false,
	define: { __APP_VERSION__: JSON.stringify(tauriConfig.version) },
	server: { port: 1420, strictPort: true },
	build: {
		target: 'es2022',
		rollupOptions: { input: { index: 'index.html' } },
	},
});
