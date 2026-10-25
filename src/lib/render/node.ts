import type { Element, PatternDef, Profile } from '../model/types.js';
import { divergenceId } from '../model/validate.js';
import { measure, truncate, wrap, type FontStyle } from '../text/measure.js';
import { iconPath } from './icons.js';
import type { Scene, SceneNode } from './scene.js';
import { C, S, T } from './theme.js';
import { el, esc, fmt, g, line, rect, text, translate } from './svg.js';

export type ChangeStyle = 'new' | 'modified' | 'reused' | 'removed';

/** What the legend needs to know was drawn. */
export interface Used {
	change: Set<ChangeStyle>;
	patterns: Map<string, number>;
	/** Patterns that give at least one card its colour (the rest only appear as chips). */
	primary: Set<string>;
	noPattern: boolean;
	partial: boolean;
	lifecycle: Set<string>;
	divergence: boolean;
	tie: Set<string>;
	index: boolean;
	libraries: { reused: boolean; added: boolean };
	callouts: boolean;
	details: boolean;
	absence: boolean;
	areas: Set<string>;
	mapping: boolean;
}

export function newUsed(): Used {
	return {
		change: new Set(),
		patterns: new Map(),
		primary: new Set(),
		noPattern: false,
		partial: false,
		lifecycle: new Set(),
		divergence: false,
		tie: new Set(),
		index: false,
		libraries: { reused: false, added: false },
		callouts: false,
		details: false,
		absence: false,
		areas: new Set(),
		mapping: false
	};
}

export interface DrawCtx {
	scene: Scene;
	used: Used;
	prefix: string;
	/** Details tag letters, assigned after layout. */
	detailTags: Map<string, string>;
	/** Callout numbers per target id. */
	calloutNumbers: Map<string, number[]>;
	/** Hatch fills used (key `colour|density` → pattern id); emitted into <defs>. */
	hatches: Map<string, string>;
}

export function changeStyle(profile: Profile, change: string | undefined): ChangeStyle {
	return (change && profile.changeStates[change]?.style) || 'reused';
}

function changeBadge(profile: Profile, change: string | undefined): string | undefined {
	if (!change) return undefined;
	const def = profile.changeStates[change];
	if (!def) return undefined;
	return def.badge ?? (def.style === 'reused' ? undefined : def.label.toUpperCase());
}

export function hasDetails(e: Element): boolean {
	return !!e.details && (Array.isArray(e.details) ? e.details.length > 0 : e.details.trim().length > 0);
}

/* ------------------------------------------------------------------------- */
/* Chips                                                                       */
/* ------------------------------------------------------------------------- */

type ChipKind = 'pattern' | 'proposed' | 'nopattern' | 'lifecycle' | 'divergence' | 'lib' | 'libnew' | 'secondary';

export interface Chip {
	kind: ChipKind;
	text: string;
	icon?: string;
	colour?: string;
	fill?: string;
	dashed?: boolean;
	partial?: boolean;
	lock?: boolean;
	strike?: boolean;
	width: number;
}

const CHIP_PAD = 6;
const CHIP_ICON = 11;

function chip(c: Omit<Chip, 'width'>): Chip {
	const style: FontStyle = c.kind === 'nopattern' ? 'i' : c.kind === 'lib' || c.kind === 'libnew' || c.kind === 'secondary' ? 'm' : 's';
	let w = CHIP_PAD * 2 + measure(c.text, T.chip, style);
	if (c.icon || c.lock || c.kind === 'divergence') w += CHIP_ICON + 3;
	if (c.partial) w += 12;
	return { ...c, width: Math.ceil(w) };
}

export function patternChip(p: PatternDef | undefined, id: string, profile: Profile, colourNodes: boolean, partial: boolean): Chip {
	const fam = p ? profile.patternFamilies[p.family] : undefined;
	const icon = p?.icon ?? fam?.icon ?? 'component';
	if (p?.status === 'proposed') {
		return chip({ kind: 'proposed', text: `PROPOSED · ${p.label}`, icon, colour: colourNodes ? fam?.colour : undefined, partial });
	}
	return chip({ kind: 'pattern', text: p?.label ?? id, icon, colour: colourNodes ? fam?.colour : undefined, partial });
}

