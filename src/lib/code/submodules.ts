import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** One git submodule of the root repository, as a comparison used it. */
export interface Repository {
	/** Its path from the root. */
	path: string;
	/** The commit of the submodule that the base commit of the root points to. Absent when the base has no such submodule. */
	base?: string;
	/** Where the head of the comparison is: the commit the head commit of the root points to, or with the working tree the commit checked out. */
	head?: string;
	/** Why its files could not be read or compared. */
	problem?: string;
}

/** A submodule's own changes: `git diff -U0` text and untracked files, both with paths from the submodule. */
export interface SubmoduleChange {
	path: string;
	diff: string;
	untracked: string[];
}

export type End = 'base' | 'head';

function git(dir: string, args: string[]): string {
	return execFileSync('git', ['-C', dir, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}

const GITLINK = '160000';

/**
 * The submodules of a root repository, for one comparison. A root commit holds a submodule as one
 * pointer to a commit of the submodule, so a file under it is read from the submodule's own
 * repository at that commit, and its changes are the submodule's between the two commits pointed
 * to. Submodules inside a submodule are not followed.
 */
export class Submodules {
	private pointers = new Map<End, Map<string, string>>();
	private used = new Map<string, Repository>();

	/** `base` and `head` are commits of the root; without `head` the head is the working tree. */
	constructor(
		private root: string,
		private base?: string,
		private head?: string
	) {}

	/** Submodule path → the commit pointed to, at one end. With the working tree as head, the pointers of the index. */
	private at(end: End): Map<string, string> {
		let found = this.pointers.get(end);
		if (found) return found;
		found = new Map();
		const commit = end === 'base' ? this.base : this.head;
		try {
			if (commit) {
				// `<mode> <type> <commit>\t<path>`
				for (const entry of git(this.root, ['ls-tree', '-r', '-z', commit]).split('\0')) {
					if (!entry.startsWith(GITLINK)) continue;
					const [meta, path] = entry.split('\t');
					found.set(path, meta.split(' ')[2]);
				}
			} else if (end === 'head') {
				// `<mode> <commit> <stage>\t<path>`
				for (const entry of git(this.root, ['ls-files', '-s', '-z']).split('\0')) {
					if (!entry.startsWith(GITLINK)) continue;
					const [meta, path] = entry.split('\t');
					found.set(path, meta.split(' ')[1]);
				}
			}
		} catch {
			// not a git repository: no submodules
		}
		this.pointers.set(end, found);
		return found;
	}

	/** The submodule that holds `path` at one end, and the path inside it. */
	private holding(path: string, end: End): { sub: string; rest: string } | undefined {
		let sub: string | undefined;
		for (const candidate of this.at(end).keys()) if (path.startsWith(candidate + '/') && (!sub || candidate.length > sub.length)) sub = candidate;
		return sub === undefined ? undefined : { sub, rest: path.slice(sub.length + 1) };
	}

	/** Whether `path` is a submodule pointer at either end. */
	isPointer(path: string): boolean {
		return this.at('base').has(path) || this.at('head').has(path);
	}

	private entry(sub: string): Repository {
		let r = this.used.get(sub);
		if (!r) {
			r = { path: sub };
			const base = this.at('base').get(sub);
			if (base) r.base = base;
			this.used.set(sub, r);
		}
		return r;
	}

	private checkedOut(sub: string): boolean {
		return existsSync(join(this.root, sub, '.git'));
	}

	/** Whether the submodule's local repository holds `commit`; a problem is recorded when it cannot be used. */
	private usable(sub: string, commit: string, end: End): boolean {
		const r = this.entry(sub);
		if (!this.checkedOut(sub)) {
			r.problem ??= `submodule ${sub} is not checked out, so its files cannot be read or compared`;
			return false;
		}
		try {
			git(join(this.root, sub), ['cat-file', '-e', `${commit}^{commit}`]);
			return true;
		} catch {
			r.problem ??= `commit ${commit.slice(0, 10)} of submodule ${sub}, which the ${end} commit points to, is not in its local repository; fetch it`;
			return false;
		}
	}

	/**
	 * A file at a commit of the root. `false` when no submodule holds the path, so the root does;
	 * otherwise its content in the submodule at the commit pointed to, or undefined.
	 */
	read(end: End, path: string): string | undefined | false {
		const held = this.holding(path, end);
		if (!held) return false;
		const commit = this.at(end).get(held.sub)!;
		if (end === 'head') this.entry(held.sub).head = commit;
		if (!this.usable(held.sub, commit, end)) return undefined;
		try {
			return git(join(this.root, held.sub), ['cat-file', 'blob', `${commit}:${held.rest}`]);
		} catch {
			return undefined;
		}
	}

	/** Called for a path read from the working tree: notes the submodule that holds it, and a problem when it is not checked out. */
	readFromDisk(path: string): void {
		const held = this.holding(path, 'head');
		if (!held) return;
		const r = this.entry(held.sub);
		if (!this.checkedOut(held.sub)) r.problem ??= `submodule ${held.sub} is not checked out, so its files cannot be read or compared`;
		else r.head ??= this.checkedOutCommit(held.sub);
	}

	private checkedOutCommit(sub: string): string | undefined {
		try {
			return git(join(this.root, sub), ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
		} catch {
			return undefined;
		}
	}

	/** The problem of the submodule that holds `path`, if it has one. */
	problemFor(path: string): string | undefined {
		for (const end of ['head', 'base'] as const) {
			const held = this.holding(path, end);
			const problem = held && this.used.get(held.sub)?.problem;
			if (problem) return problem;
		}
		return undefined;
	}

	/** What differs inside each submodule between the two ends. Needs a base. */
	changes(): SubmoduleChange[] {
		const out: SubmoduleChange[] = [];
		const [base, head] = [this.at('base'), this.at('head')];
		for (const sub of [...new Set([...base.keys(), ...head.keys()])].sort()) {
			const from = base.get(sub);
			const to = head.get(sub);
			if (to === undefined) {
				this.entry(sub).problem ??= `submodule ${sub} is at the base and not at the head; a removed submodule is not compared`;
				continue;
			}
			const present = this.checkedOut(sub);
			// At a head commit the pointer says it all; in the working tree only a checkout can differ from its pointer.
			if (from === to && (this.head || !present)) continue;
			if (!present) {
				const r = this.entry(sub);
				r.head = to;
				r.problem ??= `submodule ${sub} is not checked out, so its files cannot be read or compared`;
				continue;
			}
			const dir = join(this.root, sub);
			if ((from && !this.usable(sub, from, 'base')) || (this.head && !this.usable(sub, to, 'head'))) {
				this.entry(sub).head = this.head ? to : this.checkedOutCommit(sub);
				continue;
			}
			// A submodule new since the base is compared with the empty tree.
			const since = from ?? git(dir, ['hash-object', '-t', 'tree', '/dev/null']).trim();
			const diff = git(dir, ['diff', '--no-color', '--no-ext-diff', '--no-renames', '--ignore-submodules=all', '--src-prefix=a/', '--dst-prefix=b/', '-U0', since, ...(this.head ? [to] : []), '--']);
			const untracked = this.head ? [] : git(dir, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
			const at = this.head ? to : this.checkedOutCommit(sub);
			if (!diff && !untracked.length && from === at && !this.used.has(sub)) continue;
			const r = this.entry(sub);
			if (at) r.head = at;
			out.push({ path: sub, diff, untracked });
		}
		return out;
	}

	/** The submodules the comparison read from, compared, or could not use. */
	report(): Repository[] {
		return [...this.used.values()].sort((x, y) => (x.path < y.path ? -1 : 1));
	}
}
