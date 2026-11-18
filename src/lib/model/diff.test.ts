import { describe, expect, it } from 'vitest';
import { check } from '../api.js';
import { clone, EXAMPLES, loadExample } from '../test/fixtures.js';
import { exportTour } from '../render/tour-export.js';
import { ASPECTS, describeField, diffModels, filterDiff, type Difference, type ModelDiff } from './diff.js';
import { DIFFERENCE_TOUR, differenceModel } from './diff-tour.js';
import { modelSchema } from './schema.js';
import type { Model } from './types.js';
import { validateModelSchema } from './validate.js';

const base: Model = {
	schemaVersion: 1,
	id: 'tiny',
	title: 'Tiny',
	provenance: { baseline: 'abc' },
	views: [
		{ id: 'eng', kind: 'engineering', title: 'Tiny' },
		{
			id: 'data',
			kind: 'engineering',
			title: 'Tiny data',
			include: ['tbl', 'log']
		}
	],
	elements: [
		{ id: 'app', kind: 'container', title: 'App', change: 'modified' },
		{
			id: 'ui',
			kind: 'component',
			parent: 'app',
			title: 'UI',
			change: 'reused',
			pattern: null
		},
		{
			id: 'svc',
			kind: 'component',
			parent: 'app',
			title: 'Service',
			change: 'new',
			pattern: 'api/mutation',
			patterns: ['api/read-query', 'web/form-action'],
			code: ['src/svc.ts#save'],
			parts: [
				{ title: 'Reader', pattern: 'api/read-query', change: 'new' },
				{
					id: 'writer',
					title: 'Writer',
					pattern: 'api/mutation',
					change: 'new'
				}
			]
		},
		{
			id: 'tbl',
			kind: 'data',
			title: 'items',
			change: 'modified',
			pattern: 'data/table',
			fields: [
				{ id: 'owner', type: 'id' },
				{ id: 'ownerKind', type: 'string' },
				{ id: 'name', title: 'Name', type: 'string' }
			],
			indexes: [{ id: 'by_owner', fields: ['owner', 'name'] }],
			ties: [
				{
					fields: ['owner', 'ownerKind'],
					label: 'kind matches owner',
					enforcement: 'our-code'
				}
			]
		},
		{
			id: 'log',
			kind: 'data',
			title: 'log',
			change: 'reused',
			pattern: 'data/table'
		}
	],
	relationships: [
		{
			id: 'call',
			from: 'ui',
			to: 'svc',
			kind: 'calls',
			change: 'new',
			contract: 'save'
		},
		{
			id: 'w',
			from: 'svc',
			to: 'tbl',
			kind: 'writes',
			enforcement: 'platform',
			change: 'new'
		},
		{
			id: 'ref',
			from: 'tbl',
			to: 'log',
			kind: 'references',
			enforcement: 'platform',
			change: 'reused'
		}
	],
	contracts: [
		{
			id: 'save',
			title: 'Save',
			change: 'new',
			clauses: { args: 'item', access: 'owner only' }
		}
	],
	notes: [
		{ id: 'risk1', on: 'w', kind: 'risk', text: 'Careful' },
		{ on: 'svc', kind: 'note', text: 'A remark' }
	],
	absences: [{ id: 'no-cache', parent: 'app', text: 'No cache' }],
	proposedPatterns: [{ id: 'api/batch', label: 'Batch', family: 'api' }],
	tours: [
		{
			id: 'review',
			title: 'Review',
			steps: [
				{
					id: 's1',
					title: 'Start',
					view: 'eng',
					focus: ['svc', 'tbl', 'app', 'w'],
					notes: ['risk1']
				}
			]
		}
	]
};

/** The base with one edit, compared with the base. */
function edited(edit: (m: Model) => void): ModelDiff {
	const after = clone(base);
	edit(after);
	expect(validateModelSchema(after)).toEqual([]);
	return diffModels(base, after);
}
const el = (m: Model, id: string) => m.elements.find((e) => e.id === id)!;
const rel = (m: Model, id: string) => m.relationships!.find((r) => r.id === id)!;
const only = (d: ModelDiff): Difference => {
	expect(d.differences).toHaveLength(1);
	return d.differences[0];
};
/** `path: aspect change` for every field difference of the single changed item. */
const fields = (d: ModelDiff) => (only(d).fields ?? []).map((f) => `${f.path.join('.')}: ${f.aspect} ${f.change}`);

