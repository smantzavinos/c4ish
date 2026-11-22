export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface Camera extends Point {
	zoom: number;
}

/** Camera offsets are viewport pixels, deliberately unbounded by the diagram. */
export function panCamera(camera: Camera, dx: number, dy: number): Camera {
	return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

/** Pinch and wheel zoom share these limits; Fit keeps its own, lower, maximum. */
function clampZoom(zoom: number): number {
	return Math.max(0.1, Math.min(4, zoom));
}

export function zoomCamera(camera: Camera, factor: number, anchor: Point): Camera {
	const zoom = clampZoom(camera.zoom * factor);
	const ratio = zoom / camera.zoom;
	return {
		x: anchor.x - (anchor.x - camera.x) * ratio,
		y: anchor.y - (anchor.y - camera.y) * ratio,
		zoom
	};
}

/** Distance between two pointers, in viewport pixels. */
function spread(a: Point, b: Point): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Camera for a two-finger pinch from `from` to `to` (viewport pixels): the fingers' midpoint drags the
 * diagram and their spread zooms about that midpoint, so whatever was under the midpoint stays under
 * it. It depends only on the two ends, never on the path between them or on the order of moves, so a
 * finger joining or leaving can re-base the gesture where it is without a jump, and pushing past a
 * zoom limit leaves no drift to undo.
 */
export function pinchCamera(camera: Camera, from: [Point, Point], to: [Point, Point]): Camera {
	const base = spread(...from);
	// fingers that land on the same pixel only pan until they part
	const zoom = clampZoom(camera.zoom * (base > 0 ? spread(...to) / base : 1));
	const ratio = zoom / camera.zoom;
	const ax = (from[0].x + from[1].x) / 2;
	const ay = (from[0].y + from[1].y) / 2;
	const bx = (to[0].x + to[1].x) / 2;
	const by = (to[0].y + to[1].y) / 2;
	return { x: bx - (ax - camera.x) * ratio, y: by - (ay - camera.y) * ratio, zoom };
}

/** The diagram size includes its margin, so centring preserves room on all sides. */
export function fitCamera(viewport: Size, diagram: Size): Camera {
	const zoom = Math.max(0.1, Math.min(2, viewport.width / diagram.width, viewport.height / diagram.height));
	return {
		x: (viewport.width - diagram.width * zoom) / 2,
		y: (viewport.height - diagram.height * zoom) / 2,
		zoom
	};
}

/**
 * Camera that frames `rect` (diagram pixels, already offset by any margin) in the viewport with
 * `margin` pixels around it; never zooms in past `maxZoom` and never out further than whole-fit.
 */
export function fitRectCamera(viewport: Size, rect: Point & Size, margin = 48, maxZoom = 1.25, minZoom = 0.1): Camera {
	const zoom = Math.max(
		minZoom,
		Math.min(maxZoom, (viewport.width - 2 * margin) / Math.max(rect.width, 1), (viewport.height - 2 * margin) / Math.max(rect.height, 1))
	);
	return {
		x: viewport.width / 2 - (rect.x + rect.width / 2) * zoom,
		y: viewport.height / 2 - (rect.y + rect.height / 2) * zoom,
		zoom
	};
}

/** Interpolated camera at t ∈ [0,1] (ease-in-out; zoom interpolates geometrically so the motion feels even). */
export function tweenCamera(a: Camera, b: Camera, t: number): Camera {
	const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
	const zoom = a.zoom * Math.pow(b.zoom / a.zoom, e);
	// keep the screen-space centre path linear in diagram space
	const ca = { x: a.x / a.zoom, y: a.y / a.zoom };
	const cb = { x: b.x / b.zoom, y: b.y / b.zoom };
	return { x: (ca.x + (cb.x - ca.x) * e) * zoom, y: (ca.y + (cb.y - ca.y) * e) * zoom, zoom };
}
