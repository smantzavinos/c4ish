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

const BADGE_FONT = 9;

function badgeWidth(label: string | undefined): number {
	return label ? Math.ceil(measure(label, BADGE_FONT, 'b', 0.06) + 12) : 0;
}

function drawBadge(x: number, y: number, label: string, style: ChangeStyle): string {
	const w = badgeWidth(label);
	const h = 16;
	let fill: string = C.white;
	let stroke: string = C.ink;
	let fg: string = C.ink;
	let dash: string | undefined;
	if (style === 'modified') {
		fill = C.white;
		stroke = C.graphite;
		fg = C.graphite;
	} else if (style === 'removed') {
		fill = C.white;
		stroke = C.faint;
		fg = C.muted;
		dash = '2 2';
	} else if (style === 'reused') {
		fill = C.white;
		stroke = C.line;
		fg = C.muted;
	}
	return (
		rect(x, y, w, h, { rx: 8, fill, stroke, 'stroke-width': 1, 'stroke-dasharray': dash }) +
		text(x + w / 2, y + 11.2, label, { size: BADGE_FONT, weight: 700, fill: fg, anchor: 'middle', letterSpacing: 0.06 })
	);
}

interface CardStyle {
	band: string;
	border: string;
	borderWidth: number;
	dash?: string;
	fill: string;
	title: string;
	body: string;
	iconTile: string;
	iconGlyph: string;
	onDark: boolean;
	strike: boolean;
}

function cardStyle(n: SceneNode, scene: Scene): CardStyle {
	const { profile, notation } = scene;
	const style = changeStyle(profile, n.el.change);
	const areaDef = notation.colour.nodes === 'area' && n.area ? profile.areas[n.area] : undefined;
	const pattern = n.el.pattern ? scene.patterns.get(n.el.pattern) : undefined;
	const famColour =
		notation.colour.nodes === 'pattern' && pattern ? profile.patternFamilies[pattern.family]?.colour : undefined;
	const base: CardStyle = {
		band: C.white,
		border: areaDef?.colour ?? C.line,
		borderWidth: 1,
		fill: C.white,
		title: C.slate,
		body: C.muted,
		iconTile: famColour ?? C.surface,
		iconGlyph: famColour ? C.white : C.muted,
		onDark: false,
		strike: false
	};
	if (style === 'new') {
		Object.assign(base, {
			band: C.inkBand,
			border: areaDef?.colour ?? C.ink,
			borderWidth: 1.75,
			title: C.white,
			body: C.slate,
			iconTile: famColour ?? 'rgba(255,255,255,0.14)',
			iconGlyph: C.white,
			onDark: true
		});
	} else if (style === 'modified') {
		Object.assign(base, {
			band: C.modifiedBand,
			border: areaDef?.colour ?? C.graphite,
			borderWidth: 1.5,
			title: C.ink,
			body: C.slate,
			iconTile: famColour ?? C.white,
			iconGlyph: famColour ? C.white : C.graphite
		});
	} else if (style === 'removed') {
		Object.assign(base, {
			band: C.surface,
			border: C.faint,
			borderWidth: 1.25,
			dash: '5 4',
			fill: C.surface,
			title: C.faint,
			body: C.faint,
			iconTile: C.white,
			iconGlyph: C.faint,
			strike: true
		});
	}
	if (style !== 'removed' && n.el.lifecycle) {
		const lc = profile.lifecycle[n.el.lifecycle];
		if (lc) {
			base.border = lc.colour;
			base.dash = lc.border === 'dashed' ? '6 4' : undefined;
			base.borderWidth = Math.max(base.borderWidth, 1.5);
			if (lc.fill) base.fill = lc.fill;
		}
	}
	return base;
}

