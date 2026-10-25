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

export function zoomCamera(camera: Camera, factor: number, anchor: Point): Camera {
	const zoom = Math.max(0.1, Math.min(4, camera.zoom * factor));
	const ratio = zoom / camera.zoom;
	return {
		x: anchor.x - (anchor.x - camera.x) * ratio,
		y: anchor.y - (anchor.y - camera.y) * ratio,
		zoom
	};
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
