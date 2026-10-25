import { measure, wrap } from '../text/measure.js';
import type { EdgeStyle } from './edges.js';
import { drawEdgeLine, Markers } from './edges.js';
import { drawBadge, hatchFill, icon, numberDisc, padlock, shade, tint, warningGlyph, dashAttrs, type ChangeStyle, type DrawCtx } from './node.js';
import { C } from './theme.js';
import { el, g, line, rect, text, translate } from './svg.js';

/**
 * The key, as data. The static page lays it out as SVG; the viewer renders it as HTML with the
 * same swatches and uses `filter` to highlight matching diagram items.
 */
export interface LegendItem {
	/** Stable id, unique within the legend. */
	id: string;
	label: string;
	/** Secondary text (e.g. pattern id). */
	sub?: string;
	/** How many diagram items carry this (patterns). */
	count?: number;
	/** SVG fragment drawn in a `swatchW × 20` box at the origin. */
	swatch: string;
	swatchW: number;
	/** Filter key this item toggles in the viewer (see viewer/state.ts). */
	filter?: string;
}

export interface LegendSection {
	id: 'patterns' | 'change' | 'edges' | 'areas' | 'lifecycle' | 'markers';
	title: string;
	items: LegendItem[];
}

export interface Legend {
	/** One-line statement of what colour means in this view. */
	meaning: string;
	sections: LegendSection[];
}

export interface LegendInput {
	ctx: DrawCtx;
	edgeStyles: Map<string, EdgeStyle>;
	markers: Markers;
}

/** A miniature card: header tint + left band in the identity colour; change channel on the border. */
function cardSwatch(ctx: DrawCtx, opts: { colour?: string; proposed?: boolean; none?: boolean; change?: ChangeStyle }): string {
	const w = 30;
	const h = 18;
	const y = 1;
	const colour = opts.colour;
	let header: string = colour ? tint(colour, 0.15) : C.surface;
	let band: string = colour ?? C.line;
	if (opts.proposed) {
		header = hatchFill(ctx, colour ?? C.slate, 'light');
		band = hatchFill(ctx, colour ?? C.slate, 'strong');
	}
	if (opts.none) {
		header = C.white;
		band = C.white;
	}
	const ch = opts.change ?? 'new';
	const stroke = ch === 'reused' ? C.faint : ch === 'removed' ? C.slate : colour && !opts.change ? shade(colour, 0.1) : C.ink;
	const sw = ch === 'reused' ? 1 : ch === 'removed' ? 1.4 : 1.25;
	return g(
		rect(0, y, w, h, { rx: 2, fill: ch === 'removed' ? C.surface : C.white }) +
			rect(0, y, w, 8, { fill: header }) +
			rect(0, y, 4, h, { fill: band }) +
			(opts.none ? line(4, y, 4, y + h, { stroke: C.faint, 'stroke-dasharray': '2 2' }) : '') +
			rect(0, y, w, h, { rx: 2, fill: 'none', stroke, 'stroke-width': sw, 'stroke-dasharray': ch === 'removed' || opts.none ? '3 2' : undefined }) +
			(ch === 'removed' ? line(8, y + 13, w - 4, y + 13, { stroke: C.slate, 'stroke-width': 1.2 }) : ''),
		{ opacity: ch === 'reused' ? 0.5 : undefined }
	);
}

