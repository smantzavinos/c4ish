import type { Element, Model, Profile, Tour, TourPathEntry, TourStep, View } from './types.js';
import { viewMembers, viewRelationships } from './view.js';

/**
 * Tour validation and coverage (DECISIONS 24–25).
 *
 * A step lights: its focus (a frame lights everything inside it), its selection, every connector
 * of its path and their endpoints, the targets of its notes, and everything its highlight matches.
 * Coverage is stricter (DECISIONS 25): each tour on its own must *point at* every new / modified /
 * removed item, every element on a proposed pattern, every risk note and every divergence — by
 * focus, select, a path (its connectors, their endpoints and the frames the path enters) or a
 * named note (the note and its target). Broad highlights and "only changes" light items for an
 * overview but never count as coverage.
 */

export interface TourDiagnostic {
	severity: 'error' | 'warning';
	code: string;
	message: string;
	at?: string;
}

export interface CoverageItem {
	/** Element, relationship or note id (`note:<n>` for notes without an id). */
	id: string;
	reason: 'new' | 'modified' | 'removed' | 'proposed-pattern' | 'risk-note' | 'divergence';
	title: string;
}

export interface TourCoverage {
	tour: string;
	items: CoverageItem[];
	uncovered: CoverageItem[];
}

export const isJump = (p: TourPathEntry): p is { jump: true; text?: string } => typeof p === 'object' && p !== null && 'jump' in p;

/** Relationship ids of a path, in order (jumps dropped). */
export function pathRelationships(step: Pick<TourStep, 'path'>): string[] {
	return (step.path ?? []).filter((p): p is string => typeof p === 'string');
}

/** Whether a step dims what it does not light (default: yes when it lights anything). */
export function stepDims(step: TourStep): boolean {
	if (step.dimOthers !== undefined) return step.dimOthers;
	const h = step.highlight;
	const highlights = !!h && (!!h.patterns?.length || !!h.change?.length || !!h.enforcement?.length || !!h.proposed);
	return !!(step.focus?.length || step.path?.length || step.select || step.notes?.length || highlights);
}

interface ViewIndex {
	view: View;
	members: Set<string>;
	rels: Set<string>;
	notes: Set<string>;
}

function noteKey(model: Model, i: number): string {
	return model.notes?.[i]?.id ?? `note:${i + 1}`;
}

function indexView(model: Model, profile: Profile, view: View): ViewIndex {
	const members = viewMembers(model, profile, view);
	const rels = viewRelationships(model, view, members);
	const notes = new Set<string>();
	(model.notes ?? []).forEach((n, i) => {
		if ((!n.views || n.views.includes(view.id)) && (!n.on || members.has(n.on) || rels.has(n.on))) notes.add(noteKey(model, i));
	});
	return { view, members, rels, notes };
}

/** Ids (elements, relationships, note keys) a step lights, restricted to its view. */
export function stepLit(model: Model, profile: Profile, step: TourStep, idx?: ViewIndex): Set<string> {
	const view = model.views.find((v) => v.id === step.view);
	const lit = new Set<string>();
	if (!view) return lit;
	const vi = idx ?? indexView(model, profile, view);
	const elements = new Map(model.elements.map((e) => [e.id, e]));
	const rels = new Map((model.relationships ?? []).map((r) => [r.id, r]));
	const children = new Map<string, string[]>();
	for (const e of model.elements) if (e.parent) children.set(e.parent, [...(children.get(e.parent) ?? []), e.id]);
	const lightEl = (id: string) => {
		if (!vi.members.has(id) || lit.has(id)) return;
		lit.add(id);
	};
	const lightTree = (id: string) => {
		if (!vi.members.has(id)) return;
		lightEl(id);
		for (const c of children.get(id) ?? []) lightTree(c);
	};
	const lightRel = (id: string) => {
		const r = rels.get(id);
		if (!r || !vi.rels.has(id)) return;
		lit.add(id);
		lightEl(r.from);
		lightEl(r.to);
	};
	const light = (id: string, tree: boolean) => (rels.has(id) ? lightRel(id) : tree ? lightTree(id) : lightEl(id));

	for (const id of step.focus ?? []) light(id, true);
	if (step.select) light(step.select, false);
	for (const id of pathRelationships(step)) lightRel(id);
	const noteIds = new Set(step.notes ?? []);
	(model.notes ?? []).forEach((n, i) => {
		const key = noteKey(model, i);
		if (!noteIds.has(key) || !vi.notes.has(key)) return;
		lit.add(key);
		if (n.on) light(n.on, false);
	});
	const h = step.highlight;
	if (h) {
		const proposed = new Set((model.proposedPatterns ?? []).map((p) => p.id));
		const patterns = new Set(h.patterns ?? []);
		const changeStyles = new Set((h.change ?? []).map((c) => profile.changeStates[c]?.style ?? c));
		const styleOf = (c: string | undefined) => (c && profile.changeStates[c]?.style) || 'reused';
		for (const id of vi.members) {
			const e = elements.get(id)!;
			const ps = elementPatterns(e);
			if (ps.some((p) => patterns.has(p)) || (h.proposed && ps.some((p) => proposed.has(p))) || changeStyles.has(styleOf(e.change))) lightEl(id);
		}
		const enf = new Set(h.enforcement ?? []);
		for (const id of vi.rels) {
			const r = rels.get(id)!;
			if ((r.enforcement && enf.has(r.enforcement)) || changeStyles.has(styleOf(r.change))) lightRel(id);
		}
	}
	// a note is also covered when the step spotlights its target directly
	(model.notes ?? []).forEach((n, i) => {
		const key = noteKey(model, i);
		if (n.on && vi.notes.has(key) && directlyLit(step, n.on, rels)) lit.add(key);
	});
	return lit;
}