describe('diffModels: what is the same', () => {
	it('a model equals itself', () => {
		expect(diffModels(base, clone(base))).toEqual({
			differences: [],
			counts: {
				structure: 0,
				text: 0,
				code: 0,
				presentation: 0,
				provenance: 0
			}
		});
	});

	it('items are matched by id, so their order does not matter', () => {
		const d = edited((m) => {
			m.elements.reverse();
			m.relationships!.reverse();
			el(m, 'tbl').fields!.reverse();
		});
		expect(d.differences).toEqual([]);
	});

	it('lists that are sets ignore order; an index keeps its field order', () => {
		expect(edited((m) => void el(m, 'svc').patterns!.reverse()).differences).toEqual([]);
		expect(edited((m) => void el(m, 'tbl').ties![0].fields.reverse()).differences).toEqual([]);
		expect(fields(edited((m) => void el(m, 'tbl').indexes![0].fields.reverse()))).toEqual(['indexes.by_owner.fields: structure changed']);
	});

	it('a missing pattern fit means full; a null pattern is not a missing one', () => {
		expect(edited((m) => void (el(m, 'svc').patternFit = 'full')).differences).toEqual([]);
		expect(fields(edited((m) => void (el(m, 'svc').patternFit = 'partial')))).toEqual(['patternFit: structure changed']);
		expect(fields(edited((m) => void delete el(m, 'ui').pattern))).toEqual(['pattern: structure removed']);
	});
});

describe('diffModels: elements', () => {
	it('an added element is reported whole', () => {
		const d = only(
			edited(
				(m) =>
					void m.elements.push({
						id: 'cache',
						kind: 'data',
						title: 'cache',
						change: 'new',
						pattern: 'data/table'
					})
			)
		);
		expect(d).toMatchObject({
			kind: 'element',
			id: 'cache',
			change: 'added',
			aspects: ['structure'],
			after: { kind: 'data', change: 'new' }
		});
		expect(d.before).toBeUndefined();
	});

	it('a removed element is reported whole, with what it was', () => {
		const d = only(edited((m) => void (m.elements = m.elements.filter((e) => e.id !== 'ui'))));
		expect(d).toMatchObject({
			kind: 'element',
			id: 'ui',
			change: 'removed',
			aspects: ['structure'],
			before: { kind: 'component', parent: 'app' }
		});
	});

	it('kind, parent, change state, pattern and further patterns are structure', () => {
		const d = edited((m) => {
			const e = el(m, 'svc');
			e.kind = 'container';
			delete e.parent;
			e.change = 'modified';
			e.pattern = 'api/read-query';
			e.patterns = ['api/read-query'];
		});
		expect(fields(d).sort()).toEqual([
			'change: structure changed',
			'kind: structure changed',
			'parent: structure removed',
			'pattern: structure changed',
			'patterns: structure changed'
		]);
		expect(only(d).fields!.find((f) => f.path[0] === 'pattern')).toMatchObject({
			before: 'api/mutation',
			after: 'api/read-query'
		});
	});

	it('titles are text, code references are code, a view restriction is presentation', () => {
		const d = edited((m) => {
			const e = el(m, 'svc');
			e.title = 'Save service';
			e.subtitle = 'Saves';
			e.code = ['src/save.ts#save'];
			e.views = ['eng'];
		});
		expect(fields(d).sort()).toEqual(['code: code changed', 'subtitle: text added', 'title: text changed', 'views: presentation added']);
		expect(only(d).aspects).toEqual(['text', 'code', 'presentation']);
		expect(d.counts).toEqual({
			structure: 0,
			text: 2,
			code: 1,
			presentation: 1,
			provenance: 0
		});
	});

	it('a property the comparison does not know counts as structure', () => {
		const after = clone(base);
		(el(after, 'svc') as unknown as Record<string, unknown>).somethingNew = 1;
		expect(diffModels(base, after).differences[0].fields).toEqual([
			{
				path: ['somethingNew'],
				aspect: 'structure',
				change: 'added',
				after: 1
			}
		]);
	});
});

