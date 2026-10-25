import type { LayoutEdgeInput, LayoutEngine, LayoutNodeInput, LayoutPort, LayoutResult, Point, Rect } from '../layout/types.js';
import { ElkLayoutEngine } from '../layout/elk.js';
import type { Element, Model, Note, Profile, Relationship } from '../model/types.js';
import { drawEdgeLabel, drawEdgeLine, edgeStyle, Markers, measureEdgeLabel, type EdgeLabel, type EdgeStyle } from './edges.js';
import { placeLabels, routeStats } from './labels.js';
import { buildLegend, type Legend } from './legend.js';
import { hasDetails, hatchDefs, measureAbsence, measureFrame, measureNode, newUsed, numberDisc, type DrawCtx, type FrameMeasure, type Measured } from './node.js';
import { buildScene, type Scene } from './scene.js';

/**
 * A positioned, drawn diagram — the shared intermediate between the static page renderer and the
 * interactive viewer. Every item carries its own SVG fragment (absolute coordinates in diagram
 * space) so a viewer can wrap each one in an interactive element without re-implementing drawing.
 */
export interface DiagramItem {
	id: string;
	kind: 'frame' | 'node' | 'absence';
	rect: Rect;
	depth: number;
	parent?: string;
	el?: Element;
	svg: string;
}

export interface DiagramEdge {
	id: string;
	from: string;
	to: string;
	rel: Relationship;
	points: Point[];
	style: EdgeStyle;
	svg: string;
	label?: { rect: Rect; svg: string };
}

export interface DiagramNote {
	num: number;
	note: Note;
}

export interface Diagram {
	scene: Scene;
	prefix: string;
	width: number;
	height: number;
	direction: 'right' | 'down' | 'left' | 'up';
	/** Frames sorted outermost first. */
	frames: DiagramItem[];
	nodes: DiagramItem[];
	/** Quiet edges first, enforcement-coloured last. */
	edges: DiagramEdge[];
	/** Callout number discs (drawn above everything). */
	discs: { on: string; svg: string }[];
	notes: DiagramNote[];
	legend: Legend;
	/** <defs> content: markers, hatches. */
	defs: string;
	/** Element ids with details, in reading order, with their letter tags. */
	detailTags: Map<string, string>;
	contractTags: Map<string, string>;
	warnings: string[];
}

export interface DiagramOptions {
	view?: string;
	engine?: LayoutEngine;
	idPrefix?: string;
	/** Draw lettered detail tags on cards (when an appendix/panel lists the details). */
	detailTags?: boolean;
	/**
	 * Geometry override hook: receives the engine result and may move nodes / re-route edges
	 * (future pinned-layout sidecar). Must return absolute geometry in the same shape.
	 */
	override?: (layout: LayoutResult) => LayoutResult;
}

type Dir = 'right' | 'down' | 'left' | 'up';

