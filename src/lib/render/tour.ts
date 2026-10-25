import type { Point, Rect } from '../layout/types.js';
import { classify, type Emphasis, type FilterState } from '../viewer/state.js';
import type { Diagram, DiagramEdge } from './diagram.js';
import { overlapArea } from './labels.js';
import { el, fmt, g, rect, text } from './svg.js';
import { C } from './theme.js';

/** Tour colour: path glow, step badges and selection ring (never used for meaning elsewhere). */
export const TOUR = '#2563eb';

export interface PathMark {
	edge: string;
	/** 1-based position in the path. */
	n: number;
	x: number;
	y: number;
}

function polylineLength(pts: Point[]): number {
	let s = 0;
	for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
	return s;
}

export function pointAt(pts: Point[], t: number): Point {
	const total = polylineLength(pts);
	let left = total * t;
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const seg = Math.hypot(b.x - a.x, b.y - a.y);
		if (left <= seg || i === pts.length - 1) {
			const f = seg ? Math.min(1, left / seg) : 0;
			return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
		}
		left -= seg;
	}
	return pts[0];
}

/**
 * Where the numbered badges of a path go: along each connector, avoiding its label, cards and
 * earlier badges (first free spot of 0.5, 0.35, 0.65, 0.25, 0.75 of the line's length).
 */
export function pathMarks(d: Diagram, path: string[], scale = 1): PathMark[] {
	const R = BADGE_R * scale;
	const marks: PathMark[] = [];
	const edges = new Map(d.edges.map((e) => [e.id, e]));
	const obstacles: Rect[] = [...d.nodes.map((n) => n.rect), ...d.edges.flatMap((e) => (e.label ? [e.label.rect] : []))];
	path.forEach((id, i) => {
		const e = edges.get(id);
		if (!e || e.points.length < 2) return;
		let best: Point | undefined;
		let bestCost = Infinity;
		for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) {
			const p = pointAt(e.points, t);
			const box = { x: p.x - R, y: p.y - R, width: 2 * R, height: 2 * R };
			const cost = obstacles.reduce((s, o) => s + overlapArea(box, o), 0) + Math.abs(t - 0.5) * 10;
			if (cost < bestCost) {
				bestCost = cost;
				best = p;
			}
		}
		marks.push({ edge: id, n: i + 1, x: best!.x, y: best!.y });
		obstacles.push({ x: best!.x - R, y: best!.y - R, width: 2 * R, height: 2 * R });
	});
	return marks;
}

export const BADGE_R = 11;

/**
 * Badge scale for a static step page: pages are usually viewed shrunk to fit a screen, so a
 * large page draws larger badges to keep them readable (≈ 1 for pages up to 1200×1000, max 2).
 */
export function staticBadgeScale(width: number, height: number): number {
	return Math.min(2, Math.max(1, width / 1200, height / 1000));
}

/** Badge scale in the viewer: constant on-screen size when zoomed out, natural size when zoomed in. */
export function viewerBadgeScale(zoom: number): number {
	return Math.min(3, Math.max(1, 1 / Math.max(zoom, 0.01)));
}

export function pathBadge(m: PathMark, scale = 1): string {
	const inner =
		el('circle', { cx: 0, cy: 0, r: BADGE_R, fill: TOUR, stroke: C.white, 'stroke-width': 2.5 }) +
		text(0, 4, String(m.n), { size: 11.5, weight: 700, fill: C.white, anchor: 'middle' });
	return g(inner, { transform: `translate(${fmt(m.x)} ${fmt(m.y)})${scale === 1 ? '' : ` scale(${fmt(scale)})`}` });
}

export function edgePathD(e: Pick<DiagramEdge, 'points'>): string {
	return e.points.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join(' ');
}

/** The soft glow under a path connector. */
export function pathGlow(e: DiagramEdge): string {
	return el('path', { d: edgePathD(e), fill: 'none', stroke: TOUR, 'stroke-opacity': 0.28, 'stroke-width': 9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
}

export function selectionRing(r: Rect): string {
	return rect(r.x - 5, r.y - 5, r.width + 10, r.height + 10, { rx: 6, fill: 'none', stroke: TOUR, 'stroke-width': 2.5 });
}

/** Bounds of what a step lights (lit cards, path connectors), or undefined when nothing is lit. */
export function stepBounds(d: Diagram, f: FilterState, emphasis = classify(d, f)): Rect | undefined {
	const lit = (id: string) => (f.spotlight?.includes(id) || f.path?.includes(id) || f.selected === id) && emphasis.get(id) !== 'hidden';
	const boxes: Rect[] = [];
	for (const n of [...d.nodes, ...d.frames]) if (lit(n.id)) boxes.push(n.rect);
	for (const e of d.edges) {
		if (!lit(e.id)) continue;
		const xs = e.points.map((p) => p.x);
		const ys = e.points.map((p) => p.y);
		boxes.push({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
		const ends = [e.from, e.to].flatMap((id) => [...d.nodes, ...d.frames].filter((n) => n.id === id).map((n) => n.rect));
		boxes.push(...ends);
	}
	if (!boxes.length) return undefined;
	const x = Math.min(...boxes.map((b) => b.x));
	const y = Math.min(...boxes.map((b) => b.y));
	return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}

const OPACITY: Record<Emphasis, number> = { normal: 1, focus: 1, dim: 0.16, hidden: 0.06 };

/** The diagram body for one tour step: dimming, path glow and badges, selection ring. */
export function stepBodySvg(d: Diagram, f: FilterState, badgeScale = 1): string {
	const em = classify(d, f);
	const wrap = (id: string, svg: string) => {
		const o = OPACITY[em.get(id) ?? 'normal'];
		return o === 1 ? svg : g(svg, { opacity: o });
	};
	const edges = new Map(d.edges.map((e) => [e.id, e]));
	const path = f.path ?? [];
	const sel = f.selected ? [...d.nodes, ...d.frames].find((n) => n.id === f.selected) : undefined;
	const selEdge = f.selected ? edges.get(f.selected) : undefined;
	return (
		d.frames.map((x) => x.svg).join('') +
		path.map((id) => (edges.get(id) ? pathGlow(edges.get(id)!) : '')).join('') +
		(selEdge && !path.includes(selEdge.id) ? pathGlow(selEdge) : '') +
		`<g class="edges">${d.edges.map((e) => wrap(e.id, e.svg)).join('')}</g>` +
		d.nodes.map((n) => wrap(n.id, n.svg)).join('') +
		(sel ? selectionRing(sel.rect) : '') +
		d.edges.map((e) => (e.label ? wrap(e.id, e.label.svg) : '')).join('') +
		d.discs.map((x) => wrap(x.on, x.svg)).join('') +
		pathMarks(d, path, badgeScale)
			.map((m) => pathBadge(m, badgeScale))
			.join('')
	);
}