describe('diffModels: data', () => {
	it('fields are matched by id: added, removed, retyped', () => {
		const d = edited((m) => {
			const t = el(m, 'tbl');
			t.fields = t.fields!.filter((f) => f.id !== 'name');
			t.fields.push({ id: 'slug', type: 'string' });
			t.fields[0].type = 'string';
			t.fields[1].title = 'Kind';
		});
		expect(fields(d).sort()).toEqual([
			'fields.name: structure removed',
			'fields.owner.type: structure changed',
			'fields.ownerKind.title: text added',
			'fields.slug: structure added'
		]);
	});

	it('a tie without an id is matched by its pair of fields; its enforcement is structure, its label text', () => {
		const d = edited((m) => {
			const t = el(m, 'tbl').ties![0];
			t.enforcement = 'nothing';
			t.label = 'kind should match owner';
		});
		expect(fields(d).sort()).toEqual(['ties.owner~ownerKind.enforcement: structure changed', 'ties.owner~ownerKind.label: text changed']);
		expect(only(d).fields!.find((f) => f.path[2] === 'enforcement')).toMatchObject({ before: 'our-code', after: 'nothing' });
	});

	it('a tie with an id keeps its identity when its fields change', () => {
		const before = clone(base);
		el(before, 'tbl').ties![0].id = 'owner-kind';
		const after = clone(before);
		el(after, 'tbl').ties![0].fields = ['owner', 'name'];
		expect(diffModels(before, after).differences[0].fields!.map((f) => f.path.join('.'))).toEqual(['ties.owner-kind.fields']);
		// without the id the same edit reads as one tie gone and another added
		expect(fields(edited((m) => void (el(m, 'tbl').ties![0].fields = ['owner', 'name']))).sort()).toEqual([
			'ties.name~owner: structure added',
			'ties.owner~ownerKind: structure removed'
		]);
	});

	it('a tie or an index added or removed is reported whole', () => {
		const d = edited((m) => {
			const t = el(m, 'tbl');
			t.ties!.push({
				id: 't2',
				fields: ['name', 'owner'],
				enforcement: 'nothing'
			});
			t.indexes = [];
		});
		expect(only(d).fields).toEqual([
			{
				path: ['indexes', 'by_owner'],
				aspect: 'structure',
				change: 'removed',
				before: { id: 'by_owner', fields: ['owner', 'name'] }
			},
			{
				path: ['ties', 't2'],
				aspect: 'structure',
				change: 'added',
				after: { id: 't2', fields: ['name', 'owner'], enforcement: 'nothing' }
			}
		]);
	});
});

describe('diffModels: parts', () => {
	it('a part with an id keeps its identity when retitled; without one the title is its name', () => {
		const d = edited((m) => {
			const [reader, writer] = el(m, 'svc').parts!;
			reader.title = 'Lister';
			writer.title = 'Saver';
			writer.pattern = 'api/read-query';
		});
		expect(fields(d).sort()).toEqual([
			'parts.Lister: structure added',
			'parts.Reader: structure removed',
			'parts.writer.pattern: structure changed',
			'parts.writer.title: text changed'
		]);
	});

	it("a part's code references are code", () => {
		expect(fields(edited((m) => void (el(m, 'svc').parts![1].code = ['src/svc.ts#write'])))).toEqual(['parts.writer.code: code added']);
	});
});

describe('diffModels: relationships and contracts', () => {
	it('ends, kind, enforcement and contract are structure; the label is text', () => {
		const d = edited((m) => {
			const r = rel(m, 'w');
			r.to = 'log';
			r.enforcement = 'our-code';
			r.label = 'appends';
			r.contract = 'save';
		});
		expect(fields(d).sort()).toEqual(['contract: structure added', 'enforcement: structure changed', 'label: text added', 'to: structure changed']);
	});

	it('added and removed relationships are reported whole', () => {
		const d = edited((m) => {
			m.relationships = m.relationships!.filter((r) => r.id !== 'ref');
			m.relationships.push({
				id: 'r2',
				from: 'ui',
				to: 'tbl',
				kind: 'reads',
				enforcement: 'nothing',
				change: 'new'
			});
		});
		expect(d.differences.map((x) => `${x.kind} ${x.id} ${x.change}`)).toEqual(['relationship r2 added', 'relationship ref removed']);
		expect(d.differences[0].after).toMatchObject({ enforcement: 'nothing' });
	});

	it('contracts are compared clause by clause', () => {
		const d = edited((m) => {
			const c = m.contracts![0].clauses;
			c.access = 'anyone';
			c.limits = '100 per page';
			delete c.args;
			m.contracts![0].title = 'Save an item';
		});
		expect(only(d).fields).toEqual([
			{
				path: ['title'],
				aspect: 'text',
				change: 'changed',
				before: 'Save',
				after: 'Save an item'
			},
			{
				path: ['clauses', 'args'],
				aspect: 'structure',
				change: 'removed',
				before: 'item'
			},
			{
				path: ['clauses', 'access'],
				aspect: 'structure',
				change: 'changed',
				before: 'owner only',
				after: 'anyone'
			},
			{
				path: ['clauses', 'limits'],
				aspect: 'structure',
				change: 'added',
				after: '100 per page'
			}
		]);
	});
});

