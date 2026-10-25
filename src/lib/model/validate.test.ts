import { describe, expect, it } from 'vitest';
import { check } from '../api.js';
import { defaultProfile } from '../profile/default.js';
import { resolveProfile } from '../profile/resolve.js';
import { clone, EXAMPLES, loadExample } from '../test/fixtures.js';
import type { Model } from './types.js';
import { validateModel, validateProfileSchema } from './validate.js';

const base: Model = {
	schemaVersion: 0,
	title: 'Tiny',
	views: [{ id: 'eng', kind: 'engineering', title: 'Tiny' }],
	elements: [
		{ id: 'app', kind: 'container', title: 'App', change: 'modified' },
		{ id: 'svc', kind: 'component', parent: 'app', title: 'Service', change: 'new', pattern: 'api/mutation' },
		{ id: 'tbl', kind: 'data', title: 'items', change: 'reused', pattern: 'data/table', fields: [{ id: 'a' }, { id: 'b' }] }
	],
	relationships: [{ id: 'w', from: 'svc', to: 'tbl', kind: 'writes', enforcement: 'platform', change: 'new' }]
};
const codes = (m: unknown, p?: unknown) => check(m, p).diagnostics.map((d) => d.code);

describe('examples', () => {
	for (const name of EXAMPLES)
		it(`${name} validates with no errors or warnings`, () => {
			const { model, profile } = loadExample(name);
			const res = check(model, profile);
			expect(res.diagnostics).toEqual([]);
			expect(res.ok).toBe(true);
		});
	it('default profile passes the profile schema', () => {
		expect(validateProfileSchema(defaultProfile)).toEqual([]);
	});
});

describe('schema', () => {
	it('accepts the minimal model', () => {
		expect(check(base).ok).toBe(true);
	});
	it('rejects a wrong schemaVersion and missing title', () => {
		const m = clone(base) as unknown as Record<string, unknown>;
		m.schemaVersion = 1;
		delete m.title;
		const res = check(m);
		expect(res.ok).toBe(false);
		expect(res.diagnostics.every((d) => d.code === 'model-schema')).toBe(true);
	});
	it('rejects unknown properties on elements', () => {
		const m = clone(base);
		(m.elements[0] as unknown as Record<string, unknown>).colour = 'red';
		expect(check(m).ok).toBe(false);
	});
});

describe('semantics', () => {
	it('reports duplicate ids', () => {
		const m = clone(base);
		m.elements.push({ ...m.elements[0] });
		expect(codes(m)).toContain('duplicate-id');
	});
	it('reports unknown parents and relationship ends', () => {
		const m = clone(base);
		m.elements[1].parent = 'nope';
		m.relationships![0].to = 'missing';
		const c = codes(m);
		expect(c).toContain('unknown-parent');
		expect(c).toContain('unknown-ref');
	});
	it('reports parent cycles', () => {
		const m = clone(base);
		m.elements[0].parent = 'svc';
		m.elements[0].kind = 'component';
		expect(codes(m)).toContain('parent-cycle');
	});
	it('reports kinds, patterns and enforcement missing from the profile', () => {
		const m = clone(base);
		m.elements[2].kind = 'spaceship';
		m.elements[1].pattern = 'api/unknown';
		m.relationships![0].enforcement = 'magic';
		const c = codes(m);
		expect(c).toContain('unknown-element-kind');
		expect(c).toContain('unknown-pattern');
		expect(c).toContain('unknown-enforcement');
	});
	it('accepts patterns proposed by the model', () => {
		const m = clone(base);
		m.elements[1].pattern = 'api/new-thing';
		m.proposedPatterns = [{ id: 'api/new-thing', label: 'new thing', family: 'api' }];
		expect(check(m).ok).toBe(true);
	});
	it('reports ties that name fields the element does not have', () => {
		const m = clone(base);
		m.elements[2].ties = [{ fields: ['a', 'zzz'], enforcement: 'nothing' }];
		expect(codes(m)).toContain('unknown-field');
	});
});

describe('lint', () => {
	it('warns when a data relationship does not state enforcement', () => {
		const m = clone(base);
		delete m.relationships![0].enforcement;
		const res = check(m);
		expect(res.ok).toBe(true);
		expect(res.diagnostics.map((d) => d.code)).toContain('missing-enforcement');
	});
	it('warns when change state is missing', () => {
		const m = clone(base);
		delete m.elements[1].change;
		expect(codes(m)).toContain('missing-change');
	});
	it('warns on over-budget titles', () => {
		const m = clone(base);
		m.elements[1].title = 'A very long component title that keeps going and going';
		expect(codes(m)).toContain('text-budget');
	});
	it('warns on sibling chains in views that forbid them', () => {
		const m: Model = {
			schemaVersion: 0,
			title: 'Chain',
			views: [{ id: 'p', kind: 'product', title: 'Chain' }],
			elements: [
				{ id: 'x', kind: 'product', title: 'X', change: 'reused' },
				{ id: 'a', kind: 'version', parent: 'x', title: 'A', change: 'reused' },
				{ id: 'b', kind: 'version', parent: 'x', title: 'B', change: 'reused' },
				{ id: 'c', kind: 'version', parent: 'x', title: 'C', change: 'new' }
			],
			relationships: [
				{ id: 'ab', from: 'a', to: 'b', kind: 'created-from', change: 'reused' },
				{ id: 'bc', from: 'b', to: 'c', kind: 'created-from', change: 'new' }
			]
		};
		expect(codes(m)).toContain('sibling-chain');
		m.views[0].omitRelationships = ['bc'];
		expect(codes(m)).not.toContain('sibling-chain');
	});
	it('lint severities are configurable in the profile', () => {
		const m = clone(base);
		delete m.relationships![0].enforcement;
		const profile = resolveProfile({ profileVersion: 0, id: 'strict', title: 'Strict', extends: 'default', rules: { missingEnforcement: 'error' } });
		expect(validateModel(m, profile).some((d) => d.code === 'missing-enforcement' && d.severity === 'error')).toBe(true);
	});
});
