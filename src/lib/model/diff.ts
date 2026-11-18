import type { Model, Note, Part, Tie } from './types.js';

/**
 * Comparison of two versions of one model, item by item (DECISIONS 42–46).
 *
 * Items are matched by id, never by position or title. Every difference carries an aspect, so a
 * reader can keep what the model *says* apart from how it reads or is shown:
 *
 *   structure     what the design is: kinds, parents, patterns, change states, data shape,
 *                 enforcement, relationships and their ends, contract clauses, absences
 *   text          titles, labels and descriptions
 *   code          code references
 *   presentation  views, tours, per-view restrictions, icons and colours
 *   provenance    the model's id and provenance block
 *
 * The comparison states facts. Which differences matter is the reader's decision.
 */

export type Aspect = 'structure' | 'text' | 'code' | 'presentation' | 'provenance';
export const ASPECT_NAMES: Aspect[] = ['structure', 'text', 'code', 'presentation', 'provenance'];

export type ItemKind = 'model' | 'element' | 'relationship' | 'contract' | 'note' | 'absence' | 'pattern' | 'view' | 'tour';
export type DeltaKind = 'added' | 'removed' | 'changed';

export interface FieldDifference {
	/**
	 * Where in the item: `["pattern"]`, `["fields", "<field id>", "type"]`, `["ties", "<tie>"]`,
	 * `["clauses", "<clause>"]`. A path that ends at a member (a field, index, tie, part or clause)
	 * means the whole member was added or removed.
	 */
	path: string[];
	aspect: Aspect;
	change: DeltaKind;
	before?: unknown;
	after?: unknown;
}

export interface Difference {
	kind: ItemKind;
	/** The item's id (`model` for the model itself; a derived key for a note without an id). */
	id: string;
	change: DeltaKind;
	/** Aspects this difference touches, in the order of `ASPECT_NAMES`. */
	aspects: Aspect[];
	/** The whole item as it was (removed and changed items). */
	before?: unknown;
	/** The whole item as it is (added and changed items). */
	after?: unknown;
	/** What differs inside a changed item. */
	fields?: FieldDifference[];
}

export interface ModelDiff {
	differences: Difference[];
	/** Field-level differences per aspect; an added or removed item counts once. */
	counts: Record<Aspect, number>;
}

/* ------------------------------------------------------------------ */
/* What each property is                                               */
/* ------------------------------------------------------------------ */

const S = 'structure' as const;
const T = 'text' as const;
const C = 'code' as const;
const P = 'presentation' as const;
const V = 'provenance' as const;

/** A member list inside an item, matched by key. */
interface Members {
	of: MemberKind;
	key: (member: never, index: number) => string;
}
type MemberKind = 'field' | 'index' | 'tie' | 'part' | 'clause';
type PropertyTable = Record<string, Aspect | Members>;

export const tieKey = (t: Tie): string => t.id ?? [...t.fields].sort().join('~');
export const partKey = (p: Part): string => p.id ?? p.title;

/**
 * Every property of every item, with its aspect. A property that is not listed counts as
 * structure, so a field added to the schema is compared until this table says otherwise; a test
 * walks the schema and fails when a property is missing here.
 */
export const ASPECTS: Record<ItemKind | Exclude<MemberKind, 'clause'>, PropertyTable> = {
	model: {
		$schema: P,
		schemaVersion: S,
		id: V,
		title: T,
		summary: T,
		profile: P,
		provenance: V
	},
	element: {
		kind: S,
		parent: S,
		title: T,
		subtitle: T,
		details: T,
		pattern: S,
		patternFit: S,
		patterns: S,
		change: S,
		lifecycle: S,
		area: S,
		libraries: S,
		version: S,
		fields: { of: 'field', key: (f: { id: string }) => f.id },
		indexes: { of: 'index', key: (i: { id: string }) => i.id },
		ties: { of: 'tie', key: tieKey },
		parts: { of: 'part', key: partKey },
		divergence: S,
		implementedBy: S,
		mappingLabel: T,
		code: C,
		views: P,
		revision: P
	},
	field: { title: T, type: S, change: S, note: T },
	index: { fields: S, change: S },
	tie: { fields: S, label: T, enforcement: S, change: S, divergence: S },
	part: { title: T, pattern: S, change: S, code: C },
	relationship: {
		from: S,
		to: S,
		kind: S,
		enforcement: S,
		change: S,
		label: T,
		details: T,
		contract: S,
		divergence: S,
		delta: S,
		fromField: S,
		toField: S,
		views: P,
		revision: P
	},
	contract: { title: T, change: S, clauses: { of: 'clause', key: () => '' } },
	note: { on: S, kind: S, title: T, text: T, views: P },
	absence: { parent: S, text: S, views: P },
	pattern: {
		label: T,
		family: S,
		status: S,
		icon: P,
		colour: P,
		catalog: T,
		description: T
	},
	view: {},
	tour: {}
};

