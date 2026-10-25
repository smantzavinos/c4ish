import type { LayoutEdgeInput, LayoutEngine, LayoutNodeInput, LayoutPort, Rect } from '../layout/types.js';
import { ElkLayoutEngine } from '../layout/elk.js';
import type { Model, Note, Profile } from '../model/types.js';
import { FONT_FAMILY, measure, wrap } from '../text/measure.js';
import { drawEdgeLabel, drawEdgeLine, edgeStyle, Markers, measureEdgeLabel, type EdgeLabel, type EdgeStyle } from './edges.js';
import { renderLegend } from './legend.js';
import { hasDetails, measureAbsence, measureFrame, measureNode, newUsed, numberDisc, type DrawCtx, type FrameMeasure, type Measured } from './node.js';
import { buildScene, type Scene } from './scene.js';
import { C, S, T } from './theme.js';
import { el, esc, g, line, rect, text, translate } from './svg.js';

export interface RenderOptions {
	/** View id (default: first view). */
	view?: string;
	/** Layout engine (default: ELK layered). */
	engine?: LayoutEngine;
	/** Prefix for SVG ids, so several diagrams can be inlined in one page. */
	idPrefix?: string;
	/** Include the details/contracts footer (default true). */
	details?: boolean;
}

export interface RenderResult {
	svg: string;
	width: number;
	height: number;
	/** Geometry of the diagram area (absolute rects per element id), for tests and viewers. */
	geometry: { nodes: Map<string, Rect>; diagram: Rect };
	warnings: string[];
}

const KIND_LABEL: Record<NonNullable<Note['kind']>, string> = { focus: 'FOCUS', risk: 'RISK', note: 'NOTE', question: 'QUESTION' };

