import { describe, expect, it } from 'vitest';
import { languageOf, parseDefinitions } from './definitions.js';
import { isCodeRef, parseCodeRef } from './reference.js';

const SOURCE = `// file header

/** The tables. */
// a second comment line
export const tables = {
	apis: defineTable({ name: v.string() }), // trailing
	// lead
	apiVersions: defineTable({ ...shared, status: v.string() }).index('a', ['b']),
	nested: { status: 1 }
};

const shared = { owner: v.id('users') };

function f(a: string): void;
function f(a: number): void;
function f(a: unknown) {
	const local = 1;
}

export const X = 1;
export type X = number;

export class C {
	#secret = 1;
	get g() {
		return 1;
	}
	set g(v) {}
	m() {}
}

enum E {
	A,
	B = 2
}

namespace N.M {
	export const z = 1;
}

first({ dup: 1 });
second({ dup: 2 });

export default defineSchema(tables);
`;

const defs = async (source = SOURCE) => (await parseDefinitions(source, 'typescript')).definitions;
const span = (d: { extents: { start: number; end: number }[] } | undefined) => d?.extents.map((e) => `${e.start}-${e.end}`).join(',');

describe('code reference text', () => {
	it('parses a file, a name and a nested name', () => {
		expect(parseCodeRef('src/a.ts')).toEqual({ raw: 'src/a.ts', path: 'src/a.ts' });
		expect(parseCodeRef('src/a.ts#Foo')).toMatchObject({ path: 'src/a.ts', name: ['Foo'] });
		expect(parseCodeRef('src/a.ts#Outer.Inner')).toMatchObject({ name: ['Outer', 'Inner'] });
		expect(parseCodeRef('src/a.ts#C.#secret')).toMatchObject({ name: ['C', '#secret'] });
	});
	it.each(['', ' a.ts', '/abs/a.ts', '../a.ts', 'a/./b.ts', 'a\\b.ts', '#Foo', 'a.ts#', 'a.ts#A..B', 'a.ts#A B'])('rejects %j', (raw) => {
		expect(isCodeRef(parseCodeRef(raw))).toBe(false);
	});
	it('knows which files it can look inside', () => {
		expect(languageOf('a/b.ts')).toBe('typescript');
		expect(languageOf('a/b.tsx')).toBe('tsx');
		expect(languageOf('a/b.mjs')).toBe('javascript');
		expect(languageOf('a/b.json')).toBeUndefined();
		expect(languageOf('a/b.svelte')).toBeUndefined();
	});
});

describe('named definitions', () => {
	it('takes the whole statement, export included, as the extent', async () => {
		const d = await defs();
		expect(span(d.get('tables'))).toBe('5-10');
		expect(d.get('tables')?.extents[0].kind).toBe('variable');
		expect(span(d.get('shared'))).toBe('12-12');
	});

	it('keeps the comment lines directly above outside the extent, and reports them', async () => {
		const d = await defs();
		expect(d.get('tables')?.extents[0].comment).toEqual({ start: 3, end: 4 });
		expect(d.get('tables')?.commentText).toContain('The tables.');
		// the file header is separated by a blank line
		expect(d.get('tables')?.text.startsWith('export const tables')).toBe(true);
	});

	it('finds a property of an object by its dotted name', async () => {
		const d = await defs();
		expect(span(d.get('tables.apis'))).toBe('6-6');
		expect(span(d.get('tables.apiVersions'))).toBe('8-8');
		expect(d.get('tables.apiVersions')?.extents[0].comment).toEqual({ start: 7, end: 7 });
		// a comment that trails code on the line above is not a leading comment
		expect(d.get('tables.apis')?.extents[0].comment).toBeUndefined();
		// names inside call arguments keep the path of their named ancestors
		expect(d.has('tables.apiVersions.status')).toBe(true);
		expect(d.has('tables.nested.status')).toBe(true);
		expect(d.has('status')).toBe(false);
	});

	it('treats a name declared several times in one scope as one definition', async () => {
		const d = await defs();
		expect(span(d.get('f'))).toBe('14-14,15-15,16-18');
		expect(d.get('f')?.ambiguous).toBe(false);
		expect(span(d.get('X'))).toBe('20-20,21-21');
		expect(d.get('X')?.extents.map((e) => e.kind)).toEqual(['variable', 'type']);
		expect(span(d.get('C.g'))).toBe('25-27,28-28');
	});

	it('marks a name declared in two different scopes as ambiguous', async () => {
		const d = await defs();
		expect(d.get('dup')?.ambiguous).toBe(true);
		expect(span(d.get('dup'))).toBe('41-41,42-42');
	});

	it('finds class members, enum members, namespaces and locals', async () => {
		const d = await defs();
		expect(span(d.get('C'))).toBe('23-30');
		expect(span(d.get('C.#secret'))).toBe('24-24');
		expect(span(d.get('C.m'))).toBe('29-29');
		expect(span(d.get('E.A'))).toBe('33-33');
		expect(span(d.get('E.B'))).toBe('34-34');
		expect(span(d.get('N.M.z'))).toBe('38-38');
		expect(span(d.get('f.local'))).toBe('17-17');
	});

	it('names an unnamed default export `default`, and a named one by its name', async () => {
		const d = await defs();
		expect(span(d.get('default'))).toBe('44-44');
		const named = await defs('export default function main() {}\n');
		expect(span(named.get('main'))).toBe('1-1');
		expect(named.has('default')).toBe(false);
		const anon = await defs('export default function () {}\n');
		expect(span(anon.get('default'))).toBe('1-1');
	});

	it('records the identifiers a definition uses', async () => {
		const d = await defs();
		expect(d.get('tables.apiVersions')?.uses).toContain('shared');
		expect(d.get('tables')?.uses).toContain('shared');
		expect(d.get('tables.apis')?.uses).not.toContain('shared');
	});

	it('does not name destructured or computed declarations', async () => {
		const d = await defs('const { a, b } = obj;\nconst o = { [key]: 1 };\n');
		expect([...d.keys()].sort()).toEqual(['o']);
	});

	it('reads JavaScript and TSX', async () => {
		const js = await parseDefinitions('export function go() {}\nclass K { x = 1; }\n', 'javascript');
		expect([...js.definitions.keys()].sort()).toEqual(['K', 'K.x', 'go']);
		const tsx = await parseDefinitions('export const View = () => <div a="b" />;\n', 'tsx');
		expect(span(tsx.definitions.get('View'))).toBe('1-1');
		expect(tsx.parseErrors).toBe(false);
	});

	it('still finds definitions around a syntax error, and says so', async () => {
		const r = await parseDefinitions('export const ok = 1;\nconst = ;\nfunction later() {}\n', 'typescript');
		expect(r.parseErrors).toBe(true);
		expect(r.definitions.has('ok')).toBe(true);
	});
});
