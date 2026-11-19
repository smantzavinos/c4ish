import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, type Node } from 'web-tree-sitter';
import { entrySegment, joinName, labelSegment, nameSegment, type Literal } from './reference.js';

/** A language with a grammar. */
type Grammar = 'typescript' | 'tsx' | 'javascript';

/**
 * Languages whose named definitions can be found. Any other file takes whole-file references only.
 * `svelte` has no grammar of its own: the definitions of a component are those of its script blocks.
 */
export type Lang = Grammar | 'svelte';

const EXTENSIONS: Record<string, Lang> = {
	ts: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	tsx: 'tsx',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'javascript',
	svelte: 'svelte'
};

export function languageOf(path: string): Lang | undefined {
	const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase();
	return ext ? EXTENSIONS[ext] : undefined;
}

/** An inclusive, 1-based line range. */
export interface Lines {
	start: number;
	end: number;
}

/** One declaration of a definition: its lines, and the comment lines directly above it. */
export interface Extent extends Lines {
	kind: string;
	/** Comment lines that end on the line above the declaration, with no blank line between. */
	comment?: Lines;
}

export interface Definition {
	/** Its name: the names of the enclosing named definitions, then its own, as `joinName` writes them. */
	name: string;
	/** The segments of the name, outermost first. */
	path: string[];
	/**
	 * One extent per declaration. A name declared several times in one scope (overloads, a value and
	 * a type, a getter and a setter, merged interfaces) is one definition with several extents.
	 */
	extents: Extent[];
	/** True when the same dotted name is declared in different scopes, so the name picks no one definition. */
	ambiguous: boolean;
	/** Source text of the declarations, without their leading comments. */
	text: string;
	/** A digest of the syntax of the declarations with their layout taken out: equal for two texts that differ only in white space. */
	syntax: string;
	/** Source text of the leading comments. */
	commentText: string;
	/** Identifiers used inside the declarations (candidates for other definitions it is built from). */
	uses: string[];
}

export interface FileDefinitions {
	definitions: Map<string, Definition>;
	/** A digest of the syntax of the whole file with its layout taken out. Absent when only part of the file is parsed. */
	syntax?: string;
	/** True when the parser met syntax it could not read; definitions around it may be missing. */
	parseErrors: boolean;
}

// ---- grammars ---------------------------------------------------------------------------------

const GRAMMARS: Record<Grammar, [pkg: string, file: string]> = {
	typescript: ['tree-sitter-typescript', 'tree-sitter-typescript.wasm'],
	tsx: ['tree-sitter-typescript', 'tree-sitter-tsx.wasm'],
	javascript: ['tree-sitter-javascript', 'tree-sitter-javascript.wasm']
};

/** The grammar file: from the grammar's npm package in a source checkout, else `<package>/grammars/` as shipped. */
function grammarFile(lang: Grammar): string {
	const [pkg, file] = GRAMMARS[lang];
	try {
		return createRequire(import.meta.url).resolve(`${pkg}/${file}`);
	} catch {
		// not installed: a built package carries only the .wasm files
	}
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 6; i++) {
		const shipped = join(dir, 'grammars', file);
		if (existsSync(shipped)) return shipped;
		dir = dirname(dir);
	}
	throw new Error(`no ${lang} grammar: neither the ${pkg} package nor a shipped grammars/${file}`);
}

let ready: Promise<void> | undefined;
const parsers = new Map<Grammar, Promise<Parser>>();

function parserFor(lang: Grammar): Promise<Parser> {
	let p = parsers.get(lang);
	if (!p) {
		p = (async () => {
			await (ready ??= Parser.init());
			const parser = new Parser();
			parser.setLanguage(await Language.load(grammarFile(lang)));
			return parser;
		})();
		parsers.set(lang, p);
	}
	return p;
}

// ---- what counts as a named definition ----------------------------------------------------------

const KINDS: Record<string, string> = {
	function_declaration: 'function',
	generator_function_declaration: 'function',
	function_signature: 'function',
	class_declaration: 'class',
	abstract_class_declaration: 'class',
	interface_declaration: 'interface',
	type_alias_declaration: 'type',
	enum_declaration: 'enum',
	internal_module: 'namespace',
	module: 'namespace',
	variable_declarator: 'variable',
	method_definition: 'method',
	method_signature: 'method',
	abstract_method_signature: 'method',
	public_field_definition: 'field',
	field_definition: 'field',
	pair: 'property',
	property_signature: 'property',
	enum_assignment: 'member'
};

