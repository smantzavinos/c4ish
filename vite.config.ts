import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit({ adapter: adapter({ fallback: undefined, strict: true }) })],
	server: { fs: { allow: ['examples'] } },
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
