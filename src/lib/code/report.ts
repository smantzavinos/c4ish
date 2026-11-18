import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Model, Profile } from '../model/types.js';
import { languageOf, parseDefinitions, type Definition, type Extent, type FileDefinitions, type Lines } from './definitions.js';
import { isCodeRef, parseCodeRef, type CodeRef } from './reference.js';

/** A model element (or one of its parts) that carries a reference. */
export interface RefOwner {
	element: string;
	/** Title of the part, when the reference is on a part. */
	part?: string;
	/** The owner's change state as written in the model, and that state's style in the profile. */
	change?: string;
	style?: string;
}

export type SideStatus = 'resolved' | 'missing-file' | 'missing-name' | 'ambiguous' | 'unsupported' | 'invalid';

/** How a reference resolves at one end (the base commit or the working tree). */
export interface RefSide {
	status: SideStatus;
	/** Where it is. A whole-file reference has one extent of kind `file`. */
	extents?: Extent[];
	detail?: string;
}

export interface RefHint {
	kind: 'renamed' | 'moved';
	ref: string;
}

export interface RefReport {
	ref: string;
	owners: RefOwner[];
	head: RefSide;
	/** Present when a base commit was given. */
	base?: RefSide;
	/**
	 * What happened to the referenced code between the base and the working tree, by comparing its
	 * text (so a definition that only moved within its file is unchanged). `missing`: at neither end.
	 */
	delta?: 'added' | 'removed' | 'modified' | 'unchanged' | 'missing';
	/** The comment lines directly above the definition differ. */
	commentChanged?: boolean;
	/** Changed top-level definitions of the same file that this one is built from, directly or not. */
	changedThrough?: string[];
	/** Where a reference that no longer resolves may have gone. */
	hints?: RefHint[];
	/** Why the reference cannot be used as written. Any problem makes the command fail. */
	problem?: string;
}

/** A run of changed lines and the references that contain it, innermost first. */
export interface ChangedLines extends Lines {
	refs: { ref: string; in: 'body' | 'comment' }[];
}

export interface FileChange {
	path: string;
	status: 'added' | 'deleted' | 'modified';
	binary?: true;
	/** Lines removed or replaced, numbered as in the base commit. */
	base: ChangedLines[];
	/** Lines added or replacing, numbered as in the working tree. */
	head: ChangedLines[];
}

export interface CodeReport {
	root: string;
	/** The base commit, resolved. Absent when references were only resolved in the working tree. */
	base?: string;
	references: RefReport[];
	/** Every file that differs between the base and the working tree, untracked files included. */
	files?: FileChange[];
	/** Changed lines that sit inside no reference. */
	unowned?: { files: number; ranges: number; lines: number };
	problems: number;
}

export interface CodeReportOptions {
	/** Repository root that reference paths are relative to. */
	root: string;
	/** Commit to compare the working tree against. */
	base?: string;
}