export async function renderView(model: Model, profile: Profile, options: RenderOptions = {}): Promise<RenderResult> {
	const scene = buildScene(model, profile, options.view);
	const engine = options.engine ?? new ElkLayoutEngine();
	const prefix = options.idPrefix ?? `c4-${scene.view.id}-`;
	const used = newUsed();
	const warnings: string[] = [];

	// ---- measure ----------------------------------------------------------------
	const leaf = new Map<string, Measured>();
	const frames = new Map<string, FrameMeasure>();
	for (const id of scene.order) {
		const n = scene.nodes.get(id)!;
		if (n.isFrame) frames.set(id, measureFrame(n, scene, used));
		else leaf.set(id, measureNode(n, scene, used));
	}
	for (const a of scene.absences) {
		leaf.set(a.id, measureAbsence(a.absence.text));
		used.absence = true;
	}

	const contractTags = new Map<string, string>();
	for (const r of scene.edges) if (r.contract && !contractTags.has(r.contract)) contractTags.set(r.contract, `C${contractTags.size + 1}`);
	const labels = new Map<string, EdgeLabel>();
	for (const r of scene.edges) {
		const l = measureEdgeLabel(r, r.contract ? contractTags.get(r.contract) : undefined);
		if (l) labels.set(r.id, l);
	}

	// ---- layout ------------------------------------------------------------------
	const direction = scene.view.direction ?? scene.notation.direction ?? 'right';
	const ports = new Map<string, LayoutPort[]>();
	const edgeInputs: LayoutEdgeInput[] = scene.edges.map((r) => {
		const e: LayoutEdgeInput = { id: r.id, source: r.from, target: r.to };
		const l = labels.get(r.id);
		if (l) e.label = { width: l.width, height: l.height };
		const addPort = (node: string, field: string, side: 'left' | 'right', suffix: string) => {
			const off = leaf.get(node)?.fieldOffsets?.get(field);
			if (off === undefined) return undefined;
			const pid = `${node}__${field}__${suffix}`;
			const list = ports.get(node) ?? [];
			if (!list.some((p) => p.id === pid)) list.push({ id: pid, side, offset: off });
			ports.set(node, list);
			return pid;
		};
		const fwd = direction === 'right' || direction === 'down';
		if (r.toField) e.targetPort = addPort(r.to, r.toField, fwd ? 'left' : 'right', 'in');
		if (r.fromField) e.sourcePort = addPort(r.from, r.fromField, fwd ? 'right' : 'left', 'out');
		return e;
	});
	const nodeInputs: LayoutNodeInput[] = [];
	for (const id of scene.order) {
		const n = scene.nodes.get(id)!;
		const f = frames.get(id);
		if (f) {
			nodeInputs.push({ id, parent: n.parent, width: f.minWidth, height: 0, minWidth: f.minWidth, padding: { top: f.headerHeight + 10, left: 20, right: 20, bottom: 20 } });
		} else {
			const m = leaf.get(id)!;
			nodeInputs.push({ id, parent: n.parent, width: m.width, height: m.height, ports: ports.get(id) });
		}
	}
	for (const a of scene.absences) {
		const m = leaf.get(a.id)!;
		nodeInputs.push({ id: a.id, parent: a.parent, width: m.width, height: m.height });
	}
	const layout = await engine.layout({ direction, nodes: nodeInputs, edges: edgeInputs, spacing: { node: 36, layer: 72, edge: 14 } });
	warnings.push(...layout.warnings);

	// ---- reading order: callout numbers and detail tags --------------------------
	const posOf = (id: string): Rect | undefined => layout.nodes.get(id) ?? layout.edges.get(id)?.label ?? midRect(layout.edges.get(id)?.points);
	const readingOrder = (a?: Rect, b?: Rect) => {
		if (!a || !b) return a ? -1 : b ? 1 : 0;
		const row = (r: Rect) => Math.round(r.y / 60);
		return row(a) - row(b) || a.x - b.x;
	};
	const notes = [...scene.notes].sort((a, b) => {
		if (!a.on || !b.on) return a.on ? -1 : b.on ? 1 : 0;
		return readingOrder(posOf(a.on), posOf(b.on));
	});
	const calloutNumbers = new Map<string, number[]>();
	notes.forEach((n, i) => {
		if (!n.on) return;
		calloutNumbers.set(n.on, [...(calloutNumbers.get(n.on) ?? []), i + 1]);
	});
	if (notes.length) used.callouts = true;
	const detailIds = scene.order.filter((id) => hasDetails(scene.nodes.get(id)!.el)).sort((a, b) => readingOrder(layout.nodes.get(a), layout.nodes.get(b)));
	const detailTags = new Map<string, string>();
	const showDetails = options.details !== false;
	if (showDetails) detailIds.forEach((id, i) => detailTags.set(id, tagFor(i)));
	else used.details = false;
	const ctx: DrawCtx = { scene, used, prefix, detailTags, calloutNumbers };

	// ---- draw diagram ---------------------------------------------------------------
	const markers = new Markers(prefix);
	const edgeStyles = new Map<string, EdgeStyle>();
	const parts: string[] = [];
	const frameIds = scene.order.filter((id) => frames.has(id)).sort((a, b) => scene.nodes.get(a)!.depth - scene.nodes.get(b)!.depth);
	for (const id of frameIds) {
		const r = layout.nodes.get(id)!;
		parts.push(frames.get(id)!.draw(r.x, r.y, r.width, r.height, ctx));
	}
	const styles = new Map(scene.edges.map((r) => [r.id, edgeStyle(r, scene)]));
	// quiet edges first, enforcement-coloured last so they sit on top
	const edgeOrder = [...scene.edges].sort((a, b) => styles.get(a.id)!.keyOrder - styles.get(b.id)!.keyOrder);
	const edgeSvg: string[] = [];
	for (const r of edgeOrder) {
		const geo = layout.edges.get(r.id);
		if (!geo) continue;
		const s = styles.get(r.id)!;
		edgeStyles.set(s.key, s);
		edgeSvg.push(drawEdgeLine(geo.points, s, markers));
	}
	parts.push(g(edgeSvg.join(''), { class: 'edges' }));
	for (const [id, m] of leaf) {
		const r = layout.nodes.get(id);
		if (r) parts.push(m.draw(r.x, r.y, ctx));
	}
	for (const r of edgeOrder) {
		const geo = layout.edges.get(r.id);
		const l = labels.get(r.id);
		if (geo?.label && l) parts.push(drawEdgeLabel(geo.label, l, styles.get(r.id)!, ctx, calloutNumbers.get(r.id)));
		else if (geo && calloutNumbers.has(r.id)) {
			const m = midRect(geo.points)!;
			parts.push(calloutNumbers.get(r.id)!.map((n, i) => numberDisc(m.x + i * 20, m.y, n, 8)).join(''));
		}
	}
	for (const [id, nums] of calloutNumbers) {
		const r = layout.nodes.get(id);
		if (!r) continue;
		parts.push(nums.map((n, i) => numberDisc(r.x + 2 + i * 20, r.y - 1, n)).join(''));
	}
	const diagramW = Math.ceil(layout.width);
	const diagramH = Math.ceil(layout.height);

	// ---- callouts -----------------------------------------------------------------------
	const cards = notes.map((n, i) => measureCallout(n, i + 1, scene));
	const calloutsRight = cards.length > 0 && diagramW / Math.max(diagramH, 1) <= 1.7;

	// ---- page composition ---------------------------------------------------------------
	const M = S.margin;
	let contentW = Math.max(diagramW + (calloutsRight ? 40 + S.calloutW : 0), 760);
	const legendProbe = renderLegend({ ctx, edgeStyles, markers, maxWidth: contentW });
	contentW = Math.max(contentW, legendProbe.width);

	const out: string[] = [];
	let y = M;
	// header
	out.push(text(M, y + 20, scene.view.title, { size: T.viewTitle, weight: 700, fill: C.ink }));
	y += 30;
	const viewSub = scene.view.subtitle;
	if (viewSub) {
		for (const l of wrap(viewSub, contentW, T.viewSubtitle, 'r', 2)) {
			out.push(text(M, y + 14, l, { size: T.viewSubtitle, fill: C.muted }));
			y += 19;
		}
	}
	y += 4;
	out.push(viewBadge(M, y, scene, contentW));
	y += 22;
	if (scene.view.focus?.length) {
		const f = focusCard(scene.view.focus, Math.min(contentW, 1040));
		out.push(g(f.svg, { transform: translate(M, y) }));
		y += f.height;
	}
	y += 20;
	const diagramY = y;
	out.push(g(parts.join(''), { transform: translate(M, diagramY), class: 'diagram' }));
	let bottom = diagramY + diagramH;

	if (cards.length) {
		if (calloutsRight) {
			let cy = diagramY;
			const cx = M + diagramW + 40;
			out.push(text(cx, cy + 9, 'NOTES', { size: 10.5, weight: 700, fill: C.muted, letterSpacing: 0.12 }));
			cy += 18;
			for (const c of cards) {
				out.push(g(c.svg, { transform: translate(cx, cy) }));
				cy += c.height + 12;
			}
			bottom = Math.max(bottom, cy);
		} else {
			let cy = bottom + 32;
			out.push(text(M, cy + 9, 'NOTES', { size: 10.5, weight: 700, fill: C.muted, letterSpacing: 0.12 }));
			cy += 18;
			const perRow = Math.max(1, Math.floor((contentW + 16) / (S.calloutW + 16)));
			for (let i = 0; i < cards.length; i += perRow) {
				const row = cards.slice(i, i + perRow);
				row.forEach((c, j) => out.push(g(c.svg, { transform: translate(M + j * (S.calloutW + 16), cy) })));
				cy += Math.max(...row.map((c) => c.height)) + 12;
			}
			bottom = cy;
		}
	}

	// legend
	const legend = renderLegend({ ctx, edgeStyles, markers, maxWidth: contentW });
	y = bottom + 36;
	out.push(line(M, y - 16, M + contentW, y - 16, { stroke: C.hairline, 'stroke-width': 1 }));
	out.push(g(legend.svg, { transform: translate(M, y) }));
	y += legend.height;

	// details & contracts
	if (showDetails) {
		const foot = renderFootnotes(scene, detailIds, detailTags, contractTags, contentW);
		if (foot.height) {
			y += 28;
			out.push(line(M, y - 14, M + contentW, y - 14, { stroke: C.hairline, 'stroke-width': 1 }));
			out.push(g(foot.svg, { transform: translate(M, y) }));
			y += foot.height;
		}
	}

	const width = Math.ceil(contentW + M * 2);
	const height = Math.ceil(y + M);
	const defs = `<defs>${hatchDef(prefix)}${markers.render()}</defs>`;
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(FONT_FAMILY)}" role="img" aria-label="${esc(scene.view.title)}">` +
		`<title>${esc(scene.view.title)}</title>` +
		defs +
		rect(0, 0, width, height, { fill: C.white }) +
		out.join('') +
		`</svg>`;

	const nodes = new Map<string, Rect>();
	for (const [id, r] of layout.nodes) nodes.set(id, { ...r, x: r.x + M, y: r.y + diagramY });
	return { svg, width, height, geometry: { nodes, diagram: { x: M, y: diagramY, width: diagramW, height: diagramH } }, warnings };
}

