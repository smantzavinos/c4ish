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

describe('c4ish code', () => {
	const root = mkdtempSync(join(tmpdir(), 'c4ish-cli-code-'));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
	const commit = () => {
		git('add', '-A');
		git('commit', '-q', '-m', 'c');
		return git('rev-parse', 'HEAD');
	};

	it('with --head reads that commit in place of the working tree, and says what it compared', () => {
		const element = (id: string, change: string, code: string[]) => ({ id, kind: 'component', title: id, change, pattern: null, code });
		const model = {
			schemaVersion: 1,
			title: 'Sum',
			views: [{ id: 'eng', kind: 'engineering', title: 'Sum' }],
			elements: [element('sum', 'modified', ['sum.ts#sum']), element('old', 'removed', ['sum.ts#old'])]
		};
		writeFileSync(join(root, 'model.json'), JSON.stringify(model));
		writeFileSync(join(root, 'sum.ts'), 'export function sum(a: number, b: number) {\n\treturn a + b;\n}\n\nexport const old = 1;\n');
		git('init', '-q');
		const base = commit();
		writeFileSync(join(root, 'sum.ts'), 'export function sum(\n\ta: number,\n\tb: number\n) {\n\treturn a + b;\n}\n');
		const head = commit();
		writeFileSync(join(root, 'sum.ts'), 'export function sum(a: number, b: number) {\n\treturn a - b;\n}\n');
		writeFileSync(join(root, 'later.ts'), 'export const later = 1;\n');

		const committed = c4ish('code', join(root, 'model.json'), '--base', base, '--head', head);
		expect(committed).toContain(`${base.slice(0, 10)} → ${head.slice(0, 10)}`);
		expect(committed).toMatch(/unchanged\s+sum\.ts#sum/);
		expect(committed).toContain('only its layout changed');
		expect(committed).toMatch(/removed\s+sum\.ts#old/);
		expect(committed).not.toContain('later.ts');

		const working = c4ish('code', join(root, 'model.json'), '--base', base);
		expect(working).toContain(`${base.slice(0, 10)} → working tree`);
		expect(working).toMatch(/modified\s+sum\.ts#sum/);
		expect(working).toContain('later.ts');

		const alone = c4ish('code', join(root, 'model.json'), '--head', head);
		expect(alone).toContain(`, at ${head.slice(0, 10)}`);
		expect(alone).toMatch(/missing-name\s+sum\.ts#old/);
		expect(alone).toContain('not looked for: its element is removed');

		// a profile's reference implementations, at a commit
		writeFileSync(join(root, 'profile.json'), JSON.stringify({ profileVersion: 0, id: 'p', title: 'P', extends: 'default', patterns: { 'a/old': { label: 'OLD', family: 'runtime', code: ['sum.ts#old'] } } }));
		expect(c4ish('code', join(root, 'profile.json'), '--head', base)).toMatch(/resolved\s+sum\.ts#old/);
		expect(() => c4ish('code', join(root, 'profile.json'))).toThrow();
	}, 60_000);
});