function nameText(n: Node | null): string | undefined {
	if (!n) return undefined;
	switch (n.type) {
		case 'identifier':
		case 'type_identifier':
		case 'property_identifier':
		case 'private_property_identifier':
		case 'nested_identifier':
		case 'number':
			return n.text;
		case 'string':
			return n.text.slice(1, -1);
		default:
			// Destructuring patterns and computed keys have no one name.
			return undefined;
	}
}

/** A string or number literal as written; a string without its quotes. */
function literalOf(n: Node | null | undefined): Literal | undefined {
	if (n?.type === 'string') return { text: n.text.slice(1, -1), quoted: true };
	if (n?.type === 'number') return { text: n.text, quoted: false };
	return undefined;
}

/** An object that is an entry of an array: one name for each property whose value is a literal. */
function entryNames(n: Node): string[] {
	const names = new Set<string>();
	for (const pair of n.namedChildren) {
		if (pair.type !== 'pair') continue;
		const key = nameText(pair.childForFieldName('key'));
		const value = literalOf(pair.childForFieldName('value'));
		const segment = key && value ? entrySegment(key, value) : undefined;
		if (segment) names.add(segment);
	}
	return [...names];
}

/** `a`, `a.b`, `this.a`: the names of a plain chain of member accesses. */
function chainOf(n: Node | null): string[] | undefined {
	if (n?.type === 'identifier' || n?.type === 'this') return [n.text];
	if (n?.type !== 'member_expression') return undefined;
	const property = n.childForFieldName('property');
	const object = chainOf(n.childForFieldName('object'));
	return object && property && (property.type === 'property_identifier' || property.type === 'private_property_identifier') ? [...object, property.text] : undefined;
}

/**
 * A statement that is a call, or a chain of calls: named by the first call in it whose first
 * argument is a string, as `callee('string')`. So `router.get('/notes', handler)` and
 * `program.command('list').action(run)` have names though they declare nothing.
 */
function callName(statement: Node): string[] | undefined {
	let e: Node | null = statement.namedChildren[0] ?? null;
	if (e?.type === 'await_expression') e = e.namedChildren[0] ?? null;
	const calls: Node[] = [];
	while (e?.type === 'call_expression') {
		calls.unshift(e);
		const callee: Node | null = e.childForFieldName('function');
		e = callee?.type === 'member_expression' ? callee.childForFieldName('object') : null;
	}
	for (const call of calls) {
		const first = call.childForFieldName('arguments')?.namedChildren[0];
		if (first?.type !== 'string') continue;
		const chain = chainOf(call.childForFieldName('function'));
		return chain ? [...chain.slice(0, -1).map(nameSegment), labelSegment(chain[chain.length - 1], literalOf(first)!)] : undefined;
	}
	return undefined;
}

/**
 * The names a node declares and its kind, if it has a name. Each name is a list of segments; what
 * is named inside the node goes under the first.
 */
function declared(n: Node): { names: string[][]; kind: string } | undefined {
	const kind = KINDS[n.type];
	if (kind) {
		// The JavaScript grammar calls a class field's name `property`.
		const name = nameText(n.childForFieldName(n.type === 'pair' ? 'key' : 'name') ?? n.childForFieldName('property'));
		if (!name) return undefined;
		return { names: [n.type === 'internal_module' || n.type === 'module' ? name.split('.').map(nameSegment) : [nameSegment(name)]], kind };
	}
	// A bare enum member (`enum E { A }`) is a property_identifier directly in the body.
	if (n.type === 'property_identifier' && n.parent?.type === 'enum_body') return { names: [[n.text]], kind: 'member' };
	// `export default <expression or unnamed function/class>` is named `default`.
	if (n.type === 'export_statement' && n.children.some((c) => c.type === 'default')) {
		const inner = n.childForFieldName('declaration') ?? n.childForFieldName('value');
		if (!inner || !KINDS[inner.type] || !nameText(inner.childForFieldName('name'))) return { names: [['default']], kind: 'default' };
	}
	if (n.type === 'object' && n.parent?.type === 'array') {
		const names = entryNames(n);
		return names.length ? { names: names.map((s) => [s]), kind: 'entry' } : undefined;
	}
	if (n.type === 'switch_case') {
		const label = literalOf(n.childForFieldName('value'));
		return label ? { names: [[labelSegment('case', label)]], kind: 'case' } : undefined;
	}
	if (n.type === 'expression_statement') {
		const name = callName(n);
		return name ? { names: [name], kind: 'call' } : undefined;
	}
	return undefined;
}