describe('diffModels: notes, absences, patterns, views and the model itself', () => {
	it('a risk or question note is structure; a remark is text', () => {
		const d = edited((m) => {
			m.notes!.push({ id: 'q1', on: 'tbl', kind: 'question', text: 'Why?' });
			m.notes!.push({ id: 'n9', on: 'tbl', text: 'By the way' });
			m.notes = m.notes!.filter((n) => n.id !== 'risk1');
		});
		expect(d.differences.map((x) => `${x.id} ${x.change} ${x.aspects}`)).toEqual(['q1 added structure', 'n9 added text', 'risk1 removed structure']);
	});

	it("a note's wording is text; what it is attached to is structure", () => {
		const d = edited((m) => {
			m.notes![0].text = 'Very careful';
			m.notes![0].on = 'call';
		});
		expect(fields(d).sort()).toEqual(['on: structure changed', 'text: text changed']);
	});

	it('a note without an id is matched by what it is on, its kind and its rank', () => {
		const d = edited((m) => {
			m.notes!.unshift({ on: 'tbl', kind: 'note', text: 'New first' });
			m.notes![2].text = 'A remark, reworded';
		});
		expect(d.differences.map((x) => `${x.id} ${x.change}`)).toEqual(['(note on tbl #1) added', '(note on svc #1) changed']);
	});

	it('absences and proposed patterns are structure', () => {
		const d = edited((m) => {
			m.absences![0].text = 'No cache, no queue';
			m.absences!.push({ id: 'no-retry', text: 'No retry' });
			m.proposedPatterns = [];
		});
		expect(d.differences.map((x) => `${x.kind} ${x.id} ${x.change} ${x.aspects}`)).toEqual([
			'pattern api/batch removed structure',
			'absence no-cache changed structure',
			'absence no-retry added structure'
		]);
	});

	it('views and tours are presentation', () => {
		const d = edited((m) => {
			m.views[1].include = ['tbl'];
			m.views.push({ id: 'extra', kind: 'engineering', title: 'Extra' });
			m.tours![0].steps[0].title = 'Begin';
		});
		expect(d.differences.map((x) => `${x.kind} ${x.id} ${x.change} ${x.aspects}`)).toEqual([
			'view data changed presentation',
			'view extra added presentation',
			'tour review changed presentation'
		]);
		expect(d.counts.structure).toBe(0);
	});

	it("the model's title is text; its id and provenance are provenance", () => {
		const d = edited((m) => {
			m.title = 'Tiny, again';
			m.id = 'tiny-2';
			m.provenance = { baseline: 'def' };
		});
		expect(only(d)).toMatchObject({
			kind: 'model',
			id: 'model',
			change: 'changed',
			aspects: ['text', 'provenance']
		});
		expect(fields(d).sort()).toEqual(['id: provenance changed', 'provenance: provenance changed', 'title: text changed']);
	});
});

describe('filterDiff', () => {
	const d = edited((m) => {
		el(m, 'svc').title = 'Save service';
		el(m, 'svc').pattern = 'api/read-query';
		el(m, 'ui').subtitle = 'The page';
		m.views.push({ id: 'extra', kind: 'engineering', title: 'Extra' });
		m.elements.push({
			id: 'cache',
			kind: 'data',
			title: 'cache',
			change: 'new',
			pattern: 'data/table'
		});
	});

	it('keeps the fields of the chosen aspects and drops items left with none', () => {
		const s = filterDiff(d, ['structure']);
		expect(s.differences.map((x) => `${x.kind} ${x.id} ${(x.fields ?? []).map((f) => f.path)}`)).toEqual(['element svc pattern', 'element cache ']);
		expect(s.counts).toEqual({
			structure: 2,
			text: 0,
			code: 0,
			presentation: 0,
			provenance: 0
		});
		expect(filterDiff(d, ['text', 'presentation']).differences.map((x) => x.id)).toEqual(['ui', 'svc', 'extra']);
	});

	it('leaves the full comparison untouched', () => {
		expect(d.differences).toHaveLength(4);
	});
});

