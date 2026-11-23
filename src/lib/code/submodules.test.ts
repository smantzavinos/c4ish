import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Model } from '../model/types.js';
import { defaultProfile } from '../profile/default.js';
import { resolveProfile } from '../profile/resolve.js';
import { codeReport, type ChangedLines, type CodeReport } from './report.js';

const profile = resolveProfile(defaultProfile);
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

const SUM = `export function sum(a: number, b: number) {
	return a + b;
}

export function twice(n: number) {
	return n * 2;
}
`;

const gitIn = (dir: string) => (...args: string[]) =>
	execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'protocol.file.allow=always', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const writeIn = (dir: string) => (path: string, text: string) => {
	mkdirSync(dirname(join(dir, path)), { recursive: true });
	writeFileSync(join(dir, path), text);
};

/**
 * A root repository whose code sits in one submodule, `lib`. `first` is the root before it had the
 * submodule, `base` the commit that added it.
 */
function rootWithSubmodule() {
	const dir = mkdtempSync(join(tmpdir(), 'c4ish-sub-'));
	made.push(dir);
	const [origin, root] = [join(dir, 'origin'), join(dir, 'root')];
	mkdirSync(origin);
	mkdirSync(root);
	const upstream = gitIn(origin);
	upstream('init', '-q');
	writeIn(origin)('src/sum.ts', SUM);
	upstream('add', '-A');
	upstream('commit', '-q', '-m', 'lib');

	const git = gitIn(root);
	git('init', '-q');
	writeIn(root)('docs/readme.md', 'read me\n');
	git('add', '-A');
	git('commit', '-q', '-m', 'first');
	const first = git('rev-parse', 'HEAD');
	git('submodule', '--quiet', 'add', origin, 'lib');
	git('commit', '-q', '-m', 'base');
	const lib = join(root, 'lib');
	const sub = gitIn(lib);
	return {
		dir,
		root,
		first,
		base: git('rev-parse', 'HEAD'),
		pinned: sub('rev-parse', 'HEAD'),
		git,
		sub,
		write: writeIn(root),
		/** Commits in the submodule, then moves the root's pointer to it. */
		commitBoth() {
			sub('add', '-A');
			sub('commit', '-q', '-m', 'next');
			git('add', '-A');
			git('commit', '-q', '-m', 'next');
			return { root: git('rev-parse', 'HEAD'), lib: sub('rev-parse', 'HEAD') };
		}
	};
}

const model = (...code: string[]): Model => ({
	schemaVersion: 1,
	title: 't',
	views: [{ id: 'eng', kind: 'engineering', title: 't' }],
	elements: code.map((ref, i) => ({ id: `e${i}`, kind: 'component', title: ref, code: [ref] }))
});

const lines = (rs: ChangedLines[]) => rs.map((r) => `${r.start}-${r.end}:${r.refs.map((x) => x.ref).join('>') || '-'}`);
const file = (report: CodeReport, path: string) => report.files!.find((f) => f.path === path)!;
const refs = (report: CodeReport) => report.references.map((r) => [r.delta ?? r.head.status, r.problem]);