function git(root: string, args: string[]): string {
	return execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The git top level that contains `dir`, or undefined outside a repository. */
export function repositoryRoot(dir: string): string | undefined {
	try {
		return git(dir, ['rev-parse', '--show-toplevel']).trim();
	} catch {
		return undefined;
	}
}

const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

/** One end of the comparison: file contents and their definitions, read once. */
class Side {
	private contents = new Map<string, string | undefined>();
	private parsed = new Map<string, Promise<FileDefinitions | undefined>>();
	constructor(private read: (path: string) => string | undefined) {}

	content(path: string): string | undefined {
		if (!this.contents.has(path)) this.contents.set(path, this.read(path));
		return this.contents.get(path);
	}

	definitions(path: string): Promise<FileDefinitions | undefined> {
		let p = this.parsed.get(path);
		if (!p) {
			const lang = languageOf(path);
			const text = this.content(path);
			p = lang && text !== undefined ? parseDefinitions(text, lang) : Promise.resolve(undefined);
			this.parsed.set(path, p);
		}
		return p;
	}
}

interface Resolved extends RefSide {
	text?: string;
	commentText?: string;
	definition?: Definition;
}

async function resolveRef(ref: CodeRef, side: Side): Promise<Resolved> {
	const content = side.content(ref.path);
	if (!ref.name) {
		if (content === undefined) return { status: 'missing-file' };
		return { status: 'resolved', extents: [{ kind: 'file', start: 1, end: lineCount(content) }], text: content, commentText: '' };
	}
	if (!languageOf(ref.path)) return { status: 'unsupported', detail: `no parser for this file type; reference the whole file (${ref.path})` };
	if (content === undefined) return { status: 'missing-file' };
	const file = (await side.definitions(ref.path))!;
	const name = ref.name.join('.');
	const def = file.definitions.get(name);
	if (!def) {
		const last = ref.name[ref.name.length - 1];
		const near = [...file.definitions.keys()].filter((k) => k === last || k.endsWith(`.${last}`)).slice(0, 3);
		const detail = [near.length ? `did you mean ${near.map((n) => `#${n}`).join(', ')}?` : '', file.parseErrors ? 'the file has syntax the parser could not read' : ''].filter(Boolean).join('; ');
		return { status: 'missing-name', ...(detail ? { detail } : {}) };
	}
	if (def.ambiguous) return { status: 'ambiguous', extents: def.extents, detail: `declared in ${def.extents.length} different places (lines ${def.extents.map((e) => e.start).join(', ')}); qualify the name` };
	return { status: 'resolved', extents: def.extents, text: def.text, commentText: def.commentText, definition: def };
}

const publicSide = ({ status, extents, detail }: Resolved): RefSide => ({ status, ...(extents ? { extents } : {}), ...(detail ? { detail } : {}) });

// ---- what changed ---------------------------------------------------------------------------------

interface RawChange {
	path: string;
	status: FileChange['status'];
	binary?: true;
	base: Lines[];
	head: Lines[];
}

/** Parses `git diff -U0` into changed line ranges per file and side. */
export function parseDiff(diff: string): RawChange[] {
	const out: RawChange[] = [];
	let cur: RawChange | undefined;
	for (const line of diff.split('\n')) {
		if (line.startsWith('diff --git ')) {
			// `a/<path> b/<path>`, the same path twice because renames are off.
			const rest = line.slice('diff --git '.length);
			cur = { path: rest.slice(2, 2 + (rest.length - 5) / 2), status: 'modified', base: [], head: [] };
			out.push(cur);
		} else if (!cur) continue;
		else if (line.startsWith('new file mode')) cur.status = 'added';
		else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
		else if (line.startsWith('Binary files ')) cur.binary = true;
		else if (line.startsWith('@@ ')) {
			const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
			if (!m) continue;
			const [a, b, c, d] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
			if (b > 0) cur.base.push({ start: a, end: a + b - 1 });
			if (d > 0) cur.head.push({ start: c, end: c + d - 1 });
		}
	}
	return out;
}

function changesSince(root: string, base: string): RawChange[] {
	const changes = parseDiff(git(root, ['diff', '--no-color', '--no-ext-diff', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', '-U0', base, '--']));
	for (const path of git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
		const text = readFileSync(join(root, path), 'utf8');
		const binary = text.includes('\0');
		const n = lineCount(text);
		changes.push({ path, status: 'added', ...(binary ? { binary: true as const } : {}), base: [], head: !binary && n ? [{ start: 1, end: n }] : [] });
	}
	return changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

interface Region extends Lines {
	ref: string;
	in: 'body' | 'comment';
	size: number;
}

/** Splits changed ranges where the set of containing references changes. */
function attribute(ranges: Lines[], regions: Region[]): ChangedLines[] {
	const out: ChangedLines[] = [];
	for (const r of ranges) {
		const cuts = new Set<number>([r.start, r.end + 1]);
		for (const g of regions) {
			if (g.start > r.start && g.start <= r.end) cuts.add(g.start);
			if (g.end >= r.start && g.end < r.end) cuts.add(g.end + 1);
		}
		const points = [...cuts].sort((a, b) => a - b);
		for (let i = 0; i + 1 < points.length; i++) {
			const start = points[i];
			const end = points[i + 1] - 1;
			const refs = regions
				.filter((g) => g.start <= start && g.end >= end)
				.sort((a, b) => a.size - b.size || (a.ref < b.ref ? -1 : 1))
				.map((g) => ({ ref: g.ref, in: g.in }));
			const prev = out[out.length - 1];
			if (prev && prev.end === start - 1 && start > r.start && JSON.stringify(prev.refs) === JSON.stringify(refs)) prev.end = end;
			else out.push({ start, end, refs });
		}
	}
	return out;
}

function regionsOf(ref: string, side: RefSide | undefined): Region[] {
	if (side?.status !== 'resolved') return [];
	return (side.extents ?? []).flatMap((e) => {
		const size = e.end - e.start + 1;
		const body: Region = { ref, in: 'body', start: e.start, end: e.end, size };
		return e.comment ? [body, { ref, in: 'comment' as const, start: e.comment.start, end: e.comment.end, size }] : [body];
	});
}

// ---- the report -----------------------------------------------------------------------------------

/**
 * Resolves every code reference of a model in the working tree and, given a base commit, at that
 * commit too; then says what happened to each and which references contain each changed line.
 * It reports facts only. What a difference means is the caller's business.
 */
export async function codeReport(model: Model, profile: Profile, options: CodeReportOptions): Promise<CodeReport> {
	const root = options.root;
	const base = options.base === undefined ? undefined : git(root, ['rev-parse', '--verify', `${options.base}^{commit}`]).trim();

	const head = new Side((path) => {
		const file = join(root, path);
		return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;
	});
	const before =
		base === undefined
			? undefined
			: new Side((path) => {
					try {
						return git(root, ['cat-file', 'blob', `${base}:${path}`]);
					} catch {
						return undefined;
					}
				});

	// One entry per distinct reference, with everything in the model that carries it.
	const owners = new Map<string, RefOwner[]>();
	const own = (raw: string, owner: RefOwner) => {
		const style = owner.change === undefined ? undefined : profile.changeStates[owner.change]?.style;
		owners.set(raw, [...(owners.get(raw) ?? []), { ...owner, ...(style ? { style } : {}) }]);
	};
	for (const e of model.elements) {
		for (const raw of e.code ?? []) own(raw, { element: e.id, ...(e.change ? { change: e.change } : {}) });
		for (const p of e.parts ?? []) for (const raw of p.code ?? []) own(raw, { element: e.id, part: p.title, ...(p.change ? { change: p.change } : {}) });
	}

	const changes = base === undefined ? undefined : changesSince(root, base);
	const references: RefReport[] = [];
	const resolved = new Map<string, { ref: CodeRef; head: Resolved; base?: Resolved }>();

	for (const [raw, who] of owners) {
		const ref = parseCodeRef(raw);
		if (!isCodeRef(ref)) {
			references.push({ ref: raw, owners: who, head: { status: 'invalid', detail: ref.error }, problem: `not a code reference: ${ref.error}` });
			continue;
		}
		const h = await resolveRef(ref, head);
		const b = before ? await resolveRef(ref, before) : undefined;
		resolved.set(raw, { ref, head: h, base: b });
		const report: RefReport = { ref: raw, owners: who, head: publicSide(h), ...(b ? { base: publicSide(b) } : {}) };

		const unusable = [h, b].find((s) => s && (s.status === 'unsupported' || s.status === 'ambiguous'));
		if (unusable) report.problem = unusable.detail;
		else if (h.status !== 'resolved' && (!b || b.status !== 'resolved'))
			report.problem = `${h.status === 'missing-file' ? 'no such file' : 'no such definition'}${b ? ' at the base or in the working tree' : ''}${h.detail ? ` (${h.detail})` : ''}`;

		if (b && !unusable) {
			const [atHead, atBase] = [h.status === 'resolved', b.status === 'resolved'];
			report.delta = atHead && atBase ? (h.text === b.text ? 'unchanged' : 'modified') : atHead ? 'added' : atBase ? 'removed' : 'missing';
			if (atHead && atBase && h.commentText !== b.commentText) report.commentChanged = true;
			if (atHead && atBase && ref.name) {
				const through = await changedThrough(ref, h.definition!, head, before!);
				if (through.length) report.changedThrough = through;
			}
			if (atBase && !atHead) {
				const hints = await whereItWent(ref, b, head, before!, changes!);
				if (hints.length) report.hints = hints;
			}
		}
		references.push(report);
	}

	const out: CodeReport = { root, ...(base ? { base } : {}), references, problems: references.filter((r) => r.problem).length };
	if (changes) {
		const regions = (path: string, side: 'head' | 'base') =>
			[...resolved].filter(([, r]) => r.ref.path === path).flatMap(([raw, r]) => regionsOf(raw, r[side]));
		out.files = changes.map((c) => ({
			path: c.path,
			status: c.status,
			...(c.binary ? { binary: true as const } : {}),
			base: attribute(c.base, regions(c.path, 'base')),
			head: attribute(c.head, regions(c.path, 'head'))
		}));
		const loose = out.files.map((f) => [...f.base, ...f.head].filter((r) => !r.refs.length)).filter((rs) => rs.length);
		out.unowned = { files: loose.length, ranges: loose.flat().length, lines: loose.flat().reduce((n, r) => n + r.end - r.start + 1, 0) };
	}
	return out;
}

const topLevel = (file: FileDefinitions | undefined) => new Map([...(file?.definitions ?? [])].filter(([name]) => !name.includes('.')));

/**
 * Top-level definitions of the same file that `def` uses, directly or through other top-level
 * definitions, and whose text differs between the base and the working tree. Names are matched as
 * written, so a local variable that shadows a top-level name counts as a use of it.
 */
async function changedThrough(ref: CodeRef, def: Definition, head: Side, base: Side): Promise<string[]> {
	const now = topLevel(await head.definitions(ref.path));
	const then = topLevel(await base.definitions(ref.path));
	const own = ref.name![0];
	const seen = new Set<string>([own]);
	const queue = [...def.uses];
	const changed: string[] = [];
	while (queue.length) {
		const name = queue.pop()!;
		if (seen.has(name) || (!now.has(name) && !then.has(name))) continue;
		seen.add(name);
		if (now.get(name)?.text !== then.get(name)?.text) changed.push(`${ref.path}#${name}`);
		queue.push(...(now.get(name)?.uses ?? []));
	}
	return changed.sort();
}

/** For a reference that resolved at the base but not in the working tree: a rename in place, or a move to another changed file. */
async function whereItWent(ref: CodeRef, was: Resolved, head: Side, base: Side, changes: RawChange[]): Promise<RefHint[]> {
	const hints: RefHint[] = [];
	if (!ref.name) {
		// A whole file: an added file with the same content.
		for (const c of changes) if (c.status === 'added' && c.path !== ref.path && head.content(c.path) === was.text) hints.push({ kind: 'moved', ref: c.path });
		return hints;
	}
	const name = ref.name.join('.');
	const own = ref.name[ref.name.length - 1];
	const parent = ref.name.slice(0, -1).join('.');
	const now = (await head.definitions(ref.path))?.definitions;
	const then = (await base.definitions(ref.path))?.definitions;
	// Renamed in place: a definition with the same parent, new since the base, whose text is the old text under the new name.
	for (const [candidate, def] of now ?? []) {
		const dot = candidate.lastIndexOf('.');
		if (candidate.slice(0, Math.max(dot, 0)) !== parent || then?.has(candidate)) continue;
		if (was.text!.split(own).join(candidate.slice(dot + 1)) === def.text) hints.push({ kind: 'renamed', ref: `${ref.path}#${candidate}` });
	}
	// Moved: the same name, new since the base, in another file the change touched.
	for (const c of changes) {
		if (c.path === ref.path || c.status === 'deleted' || !languageOf(c.path)) continue;
		const there = (await head.definitions(c.path))?.definitions.get(name);
		if (there && !(await base.definitions(c.path))?.definitions.has(name)) hints.push({ kind: 'moved', ref: `${c.path}#${name}` });
	}
	return hints;
}
