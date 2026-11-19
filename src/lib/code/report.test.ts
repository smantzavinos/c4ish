import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Element, Model } from '../model/types.js';
import { defaultProfile } from '../profile/default.js';
import { resolveProfile } from '../profile/resolve.js';
import { codeReport, parseDiff, patternCodeReport, type ChangedLines, type CodeReport } from './report.js';

const profile = resolveProfile(defaultProfile);
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A throwaway git repository with one base commit. */
function repo(files: Record<string, string>) {
	const root = mkdtempSync(join(tmpdir(), 'c4ish-code-'));
	made.push(root);
	const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
	const write = (path: string, text: string) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	};
	git('init', '-q');
	for (const [path, text] of Object.entries(files)) write(path, text);
	git('add', '-A');
	git('commit', '-q', '-m', 'base');
	const base = git('rev-parse', 'HEAD');
	const commit = () => {
		git('add', '-A');
		git('commit', '-q', '-m', 'next');
		return git('rev-parse', 'HEAD');
	};
	return { root, base, write, commit, remove: (path: string) => rmSync(join(root, path)) };
}

/** A model whose elements carry only what the report reads. */
function model(code: Record<string, string[] | Partial<Element>>): Model {
	return {
		schemaVersion: 1,
		title: 't',
		views: [{ id: 'eng', kind: 'engineering', title: 't' }],
		elements: Object.entries(code).map(([id, c]) => ({ id, kind: 'component', title: id, ...(Array.isArray(c) ? { code: c } : c) }))
	};
}

const run = (r: { root: string; base: string }, m: Model, withBase = true) => codeReport(m, profile, { root: r.root, ...(withBase ? { base: r.base } : {}) });
const of = (report: CodeReport, ref: string) => report.references.find((x) => x.ref === ref)!;
const lines = (rs: ChangedLines[]) => rs.map((r) => `${r.start}-${r.end}:${r.refs.map((x) => (x.in === 'comment' ? `(${x.ref})` : x.ref)).join('>') || '-'}`);
const file = (report: CodeReport, path: string) => report.files!.find((f) => f.path === path)!;

const SCHEMA = `const shared = { owner: 1 };

// the tables
export const tables = {
	apis: table({ name: 1 }),
	versions: table({ ...shared, status: 1 })
};

export function helper() {
	return 1;
}
`;

describe('resolving references in the working tree', () => {
	it('resolves a file, a definition and a nested definition, with their lines', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		const report = await run(r, model({ a: ['src/schema.ts', 'src/schema.ts#tables', 'src/schema.ts#tables.versions'] }), false);
		expect(report.base).toBeUndefined();
		expect(report.files).toBeUndefined();
		expect(report.problems).toBe(0);
		expect(of(report, 'src/schema.ts').head).toEqual({ status: 'resolved', extents: [{ kind: 'file', start: 1, end: 11 }] });
		expect(of(report, 'src/schema.ts#tables').head.extents).toEqual([{ kind: 'variable', start: 4, end: 7, comment: { start: 3, end: 3 } }]);
		expect(of(report, 'src/schema.ts#tables.versions').head.extents).toEqual([{ kind: 'property', start: 6, end: 6 }]);
	});

	it('fails a reference that names nothing, and suggests the qualified name', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		const report = await run(r, model({ a: ['src/schema.ts#versions', 'src/gone.ts', 'src/gone.ts#x'] }), false);
		expect(report.problems).toBe(3);
		expect(of(report, 'src/schema.ts#versions').head).toEqual({ status: 'missing-name', detail: 'did you mean #tables.versions?' });
		expect(of(report, 'src/gone.ts').head.status).toBe('missing-file');
		expect(of(report, 'src/gone.ts#x').problem).toContain('no such file');
	});

	it('says who carries each reference: elements and parts, several per reference', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		const m = model({
			a: { code: ['src/schema.ts#tables'], change: 'modified', parts: [{ title: 'reads', change: 'new', code: ['src/schema.ts#helper'] }] },
			b: { code: ['src/schema.ts#tables'], change: 'reused' }
		});
		const report = await run(r, m, false);
		expect(of(report, 'src/schema.ts#tables').owners).toEqual([
			{ element: 'a', change: 'modified', style: 'modified' },
			{ element: 'b', change: 'reused', style: 'reused' }
		]);
		expect(of(report, 'src/schema.ts#helper').owners).toEqual([{ element: 'a', part: 'reads', change: 'new', style: 'new' }]);
	});
});

