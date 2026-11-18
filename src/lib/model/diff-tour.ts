import { describeField, noteKeys, showValue, type Difference, type ModelDiff } from './diff.js';
import type { Absence, Contract, Element, Model, Note, PatternDef, Profile, Relationship, Tour, TourStep } from './types.js';
import { validateModel } from './validate.js';
import { viewMembers, viewRelationships } from './view.js';

/**
 * A model that walks a reviewer through what differs between two versions (DECISIONS 47).
 *
 * The result is the later version with its tours replaced by one generated tour: an overview,
 * then one step per item that was added, removed or changed. Each step shows the item where the
 * later version draws it.
 *
 * An element or relationship that is gone is put back, marked `revision: "removed"`, so it is
 * drawn where it was (DECISIONS 48). Anything else that is gone (a contract, a note, a field) is
 * described in words, with the place it was spotlit.
 */

export const DIFFERENCE_TOUR = 'differences';

const LIST_LIMIT = 24;
const KIND_LABEL: Record<Difference['kind'], string> = {
	model: 'model',
	element: 'element',
	relationship: 'relationship',
	contract: 'contract',
	note: 'note',
	absence: 'absence',
	pattern: 'proposed pattern',
	view: 'view',
	tour: 'tour'
};
// "dropped", not "removed": removed is a change state (the change deletes the code)
const DID: Record<Difference['change'], string> = { added: 'Added', removed: 'Dropped', changed: 'Changed' };

interface Shown {
	view: string;
	members: Set<string>;
	rels: Set<string>;
}

function titleOf(d: Difference): string {
	const item = (d.after ?? d.before) as
		| {
				title?: string;
				label?: string;
				text?: string;
				from?: string;
				to?: string;
		  }
		| undefined;
	if (d.kind === 'relationship') return item?.label ?? `${item?.from} → ${item?.to}`;
	if (d.kind === 'note' || d.kind === 'absence') return showValue(item?.title ?? item?.text, 48);
	return item?.title ?? item?.label ?? d.id;
}

const code = (s: string | null | undefined) => (s ? `\`${s}\`` : 'none');

/** What an item that is gone was, in a sentence. */
function was(d: Difference): string {
	if (d.kind === 'element') {
		const e = d.before as Element;
		return `It was a ${e.kind}${e.parent ? ` inside ${code(e.parent)}` : ''}${e.pattern ? `, pattern ${code(e.pattern)}` : ''}${e.change ? `, marked ${code(e.change)}` : ''}.`;
	}
	if (d.kind === 'relationship') {
		const r = d.before as Relationship;
		return `It went from ${code(r.from)} to ${code(r.to)} (${r.kind}${r.enforcement ? `, enforced by ${code(r.enforcement)}` : ''}${r.contract ? `, contract ${code(r.contract)}` : ''}).`;
	}
	if (d.kind === 'contract')
		return `Its clauses were: ${
			Object.keys((d.before as Contract).clauses)
				.map(code)
				.join(', ') || 'none'
		}.`;
	if (d.kind === 'pattern') return `It was in the ${code((d.before as PatternDef).family)} family.`;
	if (d.kind === 'absence') return `It said: ${(d.before as Absence).text}`;
	if (d.kind === 'note') return `It said: ${(d.before as Note).text}`;
	return '';
}

function body(d: Difference): string {
	const head = `**${DID[d.change]}** ${KIND_LABEL[d.kind]} ${code(d.id)}.`;
	if (d.change === 'removed') return `${head} ${was(d)}`.trim();
	if (d.change === 'added') return head;
	const lines = (d.fields ?? []).map((f) => `- ${describeField(f)}`);
	const more = lines.length > LIST_LIMIT ? [`- … and ${lines.length - LIST_LIMIT} more`] : [];
	return [head, '', ...lines.slice(0, LIST_LIMIT), ...more].join('\n');
}

/**
 * The later version with the elements and relationships the comparison reports as gone put back
 * and marked dropped. Each returns to its place: after the element that preceded it, inside its
 * former parent, in the views that listed it.
 */