export function buildLegend({ ctx, edgeStyles, markers }: LegendInput): Legend {
	const { scene, used } = ctx;
	const { profile, notation } = scene;
	const sections: LegendSection[] = [];
	const patternColours = notation.colour.nodes === 'pattern';

	// Patterns (engineering: node colour = pattern)
	const pats = [...used.patterns.entries()]
		.map(([id, n]) => ({ id, n, p: scene.patterns.get(id) }))
		.sort(
			(a, b) =>
				Number(b.p?.status === 'proposed') - Number(a.p?.status === 'proposed') ||
				(a.p?.family ?? '').localeCompare(b.p?.family ?? '') ||
				a.id.localeCompare(b.id)
		);
	const chipSwatch = (iconName: string | undefined, colour: string) =>
		rect(0.5, 3.5, 29, 14, { rx: 3, fill: C.surface, stroke: C.hairline }) + (iconName ? icon(iconName, 9, 4.5, 12, colour, 1.5) : '');
	const patItems: LegendItem[] = pats.map(({ id, n, p }) => {
		const fam = p ? profile.patternFamilies[p.family] : undefined;
		const colour = patternColours ? (p?.colour ?? fam?.colour) : undefined;
		const proposed = p?.status === 'proposed';
		const primary = used.primary.has(id);
		return {
			id: `pattern:${id}`,
			label: `${proposed ? 'Proposed · ' : ''}${p?.label ?? id}${primary ? '' : ' (tag only)'}`,
			sub: fam?.label,
			count: n,
			swatch: primary ? cardSwatch(ctx, { colour, proposed }) : chipSwatch(p?.icon ?? fam?.icon, C.muted),
			swatchW: 30,
			filter: `pattern:${id}`
		};
	});
	// cards first, tag-only patterns after
	patItems.sort((a, b) => Number(a.label.endsWith('(tag only)')) - Number(b.label.endsWith('(tag only)')));
	if (used.noPattern) patItems.push({ id: 'pattern:none', label: 'No pattern (deliberate)', swatch: cardSwatch(ctx, { none: true }), swatchW: 30, filter: 'pattern:none' });
	if (used.partial)
		patItems.push({
			id: 'pattern:partial',
			label: 'Partial fit',
			swatch: el('circle', { cx: 15, cy: 10, r: 5, fill: C.white, stroke: C.graphite, 'stroke-width': 1.2 }) + el('path', { d: 'M15 5 A5 5 0 0 1 15 15 Z', fill: C.graphite }),
			swatchW: 30
		});
	if (patItems.length) sections.push({ id: 'patterns', title: patternColours ? 'Card colour = pattern' : 'Patterns', items: patItems });

	// Areas (product: node colour = model area)
	const areaItems: LegendItem[] = [...used.areas].map((a) => ({
		id: `area:${a}`,
		label: profile.areas[a].label,
		swatch: cardSwatch(ctx, { colour: profile.areas[a].colour }),
		swatchW: 30,
		filter: `area:${a}`
	}));
	if (areaItems.length) sections.push({ id: 'areas', title: 'Card colour = model area', items: areaItems });

	// Edges
	// Connectors that look identical share one row ("calls · saves · subscribes").
	const groups = new Map<string, EdgeStyle[]>();
	for (const s of [...edgeStyles.values()].sort((a, b) => a.keyOrder - b.keyOrder || a.keyLabel.localeCompare(b.keyLabel))) {
		const sig = `${s.stroke}|${s.width}|${s.line}|${s.arrow}|${s.strike}`;
		groups.set(sig, [...(groups.get(sig) ?? []), s]);
	}
	const edgeItems: LegendItem[] = [...groups.values()].map((list) => {
		const s = list[0];
		return {
			id: `edge:${s.key}`,
			label: list.map((x) => x.keyLabel).join(' · '),
			swatch: drawEdgeLine([{ x: 0, y: 10 }, { x: 34, y: 10 }], { ...s, opacity: 1 }, markers),
			swatchW: 38,
			filter: list.map((x) => `edge:${x.key}`).join(',')
		};
	});
	if (edgeItems.length) sections.push({ id: 'edges', title: notation.colour.edges === 'enforcement' ? 'Line colour = who enforces' : 'Connectors', items: edgeItems });

	// Change
	const changeOrder: ChangeStyle[] = ['new', 'modified', 'removed', 'reused'];
	const changeLabel = (s: ChangeStyle) => Object.values(profile.changeStates).find((c) => c.style === s)?.label ?? s;
	const changeItems: LegendItem[] = changeOrder
		.filter((s) => used.change.has(s))
		.map((s) => {
			const badge = s === 'reused' ? '' : changeLabel(s).toUpperCase();
			return {
				id: `change:${s}`,
				label: s === 'reused' ? `${changeLabel(s)} — faded context` : changeLabel(s),
				swatch: s === 'reused' ? cardSwatch(ctx, { change: s }) : g(drawBadge(0, 0, badge, s), { transform: `${translate(0, 2)} scale(0.85)` }),
				swatchW: s === 'reused' ? 30 : Math.ceil((measure(badge, 9.5, 'b', 0.06) + 12) * 0.85),
				filter: `change:${s}`
			};
		});
	if (changeItems.length) sections.push({ id: 'change', title: 'Change (badge + border)', items: changeItems });

	// Lifecycle
	const lcItems: LegendItem[] = [...used.lifecycle].map((id) => {
		const lc = profile.lifecycle[id];
		return {
			id: `lifecycle:${id}`,
			label: lc.label,
			swatch:
				rect(0, 2, 30, 16, { rx: 3, fill: lc.fill ?? C.white, stroke: lc.colour, 'stroke-width': 1.5, 'stroke-dasharray': lc.border === 'dashed' ? '4 3' : undefined }) +
				(lc.glyph === 'lock' ? padlock(15, 9, lc.colour, 0.8) : ''),
			swatchW: 30,
			filter: `lifecycle:${id}`
		};
	});
	if (lcItems.length) sections.push({ id: 'lifecycle', title: 'Lifecycle', items: lcItems });

	// Markers
	const mk: LegendItem[] = [];
	const marker = (id: string, label: string, swatch: string, sub?: string) => mk.push({ id: `marker:${id}`, label, sub, swatch, swatchW: 22 });
	if (used.callouts) marker('callout', 'Callout — see notes', numberDisc(10, 10, 1, 8));
	if (used.divergence) marker('divergence', 'Divergence — on the wrong element', warningGlyph(10, 10, profile.divergenceColour ?? '#be123c', 13));
	for (const enf of used.tie) {
		const def = profile.enforcement[enf];
		marker(
			`tie-${enf}`,
			'Tie-bar — fields must agree',
			el('path', { d: 'M6 3 H12 V17 H6', fill: 'none', stroke: C.faint, 'stroke-width': 2.2 }) +
				(def ? line(12.1, 6, 12.1, 14, { stroke: def.colour, 'stroke-width': 1.2, ...dashAttrs(def.line) }) : ''),
			def ? def.label : 'enforcement not stated'
		);
	}
	if (used.index) marker('index', 'Field is in an index', rect(7, 7.5, 5, 5, { fill: C.graphite }));
	if (used.libraries.added || used.libraries.reused) marker('library', used.libraries.added ? 'Library used inside (+ = new)' : 'Library used inside', icon('library', 2, 3, 14, C.slate, 1.5));
	if (used.details) marker('details', 'Details in appendix', rect(1, 3, 16, 15, { rx: 2, fill: C.white, stroke: C.faint }) + text(9, 14, 'A', { size: 9.5, weight: 700, fill: C.muted, anchor: 'middle' }));
	if (used.mapping) marker('mapping', 'Implemented by (engineering)', icon('link', 3, 4, 12, C.muted, 1.4));
	if (used.absence) marker('absence', 'Stated absence', text(0, 14, 'none', { size: 10.5, italic: true, fill: C.faint }));
	if (mk.length) sections.push({ id: 'markers', title: 'Markers', items: mk });

	return { meaning: notation.colour.meaning, sections };
}