// One test per case the written model-to-code check got wrong.
describe('comparing with a base commit', () => {
	it('case: a comment line above the definition is outside it, and a change there is reported as such', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		r.write('src/schema.ts', SCHEMA.replace('// the tables', '// the tables\n// @anything goes'));
		const report = await run(r, model({ a: ['src/schema.ts#tables'] }));
		const t = of(report, 'src/schema.ts#tables');
		expect(t.delta).toBe('unchanged');
		expect(t.commentChanged).toBe(true);
		expect(t.head.extents).toEqual([{ kind: 'variable', start: 5, end: 8, comment: { start: 3, end: 4 } }]);
		expect(lines(file(report, 'src/schema.ts').head)).toEqual(['4-4:(src/schema.ts#tables)']);
		expect(report.unowned).toEqual({ files: 0, ranges: 0, lines: 0 });
	});

	it('case: a definition renamed in place stops resolving, with a hint to its new name', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		r.write('src/schema.ts', SCHEMA.replace('function helper', 'function assist'));
		const report = await run(r, model({ a: ['src/schema.ts#helper'] }));
		const h = of(report, 'src/schema.ts#helper');
		expect(h.base?.status).toBe('resolved');
		expect(h.head.status).toBe('missing-name');
		expect(h.delta).toBe('removed');
		expect(h.hints).toEqual([{ kind: 'renamed', ref: 'src/schema.ts#assist' }]);
		expect(h.problem).toBeUndefined();
		// the old line belongs to the reference at the base; the new line belongs to nothing yet
		expect(lines(file(report, 'src/schema.ts').base)).toEqual(['9-9:src/schema.ts#helper']);
		expect(lines(file(report, 'src/schema.ts').head)).toEqual(['9-9:-']);
	});

	it('case: a definition moved to another file stops resolving, with a hint to where it went', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA, 'src/other.ts': 'export const one = 1;\n' });
		r.write('src/schema.ts', SCHEMA.replace('\nexport function helper() {\n\treturn 1;\n}\n', ''));
		r.write('src/other.ts', 'export const one = 1;\n\nexport function helper() {\n\treturn 1;\n}\n');
		const report = await run(r, model({ a: ['src/schema.ts#helper'] }));
		const h = of(report, 'src/schema.ts#helper');
		expect(h.delta).toBe('removed');
		expect(h.hints).toEqual([{ kind: 'moved', ref: 'src/other.ts#helper' }]);
		expect(lines(file(report, 'src/other.ts').head)).toEqual(['2-5:-']);
		expect(report.unowned?.lines).toBe(5); // the blank line removed from schema.ts, and the four added to other.ts
	});

	it('case: a whole file moved is hinted by its content', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		r.remove('src/schema.ts');
		r.write('lib/schema.ts', SCHEMA);
		const report = await run(r, model({ a: ['src/schema.ts'] }));
		expect(of(report, 'src/schema.ts')).toMatchObject({ delta: 'removed', hints: [{ kind: 'moved', ref: 'lib/schema.ts' }] });
		expect(file(report, 'src/schema.ts').status).toBe('deleted');
		expect(file(report, 'lib/schema.ts')).toMatchObject({ status: 'added', head: [{ start: 1, end: 11, refs: [] }] });
	});

	it('case: deleted lines exist only at the base and are placed by the base extents', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		// one line deleted inside `tables`, one deleted outside every definition the model names
		r.write('src/schema.ts', SCHEMA.replace('\tapis: table({ name: 1 }),\n', '').replace('const shared = { owner: 1 };\n', ''));
		const report = await run(r, model({ a: ['src/schema.ts#tables'] }));
		expect(of(report, 'src/schema.ts#tables').delta).toBe('modified');
		const f = file(report, 'src/schema.ts');
		expect(f.head).toEqual([]);
		expect(lines(f.base)).toEqual(['1-1:-', '5-5:src/schema.ts#tables']);
		expect(report.unowned).toEqual({ files: 1, ranges: 1, lines: 1 });
	});

	it('case: a value and a type with one name are one definition; either changing modifies it', async () => {
		const src = 'export const Shape = { a: 1 };\n\nexport type Shape = { a: number };\n';
		const r = repo({ 'src/shape.ts': src });
		r.write('src/shape.ts', src.replace('a: number', 'a: string'));
		const report = await run(r, model({ a: ['src/shape.ts#Shape'] }));
		const s = of(report, 'src/shape.ts#Shape');
		expect(s.head.extents?.map((e) => `${e.kind}:${e.start}`)).toEqual(['variable:1', 'type:3']);
		expect(s.delta).toBe('modified');
		expect(lines(file(report, 'src/shape.ts').head)).toEqual(['3-3:src/shape.ts#Shape']);
	});

	it('case: one name in two different scopes cannot be referenced until it is qualified', async () => {
		const r = repo({ 'src/calls.ts': 'first({ handler: 1 });\nsecond({ handler: 2 });\nexport const a = { handler: 3 };\n' });
		const report = await run(r, model({ a: ['src/calls.ts#handler', 'src/calls.ts#a.handler'] }));
		expect(of(report, 'src/calls.ts#handler')).toMatchObject({ head: { status: 'ambiguous' }, problem: expect.stringContaining('lines 1, 2') });
		expect(of(report, 'src/calls.ts#handler').delta).toBeUndefined();
		expect(of(report, 'src/calls.ts#a.handler').delta).toBe('unchanged');
		expect(report.problems).toBe(1);
	});

	it('case: a whole-file reference owns what the named definitions in that file do not', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		r.write('src/schema.ts', SCHEMA.replace('name: 1', 'name: 2').replace('return 1', 'return 2'));
		const report = await run(r, model({ whole: ['src/schema.ts'], table: ['src/schema.ts#tables.apis'], all: ['src/schema.ts#tables'] }));
		// innermost first: the property, the object it is in, then the file
		expect(lines(file(report, 'src/schema.ts').head)).toEqual(['5-5:src/schema.ts#tables.apis>src/schema.ts#tables>src/schema.ts', '10-10:src/schema.ts']);
		expect(of(report, 'src/schema.ts').delta).toBe('modified');
		expect(report.unowned?.lines).toBe(0);
	});

	it('case: a definition changed only through a shared block it is built from', async () => {
		const src = SCHEMA.replace('const shared = { owner: 1 };', 'const base = { id: 1 };\nconst shared = { ...base, owner: 1 };');
		const r = repo({ 'src/schema.ts': src });
		r.write('src/schema.ts', src.replace('id: 1', 'id: 2'));
		const report = await run(r, model({ v: ['src/schema.ts#tables.versions'], a: ['src/schema.ts#tables.apis'], h: ['src/schema.ts#helper'] }));
		const v = of(report, 'src/schema.ts#tables.versions');
		expect(v.delta).toBe('unchanged');
		// `versions` spreads `shared`, which spreads `base`; only `base` changed
		expect(v.changedThrough).toEqual(['src/schema.ts#base']);
		expect(of(report, 'src/schema.ts#tables.apis').changedThrough).toBeUndefined();
		expect(of(report, 'src/schema.ts#helper').changedThrough).toBeUndefined();
		expect(lines(file(report, 'src/schema.ts').head)).toEqual(['1-1:-']);
	});

	it('case: an unnamed default export is named `default`', async () => {
		const src = 'const tables = {};\n\nexport default defineSchema(tables);\n';
		const r = repo({ 'src/schema.ts': src });
		r.write('src/schema.ts', src.replace('defineSchema(tables)', 'defineSchema(tables, { strict: true })'));
		const report = await run(r, model({ a: ['src/schema.ts#default'] }));
		expect(of(report, 'src/schema.ts#default')).toMatchObject({ delta: 'modified', head: { extents: [{ kind: 'default', start: 3, end: 3 }] } });
	});

	it('case: a file type with no parser takes a whole-file reference, not a name', async () => {
		const r = repo({ 'config/limits.json': '{\n\t"max": 1\n}\n', 'ui/Card.svelte': '<p>card</p>\n' });
		r.write('config/limits.json', '{\n\t"max": 2\n}\n');
		const report = await run(r, model({ a: ['config/limits.json', 'config/limits.json#max', 'ui/Card.svelte'] }));
		expect(of(report, 'config/limits.json').delta).toBe('modified');
		expect(of(report, 'ui/Card.svelte').delta).toBe('unchanged');
		expect(of(report, 'config/limits.json#max')).toMatchObject({ head: { status: 'unsupported' }, problem: expect.stringContaining('reference the whole file') });
		expect(lines(file(report, 'config/limits.json').head)).toEqual(['2-2:config/limits.json']);
	});

	it('case: an element that spans several definitions and files carries several references', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA, 'src/guard.ts': 'export function check() {\n\treturn true;\n}\n' });
		r.write('src/guard.ts', 'export function check() {\n\treturn false;\n}\n');
		r.write('src/new.ts', 'export const added = 1;\n'); // untracked
		const m = model({ wide: { code: ['src/schema.ts#helper', 'src/guard.ts#check', 'src/new.ts#added'], change: 'modified' } });
		const report = await run(r, m);
		expect(report.references.map((x) => [x.ref, x.delta])).toEqual([
			['src/schema.ts#helper', 'unchanged'],
			['src/guard.ts#check', 'modified'],
			['src/new.ts#added', 'added']
		]);
		expect(report.references.every((x) => x.owners[0].element === 'wide')).toBe(true);
		expect(file(report, 'src/new.ts')).toMatchObject({ status: 'added', head: [{ start: 1, end: 1, refs: [{ ref: 'src/new.ts#added', in: 'body' }] }] });
		expect(report.unowned?.lines).toBe(0);
	});

	it('a definition that only moved within its file is unchanged, and its lines are all placed', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		const moved = 'export function helper() {\n\treturn 1;\n}\n\n' + SCHEMA.replace('\nexport function helper() {\n\treturn 1;\n}\n', '');
		r.write('src/schema.ts', moved);
		const report = await run(r, model({ a: ['src/schema.ts#helper'], whole: ['src/schema.ts'] }));
		expect(of(report, 'src/schema.ts#helper')).toMatchObject({ delta: 'unchanged', head: { extents: [{ start: 1, end: 3 }] }, base: { extents: [{ start: 9, end: 11 }] } });
		expect(report.unowned?.lines).toBe(0);
	});

	it('a reference that resolves at neither end is a problem; binary files are listed without lines', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA, 'img/a.bin': 'a\0b' });
		r.write('img/a.bin', 'a\0c');
		r.write('img/new.bin', 'x\0y');
		const report = await run(r, model({ a: ['src/schema.ts#nothing'] }));
		expect(of(report, 'src/schema.ts#nothing')).toMatchObject({ delta: 'missing', problem: expect.stringContaining('at the base or in the working tree') });
		expect(file(report, 'img/a.bin')).toEqual({ path: 'img/a.bin', status: 'modified', binary: true, base: [], head: [] });
		expect(file(report, 'img/new.bin')).toEqual({ path: 'img/new.bin', status: 'added', binary: true, base: [], head: [] });
	});

	it('rejects a base that is not a commit', async () => {
		const r = repo({ 'a.ts': 'export const a = 1;\n' });
		await expect(codeReport(model({ a: ['a.ts'] }), profile, { root: r.root, base: 'no-such-rev' })).rejects.toThrow();
	});
});