function withDropped(before: Model, after: Model, profile: Profile, diff: ModelDiff): Model {
	const model = structuredClone(after);
	const goneIds = (kind: Difference['kind']) => new Set(diff.differences.filter((d) => d.kind === kind && d.change === 'removed').map((d) => d.id));
	const goneElements = goneIds('element');
	const goneRels = goneIds('relationship');
	if (!goneElements.size && !goneRels.size) return model;

	const patterns = new Set([...Object.keys(profile.patterns), ...(model.proposedPatterns ?? []).map((p) => p.id)]);
	const known = (p: string | null | undefined) => p === null || p === undefined || patterns.has(p);
	let previous: string | undefined;
	for (const e of before.elements) {
		if (goneElements.has(e.id)) {
			// a pattern that is gone too cannot be drawn: the step says what it was
			const ghost: Element = { ...structuredClone(e), revision: 'removed' };
			if (!known(ghost.pattern)) delete ghost.pattern;
			if (ghost.patterns) ghost.patterns = ghost.patterns.filter(known);
			for (const part of ghost.parts ?? []) if (!known(part.pattern)) delete part.pattern;
			const at = previous === undefined ? -1 : model.elements.findIndex((x) => x.id === previous);
			model.elements.splice(at + 1, 0, ghost);
		}
		if (model.elements.some((x) => x.id === e.id)) previous = e.id;
	}
	const elements = new Set(model.elements.map((e) => e.id));
	const contracts = new Set((model.contracts ?? []).map((c) => c.id));
	for (const r of before.relationships ?? []) {
		if (!goneRels.has(r.id) || !elements.has(r.from) || !elements.has(r.to)) continue;
		const ghost: Relationship = { ...structuredClone(r), revision: 'removed' };
		if (ghost.contract && !contracts.has(ghost.contract)) delete ghost.contract;
		(model.relationships ??= []).push(ghost);
	}
	// a view that listed a dropped item by id lists it again
	const earlier = new Map(before.views.map((v) => [v.id, v]));
	for (const v of model.views) {
		const was = earlier.get(v.id);
		if (!was) continue;
		const back = (now: string[] | undefined, then: string[] | undefined, gone: Set<string>) => {
			const add = (then ?? []).filter((id) => gone.has(id) && !now?.includes(id));
			return add.length ? [...(now ?? []), ...add] : now;
		};
		if (v.include) v.include = back(v.include, was.include, goneElements);
		v.exclude = back(v.exclude, was.exclude, goneElements);
		v.omitRelationships = back(v.omitRelationships, was.omitRelationships, goneRels);
		for (const k of ['exclude', 'omitRelationships'] as const) if (v[k] === undefined) delete v[k];
	}
	// what was dropped may no longer fit the later version (a kind the profile lost, a parent that moved)
	const broken = validateModel({ ...model, tours: [] }, profile).some((d) => d.severity === 'error');
	return broken ? structuredClone(after) : model;
}

/**
 * Build the review model. `diff` is the comparison to walk (filter it first to walk less);
 * `later` must be valid against `profile`.
 */
