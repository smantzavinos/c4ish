import type { Relationship } from '../model/types.js';
import { divergenceId } from '../model/validate.js';
import type { Point, Rect } from '../layout/types.js';
import { measure, truncate, wrap } from '../text/measure.js';
import { changeStyle, dashAttrs, numberDisc, warningGlyph, type DrawCtx } from './node.js';
import type { Scene } from './scene.js';
import { C, T } from './theme.js';
import { el, fmt, g, line, rect, text } from './svg.js';

export interface EdgeStyle {
	stroke: string;
	width: number;
	line: string;
	arrow: 'filled' | 'open' | 'diamond' | 'none';
	opacity: number;
	strike: boolean;
	/** Legend identity: one row per key. */
	key: string;
	keyLabel: string;
	keyOrder: number;
}

export function edgeStyle(r: Relationship, scene: Scene): EdgeStyle {
	const { profile, notation } = scene;
	const kind = profile.relationshipKinds[r.kind];
	const cat = kind?.category ?? 'runtime';
	const arrow = kind?.arrow ?? 'filled';
	const cs = changeStyle(profile, r.change);
	const removed = cs === 'removed' || r.delta === 'removed';
	let s: EdgeStyle;
	if (cat === 'data') {
		const enf = r.enforcement ? profile.enforcement[r.enforcement] : undefined;
		if (!enf) {
			s = { stroke: C.missing, width: 1.75, line: 'dashed', arrow, opacity: 1, strike: false, key: 'enf:?', keyLabel: 'enforcement not stated (lint)', keyOrder: 19 };
		} else {
			const colour = notation.colour.edges === 'enforcement' ? enf.colour : notation.colour.edges === 'kind' ? (kind?.colour ?? C.graphite) : C.graphite;
			s = { stroke: colour, width: enf.width ?? 1.75, line: enf.line, arrow, opacity: 1, strike: false, key: `enf:${r.enforcement}`, keyLabel: enf.label, keyOrder: 10 + Object.keys(profile.enforcement).indexOf(r.enforcement!) / 100 };
		}
	} else if (cat === 'runtime') {
		s = { stroke: C.runtime, width: 1.25, line: kind?.line ?? 'solid', arrow, opacity: 1, strike: false, key: `kind:${r.kind}`, keyLabel: kind?.label ?? r.kind, keyOrder: 1 };
	} else if (cat === 'lifecycle') {
		s = { stroke: C.faint, width: 1.25, line: kind?.line ?? 'long-dash', arrow, opacity: 1, strike: false, key: `kind:${r.kind}`, keyLabel: kind?.label ?? r.kind, keyOrder: 30 };
	} else {
		const colour = notation.colour.edges === 'kind' ? (kind?.colour ?? C.graphite) : C.graphite;
		s = { stroke: colour, width: 1.6, line: kind?.line ?? 'solid', arrow, opacity: 1, strike: false, key: `kind:${r.kind}`, keyLabel: kind?.label ?? r.kind, keyOrder: 5 };
	}
	if (removed) {
		s = { ...s, stroke: C.faint, width: 1.25, line: 'dashed', strike: true, key: r.delta === 'removed' ? 'delta:removed' : 'removed', keyLabel: r.delta === 'removed' ? 'removed in this scenario' : 'removed connector', keyOrder: 40 };
	} else if (r.delta === 'added') {
		s = { ...s, width: s.width + 1.25 };
	} else if (cs === 'reused' && !(cat === 'data' && r.enforcement && profile.enforcement[r.enforcement]?.line === 'dotted') && !r.divergence) {
		s = { ...s, opacity: 0.55 };
	}
	return s;
}

export interface EdgeLabel {
	lines: string[];
	width: number;
	height: number;
	prefix?: string;
	contractTag?: string;
	divergence?: string;
}

const LABEL_MAX = 168;
const LABEL_LINE = 13;

export function measureEdgeLabel(r: Relationship, contractTag: string | undefined): EdgeLabel | undefined {
	const dv = divergenceId(r.divergence);
	if (!r.label && !contractTag && !dv && !r.delta) return undefined;
	const lines = r.label ? wrap(r.label, LABEL_MAX, T.edgeLabel, 'm', 2) : [];
	const prefix = r.delta === 'added' ? '+' : r.delta === 'removed' ? '−' : undefined;
	let extra = 0;
	if (prefix) extra += 16;
	if (dv) extra += 16 + measure(dv, 10, 'b');
	if (contractTag) extra += measure(contractTag, 9, 'b') + 12;
	const textW = Math.max(0, ...lines.map((l) => measure(l, T.edgeLabel, 'm')));
	return {
		lines,
		width: Math.ceil(textW + extra + 10),
		height: Math.max(1, lines.length) * LABEL_LINE + 6,
		prefix,
		contractTag,
		divergence: dv
	};
}