describe('reading a diff', () => {
	it('reads paths with spaces and hunks with and without counts', () => {
		const diff = ['diff --git a/my dir/a b.ts b/my dir/a b.ts', 'index 1..2 100644', '--- a/my dir/a b.ts', '+++ b/my dir/a b.ts', '@@ -3 +3,2 @@ x', '-a', '+b', '+c', '@@ -9,2 +9,0 @@', '-d', '-e'].join('\n');
		expect(parseDiff(diff)).toEqual([
			{
				path: 'my dir/a b.ts',
				status: 'modified',
				base: [
					{ start: 3, end: 3 },
					{ start: 9, end: 10 }
				],
				head: [{ start: 3, end: 4 }]
			}
		]);
	});
});

describe('reference implementations of a profile\'s patterns', () => {
	const catalog = (patterns: Record<string, string[]>) =>
		resolveProfile({
			profileVersion: 0,
			id: 'p',
			title: 'P',
			extends: 'default',
			patterns: Object.fromEntries(Object.entries(patterns).map(([id, code]) => [id, { label: id, family: 'api', code }]))
		});

	it('resolves each, owned by its pattern; patterns without one are left out', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		const report = await patternCodeReport(catalog({ 'api/table': ['src/schema.ts#tables.apis'], 'api/helper': ['src/schema.ts#helper', 'src/schema.ts#tables.apis'] }), { root: r.root });
		expect(report.problems).toBe(0);
		expect(report.references.map((x) => [x.ref, x.owners, x.head.status])).toEqual([
			['src/schema.ts#tables.apis', [{ pattern: 'api/table' }, { pattern: 'api/helper' }], 'resolved'],
			['src/schema.ts#helper', [{ pattern: 'api/helper' }], 'resolved']
		]);
	});

	it('fails a reference implementation that is not there', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		const report = await patternCodeReport(catalog({ 'api/table': ['src/schema.ts#tables.gone'] }), { root: r.root });
		expect(report.problems).toBe(1);
		expect(report.references[0].problem).toContain('no such definition');
	});

	it('with a base, says what changed in each and lists no changed lines', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA, 'src/other.ts': 'export const x = 1;\n' });
		r.write('src/schema.ts', SCHEMA.replace('return 1;', 'return 2;'));
		r.write('src/other.ts', 'export const x = 2;\n');
		const report = await patternCodeReport(catalog({ 'api/table': ['src/schema.ts#tables.apis'], 'api/helper': ['src/schema.ts#helper'] }), { root: r.root, base: r.base });
		expect(report.references.map((x) => [x.ref, x.delta])).toEqual([
			['src/schema.ts#tables.apis', 'unchanged'],
			['src/schema.ts#helper', 'modified']
		]);
		expect(report.files).toBeUndefined();
		expect(report.unowned).toBeUndefined();
	});
});

