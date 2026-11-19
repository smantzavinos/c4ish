import { describe, expect, it } from 'vitest';
import { check } from '../api.js';
import { buildDiagram } from '../render/diagram.js';
import { loadExample } from '../test/fixtures.js';
import { classify, itemKeys } from './state.js';
import { currentStep, explore, gotoStep, narrationHtml, nextStep, parseTourHash, prevStep, resume, startTour, stepFilter, tourFromHash, tourHash } from './tour.js';
import type { Tour } from '../model/types.js';

const tour: Tour = {
	id: 'review',
	title: 'R',
	steps: [
		{ id: 'a', title: 'A', view: 'v' },
		{ id: 'b', title: 'B', view: 'v' },
		{ id: 'c', title: 'C', view: 'w' }
	]
};

describe('tour state', () => {
	it('starts, steps forward and back, and clamps at the ends', () => {
		let s = startTour(tour);
		expect(s.index).toBe(0);
		s = prevStep(s, tour);
		expect(s.index).toBe(0);
		s = nextStep(nextStep(nextStep(s, tour), tour), tour);
		expect(s.index).toBe(2);
		expect(gotoStep(s, tour, 1).index).toBe(1);
		expect(startTour(tour, 'b').index).toBe(1);
		expect(startTour(tour, 'nope').index).toBe(0);
	});

	it('marks exploring and resumes the same step', () => {
		const s = explore(startTour(tour, 'b'));
		expect(s).toMatchObject({ index: 1, exploring: true });
		expect(resume(s)).toMatchObject({ index: 1, exploring: false });
		expect(nextStep(s, tour).exploring).toBe(false);
		expect(currentStep(s, [tour])?.step.id).toBe('b');
	});

	it('round-trips deep links', () => {
		expect(tourHash('review', 'read-path')).toBe('#tour=review&step=read-path');
		expect(parseTourHash('#tour=review&step=read-path')).toEqual({ tour: 'review', step: 'read-path' });
		expect(parseTourHash('')).toEqual({ tour: undefined, step: undefined });
		expect(tourFromHash('#tour=review&step=c', [tour])).toMatchObject({ tour: 'review', index: 2 });
		expect(tourFromHash('#step=b', [tour])).toMatchObject({ tour: 'review', index: 1 });
		expect(tourFromHash('#tour=other', [tour])).toBeUndefined();
		expect(tourFromHash('#x=1', [tour])).toBeUndefined();
	});

	it('renders narration markdown safely', () => {
		expect(narrationHtml('**Bold** and `code` <b>\n\n- one\n- two')).toBe('<p><strong>Bold</strong> and <code>code</code> &lt;b&gt;</p><ul><li>one</li><li>two</li></ul>');
	});
});

describe('step filter', () => {
	it('lights the path and its ends and dims the rest', async () => {
		const { model, profile } = loadExample('paged-reads');
		const res = check(model, profile);
		const m = res.model!;
		const step = m.tours![0].steps.find((s) => s.id === 'page-read')!;
		const d = await buildDiagram(m, res.profile!, { view: step.view });
		const f = stepFilter(m, res.profile!, step);
		expect(f.path).toEqual(['seedPage', 'pageMerge', 'mergeIndexes']);
		expect(f.selected).toBe('page');
		const em = classify(d, f);
		for (const id of ['seedPage', 'pageMerge', 'mergeIndexes', 'loader', 'page', 'merge', 'items']) expect(em.get(id)).toBe('normal');
		expect(em.get('owner')).toBe('dim');
		expect(em.get('secret')).toBe('dim');
	});

	it('a bespoke highlight is the key of the bespoke row, and lights the cards that carry it', async () => {
		const { model, profile } = loadExample('paged-reads');
		const m = structuredClone(check(model, profile).model!);
		const one = m.elements.find((e) => typeof e.pattern === 'string' && !e.patternFit && !m.elements.some((c) => c.parent === e.id))!;
		delete one.pattern;
		one.bespoke = 'One caller.';
		const res = check(m, profile);
		expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		const view = res.model!.views.find((v) => v.kind === 'engineering')!.id;
		const f = stepFilter(res.model!, res.profile!, { id: 's', title: 'S', view, highlight: { bespoke: true } });
		expect(f.highlight).toEqual(['pattern:bespoke']);
		const d = await buildDiagram(res.model!, res.profile!, { view });
		expect(d.legend.sections.flatMap((s) => s.items).find((i) => i.id === 'pattern:bespoke')?.filter).toBe('pattern:bespoke');
		expect(itemKeys(d).get(one.id)?.has('pattern:bespoke')).toBe(true);
		const em = classify(d, f);
		expect(em.get(one.id)).toBe('normal');
		expect(d.nodes.filter((n) => n.id !== one.id).every((n) => em.get(n.id) === 'dim')).toBe(true);
	});

	it('maps a highlight to the same keys the legend uses', () => {
		const { model, profile } = loadExample('paged-reads');
		const res = check(model, profile);
		const step = res.model!.tours![0].steps.find((s) => s.id === 'proposed')!;
		const f = stepFilter(res.model!, res.profile!, step);
		expect(f.highlight).toContain('pattern:api/index-merge');
		expect(f.spotlight).toEqual(expect.arrayContaining(['merge', 'seal', 'scope', 'history']));
	});
});
