import { measure } from '../text/measure.js';
import type { EdgeStyle } from './edges.js';
import { drawEdgeLine, Markers } from './edges.js';
import { detailTag, drawChip as drawChipPublic, icon, numberDisc, padlock, patternChip, warningGlyph, type ChangeStyle, type DrawCtx, dashAttrs } from './node.js';
import { C } from './theme.js';
import { el, g, line, rect, text } from './svg.js';

interface Item {
	width: number;
	draw(x: number, y: number): string;
}

const ROW = 22;
const LABEL = 11;

function labelled(sampleW: number, sample: (x: number, y: number) => string, label: string, sub?: string): Item {
	const lw = measure(label, LABEL, 'r') + (sub ? measure(` ${sub}`, 10, 'r') : 0);
	return {
		width: sampleW + 8 + lw,
		draw: (x, y) =>
			sample(x, y) +
			text(x + sampleW + 8, y + 15, label, { size: LABEL, fill: C.graphite }) +
			(sub ? text(x + sampleW + 8 + measure(label, LABEL, 'r') + 4, y + 15, sub, { size: 10, fill: C.faint }) : '')
	};
}

function changeSample(style: ChangeStyle, corners: number): (x: number, y: number) => string {
	return (x, y) => {
		const w = 34;
		const h = 18;
		const band = style === 'new' ? C.inkBand : style === 'modified' ? C.modifiedBand : style === 'removed' ? C.surface : C.white;
		const stroke = style === 'new' ? C.ink : style === 'modified' ? C.graphite : style === 'removed' ? C.faint : C.line;
		const sw = style === 'new' ? 1.75 : style === 'modified' ? 1.5 : 1.1;
		return (
			rect(x, y + 2, w, h, { rx: corners, fill: C.white, stroke: 'none' }) +
			rect(x, y + 2, w, 9, { fill: band }) +
			rect(x, y + 2, w, h, { rx: corners, fill: 'none', stroke, 'stroke-width': sw, 'stroke-dasharray': style === 'removed' ? '4 3' : undefined }) +
			(style === 'removed' ? line(x + 6, y + 6.5, x + w - 6, y + 6.5, { stroke: C.faint, 'stroke-width': 1.2 }) : '')
		);
	};
}

export interface LegendInput {
	ctx: DrawCtx;
	edgeStyles: Map<string, EdgeStyle>;
	markers: Markers;
	maxWidth: number;
}