describe('a Svelte component', () => {
	const component = (body: string, markup: string) => `<script lang="ts">\n\tlet open = $state(false);\n\n\t// toggles the list\n\tfunction toggle() {\n\t\t${body}\n\t}\n</script>\n\n${markup}\n`;
	const WAS = component('open = !open;', '<button onclick={toggle}>Show</button>');

	it('takes names into its script; a change to the markup alone leaves them unchanged and unowned', async () => {
		const r = repo({ 'src/List.svelte': WAS });
		r.write('src/List.svelte', component('open = !open;', '<button onclick={toggle}>Show all</button>'));
		const report = await run(r, model({ list: ['src/List.svelte#toggle'] }));
		expect(report.problems).toBe(0);
		expect(report.references[0]).toMatchObject({ head: { status: 'resolved', extents: [{ kind: 'function', start: 5, end: 7, comment: { start: 4, end: 4 } }] }, delta: 'unchanged' });
		expect(report.files).toEqual([{ path: 'src/List.svelte', status: 'modified', base: [{ start: 10, end: 10, refs: [] }], head: [{ start: 10, end: 10, refs: [] }] }]);
		expect(report.unowned).toEqual({ files: 1, ranges: 2, lines: 2 });
	});

	it('says a function of its script changed, was added, or is not there', async () => {
		const r = repo({ 'src/List.svelte': WAS });
		r.write('src/List.svelte', component('open = true;', '<button onclick={toggle}>Show</button>').replace('</script>', '\tfunction close() {\n\t\topen = false;\n\t}\n</script>'));
		const report = await run(r, model({ toggle: ['src/List.svelte#toggle'], close: ['src/List.svelte#close'], gone: ['src/List.svelte#missing'] }));
		expect(report.references.map((x) => [x.ref, x.delta ?? x.problem])).toEqual([
			['src/List.svelte#toggle', 'modified'],
			['src/List.svelte#close', 'added'],
			['src/List.svelte#missing', 'missing']
		]);
		expect(of(report, 'src/List.svelte#missing').problem).toBe('no such definition at the base or in the working tree');
		expect(report.files![0].head.map((c) => c.refs.map((x) => x.ref))).toEqual([['src/List.svelte#toggle'], ['src/List.svelte#close']]);
	});

	it('still takes a whole-file reference, which owns the markup too', async () => {
		const r = repo({ 'src/List.svelte': WAS });
		r.write('src/List.svelte', component('open = !open;', '<button onclick={toggle}>Show all</button>'));
		const report = await run(r, model({ list: ['src/List.svelte', 'src/List.svelte#toggle'] }));
		expect(report.references.map((x) => [x.ref, x.delta])).toEqual([
			['src/List.svelte', 'modified'],
			['src/List.svelte#toggle', 'unchanged']
		]);
		expect(report.unowned).toEqual({ files: 0, ranges: 0, lines: 0 });
	});
});

