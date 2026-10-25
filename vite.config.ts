import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-auto';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit({ adapter: adapter() })],
	server: { fs: { allow: ['examples'] } },
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