/**
 * Ids a step points at specifically (coverage, DECISIONS 25): focus and select (an element itself,
 * not its subtree; a connector with its endpoints), path connectors with their endpoints and the
 * frames those endpoints sit in, and named notes with their targets. Highlights do not count.
 */
export function stepCovers(model: Model, profile: Profile, step: TourStep, idx?: ViewIndex): Set<string> {
	const view = model.views.find((v) => v.id === step.view);
	const out = new Set<string>();
	if (!view) return out;
	const vi = idx ?? indexView(model, profile, view);
	const elements = new Map(model.elements.map((e) => [e.id, e]));
	const rels = new Map((model.relationships ?? []).map((r) => [r.id, r]));
	const el = (id: string) => vi.members.has(id) && out.add(id);
	const rel = (id: string) => {
		const r = rels.get(id);
		if (!r || !vi.rels.has(id)) return;
		out.add(id);
		el(r.from);
		el(r.to);
	};
	const point = (id: string) => (rels.has(id) ? rel(id) : el(id));
	for (const id of step.focus ?? []) point(id);
	if (step.select) point(step.select);
	for (const id of pathRelationships(step)) {
		rel(id);
		const r = rels.get(id);
		if (!r || !vi.rels.has(id)) continue;
		for (const end of [r.from, r.to]) {
			const seen = new Set<string>();
			for (let p = elements.get(end)?.parent; p && !seen.has(p); p = elements.get(p)?.parent) {
				seen.add(p);
				el(p);
			}
		}
	}
	const named = new Set(step.notes ?? []);
	(model.notes ?? []).forEach((n, i) => {
		const key = noteKey(model, i);
		if (!named.has(key) || !vi.notes.has(key)) return;
		out.add(key);
		if (n.on) point(n.on);
	});
	return out;
}

function directlyLit(step: TourStep, id: string, rels: Map<string, { from: string; to: string }>): boolean {
	if (step.select === id || (step.focus ?? []).includes(id)) return true;
	return pathRelationships(step).some((r) => r === id || rels.get(r)?.from === id || rels.get(r)?.to === id);
}

function elementPatterns(e: Element): string[] {
	return [e.pattern, ...(e.patterns ?? []), ...(e.parts ?? []).map((p) => p.pattern)].filter((p): p is string => !!p);
}

/** Items a review tour must point at, and which of them no step of *this* tour points at. */
export function tourCoverage(model: Model, profile: Profile, tour: Tour): TourCoverage {
	const isLibrary = (e: Element) => profile.elementKinds[e.kind]?.role === 'library';
	const index = new Map(model.views.map((v) => [v.id, indexView(model, profile, v)]));
	const shown = new Set<string>();
	for (const vi of index.values()) {
		vi.members.forEach((x) => shown.add(x));
		vi.rels.forEach((x) => shown.add(x));
		vi.notes.forEach((x) => shown.add(x));
	}
	const proposed = new Set((model.proposedPatterns ?? []).map((p) => p.id));
	const items: CoverageItem[] = [];
	const add = (id: string, reason: CoverageItem['reason'], title: string) => {
		if (shown.has(id) && !items.some((i) => i.id === id && i.reason === reason)) items.push({ id, reason, title });
	};
	for (const e of model.elements) {
		if (isLibrary(e)) continue;
		const style = e.change ? profile.changeStates[e.change]?.style : undefined;
		if (style === 'new' || style === 'modified' || style === 'removed') add(e.id, style, e.title);
		if (elementPatterns(e).some((p) => proposed.has(p))) add(e.id, 'proposed-pattern', e.title);
		if (e.divergence || (e.ties ?? []).some((t) => t.divergence)) add(e.id, 'divergence', e.title);
	}
	for (const r of model.relationships ?? []) if (r.divergence) add(r.id, 'divergence', r.label ?? `${r.from} → ${r.to}`);
	(model.notes ?? []).forEach((n, i) => {
		if (n.kind === 'risk') add(noteKey(model, i), 'risk-note', n.title ?? n.text.slice(0, 60));
	});

	const covered = new Set<string>();
	for (const s of tour.steps) {
		const vi = index.get(s.view);
		if (vi) stepCovers(model, profile, s, vi).forEach((x) => covered.add(x));
	}
	return { tour: tour.id, items, uncovered: items.filter((i) => !covered.has(i.id)) };
}