describe('code in a git submodule of the root', () => {
	it('is named by its path from the root and found in the working tree', async () => {
		const r = rootWithSubmodule();
		const report = await codeReport(model('lib/src/sum.ts#sum', 'docs/readme.md'), profile, { root: r.root });
		expect(refs(report)).toEqual([
			['resolved', undefined],
			['resolved', undefined]
		]);
		expect(report.repositories).toEqual([{ path: 'lib', head: r.pinned }]);
		expect(report.problems).toBe(0);
	});

	it('is compared with the commit of the submodule that the base commit points to', async () => {
		const r = rootWithSubmodule();
		r.write('lib/src/sum.ts', SUM.replace('a + b', 'b + a'));
		r.write('lib/src/new.ts', 'export const one = 1;\n');
		r.write('docs/readme.md', 'read me again\n');
		const report = await codeReport(model('lib/src/sum.ts#sum', 'lib/src/sum.ts#twice', 'lib/src/new.ts#one'), profile, { root: r.root, base: r.base });
		expect(refs(report)).toEqual([
			['modified', undefined],
			['unchanged', undefined],
			['added', undefined]
		]);
		// each changed file is under the submodule's path; untracked files of the submodule are changes too
		expect(report.files!.map((f) => [f.path, f.status])).toEqual([
			['docs/readme.md', 'modified'],
			['lib/src/new.ts', 'added'],
			['lib/src/sum.ts', 'modified']
		]);
		expect(lines(file(report, 'lib/src/sum.ts').head)).toEqual(['2-2:lib/src/sum.ts#sum']);
		expect(lines(file(report, 'lib/src/new.ts').head)).toEqual(['1-1:lib/src/new.ts#one']);
		expect(report.unowned).toEqual({ files: 1, ranges: 2, lines: 2 });
		expect(report.repositories).toEqual([{ path: 'lib', base: r.pinned, head: r.pinned }]);
		expect(report.problems).toBe(0);
	});

	it('a moved pointer is not a changed line; what moved inside the submodule is', async () => {
		const r = rootWithSubmodule();
		r.write('lib/src/sum.ts', SUM.replace('n * 2', 'n + n'));
		const head = r.commitBoth();
		for (const options of [{ head: head.root }, {}]) {
			const report = await codeReport(model('lib/src/sum.ts#twice'), profile, { root: r.root, base: r.base, ...options });
			expect(refs(report)).toEqual([['modified', undefined]]);
			expect(report.files!.map((f) => f.path)).toEqual(['lib/src/sum.ts']);
			expect(report.unowned).toEqual({ files: 0, ranges: 0, lines: 0 });
			expect(report.repositories).toEqual([{ path: 'lib', base: r.pinned, head: head.lib }]);
		}
	});

	it('with a head commit reads the submodule at the commit that head points to, not its working tree', async () => {
		const r = rootWithSubmodule();
		r.write('lib/src/sum.ts', SUM.replace('n * 2', 'n + n'));
		const head = r.commitBoth();
		r.write('lib/src/sum.ts', '');
		r.write('lib/src/stray.ts', 'export const stray = 1;\n');
		const report = await codeReport(model('lib/src/sum.ts#twice'), profile, { root: r.root, base: r.base, head: head.root });
		expect(refs(report)).toEqual([['modified', undefined]]);
		expect(report.files!.map((f) => f.path)).toEqual(['lib/src/sum.ts']);
		expect(lines(file(report, 'lib/src/sum.ts').head)).toEqual(['6-6:lib/src/sum.ts#twice']);
		const unmoved = await codeReport(model('lib/src/sum.ts#twice'), profile, { root: r.root, base: r.base, head: r.base });
		expect(refs(unmoved)).toEqual([['unchanged', undefined]]);
		expect(unmoved.files).toEqual([]);
	});

	it('a submodule new since the base is all added', async () => {
		const r = rootWithSubmodule();
		const report = await codeReport(model('lib/src/sum.ts#sum'), profile, { root: r.root, base: r.first });
		expect(refs(report)).toEqual([['added', undefined]]);
		expect(report.files!.map((f) => [f.path, f.status])).toEqual([
			['.gitmodules', 'added'],
			['lib/src/sum.ts', 'added']
		]);
		expect(report.repositories).toEqual([{ path: 'lib', head: r.pinned }]);
	});

	it('says so when the submodule is not checked out', async () => {
		const r = rootWithSubmodule();
		r.write('lib/src/sum.ts', SUM.replace('n * 2', 'n + n'));
		const head = r.commitBoth();
		const bare = join(r.dir, 'clone');
		gitIn(r.dir)('clone', '-q', r.root, bare);
		const problem = 'submodule lib is not checked out, so its files cannot be read or compared';

		const resolving = await codeReport(model('lib/src/sum.ts#sum', 'docs/readme.md'), profile, { root: bare });
		expect(refs(resolving)).toEqual([
			['missing-file', problem],
			['resolved', undefined]
		]);
		expect(resolving.repositories).toEqual([{ path: 'lib', problem }]);
		expect(resolving.problems).toBe(2);

		// its pointer moved, so its changes are needed even when no reference points into it
		const comparing = await codeReport(model('docs/readme.md'), profile, { root: bare, base: r.base, head: head.root });
		expect(comparing.repositories).toEqual([{ path: 'lib', base: r.pinned, head: head.lib, problem }]);
		expect(comparing.problems).toBe(1);

		// not moved and not referenced: not needed
		const untouched = await codeReport(model('docs/readme.md'), profile, { root: bare, base: head.root });
		expect(untouched.repositories).toEqual([]);
		expect(untouched.problems).toBe(0);
	});

	it('says so when the commit pointed to is not in the local repository of the submodule', async () => {
		const r = rootWithSubmodule();
		const absent = '1'.repeat(40);
		r.git('update-index', '--cacheinfo', `160000,${absent},lib`);
		r.git('commit', '-q', '-m', 'points nowhere');
		const head = r.git('rev-parse', 'HEAD');
		const problem = `commit ${absent.slice(0, 10)} of submodule lib, which the head commit points to, is not in its local repository; fetch it`;
		const report = await codeReport(model('lib/src/sum.ts#sum'), profile, { root: r.root, base: r.base, head });
		expect(refs(report)).toEqual([['removed', problem]]);
		expect(report.repositories).toEqual([{ path: 'lib', base: r.pinned, head: absent, problem }]);
		expect(report.problems).toBe(2);

		const fromThere = await codeReport(model('lib/src/sum.ts#sum'), profile, { root: r.root, base: head });
		expect(fromThere.repositories[0].problem).toBe(`commit ${absent.slice(0, 10)} of submodule lib, which the base commit points to, is not in its local repository; fetch it`);
		expect(fromThere.files!.map((f) => f.path)).toEqual([]);
	});

	it('a root with no submodule reports none', async () => {
		const r = rootWithSubmodule();
		const report = await codeReport(model('docs/readme.md'), profile, { root: r.root, base: r.first, head: r.first });
		expect(report.repositories).toEqual([]);
	});
});
