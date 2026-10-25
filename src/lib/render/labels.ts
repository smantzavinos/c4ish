import type { Point, Rect } from '../layout/types.js';

/**
 * Edge-label placement after routing.
 *
 * ELK's own label placement reserves a label "slot" in the layer between nodes, which piles every
 * label of a busy inter-container band into one column. Instead we route without labels and place
 * each label on its own line, choosing among candidate points along the polyline the one that
 * collides least with cards, frame headers, other labels and other edges, preferring positions
 * near the source end (where a reader starts following the line).
 */
export interface LabelRequest {
	id: string;
	points: Point[];
	width: number;
	height: number;
}

export interface LabelObstacles {
	/** Leaf cards: labels must not cover them. */
	nodes: Rect[];
	/** Frame header bands: avoid. */
	headers: Rect[];
	/** All edge polylines (by id), so labels avoid sitting on other lines. */
	edges: Map<string, Point[]>;
}

const FRACTIONS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9];

export function overlapArea(a: Rect, b: Rect): number {
	const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
}

function segmentHitsRect(p: Point, q: Point, r: Rect): boolean {
	// orthogonal segments only (ELK orthogonal routing), with a fallback bbox test
	const minX = Math.min(p.x, q.x);
	const maxX = Math.max(p.x, q.x);
	const minY = Math.min(p.y, q.y);
	const maxY = Math.max(p.y, q.y);
	return maxX >= r.x && minX <= r.x + r.width && maxY >= r.y && minY <= r.y + r.height;
}

/** Returns label boxes; `collisions` counts labels that could not avoid a card or another label. */
export function placeLabels(requests: LabelRequest[], obstacles: LabelObstacles): Map<string, Rect> & { collisions?: number } {
	const placed: Map<string, Rect> & { collisions?: number } = new Map<string, Rect>();
	placed.collisions = 0;
	const placedList: Rect[] = [];
	for (const req of requests) {
		const pts = req.points;
		if (pts.length < 2) continue;
		const segLens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
		const total = segLens.reduce((a, b) => a + b, 0) || 1;
		let best: { rect: Rect; cost: number } | undefined;
		let along = 0;
		for (let i = 0; i < segLens.length; i++) {
			const a = pts[i];
			const b = pts[i + 1];
			const len = segLens[i];
			const vertical = Math.abs(a.x - b.x) < 0.5;
			const room = vertical ? req.height + 10 : req.width + 10;
			for (const f of FRACTIONS) {
				if (len < 12 && f !== 0.5) continue;
				const c = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
				// on the line (preferred), or beside it when the line runs through a crowded band
				const offsets: [number, number, number][] = vertical
					? [[0, 0, 0], [req.width / 2 + 5, 0, 14], [-req.width / 2 - 5, 0, 14]]
					: [[0, 0, 0], [0, -req.height / 2 - 4, 14], [0, req.height / 2 + 4, 14]];
				for (const [dx, dy, penalty] of offsets) {
					const rect = { x: c.x + dx - req.width / 2, y: c.y + dy - req.height / 2, width: req.width, height: req.height };
					let cost = penalty;
					for (const n of obstacles.nodes) cost += overlapArea(rect, n) > 0 ? 1000 + overlapArea(rect, n) : 0;
					for (const h of obstacles.headers) cost += overlapArea(rect, h) > 0 ? 250 : 0;
					for (const l of placedList) cost += overlapArea(rect, l) > 0 ? 800 + overlapArea(rect, l) : 0;
					for (const [eid, ep] of obstacles.edges) {
						if (eid === req.id) continue;
						for (let k = 0; k < ep.length - 1; k++) if (segmentHitsRect(ep[k], ep[k + 1], rect)) cost += 25;
					}
					if (len < room && penalty === 0) cost += 60 * (1 - len / room);
					cost += ((along + len * f) / total) * 30 + Math.abs(f - 0.5) * 10;
					if (!best || cost < best.cost) best = { rect, cost };
				}
			}
			along += len;
		}
		if (best) {
			if (best.cost >= 800) placed.collisions!++;
			placed.set(req.id, best.rect);
			placedList.push(best.rect);
		}
	}
	return placed;
}

/** Bends and length of a routed polyline set (layout quality score inputs). */
export function routeStats(edges: Iterable<Point[]>): { bends: number; length: number } {
	let bends = 0;
	let length = 0;
	for (const p of edges) {
		bends += Math.max(0, p.length - 2);
		for (let i = 1; i < p.length; i++) length += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
	}
	return { bends, length };
}