export function renderLegend({ ctx, edgeStyles, markers, maxWidth }: LegendInput): { svg: string; width: number; height: number } {
	const { scene, used } = ctx;
	const { profile, notation } = scene;
	const corners = notation.corners === 'rounded' ? 4 : 1;
	const groups: { title: string; items: Item[] }[] = [];

	// Change
	const changeOrder: ChangeStyle[] = ['new', 'modified', 'reused', 'removed'];
	const changeLabel = (s: ChangeStyle) => Object.values(profile.changeStates).find((c) => c.style === s)?.label ?? s;
	const changeItems = changeOrder.filter((s) => used.change.has(s)).map((s) => labelled(34, changeSample(s, corners), changeLabel(s)));
	if (changeItems.length) groups.push({ title: 'Change', items: changeItems });

	// Patterns
	const pats = [...used.patterns.entries()]
		.map(([id, n]) => ({ id, n, p: scene.patterns.get(id) }))
		.sort((a, b) => Number(b.p?.status === 'proposed') - Number(a.p?.status === 'proposed') || (a.p?.family ?? '').localeCompare(b.p?.family ?? '') || a.id.localeCompare(b.id));
	const patternItems: Item[] = pats.map(({ id, n, p }) => {
		const c = patternChip(p, id, profile, notation.colour.nodes === 'pattern', false);
		const sub = `${id}${n > 1 ? ` · ×${n}` : ''}`;
		return {
			width: c.width + 8 + measure(sub, 10, 'r'),
			draw: (x, y) => drawChipPublic(x, y + 2.5, c, ctx) + text(x + c.width + 8, y + 15, sub, { size: 10, fill: C.muted })
		};
	});
	if (used.partial)
		patternItems.push(
			labelled(18, (x, y) => el('circle', { cx: x + 9, cy: y + 11, r: 4.5, fill: C.white, stroke: C.graphite }) + el('path', { d: `M${x + 9} ${y + 6.5} A4.5 4.5 0 0 1 ${x + 9} ${y + 15.5} Z`, fill: C.graphite }), 'partial fit')
		);
	if (used.noPattern)
		patternItems.push(labelled(64, (x, y) => rect(x, y + 3, 64, 16, { rx: 3, fill: C.white, stroke: C.line, 'stroke-dasharray': '2 2' }) + text(x + 6, y + 14.5, 'no pattern', { size: 10, italic: true, fill: C.muted }), 'deliberately none'));
	if (patternItems.length) groups.push({ title: 'Patterns used', items: patternItems });

	// Connectors
	const edgeItems = [...edgeStyles.values()]
		.sort((a, b) => a.keyOrder - b.keyOrder || a.keyLabel.localeCompare(b.keyLabel))
		.map((s) =>
			labelled(
				44,
				(x, y) => drawEdgeLine([{ x, y: y + 11 }, { x: x + 42, y: y + 11 }], { ...s, opacity: 1, arrow: s.arrow === 'diamond' ? 'diamond' : s.arrow }, markers),
				s.keyLabel
			)
		);
	if (edgeItems.length) groups.push({ title: notation.colour.edges === 'enforcement' ? 'Connectors · colour = who enforces' : 'Connectors', items: edgeItems });

	// Areas
	const areaItems = [...used.areas].map((a) => {
		const def = profile.areas[a];
		return labelled(22, (x, y) => rect(x, y + 3, 22, 16, { rx: 4, fill: def.fill, stroke: def.colour, 'stroke-width': 1.5 }), def.label);
	});
	if (areaItems.length) groups.push({ title: 'Model area', items: areaItems });

	// Lifecycle
	const lcItems = [...used.lifecycle].map((id) => {
		const lc = profile.lifecycle[id];
		return labelled(
			34,
			(x, y) =>
				rect(x, y + 3, 34, 16, { rx: corners + 2, fill: lc.fill ?? C.white, stroke: lc.colour, 'stroke-width': 1.5, 'stroke-dasharray': lc.border === 'dashed' ? '4 3' : undefined }) +
				(lc.glyph === 'lock' ? padlock(x + 17, y + 10, lc.colour, 0.8) : ''),
			lc.label
		);
	});
	if (lcItems.length) groups.push({ title: 'Lifecycle', items: lcItems });

	// Markers
	const mk: Item[] = [];
	if (used.callouts) mk.push(labelled(18, (x, y) => numberDisc(x + 9, y + 11, 1, 8), 'callout — see notes'));
	if (used.divergence) mk.push(labelled(18, (x, y) => warningGlyph(x + 9, y + 11, profile.divergenceColour ?? '#be123c', 13), 'divergence — on the wrong element'));
	for (const enf of used.tie) {
		const def = profile.enforcement[enf];
		mk.push(
			labelled(
				18,
				(x, y) =>
					el('path', { d: `M${x + 6} ${y + 4} H${x + 12} V${y + 18} H${x + 6}`, fill: 'none', stroke: C.faint, 'stroke-width': 2.2 }) +
					(def ? line(x + 12.1, y + 7, x + 12.1, y + 15, { stroke: def.colour, 'stroke-width': 1.2, ...dashAttrs(def.line) }) : ''),
				'tie-bar — fields must agree',
				def ? `(${def.label})` : '(enforcement not stated)'
			)
		);
	}
	if (used.index) mk.push(labelled(18, (x, y) => rect(x + 6, y + 8.5, 5, 5, { fill: C.graphite }), 'field is in an index'));
	if (used.libraries.added || used.libraries.reused)
		mk.push(labelled(18, (x, y) => icon('library', x + 2, y + 4, 14, C.slate, 1.5), used.libraries.added ? 'library used inside (ink border + = new)' : 'library used inside'));
	if (used.details) mk.push(labelled(18, (x, y) => detailTag(x, y + 3.5, 'A', false), 'details below'));
	if (used.mapping) mk.push(labelled(18, (x, y) => icon('link', x + 3, y + 5, 12, C.muted, 1.4), 'implemented by (engineering)'));
	if (used.absence) mk.push(labelled(34, (x, y) => text(x, y + 15, 'none', { size: 11, italic: true, fill: C.faint }), 'stated absence'));
	if (mk.length) groups.push({ title: 'Markers', items: mk });

	if (!groups.length) return { svg: '', width: 0, height: 0 };

	// layout: columns, wrapping into rows of columns
	const out: string[] = [];
	const GAP = 36;
	let x = 0;
	let y = 30;
	let rowH = 0;
	let width = 0;
	out.push(text(0, 12, 'KEY', { size: 10.5, weight: 700, fill: C.muted, letterSpacing: 0.12 }));
	out.push(text(measure('KEY', 10.5, 'b', 0.12) + 10, 12, notation.colour.meaning, { size: 10.5, italic: true, fill: C.muted }));
	for (const grp of groups) {
		// split long groups into sub-columns of at most 8 rows
		const cols: Item[][] = [];
		for (let i = 0; i < grp.items.length; i += 8) cols.push(grp.items.slice(i, i + 8));
		const colWidths = cols.map((c) => Math.max(measure(grp.title.toUpperCase(), 9.5, 'b', 0.08), ...c.map((i) => i.width)));
		const gw = colWidths.reduce((a, b) => a + b + 20, -20);
		const gh = 18 + Math.max(...cols.map((c) => c.length)) * ROW;
		if (x > 0 && x + gw > maxWidth) {
			x = 0;
			y += rowH + 18;
			rowH = 0;
		}
		out.push(text(x, y + 10, grp.title.toUpperCase(), { size: 9.5, weight: 700, fill: C.slate, letterSpacing: 0.08 }));
		let cx = x;
		cols.forEach((c, ci) => {
			c.forEach((it, i) => out.push(it.draw(cx, y + 16 + i * ROW)));
			cx += colWidths[ci] + 20;
		});
		width = Math.max(width, x + gw);
		x += gw + GAP;
		rowH = Math.max(rowH, gh);
	}
	const height = y + rowH + 4;
	return { svg: g(out.join(''), {}), width, height };
}
