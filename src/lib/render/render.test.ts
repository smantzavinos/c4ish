import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { check } from '../api.js';
import { ElkLayoutEngine } from '../layout/elk.js';
import type { Rect } from '../layout/types.js';
import type { Model, Profile } from '../model/types.js';
import { EXAMPLES, loadExample } from '../test/fixtures.js';
import { measure, wrap } from '../text/measure.js';
import { renderView } from './page.js';
import { buildScene } from './scene.js';

const EPS = 0.5;
const inside = (c: Rect, p: Rect) => c.x >= p.x - EPS && c.y >= p.y - EPS && c.x + c.width <= p.x + p.width + EPS && c.y + c.height <= p.y + p.height + EPS;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;

function loaded(name: string): { model: Model; profile: Profile } {
	const { model, profile } = loadExample(name);
	const res = check(model, profile);
	if (!res.model || !res.profile) throw new Error(`${name} does not validate`);
	return { model: res.model, profile: res.profile };
}

const cases = EXAMPLES.flatMap((name) => loaded(name).model.views.map((v) => [name, v.id] as const));

describe.each(cases)('%s / %s', (name, view) => {
	it('lays out without overlaps and keeps children inside parents', async () => {
		const { model, profile } = loaded(name);
		const scene = buildScene(model, profile, view);
		const res = await renderView(model, profile, { view });
		const rects = res.geometry.nodes;
		for (const [id, n] of scene.nodes) {
			expect(rects.has(id), `${id} has geometry`).toBe(true);
			const r = rects.get(id)!;
			expect(r.width).toBeGreaterThan(0);
			expect(r.height).toBeGreaterThan(0);
			if (n.parent) expect(inside(r, rects.get(n.parent)!), `${id} inside ${n.parent}`).toBe(true);
			expect(inside(r, res.geometry.diagram), `${id} inside diagram`).toBe(true);
		}
		// siblings (same parent in the view) never overlap
		const groups = new Map<string, string[]>();
		for (const [id, n] of scene.nodes) groups.set(n.parent ?? '', [...(groups.get(n.parent ?? '') ?? []), id]);
		for (const ids of groups.values())
			for (let i = 0; i < ids.length; i++)
				for (let j = i + 1; j < ids.length; j++)
					expect(overlap(rects.get(ids[i])!, rects.get(ids[j])!), `${ids[i]} vs ${ids[j]}`).toBe(false);
	});

	it('places edge labels clear of cards and of each other', async () => {
		const { model, profile } = loaded(name);
		const { diagram } = await renderView(model, profile, { view });
		const labels = diagram.edges.filter((e) => e.label).map((e) => ({ id: e.id, r: e.label!.rect }));
		for (const l of labels) for (const n of diagram.nodes) expect(overlap(l.r, n.rect), `label ${l.id} over ${n.id}`).toBe(false);
		for (const a of labels) for (const b of labels) if (a.id < b.id) expect(overlap(a.r, b.r), `labels ${a.id} / ${b.id}`).toBe(false);
	});

	it('keeps the page diagram-first: no details footer unless an appendix is requested', async () => {
		const { model, profile } = loaded(name);
		const plain = await renderView(model, profile, { view });
		expect(plain.svg).not.toContain('>DETAILS<');
		expect(plain.appendix).toBeUndefined();
		const withAppendix = await renderView(model, profile, { view, appendix: true });
		expect(withAppendix.appendix).toMatch(/^# .* — appendix/);
		if (withAppendix.diagram.detailTags.size) expect(withAppendix.appendix).toContain('## Details');
	});

	it('renders well-formed, deterministic SVG', async () => {
		const { model, profile } = loaded(name);
		const a = await renderView(model, profile, { view });
		const b = await renderView(model, profile, { view });
		expect(XMLValidator.validate(a.svg)).toBe(true);
		expect(a.svg).toBe(b.svg);
		expect(a.svg).toContain('<title>');
		expect(a.svg).not.toMatch(/NaN|undefined/);
	});
});

describe('layout engine', () => {
	it('returns absolute coordinates for nested nodes and edges', async () => {
		const res = await new ElkLayoutEngine().layout({
			direction: 'down',
			nodes: [
				{ id: 'p', width: 0, height: 0, padding: { top: 30, left: 10, right: 10, bottom: 10 } },
				{ id: 'a', parent: 'p', width: 100, height: 40 },
				{ id: 'b', parent: 'p', width: 100, height: 40 },
				{ id: 'c', width: 80, height: 40 }
			],
			edges: [
				{ id: 'ab', source: 'a', target: 'b' },
				{ id: 'bc', source: 'b', target: 'c', label: { width: 40, height: 14 } }
			]
		});
		const p = res.nodes.get('p')!;
		for (const id of ['a', 'b']) expect(inside(res.nodes.get(id)!, p)).toBe(true);
		expect(overlap(res.nodes.get('a')!, res.nodes.get('b')!)).toBe(false);
		expect(res.nodes.get('a')!.y).toBeLessThan(res.nodes.get('b')!.y);
		const bc = res.edges.get('bc')!;
		expect(bc.points.length).toBeGreaterThanOrEqual(2);
		expect(bc.label).toBeDefined();
	});
});

describe('text metrics', () => {
	it('measures deterministically and monotonically', () => {
		expect(measure('abc', 12)).toBe(measure('abc', 12));
		expect(measure('abcd', 12)).toBeGreaterThan(measure('abc', 12));
		expect(measure('abc', 12, 'b')).toBeGreaterThan(measure('abc', 12, 'r'));
		expect(measure('abc', 24)).toBeCloseTo(measure('abc', 12) * 2, 5);
	});
	it('wraps within the width and truncates with an ellipsis', () => {
		const lines = wrap('the quick brown fox jumps over the lazy dog again and again', 120, 12, 'r', 2);
		expect(lines.length).toBe(2);
		for (const l of lines) expect(measure(l, 12)).toBeLessThanOrEqual(120);
		expect(lines[1].endsWith('…')).toBe(true);
	});
});

describe('dropped items (revision: removed)', () => {
	const model: Model = {
		schemaVersion: 1,
		title: 'Tiny',
		views: [{ id: 'eng', kind: 'engineering', title: 'Tiny' }],
		elements: [
			{ id: 'app', kind: 'container', title: 'App', change: 'modified' },
			{ id: 'svc', kind: 'component', parent: 'app', title: 'Service', change: 'new', pattern: 'api/mutation' },
			{ id: 'old', kind: 'component', parent: 'app', title: 'Old service', change: 'new', pattern: 'api/mutation', revision: 'removed' },
			{ id: 'tbl', kind: 'data', title: 'items', change: 'reused', pattern: 'data/table' }
		],
		relationships: [
			{ id: 'w', from: 'svc', to: 'tbl', kind: 'writes', enforcement: 'platform', change: 'new' },
			{ id: 'w2', from: 'old', to: 'tbl', kind: 'writes', enforcement: 'platform', change: 'new', revision: 'removed' }
		]
	};
	const render = async (m: Model) => {
		const res = check(m);
		expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		return (await renderView(res.model!, res.profile!, { view: 'eng' })).svg;
	};
	const node = (svg: string, id: string) => svg.slice(svg.indexOf(`data-id="${id}"`)).split('data-id="')[1];

	it('draws a dropped card dashed in the dropped colour, with its badge, not the change badge', async () => {
		const old = node(await render(model), 'old');
		expect(old).toContain('>DROPPED<');
		expect(old).not.toContain('>NEW<');
		expect(old).toMatch(/stroke="#dc2626"[^>]*stroke-dasharray="6 4"/);
		// the title is struck through: a line in the title colour right after the title text
		expect(old).toMatch(/>Old service<\/text><line /);
	});

	it('draws a dropped connector dashed in the dropped colour and names both in the key', async () => {
		const svg = await render(model);
		// the connector itself: a dashed path in the dropped colour (cards are rects)
		expect(svg).toMatch(/<path [^>]*stroke="#dc2626"[^>]*stroke-dasharray=/);
		expect(svg).toContain('dropped — only in the earlier version');
		expect(svg).toContain('dropped connector — only in the earlier version');
	});

	it('leaves a model with nothing dropped as it was', async () => {
		const plain = structuredClone(model);
		plain.elements = plain.elements.filter((e) => !e.revision);
		plain.relationships = plain.relationships!.filter((r) => !r.revision);
		const svg = await render(plain);
		expect(svg).not.toContain('#dc2626');
		expect(svg).not.toContain('DROPPED');
		expect(svg).not.toContain('dropped');
	});
});

describe('bespoke', () => {
	const REASON = 'One caller; a queue would add a table for nothing.';
	const model: Model = {
		schemaVersion: 1,
		title: 'Tiny',
		views: [
			{ id: 'eng', kind: 'engineering', title: 'Tiny' },
			{ id: 'prod', kind: 'product', title: 'Tiny product', include: ['thing'] }
		],
		elements: [
			{ id: 'app', kind: 'container', title: 'App', change: 'modified' },
			{ id: 'svc', kind: 'component', parent: 'app', title: 'Service', change: 'new', bespoke: REASON },
			{
				id: 'job',
				kind: 'component',
				parent: 'app',
				title: 'Job',
				change: 'new',
				pattern: 'api/mutation',
				parts: [
					{ title: 'retry', bespoke: 'Only this job retries.', change: 'new' },
					{ title: 'guard', pattern: 'api/guard', patternFit: 'partial', change: 'new' }
				]
			},
			{ id: 'tbl', kind: 'data', title: 'items', change: 'reused', pattern: 'data/table' },
			{ id: 'thing', kind: 'product', title: 'Thing', change: 'new', bespoke: 'A concept of its own.' }
		],
		relationships: [{ id: 'w', from: 'svc', to: 'tbl', kind: 'writes', enforcement: 'platform', change: 'new' }]
	};
	const render = async (m: Model, view = 'eng', appendix = false) => {
		const res = check(m);
		expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		return renderView(res.model!, res.profile!, { view, appendix });
	};
	const node = (svg: string, id: string) => svg.slice(svg.indexOf(`data-id="${id}"`)).split('data-id="')[1];

	it('names a bespoke card above its title, boxed with a dashed outline, with a band of its own', async () => {
		const svc = node((await render(model)).svg, 'svc');
		// the dashed box, then the label inside it
		expect(svc).toMatch(/stroke-dasharray="3 2"[^>]*\/><text [^>]*>BESPOKE<\/text>/);
		expect(svc).toContain('fill="#475569"');
		expect(svc).not.toContain('NO PATTERN');
		// a card on a pattern has neither
		const tbl = node((await render(model)).svg, 'tbl');
		expect(tbl).not.toContain('BESPOKE');
	});

	it('marks a bespoke part with a chip, and a part that fits in part with the half disc', async () => {
		const job = node((await render(model)).svg, 'job');
		expect(job).toMatch(/stroke-dasharray="3 2"[^>]*\/><text [^>]*>bespoke<\/text>/);
		// the half disc of a partial fit: a circle followed by its filled half
		expect(job).toMatch(/<circle [^>]*r="4"[^>]*\/><path d="M[\d.]+ [\d.]+ A4 4 0 0 1/);
	});

	it('lists bespoke and partial fit in the key only when the page has them', async () => {
		const svg = (await render(model)).svg;
		expect(svg).toContain('Bespoke (one-off, reason stated)');
		expect(svg).toContain('Partial fit');
		const plain = structuredClone(model);
		plain.elements = plain.elements.filter((e) => !['svc', 'job', 'thing'].includes(e.id));
		plain.views = [plain.views[0]];
		plain.relationships = [];
		const without = (await render(plain)).svg;
		expect(without).not.toContain('Bespoke');
		expect(without).not.toContain('BESPOKE');
		expect(without).not.toContain('Partial fit');
	});

	it('puts a chip on a card whose identity is its area', async () => {
		const thing = node((await render(model, 'prod')).svg, 'thing');
		expect(thing).toContain('>bespoke</text>');
		expect(thing).not.toContain('>BESPOKE<');
	});

	it('gives the reasons in the appendix, with the lettered tag on the card', async () => {
		const res = await render(model, 'eng', true);
		expect(res.appendix).toContain(`- Bespoke: ${REASON}`);
		expect(res.appendix).toContain('- Bespoke part "retry": Only this job retries.');
		expect(res.appendix).toMatch(/### [A-Z] · Service/);
	});
});
