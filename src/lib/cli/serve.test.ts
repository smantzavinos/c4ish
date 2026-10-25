import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { serveViewer, viewerPath } from './serve.js';

describe('c4ish view server', () => {
	const dir = mkdtempSync(join(tmpdir(), 'c4ish-view-'));
	mkdirSync(join(dir, 'build', 'viewer'), { recursive: true });
	writeFileSync(join(dir, 'build', 'viewer', 'index.html'), '<!doctype html><title>viewer</title>');
	writeFileSync(join(dir, 'profile.json'), '{"extends":"default"}');
	writeFileSync(join(dir, 'model.json'), JSON.stringify({ profile: './profile.json', tours: [{ id: 'review' }] }));
	process.env.C4ISH_VIEWER_DIR = join(dir, 'build');
	let close = () => {};
	afterAll(() => close());

	it('builds a viewer URL that loads the served model and starts a tour', () => {
		const p = viewerPath({ name: 'm.json', profile: true, tour: 'review', step: 'write' });
		const u = new URL(p, 'http://x');
		expect(u.pathname).toBe('/viewer/');
		expect(u.searchParams.get('src')).toBe('/__c4ish/model.json');
		expect(u.searchParams.get('profile')).toBe('/__c4ish/profile.json');
		expect(u.searchParams.get('live')).toBe('/__c4ish/events');
		expect(u.hash).toBe('#tour=review&step=write');
	});

	it('serves the viewer, the model and its profile, and streams changes', async () => {
		const s = await serveViewer({ file: join(dir, 'model.json'), tour: true, port: 0, open: false });
		close = s.close;
		const origin = new URL(s.url).origin;
		expect(s.url).toContain('#tour=review');
		expect(await (await fetch(`${origin}/viewer/`)).text()).toContain('<title>viewer</title>');
		expect((await (await fetch(`${origin}/__c4ish/model.json`)).json()).profile).toBe('./profile.json');
		expect((await (await fetch(`${origin}/__c4ish/profile.json`)).json()).extends).toBe('default');
		expect((await fetch(`${origin}/nope.js`)).status).toBe(404);

		const res = await fetch(`${origin}/__c4ish/events`);
		const reader = res.body!.getReader();
		await reader.read(); // retry: preamble
		setTimeout(() => writeFileSync(join(dir, 'model.json'), JSON.stringify({ profile: './profile.json', tours: [] })), 50);
		let got = '';
		while (!got.includes('event: change')) got += new TextDecoder().decode((await reader.read()).value);
		expect(got).toContain('event: change');
		await reader.cancel();
	});
});
