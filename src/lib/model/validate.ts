import { viewMembers } from './view.js';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import type { Divergence, Element, Model, Profile, Severity, View } from './types.js';
import { modelSchema, profileSchema } from './schema.js';

export interface Diagnostic {
	severity: 'error' | 'warning';
	code: string;
	message: string;
	/** JSON path or model id the diagnostic is about. */
	at?: string;
}

let ajv: Ajv | null = null;
let modelValidator: ValidateFunction | null = null;
let profileValidator: ValidateFunction | null = null;

function validators() {
	if (!ajv) {
		ajv = new Ajv({ allErrors: true, strict: false });
		modelValidator = ajv.compile(modelSchema);
		profileValidator = ajv.compile(profileSchema);
	}
	return { model: modelValidator!, profile: profileValidator! };
}

function schemaDiagnostics(errors: ErrorObject[] | null | undefined, what: string): Diagnostic[] {
	return (errors ?? [])
		.filter((e) => e.keyword !== 'anyOf' && e.keyword !== 'if')
		.map((e) => ({
			severity: 'error' as const,
			code: `${what}-schema`,
			message:
				e.keyword === 'additionalProperties'
					? `unknown property "${(e.params as { additionalProperty: string }).additionalProperty}"`
					: (e.message ?? 'invalid'),
			at: e.instancePath || '/'
		}));
}

/** Layer 1: JSON Schema. */
export function validateModelSchema(json: unknown): Diagnostic[] {
	const v = validators().model;
	return v(json) ? [] : schemaDiagnostics(v.errors, 'model');
}

export function validateProfileSchema(json: unknown): Diagnostic[] {
	const v = validators().profile;
	return v(json) ? [] : schemaDiagnostics(v.errors, 'profile');
}

export function divergenceId(d: Divergence | undefined): string | undefined {
	if (!d) return undefined;
	return typeof d === 'string' ? d : d.id;
}