function elementChips(n: SceneNode, scene: Scene, used: Used, includeLifecycle = true): Chip[] {
	const { profile, notation } = scene;
	const e = n.el;
	const chips: Chip[] = [];
	const colourNodes = notation.colour.nodes === 'pattern';
	if (e.pattern) {
		const p = scene.patterns.get(e.pattern);
		chips.push(patternChip(p, e.pattern, profile, colourNodes, e.patternFit === 'partial'));
		used.patterns.set(e.pattern, (used.patterns.get(e.pattern) ?? 0) + 1);
		if (e.patternFit === 'partial') used.partial = true;
	} else if (e.pattern === null) {
		chips.push(chip({ kind: 'nopattern', text: 'no pattern' }));
		used.noPattern = true;
	}
	for (const pid of e.patterns ?? []) {
		const p = scene.patterns.get(pid);
		chips.push(chip({ kind: 'secondary', text: p?.label ?? pid }));
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
		chips.push(
			chip({
				kind: style === 'new' ? 'libnew' : 'lib',
				text: style === 'new' ? `${name} +` : name,
				icon: 'library',
				strike: style === 'removed'
			})
		);
	}
	return chips;
}

function mappingText(e: Element, scene: Scene): string | undefined {
	if (e.mappingLabel) return e.mappingLabel;
	if (!e.implementedBy?.length) return undefined;
	return e.implementedBy.map((id) => scene.elementsById.get(id)?.title ?? id).join(' + ');
}

