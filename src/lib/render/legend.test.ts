import { describe, expect, it } from 'vitest';
import { check } from '../api.js';
import { loadExample } from '../test/fixtures.js';
import { buildDiagram } from './diagram.js';
import { placeLabels } from './labels.js';

async function diagram(name: string, view: string) {
	const { model, profile } = loadExample(name);
	const res = check(model, profile);
	return buildDiagram(res.model!, res.profile!, { view });
}

describe('buildLegend', () => {
	it('lists exactly the patterns on the page, card patterns before tag-only ones, with counts', async () => {
		const d = await diagram('paged-reads', 'engineering');
		const pats = d.legend.sections.find((s) => s.id === 'patterns')!;
		expect(pats.title).toBe('Card colour = pattern');
		const ids = pats.items.map((i) => i.id);
		const onPage = new Set(d.nodes.flatMap((n) => [n.el?.pattern, ...(n.el?.patterns ?? []), ...(n.el?.parts ?? []).map((p) => p.pattern)]).filter((p): p is string => !!p));
		for (const p of onPage) expect(ids).toContain(`pattern:${p}`);
		const tagOnly = pats.items.findIndex((i) => i.label.endsWith('(tag only)'));
		if (tagOnly >= 0) expect(pats.items.slice(tagOnly).every((i) => i.label.endsWith('(tag only)') || !i.id.startsWith('pattern:') || i.id === 'pattern:none' || i.id === 'pattern:partial')).toBe(true);
		for (const i of pats.items) if (i.count) expect(i.count).toBeGreaterThan(0);
	});

	it('merges connectors that look the same and says what line colour means', async () => {
		const d = await diagram('paged-reads', 'engineering');
		const edges = d.legend.sections.find((s) => s.id === 'edges')!;
		expect(edges.title).toBe('Line colour = who enforces');
		const swatches = edges.items.map((i) => i.swatch);
		expect(new Set(swatches).size).toBe(swatches.length);
		// every edge style on the page is reachable from some legend filter
		const keys = new Set(edges.items.flatMap((i) => i.filter!.split(',')));
		for (const e of d.edges) expect(keys.has(`edge:${e.style.key}`), e.id).toBe(true);
	});

	it('only lists change states that occur', async () => {
		const d = await diagram('versioned-wiring', 'product');
		const change = d.legend.sections.find((s) => s.id === 'change');
		const states = new Set(change?.items.map((i) => i.id.replace('change:', '')));
		for (const s of states) expect(['new', 'modified', 'reused', 'removed']).toContain(s);
		expect(states.size).toBeGreaterThan(0);
	});
});

describe('placeLabels', () => {
	it('moves a label off a card and away from an earlier label', () => {
		const line = [
			{ x: 0, y: 0 },
			{ x: 0, y: 200 }
		];
		const card = { x: -100, y: 60, width: 200, height: 80 };
		const boxes = placeLabels(
			[
				{ id: 'a', points: line, width: 60, height: 20 },
				{ id: 'b', points: line, width: 60, height: 20 }
			],
			{ nodes: [card], headers: [], edges: new Map() }
		);
		const a = boxes.get('a')!;
		const b = boxes.get('b')!;
		const hits = (r: typeof a, q: typeof a) => r.x < q.x + q.width && q.x < r.x + r.width && r.y < q.y + q.height && q.y < r.y + r.height;
		expect(hits(a, card)).toBe(false);
		expect(hits(b, card)).toBe(false);
		expect(hits(a, b)).toBe(false);
		expect(boxes.collisions).toBe(0);
	});
});