/** Lists whose order carries no meaning. */
const UNORDERED = new Set([
	'element.patterns',
	'element.libraries',
	'element.implementedBy',
	'element.code',
	'element.views',
	'part.code',
	'tie.fields',
	'relationship.views',
	'note.views',
	'absence.views'
]);

/** Values a missing property stands for. */
const DEFAULTS: Record<string, unknown> = { 'element.patternFit': 'full' };

/** Whether a note is a review item (structure) or a remark (text). */
const noteAspect = (n: Note | undefined): Aspect => (n?.kind === 'risk' || n?.kind === 'question' ? S : T);

function itemAspect(kind: ItemKind, item: unknown): Aspect {
	if (kind === 'view' || kind === 'tour') return P;
	if (kind === 'note') return noteAspect(item as Note);
	return S;
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

function canonical(value: unknown, unordered: boolean): unknown {
	if (Array.isArray(value)) {
		const items = value.map((v) => canonical(v, false));
		return unordered ? [...items].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)) : items;
	}
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((k) => [k, canonical((value as Record<string, unknown>)[k], false)])
		);
	return value;
}

const same = (a: unknown, b: unknown, unordered = false) => JSON.stringify(canonical(a, unordered)) === JSON.stringify(canonical(b, unordered));

type Bag = Record<string, unknown>;

function keyed<M>(list: M[] | undefined, key: (m: M, i: number) => string): Map<string, M> {
	const out = new Map<string, M>();
	(list ?? []).forEach((m, i) => out.set(key(m, i), m));
	return out;
}

/** Field-level differences between two versions of one item (or one member of an item). */
function compareProperties(table: keyof typeof ASPECTS, before: Bag, after: Bag, base: string[], fallback?: Aspect): FieldDifference[] {
	const out: FieldDifference[] = [];
	const props = ASPECTS[table];
	for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (name === 'id' && table !== 'model') continue;
		const spec = props[name] ?? fallback ?? S;
		const path = [...base, name];
		if (typeof spec !== 'string') {
			out.push(...compareMembers(spec, before[name], after[name], path));
			continue;
		}
		// `null` is a statement of its own ("deliberately none"), so only a missing property takes the default
		const value = (v: unknown) => (v === undefined ? DEFAULTS[`${table}.${name}`] : v);
		const was = value(before[name]);
		const is = value(after[name]);
		if (same(was, is, UNORDERED.has(`${table}.${name}`))) continue;
		out.push({
			path,
			aspect: spec,
			change: was === undefined ? 'added' : is === undefined ? 'removed' : 'changed',
			...(was !== undefined && { before: was }),
			...(is !== undefined && { after: is })
		});
	}
	return out;
}

function compareMembers(spec: Members, before: unknown, after: unknown, path: string[]): FieldDifference[] {
	const out: FieldDifference[] = [];
	const [a, b] =
		spec.of === 'clause'
			? [new Map(Object.entries((before as Bag | undefined) ?? {})), new Map(Object.entries((after as Bag | undefined) ?? {}))]
			: [keyed(before as never[] | undefined, spec.key), keyed(after as never[] | undefined, spec.key)];
	for (const key of new Set([...a.keys(), ...b.keys()])) {
		const was = a.get(key);
		const is = b.get(key);
		const at = [...path, key];
		if (was === undefined) out.push({ path: at, aspect: S, change: 'added', after: is });
		else if (is === undefined) out.push({ path: at, aspect: S, change: 'removed', before: was });
		else if (spec.of === 'clause') {
			if (!same(was, is))
				out.push({
					path: at,
					aspect: S,
					change: 'changed',
					before: was,
					after: is
				});
		} else out.push(...compareProperties(spec.of, was as Bag, is as Bag, at));
	}
	return out;
}

/** The key a note is matched by: its id, or what it is attached to, its kind and its rank among those. */
export function noteKeys(notes: Note[] | undefined): string[] {
	const seen = new Map<string, number>();
	return (notes ?? []).map((n) => {
		if (n.id) return n.id;
		const group = `${n.kind ?? 'note'} on ${n.on ?? 'the view'}`;
		const rank = (seen.get(group) ?? 0) + 1;
		seen.set(group, rank);
		return `(${group} #${rank})`;
	});
}

