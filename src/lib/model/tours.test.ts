import { describe, expect, it } from 'vitest';
import { check } from '../api.js';
import { clone, EXAMPLES, loadExample } from '../test/fixtures.js';
import { stepDims, stepLit, stepNarration, tourCoverage, toursCoverage, unwalkedScenarios, validateTours } from './tours.js';
import type { Model, Profile, TourStep } from './types.js';

const base: Model = {
	schemaVersion: 1,
	title: 'Tiny',
	views: [{ id: 'eng', kind: 'engineering', title: 'Tiny' }],
	elements: [
		{ id: 'app', kind: 'container', title: 'App', change: 'reused' },
		{ id: 'ui', kind: 'component', parent: 'app', title: 'UI', change: 'reused', pattern: null },
		{ id: 'svc', kind: 'component', parent: 'app', title: 'Service', change: 'new', pattern: 'api/mutation' },
		{ id: 'tbl', kind: 'data', title: 'items', change: 'reused', pattern: 'data/table' },
		{ id: 'old', kind: 'component', parent: 'app', title: 'Old', change: 'removed', pattern: null }
	],
	relationships: [
		{ id: 'call', from: 'ui', to: 'svc', kind: 'calls', change: 'new' },
		{ id: 'w', from: 'svc', to: 'tbl', kind: 'writes', enforcement: 'platform', change: 'new' },
		{ id: 'r', from: 'ui', to: 'tbl', kind: 'reads', enforcement: 'nothing', change: 'reused', divergence: 'DV-1' }
	],
	notes: [{ id: 'risk1', on: 'w', kind: 'risk', text: 'Careful' }]
};

function resolved(model: Model): { model: Model; profile: Profile } {
	const res = check(model);
	expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	return { model: res.model!, profile: res.profile! };
}

const withSteps = (steps: TourStep[]): Model => ({ ...clone(base), tours: [{ id: 't', title: 'T', steps }] });
const codes = (m: Model) => {
	const { model, profile } = resolved({ ...m, tours: undefined });
	return validateTours({ ...model, tours: m.tours }, profile);
};

describe('tour validation', () => {
	it('accepts a contiguous path and reports nothing when everything is covered', () => {
		const d = codes(
			withSteps([
				{ id: 'a', title: 'A', view: 'eng', path: ['call', 'w'], notes: ['risk1'] },
				{ id: 'b', title: 'B', view: 'eng', focus: ['old', 'r'] }
			])
		);
		expect(d).toEqual([]);
	});

	it('warns on a path gap unless a jump marks it', () => {
		const gap = codes(withSteps([{ id: 'a', title: 'A', view: 'eng', path: ['w', 'call'] }]));
		expect(gap.map((x) => x.code)).toContain('tour-path-gap');
		const jump = codes(withSteps([{ id: 'a', title: 'A', view: 'eng', path: ['w', { jump: true }, 'call'] }]));
		expect(jump.map((x) => x.code)).not.toContain('tour-path-gap');
	});

	it('treats a connector into a frame and one out of its child as contiguous', () => {
		const m = withSteps([{ id: 'a', title: 'A', view: 'eng', path: ['x', 'w'] }]);
		m.elements.push({ id: 'ext', kind: 'component', title: 'Ext', change: 'reused', pattern: null });
		m.relationships!.push({ id: 'x', from: 'ext', to: 'app', kind: 'calls', change: 'reused' });
		expect(codes(m).map((x) => x.code)).not.toContain('tour-path-gap');
	});

	it('rejects unknown references, duplicate step ids and items outside the view', () => {
		const m = withSteps([
			{ id: 'a', title: 'A', view: 'eng', focus: ['nope'], path: ['ghost'], notes: ['n?'] },
			{ id: 'a', title: 'A2', view: 'missing' }
		]);
		m.views.push({ id: 'small', kind: 'engineering', title: 'Small', include: ['tbl'] });
		m.tours![0].steps.push({ id: 'c', title: 'C', view: 'small', select: 'svc', highlight: { patterns: ['zzz'], change: ['shiny'] } });
		const c = codes(m).map((x) => x.code);
		expect(c).toEqual(expect.arrayContaining(['unknown-ref', 'duplicate-id', 'unknown-view', 'tour-not-in-view', 'unknown-pattern', 'unknown-change-state']));
	});

	it('lists uncovered changed, removed, divergence and risk items', () => {
		const m = resolved(withSteps([{ id: 'a', title: 'A', view: 'eng', select: 'svc' }]));
		const cov = toursCoverage(m.model, m.profile)[0];
		expect(cov.tour).toBe('t');
		expect(cov.uncovered.map((u) => `${u.id}:${u.reason}`).sort()).toEqual(['old:removed', 'r:divergence', 'risk1:risk-note']);
		expect(cov.items.map((u) => u.id)).toContain('svc');
	});

	it('counts only targeted steps: highlights and frame subtrees do not cover', () => {
		const broad = resolved(
			withSteps([
				{ id: 'a', title: 'A', view: 'eng', highlight: { change: ['removed', 'new'], enforcement: ['nothing'] }, onlyChanges: true },
				{ id: 'b', title: 'B', view: 'eng', focus: ['app'] }
			])
		);
		expect(toursCoverage(broad.model, broad.profile)[0].uncovered.map((u) => u.id).sort()).toEqual(['old', 'r', 'risk1', 'svc']);
		// a path covers its connectors, endpoints and the frames it enters; a named note covers its target
		const targeted = resolved(
			withSteps([
				{ id: 'a', title: 'A', view: 'eng', path: ['call'] },
				{ id: 'b', title: 'B', view: 'eng', notes: ['risk1'], focus: ['old', 'r'] }
			])
		);
		expect(toursCoverage(targeted.model, targeted.profile)[0].uncovered).toEqual([]);
	});

	it('judges each tour on its own', () => {
		const m = withSteps([{ id: 'a', title: 'A', view: 'eng', path: ['call', 'w'], notes: ['risk1'], focus: ['old', 'r'] }]);
		m.tours!.push({ id: 'short', title: 'Short', steps: [{ id: 'x', title: 'X', view: 'eng', select: 'svc' }] });
		const { model, profile } = resolved(m);
		const [full, short] = toursCoverage(model, profile);
		expect(full.uncovered).toEqual([]);
		expect(short.uncovered.length).toBeGreaterThan(0);
		const warns = validateTours(model, profile).filter((d) => d.code === 'tour-coverage');
		expect(warns.every((d) => d.message.startsWith('tour "short"'))).toBe(true);
		expect(warns[0].message).toContain("highlights don't count");
	});

	it('surfaces coverage through check() as a lint warning', () => {
		const res = check(withSteps([{ id: 'a', title: 'A', view: 'eng' }]));
		const cov = res.diagnostics.filter((d) => d.code === 'tour-coverage');
		expect(cov.length).toBe(4);
		expect(cov.every((d) => d.severity === 'warning')).toBe(true);
	});

	for (const name of EXAMPLES)
		it(`${name} has a tour that covers everything`, () => {
			const { model, profile } = loadExample(name);
			const res = check(model, profile);
			expect(res.model!.tours?.length).toBeGreaterThan(0);
			for (const t of res.model!.tours!) expect(tourCoverage(res.model!, res.profile!, t).uncovered).toEqual([]);
		});
});