/** Coverage of every tour, each judged on its own. */
export function toursCoverage(model: Model, profile: Profile, tours: Tour[] = model.tours ?? []): TourCoverage[] {
	return tours.map((t) => tourCoverage(model, profile, t));
}

/** References, view membership, path contiguity, then coverage. */
export function validateTours(model: Model, profile: Profile): TourDiagnostic[] {
	const tours = model.tours ?? [];
	const out: TourDiagnostic[] = [];
	if (!tours.length) return out;
	const err = (code: string, message: string, at: string) => out.push({ severity: 'error', code, message, at });
	const warn = (code: string, message: string, at: string) => out.push({ severity: 'warning', code, message, at });
	const elements = new Map(model.elements.map((e) => [e.id, e]));
	const rels = new Map((model.relationships ?? []).map((r) => [r.id, r]));
	const notes = new Set((model.notes ?? []).map((n, i) => noteKey(model, i)));
	const patterns = new Set([...Object.keys(profile.patterns), ...(model.proposedPatterns ?? []).map((p) => p.id)]);
	const index = new Map(model.views.map((v) => [v.id, indexView(model, profile, v)]));
	const ancestors = (id: string): Set<string> => {
		const out = new Set<string>();
		let cur = elements.get(id);
		while (cur?.parent && !out.has(cur.parent)) {
			out.add(cur.parent);
			cur = elements.get(cur.parent);
		}
		return out;
	};
	const joins = (a: string, b: string) => a === b || ancestors(a).has(b) || ancestors(b).has(a);

	const tourIds = new Set<string>();
	for (const t of tours) {
		if (tourIds.has(t.id)) err('duplicate-id', `tour id "${t.id}" is not unique`, `tour:${t.id}`);
		tourIds.add(t.id);
		const stepIds = new Set<string>();
		for (const s of t.steps) {
			const at = `tour:${t.id}/${s.id}`;
			if (stepIds.has(s.id)) err('duplicate-id', `step id "${s.id}" is not unique in tour "${t.id}"`, at);
			stepIds.add(s.id);
			const vi = index.get(s.view);
			if (!vi) {
				err('unknown-view', `view "${s.view}" does not exist`, at);
				continue;
			}
			const checkItem = (id: string, what: string) => {
				if (elements.has(id)) {
					if (!vi.members.has(id)) err('tour-not-in-view', `${what} "${id}" is not shown in view "${s.view}"`, at);
				} else if (rels.has(id)) {
					if (!vi.rels.has(id)) err('tour-not-in-view', `${what} "${id}" is not drawn in view "${s.view}"`, at);
				} else err('unknown-ref', `${what} "${id}" is neither an element nor a relationship`, at);
			};
			for (const id of s.focus ?? []) checkItem(id, 'focus');
			if (s.select) checkItem(s.select, 'select');
			for (const id of s.notes ?? []) {
				if (!notes.has(id)) err('unknown-ref', `note "${id}" does not exist (give the note an id)`, at);
				else if (!vi.notes.has(id)) err('tour-not-in-view', `note "${id}" is not shown in view "${s.view}"`, at);
			}
			const h = s.highlight;
			for (const p of h?.patterns ?? []) if (!patterns.has(p)) err('unknown-pattern', `highlight pattern "${p}" is neither in the catalog nor proposed`, at);
			for (const c of h?.change ?? []) if (!profile.changeStates[c]) err('unknown-change-state', `highlight change state "${c}" is not in the profile`, at);
			for (const x of h?.enforcement ?? []) if (!profile.enforcement[x]) err('unknown-enforcement', `highlight enforcement "${x}" is not in the profile`, at);
			let prev: string | undefined;
			for (const p of s.path ?? []) {
				if (isJump(p)) {
					prev = undefined;
					continue;
				}
				const r = rels.get(p);
				if (!r) {
					err('unknown-ref', `path relationship "${p}" does not exist`, at);
					prev = undefined;
					continue;
				}
				if (!vi.rels.has(p)) err('tour-not-in-view', `path relationship "${p}" is not drawn in view "${s.view}"`, at);
				if (prev) {
					const before = rels.get(prev)!;
					if (!joins(before.to, r.from))
						warn('tour-path-gap', `path is not contiguous: "${prev}" ends at "${before.to}" but "${p}" starts at "${r.from}" (add { "jump": true } if intended)`, at);
				}
				prev = p;
			}
		}
	}
	if (out.some((d) => d.severity === 'error')) return out;
	for (const c of toursCoverage(model, profile, tours))
		for (const u of c.uncovered)
			warn(
				'tour-coverage',
				`tour "${c.tour}": ${u.reason} item "${u.title}" (${u.id}) is not pointed at by any step — focus, select, path or a named note; highlights don't count`,
				u.id
			);
	return out;
}