function roundedPath(points: Point[], radius = 6): string {
	if (points.length < 2) return '';
	let d = `M${fmt(points[0].x)} ${fmt(points[0].y)}`;
	for (let i = 1; i < points.length - 1; i++) {
		const p0 = points[i - 1];
		const p1 = points[i];
		const p2 = points[i + 1];
		const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
		const d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
		const rr = Math.min(radius, d1 / 2, d2 / 2);
		const a = { x: p1.x - ((p1.x - p0.x) / d1) * rr, y: p1.y - ((p1.y - p0.y) / d1) * rr };
		const b = { x: p1.x + ((p2.x - p1.x) / d2) * rr, y: p1.y + ((p2.y - p1.y) / d2) * rr };
		d += ` L${fmt(a.x)} ${fmt(a.y)} Q${fmt(p1.x)} ${fmt(p1.y)} ${fmt(b.x)} ${fmt(b.y)}`;
	}
	const last = points[points.length - 1];
	d += ` L${fmt(last.x)} ${fmt(last.y)}`;
	return d;
}

/** Arrow marker ids, created on demand per (shape, colour). */
export class Markers {
	private defs = new Map<string, string>();
	constructor(private prefix: string) {}
	id(shape: 'filled' | 'open' | 'diamond', colour: string): string {
		const id = `${this.prefix}m-${shape}-${colour.replace(/[^a-z0-9]/gi, '')}`;
		if (!this.defs.has(id)) {
			let body: string;
			if (shape === 'filled') body = el('path', { d: 'M0 0 L10 5 L0 10 z', fill: colour });
			else if (shape === 'open') body = el('path', { d: 'M1 1 L9 5 L1 9', fill: 'none', stroke: colour, 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
			else body = el('path', { d: 'M1 5 L5.5 1.5 L10 5 L5.5 8.5 z', fill: C.white, stroke: colour, 'stroke-width': 1.3 });
			this.defs.set(
				id,
				el('marker', { id, viewBox: '0 0 10 10', refX: shape === 'diamond' ? 1 : 9, refY: 5, markerWidth: shape === 'diamond' ? 11 : 7, markerHeight: shape === 'diamond' ? 11 : 7, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, body)
			);
		}
		return id;
	}
	render(): string {
		return [...this.defs.values()].join('');
	}
}

export function drawEdgeLine(points: Point[], s: EdgeStyle, markers: Markers, reverseDiamond = false): string {
	const d = roundedPath(points);
	const markerAttrs: Record<string, string> = {};
	if (s.arrow === 'diamond') markerAttrs['marker-start'] = `url(#${markers.id('diamond', s.stroke)})`;
	else if (s.arrow !== 'none') markerAttrs['marker-end'] = `url(#${markers.id(s.arrow, s.stroke)})`;
	void reverseDiamond;
	if (s.line === 'double') {
		return g(
			el('path', { d, fill: 'none', stroke: s.stroke, 'stroke-width': s.width + 3, ...markerAttrs }) +
				el('path', { d, fill: 'none', stroke: C.white, 'stroke-width': s.width - 0.5 }),
			{ opacity: s.opacity < 1 ? s.opacity : undefined }
		);
	}
	return el('path', {
		d,
		fill: 'none',
		stroke: s.stroke,
		'stroke-width': s.width,
		'stroke-linejoin': 'round',
		opacity: s.opacity < 1 ? s.opacity : undefined,
		...dashAttrs(s.line),
		...markerAttrs
	});
}

export function drawEdgeLabel(box: Rect, lbl: EdgeLabel, s: EdgeStyle, ctx: DrawCtx, callouts: number[] | undefined): string {
	const out: string[] = [];
	const { profile } = ctx.scene;
	out.push(rect(box.x, box.y, box.width, box.height, { rx: 3, fill: C.white, opacity: 0.94, stroke: C.hairline, 'stroke-width': 0.75 }));
	let x = box.x + 5;
	const midY = box.y + box.height / 2;
	if (lbl.prefix) {
		const fill = lbl.prefix === '+' ? C.ink : C.faint;
		out.push(el('circle', { cx: x + 6, cy: midY, r: 6, fill }));
		out.push(text(x + 6, midY + 3.8, lbl.prefix, { size: 11, weight: 700, fill: C.white, anchor: 'middle' }));
		x += 16;
	}
	if (lbl.divergence) {
		const colour = profile.divergenceColour ?? '#be123c';
		out.push(warningGlyph(x + 5.5, midY, colour, 11));
		out.push(text(x + 13, midY + 3.5, lbl.divergence, { size: 10, weight: 700, fill: colour }));
		x += 16 + measure(lbl.divergence, 10, 'b');
	}
	const top = box.y + 3 + LABEL_LINE - 3;
	const fg = s.strike ? C.faint : C.graphite;
	lbl.lines.forEach((l, i) => {
		const by = top + i * LABEL_LINE;
		out.push(text(x, by, l, { size: T.edgeLabel, weight: 500, fill: fg }));
		if (s.strike) out.push(line(x, by - 3.6, x + measure(l, T.edgeLabel, 'm') / 1.03, by - 3.6, { stroke: fg, 'stroke-width': 1 }));
	});
	if (lbl.contractTag) {
		const tw = measure(lbl.contractTag, 9, 'b') + 8;
		const cx = box.x + box.width - tw - 4;
		out.push(rect(cx, midY - 7, tw, 14, { rx: 2, fill: C.surface, stroke: C.faint, 'stroke-width': 0.75 }));
		out.push(text(cx + tw / 2, midY + 3.2, lbl.contractTag, { size: 9, weight: 700, fill: C.slate, anchor: 'middle' }));
	}
	(callouts ?? []).forEach((n, i) => out.push(numberDisc(box.x - 4 - i * 20, box.y - 2, n, 8)));
	return out.join('');
}

export { truncate };
