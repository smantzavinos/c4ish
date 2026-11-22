import { describe, expect, it } from 'vitest';
import { grab, dragMove, release, type Drag, type DragPointer } from './gesture.js';
import { panCamera, pinchCamera, type Camera, type Point } from './camera.js';

const finger = (id: number, x: number, y: number): DragPointer => ({ id, x, y });
const start = (camera: Camera = { x: 0, y: 0, zoom: 1 }) => grab(undefined, finger(1, 100, 100), camera);
/** What the diagram shows under a point of the viewport. */
const under = (camera: Camera, p: Point) => ({ x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom });
const mid = ([a, b]: [Point, Point]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const from = (c: Point, m: Point) => Math.hypot(c.x - m.x, c.y - m.y);
/** A pinch keeps the diagram point under the fingers' midpoint, and each finger's distance from it. */
const pinchKeeps = (before: Camera, after: Camera, was: [Point, Point], now: [Point, Point]) => {
	const m = under(before, mid(was));
	const n = under(after, mid(now));
	expect(n.x).toBeCloseTo(m.x);
	expect(n.y).toBeCloseTo(m.y);
	for (const i of [0, 1] as const) expect(from(under(after, now[i]), n)).toBeCloseTo(from(under(before, was[i]), m));
};
/** A pan moves the whole diagram, so what was under a point is under it still. */
const panKeeps = (before: Camera, after: Camera, was: Point, now: Point) => {
	expect(under(after, now).x).toBeCloseTo(under(before, was).x);
	expect(under(after, now).y).toBeCloseTo(under(before, was).y);
};

describe('canvas gesture', () => {
	it('one finger pans from where it went down', () => {
		const drag = start({ x: 20, y: 30, zoom: 1 });
		const next = dragMove(drag, 1, 130, 80)!;
		expect(next.camera).toEqual(panCamera(drag.camera, 30, -20));
		expect(next.started).toBe(true);
		expect(next.drag.moved).toBe(true);
	});

	it('a tap is not a pan: nothing moves within a few pixels', () => {
		const drag = start();
		for (const [x, y] of [[102, 101], [98, 100], [100, 103]]) {
			const next = dragMove(drag, 1, x, y)!;
			expect(next.camera).toBeUndefined();
			expect(next.started).toBe(false);
			expect(next.drag.moved).toBe(false);
		}
		expect(release(drag, 1, drag.camera)).toEqual({ drag: undefined, moved: false });
	});

	it('after a pan the click that ends the gesture is not a selection', () => {
		const drag = dragMove(start(), 1, 120, 100)!.drag;
		expect(release(drag, 1, drag.camera).moved).toBe(true);
	});

	it('a second finger starts a pinch where both fingers are, and nothing jumps', () => {
		const moved = dragMove(start({ x: 0, y: 0, zoom: 2 }), 1, 110, 120)!;
		expect(moved.camera).toEqual({ x: 10, y: 20, zoom: 2 });
		// the pinch takes over from the camera now, not from where the pan began
		const pinch = grab(moved.drag, finger(2, 400, 300), moved.camera!);
		// two fingers are a gesture, never a tap, even before they move
		expect(pinch.moved).toBe(true);
		// both fingers move: the diagram turns with them about their midpoint
		const one = dragMove(pinch, 1, 115, 125)!;
		pinchKeeps(moved.camera!, one.camera!, [{ x: 110, y: 120 }, { x: 400, y: 300 }], [{ x: 115, y: 125 }, { x: 400, y: 300 }]);
		const next = dragMove(one.drag, 2, 405, 305)!;
		// moved the same way, they only pan, by exactly how far they went
		expect(next.camera).toEqual(panCamera(moved.camera!, 5, 5));
		expect(next.started).toBe(false);
	});

	it('two fingers pan with their midpoint and zoom with their spread', () => {
		const drag = grab(start({ x: 7, y: -3, zoom: 0.8 }), finger(2, 300, 100), { x: 7, y: -3, zoom: 0.8 });
		const first = dragMove(drag, 1, 80, 90)!.drag;
		const next = dragMove(first, 2, 340, 150)!;
		expect(next.camera).toEqual(pinchCamera(drag.camera, [{ x: 100, y: 100 }, { x: 300, y: 100 }], [{ x: 80, y: 90 }, { x: 340, y: 150 }]));
		pinchKeeps(drag.camera, next.camera!, [{ x: 100, y: 100 }, { x: 300, y: 100 }], [{ x: 80, y: 90 }, { x: 340, y: 150 }]);
	});

	it('a finger lifting hands the gesture over to the other where it is, and nothing jumps', () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		const drag = grab(grab(undefined, finger(1, 100, 100), camera), finger(2, 300, 200), camera);
		const moved = dragMove(dragMove(drag, 1, 90, 130)!.drag, 2, 390, 260)!;
		const now = moved.camera!;
		const left: Drag = release(moved.drag, 2, now).drag!;
		expect(left.pointers).toEqual([finger(1, 90, 130)]);
		expect(left.origin).toEqual([{ x: 90, y: 130 }]);
		expect(left.left).toEqual({ x: 390, y: 260 });
		expect(left.moved).toBe(true);
		// the finger that is left pans from where it is, by exactly how far it goes
		const next = dragMove(left, 1, 95, 150)!;
		expect(next.camera).toEqual(panCamera(now, 5, 20));
		panKeeps(now, next.camera!, { x: 90, y: 130 }, { x: 95, y: 150 });
		expect(dragMove(left, 1, 90, 130)!.camera!.x).toBeCloseTo(now.x);
		// and it can no longer end as a tap
		expect(release(next.drag, 1, next.camera!).moved).toBe(true);
	});

	it('a finger that stays is announced again where it just was, and the gesture carries on with it alone', () => {
		// Chrome's account of one finger of a pinch lifting: the finger that stays is the one reported up,
		// and is announced again under a new id as it moves; the finger that left goes quiet
		const camera = { x: 0, y: 0, zoom: 1 };
		const drag = grab(grab(undefined, finger(1, 100, 100), camera), finger(2, 300, 200), camera);
		const moved = dragMove(drag, 2, 340, 240)!.drag;
		const now = { x: 7, y: 3, zoom: 2 };
		const left = release(moved, 2, now).drag!;
		const again = grab(left, finger(4, 348, 245), now);
		expect(again.pointers).toEqual([finger(4, 348, 245)]);
		expect(again.moved).toBe(true);
		// it pans on from where it was announced, by exactly how far it goes
		const next = dragMove(again, 4, 358, 251)!;
		expect(next.camera).toEqual(panCamera(now, 10, 6));
		panKeeps(now, next.camera!, { x: 348, y: 245 }, { x: 358, y: 251 });
		// the finger that left is only reported up at the very end, and that changes nothing
		const quiet = release(again, 1, now);
		expect(quiet.drag?.pointers).toEqual([finger(4, 348, 245)]);
		expect(quiet.drag?.away).toBeUndefined();
		expect(quiet.moved).toBe(true);
	});

	it('a finger the gesture gave up on that moves is taken back as the second finger', () => {
		// A browser that keeps pointer ids (Safari) reports the finger that left as the one that went up;
		// the same rule then gives the gesture to a finger re-placed where it left. The other is down
		// after all, and is taken back as soon as it moves
		const camera = { x: 0, y: 0, zoom: 1 };
		const drag = grab(grab(undefined, finger(1, 100, 100), camera), finger(2, 300, 200), camera);
		const one = release(drag, 2, camera).drag!;
		const pans = dragMove(one, 1, 90, 90)!;
		const again = grab(pans.drag, finger(5, 305, 203), pans.camera!);
		expect(again.pointers.map((p) => p.id)).toEqual([5]);
		expect(again.away).toEqual(finger(1, 90, 90));
		// nothing jumps as it is taken back ...
		const back = dragMove(again, 1, 84, 84)!;
		expect(back.camera).toBeUndefined();
		expect(back.drag.pointers.map((p) => p.id)).toEqual([5, 1]);
		expect(back.drag.away).toBeUndefined();
		expect(back.drag.moved).toBe(true);
		// ... and from there they pinch like any other pair
		const next = dragMove(back.drag, 1, 64, 64)!;
		pinchKeeps(pans.camera!, next.camera!, [{ x: 305, y: 203 }, { x: 84, y: 84 }], [{ x: 305, y: 203 }, { x: 64, y: 64 }]);
		// with two fingers down there is nothing to take back
		expect(dragMove({ ...back.drag, away: finger(9, 0, 0) }, 9, 10, 10)).toBeUndefined();
	});

	it('a pointer that goes down on a finger that is down is that finger, not a second one', () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		const drag = dragMove(start(camera), 1, 150, 130)!.drag;
		// two touches this close are one finger: it takes over from where it went down
		const again = grab(drag, finger(5, 188, 130), camera);
		expect(again.pointers).toEqual([finger(5, 188, 130)]);
		expect(again.origin).toEqual([{ x: 188, y: 130 }]);
		expect(again.moved).toBe(true);
		// further away, it is a second finger
		const second = grab(drag, finger(6, 260, 130), camera);
		expect(second.pointers.map((p) => p.id)).toEqual([1, 6]);
		// and once two are down there is nowhere that a finger "just left"
		expect(second.left).toBeUndefined();
	});

	it('both fingers reported up at once ends the gesture; announced again, they start from the camera now', () => {
		// Chrome reports every finger that stays as up when a third one lifts
		const camera = { x: 0, y: 0, zoom: 1 };
		const drag = grab(grab(undefined, finger(1, 100, 100), camera), finger(2, 300, 200), camera);
		const now = dragMove(drag, 2, 400, 200)!.camera!;
		const both = release(release(drag, 1, now).drag!, 2, now);
		expect(both.drag).toBeUndefined();
		expect(both.moved).toBe(true);
		const again = grab(grab(undefined, finger(6, 100, 100), now), finger(7, 400, 100), now);
		// nothing jumps ...
		expect(dragMove(again, 7, 400, 100)!.camera).toEqual(now);
		// ... and they pinch from there
		expect(dragMove(again, 7, 550, 100)!.camera!.zoom).toBeCloseTo(now.zoom * 1.5);
	});

	it('only the last finger to leave ends the gesture', () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		const drag = grab(grab(undefined, finger(1, 100, 100), camera), finger(2, 300, 200), camera);
		const one = release(drag, 2, camera);
		expect(one.drag?.pointers.map((p) => p.id)).toEqual([1]);
		const gone = release(one.drag!, 1, camera);
		expect(gone.drag).toBeUndefined();
		expect(gone.moved).toBe(true);
	});

	it('a third finger is not part of the gesture', () => {
		const camera = { x: 0, y: 0, zoom: 1 };
		const drag = grab(grab(undefined, finger(1, 100, 100), camera), finger(2, 300, 200), camera);
		const third = grab(drag, finger(3, 500, 500), camera);
		expect(third).toBe(drag);
		expect(dragMove(drag, 3, 600, 600)).toBeUndefined();
		expect(release(drag, 3, camera)).toEqual({ drag, moved: true });
		// a lone third finger neither
		expect(dragMove(start(), 3, 300, 300)).toBeUndefined();
		expect(release(start(), 3, { x: 0, y: 0, zoom: 1 })).toEqual({ drag: start(), moved: false });
	});
});
