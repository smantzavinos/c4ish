import { describe, expect, it } from 'vitest';
import { check } from '../api.js';
import { buildDiagram } from '../render/diagram.js';
import { loadExample } from '../test/fixtures.js';
import { classify } from './state.js';
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

	it('maps a highlight to the same keys the legend uses', () => {
		const { model, profile } = loadExample('paged-reads');
		const res = check(model, profile);
		const step = res.model!.tours![0].steps.find((s) => s.id === 'proposed')!;
		const f = stepFilter(res.model!, res.profile!, step);
		expect(f.highlight).toContain('pattern:api/index-merge');
		expect(f.spotlight).toEqual(expect.arrayContaining(['merge', 'seal', 'scope', 'history']));
	});
});
