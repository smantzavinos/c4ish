import { describe, expect, it } from 'vitest';
import { check } from '../api.js';
import { buildDiagram, type Diagram } from '../render/diagram.js';
import { loadExample } from '../test/fixtures.js';
import { classify, initialState, isHighlighted, itemKeys, neighbourhood, toggleHighlight } from './state.js';

async function diagram(name: string, view: string): Promise<Diagram> {
	const { model, profile } = loadExample(name);
	const res = check(model, profile);
	return buildDiagram(res.model!, res.profile!, { view });
}

describe('viewer filter state', () => {
	it('toggles multi-key legend filters on and off', () => {
		let s = initialState();
		s = toggleHighlight(s, 'edge:kind:calls,edge:kind:saves');
		expect(isHighlighted(s, 'edge:kind:calls,edge:kind:saves')).toBe(true);
		expect(isHighlighted(s, 'edge:kind:calls')).toBe(true);
		s = toggleHighlight(s, 'edge:kind:calls,edge:kind:saves');
		expect(s.highlight).toEqual([]);
	});

	it('highlighting a pattern keeps its cards (and edges between them) and dims the rest', async () => {
		const d = await diagram('paged-reads', 'engineering');
		const keys = itemKeys(d);
		const withPattern = d.nodes.find((n) => n.el?.pattern)!;
		const key = `pattern:${withPattern.el!.pattern}`;
		const em = classify(d, toggleHighlight(initialState(), key), keys);
		expect(em.get(withPattern.id)).toBe('normal');
		for (const n of d.nodes) expect(em.get(n.id)).toBe(keys.get(n.id)!.has(key) ? 'normal' : 'dim');
		for (const e of d.edges) {
			const between = keys.get(e.from)?.has(key) && keys.get(e.to)?.has(key);
			if (between) expect(em.get(e.id)).toBe('normal');
		}
	});

	it('highlighting an enforcement style keeps those edges and their two ends', async () => {
		const d = await diagram('paged-reads', 'engineering');
		const e = d.edges.find((x) => x.style.key.startsWith('enf:'))!;
		const em = classify(d, toggleHighlight(initialState(), `edge:${e.style.key}`));
		expect(em.get(e.id)).toBe('normal');
		expect(em.get(e.from)).toBe('normal');
		expect(em.get(e.to)).toBe('normal');
	});

	it('hover focuses the neighbourhood and dims everything else', async () => {
		const d = await diagram('versioned-wiring', 'engineering');
		const e = d.edges[0];
		const em = classify(d, { ...initialState(), hover: e.from });
		const near = neighbourhood(d, e.from);
		expect(near.has(e.id)).toBe(true);
		for (const [id, v] of em) expect(v).toBe(near.has(id) ? 'focus' : 'dim');
	});

	it('"only changes" hides reused items', async () => {
		const d = await diagram('paged-reads', 'engineering');
		const keys = itemKeys(d);
		const em = classify(d, { ...initialState(), onlyChanges: true }, keys);
		for (const [id, k] of keys) expect(em.get(id)).toBe(k.has('change:reused') ? 'hidden' : 'normal');
		expect([...em.values()]).toContain('hidden');
	});
});
