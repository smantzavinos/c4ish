import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { packageRoot } from './serve.js';

/** The command as a caller runs it: its output read through a pipe, not written to a file. */
const c4ish = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', join(packageRoot(), 'src/lib/cli/main.ts'), ...args], { cwd: packageRoot(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

describe('c4ish on a pipe', () => {
	const dir = mkdtempSync(join(tmpdir(), 'c4ish-cli-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it('prints all of a long report before it exits', () => {
		const model = (title: (i: number) => string) => ({
			schemaVersion: 1,
			title: 'Many',
			views: [{ id: 'eng', kind: 'engineering', title: 'Many' }],
			elements: Array.from({ length: 1500 }, (_, i) => ({ id: `e${i}`, kind: 'component', title: title(i), change: 'reused' }))
		});
		writeFileSync(join(dir, 'a.json'), JSON.stringify(model((i) => `Element ${i}`)));
		writeFileSync(join(dir, 'b.json'), JSON.stringify(model((i) => `Element ${i}, renamed`)));
		const out = c4ish('diff', join(dir, 'a.json'), join(dir, 'b.json'), '--json');
		// well past what a pipe holds at once
		expect(out.length).toBeGreaterThan(200_000);
		expect(JSON.parse(out).differences).toHaveLength(1500);
	}, 30_000);

	it('prints the default profile', () => {
		const profile = JSON.parse(c4ish('profile'));
		expect(profile.elementKinds.component.category).toBe('code');
		expect(profile.rules.missingPattern).toBe('warning');
	}, 30_000);
});