/** The whole statement a declaration belongs to: `export`, `declare` and a lone `const` are part of it. */
function statementOf(n: Node): Node {
	let cur = n;
	if (cur.type === 'variable_declarator') {
		const decl = cur.parent;
		const lone = decl && (decl.type === 'lexical_declaration' || decl.type === 'variable_declaration') && decl.namedChildren.filter((c) => c.type === 'variable_declarator').length === 1;
		if (!lone) return cur;
		cur = decl;
	}
	while (cur.parent && (cur.parent.type === 'export_statement' || cur.parent.type === 'ambient_declaration' || (cur.parent.type === 'expression_statement' && cur.type === 'internal_module'))) cur = cur.parent;
	return cur;
}

const USES = new Set(['identifier', 'type_identifier', 'shorthand_property_identifier']);

function collectUses(n: Node, into: Set<string>) {
	if (USES.has(n.type)) into.add(n.text);
	for (const c of n.namedChildren) collectUses(c, into);
}

/** What `syntaxOf` reads of a node of a syntax tree. */
export interface SyntaxNode {
	id: number;
	type: string;
	startIndex: number;
	endIndex: number;
	childCount: number;
	children: SyntaxNode[];
}

const digest = (text: string) => createHash('sha256').update(text).digest('base64');

/**
 * The syntax tree of a node written out with the text of every token, and nothing of the layout
 * between them. Text that no token covers is kept as it is; the lines of a comment are trimmed.
 * The tree is read once: the nodes whose ids `wanted` holds get their own digest on the way.
 */
function writeSyntax(n: SyntaxNode, source: string, wanted?: Map<number, string>): string {
	const sep = '\u0000';
	if (n.childCount === 0) {
		const text = source.slice(n.startIndex, n.endIndex);
		return n.type + sep + (n.type === 'comment' ? trimLines(text) : text) + sep;
	}
	let out = '(' + sep + n.type + sep;
	let at = n.startIndex;
	for (const c of n.children) {
		const gap = source.slice(at, c.startIndex);
		if (gap.trim()) out += gap + sep;
		out += writeSyntax(c, source, wanted);
		at = c.endIndex;
	}
	const rest = source.slice(at, n.endIndex);
	if (rest.trim()) out += rest + sep;
	out += ')' + sep;
	if (wanted?.has(n.id)) wanted.set(n.id, digest(out));
	return out;
}

/**
 * A digest of the syntax of a node without its layout: kept in place of the text, which is several
 * times the source. `wanted` asks for the digest of nodes inside it too, by id.
 */
export function syntaxOf(n: SyntaxNode, source: string, wanted?: Map<number, string>): string {
	return digest(writeSyntax(n, source, wanted));
}

/** Text with the white space at both ends of every line removed. */
export const trimLines = (text: string) =>
	text
		.split('\n')
		.map((l) => l.trim())
		.join('\n');

interface Found {
	scope: number;
	path: string[];
	statements: Node[];
	extents: Extent[];
}

// ---- Svelte components ------------------------------------------------------------------------------

/**
 * An HTML comment, or a script tag with its attributes and content. It is the expression Svelte's
 * own preprocessor finds script blocks with, so what counts as one here is what counts as one there.
 */
