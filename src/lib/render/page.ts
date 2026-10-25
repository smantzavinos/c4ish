import type { LayoutEngine, LayoutResult, Rect } from '../layout/types.js';
import type { Model, Note, Profile } from '../model/types.js';
import { FONT_FAMILY, measure, wrap } from '../text/measure.js';
import { buildDiagram, diagramBodySvg, type Diagram } from './diagram.js';
import { renderLegendSvg } from './legend.js';
import { numberDisc } from './node.js';
import type { Scene } from './scene.js';
import { staticBadgeScale, stepBodySvg, TOUR } from './tour.js';
import type { FilterState } from '../viewer/state.js';
import { C, S, T } from './theme.js';
import { el, esc, g, rect, text, translate } from './svg.js';

export interface RenderOptions {
	/** View id (default: first view). */
	view?: string;
	/** Layout engine (default: ELK layered). */
	engine?: LayoutEngine;
	/** Prefix for SVG ids, so several diagrams can be inlined in one page. */
	idPrefix?: string;
	/**
	 * Also produce the appendix (details and contracts as markdown) and draw lettered detail tags
	 * on cards that have details (default false: the page is diagram-first).
	 */
	appendix?: boolean;
	/** Geometry override hook (future pinned-layout sidecar). */
	override?: (layout: LayoutResult) => LayoutResult;
	/** Render one tour step: caption instead of the review focus, the step's dimming, path and selection. */
	tour?: TourRender;
}

export interface TourRender {
	tourTitle: string;
	stepTitle: string;
	/** Plain-text narration (paragraphs separated by blank lines, `- ` bullets). */
	body?: string;
	/** 1-based step number and step count. */
	index: number;
	total: number;
	filter: FilterState;
}

export interface RenderResult {
	svg: string;
	width: number;
	height: number;
	/** Geometry of the diagram area (absolute rects per element id), for tests and viewers. */
	geometry: { nodes: Map<string, Rect>; diagram: Rect };
	/** The structured diagram (diagram-space coordinates). */
	diagram: Diagram;
	/** Markdown appendix (details, contracts, notes) when `appendix` was requested. */
	appendix?: string;
	warnings: string[];
}

const KIND_LABEL: Record<NonNullable<Note['kind']>, string> = { focus: 'FOCUS', risk: 'RISK', note: 'NOTE', question: 'QUESTION' };
const SIDE_W = 330;
const SIDE_GAP = 48;

export async function renderView(model: Model, profile: Profile, options: RenderOptions = {}): Promise<RenderResult> {
	const d = await buildDiagram(model, profile, { view: options.view, engine: options.engine, idPrefix: options.idPrefix, detailTags: options.appendix, override: options.override });
	const { scene } = d;
	const M = S.margin;
	const diagramW = d.width;
	const diagramH = d.height;

	// during a tour step, notes the step does not name recede (all of them when it names none)
	const spot = new Set(options.tour?.filter.notes ?? []);
	const noteKey = (n: Note) => n.id ?? `note:${(model.notes ?? []).indexOf(n) + 1}`;
	const cards = d.notes.map((n) => {
		const c = measureCallout(n.note, n.num, scene);
		return options.tour && !spot.has(noteKey(n.note)) ? { ...c, svg: g(c.svg, { opacity: 0.35 }) } : c;
	});
	const key = renderLegendSvg(d.legend, SIDE_W);
	// Side column (notes, then key) unless the diagram is very wide; then they go below in columns.
	const side = diagramW / Math.max(diagramH, 1) <= 2.4;
	const contentW = Math.max(side ? diagramW + SIDE_GAP + SIDE_W : diagramW, 900);

	const out: string[] = [];
	let y = M;
	out.push(text(M, y + 22, scene.view.title, { size: T.viewTitle, weight: 700, fill: C.ink }));
	y += 34;
	if (scene.view.subtitle) {
		for (const l of wrap(scene.view.subtitle, Math.min(contentW, 1100), T.viewSubtitle, 'r', 2)) {
			out.push(text(M, y + 14, l, { size: T.viewSubtitle, fill: C.muted }));
			y += 20;
		}
	}
	y += 4;
	out.push(viewBadge(M, y, scene, contentW));
	y += 24;
	if (options.tour) {
		const f = stepCaption(options.tour, Math.min(contentW, 1100));
		out.push(g(f.svg, { transform: translate(M, y) }));
		y += f.height;
	} else if (scene.view.focus?.length) {
		const f = focusCard(scene.view.focus, Math.min(contentW, 1100));
		out.push(g(f.svg, { transform: translate(M, y) }));
		y += f.height;
	}
	y += 24;
	const diagramY = y;
	out.push(g(options.tour ? stepBodySvg(d, options.tour.filter, staticBadgeScale(d.width, d.height)) : diagramBodySvg(d), { transform: translate(M, diagramY), class: 'diagram' }));
	let bottom = diagramY + diagramH;

	const column = (x: number, y0: number, withKey: boolean): number => {
		let cy = y0;
		if (cards.length) {
			out.push(text(x, cy + 10, 'NOTES', { size: 10.5, weight: 700, fill: C.muted, letterSpacing: 0.12 }));
			cy += 20;
			for (const c of cards) {
				out.push(g(c.svg, { transform: translate(x, cy) }));
				cy += c.height + 12;
			}
			cy += 16;
		}
		if (withKey && key.height) {
			out.push(g(key.svg, { transform: translate(x, cy) }));
			cy += key.height;
		}
		return cy;
	};
	if (side) {
		bottom = Math.max(bottom, column(M + diagramW + SIDE_GAP, diagramY, true));
	} else {
		let cy = bottom + 36;
		const perRow = Math.max(1, Math.floor((contentW + 16) / (S.calloutW + 16)));
		if (cards.length) {
			out.push(text(M, cy + 10, 'NOTES', { size: 10.5, weight: 700, fill: C.muted, letterSpacing: 0.12 }));
			cy += 20;
			for (let i = 0; i < cards.length; i += perRow) {
				const row = cards.slice(i, i + perRow);
				row.forEach((c, j) => out.push(g(c.svg, { transform: translate(M + j * (S.calloutW + 16), cy) })));
				cy += Math.max(...row.map((c) => c.height)) + 12;
			}
			cy += 16;
		}
		out.push(g(key.svg, { transform: translate(M, cy) }));
		bottom = cy + key.height;
	}

	const width = Math.ceil(contentW + M * 2);
	const height = Math.ceil(bottom + M);
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(FONT_FAMILY)}" role="img" aria-label="${esc(scene.view.title)}">` +
		`<title>${esc(scene.view.title)}</title>` +
		`<defs>${d.defs}</defs>` +
		rect(0, 0, width, height, { fill: C.white }) +
		out.join('') +
		`</svg>`;

	const nodes = new Map<string, Rect>();
	for (const it of [...d.frames, ...d.nodes]) nodes.set(it.id, { ...it.rect, x: it.rect.x + M, y: it.rect.y + diagramY });
	return {
		svg,
		width,
		height,
		geometry: { nodes, diagram: { x: M, y: diagramY, width: diagramW, height: diagramH } },
		diagram: d,
		appendix: options.appendix ? renderAppendix(d) : undefined,
		warnings: d.warnings
	};
}