/** Layer 2: semantics (references, tree, profile vocabulary) plus notation lint. */
export function validateModel(model: Model, profile: Profile): Diagnostic[] {
	const out: Diagnostic[] = [];
	const rules = profile.rules ?? {};
	const err = (code: string, message: string, at?: string) => out.push({ severity: 'error', code, message, at });
	const lint = (rule: Severity | undefined, code: string, message: string, at?: string) => {
		if (rule === 'off') return;
		out.push({ severity: rule === 'error' ? 'error' : 'warning', code, message, at });
	};

	// ---- unique ids -------------------------------------------------------------
	const ids = new Map<string, string>();
	const claim = (id: string | undefined, what: string) => {
		if (!id) return;
		const prev = ids.get(id);
		if (prev) err('duplicate-id', `id "${id}" is used by both a ${prev} and a ${what}`, id);
		else ids.set(id, what);
	};
	model.elements.forEach((e) => claim(e.id, 'element'));
	(model.relationships ?? []).forEach((r) => claim(r.id, 'relationship'));
	(model.contracts ?? []).forEach((c) => claim(c.id, 'contract'));
	(model.absences ?? []).forEach((a) => claim(a.id, 'absence'));
	(model.notes ?? []).forEach((n) => claim(n.id, 'note'));
	const viewIds = new Set<string>();
	for (const v of model.views) {
		if (viewIds.has(v.id)) err('duplicate-id', `view id "${v.id}" is not unique`, `view:${v.id}`);
		viewIds.add(v.id);
	}

	const elements = new Map(model.elements.map((e) => [e.id, e]));
	const relationships = new Map((model.relationships ?? []).map((r) => [r.id, r]));
	const contracts = new Set((model.contracts ?? []).map((c) => c.id));
	const patternIds = new Set([
		...Object.keys(profile.patterns),
		...(model.proposedPatterns ?? []).map((p) => p.id)
	]);
	for (const p of model.proposedPatterns ?? []) {
		if (profile.patterns[p.id]) err('proposed-pattern-exists', `proposed pattern "${p.id}" is already in the profile catalog`, p.id);
		if (!profile.patternFamilies[p.family]) err('unknown-pattern-family', `pattern family "${p.family}" is not in the profile`, p.id);
	}

	const checkChange = (value: string | undefined, at: string) => {
		if (value !== undefined && !profile.changeStates[value]) err('unknown-change-state', `change state "${value}" is not in the profile`, at);
	};
	const checkEnforcement = (value: string | undefined, at: string) => {
		if (value !== undefined && !profile.enforcement[value]) err('unknown-enforcement', `enforcement "${value}" is not in the profile`, at);
	};
	const checkPattern = (value: string | null | undefined, at: string) => {
		if (value && !patternIds.has(value)) err('unknown-pattern', `pattern "${value}" is neither in the profile catalog nor in proposedPatterns`, at);
	};
	const checkViews = (views: string[] | undefined, at: string) => {
		for (const v of views ?? []) if (!viewIds.has(v)) err('unknown-view', `view "${v}" does not exist`, at);
	};

	// ---- elements ---------------------------------------------------------------
	for (const e of model.elements) {
		const kind = profile.elementKinds[e.kind];
		if (!kind) err('unknown-element-kind', `element kind "${e.kind}" is not in the profile`, e.id);
		if (e.parent !== undefined) {
			const parent = elements.get(e.parent);
			if (!parent) err('unknown-parent', `parent "${e.parent}" does not exist`, e.id);
			else if (kind?.parents && !kind.parents.includes(parent.kind))
				err('invalid-parent-kind', `a ${e.kind} cannot sit inside a ${parent.kind} (allowed: ${kind.parents.join(', ')})`, e.id);
			if (parent && profile.elementKinds[parent.kind]?.role === 'library')
				err('invalid-parent-kind', `a library cannot contain elements`, e.id);
		}
		checkChange(e.change, e.id);
		if (e.lifecycle !== undefined && !profile.lifecycle[e.lifecycle]) err('unknown-lifecycle', `lifecycle "${e.lifecycle}" is not in the profile`, e.id);
		if (e.area !== undefined && !profile.areas[e.area]) err('unknown-area', `area "${e.area}" is not in the profile`, e.id);
		checkPattern(e.pattern, e.id);
		(e.patterns ?? []).forEach((p) => checkPattern(p, e.id));
		for (const lib of e.libraries ?? []) {
			const l = elements.get(lib);
			if (!l) err('unknown-library', `library "${lib}" does not exist`, e.id);
			else if (profile.elementKinds[l.kind]?.role !== 'library') err('not-a-library', `"${lib}" is a ${l.kind}, not a library`, e.id);
		}
		const fieldIds = new Set((e.fields ?? []).map((f) => f.id));
		for (const f of e.fields ?? []) checkChange(f.change, `${e.id}.${f.id}`);
		for (const ix of e.indexes ?? []) {
			checkChange(ix.change, `${e.id}#${ix.id}`);
		}
		for (const t of e.ties ?? []) {
			for (const f of t.fields) if (!fieldIds.has(f)) err('unknown-field', `tie field "${f}" is not a field of "${e.id}"`, e.id);
			checkEnforcement(t.enforcement, e.id);
			checkChange(t.change, e.id);
			if (!t.enforcement) lint(rules.missingEnforcement, 'missing-enforcement', `tie ${t.fields.join(' ↔ ')} does not state its enforcement`, e.id);
		}
		for (const p of e.parts ?? []) {
			checkPattern(p.pattern, e.id);
			checkChange(p.change, e.id);
		}
		for (const ref of e.implementedBy ?? []) if (!elements.has(ref)) err('unknown-ref', `implementedBy "${ref}" does not exist`, e.id);
		checkViews(e.views, e.id);
		if (e.change === undefined && kind?.role !== 'library')
			lint(rules.missingChange, 'missing-change', `element has no change state (drawn as reused)`, e.id);
		textBudget(e, rules, lint);
	}

	// ---- parent tree has no cycles ---------------------------------------------
	for (const e of model.elements) {
		const seen = new Set<string>([e.id]);
		let cur = e.parent ? elements.get(e.parent) : undefined;
		while (cur) {
			if (seen.has(cur.id)) {
				err('parent-cycle', `parent chain of "${e.id}" loops through "${cur.id}"`, e.id);
				break;
			}
			seen.add(cur.id);
			cur = cur.parent ? elements.get(cur.parent) : undefined;
		}
	}

	// ---- relationships -----------------------------------------------------------
	for (const r of model.relationships ?? []) {
		const kind = profile.relationshipKinds[r.kind];
		if (!kind) err('unknown-relationship-kind', `relationship kind "${r.kind}" is not in the profile`, r.id);
		for (const [end, ref, field] of [
			['from', r.from, r.fromField],
			['to', r.to, r.toField]
		] as const) {
			const el = elements.get(ref);
			if (!el) err('unknown-ref', `${end} "${ref}" does not exist`, r.id);
			else if (profile.elementKinds[el.kind]?.role === 'library')
				err('library-endpoint', `${end} "${ref}" is a library; libraries are chips, not connector endpoints`, r.id);
			else if (field && !(el.fields ?? []).some((f) => f.id === field))
				err('unknown-field', `${end}Field "${field}" is not a field of "${ref}"`, r.id);
		}
		if (r.from === r.to) err('self-relationship', `relationship points at its own source`, r.id);
		checkEnforcement(r.enforcement, r.id);
		checkChange(r.change, r.id);
		checkViews(r.views, r.id);
		if (r.contract && !contracts.has(r.contract)) err('unknown-contract', `contract "${r.contract}" does not exist`, r.id);
		if (kind?.enforcementRequired && !r.enforcement)
			lint(rules.missingEnforcement, 'missing-enforcement', `${r.kind} connector does not state who enforces it (no neutral lines)`, r.id);
		if (r.change === undefined) lint(rules.missingChange, 'missing-change', `relationship has no change state (drawn as reused)`, r.id);
		if (r.label && r.label.length > (rules.labelMaxChars ?? 40))
			lint(rules.textBudget, 'text-budget', `label is ${r.label.length} chars (budget ${rules.labelMaxChars ?? 40}); move the rest to details`, r.id);
		if (r.label?.includes('\n')) lint(rules.textBudget, 'text-budget', `label has line breaks; keep it to one short line`, r.id);
		const from = elements.get(r.from);
		const to = elements.get(r.to);
		const isRemoved = (c?: string) => c !== undefined && profile.changeStates[c]?.style === 'removed';
		if (from && to && (isRemoved(from.change) || isRemoved(to.change)) && !isRemoved(r.change) && profile.relationshipKinds[r.kind]?.category !== 'lifecycle')
			lint(rules.removedWithLiveEdges, 'removed-with-live-edge', `connects a removed element but is not itself removed`, r.id);
	}

	// ---- contracts, notes, absences --------------------------------------------
	for (const c of model.contracts ?? []) checkChange(c.change, c.id);
	for (const n of model.notes ?? []) {
		if (n.on && !elements.has(n.on) && !relationships.has(n.on)) err('unknown-ref', `note target "${n.on}" does not exist`, n.id ?? n.on);
		checkViews(n.views, n.id ?? 'note');
	}
	for (const a of model.absences ?? []) {
		if (a.parent && !elements.has(a.parent)) err('unknown-parent', `parent "${a.parent}" does not exist`, a.id);
		checkViews(a.views, a.id);
	}

	// ---- views ---------------------------------------------------------------
	for (const v of model.views) {
		const notation = profile.views[v.kind];
		if (!notation) {
			err('unknown-view-kind', `view kind "${v.kind}" is not in the profile`, `view:${v.id}`);
			continue;
		}
		for (const ref of [...(v.include ?? []), ...(v.exclude ?? [])])
			if (!elements.has(ref) && !(model.absences ?? []).some((a) => a.id === ref))
				err('unknown-ref', `view references unknown element "${ref}"`, `view:${v.id}`);
		for (const ref of v.omitRelationships ?? [])
			if (!relationships.has(ref)) err('unknown-ref', `view omits unknown relationship "${ref}"`, `view:${v.id}`);
		if (notation.colour.nodes === 'pattern' && notation.colour.edges !== 'none')
			lint('warning', 'colour-meaning', `view kind "${v.kind}" colours nodes by pattern AND edges by ${notation.colour.edges}; colour must mean one thing`, `view:${v.id}`);
		if (notation.forbidSiblingChains) siblingChains(model, v, viewMembers(model, profile, v), elements, (m, at) => lint(rules.siblingChains, 'sibling-chain', m, at));
	}
	return out;
}