const SCRIPT_TAG = /<!--[^]*?-->|<script((?:\s+[^=>'"/\s]+(?:=(?:"[^"]*"|'[^']*'|[^>\s]+))?)*\s*)(?:\/>|>([\S\s]*?)<\/script>)/g;
const CLOSE_TAG = '</script>';
const TYPESCRIPT = /(?:^|\s)lang\s*=\s*["']?(?:ts|typescript)["']?(?:\s|$)/;

/**
 * The script blocks of a Svelte component as one source text: everything outside them is blanked,
 * character for character, so every line and column is where it is in the component. Markup has no
 * names to find, so nothing in it is a definition.
 */
export function svelteScripts(source: string): { code: string; lang: Grammar } {
	const blank = (text: string) => text.replace(/[^\n\r]/g, ' ');
	let code = '';
	let at = 0;
	let typescript = false;
	for (const m of source.matchAll(SCRIPT_TAG)) {
		const content = m[2];
		if (content === undefined) continue; // a comment, or a self-closing tag
		const start = m.index + m[0].length - CLOSE_TAG.length - content.length;
		code += blank(source.slice(at, start)) + content;
		at = start + content.length;
		if (TYPESCRIPT.test(m[1] ?? '')) typescript = true;
	}
	return { code: code + blank(source.slice(at)), lang: typescript ? 'typescript' : 'javascript' };
}

/** Finds every named definition in a source file. */
export async function parseDefinitions(source: string, lang: Lang): Promise<FileDefinitions> {
	if (lang === 'svelte') {
		const scripts = svelteScripts(source);
		// The markup is not in what was parsed, so the syntax of the script is not that of the file.
		const { definitions, parseErrors } = await parseDefinitions(scripts.code, scripts.lang);
		return { definitions, parseErrors };
	}
	const parser = await parserFor(lang);
	const tree = parser.parse(source);
	if (!tree) throw new Error('the parser returned no tree');
	try {
		const lines = source.split('\n');
		const startsItsLine = (n: Node) => lines[n.startPosition.row].slice(0, n.startPosition.column).trim() === '';
		const leadingComment = (statement: Node): Lines | undefined => {
			let top = statement.startPosition.row;
			let first: number | undefined;
			for (let p = statement.previousNamedSibling; p && p.type === 'comment' && p.endPosition.row === top - 1 && startsItsLine(p); p = p.previousNamedSibling) {
				first = top = p.startPosition.row;
			}
			return first === undefined ? undefined : { start: first + 1, end: statement.startPosition.row };
		};

		const found = new Map<string, Found[]>();
		const visit = (n: Node, path: string[]) => {
			const d = declared(n);
			let inner = path;
			if (d) {
				inner = [...path, ...d.names[0]];
				const statement = statementOf(n);
				const scope = statement.parent?.id ?? 0;
				const extent: Extent = { kind: d.kind, start: statement.startPosition.row + 1, end: statement.endPosition.row + 1, comment: leadingComment(statement) };
				for (const name of d.names) {
					const full = [...path, ...name];
					const key = joinName(full);
					const groups = found.get(key) ?? [];
					let group = groups.find((g) => g.scope === scope);
					if (!group) groups.push((group = { scope, path: full, statements: [], extents: [] }));
					group.statements.push(statement);
					group.extents.push(extent);
					found.set(key, groups);
				}
			}
			for (const c of n.namedChildren) visit(c, inner);
		};
		visit(tree.rootNode, []);

		// The syntax of the file and of every statement found, in one reading of the tree.
		const syntax = new Map<number, string>();
		for (const groups of found.values()) for (const g of groups) for (const s of g.statements) syntax.set(s.id, '');
		const fileSyntax = syntaxOf(tree.rootNode, source, syntax);
		// A statement can carry several names (an array entry has one for each literal property): read it once.
		const uses = new Map<number, Set<string>>();
		const usesOf = (s: Node) => {
			let u = uses.get(s.id);
			if (!u) {
				collectUses(s, (u = new Set<string>()));
				uses.set(s.id, u);
			}
			return u;
		};
		const definitions = new Map<string, Definition>();
		for (const [name, groups] of found) {
			const statements = groups.flatMap((g) => g.statements);
			const extents = groups.flatMap((g) => g.extents);
			definitions.set(name, {
				name,
				path: groups[0].path,
				extents,
				ambiguous: groups.length > 1,
				text: statements.map((s) => s.text).join('\n'),
				syntax: statements.map((s) => syntax.get(s.id)).join(' '),
				commentText: extents.map((e) => (e.comment ? lines.slice(e.comment.start - 1, e.comment.end).join('\n') : '')).join('\n'),
				uses: [...new Set(statements.flatMap((s) => [...usesOf(s)]))]
			});
		}
		return { definitions, syntax: fileSyntax, parseErrors: tree.rootNode.hasError };
	} finally {
		tree.delete();
	}
}