export function drawChip(x: number, y: number, c: Chip, ctx: DrawCtx, onDark = false): string {
	const h = S.chipH;
	const parts: string[] = [];
	const colour = c.colour ?? C.graphite;
	let stroke: string = C.line;
	let fill: string = C.white;
	let fg: string = C.graphite;
	let dash: string | undefined;
	let weight = 600;
	let italic = false;
	switch (c.kind) {
		case 'pattern':
			stroke = c.colour ?? C.faint;
			fill = c.colour ? tint(c.colour, 0.1) : C.surface;
			fg = c.colour ?? C.graphite;
			break;
		case 'proposed':
			stroke = c.colour ?? C.ink;
			fill = `url(#${ctx.prefix}hatch)`;
			fg = c.colour ?? C.ink;
			dash = '3 2';
			weight = 700;
			break;
		case 'nopattern':
			stroke = C.line;
			fg = C.muted;
			dash = '2 2';
			weight = 400;
			italic = true;
			break;
		case 'lifecycle':
			stroke = c.colour ?? C.slate;
			fill = c.fill ?? C.white;
			fg = c.colour ?? C.slate;
			dash = c.dashed ? '3 2' : undefined;
			break;
		case 'divergence':
			stroke = c.colour ?? '#be123c';
			fill = tint(c.colour ?? '#be123c', 0.08);
			fg = c.colour ?? '#be123c';
			weight = 700;
			break;
		case 'lib':
			stroke = C.line;
			fill = C.white;
			fg = C.slate;
			weight = 500;
			break;
		case 'libnew':
			stroke = C.ink;
			fill = C.white;
			fg = C.ink;
			weight = 500;
			break;
		case 'secondary':
			stroke = C.hairline;
			fill = C.surface;
			fg = C.muted;
			weight = 500;
			break;
	}
	if (onDark) {
		stroke = 'rgba(255,255,255,0.5)';
	}
	parts.push(rect(x + 0.5, y + 0.5, c.width - 1, h - 1, { rx: 3, fill, stroke, 'stroke-width': 1, 'stroke-dasharray': dash }));
	if (c.kind === 'proposed') {
		// solid white behind the text keeps hatched chips legible
		const tw = measure(c.text, T.chip, 'b');
		parts.push(rect(x + CHIP_PAD + CHIP_ICON + 1, y + 3, tw + 4, h - 6, { fill: C.white }));
	}
	let tx = x + CHIP_PAD;
	if (c.kind === 'divergence') {
		parts.push(warningGlyph(tx + 5.5, y + h / 2 + 0.5, fg, 11));
		tx += CHIP_ICON + 3;
	} else if (c.lock) {
		parts.push(padlock(tx + 5.5, y + h / 2 - 1, fg, 0.8));
		tx += CHIP_ICON + 3;
	} else if (c.icon) {
		parts.push(icon(c.icon, tx, y + (h - CHIP_ICON) / 2, CHIP_ICON, fg, 1.6));
		tx += CHIP_ICON + 3;
	}
	parts.push(text(tx, y + h / 2 + 3.5, c.text, { size: T.chip, weight, fill: fg, italic }));
	if (c.strike) parts.push(line(tx, y + h / 2, tx + measure(c.text, T.chip, 'm'), y + h / 2, { stroke: fg, 'stroke-width': 1 }));
	if (c.partial) {
		const cx = x + c.width - CHIP_PAD - 4.5;
		const cy = y + h / 2;
		parts.push(el('circle', { cx, cy, r: 4, fill: C.white, stroke: fg, 'stroke-width': 1 }));
		parts.push(el('path', { d: `M${fmt(cx)} ${fmt(cy - 4)} A4 4 0 0 1 ${fmt(cx)} ${fmt(cy + 4)} Z`, fill: fg }));
	}
	return parts.join('');
}

function layoutChips(chips: Chip[], maxW: number): { rows: Chip[][]; height: number } {
	const rows: Chip[][] = [];
	let row: Chip[] = [];
	let w = 0;
	for (const c of chips) {
		if (row.length && w + S.chipGap + c.width > maxW) {
			rows.push(row);
			row = [];
			w = 0;
		}
		w += (row.length ? S.chipGap : 0) + c.width;
		row.push(c);
	}
	if (row.length) rows.push(row);
	return { rows, height: rows.length ? rows.length * S.chipH + (rows.length - 1) * S.chipGap : 0 };
}

/* ------------------------------------------------------------------------- */
/* Glyphs                                                                      */
/* ------------------------------------------------------------------------- */

export function icon(name: string, x: number, y: number, size: number, colour: string, width = 1.5): string {
	return el('path', {
		d: iconPath(name),
		transform: `${translate(x, y)} scale(${fmt(size / 16)})`,
		fill: 'none',
		stroke: colour,
		'stroke-width': fmt((width * 16) / size),
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round'
	});
}

/** Padlock centred at (cx, cy) — drawn, never an emoji. */
export function padlock(cx: number, cy: number, colour: string, scale = 1): string {
	return g(
		el('path', { d: 'M-3.2,0 v-2.6 a3.2,3.2 0 0,1 6.4,0 v2.6', fill: 'none', stroke: colour, 'stroke-width': 1.6 }) +
			rect(-5, 0, 10, 7.5, { rx: 1.5, fill: colour }),
		{ transform: `${translate(cx, cy - 2)} scale(${fmt(scale)})` }
	);
}

export function warningGlyph(cx: number, cy: number, colour: string, size = 12): string {
	const h = size * 0.9;
	const w = size;
	return g(
		el('path', {
			d: `M0 ${fmt(-h / 2)} L${fmt(w / 2)} ${fmt(h / 2)} L${fmt(-w / 2)} ${fmt(h / 2)} Z`,
			fill: colour,
			stroke: colour,
			'stroke-width': 1,
			'stroke-linejoin': 'round'
		}) +
			line(0, -h / 2 + 3.2, 0, h / 2 - 3.6, { stroke: C.white, 'stroke-width': 1.4, 'stroke-linecap': 'round' }) +
			el('circle', { cx: 0, cy: h / 2 - 1.8, r: 0.8, fill: C.white }),
		{ transform: translate(cx, cy) }
	);
}

export function numberDisc(cx: number, cy: number, n: number | string, r = 9): string {
	return (
		el('circle', { cx, cy, r, fill: C.ink, stroke: C.white, 'stroke-width': 2 }) +
		text(cx, cy + 3.6, String(n), { size: 10, weight: 700, fill: C.white, anchor: 'middle' })
	);
}

export function detailTag(x: number, y: number, tag: string, onDark: boolean): string {
	const w = Math.max(16, measure(tag, 9.5, 'b') + 8);
	return (
		rect(x, y, w, 15, { rx: 2, fill: onDark ? 'rgba(255,255,255,0.12)' : C.white, stroke: onDark ? 'rgba(255,255,255,0.55)' : C.faint, 'stroke-width': 1 }) +
		text(x + w / 2, y + 11, tag, { size: 9.5, weight: 700, fill: onDark ? C.white : C.muted, anchor: 'middle' })
	);
}