describe('bespoke in tours', () => {
	const bespoke = (edit: (m: Model) => void, steps: TourStep[]) => {
		const m = withSteps(steps);
		edit(m);
		return resolved(m);
	};
	const el = (m: Model, id: string) => m.elements.find((e) => e.id === id)!;
	const oneOff = (id: string) => (m: Model) => {
		delete el(m, id).pattern;
		el(m, id).bespoke = 'One caller.';
	};
	const uncovered = (r: { model: Model; profile: Profile }) =>
		toursCoverage(r.model, r.profile)[0]
			.uncovered.map((u) => `${u.id}:${u.reason}`)
			.filter((u) => u.endsWith(':bespoke'));
	const elsewhere: TourStep[] = [{ id: 'a', title: 'A', view: 'eng', focus: ['tbl'] }];

	it('a new or modified bespoke element must be pointed at', () => {
		expect(uncovered(bespoke(oneOff('svc'), elsewhere))).toEqual(['svc:bespoke']);
		expect(uncovered(bespoke(oneOff('svc'), [{ id: 'a', title: 'A', view: 'eng', select: 'svc' }]))).toEqual([]);
		const warned = check(bespoke(oneOff('svc'), elsewhere).model).diagnostics.map((d) => d.message);
		expect(warned).toContain('tour "t": bespoke item "Service" (svc) is not pointed at by any step — focus, select, path or a named note; highlights don\'t count');
	});
	it('a bespoke part counts by its own change state, or its element\'s', () => {
		const part = (change?: string) => (m: Model) => void (el(m, 'svc').parts = [{ title: 'retry', bespoke: 'Only here.', ...(change && { change }) }]);
		expect(uncovered(bespoke(part(), elsewhere))).toEqual(['svc:bespoke']);
		expect(uncovered(bespoke(part('reused'), elsewhere))).toEqual([]);
	});
	it('an existing one-off shown as context is not a review item', () => {
		expect(uncovered(bespoke(oneOff('ui'), elsewhere))).toEqual([]);
	});
	it('a bespoke highlight lights every bespoke element and never covers one', () => {
		const step: TourStep = { id: 'a', title: 'A', view: 'eng', highlight: { bespoke: true } };
		const r = bespoke(
			(m) => {
				oneOff('svc')(m);
				oneOff('ui')(m);
			},
			[step]
		);
		expect([...stepLit(r.model, r.profile, step)].sort()).toEqual(['svc', 'ui']);
		expect(stepDims(step)).toBe(true);
		expect(uncovered(r)).toEqual(['svc:bespoke']);
	});
});

describe('scenarios in tours', () => {
	const scenarios = [
		{ id: 'S1', title: 'Save an item' },
		{ id: 'S2', title: 'Read the items' }
	];
	it('a step names the scenarios it walks under its narration', () => {
		expect(stepNarration({ scenarios }, { body: 'The page **saves**.', scenarios: ['S2', 'S1'] })).toBe('The page **saves**.\n\nWalks: **S2** Read the items · **S1** Save an item');
		expect(stepNarration({ scenarios }, { scenarios: ['S1'] })).toBe('Walks: **S1** Save an item');
		expect(stepNarration({ scenarios }, { body: 'Nothing walked.' })).toBe('Nothing walked.');
		expect(stepNarration({ scenarios }, {})).toBeUndefined();
	});
	it('lists the scenarios no step of any tour names', () => {
		const m = withSteps([{ id: 'a', title: 'A', view: 'eng', scenarios: ['S2'] }]);
		m.scenarios = scenarios;
		expect(unwalkedScenarios(m).map((s) => s.id)).toEqual(['S1']);
		expect(unwalkedScenarios({ ...m, tours: undefined }).map((s) => s.id)).toEqual(['S1', 'S2']);
	});
});