export async function buildDiagram(model: Model, profile: Profile, options: DiagramOptions = {}): Promise<Diagram> {
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
	const run = async (direction: Dir, extraLayer = 0): Promise<LayoutResult> => {
		const ports = new Map<string, LayoutPort[]>();
		const edgeInputs: LayoutEdgeInput[] = scene.edges.map((r) => {
			const e: LayoutEdgeInput = { id: r.id, source: r.from, target: r.to };
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
			if (f) nodeInputs.push({ id, parent: n.parent, width: f.minWidth, height: 0, minWidth: f.minWidth, padding: { top: f.headerHeight + 12, left: 20, right: 20, bottom: 20 } });
			else {
				const m = leaf.get(id)!;
				nodeInputs.push({ id, parent: n.parent, width: m.width, height: m.height, ports: ports.get(id) });
			}
		}
		for (const a of scene.absences) {
			const m = leaf.get(a.id)!;
			nodeInputs.push({ id: a.id, parent: a.parent, width: m.width, height: m.height });
		}
		// Labels are placed after routing (see labels.ts); layer spacing leaves room for them.
		const maxLabelH = Math.max(0, ...[...labels.values()].map((l) => l.height));
		const maxLabelW = Math.max(0, ...[...labels.values()].map((l) => l.width));
		let layer = direction === 'down' || direction === 'up' ? Math.max(64, maxLabelH + 40) : Math.max(72, Math.min(maxLabelW, 180) + 36);
		layer += extraLayer;
		return engine.layout({ direction, nodes: nodeInputs, edges: edgeInputs, spacing: { node: 32, layer, edge: 14 } });
	};

	const wanted = scene.view.direction ?? scene.notation.direction ?? 'auto';
	let direction: Dir;
	let layout: LayoutResult;
	if (wanted === 'auto') {
		const [down, right] = await Promise.all([run('down'), run('right')]);
		const sd = layoutScore(down);
		const sr = layoutScore(right);
		[direction, layout] = sd <= sr ? ['down', down] : ['right', right];
	} else {
		direction = wanted;
		layout = await run(direction);
	}
	const styles = new Map(scene.edges.map((r) => [r.id, edgeStyle(r, scene)]));
	const edgeOrder = [...scene.edges].sort((a, b) => styles.get(a.id)!.keyOrder - styles.get(b.id)!.keyOrder);
	const place = (l: LayoutResult) => {
		const leafRects = [...leaf.keys()].map((id) => l.nodes.get(id)).filter((r): r is Rect => !!r);
		const headers = [...frames.entries()].map(([id, f]) => {
			const r = l.nodes.get(id)!;
			return { x: r.x, y: r.y, width: r.width, height: f.headerHeight };
		});
		const edgePts = new Map<string, Point[]>();
		for (const [id, geo] of l.edges) edgePts.set(id, geo.points);
		return placeLabels(
			[...edgeOrder]
				.reverse()
				.filter((r) => labels.has(r.id) && l.edges.has(r.id))
				.map((r) => ({ id: r.id, points: l.edges.get(r.id)!.points, width: labels.get(r.id)!.width, height: labels.get(r.id)!.height })),
			{ nodes: leafRects, headers, edges: edgePts }
		);
	};
	if (options.override) layout = options.override(layout);
	let labelBoxes = place(layout);
	// Crowded inter-layer bands: open them up and try again (bounded).
	for (let extra = 36; !options.override && (labelBoxes.collisions ?? 0) > 0 && extra <= 72; extra += 36) {
		const retry = await run(direction, extra);
		const boxes = place(retry);
		if ((boxes.collisions ?? 0) < (labelBoxes.collisions ?? 0)) {
			layout = retry;
			labelBoxes = boxes;
		}
	}
	warnings.push(...layout.warnings);

	// ---- reading order: callout numbers and detail tags --------------------------
	const posOf = (id: string): Rect | undefined => layout.nodes.get(id) ?? labelBoxes.get(id) ?? midRect(layout.edges.get(id)?.points);
	const readingOrder = (a?: Rect, b?: Rect) => {
		if (!a || !b) return a ? -1 : b ? 1 : 0;
		const row = (r: Rect) => Math.round(r.y / 60);
		return row(a) - row(b) || a.x - b.x;
	};
	const sortedNotes = [...scene.notes].sort((a, b) => {
		if (!a.on || !b.on) return a.on ? -1 : b.on ? 1 : 0;
		return readingOrder(posOf(a.on), posOf(b.on));
	});
	const calloutNumbers = new Map<string, number[]>();
	sortedNotes.forEach((n, i) => {
		if (n.on) calloutNumbers.set(n.on, [...(calloutNumbers.get(n.on) ?? []), i + 1]);
	});
	if (sortedNotes.length) used.callouts = true;
	const detailIds = scene.order.filter((id) => hasDetails(scene.nodes.get(id)!.el)).sort((a, b) => readingOrder(layout.nodes.get(a), layout.nodes.get(b)));
	const detailTags = new Map<string, string>();
	if (options.detailTags) detailIds.forEach((id, i) => detailTags.set(id, tagFor(i)));
	else used.details = false;
	const ctx: DrawCtx = { scene, used, prefix, detailTags, calloutNumbers, hatches: new Map() };

	// ---- draw ---------------------------------------------------------------------
	const markers = new Markers(prefix);
	const edgeStyles = new Map<string, EdgeStyle>();
	const frameItems: DiagramItem[] = [...frames.keys()]
		.sort((a, b) => scene.nodes.get(a)!.depth - scene.nodes.get(b)!.depth)
		.map((id) => {
			const r = layout.nodes.get(id)!;
			const n = scene.nodes.get(id)!;
			return { id, kind: 'frame', rect: r, depth: n.depth, parent: n.parent, el: n.el, svg: frames.get(id)!.draw(r.x, r.y, r.width, r.height, ctx) };
		});
	const absenceParent = new Map(scene.absences.map((a) => [a.id, a.parent]));
	const nodeItems: DiagramItem[] = [];
	for (const [id, m] of leaf) {
		const r = layout.nodes.get(id);
		if (!r) continue;
		const n = scene.nodes.get(id);
		nodeItems.push({ id, kind: n ? 'node' : 'absence', rect: r, depth: n?.depth ?? 0, parent: n?.parent ?? absenceParent.get(id), el: n?.el, svg: m.draw(r.x, r.y, ctx) });
	}
	const edges: DiagramEdge[] = [];
	for (const r of edgeOrder) {
		const geo = layout.edges.get(r.id);
		if (!geo) continue;
		const s = styles.get(r.id)!;
		edgeStyles.set(s.key, s);
		const l = labels.get(r.id);
		const box = labelBoxes.get(r.id);
		edges.push({
			id: r.id,
			from: r.from,
			to: r.to,
			rel: r,
			points: geo.points,
			style: s,
			svg: drawEdgeLine(geo.points, s, markers),
			label: l && box ? { rect: box, svg: drawEdgeLabel(box, l, s, ctx, undefined) } : undefined
		});
	}
	const discs: { on: string; svg: string }[] = [];
	for (const [id, nums] of calloutNumbers) {
		const r = layout.nodes.get(id);
		if (r) {
			discs.push({ on: id, svg: nums.map((n, i) => numberDisc(r.x + 2 + i * 22, r.y - 1, n)).join('') });
			continue;
		}
		const lb = labelBoxes.get(id) ?? midRect(layout.edges.get(id)?.points);
		if (lb) discs.push({ on: id, svg: nums.map((n, i) => numberDisc(lb.x - 4 - i * 22, lb.y - 2, n, 9)).join('') });
	}
	const legend = buildLegend({ ctx, edgeStyles, markers });
	const defs = hatchDefs(ctx) + markers.render();

	return {
		scene,
		prefix,
		width: Math.ceil(layout.width),
		height: Math.ceil(layout.height),
		direction,
		frames: frameItems,
		nodes: nodeItems,
		edges,
		discs,
		notes: sortedNotes.map((note, i) => ({ num: i + 1, note })),
		legend,
		defs,
		detailTags,
		contractTags,
		warnings
	};
}

/** Lower is better: bends and length, plus a penalty for very wide or very tall pages. */
export function layoutScore(l: LayoutResult): number {
	const { bends, length } = routeStats([...l.edges.values()].map((e) => e.points));
	const aspect = l.width / Math.max(1, l.height);
	const aspectPenalty = Math.abs(Math.log(aspect / 1.3)) * 1500;
	const sizePenalty = Math.max(l.width - 2400, 0) * 2 + Math.max(l.height - 2000, 0) * 2;
	return bends * 40 + length * 0.5 + aspectPenalty + sizePenalty;
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

/** The diagram body as one SVG group string (frames, edges, cards, labels, discs). */
export function diagramBodySvg(d: Diagram): string {
	return (
		d.frames.map((f) => f.svg).join('') +
		`<g class="edges">${d.edges.map((e) => e.svg).join('')}</g>` +
		d.nodes.map((n) => n.svg).join('') +
		d.edges.map((e) => e.label?.svg ?? '').join('') +
		d.discs.map((x) => x.svg).join('')
	);
}
