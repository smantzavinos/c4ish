import { describe, expect, it } from 'vitest';
import { languageOf, parseDefinitions, svelteScripts, syntaxOf, type SyntaxNode } from './definitions.js';
import { isCodeRef, joinName, parseCodeRef } from './reference.js';

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
	it('parses a bracketed name, an array entry, a call and a case, each into one form', () => {
		const name = (raw: string) => {
			const ref = parseCodeRef(`a.ts#${raw}`);
			return isCodeRef(ref) ? ref.name : undefined;
		};
		expect(name("refs['note.create']")).toEqual(['refs', "['note.create']"]);
		expect(name("refs['plain'].x")).toEqual(['refs', 'plain', 'x']);
		expect(name("refs['it\\'s']")).toEqual(['refs', "['it\\'s']"]);
		expect(name("LIST[name='a.b'].run")).toEqual(['LIST', "[name='a.b']", 'run']);
		expect(name('LIST[id=3]')).toEqual(['LIST', '[id=3]']);
		expect(name("router.get('/notes/:id').limit")).toEqual(['router', "get('/notes/:id')", 'limit']);
		expect(name("handle.case('a b')")).toEqual(['handle', "case('a b')"]);
		expect(name('handle.case(2)')).toEqual(['handle', 'case(2)']);
		expect(joinName(name("LIST[name='a.b'].run")!)).toBe("LIST[name='a.b'].run");
		expect(joinName(name("refs['plain'].x")!)).toBe('refs.plain.x');
	});
	it.each(["['a']", "A.['a']", "A['a'", "A['a']b", 'A[3]', "A[k='v'", 'A[k=]', "A[='v']", "A.f('x'", 'A.f()', 'A.f(x)', "A.f('x')y", "A['a", 'A=b', "A.'b'"])('rejects the name %j', (name) => {
		expect(isCodeRef(parseCodeRef(`a.ts#${name}`))).toBe(false);
	});
	it.each(['', ' a.ts', '/abs/a.ts', '../a.ts', 'a/./b.ts', 'a\\b.ts', '#Foo', 'a.ts#', 'a.ts#A..B', 'a.ts#A B'])('rejects %j', (raw) => {
		expect(isCodeRef(parseCodeRef(raw))).toBe(false);
	});
	it('knows which files it can look inside', () => {
		expect(languageOf('a/b.ts')).toBe('typescript');
		expect(languageOf('a/b.tsx')).toBe('tsx');
		expect(languageOf('a/b.mjs')).toBe('javascript');
		expect(languageOf('a/b.json')).toBeUndefined();
		expect(languageOf('a/b.svelte')).toBe('svelte');
		expect(languageOf('a/b.svelte.ts')).toBe('typescript');
		expect(languageOf('a/b.vue')).toBeUndefined();
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

describe('names for code that declares nothing', () => {
	const names = async (source: string) => [...(await parseDefinitions(source, 'typescript')).definitions.keys()];

	it('names a chain of calls by the first call in it that is given text', async () => {
		expect(await names("program\n\t.command('list')\n\t.description('Lists')\n\t.action(() => {});\n")).toEqual(["program.command('list')"]);
		expect(await names('await register("thing", () => {});\n')).toEqual(["register('thing')"]);
		expect(await names("this.app.use('/api', api);\n")).toEqual(["this.app.use('/api')"]);
		expect(await names("describe('suite', () => {\n\tit('works', () => {\n\t\tconst local = 1;\n\t});\n});\n")).toEqual(["describe('suite')", "describe('suite').it('works')", "describe('suite').it('works').local"]);
	});

	it.each(["expect(x).toBe('y');", 'run(options);', "make()('x');", "list[0]('x');", 'run(`x`);', "const made = make('x');"])('gives no call name to %j', async (statement) => {
		expect((await names(`${statement}\n`)).filter((n) => n.includes('('))).toEqual([]);
	});

	it('names an array entry by each property that is a literal, and puts what it holds under the first', async () => {
		const source = "const LIST = [\n\t{ run: () => 1, id: 7, name: 'a', 'odd key': 'x', on: true },\n\t{ run: () => 2 },\n\t'text'\n];\n";
		expect(await names(source)).toEqual(['LIST', 'LIST[id=7]', "LIST[name='a']", 'LIST[id=7].run', 'LIST[id=7].id', 'LIST[id=7].name', "LIST[id=7]['odd key']", 'LIST[id=7].on', 'LIST.run']);
	});

	it('names a case by its value, and not the default', async () => {
		expect(await names("function f(x) {\n\tswitch (x) {\n\t\tcase 'a':\n\t\tcase 2:\n\t\t\treturn 1;\n\t\tcase other:\n\t\tdefault:\n\t\t\treturn 2;\n\t}\n}\n")).toEqual(['f', "f.case('a')", 'f.case(2)']);
	});

	it('writes a name with a character the syntax uses in brackets', async () => {
		expect(await names("const o = { 'a.b': 1, 'a b': 2, 'a-b': 3, a: { b: 4 } };\n")).toEqual(['o', "o['a.b']", "o['a b']", 'o.a-b', 'o.a', 'o.a.b']);
	});
});

describe('syntax without layout', () => {
	const syntax = async (source: string, name: string) => (await parseDefinitions(source, 'typescript')).definitions.get(name)!.syntax;

	it('is the same for two texts that differ only in white space between tokens', async () => {
		const a = await syntax('const f = (a: number, b: number) => {\n\treturn a + b;\n};\n', 'f');
		expect(await syntax('const f = (\n\ta: number,\n\tb: number\n) => { return a+b; };\n', 'f')).toBe(a);
		expect(await syntax('const f = (a: number, b: number) => {\n\treturn a - b;\n};\n', 'f')).not.toBe(a);
	});

	it('reads text outside ASCII where it is', async () => {
		const a = await syntax("const note = 'é😀';\nconst f = (a: number) => {\n\treturn a; // né 😀\n};\n", 'f');
		expect(await syntax("const note = 'é😀';\nconst f = (a: number) => { return a; // né 😀\n};\n", 'f')).toBe(a);
		expect(await syntax("const note = 'é😀';\nconst f = (a: number) => {\n\treturn a; // ne 😀\n};\n", 'f')).not.toBe(a);
		expect(await syntax("const note = 'e😀';\nconst f = (a: number) => {\n\treturn a; // né 😀\n};\n", 'f')).toBe(a);
	});

	it('differs when a line break alters what the tokens mean', async () => {
		expect(await syntax('function f() {\n\treturn\n\t1;\n}\n', 'f')).not.toBe(await syntax('function f() {\n\treturn 1;\n}\n', 'f'));
	});

	it('keeps white space inside a string, a template and a regular expression', async () => {
		for (const [was, now] of [
			["'a b'", "'a  b'"],
			['`a ${x} b`', '`a  ${x} b`'],
			['/a b/', '/a  b/']
		])
			expect(await syntax(`const v = ${was};\n`, 'v')).not.toBe(await syntax(`const v = ${now};\n`, 'v'));
	});

	it('takes the indentation out of a comment, and nothing else of it', async () => {
		const a = await syntax('function f() {\n\t/*\n\t * why\n\t */\n\treturn 1;\n}\n', 'f');
		expect(await syntax('function f() {\n\t\t/*\n\t\t * why\n\t\t */\n\t\treturn 1;\n}\n', 'f')).toBe(a);
		expect(await syntax('function f() {\n\t/*\n\t * why not\n\t */\n\treturn 1;\n}\n', 'f')).not.toBe(a);
	});

	// A tree made by hand: the grammars shipped leave no text outside a token, and a later one might.
	const leaf = (type: string, text: string, startIndex: number): SyntaxNode => ({ id: 0, type, startIndex, endIndex: startIndex + text.length, childCount: 0, children: [] });
	const node = (type: string, source: string, children: SyntaxNode[]): SyntaxNode => ({ id: 0, type, startIndex: 0, endIndex: source.length, childCount: children.length, children });

	it('keeps text that no token covers as it is', () => {
		const tree = (source: string) => node('template', source, [leaf('open', '`', 0), leaf('close', '`', source.length - 1)]);
		expect(syntaxOf(tree('`a b`'), '`a b`')).not.toBe(syntaxOf(tree('`a  b`'), '`a  b`'));
		expect(syntaxOf(tree('`  `'), '`  `')).toBe(syntaxOf(tree('` `'), '` `'));
		const open = (source: string) => node('template', source, [leaf('open', '`', 0)]);
		expect(syntaxOf(open('`a b'), '`a b')).not.toBe(syntaxOf(open('`a  b'), '`a  b'));
	});

	it('tells two trees with the same tokens apart', () => {
		const source = 'a b c';
		const [a, b, c] = [leaf('id', 'a', 0), leaf('id', 'b', 2), leaf('id', 'c', 4)];
		const group = (children: SyntaxNode[]): SyntaxNode => ({ ...node('group', source, children), startIndex: children[0].startIndex, endIndex: children[children.length - 1].endIndex });
		const shapes = [group([group([a, b]), c]), group([a, group([b, c])]), group([group([a, b, c])]), group([a, b, c]), group([a, b, { ...c, type: 'name' }])];
		expect(new Set(shapes.map((t) => syntaxOf(t, source))).size).toBe(shapes.length);
	});
});

describe('Svelte components', () => {
	const COMPONENT = `<!--
	<script>const commentedOut = 1;</script>
-->
<script module lang="ts">
	export const PAGE = 20;
</script>

<script lang="ts">
	import Row from './Row.svelte';

	let { items }: { items: Item[] } = $props();
	let open = $state(false);

	// @pattern web/list-page
	function toggle() {
		open = !open;
	}

	const helpers = {
		label: (i: Item) => i.title
	};
</script>

<button onclick={toggle}>{open ? 'Hide' : 'Show'}</button>
{#if open}
	{#each items as item}
		<Row label={helpers.label(item)} />
	{/each}
{/if}

<style>
	button { color: red; }
</style>
`;
	const component = async (source = COMPONENT) => parseDefinitions(source, 'svelte');

	it('finds the definitions of the script blocks, on the lines they have in the component', async () => {
		const { definitions, parseErrors } = await component();
		expect(parseErrors).toBe(false);
		// `items` is the property of the props type; the destructured props themselves have no one name
		expect([...definitions.keys()].sort()).toEqual(['PAGE', 'helpers', 'helpers.label', 'items', 'open', 'toggle']);
		expect(span(definitions.get('PAGE'))).toBe('5-5');
		expect(span(definitions.get('toggle'))).toBe('15-17');
		expect(definitions.get('toggle')!.extents[0].comment).toEqual({ start: 14, end: 14 });
		expect(definitions.get('toggle')!.commentText).toBe('\t// @pattern web/list-page');
		expect(definitions.get('toggle')!.text).toBe('function toggle() {\n\t\topen = !open;\n\t}');
		expect(span(definitions.get('helpers.label'))).toBe('20-20');
		expect(definitions.get('toggle')!.uses).toContain('open');
	});

	it('looks at nothing outside a script block: markup, styles and commented-out scripts have no names', async () => {
		const { code } = svelteScripts(COMPONENT);
		expect(code).toHaveLength(COMPONENT.length);
		expect(code.split('\n')).toHaveLength(COMPONENT.split('\n').length);
		expect(code).not.toContain('commentedOut');
		expect(code).not.toContain('button');
		expect(code).not.toContain('<script');
		expect(code.split('\n')[14]).toBe('\tfunction toggle() {');
	});

	it('reads a script as TypeScript only when it says so', async () => {
		expect(svelteScripts('<script lang="ts">let a: number = 1;</script>').lang).toBe('typescript');
		expect(svelteScripts("<script context='module' lang=typescript>let a = 1;</script>").lang).toBe('typescript');
		expect(svelteScripts('<script>let a = 1;</script>').lang).toBe('javascript');
		expect(svelteScripts('<script data-lang="ts">let a = 1;</script>').lang).toBe('javascript');
		const js = await component('<script>\n\texport function go() {}\n</script>\n<p>hi</p>\n');
		expect(span(js.definitions.get('go'))).toBe('2-2');
	});

	it('a component with no script has no definitions', async () => {
		const { definitions, parseErrors } = await component('<p>static</p>\n<script src="x.js" />\n');
		expect(definitions.size).toBe(0);
		expect(parseErrors).toBe(false);
	});
});