export function differenceModel(before: Model, later: Model, profile: Profile, diff: ModelDiff): Model {
	const after = withDropped(before, later, profile, diff);
	const shown: Shown[] = after.views.map((v) => {
		const members = viewMembers(after, profile, v);
		return { view: v.id, members, rels: viewRelationships(after, v, members) };
	});
	const first = after.views[0].id;
	const elements = new Map(after.elements.map((e) => [e.id, e]));
	const rels = new Map((after.relationships ?? []).map((r) => [r.id, r]));
	const earlier = new Map(before.elements.map((e) => [e.id, e]));
	const afterNotes = noteKeys(after.notes);

	const viewOfElements = (ids: string[]) => shown.find((s) => ids.every((id) => s.members.has(id)))?.view;
	const viewOfRel = (id: string) => shown.find((s) => s.rels.has(id))?.view;

	/** A step that spotlights elements, in the first view that draws them all; otherwise words only. */
	const onElements = (ids: (string | undefined)[], select?: string): Partial<TourStep> => {
		const present = [...new Set(ids.filter((id): id is string => !!id && elements.has(id)))];
		const view = present.length ? viewOfElements(present) : undefined;
		if (view)
			return {
				view,
				focus: present,
				...(select && present.includes(select) && { select })
			};
		// drawn in no single view: fall back to the first one that draws any of them
		for (const id of present) {
			const one = viewOfElements([id]);
			if (one) return { view: one, focus: [id] };
		}
		return { view: first };
	};
	const onRelationship = (id: string): Partial<TourStep> | undefined => {
		const view = viewOfRel(id);
		return view ? { view, focus: [id], select: id } : undefined;
	};
	/** The nearest ancestor of a removed element that the later version still has. */
	const survivor = (id: string | undefined): string | undefined => {
		const seen = new Set<string>();
		for (let cur = id; cur && !seen.has(cur); cur = earlier.get(cur)?.parent) {
			seen.add(cur);
			if (elements.has(cur)) return cur;
		}
		return undefined;
	};

	const place = (d: Difference): Partial<TourStep> => {
		const item = (d.after ?? d.before) as Record<string, unknown>;
		switch (d.kind) {
			case 'element':
				// a dropped element is drawn again; if it could not be, its surviving parent stands in
				return elements.has(d.id) ? onElements([d.id], d.id) : onElements([survivor((d.before as Element).parent)]);
			case 'relationship': {
				const r = item as unknown as Relationship;
				return (rels.has(d.id) && onRelationship(d.id)) || onElements([r.from, r.to]);
			}
			case 'contract': {
				const users = [...(after.relationships ?? []), ...(before.relationships ?? [])].filter((r) => r.contract === d.id && rels.has(r.id));
				for (const r of users) {
					const at = onRelationship(r.id);
					if (at) return at;
				}
				return { view: first };
			}
			case 'pattern': {
				if (d.change === 'removed') return { view: first };
				const user = after.elements.find((e) => [e.pattern, ...(e.patterns ?? []), ...(e.parts ?? []).map((p) => p.pattern)].includes(d.id));
				const view = user ? viewOfElements([user.id]) : undefined;
				return view ? { view, highlight: { patterns: [d.id] } } : { view: first };
			}
			case 'absence':
				return onElements([survivor(item.parent as string | undefined)]);
			case 'note': {
				const on = item.on as string | undefined;
				const index = d.change === 'removed' ? -1 : afterNotes.indexOf(d.id);
				const note = after.notes?.[index];
				const own: Partial<TourStep> | undefined = !on && note?.views?.length ? { view: note.views[0] } : undefined;
				const at = own ?? (on && rels.has(on) ? onRelationship(on) : onElements([on]));
				// a note with an id can be spotlit itself, where its view shows it
				if (note?.id && at?.view && (!note.views || note.views.includes(at.view)) && (at.focus?.length || !on)) return { ...at, notes: [note.id] };
				return at ?? { view: first };
			}
			default:
				return { view: first };
		}
	};

	const walked = diff.differences.filter((d) => d.kind !== 'model' && d.kind !== 'view' && d.kind !== 'tour');
	const rest = diff.differences.filter((d) => !walked.includes(d));
	const used = new Set<string>(['overview']);
	const stepId = (d: Difference) => {
		const stem = `${d.kind}:${d.id}`.replace(/[^A-Za-z0-9_.:/-]+/g, '-').replace(/^[^A-Za-z_]/, '_');
		let id = stem;
		for (let n = 2; used.has(id); n++) id = `${stem}-${n}`;
		used.add(id);
		return id;
	};

	const line = (d: Difference) => `- ${DID[d.change].toLowerCase()} ${KIND_LABEL[d.kind]} **${titleOf(d)}** (${code(d.id)})`;
	const total = Object.values(diff.counts).reduce((a, b) => a + b, 0);
	const counts = Object.entries(diff.counts)
		.filter(([, n]) => n)
		.map(([aspect, n]) => `${n} ${aspect}`)
		.join(', ');
	const overview: TourStep = {
		id: 'overview',
		title: diff.differences.length ? 'What differs' : 'Nothing differs',
		view: first,
		dimOthers: false,
		body: diff.differences.length
			? [
					`${total} difference(s) in ${diff.differences.length} item(s): ${counts}.`,
					'',
					...walked.slice(0, LIST_LIMIT).map(line),
					...(walked.length > LIST_LIMIT ? [`- … and ${walked.length - LIST_LIMIT} more, each with its own step`] : []),
					...rest.map((d) =>
						d.change === 'changed'
							? `- changed ${KIND_LABEL[d.kind]}${d.kind === 'model' ? '' : ` ${code(d.id)}`}: ${(d.fields ?? []).map((f) => f.path.join('.')).join(', ')}`
							: line(d)
					)
				].join('\n')
			: 'The two versions are the same in everything compared.'
	};

	const steps: TourStep[] = [
		overview,
		...walked.map(
			(d): TourStep => ({
				id: stepId(d),
				title: `${DID[d.change]}: ${showValue(titleOf(d), 44)}`,
				body: body(d),
				view: first,
				...place(d)
			})
		)
	];
	const tour: Tour = {
		id: DIFFERENCE_TOUR,
		title: 'What differs',
		summary: `${after.title}: what differs from the earlier version.`,
		steps
	};
	return { ...after, tours: [tour] };
}