export function tint(hex: string, alpha: number): string {
	const h = hex.replace('#', '');
	const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
	const n = parseInt(full, 16);
	const mix = (c: number) => Math.round(255 - (255 - c) * alpha);
	const r = mix((n >> 16) & 255);
	const gg = mix((n >> 8) & 255);
	const b = mix(n & 255);
	return `#${((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1)}`;
}

/* ------------------------------------------------------------------------- */
/* Node card                                                                   */
/* ------------------------------------------------------------------------- */

export interface Measured {
	width: number;
	height: number;
	draw(x: number, y: number, ctx: DrawCtx): string;
	/** Offsets of field rows from the node top (for ports). */
	fieldOffsets?: Map<string, number>;
}

const BADGE_FONT = 9.5;

export function badgeWidth(label: string | undefined): number {
	return label ? Math.ceil(measure(label, BADGE_FONT, 'b', 0.06) + 12) : 0;
}

/** Change badge: NEW solid ink, MODIFIED outlined ink, REMOVED solid graphite. */
export function drawBadge(x: number, y: number, label: string, style: ChangeStyle): string {
	const w = badgeWidth(label);
	const h = 17;
	let fill: string = C.ink;
	let stroke: string = C.ink;
	let fg: string = C.white;
	if (style === 'modified') {
		fill = C.white;
		fg = C.ink;
	} else if (style === 'removed') {
		fill = C.slate;
		stroke = C.slate;
	} else if (style === 'reused') {
		fill = C.white;
		stroke = C.line;
		fg = C.muted;
	}
	return (
		rect(x, y, w, h, { rx: 2, fill, stroke, 'stroke-width': 1.25 }) +
		text(x + w / 2, y + 12, label, { size: BADGE_FONT, weight: 700, fill: fg, anchor: 'middle', letterSpacing: 0.06 })
	);
}

/** Darken a hex colour towards black (f = 0 → unchanged, 1 → black). */
export function shade(hex: string, f: number): string {
	const h = hex.replace('#', '');
	const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
	const n = parseInt(full, 16);
	const mix = (c: number) => Math.round(c * (1 - f));
	return `#${((1 << 24) | (mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255)).toString(16).slice(1)}`;
}

/** Hatch fill in a given colour; registered in ctx so the page can emit <defs>. */
export function hatchFill(ctx: DrawCtx, colour: string, density: 'light' | 'strong' = 'light'): string {
	const key = `${colour}|${density}`;
	let id = ctx.hatches.get(key);
	if (!id) {
		id = `${ctx.prefix}hatch-${colour.replace(/[^a-z0-9]/gi, '')}-${density}`;
		ctx.hatches.set(key, id);
	}
	return `url(#${id})`;
}