const order = (aspects: Iterable<Aspect>): Aspect[] => {
	const set = new Set(aspects);
	return ASPECT_NAMES.filter((a) => set.has(a));
};

/** Compare two versions of a model. Both must be schema-valid; neither is changed. */
export function diffModels(before: Model, after: Model): ModelDiff {
	const differences: Difference[] = [];

	const top = compareProperties(
		'model',
		Object.fromEntries(Object.entries(before).filter(([k]) => k in ASPECTS.model)),
		Object.fromEntries(Object.entries(after).filter(([k]) => k in ASPECTS.model)),
		[]
	);
	if (top.length)
		differences.push({
			kind: 'model',
			id: 'model',
			change: 'changed',
			aspects: order(top.map((f) => f.aspect)),
			fields: top
		});

	const collection = <I extends object>(kind: ItemKind, was: I[] | undefined, is: I[] | undefined, keys: (items: I[]) => string[]) => {
		const a = new Map(keys(was ?? []).map((k, i) => [k, was![i]]));
		const b = new Map(keys(is ?? []).map((k, i) => [k, is![i]]));
		// the later version's order first, then what was removed, in the earlier order
		for (const id of new Set([...b.keys(), ...a.keys()])) {
			const x = a.get(id);
			const y = b.get(id);
			if (!x)
				differences.push({
					kind,
					id,
					change: 'added',
					aspects: [itemAspect(kind, y)],
					after: y
				});
			else if (!y)
				differences.push({
					kind,
					id,
					change: 'removed',
					aspects: [itemAspect(kind, x)],
					before: x
				});
			else {
				const fields = compareProperties(kind, x as Bag, y as Bag, [], kind === 'view' || kind === 'tour' ? P : undefined);
				if (fields.length)
					differences.push({
						kind,
						id,
						change: 'changed',
						aspects: order(fields.map((f) => f.aspect)),
						before: x,
						after: y,
						fields
					});
			}
		}
	};

	const ids = (items: { id: string }[]) => items.map((i) => i.id);
	collection('element', before.elements, after.elements, ids);
	collection('relationship', before.relationships, after.relationships, ids);
	collection('contract', before.contracts, after.contracts, ids);
	collection('pattern', before.proposedPatterns, after.proposedPatterns, ids);
	collection('absence', before.absences, after.absences, ids);
	collection('note', before.notes, after.notes, noteKeys);
	collection('view', before.views, after.views, ids);
	collection('tour', before.tours, after.tours, ids);

	return { differences, counts: count(differences) };
}

function count(differences: Difference[]): Record<Aspect, number> {
	const counts = Object.fromEntries(ASPECT_NAMES.map((a) => [a, 0])) as Record<Aspect, number>;
	for (const d of differences) {
		if (d.fields) for (const f of d.fields) counts[f.aspect]++;
		else counts[d.aspects[0]]++;
	}
	return counts;
}

/** Keep only the differences in the given aspects. A changed item keeps its matching fields. */
export function filterDiff(diff: ModelDiff, aspects: Iterable<Aspect>): ModelDiff {
	const keep = new Set(aspects);
	const differences: Difference[] = [];
	for (const d of diff.differences) {
		if (!d.fields) {
			if (keep.has(d.aspects[0])) differences.push(d);
			continue;
		}
		const fields = d.fields.filter((f) => keep.has(f.aspect));
		if (fields.length)
			differences.push({
				...d,
				aspects: order(fields.map((f) => f.aspect)),
				fields
			});
	}
	return { differences, counts: count(differences) };
}

/** A short one-line rendering of a value, for text output and narration. */
export function showValue(value: unknown, max = 70): string {
	if (value === undefined) return 'none';
	const text = typeof value === 'string' ? value : Array.isArray(value) && value.every((v) => typeof v === 'string') ? value.join(', ') || '(empty)' : JSON.stringify(value);
	const flat = text.replace(/\s+/g, ' ');
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** One line per field difference: `pattern: a → b`, `fields.cursor: added`. */
export function describeField(f: FieldDifference): string {
	const where = f.path.join('.');
	// a path of two ends at a whole member (a field, index, tie or part); a clause is shown by its text
	const member = f.path.length === 2 && f.path[0] !== 'clauses';
	if (f.change === 'added') return member ? `${where}: added` : `${where}: ${showValue(f.after)} (was not set)`;
	if (f.change === 'removed') return member ? `${where}: removed` : `${where}: no longer set (was ${showValue(f.before)})`;
	return `${where}: ${showValue(f.before)} → ${showValue(f.after)}`;
}
