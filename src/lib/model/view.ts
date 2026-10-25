import type { Element, Model, Profile, View } from './types.js';

/**
 * Elements shown in a view. `include` lists roots: each listed element brings its ancestors (as
 * frames) and its descendants. `exclude` removes elements and their descendants. Element-level
 * `views` restrictions and library elements (drawn as chips) are always respected.
 */
export function viewMembers(model: Model, profile: Profile, view: View): Set<string> {
	const byId = new Map(model.elements.map((e) => [e.id, e]));
	const isLibrary = (e: Element) => profile.elementKinds[e.kind]?.role === 'library';
	const inView = (e: Element) => !isLibrary(e) && (!e.views || e.views.includes(view.id));
	const children = new Map<string, Element[]>();
	for (const e of model.elements) if (e.parent) children.set(e.parent, [...(children.get(e.parent) ?? []), e]);

	let included: Set<string>;
	if (view.include) {
		included = new Set();
		const down = (e: Element) => {
			for (const c of children.get(e.id) ?? []) {
				if (!inView(c) || included.has(c.id)) continue;
				included.add(c.id);
				down(c);
			}
		};
		for (const id of view.include) {
			const root = byId.get(id);
			if (!root || !inView(root)) continue;
			let cur: Element | undefined = root;
			while (cur && inView(cur) && !included.has(cur.id)) {
				included.add(cur.id);
				cur = cur.parent ? byId.get(cur.parent) : undefined;
			}
			down(root);
		}
	} else {
		included = new Set(model.elements.filter(inView).map((e) => e.id));
	}
	if (view.exclude) {
		const ex = new Set(view.exclude);
		const excluded = (e: Element): boolean => ex.has(e.id) || (!!e.parent && !!byId.get(e.parent) && excluded(byId.get(e.parent)!));
		for (const id of [...included]) if (excluded(byId.get(id)!)) included.delete(id);
	}
	return included;
}

/** Relationships drawn in a view: both ends shown, not omitted, not restricted to other views. */
export function viewRelationships(model: Model, view: View, members: Set<string>): Set<string> {
	const omit = new Set(view.omitRelationships ?? []);
	return new Set(
		(model.relationships ?? [])
			.filter((r) => !omit.has(r.id) && members.has(r.from) && members.has(r.to) && (!r.views || r.views.includes(view.id)))
			.map((r) => r.id)
	);
}