function textBudget(
	e: Element,
	rules: NonNullable<Profile['rules']>,
	lint: (rule: Severity | undefined, code: string, message: string, at?: string) => void
) {
	const tMax = rules.titleMaxChars ?? 40;
	const sMax = rules.subtitleMaxChars ?? 64;
	if (e.title.length > tMax) lint(rules.textBudget, 'text-budget', `title is ${e.title.length} chars (budget ${tMax})`, e.id);
	if (e.title.includes('\n') || e.subtitle?.includes('\n'))
		lint(rules.textBudget, 'text-budget', `title/subtitle has line breaks; put prose in details`, e.id);
	if (e.subtitle && e.subtitle.length > sMax)
		lint(rules.textBudget, 'text-budget', `subtitle is ${e.subtitle.length} chars (budget ${sMax}); it will be truncated`, e.id);
}

/** Siblings never chain: A→B→C where A, B, C share a parent reads as "A becomes B". */
function siblingChains(
	model: Model,
	view: View,
	members: Set<string>,
	elements: Map<string, Element>,
	report: (message: string, at: string) => void
) {
	const viewId = view.id;
	const omit = new Set(view.omitRelationships ?? []);
	const rels = (model.relationships ?? []).filter(
		(r) => !omit.has(r.id) && members.has(r.from) && members.has(r.to) && (!r.views || r.views.includes(viewId))
	);
	for (const a of rels) {
		for (const b of rels) {
			if (a === b || a.to !== b.from) continue;
			const pa = elements.get(a.from)?.parent;
			if (pa === undefined) continue;
			if (elements.get(a.to)?.parent === pa && elements.get(b.to)?.parent === pa && a.from !== b.to)
				report(`siblings chain ${a.from} → ${a.to} → ${b.to}; siblings should converge on their parent`, `view:${viewId}`);
		}
	}
}