describe('describeField', () => {
	it('says what changed in one line', () => {
		const d = edited((m) => {
			const t = el(m, 'tbl');
			t.pattern = 'data/join-table';
			t.fields!.push({ id: 'slug' });
			t.subtitle = 'All items';
			delete t.indexes;
			m.contracts![0].clauses.limits = '100';
		});
		expect(d.differences.flatMap((x) => x.fields!.map(describeField))).toEqual([
			'pattern: data/table → data/join-table',
			'fields.slug: added',
			'indexes.by_owner: removed',
			'subtitle: All items (was not set)',
			'clauses.limits: 100 (was not set)'
		]);
	});
});

describe('aspect table', () => {
	type Schema = { properties?: Record<string, Schema>; items?: Schema };
	const top = modelSchema.properties as unknown as Record<string, Schema>;
	const element = top.elements.items!.properties!;
	const collections = ['views', 'elements', 'relationships', 'contracts', 'notes', 'absences', 'proposedPatterns', 'tours'];
	const tables: [keyof typeof ASPECTS, string[]][] = [
		['model', Object.keys(top).filter((k) => !collections.includes(k))],
		['element', Object.keys(element)],
		['field', Object.keys(element.fields.items!.properties!)],
		['index', Object.keys(element.indexes.items!.properties!)],
		['tie', Object.keys(element.ties.items!.properties!)],
		['part', Object.keys(element.parts.items!.properties!)],
		['relationship', Object.keys(top.relationships.items!.properties!)],
		['contract', Object.keys(top.contracts.items!.properties!)],
		['note', Object.keys(top.notes.items!.properties!)],
		['absence', Object.keys(top.absences.items!.properties!)],
		['pattern', Object.keys(top.proposedPatterns.items!.properties!)]
	];
	for (const [table, props] of tables)
		it(`names every ${table} property in the schema, and nothing else`, () => {
			const named = Object.keys(ASPECTS[table]);
			expect(props.filter((p) => p !== 'id' || table === 'model').sort()).toEqual(named.sort());
		});
});