describe('names for code that declares nothing', () => {
	const TOOLS = `export const TOOLS = [
	// creates a note
	{ name: 'create_note', kind: 'write', run: () => 1 },
	{ name: 'list_notes', kind: 'read', run: () => 2 }
];

export const handlers = {
	'note.create': 1,
	note: { create: 2 }
};

export function handle(op: string) {
	switch (op) {
		case 'note.create': {
			return 1;
		}
		case 'note.list':
			return 2;
	}
}

router.get('/notes', () => {
	const limit = 20;
});
router.get('/notes/:id', () => {
	const limit = 1;
});
`;
	const refs = (...names: string[]) => model({ a: names.map((n) => `src/tools.ts#${n}`) });

	it('an entry of an array is named by a property of it, and what it holds goes under that name', async () => {
		const r = repo({ 'src/tools.ts': TOOLS });
		const report = await run(r, refs("TOOLS[name='list_notes']", "TOOLS[name='create_note'].run", "TOOLS[kind='read']"), false);
		expect(report.problems).toBe(0);
		expect(of(report, "src/tools.ts#TOOLS[name='list_notes']").head.extents).toEqual([{ kind: 'entry', start: 4, end: 4 }]);
		expect(of(report, "src/tools.ts#TOOLS[kind='read']").head.extents).toEqual([{ kind: 'entry', start: 4, end: 4 }]);
		expect(of(report, "src/tools.ts#TOOLS[name='create_note'].run").head.extents).toEqual([{ kind: 'property', start: 3, end: 3 }]);
	});

	it('an entry added to an array is added, and its lines are its own; the array around it is modified', async () => {
		const r = repo({ 'src/tools.ts': TOOLS });
		r.write('src/tools.ts', TOOLS.replace("\t{ name: 'list_notes'", "\t{ name: 'drop_note', kind: 'write', run: () => 3 },\n\t{ name: 'list_notes'"));
		const report = await run(r, refs('TOOLS', "TOOLS[name='drop_note']", "TOOLS[name='list_notes']", "TOOLS[name='create_note']"));
		expect(report.references.map((x) => x.delta)).toEqual(['modified', 'added', 'unchanged', 'unchanged']);
		expect(of(report, "src/tools.ts#TOOLS[name='create_note']").head.extents![0].comment).toEqual({ start: 2, end: 2 });
		expect(lines(file(report, 'src/tools.ts').head)).toEqual(["4-4:src/tools.ts#TOOLS[name='drop_note']>src/tools.ts#TOOLS"]);
	});

	it('a name with a dot in it is written in brackets, apart from the nested name it would read as', async () => {
		const r = repo({ 'src/tools.ts': TOOLS });
		const report = await run(r, refs("handlers['note.create']", 'handlers.note.create', "handlers['note']"), false);
		expect(report.problems).toBe(0);
		expect(of(report, "src/tools.ts#handlers['note.create']").head.extents).toEqual([{ kind: 'property', start: 8, end: 8 }]);
		expect(of(report, 'src/tools.ts#handlers.note.create').head.extents).toEqual([{ kind: 'property', start: 9, end: 9 }]);
		expect(of(report, "src/tools.ts#handlers['note']").head.extents).toEqual([{ kind: 'property', start: 9, end: 9 }]);
	});

	it('suggests the bracketed name when the dotted one names nothing', async () => {
		const r = repo({ 'src/tools.ts': TOOLS.replace('\tnote: { create: 2 }\n', '') });
		const report = await run(r, refs('handlers.note.create'), false);
		expect(report.references[0].problem).toBe("no such definition (did you mean #handlers['note.create']?)");
	});

	it('a case of a switch is named by its value', async () => {
		const r = repo({ 'src/tools.ts': TOOLS });
		r.write('src/tools.ts', TOOLS.replace('return 2;', 'return 3;'));
		const report = await run(r, refs("handle.case('note.create')", "handle.case('note.list')"));
		expect(report.references.map((x) => [x.head.extents, x.delta])).toEqual([
			[[{ kind: 'case', start: 14, end: 16 }], 'unchanged'],
			[[{ kind: 'case', start: 17, end: 18 }], 'modified']
		]);
	});

	it('a call statement is named by the first text it is given, and what it holds goes under that name', async () => {
		const r = repo({ 'src/tools.ts': TOOLS });
		r.write('src/tools.ts', TOOLS.replace('const limit = 1;', 'const limit = 2;'));
		const report = await run(r, refs("router.get('/notes')", "router.get('/notes/:id')", "router.get('/notes/:id').limit", 'limit'));
		expect(report.references.map((x) => [x.head.extents?.map((e) => `${e.kind} ${e.start}-${e.end}`).join(), x.delta ?? x.problem])).toEqual([
			['call 22-24', 'unchanged'],
			['call 25-27', 'modified'],
			['variable 26-26', 'modified'],
			[undefined, 'missing']
		]);
		expect(of(report, 'src/tools.ts#limit').problem).toContain("did you mean #router.get('/notes').limit, #router.get('/notes/:id').limit?");
	});
});

