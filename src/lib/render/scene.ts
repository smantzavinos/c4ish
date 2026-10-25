import { viewMembers } from '../model/view.js';
import type { Absence, Element, Model, Note, PatternDef, Profile, Relationship, View, ViewNotation } from '../model/types.js';

export interface SceneNode {
	id: string;
	el: Element;
	/** Parent in this view (nearest included ancestor). */
	parent?: string;
	children: string[];
	depth: number;
	isFrame: boolean;
	area?: string;
}

export interface SceneAbsence {
	id: string;
	absence: Absence;
	parent?: string;
}

export interface Scene {
	model: Model;
	profile: Profile;
	view: View;
	notation: ViewNotation;
	nodes: Map<string, SceneNode>;
	/** Document order of included elements. */
	order: string[];
	edges: Relationship[];
	absences: SceneAbsence[];
	notes: Note[];
	patterns: Map<string, PatternDef>;
	elementsById: Map<string, Element>;
}

export function patternCatalog(model: Model, profile: Profile): Map<string, PatternDef> {
	const m = new Map<string, PatternDef>();
	for (const [id, p] of Object.entries(profile.patterns)) m.set(id, { id, ...p });
	for (const p of model.proposedPatterns ?? []) m.set(p.id, { ...p, status: 'proposed' });
	return m;
}

export function buildScene(model: Model, profile: Profile, viewId?: string): Scene {
	const view = viewId ? model.views.find((v) => v.id === viewId) : model.views[0];
	if (!view) throw new Error(`view "${viewId}" not found (have: ${model.views.map((v) => v.id).join(', ')})`);
	const notation = profile.views[view.kind];
	if (!notation) throw new Error(`view kind "${view.kind}" is not in the profile`);

	const byId = new Map(model.elements.map((e) => [e.id, e]));
	const isLibrary = (e: Element) => profile.elementKinds[e.kind]?.role === 'library';
	const inView = (e: Element) => !isLibrary(e) && (!e.views || e.views.includes(view.id));

	const included = viewMembers(model, profile, view);

	const order = model.elements.filter((e) => included.has(e.id)).map((e) => e.id);
	const nodes = new Map<string, SceneNode>();
	const viewParent = (e: Element): string | undefined => {
		let p = e.parent ? byId.get(e.parent) : undefined;
		while (p && !included.has(p.id)) p = p.parent ? byId.get(p.parent) : undefined;
		return p?.id;
	};
	for (const id of order) {
		const el = byId.get(id)!;
		nodes.set(id, { id, el, parent: viewParent(el), children: [], depth: 0, isFrame: false });
	}

	const absences: SceneAbsence[] = (model.absences ?? [])
		.filter((a) => (!a.views || a.views.includes(view.id)) && (!a.parent || included.has(a.parent)))
		.map((a) => ({ id: a.id, absence: a, parent: a.parent }));

	for (const n of nodes.values()) if (n.parent) nodes.get(n.parent)!.children.push(n.id);
	for (const a of absences) if (a.parent) nodes.get(a.parent)!.children.push(a.id);
	const area = (n: SceneNode): string | undefined =>
		n.el.area ?? (n.parent ? area(nodes.get(n.parent)!) : undefined) ?? profile.elementKinds[n.el.kind]?.area;
	const depth = (n: SceneNode): number => (n.parent ? depth(nodes.get(n.parent)!) + 1 : 0);
	for (const n of nodes.values()) {
		n.isFrame = n.children.length > 0;
		n.depth = depth(n);
		n.area = area(n);
	}

	const omit = new Set(view.omitRelationships ?? []);
	const edges = (model.relationships ?? []).filter(
		(r) => !omit.has(r.id) && included.has(r.from) && included.has(r.to) && (!r.views || r.views.includes(view.id))
	);
	const edgeIds = new Set(edges.map((r) => r.id));
	const notes = (model.notes ?? []).filter(
		(n) => (!n.views || n.views.includes(view.id)) && (!n.on || included.has(n.on) || edgeIds.has(n.on))
	);

	return {
		model,
		profile,
		view,
		notation,
		nodes,
		order,
		edges,
		absences,
		notes,
		patterns: patternCatalog(model, profile),
		elementsById: byId
	};
}