describe('differenceModel', () => {
	const profile = check(base).profile!;
	const walk = (edit: (m: Model) => void) => {
		const after = clone(base);
		edit(after);
		const res = check(after);
		expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		const review = differenceModel(base, after, profile, diffModels(base, after));
		expect(check(review).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		return { after, review, steps: review.tours![0].steps };
	};

	it('is the later version with one generated tour, and leaves the later version alone', () => {
		const { after, review, steps } = walk((m) => void (el(m, 'svc').pattern = 'api/read-query'));
		expect(review.tours!.map((t) => t.id)).toEqual([DIFFERENCE_TOUR]);
		expect(after.tours!.map((t) => t.id)).toEqual(['review']);
		expect({ ...review, tours: undefined }).toEqual({
			...after,
			tours: undefined
		});
		expect(steps.map((s) => s.id)).toEqual(['overview', 'element:svc']);
	});

	it('a changed element is selected where it is drawn, with each difference listed', () => {
		const { steps } = walk((m) => {
			el(m, 'svc').pattern = 'api/read-query';
			el(m, 'svc').title = 'Save service';
		});
		expect(steps[1]).toMatchObject({
			view: 'eng',
			focus: ['svc'],
			select: 'svc',
			title: 'Changed: Save service'
		});
		expect(steps[1].body).toContain('- pattern: api/mutation → api/read-query');
		expect(steps[1].body).toContain('- title: Service → Save service');
		expect(steps[0].body).toContain('2 difference(s) in 1 item(s): 1 structure, 1 text.');
	});

	it('a removed element is described, with its surviving parent spotlit', () => {
		const { steps } = walk((m) => {
			m.elements = m.elements.filter((e) => e.id !== 'ui');
			m.relationships = m.relationships!.filter((r) => r.id !== 'call');
		});
		const step = steps.find((s) => s.id === 'element:ui')!;
		expect(step).toMatchObject({ view: 'eng', focus: ['app'] });
		expect(step.select).toBeUndefined();
		expect(step.body).toBe('**Removed** element `ui`. It was a component inside `app`, marked `reused`.');
	});

	it('a removed relationship is described, with its ends spotlit', () => {
		const { steps } = walk((m) => void (m.relationships = m.relationships!.filter((r) => r.id !== 'ref')));
		expect(steps[1]).toMatchObject({
			id: 'relationship:ref',
			view: 'eng',
			focus: ['tbl', 'log']
		});
		expect(steps[1].body).toContain('It went from `tbl` to `log` (references, enforced by `platform`).');
	});

	it('an added relationship is selected in a view that draws it', () => {
		const { steps } = walk(
			(m) =>
				void m.relationships!.push({
					id: 'r2',
					from: 'ui',
					to: 'tbl',
					kind: 'reads',
					enforcement: 'nothing',
					change: 'new'
				})
		);
		expect(steps[1]).toMatchObject({
			id: 'relationship:r2',
			view: 'eng',
			focus: ['r2'],
			select: 'r2'
		});
	});

	it('a contract is shown on a relationship that uses it', () => {
		const { steps } = walk((m) => void (m.contracts![0].clauses.access = 'anyone'));
		expect(steps[1]).toMatchObject({
			id: 'contract:save',
			view: 'eng',
			select: 'call'
		});
		expect(steps[1].body).toContain('- clauses.access: owner only → anyone');
	});

	it('a note with an id is named; a note without one spotlights its target', () => {
		const { steps } = walk((m) => {
			m.notes![0].text = 'Very careful';
			m.notes![1].text = 'Reworded';
		});
		expect(steps[1]).toMatchObject({
			id: 'note:risk1',
			view: 'eng',
			notes: ['risk1'],
			select: 'w'
		});
		expect(steps[2]).toMatchObject({ view: 'eng', focus: ['svc'] });
		expect(steps[2].notes).toBeUndefined();
	});

	it('an element drawn only in a later view is shown there', () => {
		const { steps } = walk((m) => {
			m.views[0].exclude = ['log'];
			el(m, 'log').pattern = 'data/join-table';
		});
		expect(steps.find((s) => s.id === 'element:log')).toMatchObject({
			view: 'data',
			select: 'log'
		});
	});

	it('views, tours and the model itself are listed in the overview only', () => {
		const { steps } = walk((m) => {
			m.title = 'Tiny, again';
			m.views[1].include = ['tbl'];
		});
		expect(steps).toHaveLength(1);
		expect(steps[0].body).toContain('- changed model: title');
		expect(steps[0].body).toContain('- changed view `data`: include');
	});

	it('walks only what a filtered comparison holds', () => {
		const after = clone(base);
		el(after, 'svc').title = 'Save service';
		el(after, 'tbl').pattern = 'data/join-table';
		const review = differenceModel(base, after, profile, filterDiff(diffModels(base, after), ['structure']));
		expect(review.tours![0].steps.map((s) => s.id)).toEqual(['overview', 'element:tbl']);
	});

	it('says so when nothing differs', () => {
		const { steps } = walk(() => {});
		expect(steps).toEqual([expect.objectContaining({ id: 'overview', title: 'Nothing differs' })]);
	});

	it('exports as a tour on a real example', async () => {
		const { model, profile: p } = loadExample(EXAMPLES[0]);
		const res = check(model, p);
		const before = res.model!;
		const after = clone(before);
		const changed = after.elements.find((e) => e.pattern)!;
		changed.patternFit = 'partial';
		const gone = after.relationships![0];
		after.relationships = after.relationships!.slice(1);
		for (const v of after.views) v.omitRelationships = v.omitRelationships?.filter((r) => r !== gone.id);
		for (const t of after.tours ?? [])
			for (const s of t.steps) {
				s.focus = s.focus?.filter((f) => f !== gone.id);
				s.path = s.path?.filter((x) => x !== gone.id);
				if (s.select === gone.id) delete s.select;
			}
		after.notes = after.notes?.filter((n) => n.on !== gone.id);
		const review = differenceModel(before, after, res.profile!, diffModels(before, after));
		const checked = check(review, p);
		expect(checked.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		const exported = await exportTour(checked.model!, checked.profile!, checked.model!.tours![0]);
		expect(exported.steps.length).toBe(review.tours![0].steps.length);
		expect(exported.markdown).toContain('patternFit: full → partial');
	});
});