describe('layout', () => {
	const WAS = `export function total(items: number[]) {
	// adds them up
	return items.reduce((sum, n) => sum + n, 0);
}

export const label = \`total:  \${total([1, 2])}\`;

export function next(n: number) {
	return n + 1;
}
`;

	it('a definition whose text differs only in white space between tokens is unchanged, and says so', async () => {
		const r = repo({ 'src/sum.ts': WAS });
		r.write('src/sum.ts', WAS.replace('\treturn items.reduce((sum, n) => sum + n, 0);', '\t\t// adds them up\n\t\treturn items.reduce(\n\t\t\t(sum, n) => sum + n,\n\t\t\t0\n\t\t);').replace('\t// adds them up\n', ''));
		const report = await run(r, model({ a: ['src/sum.ts#total', 'src/sum.ts#next', 'src/sum.ts'] }));
		expect(report.references.map((x) => [x.delta, x.layoutChanged])).toEqual([
			['unchanged', true],
			['unchanged', undefined],
			['unchanged', true]
		]);
		expect(lines(file(report, 'src/sum.ts').head)).toEqual(['2-6:src/sum.ts#total>src/sum.ts']);
	});

	it('a change inside a string, a template or a comment is a change, as is a line break that alters the syntax', async () => {
		const changed = async (from: string, to: string, ref: string) => {
			const r = repo({ 'src/sum.ts': WAS });
			r.write('src/sum.ts', WAS.replace(from, to));
			const report = await run(r, model({ a: [`src/sum.ts#${ref}`] }));
			return [report.references[0].delta, report.references[0].layoutChanged];
		};
		expect(await changed('total:  ${', 'total: ${', 'label')).toEqual(['modified', undefined]);
		expect(await changed('// adds them up', '// adds  them up', 'total')).toEqual(['modified', undefined]);
		expect(await changed('return n + 1;', 'return\n\tn + 1;', 'next')).toEqual(['modified', undefined]);
		expect(await changed('sum + n, 0', 'sum + n,  0', 'total')).toEqual(['unchanged', true]);
	});

	it('a comment above a definition that was only indented is not a changed comment', async () => {
		const SOURCE = '// the answer\nexport const answer = 42;\n';
		const r = repo({ 'src/a.ts': SOURCE });
		r.write('src/a.ts', '    // the answer\n    export const answer = 42;\n');
		const report = await run(r, model({ a: ['src/a.ts#answer'] }));
		expect(report.references[0]).toMatchObject({ delta: 'unchanged' });
		expect(report.references[0].commentChanged).toBeUndefined();
		const r3 = repo({ 'src/a.ts': SOURCE });
		r3.write('src/a.ts', '// the reply\nexport const answer = 42;\n');
		expect((await run(r3, model({ a: ['src/a.ts#answer'] }))).references[0].commentChanged).toBe(true);
	});

	it('a file with no parser, and a component, are compared as text', async () => {
		const r = repo({ 'notes.txt': 'a b\n', 'src/V.svelte': '<script>\n\tlet a = 1;\n</script>\n\n<p>a</p>\n' });
		r.write('notes.txt', 'a  b\n');
		r.write('src/V.svelte', '<script>\n\tlet a = 1;\n</script>\n\n<p>b</p>\n');
		const report = await run(r, model({ a: ['notes.txt', 'src/V.svelte'] }));
		expect(report.references.map((x) => [x.delta, x.layoutChanged])).toEqual([
			['modified', undefined],
			['modified', undefined]
		]);
	});
});

