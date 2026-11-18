/**
 * A code reference names where a model element lives in the repository:
 *   `path`               a whole file
 *   `path#Name`          a named definition in that file
 *   `path#Outer.Inner`   a definition nested inside other named definitions
 * The path is relative to the repository root and uses `/`. This module only parses the text; it
 * touches neither the file system nor a parser, so it is safe in the browser.
 */
export interface CodeRef {
	/** The reference as written. */
	raw: string;
	path: string;
	/** Name segments, outermost first. Absent for a whole-file reference. */
	name?: string[];
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
	const name = raw.slice(hash + 1).split('.');
	// A private member is written `Class.#field`; no other "#" is allowed after the first.
	if (name.some((s) => s === '' || /\s/.test(s) || s.slice(1).includes('#'))) return { error: 'has an empty or malformed name after "#"' };
	return { raw, path, name };
}

export function isCodeRef(r: CodeRef | { error: string }): r is CodeRef {
	return !('error' in r);
}
