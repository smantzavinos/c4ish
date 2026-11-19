import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Language, Parser, type Node } from 'web-tree-sitter';

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
	/** Dotted name: the names of the enclosing named definitions, then its own. */
	name: string;
	/**
	 * One extent per declaration. A name declared several times in one scope (overloads, a value and
	 * a type, a getter and a setter, merged interfaces) is one definition with several extents.
	 */
	extents: Extent[];
	/** True when the same dotted name is declared in different scopes, so the name picks no one definition. */
	ambiguous: boolean;
	/** Source text of the declarations, without their leading comments. */
	text: string;
	/** Source text of the leading comments. */
	commentText: string;
	/** Identifiers used inside the declarations (candidates for other definitions it is built from). */
	uses: string[];
}

export interface FileDefinitions {
	definitions: Map<string, Definition>;
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

/** The name and kind a node declares, if it is a named definition. */
function declared(n: Node): { name: string; kind: string } | undefined {
	const kind = KINDS[n.type];
	if (kind) {
		// The JavaScript grammar calls a class field's name `property`.
		const name = nameText(n.childForFieldName(n.type === 'pair' ? 'key' : 'name') ?? n.childForFieldName('property'));
		return name ? { name, kind } : undefined;
	}
	// A bare enum member (`enum E { A }`) is a property_identifier directly in the body.
	if (n.type === 'property_identifier' && n.parent?.type === 'enum_body') return { name: n.text, kind: 'member' };
	// `export default <expression or unnamed function/class>` is named `default`.
	if (n.type === 'export_statement' && n.children.some((c) => c.type === 'default')) {
		const inner = n.childForFieldName('declaration') ?? n.childForFieldName('value');
		if (!inner || !KINDS[inner.type] || !nameText(inner.childForFieldName('name'))) return { name: 'default', kind: 'default' };
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

interface Found {
	scope: number;
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
		return parseDefinitions(scripts.code, scripts.lang);
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
				inner = [...path, ...(n.type === 'internal_module' || n.type === 'module' ? d.name.split('.') : [d.name])];
				const statement = statementOf(n);
				const scope = statement.parent?.id ?? 0;
				const key = inner.join('.');
				const groups = found.get(key) ?? [];
				let group = groups.find((g) => g.scope === scope);
				if (!group) groups.push((group = { scope, statements: [], extents: [] }));
				group.statements.push(statement);
				group.extents.push({ kind: d.kind, start: statement.startPosition.row + 1, end: statement.endPosition.row + 1, comment: leadingComment(statement) });
				found.set(key, groups);
			}
			for (const c of n.namedChildren) visit(c, inner);
		};
		visit(tree.rootNode, []);

		const definitions = new Map<string, Definition>();
		for (const [name, groups] of found) {
			const statements = groups.flatMap((g) => g.statements);
			const extents = groups.flatMap((g) => g.extents);
			const uses = new Set<string>();
			statements.forEach((s) => collectUses(s, uses));
			definitions.set(name, {
				name,
				extents,
				ambiguous: groups.length > 1,
				text: statements.map((s) => s.text).join('\n'),
				commentText: extents.map((e) => (e.comment ? lines.slice(e.comment.start - 1, e.comment.end).join('\n') : '')).join('\n'),
				uses: [...uses]
			});
		}
		return { definitions, parseErrors: tree.rootNode.hasError };
	} finally {
		tree.delete();
	}
}