describe('a removed element with no base commit', () => {
	const removedModel = (change: string, partChange?: string): Model => ({
		schemaVersion: 1,
		title: 't',
		views: [{ id: 'eng', kind: 'engineering', title: 't' }],
		elements: [
			{ id: 'old', kind: 'component', title: 'old', change, code: ['src/gone.ts', 'src/schema.ts#gone'], parts: [{ title: 'p', ...(partChange ? { change: partChange } : {}), code: ['src/gone.ts#x'] }] },
			{ id: 'kept', kind: 'component', title: 'kept', code: ['src/schema.ts#helper'] }
		]
	});

	it('is not looked for: its references are no problem, and say why', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		const report = await run(r, removedModel('removed'), false);
		expect(report.problems).toBe(0);
		expect(report.references.map((x) => [x.ref, x.head.status, x.problem])).toEqual([
			['src/gone.ts', 'missing-file', undefined],
			['src/schema.ts#gone', 'missing-name', undefined],
			['src/gone.ts#x', 'missing-file', undefined],
			['src/schema.ts#helper', 'resolved', undefined]
		]);
		expect(of(report, 'src/gone.ts').head.detail).toBe('not looked for: its element is removed, and no base commit was given to find it at');
	});

	it('is still a problem when anything else carries the reference, or a part of it is not removed', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		expect((await run(r, removedModel('modified'), false)).problems).toBe(3);
		expect((await run(r, removedModel('removed', 'new'), false)).problems).toBe(1);
		const shared = removedModel('removed');
		shared.elements[1].code = ['src/gone.ts'];
		expect((await run(r, shared, false)).problems).toBe(1);
	});

	it('with a base it is looked for there, and missing at both ends is a problem', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		r.write('src/schema.ts', SCHEMA.replace('export function helper', 'export function helped'));
		const m = removedModel('removed');
		m.elements[0].code = ['src/schema.ts#helper', 'src/gone.ts'];
		m.elements[0].parts = [];
		m.elements[1].code = [];
		const report = await run(r, m);
		expect(report.references.map((x) => [x.delta, Boolean(x.problem)])).toEqual([
			['removed', false],
			['missing', true]
		]);
	});
});