function tagFor(i: number): string {
	const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	return i < 26 ? A[i] : A[Math.floor(i / 26) - 1] + A[i % 26];
}

function midRect(points?: { x: number; y: number }[]): Rect | undefined {
	if (!points?.length) return undefined;
	const p = points[Math.floor(points.length / 2)];
	return { x: p.x, y: p.y, width: 0, height: 0 };
}

function hatchDef(prefix: string): string {
	return el(
		'pattern',
		{ id: `${prefix}hatch`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
		rect(0, 0, 5, 5, { fill: C.white }) + line(0, 0, 0, 5, { stroke: C.slate, 'stroke-width': 1.6 })
	);
}

function viewBadge(x: number, y: number, scene: Scene, maxW: number): string {
	const label = `${scene.notation.label.toUpperCase()} VIEW`;
	const w = measure(label, 9.5, 'b', 0.1) + 14;
	const r = scene.notation.corners === 'rounded' ? 8 : 1;
	const meaning = scene.notation.colour.meaning;
	return (
		rect(x, y, w, 16, { rx: r, fill: C.graphite }) +
		text(x + 7, y + 11.5, label, { size: 9.5, weight: 700, fill: C.white, letterSpacing: 0.1 }) +
		(scene.model.title && maxW > 0 ? text(x + w + 10, y + 12, `${scene.model.title} · ${meaning}`, { size: 11, fill: C.muted }) : '')
	);
}

function focusCard(items: string[], width: number): { svg: string; height: number } {
	const out: string[] = [];
	const inner = width - 36;
	let y = 30;
	for (const item of items) {
		const lines = wrap(item, inner, 12.5, 'r', 3);
		out.push(el('circle', { cx: 22, cy: y - 4, r: 2.2, fill: C.ink }));
		for (const l of lines) {
			out.push(text(30, y, l, { size: 12.5, fill: C.ink }));
			y += 18;
		}
		y += 3;
	}
	const height = y - 3 + 6;
	return {
		svg:
			rect(0, 0, width, height, { fill: C.surface, stroke: C.hairline, 'stroke-width': 1 }) +
			rect(0, 0, 4, height, { fill: C.ink }) +
			text(16, 17, 'REVIEW FOCUS', { size: 9.5, weight: 700, fill: C.slate, letterSpacing: 0.12 }) +
			out.join(''),
		height
	};
}

function measureCallout(n: Note, num: number, scene: Scene): { svg: string; height: number } {
	const W = S.calloutW;
	const inner = W - 24;
	const out: string[] = [];
	const kind = KIND_LABEL[n.kind ?? 'note'];
	const target = n.on ? (scene.elementsById.get(n.on)?.title ?? scene.edges.find((r) => r.id === n.on)?.label ?? n.on) : 'whole view';
	out.push(numberDisc(14, 14, num));
	out.push(text(30, 18, kind, { size: 9.5, weight: 700, fill: n.kind === 'risk' ? C.ink : C.slate, letterSpacing: 0.1 }));
	const kw = measure(kind, 9.5, 'b', 0.1);
	out.push(text(30 + kw + 8, 18, truncateTo(`· ${target}`, inner - kw - 20), { size: 10, fill: C.muted }));
	let y = 36;
	if (n.title) {
		for (const l of wrap(n.title, inner, T.calloutTitle, 'b', 2)) {
			out.push(text(12, y, l, { size: T.calloutTitle, weight: 700, fill: C.ink }));
			y += 16;
		}
		y += 2;
	}
	for (const l of wrap(n.text, inner, T.calloutBody, 'r', 10)) {
		out.push(text(12, y, l, { size: T.calloutBody, fill: C.slate }));
		y += 16;
	}
	const height = y - 4;
	return {
		svg:
			rect(0, 0, W, height, { fill: C.white, stroke: n.kind === 'risk' ? C.graphite : C.line, 'stroke-width': n.kind === 'risk' ? 1.5 : 1, rx: 2 }) + out.join(''),
		height
	};
}

function truncateTo(s: string, w: number): string {
	return wrap(s, w, 10, 'r', 1)[0] ?? '';
}

function renderFootnotes(scene: Scene, detailIds: string[], tags: Map<string, string>, contractTags: Map<string, string>, width: number): { svg: string; height: number } {
	type Entry = { tag: string; title: string; lines: { text: string; bold?: string }[] };
	const entries: Entry[] = [];
	for (const id of detailIds) {
		const e = scene.nodes.get(id)!.el;
		const d = Array.isArray(e.details) ? e.details : [e.details!];
		entries.push({ tag: tags.get(id)!, title: e.title, lines: d.map((t) => ({ text: t })) });
	}
	const contractEntries: Entry[] = [];
	for (const [cid, tag] of contractTags) {
		const c = scene.model.contracts?.find((x) => x.id === cid);
		if (!c) continue;
		contractEntries.push({ tag, title: c.title ?? c.id, lines: Object.entries(c.clauses).map(([k, v]) => ({ bold: k, text: v })) });
	}
	if (!entries.length && !contractEntries.length) return { svg: '', height: 0 };
	const colW = 380;
	const gap = 28;
	const cols = Math.max(1, Math.floor((width + gap) / (colW + gap)));
	const out: string[] = [];
	let y0 = 0;
	const section = (title: string, list: Entry[]) => {
		if (!list.length) return;
		out.push(text(0, y0 + 10, title, { size: 10.5, weight: 700, fill: C.muted, letterSpacing: 0.12 }));
		y0 += 22;
		const blocks = list.map((en) => {
			const parts: string[] = [];
			const tw = Math.max(16, measure(en.tag, 9.5, 'b') + 8);
			parts.push(rect(0, 0, tw, 15, { rx: 2, fill: C.white, stroke: C.faint }));
			parts.push(text(tw / 2, 11, en.tag, { size: 9.5, weight: 700, fill: C.muted, anchor: 'middle' }));
			parts.push(text(tw + 8, 11.5, en.title, { size: 11, weight: 700, fill: C.graphite }));
			let y = 30;
			for (const l of en.lines) {
				const prefix = l.bold ? `${l.bold}: ` : '';
				const pw = l.bold ? measure(prefix, T.footnote, 'b') : 0;
				const lines = wrap(l.text, colW - 8 - pw, T.footnote, 'r', 8);
				if (l.bold) parts.push(text(8, y, prefix, { size: T.footnote, weight: 700, fill: C.slate }));
				lines.forEach((t, i) => {
					parts.push(text(8 + (i === 0 ? pw : 0), y, t, { size: T.footnote, fill: C.slate }));
					y += 14.5;
				});
			}
			return { svg: parts.join(''), height: y - 6 };
		});
		// balance into columns in order
		const total = blocks.reduce((a, b) => a + b.height + 14, 0);
		const target = total / cols;
		let col = 0;
		let cy = 0;
		let maxY = 0;
		for (const b of blocks) {
			if (cy > 0 && cy + b.height / 2 > target && col < cols - 1) {
				col++;
				cy = 0;
			}
			out.push(g(b.svg, { transform: translate(col * (colW + gap), y0 + cy) }));
			cy += b.height + 14;
			maxY = Math.max(maxY, cy);
		}
		y0 += maxY + 10;
	};
	section('DETAILS', entries);
	section('CONTRACTS', contractEntries);
	return { svg: out.join(''), height: y0 };
}
