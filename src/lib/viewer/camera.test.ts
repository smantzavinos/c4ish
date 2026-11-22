import { describe, expect, it } from 'vitest';
import { fitCamera, panCamera, pinchCamera, zoomCamera, type Camera, type Point } from './camera.js';

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

describe('pinchCamera', () => {
	const origin: [Point, Point] = [
		{ x: 200, y: 100 },
		{ x: 400, y: 300 }
	];
	const mid = (p: [Point, Point]): Point => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
	const close = (a: Camera, b: Camera) => {
		expect(a.x).toBeCloseTo(b.x);
		expect(a.y).toBeCloseTo(b.y);
		expect(a.zoom).toBeCloseTo(b.zoom);
	};

	it('pans with the midpoint when the spread does not change', () => {
		const camera = { x: 40, y: -60, zoom: 0.5 };
		expect(pinchCamera(camera, origin, [{ x: 230, y: 190 }, { x: 430, y: 390 }])).toEqual(panCamera(camera, 30, 90));
	});

	it('zooms about the midpoint when it does not move', () => {
		const camera = { x: 100, y: -50, zoom: 0.5 };
		const next = pinchCamera(camera, origin, [{ x: 100, y: 0 }, { x: 500, y: 400 }]);
		close(next, zoomCamera(camera, 2, mid(origin)));
	});

	it('keeps what was under the midpoint under it, at the new scale', () => {
		const camera = { x: -80, y: 210, zoom: 0.4 };
		const to: [Point, Point] = [
			{ x: 40, y: 420 },
			{ x: 200, y: 640 }
		];
		const next = pinchCamera(camera, origin, to);
		const a = mid(origin);
		const b = mid(to);
		// the diagram point under the first midpoint is drawn under the second
		expect(next.x + ((a.x - camera.x) / camera.zoom) * next.zoom).toBeCloseTo(b.x);
		expect(next.y + ((a.y - camera.y) / camera.zoom) * next.zoom).toBeCloseTo(b.y);
		expect(next.zoom).toBeCloseTo(0.4 * (Math.hypot(160, 220) / Math.hypot(200, 200)));
	});

	it.each([0.001, 0.8, 1.25, 100])('keeps the anchor fixed, including at zoom limits (factor %s)', (factor) => {
		const camera = { x: -350, y: 120, zoom: 0.75 };
		// a level pair, so the spread is exactly 200 and the factor is the one under test
		const from: [Point, Point] = [
			{ x: 200, y: 100 },
			{ x: 400, y: 100 }
		];
		const half = 100 * factor;
		const next = pinchCamera(camera, from, [
			{ x: 300 - half, y: 100 },
			{ x: 300 + half, y: 100 }
		]);
		expect((300 - next.x) / next.zoom).toBeCloseTo((300 - camera.x) / camera.zoom);
		expect((100 - next.y) / next.zoom).toBeCloseTo((100 - camera.y) / camera.zoom);
		expect(next.zoom).toBeGreaterThanOrEqual(0.1);
		expect(next.zoom).toBeLessThanOrEqual(4);
	});

	it('is the same in one pinch as in two that hand over where the first ends', () => {
		const camera = { x: 10, y: 20, zoom: 0.5 };
		const a: [Point, Point] = [{ x: 100, y: 100 }, { x: 260, y: 100 }];
		const b: [Point, Point] = [{ x: 120, y: 140 }, { x: 440, y: 140 }];
		const c: [Point, Point] = [{ x: 60, y: 80 }, { x: 700, y: 80 }];
		expect(pinchCamera(pinchCamera(camera, a, b), b, c)).toEqual(pinchCamera(camera, a, c));
	});

	it('does not care which finger is which, and does not turn a twist into a rotation', () => {
		const camera = { x: 10, y: 20, zoom: 1 };
		const from: [Point, Point] = [{ x: 100, y: 100 }, { x: 300, y: 100 }];
		const to: [Point, Point] = [{ x: 150, y: 240 }, { x: 350, y: 160 }];
		close(pinchCamera(camera, [from[1], from[0]], [to[1], to[0]]), pinchCamera(camera, from, to));
		// same midpoint and spread, fingers swapped over: a pan by the midpoint only
		close(pinchCamera(camera, from, [{ x: 200, y: 200 }, { x: 200, y: 0 }]), camera);
	});

	it('only pans while two fingers share a pixel', () => {
		expect(pinchCamera({ x: 5, y: 6, zoom: 1 }, [{ x: 100, y: 100 }, { x: 100, y: 100 }], [{ x: 150, y: 90 }, { x: 150, y: 90 }])).toEqual({
			x: 55,
			y: -4,
			zoom: 1
		});
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