describe('a head commit in place of the working tree', () => {
	it('sees what the commit holds: nothing later, nothing uncommitted, no untracked file', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		r.write('src/schema.ts', SCHEMA.replace('return 1;', 'return 2;'));
		const head = r.commit();
		r.write('src/schema.ts', SCHEMA.replace('return 1;', 'return 3;').replace('owner: 1', 'owner: 2'));
		r.write('src/new.ts', 'export const later = 1;\n');
		const m = model({ a: ['src/schema.ts#helper', 'src/schema.ts#tables', 'src/new.ts#later'] });

		const committed = await codeReport(m, profile, { root: r.root, base: r.base, head });
		expect(committed.head).toBe(head);
		expect(committed.references.map((x) => [x.delta, x.changedThrough, x.problem])).toEqual([
			['modified', undefined, undefined],
			['unchanged', undefined, undefined],
			['missing', undefined, 'no such file at the base or at the head']
		]);
		expect(committed.files!.map((f) => f.path)).toEqual(['src/schema.ts']);
		expect(lines(file(committed, 'src/schema.ts').head)).toEqual(['10-10:src/schema.ts#helper']);

		const working = await codeReport(m, profile, { root: r.root, base: r.base });
		expect(working.head).toBeUndefined();
		expect(working.references.map((x) => [x.delta, x.changedThrough])).toEqual([
			['modified', undefined],
			['unchanged', ['src/schema.ts#shared']],
			['added', undefined]
		]);
		expect(working.files!.map((f) => f.path)).toEqual(['src/new.ts', 'src/schema.ts']);
	});

	it('alone, resolves the references as of that commit', async () => {
		const r = repo({ 'src/schema.ts': SCHEMA });
		r.write('src/schema.ts', '');
		const report = await codeReport(model({ a: ['src/schema.ts#helper'] }), profile, { root: r.root, head: r.base });
		expect(report).toMatchObject({ head: r.base, problems: 0 });
		expect(report.base).toBeUndefined();
		await expect(codeReport(model({ a: ['src/schema.ts'] }), profile, { root: r.root, head: 'no-such-commit' })).rejects.toThrow();
	});
});