/** Details, contracts and notes as markdown — the long text that does not belong on the page. */
export function renderAppendix(d: Diagram): string {
	const { scene } = d;
	const lines: string[] = [`# ${scene.view.title} — appendix`, ''];
	if (scene.model.title) lines.push(`Model: ${scene.model.title} · view \`${scene.view.id}\``, '');
	if (d.notes.length) {
		lines.push('## Notes', '');
		for (const { num, note } of d.notes) {
			const on = note.on ? ` (on ${scene.elementsById.get(note.on)?.title ?? note.on})` : '';
			lines.push(`${num}. **${KIND_LABEL[note.kind ?? 'note']}${note.title ? ` — ${note.title}` : ''}**${on}: ${note.text}`);
		}
		lines.push('');
	}
	if (d.detailTags.size) {
		lines.push('## Details', '');
		for (const [id, tag] of d.detailTags) {
			const e = scene.elementsById.get(id)!;
			lines.push(`### ${tag} · ${e.title}`, '');
			for (const t of Array.isArray(e.details) ? e.details : [e.details!]) lines.push(`- ${t}`);
			lines.push('');
		}
	}
	const relDetails = d.edges.filter((e) => e.rel.details);
	if (relDetails.length) {
		lines.push('## Connector details', '');
		for (const e of relDetails) {
			const from = scene.elementsById.get(e.from)?.title ?? e.from;
			const to = scene.elementsById.get(e.to)?.title ?? e.to;
			lines.push(`### ${from} → ${to}${e.rel.label ? ` (${e.rel.label})` : ''}`, '');
			for (const t of Array.isArray(e.rel.details) ? e.rel.details : [e.rel.details!]) lines.push(`- ${t}`);
			lines.push('');
		}
	}
	if (d.contractTags.size) {
		lines.push('## Contracts', '');
		for (const [cid, tag] of d.contractTags) {
			const c = scene.model.contracts?.find((x) => x.id === cid);
			if (!c) continue;
			lines.push(`### ${tag} · ${c.title ?? c.id}`, '');
			for (const [k, v] of Object.entries(c.clauses)) lines.push(`- **${k}:** ${v}`);
			lines.push('');
		}
	}
	return lines.join('\n');
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

function stepCaption(t: TourRender, width: number): { svg: string; height: number } {
	const out: string[] = [];
	const inner = width - 36;
	out.push(text(16, 18, `TOUR · ${t.index} / ${t.total} · ${t.tourTitle.toUpperCase()}`, { size: 9.5, weight: 700, fill: TOUR, letterSpacing: 0.12 }));
	let y = 42;
	for (const l of wrap(t.stepTitle, inner, 17, 'b', 2)) {
		out.push(text(16, y, l, { size: 17, weight: 700, fill: C.ink }));
		y += 22;
	}
	y += 2;
	for (const para of (t.body ?? '').split(/\n\s*\n/)) {
		for (const raw of para.split('\n')) {
			if (!raw.trim()) continue;
			const bullet = /^\s*[-*]\s+/.test(raw);
			const line = raw.replace(/^\s*[-*]\s+/, '').trim();
			const x = bullet ? 30 : 16;
			if (bullet) out.push(el('circle', { cx: 22, cy: y - 4, r: 2.2, fill: C.ink }));
			for (const l of wrap(line, inner - (x - 16), 13, 'r', 4)) {
				out.push(text(x, y, l, { size: 13, fill: C.graphite }));
				y += 19;
			}
		}
		y += 5;
	}
	const height = y + 4;
	return {
		svg: rect(0, 0, width, height, { fill: '#eff6ff', stroke: '#bfdbfe', 'stroke-width': 1 }) + rect(0, 0, 4, height, { fill: TOUR }) + out.join(''),
		height
	};
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