/** Measure a leaf card; returns size and a draw closure. */
export function measureNode(n: SceneNode, scene: Scene, used: Used): Measured {
	const { profile, notation, view } = scene;
	const e = n.el;
	const st = cardStyle(n, scene);
	const style = changeStyle(profile, e.change);
	used.change.add(style);
	if (n.area && notation.colour.nodes === 'area') used.areas.add(n.area);
	const badge = changeBadge(profile, e.change);
	const pad = S.nodePad;
	const detailsW = hasDetails(e) ? 20 : 0;
	if (detailsW) used.details = true;
	const headerReserve = pad + S.iconTile + 8 + (badge ? badgeWidth(badge) + 6 : 0) + (detailsW ? detailsW + 4 : 0) + pad;

	const chips = elementChips(n, scene, used);
	const libs = libraryChips(n, scene, used);
	const mapping = mappingText(e, scene);
	if (mapping) used.mapping = true;

	// --- width ---
	const titleNatural = measure(e.title, T.nodeTitle, 's');
	let width = Math.max(S.nodeMinW, Math.min(S.nodeMaxW, titleNatural + headerReserve));
	const longestWord = Math.max(...e.title.split(/\s+/).map((w) => measure(w, T.nodeTitle, 's')));
	width = Math.max(width, Math.min(S.nodeMaxW + 60, longestWord + headerReserve));
	const chipsNatural = chips.reduce((a, c) => a + c.width + S.chipGap, -S.chipGap) + pad * 2;
	if (chipsNatural > width) width = Math.min(S.nodeMaxW, chipsNatural);
	for (const c of [...chips, ...libs]) width = Math.max(width, Math.min(S.nodeMaxW + 40, c.width + pad * 2));
	if (e.subtitle) width = Math.max(width, Math.min(S.nodeMaxW, measure(e.subtitle, T.nodeSubtitle, 'r') + pad * 2));
	// parts: title + its pattern chip on one row
	for (const part of e.parts ?? []) {
		const pp = part.pattern ? scene.patterns.get(part.pattern) : undefined;
		const label = part.pattern === null ? 'no pattern' : (pp?.label ?? part.pattern ?? '');
		const cw = label ? measure(label, T.chip, 's') + CHIP_PAD * 2 + (part.pattern ? CHIP_ICON + 3 : 0) : 0;
		width = Math.max(width, Math.min(S.nodeMaxW + 60, measure(part.title, 10.5, 'm') + 9 + 14 + cw + pad * 2));
	}
	// fields: name + type on one row (data cards may grow wider than other cards)
	for (const f of e.fields ?? []) {
		const nameW = measure(f.title ?? f.id, T.field, 'b') + 20;
		const typeW = f.type ? measure(f.type, T.fieldType, 'r') : 0;
		width = Math.max(width, Math.min(S.nodeMaxW + 60, nameW + typeW + 18 + (e.ties?.length ? 14 : 0) + pad * 2));
	}
	width = Math.ceil(width);
	const inner = width - pad * 2;

	const titleLines = wrap(e.title, width - headerReserve, T.nodeTitle, 's', 3);
	const headerH = Math.max(34, titleLines.length * 16 + 16);
	const subtitleLines = e.subtitle ? wrap(e.subtitle, inner, T.nodeSubtitle, 'r', 2) : [];
	const subtitle = subtitleLines.length > 0;
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
	const rows: { y: number; kind: string }[] = [];
	const subtitleY = subtitle ? y : 0;
	if (subtitle) y += 15 * subtitleLines.length + 1;
	const chipsY = y;
	if (chipLayout.height) y += chipLayout.height + S.rowGap + 1;
	const partsY = y;
	if (parts.length) y += parts.length * 18 + 2;
	const libsY = y;
	if (libLayout.height) y += libLayout.height + S.rowGap + 1;
	const fieldsY = y + (visibleFields.length ? 2 : 0);
	const fieldOffsets = new Map<string, number>();
	visibleFields.forEach((f, i) => fieldOffsets.set(f.id, fieldsY + i * S.fieldRow + S.fieldRow / 2));
	if (visibleFields.length) y = fieldsY + visibleFields.length * S.fieldRow + 2;
	const moreY = y;
	const moreText = [
		hiddenFields > 0 ? `+${hiddenFields} more field${hiddenFields > 1 ? 's' : ''}` : '',
		reusedIndexes > 0 && (visibleFields.length || changedIndexes.length) ? `${reusedIndexes} unchanged index${reusedIndexes > 1 ? 'es' : ''}` : ''
	]
		.filter(Boolean)
		.join(' · ');
	const indexesY = y;
	if (changedIndexes.length) y += changedIndexes.length * 17 + 2;
	const tiesY = y;
	if (ties.length) y += ties.length * 16 + 2;
	const moreY2 = y;
	if (moreText) y += 15;
	const mappingY = y;
	if (mapping) y += 17;
	const bodyEmpty = y === headerH + 8;
	const height = Math.ceil(bodyEmpty ? headerH : y + 6);
	void rows;
	void moreY;

	const draw = (x0: number, y0: number, ctx: DrawCtx): string => {
		const r = notation.corners === 'rounded' ? S.radiusRounded : S.radiusSharp;
		const out: string[] = [];
		const clipId = `${ctx.prefix}clip-${e.id}`;
		out.push(
			el('clipPath', { id: clipId }, rect(0, 0, width, height, { rx: r }))
		);
		out.push(rect(0, 0, width, height, { rx: r, fill: st.fill }));
		// header band
		out.push(g(rect(0, 0, width, headerH, { fill: st.band }) + (bodyEmpty ? '' : line(0, headerH, width, headerH, { stroke: st.onDark ? st.band : C.hairline, 'stroke-width': 1 })), { 'clip-path': `url(#${clipId})` }));
		// proposed strip
		const p = e.pattern ? scene.patterns.get(e.pattern) : undefined;
		if (p?.status === 'proposed') {
			out.push(g(rect(0, headerH, 7, height - headerH, { fill: `url(#${ctx.prefix}hatch)` }), { 'clip-path': `url(#${clipId})` }));
		}
		// border
		out.push(rect(0, 0, width, height, { rx: r, fill: 'none', stroke: st.border, 'stroke-width': st.borderWidth, 'stroke-dasharray': st.dash }));
		// icon tile
		const kindIcon = profile.elementKinds[e.kind]?.icon ?? 'component';
		const iconName = p ? (p.icon ?? profile.patternFamilies[p.family]?.icon ?? kindIcon) : kindIcon;
		const ty = Math.min(8, (headerH - S.iconTile) / 2);
		out.push(rect(pad, ty, S.iconTile, S.iconTile, { rx: 3, fill: st.iconTile, stroke: st.onDark || st.iconTile !== C.surface ? 'none' : C.hairline }));
		out.push(icon(iconName, pad + 3, ty + 3, 12, st.iconGlyph, 1.5));
		// title
		const tx = pad + S.iconTile + 8;
		const firstBaseline = headerH / 2 - ((titleLines.length - 1) * 16) / 2 + 4.5;
		titleLines.forEach((t, i) => {
			const by = firstBaseline + i * 16;
			out.push(text(tx, by, t, { size: T.nodeTitle, weight: 600, fill: st.title }));
			if (st.strike) out.push(line(tx, by - 4.5, tx + measure(t, T.nodeTitle, 's') / 1.03, by - 4.5, { stroke: st.title, 'stroke-width': 1.2 }));
		});
		// badge + details tag
		let bx = width - pad;
		if (badge) {
			bx -= badgeWidth(badge);
			out.push(drawBadge(bx, ty + 1, badge, style));
			bx -= 6;
		}
		const tag = ctx.detailTags.get(e.id);
		if (tag) {
			const w = Math.max(16, measure(tag, 9.5, 'b') + 8);
			bx -= w;
			out.push(detailTag(bx, ty + 1.5, tag, st.onDark));
		}
		// body
		subtitleLines.forEach((l, i) =>
			out.push(text(pad, subtitleY + 11 + i * 15, l, { size: T.nodeSubtitle, fill: style === 'removed' ? C.faint : st.title === C.white ? C.graphite : C.slate }))
		);
		chipLayout.rows.forEach((row, i) => {
			let cx = pad;
			for (const c of row) {
				out.push(drawChip(cx, chipsY + i * (S.chipH + S.chipGap), c, ctx));
				cx += c.width + S.chipGap;
			}
		});
		parts.forEach((part, i) => {
			const py = partsY + i * 18;
			const ps = changeStyle(profile, part.change);
			const fg = ps === 'removed' ? C.faint : C.graphite;
			out.push(el('path', { d: `M${pad + 1} ${py + 5} l4 3.5 -4 3.5`, fill: 'none', stroke: C.faint, 'stroke-width': 1.2 }));
			const pt = truncate(part.title, inner * 0.55, 10.5, 'm');
			out.push(text(pad + 9, py + 12, pt, { size: 10.5, weight: 500, fill: fg }));
			const pp = part.pattern ? scene.patterns.get(part.pattern) : undefined;
			const label = part.pattern === null ? 'no pattern' : (pp?.label ?? part.pattern ?? '');
			if (part.pattern) used.patterns.set(part.pattern, (used.patterns.get(part.pattern) ?? 0) + 1);
			if (part.pattern === null) used.noPattern = true;
			if (label) {
				const c = part.pattern === null ? chip({ kind: 'nopattern', text: label }) : patternChip(pp, part.pattern!, profile, notation.colour.nodes === 'pattern', false);
				const cw = Math.min(c.width, inner - (measure(pt, 10.5, 'm') + 14));
				out.push(drawChip(width - pad - cw, py + 0.5, { ...c, width: cw, text: truncate(c.text, cw - (c.icon ? CHIP_ICON + 3 : 0) - CHIP_PAD * 2, T.chip, 's') }, ctx));
			}
		});
		libLayout.rows.forEach((row, i) => {
			let cx = pad;
			for (const c of row) {
				out.push(drawChip(cx, libsY + i * (S.chipH + S.chipGap), c, ctx));
				cx += c.width + S.chipGap;
			}
		});
		if (visibleFields.length) {
			out.push(line(pad, fieldsY - 2, width - pad, fieldsY - 2, { stroke: C.hairline, 'stroke-width': 1 }));
		}
		visibleFields.forEach((f, i) => {
			const fy = fieldsY + i * S.fieldRow;
			const fs = changeStyle(profile, f.change);
			if (i > 0) out.push(line(pad, fy, width - pad - tieGutter, fy, { stroke: C.hairline, 'stroke-width': 0.75 }));
			const mid = fy + S.fieldRow / 2;
			if (indexed.has(f.id)) out.push(rect(pad, mid - 2.5, 5, 5, { fill: fs === 'removed' ? C.faint : C.graphite }));
			const nameStyle: FontStyle = fs === 'new' ? 'b' : 'r';
			const fg = fs === 'removed' ? C.faint : fs === 'new' ? C.ink : fs === 'modified' ? C.ink : C.graphite;
			let nx = pad + 10;
			if (fs === 'new' || fs === 'modified') {
				out.push(text(nx, mid + 3.8, fs === 'new' ? '+' : 'Δ', { size: 11, weight: 700, fill: C.ink }));
				nx += 10;
			}
			const typeW = f.type ? Math.min(inner * 0.42, measure(f.type, T.fieldType, 'r')) : 0;
			const name = truncate(f.title ?? f.id, inner - 10 - typeW - tieGutter - 8 - (nx - pad - 10), T.field, nameStyle);
			out.push(text(nx, mid + 3.8, name, { size: T.field, weight: nameStyle === 'b' ? 700 : 400, fill: fg }));
			if (fs === 'removed') out.push(line(nx, mid, nx + measure(name, T.field, nameStyle) / 1.03, mid, { stroke: fg, 'stroke-width': 1 }));
			if (f.type) out.push(text(width - pad - tieGutter, mid + 3.5, truncate(f.type, inner * 0.42, T.fieldType, 'r'), { size: T.fieldType, fill: C.faint, anchor: 'end' }));
		});
		// tie-bars
		ties.forEach((t, i) => {
			const ya = fieldOffsets.get(t.fields[0])!;
			const yb = fieldOffsets.get(t.fields[1])!;
			const bxx = width - pad - 4 + 0 - i * 7;
			const [y1, y2] = ya < yb ? [ya, yb] : [yb, ya];
			out.push(el('path', { d: `M${fmt(bxx - 6)} ${fmt(y1)} H${fmt(bxx)} V${fmt(y2)} H${fmt(bxx - 6)}`, fill: 'none', stroke: C.faint, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
			const enf = t.enforcement ? profile.enforcement[t.enforcement] : undefined;
			if (enf) out.push(line(bxx + 0.1, y1 + 3, bxx + 0.1, y2 - 3, { stroke: enf.colour, 'stroke-width': 1.2, ...dashAttrs(enf.line) }));
		});
		changedIndexes.forEach((ix, i) => {
			const iy = indexesY + i * 17;
			const is = changeStyle(profile, ix.change);
			const fg = is === 'removed' ? C.faint : C.graphite;
			out.push(text(pad, iy + 12, '⌗', { size: 11, weight: 700, fill: fg }));
			const lbl = changeBadge(profile, ix.change);
			const lw = lbl ? badgeWidth(lbl) * 0.85 : 0;
			const name = truncate(ix.fields.join(' + '), inner - 14 - lw - 6, 10.5, 'm');
			out.push(text(pad + 12, iy + 12, name, { size: 10.5, weight: 500, fill: fg }));
			if (is === 'removed') out.push(line(pad + 12, iy + 8.5, pad + 12 + measure(name, 10.5, 'm') / 1.03, iy + 8.5, { stroke: fg }));
			if (lbl) out.push(g(drawBadge(0, 0, lbl, is), { transform: `${translate(width - pad - lw, iy + 2)} scale(0.85)` }));
		});
		ties.forEach((t, i) => {
			const ty2 = tiesY + i * 16;
			const enf = t.enforcement ? profile.enforcement[t.enforcement] : undefined;
			const colour = enf?.colour ?? C.missing;
			out.push(el('path', { d: `M${pad} ${ty2 + 4} h4 v8 h-4`, fill: 'none', stroke: C.faint, 'stroke-width': 1.6 }));
			let lx = pad + 9;
			const dv = divergenceId(t.divergence);
			if (dv) {
				out.push(warningGlyph(lx + 5, ty2 + 8.5, profile.divergenceColour ?? '#be123c', 10));
				out.push(text(lx + 12, ty2 + 12, dv, { size: 10, weight: 700, fill: profile.divergenceColour ?? '#be123c' }));
				lx += 16 + measure(dv, 10, 'b');
				used.divergence = true;
			}
			const lbl = t.label ?? `${t.fields[0]} ↔ ${t.fields[1]} must agree`;
			out.push(text(lx, ty2 + 12, truncate(lbl, width - pad - lx, 10, 'i'), { size: 10, italic: true, fill: colour }));
		});
		if (moreText) out.push(text(pad, moreY2 + 11, moreText, { size: 10, italic: true, fill: C.faint }));
		if (mapping) {
			out.push(icon('link', pad, mappingY + 2, 11, C.muted, 1.4));
			out.push(text(pad + 14, mappingY + 11.5, truncate(mapping, inner - 14, 10.5, 'r'), { size: 10.5, fill: C.muted }));
		}
		return g(out.join(''), { transform: translate(x0, y0), 'data-id': e.id });
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