export function hatchDefs(ctx: DrawCtx): string {
	return [...ctx.hatches.entries()]
		.map(([key, id]) => {
			const [colour, density] = key.split('|');
			const bg = density === 'light' ? tint(colour, 0.06) : C.white;
			const stroke = density === 'light' ? tint(colour, 0.38) : colour;
			return el(
				'pattern',
				{ id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
				rect(0, 0, 6, 6, { fill: bg }) + line(0, 0, 0, 6, { stroke, 'stroke-width': density === 'light' ? 2.2 : 1.6 })
			);
		})
		.join('');
}

/** What gives a card its identity: the pattern (engineering) or the model area (product). */
export interface Identity {
	colour?: string;
	/** Small-caps line above the title. */
	label?: string;
	icon: string;
	proposed: boolean;
	/** Deliberately no pattern. */
	none: boolean;
	partial: boolean;
}

export function identity(n: SceneNode, scene: Scene): Identity {
	const { profile, notation } = scene;
	const e = n.el;
	const kindDef = profile.elementKinds[e.kind];
	const kindIcon = kindDef?.icon ?? 'component';
	const p = e.pattern ? scene.patterns.get(e.pattern) : undefined;
	const fam = p ? profile.patternFamilies[p.family] : undefined;
	const partial = e.patternFit === 'partial';
	if (notation.colour.nodes === 'area') {
		const area = n.area ? profile.areas[n.area] : undefined;
		return { colour: area?.colour, label: (kindDef?.label ?? e.kind).toUpperCase(), icon: kindIcon, proposed: false, none: false, partial };
	}
	if (e.pattern === null) return { label: 'NO PATTERN', icon: kindIcon, proposed: false, none: true, partial };
	if (!e.pattern) return { icon: kindIcon, proposed: false, none: false, partial };
	const colour = notation.colour.nodes === 'pattern' ? (p?.colour ?? fam?.colour) : undefined;
	const name = (p?.label ?? e.pattern).toUpperCase();
	return {
		colour,
		label: p?.status === 'proposed' ? `PROPOSED · ${name}` : name,
		icon: p?.icon ?? fam?.icon ?? kindIcon,
		proposed: p?.status === 'proposed',
		none: false,
		partial
	};
}

interface CardStyle {
	border: string;
	borderWidth: number;
	dash?: string;
	fill: string;
	title: string;
	body: string;
	strike: boolean;
	/** Whole-card opacity (reused context recedes). */
	opacity: number;
}

function cardStyle(n: SceneNode, scene: Scene): CardStyle {
	const { profile } = scene;
	const style = changeStyle(profile, n.el.change);
	const base: CardStyle = { border: C.ink, borderWidth: 1.5, fill: C.white, title: C.ink, body: C.slate, strike: false, opacity: 1 };
	if (style === 'reused') Object.assign(base, { border: C.faint, borderWidth: 1, opacity: 0.5 });
	else if (style === 'removed') Object.assign(base, { border: C.slate, borderWidth: 1.75, dash: '6 4', fill: C.surface, title: C.slate, body: C.muted, strike: true });
	if (style !== 'removed' && n.el.lifecycle) {
		const lc = profile.lifecycle[n.el.lifecycle];
		if (lc) {
			base.border = lc.colour;
			base.dash = lc.border === 'dashed' ? '6 4' : undefined;
			base.borderWidth = Math.max(base.borderWidth, 1.75);
			if (lc.fill) base.fill = lc.fill;
		}
	}
	return base;
}

function elementChips(n: SceneNode, scene: Scene, used: Used, includeLifecycle = true, includePrimary = false): Chip[] {
	const { profile, notation } = scene;
	const e = n.el;
	const chips: Chip[] = [];
	const colourNodes = notation.colour.nodes === 'pattern';
	if (e.pattern) {
		const p = scene.patterns.get(e.pattern);
		if (includePrimary) chips.push(patternChip(p, e.pattern, profile, colourNodes, e.patternFit === 'partial'));
		used.primary.add(e.pattern);
		used.patterns.set(e.pattern, (used.patterns.get(e.pattern) ?? 0) + 1);
		if (e.patternFit === 'partial') used.partial = true;
	} else if (e.pattern === null) {
		if (includePrimary) chips.push(chip({ kind: 'nopattern', text: 'no pattern' }));
		used.noPattern = true;
	}
	for (const pid of e.patterns ?? []) {
		const p = scene.patterns.get(pid);
		chips.push(chip({ kind: 'secondary', text: p?.label ?? pid, icon: p?.icon }));
		used.patterns.set(pid, (used.patterns.get(pid) ?? 0) + 1);
	}
	if (includeLifecycle && e.lifecycle && profile.lifecycle[e.lifecycle]) {
		const lc = profile.lifecycle[e.lifecycle];
		chips.push(chip({ kind: 'lifecycle', text: lc.label, colour: lc.colour, fill: lc.fill, dashed: lc.border === 'dashed', lock: lc.glyph === 'lock' }));
		used.lifecycle.add(e.lifecycle);
	}
	const dv = divergenceId(e.divergence);
	if (dv) {
		chips.push(chip({ kind: 'divergence', text: dv, colour: profile.divergenceColour }));
		used.divergence = true;
	}
	return chips;
}

function libraryChips(n: SceneNode, scene: Scene, used: Used): Chip[] {
	const chips: Chip[] = [];
	for (const id of n.el.libraries ?? []) {
		const lib = scene.elementsById.get(id);
		if (!lib) continue;
		const style = changeStyle(scene.profile, lib.change);
		const name = lib.version ? `${lib.title} ${lib.version}` : lib.title;
		if (style === 'new') used.libraries.added = true;
		else used.libraries.reused = true;
		chips.push(chip({ kind: style === 'new' ? 'libnew' : 'lib', text: style === 'new' ? `${name} +` : name, icon: 'library', strike: style === 'removed' }));
	}
	return chips;
}

function mappingText(e: Element, scene: Scene): string | undefined {
	if (e.mappingLabel) return e.mappingLabel;
	if (!e.implementedBy?.length) return undefined;
	return e.implementedBy.map((id) => scene.elementsById.get(id)?.title ?? id).join(' + ');
}

const BAND = 7;
const ICON = 18;
const TITLE_LH = 18;

/** Measure a leaf card; returns size and a draw closure. */
export function measureNode(n: SceneNode, scene: Scene, used: Used): Measured {
	const { profile, notation, view } = scene;
	const e = n.el;
	const st = cardStyle(n, scene);
	const id = identity(n, scene);
	const style = changeStyle(profile, e.change);
	used.change.add(style);
	if (n.area && notation.colour.nodes === 'area') used.areas.add(n.area);
	const badge = changeBadge(profile, e.change);
	const pad = S.nodePad;
	const left = BAND + pad;
	const detailsW = hasDetails(e) ? 20 : 0;
	if (detailsW) used.details = true;
	const headerReserve = left + ICON + 8 + (badge ? badgeWidth(badge) + 6 : 0) + (detailsW ? detailsW + 4 : 0) + pad;

	const chips = elementChips(n, scene, used);
	const libs = libraryChips(n, scene, used);
	const mapping = mappingText(e, scene);
	if (mapping) used.mapping = true;

	// --- width ---
	const titleNatural = measure(e.title, T.nodeTitle, 's');
	let width = Math.max(S.nodeMinW, Math.min(S.nodeMaxW, titleNatural + headerReserve));
	const longestWord = Math.max(...e.title.split(/\s+/).map((w) => measure(w, T.nodeTitle, 's')));
	width = Math.max(width, Math.min(S.nodeMaxW + 60, longestWord + headerReserve));
	if (id.label) width = Math.max(width, Math.min(S.nodeMaxW + 40, measure(id.label, T.patternLabel, 'b', 0.05) + left + ICON + 8 + (badge ? badgeWidth(badge) + 6 : 0) + pad + (id.partial ? 16 : 0)));
	const chipsNatural = chips.reduce((a, c) => a + c.width + S.chipGap, -S.chipGap) + left + pad;
	if (chipsNatural > width) width = Math.min(S.nodeMaxW, chipsNatural);
	for (const c of [...chips, ...libs]) width = Math.max(width, Math.min(S.nodeMaxW + 40, c.width + left + pad));
	if (e.subtitle) width = Math.max(width, Math.min(S.nodeMaxW, measure(e.subtitle, T.nodeSubtitle, 'r') + left + pad));
	for (const part of e.parts ?? []) {
		const pp = part.pattern ? scene.patterns.get(part.pattern) : undefined;
		const label = part.pattern === null ? 'no pattern' : (pp?.label ?? part.pattern ?? '');
		const cw = label ? measure(label, T.chip, 's') + CHIP_PAD * 2 + (part.pattern ? CHIP_ICON + 3 : 0) : 0;
		width = Math.max(width, Math.min(S.nodeMaxW + 60, measure(part.title, T.part, 'm') + 9 + 14 + cw + left + pad));
	}
	for (const f of e.fields ?? []) {
		const nameW = measure(f.title ?? f.id, T.field, 'b') + 20;
		const typeW = f.type ? measure(f.type, T.fieldType, 'r') : 0;
		width = Math.max(width, Math.min(S.nodeMaxW + 60, nameW + typeW + 18 + (e.ties?.length ? 14 : 0) + left + pad));
	}
	width = Math.ceil(width);
	const inner = width - left - pad;

	const titleLines = wrap(e.title, width - headerReserve, T.nodeTitle, 's', 3);
	const labelH = id.label ? 14 : 0;
	const headerH = Math.max(40, 10 + labelH + titleLines.length * TITLE_LH + 6);
	const subtitleLines = e.subtitle ? wrap(e.subtitle, inner, T.nodeSubtitle, 'r', 2) : [];
	const chipLayout = layoutChips(chips, inner);
	const libLayout = layoutChips(libs, inner);

	// fields
	const fieldsMode = view.fields ?? 'all';
	const allFields = fieldsMode === 'none' ? [] : (e.fields ?? []);
	const shownFields = fieldsMode === 'changed' ? allFields.filter((f) => changeStyle(profile, f.change) !== 'reused') : allFields;
	const MAX_FIELDS = 9;
	const visibleFields = shownFields.slice(0, MAX_FIELDS);
	const hiddenFields = allFields.length - visibleFields.length;
	const indexed = new Set((e.indexes ?? []).flatMap((ix) => ix.fields));
	if (visibleFields.some((f) => indexed.has(f.id))) used.index = true;
	const changedIndexes = fieldsMode === 'none' ? [] : (e.indexes ?? []).filter((ix) => changeStyle(profile, ix.change) !== 'reused');
	const reusedIndexes = (e.indexes ?? []).length - changedIndexes.length;
	const ties = (e.ties ?? []).filter((t) => t.fields.every((f) => visibleFields.some((v) => v.id === f)));
	for (const t of ties) used.tie.add(t.enforcement ?? '?');
	const tieGutter = ties.length ? 14 + (ties.length - 1) * 7 : 0;
	const parts = e.parts ?? [];

	// --- vertical layout ---
	let y = headerH + 8;
	const subtitleY = y;
	if (subtitleLines.length) y += 16 * subtitleLines.length + 2;
	const chipsY = y;
	if (chipLayout.height) y += chipLayout.height + S.rowGap + 1;
	const partsY = y;
	if (parts.length) y += parts.length * 20 + 2;
	const libsY = y;
	if (libLayout.height) y += libLayout.height + S.rowGap + 1;
	const fieldsY = y + (visibleFields.length ? 2 : 0);
	const fieldOffsets = new Map<string, number>();
	visibleFields.forEach((f, i) => fieldOffsets.set(f.id, fieldsY + i * S.fieldRow + S.fieldRow / 2));
	if (visibleFields.length) y = fieldsY + visibleFields.length * S.fieldRow + 2;
	const moreText = [
		hiddenFields > 0 ? `+${hiddenFields} more field${hiddenFields > 1 ? 's' : ''}` : '',
		reusedIndexes > 0 && (visibleFields.length || changedIndexes.length) ? `${reusedIndexes} unchanged index${reusedIndexes > 1 ? 'es' : ''}` : ''
	]
		.filter(Boolean)
		.join(' · ');
	const indexesY = y;
	if (changedIndexes.length) y += changedIndexes.length * 18 + 2;
	const tiesY = y;
	if (ties.length) y += ties.length * 17 + 2;
	const moreY = y;
	if (moreText) y += 16;
	const mappingY = y;
	if (mapping) y += 18;
	const bodyEmpty = y === headerH + 8;
	const height = Math.ceil(bodyEmpty ? headerH : y + 6);

	const draw = (x0: number, y0: number, ctx: DrawCtx): string => {
		const r = notation.corners === 'rounded' ? S.radiusRounded : S.radiusSharp;
		const out: string[] = [];
		const clipId = `${ctx.prefix}clip-${e.id}`;
		out.push(el('clipPath', { id: clipId }, rect(0, 0, width, height, { rx: r })));
		out.push(rect(0, 0, width, height, { rx: r, fill: st.fill }));
		// identity: header tint + left band in the pattern / area colour; hatched when proposed
		const colour = style === 'removed' ? C.faint : id.colour;
		let headerFill: string = colour ? tint(colour, 0.15) : C.surface;
		let bandFill: string = colour ?? C.line;
		if (id.proposed) {
			headerFill = hatchFill(ctx, colour ?? C.slate, 'light');
			bandFill = hatchFill(ctx, colour ?? C.slate, 'strong');
		}
		if (id.none) {
			headerFill = C.white;
			bandFill = C.white;
		}
		const clip = { 'clip-path': `url(#${clipId})` };
		out.push(
			g(
				rect(0, 0, width, headerH, { fill: headerFill }) +
					(bodyEmpty ? '' : line(0, headerH, width, headerH, { stroke: colour ? tint(colour, 0.45) : C.hairline, 'stroke-width': 1 })) +
					rect(0, 0, BAND, height, { fill: bandFill }) +
					(id.none ? line(BAND, 0, BAND, height, { stroke: C.faint, 'stroke-width': 1, 'stroke-dasharray': '3 3' }) : ''),
				clip
			)
		);
		// border (change state channel)
		out.push(rect(0, 0, width, height, { rx: r, fill: 'none', stroke: st.border, 'stroke-width': st.borderWidth, 'stroke-dasharray': st.dash }));
		// icon
		const fg = colour ? shade(colour, 0.25) : C.slate;
		const iy = 10 + (id.label ? 2 : (headerH - 20 - ICON) / 2);
		out.push(icon(id.icon, left, iy, ICON, id.none ? C.faint : fg, 1.7));
		// pattern label + title
		const tx = left + ICON + 8;
		let by = 10;
		if (id.label) {
			const lbl = truncate(id.label, width - tx - pad - (badge ? badgeWidth(badge) + 6 : 0) - (id.partial ? 16 : 0), T.patternLabel, 'b');
			if (id.proposed) {
				const lw = measure(lbl, T.patternLabel, 'b', 0.05) + 8;
				out.push(rect(tx - 4, by - 1, lw, 14, { fill: C.white, stroke: fg, 'stroke-width': 1, 'stroke-dasharray': '3 2', rx: 2 }));
			}
			out.push(text(tx, by + 10, lbl, { size: T.patternLabel, weight: 700, fill: id.none ? C.muted : fg, letterSpacing: 0.05, italic: id.none }));
			if (id.partial) {
				const cx = tx + measure(lbl, T.patternLabel, 'b', 0.05) + (id.proposed ? 14 : 9);
				out.push(el('circle', { cx, cy: by + 6.5, r: 4.5, fill: C.white, stroke: fg, 'stroke-width': 1.2 }));
				out.push(el('path', { d: `M${fmt(cx)} ${fmt(by + 2)} A4.5 4.5 0 0 1 ${fmt(cx)} ${fmt(by + 11)} Z`, fill: fg }));
			}
			by += labelH;
		}
		titleLines.forEach((t, i) => {
			const b = by + 14 + i * TITLE_LH;
			out.push(text(tx, b, t, { size: T.nodeTitle, weight: 600, fill: st.title }));
			if (st.strike) out.push(line(tx, b - 5, tx + measure(t, T.nodeTitle, 's') / 1.03, b - 5, { stroke: st.title, 'stroke-width': 1.4 }));
		});
		// badge + details tag
		let bx = width - pad;
		if (badge) {
			bx -= badgeWidth(badge);
			out.push(drawBadge(bx, 9, badge, style));
			bx -= 6;
		}
		const tag = ctx.detailTags.get(e.id);
		if (tag) {
			const w = Math.max(16, measure(tag, 9.5, 'b') + 8);
			bx -= w;
			out.push(detailTag(bx, 10, tag, false));
		}
		// body
		subtitleLines.forEach((l, i) => out.push(text(left, subtitleY + 12 + i * 16, l, { size: T.nodeSubtitle, fill: st.body })));
		chipLayout.rows.forEach((row, i) => {
			let cx = left;
			for (const c of row) {
				out.push(drawChip(cx, chipsY + i * (S.chipH + S.chipGap), c, ctx));
				cx += c.width + S.chipGap;
			}
		});
		parts.forEach((part, i) => {
			const py = partsY + i * 20;
			const ps = changeStyle(profile, part.change);
			const pfg = ps === 'removed' ? C.faint : C.graphite;
			out.push(el('path', { d: `M${left + 1} ${py + 6} l4 3.5 -4 3.5`, fill: 'none', stroke: C.faint, 'stroke-width': 1.2 }));
			const pt = truncate(part.title, inner * 0.55, T.part, 'm');
			out.push(text(left + 9, py + 13.5, pt, { size: T.part, weight: 500, fill: pfg }));
			const pp = part.pattern ? scene.patterns.get(part.pattern) : undefined;
			const label = part.pattern === null ? 'no pattern' : (pp?.label ?? part.pattern ?? '');
			if (part.pattern) used.patterns.set(part.pattern, (used.patterns.get(part.pattern) ?? 0) + 1);
			if (part.pattern === null) used.noPattern = true;
			if (label) {
				const c = part.pattern === null ? chip({ kind: 'nopattern', text: label }) : patternChip(pp, part.pattern!, profile, notation.colour.nodes === 'pattern', false);
				const cw = Math.min(c.width, inner - (measure(pt, T.part, 'm') + 14));
				out.push(drawChip(width - pad - cw, py + 1.5, { ...c, width: cw, text: truncate(c.text, cw - (c.icon ? CHIP_ICON + 3 : 0) - CHIP_PAD * 2, T.chip, 's') }, ctx));
			}
		});
		libLayout.rows.forEach((row, i) => {
			let cx = left;
			for (const c of row) {
				out.push(drawChip(cx, libsY + i * (S.chipH + S.chipGap), c, ctx));
				cx += c.width + S.chipGap;
			}
		});
		if (visibleFields.length) out.push(line(left, fieldsY - 2, width - pad, fieldsY - 2, { stroke: C.hairline, 'stroke-width': 1 }));
		visibleFields.forEach((f, i) => {
			const fy = fieldsY + i * S.fieldRow;
			const fs = changeStyle(profile, f.change);
			if (i > 0) out.push(line(left, fy, width - pad - tieGutter, fy, { stroke: C.hairline, 'stroke-width': 0.75 }));
			const mid = fy + S.fieldRow / 2;
			if (indexed.has(f.id)) out.push(rect(left, mid - 2.5, 5, 5, { fill: fs === 'removed' ? C.faint : C.graphite }));
			const nameStyle: FontStyle = fs === 'new' ? 'b' : 'r';
			const ffg = fs === 'removed' ? C.faint : fs === 'reused' ? C.graphite : C.ink;
			let nx = left + 10;
			if (fs === 'new' || fs === 'modified') {
				out.push(text(nx, mid + 4, fs === 'new' ? '+' : 'Δ', { size: 11.5, weight: 700, fill: C.ink }));
				nx += 11;
			}
			const typeW = f.type ? Math.min(inner * 0.42, measure(f.type, T.fieldType, 'r')) : 0;
			const name = truncate(f.title ?? f.id, inner - 10 - typeW - tieGutter - 8 - (nx - left - 10), T.field, nameStyle);
			out.push(text(nx, mid + 4, name, { size: T.field, weight: nameStyle === 'b' ? 700 : 400, fill: ffg }));
			if (fs === 'removed') out.push(line(nx, mid, nx + measure(name, T.field, nameStyle) / 1.03, mid, { stroke: ffg, 'stroke-width': 1 }));
			if (f.type) out.push(text(width - pad - tieGutter, mid + 3.5, truncate(f.type, inner * 0.42, T.fieldType, 'r'), { size: T.fieldType, fill: C.muted, anchor: 'end' }));
		});
		ties.forEach((t, i) => {
			const ya = fieldOffsets.get(t.fields[0])!;
			const yb = fieldOffsets.get(t.fields[1])!;
			const bxx = width - pad - 4 - i * 7;
			const [y1, y2] = ya < yb ? [ya, yb] : [yb, ya];
			out.push(el('path', { d: `M${fmt(bxx - 6)} ${fmt(y1)} H${fmt(bxx)} V${fmt(y2)} H${fmt(bxx - 6)}`, fill: 'none', stroke: C.faint, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
			const enf = t.enforcement ? profile.enforcement[t.enforcement] : undefined;
			if (enf) out.push(line(bxx + 0.1, y1 + 3, bxx + 0.1, y2 - 3, { stroke: enf.colour, 'stroke-width': 1.2, ...dashAttrs(enf.line) }));
		});
		changedIndexes.forEach((ix, i) => {
			const iy = indexesY + i * 18;
			const is = changeStyle(profile, ix.change);
			const ifg = is === 'removed' ? C.faint : C.graphite;
			out.push(text(left, iy + 13, '⌗', { size: 11.5, weight: 700, fill: ifg }));
			const lbl = changeBadge(profile, ix.change);
			const lw = lbl ? badgeWidth(lbl) * 0.85 : 0;
			const name = truncate(ix.fields.join(' + '), inner - 14 - lw - 6, T.part, 'm');
			out.push(text(left + 12, iy + 13, name, { size: T.part, weight: 500, fill: ifg }));
			if (is === 'removed') out.push(line(left + 12, iy + 9, left + 12 + measure(name, T.part, 'm') / 1.03, iy + 9, { stroke: ifg }));
			if (lbl) out.push(g(drawBadge(0, 0, lbl, is), { transform: `${translate(width - pad - lw, iy + 2)} scale(0.85)` }));
		});
		ties.forEach((t, i) => {
			const ty2 = tiesY + i * 17;
			const enf = t.enforcement ? profile.enforcement[t.enforcement] : undefined;
			const tcol = enf?.colour ?? C.missing;
			out.push(el('path', { d: `M${left} ${ty2 + 4} h4 v8 h-4`, fill: 'none', stroke: C.faint, 'stroke-width': 1.6 }));
			let lx = left + 9;
			const dv = divergenceId(t.divergence);
			if (dv) {
				out.push(warningGlyph(lx + 5, ty2 + 8.5, profile.divergenceColour ?? '#be123c', 11));
				out.push(text(lx + 12, ty2 + 12.5, dv, { size: 10.5, weight: 700, fill: profile.divergenceColour ?? '#be123c' }));
				lx += 16 + measure(dv, 10.5, 'b');
				used.divergence = true;
			}
			const lbl = t.label ?? `${t.fields[0]} ↔ ${t.fields[1]} must agree`;
			out.push(text(lx, ty2 + 12.5, truncate(lbl, width - pad - lx, 10.5, 'i'), { size: 10.5, italic: true, fill: tcol }));
		});
		if (moreText) out.push(text(left, moreY + 11.5, moreText, { size: 10.5, italic: true, fill: C.muted }));
		if (mapping) {
			out.push(icon('link', left, mappingY + 2, 12, C.muted, 1.4));
			out.push(text(left + 15, mappingY + 12, truncate(mapping, inner - 15, T.part, 'r'), { size: T.part, fill: C.muted }));
		}
		return g(out.join(''), { transform: translate(x0, y0), 'data-id': e.id, opacity: st.opacity < 1 ? st.opacity : undefined });
	};
	return { width, height, draw, fieldOffsets };
}

export function dashAttrs(lineStyle: string | undefined): Record<string, string | undefined> {
	switch (lineStyle) {
		case 'dashed':
			return { 'stroke-dasharray': '6 4' };
		case 'dotted':
			return { 'stroke-dasharray': '0.5 3.5', 'stroke-linecap': 'round' };
		case 'long-dash':
			return { 'stroke-dasharray': '10 4' };
		default:
			return {};
	}
}

/* ------------------------------------------------------------------------- */
/* Frame                                                                       */
/* ------------------------------------------------------------------------- */

export interface FrameMeasure {
	headerHeight: number;
	minWidth: number;
	draw(x: number, y: number, w: number, h: number, ctx: DrawCtx): string;
}

export function measureFrame(n: SceneNode, scene: Scene, used: Used): FrameMeasure {
	const { profile, notation } = scene;
	const e = n.el;
	const style = changeStyle(profile, e.change);
	used.change.add(style);
	const areaDef = notation.colour.nodes === 'area' && n.area ? profile.areas[n.area] : undefined;
	if (areaDef) used.areas.add(n.area!);
	const badge = changeBadge(profile, e.change);
	const title = e.title.toUpperCase();
	const chips = elementChips(n, scene, used);
	const libs = libraryChips(n, scene, used);
	const allChips = [...chips, ...libs];
	const mapping = mappingText(e, scene);
	if (mapping) used.mapping = true;
	if (hasDetails(e)) used.details = true;
	const titleW = measure(title, T.frameTitle, 'b', 0.06);
	const line1W = 14 + 22 + titleW + (badge ? badgeWidth(badge) + 8 : 0) + (hasDetails(e) ? 24 : 0) + 14;
	const chipsW = allChips.reduce((a, c) => a + c.width + S.chipGap, 0);
	const subtitleW = e.subtitle ? measure(e.subtitle, T.frameSubtitle, 'i') + 28 : 0;
	const minWidth = Math.ceil(Math.max(line1W, subtitleW, mapping ? measure(mapping, 10.5) + 42 : 0, chipsW + 28, 160));
	let headerHeight = 34;
	const subtitleY = headerHeight;
	if (e.subtitle) headerHeight += 15;
	const chipsY = headerHeight;
	if (allChips.length) headerHeight += S.chipH + 6;
	const mappingY = headerHeight;
	if (mapping) headerHeight += 16;
	headerHeight += 6;

	const draw = (x: number, y: number, w: number, h: number, ctx: DrawCtx) => {
		const r = notation.corners === 'rounded' ? S.radiusRounded + 4 : S.radiusSharp;
		const depthFill = n.depth % 2 === 0 ? C.surface : C.white;
		let fill: string = areaDef ? (n.depth % 2 === 0 ? areaDef.fill : C.white) : depthFill;
		let stroke: string = areaDef?.colour ?? (style === 'new' ? C.ink : style === 'modified' ? C.faint : C.line);
		let sw = style === 'new' ? 1.75 : 1.25;
		let dash: string | undefined;
		const fg = style === 'removed' ? C.faint : (areaDef?.colour ?? C.graphite);
		if (style === 'removed') {
			stroke = C.faint;
			dash = '5 4';
			fill = C.surface;
		}
		if (style !== 'removed' && e.lifecycle && profile.lifecycle[e.lifecycle]) {
			const lc = profile.lifecycle[e.lifecycle];
			stroke = lc.colour;
			dash = lc.border === 'dashed' ? '7 5' : undefined;
			sw = Math.max(sw, 1.6);
			if (lc.fill) fill = lc.fill;
		}
		const out: string[] = [];
		out.push(rect(0, 0, w, h, { rx: r, fill, stroke, 'stroke-width': sw, 'stroke-dasharray': dash }));
		const kindIcon = profile.elementKinds[e.kind]?.icon ?? 'container';
		out.push(icon(kindIcon, 14, 11, 14, fg, 1.5));
		out.push(text(36, 23, title, { size: T.frameTitle, weight: 700, fill: fg, letterSpacing: 0.06 }));
		if (style === 'removed') out.push(line(36, 19, 36 + titleW / 1.03, 19, { stroke: fg, 'stroke-width': 1.2 }));
		let bx = 36 + titleW + 10;
		if (badge) {
			out.push(drawBadge(bx, 10, badge, style));
			bx += badgeWidth(badge) + 6;
		}
		const tag = ctx.detailTags.get(e.id);
		if (tag) out.push(detailTag(bx, 10.5, tag, false));
		if (e.subtitle) out.push(text(36, subtitleY + 9, truncate(e.subtitle, w - 50, T.frameSubtitle, 'i'), { size: T.frameSubtitle, italic: true, fill: C.muted }));
		let cx = 36;
		for (const c of allChips) {
			if (cx + c.width > w - 12) break;
			out.push(drawChip(cx, chipsY, c, ctx));
			cx += c.width + S.chipGap;
		}
		if (mapping) {
			out.push(icon('link', 36, mappingY + 1, 11, C.muted, 1.4));
			out.push(text(50, mappingY + 10.5, truncate(mapping, w - 64, 10.5, 'r'), { size: 10.5, fill: C.muted }));
		}
		return g(out.join(''), { transform: translate(x, y), 'data-id': e.id });
	};
	return { headerHeight, minWidth, draw };
}

/* ------------------------------------------------------------------------- */
/* Absence                                                                     */
/* ------------------------------------------------------------------------- */

export function measureAbsence(textValue: string): Measured {
	const lines = wrap(textValue, 200, 11.5, 'i', 4);
	const width = Math.ceil(Math.max(...lines.map((l) => measure(l, 11.5, 'i'))) + 8);
	const height = lines.length * 16 + 8;
	return {
		width,
		height,
		draw(x, y) {
			return g(
				lines.map((l, i) => text(width / 2, 15 + i * 16, l, { size: 11.5, italic: true, fill: C.faint, anchor: 'middle' })).join(''),
				{ transform: translate(x, y) }
			);
		}
	};
}

export { esc };
