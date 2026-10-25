import type { Diagram } from '../render/diagram.js';
import { changeStyle } from '../render/node.js';

/**
 * Viewer filter / highlight state, kept free of Svelte so it can be unit-tested.
 *
 * Filter keys match `LegendItem.filter` (comma-separated lists are expanded):
 *   pattern:<id> · pattern:none · change:<new|modified|reused|removed> · area:<id> ·
 *   lifecycle:<id> · edge:<edge-style key, e.g. enf:platform or kind:calls>
 */
export interface FilterState {
	/** Highlighted keys; when non-empty, everything not matching is dimmed. */
	highlight: string[];
	/** Hide unchanged (reused / no change state) items. */
	onlyChanges: boolean;
	/** Fade reused context even further (on by default, matching the static page). */
	fadeReused: boolean;
	/** Hovered item id (node or edge). */
	hover?: string;
	/** Selected item id (node or edge), shown in the side panel. */
	selected?: string;
}

/** A bundled model (+ profile) the viewer can load. */
export interface ViewerExample {
	id: string;
	label: string;
	model: unknown;
	profile?: unknown;
}

export type Emphasis = 'normal' | 'focus' | 'dim' | 'hidden';

export function initialState(): FilterState {
	return { highlight: [], onlyChanges: false, fadeReused: true };
}

/** Toggle one legend filter (which may stand for several keys). */
export function toggleHighlight(state: FilterState, filter: string): FilterState {
	const keys = filter.split(',').filter(Boolean);
	const on = keys.every((k) => state.highlight.includes(k));
	const highlight = on ? state.highlight.filter((k) => !keys.includes(k)) : [...new Set([...state.highlight, ...keys])];
	return { ...state, highlight };
}

export function isHighlighted(state: FilterState, filter: string): boolean {
	const keys = filter.split(',').filter(Boolean);
	return keys.length > 0 && keys.every((k) => state.highlight.includes(k));
}

/** Filter keys carried by each node and edge of a diagram. */
export function itemKeys(d: Diagram): Map<string, Set<string>> {
	const { profile } = d.scene;
	const out = new Map<string, Set<string>>();
	for (const n of d.nodes) {
		const e = n.el;
		const keys = new Set<string>();
		if (e) {
			if (e.pattern) keys.add(`pattern:${e.pattern}`);
			if (e.pattern === null) keys.add('pattern:none');
			for (const p of e.patterns ?? []) keys.add(`pattern:${p}`);
			for (const part of e.parts ?? []) if (part.pattern) keys.add(`pattern:${part.pattern}`);
			keys.add(`change:${changeStyle(profile, e.change)}`);
			if (e.lifecycle) keys.add(`lifecycle:${e.lifecycle}`);
			const area = d.scene.nodes.get(n.id)?.area;
			if (area) keys.add(`area:${area}`);
		}
		out.set(n.id, keys);
	}
	for (const e of d.edges) {
		out.set(e.id, new Set([`edge:${e.style.key}`, `change:${changeStyle(profile, e.rel.change)}`]));
	}
	return out;
}

/** Edges and nodes adjacent to an item (an edge's neighbours are its two ends). */
export function neighbourhood(d: Diagram, id: string): Set<string> {
	const set = new Set<string>([id]);
	const edge = d.edges.find((e) => e.id === id);
	if (edge) {
		set.add(edge.from);
		set.add(edge.to);
		return set;
	}
	for (const e of d.edges) {
		if (e.from === id || e.to === id) {
			set.add(e.id);
			set.add(e.from);
			set.add(e.to);
		}
	}
	return set;
}

function isUnchanged(keys: Set<string>): boolean {
	return keys.has('change:reused');
}

/**
 * Emphasis for every node and edge. Frames are never dimmed (they are structure, not content).
 * Precedence: onlyChanges (hidden) → hover/selection neighbourhood (focus/dim) → highlight (dim).
 */
export function classify(d: Diagram, state: FilterState, keys = itemKeys(d)): Map<string, Emphasis> {
	const out = new Map<string, Emphasis>();
	const ids = [...d.nodes.map((n) => n.id), ...d.edges.map((e) => e.id)];
	const highlight = new Set(state.highlight);
	const matched = new Set<string>();
	if (highlight.size) {
		for (const id of ids) if ([...(keys.get(id) ?? [])].some((k) => highlight.has(k))) matched.add(id);
		// an edge between two highlighted cards, and the two ends of a highlighted edge, stay visible
		for (const e of d.edges) {
			if (matched.has(e.from) && matched.has(e.to)) matched.add(e.id);
		}
		for (const e of d.edges) {
			if (matched.has(e.id) && [...(keys.get(e.id) ?? [])].some((k) => highlight.has(k))) {
				matched.add(e.from);
				matched.add(e.to);
			}
		}
	}
	const focusId = state.hover ?? state.selected;
	const focus = focusId ? neighbourhood(d, focusId) : undefined;
	for (const id of ids) {
		const k = keys.get(id) ?? new Set();
		let em: Emphasis = 'normal';
		if (highlight.size && !matched.has(id)) em = 'dim';
		if (focus) em = focus.has(id) ? 'focus' : 'dim';
		if (state.onlyChanges && isUnchanged(k) && !(focus?.has(id) && id === focusId)) em = 'hidden';
		out.set(id, em);
	}
	return out;
}

/** Opacity for an emphasis (the reused fade is already drawn into the card). */
export function opacityFor(em: Emphasis): number {
	return em === 'hidden' ? 0.06 : em === 'dim' ? 0.18 : 1;
}
