import type { Camera, Point } from './camera.js';
import { panCamera, pinchCamera } from './camera.js';

/**
 * Dragging the canvas with one or two pointers (DECISIONS 65). One pointer pans; two pan and pinch.
 * The camera follows from where the pointers were, and what it was, when the current set of pointers
 * took over, so a finger joining or leaving changes nothing until it moves. Nothing here touches the
 * DOM; `DiagramCanvas` keeps the pointer capture.
 */

/** A pointer on the canvas: its id and its client position in CSS pixels. */
export interface DragPointer extends Point {
	id: number;
}

export interface Drag {
	/** Down, in the order they went down. A third pointer is not part of the gesture. */
	pointers: DragPointer[];
	/** Where each pointer was when the current set took over. */
	origin: Point[];
	/** The camera then. */
	camera: Camera;
	/** A pan or a pinch happened: a click that ends the gesture is not a selection. */
	moved: boolean;
	/** Where the last pointer to leave was, for as long as another is down. */
	left?: Point;
	/** A pointer this gesture gave up on that may still be down: taken back if it moves. */
	away?: DragPointer;
}

/** How far a pointer travels, in pixels, before it pans rather than taps. */
const TAP_SLOP = 3;

/** Two touches closer than this, in pixels, are one finger announced again by the browser, never two. */
const SAME_FINGER = 40;

const at = ({ x, y }: Point): Point => ({ x, y });
const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= SAME_FINGER;

/**
 * A pointer went down: it starts a pan, joins as the second finger of a pinch, or is a finger the browser
 * announced again. Chrome's account of one finger lifting while the other stays is that the finger that
 * stays is the one that went up, and is then announced again under a new id where it is or just was,
 * while the finger that left goes quiet until the whole touch ends. So a pointer that goes down on a
 * finger, or where one just left, is that finger: the gesture carries on with it alone, and the pointer
 * it displaces is kept as `away`, taken back if it turns out to move.
 */
export function grab(drag: Drag | undefined, pointer: DragPointer, camera: Camera): Drag {
	if (!drag) return { pointers: [pointer], origin: [at(pointer)], camera, moved: false };
	if (drag.pointers.length > 1) return drag;
	const [held] = drag.pointers;
	if (near(pointer, held) || (drag.left && near(pointer, drag.left))) {
		return { pointers: [pointer], origin: [at(pointer)], camera, moved: true, away: held };
	}
	// Both fingers take over from where they are now, and two fingers are never a tap.
	const pointers = [...drag.pointers, pointer];
	return { pointers, origin: pointers.map(at), camera, moved: true };
}

/**
 * A pointer moved: the gesture that follows and the camera it shows now. `started` is set by the move
 * that turns a tap into a pan. A pointer that is not part of the gesture changes nothing, except a
 * pointer given up on that moves: it is down after all, and is the second finger again from here.
 */
export function dragMove(drag: Drag, id: number, x: number, y: number): { drag: Drag; camera?: Camera; started: boolean } | undefined {
	const i = drag.pointers.findIndex((p) => p.id === id);
	if (i < 0) {
		if (drag.away?.id !== id || drag.pointers.length > 1) return undefined;
		const pointers = [...drag.pointers, { id, x, y }];
		return { drag: { ...drag, pointers, origin: pointers.map(at), moved: true, away: undefined }, started: false };
	}
	const pointers = [...drag.pointers];
	pointers[i] = { id, x, y };
	const [a, b] = pointers;
	if (b) {
		return { drag: { ...drag, pointers }, camera: pinchCamera(drag.camera, [drag.origin[0], drag.origin[1]], [a, b]), started: false };
	}
	const dx = x - drag.origin[0].x;
	const dy = y - drag.origin[0].y;
	// a tap, or a hand that trembles, is not a pan
	if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= TAP_SLOP) return { drag: { ...drag, pointers }, started: false };
	return {
		drag: { ...drag, pointers, moved: true },
		camera: panCamera(drag.camera, dx, dy),
		started: !drag.moved
	};
}

/**
 * A pointer went up. A finger that is left pans on from where it is, and can no longer end as a tap.
 * With none left the gesture is over, and `moved` says whether the click that follows is a selection.
 */
export function release(drag: Drag, id: number, camera: Camera): { drag: Drag | undefined; moved: boolean } {
	if (id === drag.away?.id) return { drag: { ...drag, away: undefined }, moved: drag.moved };
	if (!drag.pointers.some((p) => p.id === id)) return { drag, moved: drag.moved };
	const rest = drag.pointers.filter((p) => p.id !== id);
	if (!rest.length) return { drag: undefined, moved: drag.moved };
	// the pointer that is left pans on from where it is, and can no longer end as a tap
	const gone = drag.pointers.find((p) => p.id === id);
	return { drag: { pointers: rest, origin: rest.map(at), camera, moved: true, left: gone && at(gone) }, moved: true };
}