const ROW = 22;
const LABEL = 11.5;

/** Lay the key out as a single column of `width` (used beside the diagram). */
export function renderLegendSvg(legend: Legend, width: number): { svg: string; width: number; height: number } {
	if (!legend.sections.length) return { svg: '', width: 0, height: 0 };
	const out: string[] = [];
	let y = 0;
	out.push(text(0, 12, 'KEY', { size: 10.5, weight: 700, fill: C.muted, letterSpacing: 0.12 }));
	y += 20;
	for (const l of wrap(legend.meaning, width, 11, 'i', 3)) {
		out.push(text(0, y + 2, l, { size: 11, italic: true, fill: C.muted }));
		y += 15;
	}
	y += 6;
	for (const s of legend.sections) {
		out.push(text(0, y + 10, s.title.toUpperCase(), { size: 9.5, weight: 700, fill: C.slate, letterSpacing: 0.08 }));
		y += 16;
		for (const it of s.items) {
			const sw = Math.max(it.swatchW, 30);
			const tx = sw + 8;
			const count = it.count && it.count > 1 ? ` ×${it.count}` : '';
			const lines = wrap(it.label + count, width - tx, LABEL, 'r', 2);
			out.push(g(it.swatch, { transform: translate(0, y) }));
			lines.forEach((t, i) => out.push(text(tx, y + 14 + i * 15, t, { size: LABEL, fill: C.graphite })));
			y += Math.max(ROW, lines.length * 15 + 7);
			if (it.sub && s.id === 'edges') {
				// edge subs are rare; skip
			}
		}
		y += 8;
	}
	return { svg: g(out.join(''), {}), width, height: y };
}

/** The KEY inline (for wide layouts): sections side by side, wrapping into rows. */
export function legendMeasureWidth(legend: Legend): number {
	let w = 0;
	for (const s of legend.sections) for (const it of s.items) w = Math.max(w, Math.max(it.swatchW, 30) + 8 + measure(`${it.label} ×99`, LABEL, 'r'));
	return Math.ceil(w);
}
