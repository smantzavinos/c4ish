/**
 * A code reference names where a model element lives in the repository:
 *   `path`                          a whole file
 *   `path#Name`                     a named definition in that file
 *   `path#Outer.Inner`              a definition nested inside other named definitions
 *   `path#Outer['a.b']`             a definition whose name has a character the syntax uses
 *   `path#LIST[name='x']`           the entry of an array whose property `name` is 'x'
 *   `path#router.get('/notes')`     a call statement, by the text it is given
 *   `path#handle.case('save')`      a case of a switch
 * The path is relative to the repository root and uses `/`. This module only parses the text; it
 * touches neither the file system nor a parser, so it is safe in the browser.
 */
export interface CodeRef {
	/** The reference as written. */
	raw: string;
	path: string;
	/** Name segments, outermost first, each as `joinName` writes it. Absent for a whole-file reference. */
	name?: string[];
}

/** A string or a number as the code writes it; a string without its quotes. */
export interface Literal {
	text: string;
	quoted: boolean;
}

/** A name that can be written as it is: it has none of the characters the syntax uses. */
const BARE = /^[^\s.[\]()'=\\]+/;
const NUMBER = /^[0-9][0-9A-Za-z_.]*/;

const written = (l: Literal) => (l.quoted ? `'${l.text.replace(/[\\']/g, '\\$&')}'` : l.text);
const isBare = (name: string) => BARE.exec(name)?.[0] === name;

/** The segment for a named definition: the name, or `['name']` when it has a character the syntax uses. */
export const nameSegment = (name: string) => (isBare(name) ? name : `[${written({ text: name, quoted: true })}]`);
/** The segment for an array entry, by a property of it. Undefined when the property's name cannot be written bare. */
export const entrySegment = (key: string, value: Literal) => (isBare(key) ? `[${key}=${written(value)}]` : undefined);
/** The segment for something a literal labels: a call (`get('/notes')`) or a case (`case('save')`). */
export const labelSegment = (name: string, label: Literal) => `${name}(${written(label)})`;

/** One name from its segments: a `.` before each, except before one in brackets. */
export const joinName = (segments: string[]) => segments.map((s, i) => (i && !s.startsWith('[') ? '.' : '') + s).join('');

/** Splits a name into its segments, each in the one form `joinName` writes. Undefined when it is not a name. */
function parseName(text: string): string[] | undefined {
	const segments: string[] = [];
	let at = 0;
	const take = (re: RegExp) => {
		const found = re.exec(text.slice(at))?.[0];
		at += found?.length ?? 0;
		return found;
	};
	const literal = (): Literal | undefined => {
		if (text[at] !== "'") {
			const number = take(NUMBER);
			return number === undefined ? undefined : { text: number, quoted: false };
		}
		let out = '';
		for (at++; text[at] !== "'"; at++) {
			if (text[at] === '\\') at++;
			if (at >= text.length) return undefined;
			out += text[at];
		}
		at++;
		return { text: out, quoted: true };
	};
	for (;;) {
		if (text[at] === '[') {
			if (!segments.length) return undefined;
			at++;
			const key = text[at] === "'" ? undefined : take(BARE);
			if (key !== undefined && text[at++] !== '=') return undefined;
			const value = literal();
			if (!value || text[at++] !== ']') return undefined;
			segments.push(key === undefined ? nameSegment(value.text) : entrySegment(key, value)!);
		} else {
			const name = take(BARE);
			// A private member is written `Class.#field`; no other "#" is allowed after the first.
			if (!name || name.slice(1).includes('#')) return undefined;
			if (text[at] === '(') {
				at++;
				const label = literal();
				if (!label || text[at++] !== ')') return undefined;
				segments.push(labelSegment(name, label));
			} else segments.push(name);
		}
		if (at === text.length) return segments;
		if (text[at] === '.') {
			at++;
			if (at === text.length || text[at] === '[') return undefined;
		} else if (text[at] !== '[') return undefined;
	}
}

/** Parses a reference, or returns why it is not one. */
export function parseCodeRef(raw: string): CodeRef | { error: string } {
	if (raw !== raw.trim() || !raw) return { error: 'is empty or has surrounding spaces' };
	const hash = raw.indexOf('#');
	const path = hash < 0 ? raw : raw.slice(0, hash);
	if (!path) return { error: 'has no path before "#"' };
	if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return { error: 'must be relative to the repository root' };
	if (path.includes('\\')) return { error: 'must use "/" in its path' };
	const segments = path.split('/');
	if (segments.some((s) => s === '' || s === '.' || s === '..')) return { error: 'has an empty, "." or ".." path segment' };
	if (hash < 0) return { raw, path };
	const name = parseName(raw.slice(hash + 1));
	if (!name) return { error: 'has an empty or malformed name after "#"' };
	return { raw, path, name };
}

export function isCodeRef(r: CodeRef | { error: string }): r is CodeRef {
	return !('error' in r);
}
