import { describe, expect, it } from 'vitest';
import { fitCamera, panCamera, zoomCamera } from './camera.js';

describe('viewer camera', () => {
	it('pans freely in either direction even when the diagram fits', () => {
		const camera = fitCamera({ width: 1000, height: 800 }, { width: 400, height: 200 });
		expect(panCamera(camera, 1500, 1200)).toEqual({ x: 1600, y: 1400, zoom: 2 });
		expect(panCamera(camera, -1500, -1200)).toEqual({ x: -1400, y: -1000, zoom: 2 });
	});

	it.each([
		{ viewport: { width: 1200, height: 800 }, diagram: { width: 2000, height: 1000 }, expected: { x: 0, y: 100, zoom: 0.6 } },
		{ viewport: { width: 800, height: 600 }, diagram: { width: 400, height: 1000 }, expected: { x: 280, y: 0, zoom: 0.6 } },
		{ viewport: { width: 1000, height: 800 }, diagram: { width: 400, height: 200 }, expected: { x: 100, y: 200, zoom: 2 } }
	])('fits and centres the padded diagram: $expected', ({ viewport, diagram, expected }) => {
		expect(fitCamera(viewport, diagram)).toEqual(expected);
	});

	it('zooms around the cursor rather than the diagram origin', () => {
		expect(zoomCamera({ x: 100, y: -50, zoom: 0.5 }, 2, { x: 300, y: 200 }))
			.toEqual({ x: -100, y: -300, zoom: 1 });
	});

	it.each([0.001, 0.8, 1.25, 100])('keeps the anchor fixed, including at zoom limits (factor %s)', (factor) => {
		const camera = { x: -350, y: 120, zoom: 0.75 };
		const anchor = { x: 240, y: 180 };
		const next = zoomCamera(camera, factor, anchor);
		expect((anchor.x - next.x) / next.zoom).toBeCloseTo((anchor.x - camera.x) / camera.zoom);
		expect((anchor.y - next.y) / next.zoom).toBeCloseTo((anchor.y - camera.y) / camera.zoom);
		expect(next.zoom).toBeGreaterThanOrEqual(0.1);
		expect(next.zoom).toBeLessThanOrEqual(4);
	});

	it('composes successive zooms without a deferred scroll adjustment', () => {
		const anchor = { x: 300, y: 200 };
		const camera = { x: 100, y: -50, zoom: 0.5 };
		const next = zoomCamera(zoomCamera(camera, 2, anchor), 2, anchor);
		expect(next).toEqual({ x: -500, y: -800, zoom: 2 });
	});
});

describe('fitRectCamera / tweenCamera', () => {
	it('centres a rect and caps the zoom', async () => {
		const { fitRectCamera } = await import('./camera.js');
		const c = fitRectCamera({ width: 1000, height: 800 }, { x: 100, y: 100, width: 200, height: 100 }, 50, 1.5);
		expect(c.zoom).toBe(1.5);
		expect(c.x + (100 + 100) * c.zoom).toBeCloseTo(500);
		expect(c.y + (100 + 50) * c.zoom).toBeCloseTo(400);
		const big = fitRectCamera({ width: 1000, height: 800 }, { x: 0, y: 0, width: 1800, height: 700 }, 50);
		expect(big.zoom).toBeCloseTo(900 / 1800);
	});

	it('starts at a and ends at b', async () => {
		const { tweenCamera } = await import('./camera.js');
		const a = { x: 10, y: 20, zoom: 0.5 };
		const b = { x: -300, y: 40, zoom: 2 };
		expect(tweenCamera(a, b, 0)).toEqual(a);
		const end = tweenCamera(a, b, 1);
		expect(end.zoom).toBeCloseTo(2);
		expect(end.x).toBeCloseTo(-300);
		expect(end.y).toBeCloseTo(40);
	});
});
