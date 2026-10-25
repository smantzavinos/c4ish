import { describe, expect, it } from 'vitest';
import { check } from '../api.js';
import { loadExample } from '../test/fixtures.js';
import { stepFilter } from '../viewer/tour.js';
import { buildDiagram } from './diagram.js';
import { pathBadge, pathMarks, staticBadgeScale, stepBounds, TOUR, viewerBadgeScale } from './tour.js';
import { exportTour } from './tour-export.js';

async function example(name: string) {
	const { model, profile } = loadExample(name);
	const res = check(model, profile);
	return { model: res.model!, profile: res.profile! };
}

describe('tour rendering', () => {
	it('numbers each path connector once, in order, off the cards', async () => {
		const { model, profile } = await example('versioned-wiring');
		const step = model.tours![0].steps.find((s) => s.id === 'write-path')!;
		const d = await buildDiagram(model, profile, { view: step.view });
		const marks = pathMarks(d, stepFilter(model, profile, step).path!);
		expect(marks.map((m) => m.n)).toEqual([1, 2, 3, 4, 5]);
		for (const m of marks) for (const n of d.nodes) {
			const r = n.rect;
			expect(m.x > r.x + 2 && m.x < r.x + r.width - 2 && m.y > r.y + 2 && m.y < r.y + r.height - 2).toBe(false);
		}
	});

	it('bounds a step around what it lights', async () => {
		const { model, profile } = await example('paged-reads');
		const step = model.tours![0].steps.find((s) => s.id === 'removed')!;
		const d = await buildDiagram(model, profile, { view: step.view });
		const b = stepBounds(d, stepFilter(model, profile, step))!;
		const collector = d.nodes.find((n) => n.id === 'collector')!.rect;
		expect(b.x).toBeLessThanOrEqual(collector.x);
		expect(b.width).toBeLessThan(d.width);
	});

	it('exports one captioned SVG per step plus a slideshow and markdown', async () => {
		const { model, profile } = await example('paged-reads');
		const tour = model.tours![0];
		const ex = await exportTour(model, profile, tour);
		expect(ex.steps.map((s) => s.file)).toEqual(tour.steps.map((s, i) => `0${i + 1}-${s.id}.svg`));
		expect(ex.steps[1].svg).toContain(`TOUR · 2 / ${tour.steps.length}`);
		expect(ex.steps[1].svg).toContain(TOUR);
		expect(ex.html).toContain('ArrowRight');
		expect(ex.markdown).toContain('#tour=review&step=page-read');
	});

	it('keeps badges readable when the page is large or the viewer zoomed out', () => {
		expect(staticBadgeScale(900, 800)).toBe(1);
		expect(staticBadgeScale(2100, 2400)).toBeCloseTo(2);
		expect(staticBadgeScale(1800, 1200)).toBeCloseTo(1.5);
		expect(viewerBadgeScale(2)).toBe(1);
		expect(viewerBadgeScale(0.5)).toBe(2);
		expect(viewerBadgeScale(0.05)).toBe(3);
		expect(pathBadge({ edge: 'e', n: 3, x: 10, y: 20 }, 1.5)).toContain('translate(10 20) scale(1.5)');
	});

	it('dims every note on a step that names none, and only the others when it names some', async () => {
		const { model, profile } = await example('paged-reads');
		const ex = await exportTour(model, profile, model.tours![0]);
		const noNotes = model.tours![0].steps.findIndex((s) => !s.notes?.length);
		const withNotes = model.tours![0].steps.findIndex((s) => s.notes?.length === 1);
		const dimmed = (svg: string) => (svg.match(/<g opacity="0.35">/g) ?? []).length;
		const total = model.notes!.length;
		expect(dimmed(ex.steps[noNotes].svg)).toBe(total);
		expect(dimmed(ex.steps[withNotes].svg)).toBe(total - 1);
	});
});
