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
