import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check } from '../api.js';
import { defaultProfile } from '../profile/default.js';
import { resolveProfile } from '../profile/resolve.js';
import { clone, EXAMPLES, loadExample } from '../test/fixtures.js';
import type { Model } from './types.js';
import { validateModel, validateProfileSchema } from './validate.js';

const base: Model = {
	schemaVersion: 1,
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

describe('authoring guide', () => {
	it('its complete example validates with no errors or warnings', () => {
		const guide = readFileSync('docs/AUTHORING.md', 'utf8');
		const blocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.includes('"schemaVersion"'));
		expect(blocks).toHaveLength(1);
		expect(check(JSON.parse(blocks[0])).diagnostics).toEqual([]);
	});
});

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
		m.schemaVersion = 0;
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
	it('reports a member name used twice inside one element', () => {
		const dup = (edit: (m: Model) => void) => {
			const m = clone(base);
			edit(m);
			return check(m)
				.diagnostics.filter((d) => d.code === 'duplicate-id')
				.map((d) => d.message);
		};
		const tbl = (m: Model) => m.elements[2];
		const loose = { enforcement: 'nothing' };
		expect(dup((m) => void tbl(m).fields!.push({ id: 'a' }))).toEqual(['field "a" appears more than once in "tbl"']);
		expect(dup((m) => void (tbl(m).indexes = [{ id: 'i', fields: ['a'] }, { id: 'i', fields: ['b'] }]))).toEqual(['index "i" appears more than once in "tbl"']);
		// a tie without an id is named by its pair of fields, in either order
		expect(dup((m) => void (tbl(m).ties = [{ fields: ['a', 'b'], ...loose }, { fields: ['b', 'a'], ...loose }]))).toEqual(['tie "a~b" appears more than once in "tbl"']);
		expect(dup((m) => void (tbl(m).ties = [{ id: 't1', fields: ['a', 'b'], ...loose }, { id: 't2', fields: ['b', 'a'], ...loose }]))).toEqual([]);
		// a part without an id is named by its title
		expect(dup((m) => void (m.elements[1].parts = [{ title: 'Reader' }, { title: 'Reader' }]))).toEqual(['part "Reader" appears more than once in "svc"']);
		expect(dup((m) => void (m.elements[1].parts = [{ id: 'r1', title: 'Reader' }, { id: 'r2', title: 'Reader' }]))).toEqual([]);
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
			schemaVersion: 1,
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

describe('code references', () => {
	it('accepts a file, a name and a nested name on an element and on a part', () => {
		const m = clone(base);
		m.elements[1].code = ['src/svc.ts#save', 'src/svc.ts#Service.save', 'src/svc.json'];
		m.elements[1].parts = [{ title: 'guard', code: ['src/guard.ts#check'] }];
		expect(codes(m)).toEqual([]);
	});
	it('rejects text that is not a reference, and a repeated one', () => {
		const m = clone(base);
		m.elements[1].code = ['/abs/svc.ts', 'src/svc.ts#', 'src/a.ts', 'src/a.ts'];
		m.elements[1].parts = [{ title: 'guard', code: ['../guard.ts'] }];
		expect(codes(m)).toEqual(['invalid-code-ref', 'invalid-code-ref', 'invalid-code-ref', 'invalid-code-ref']);
	});
	it('no longer accepts the old `sources` field', () => {
		const m = clone(base);
		(m.elements[1] as unknown as Record<string, unknown>).sources = ['src/svc.ts'];
		expect(codes(m)).toEqual(['model-schema']);
	});
});

describe('bespoke', () => {
	const svc = (m: Model) => m.elements[1];
	const bespoke = (edit: (m: Model) => void) => {
		const m = clone(base);
		delete svc(m).pattern;
		svc(m).bespoke = 'One caller; the queue pattern would add a table for nothing.';
		edit(m);
		return check(m).diagnostics.map((d) => `${d.code}: ${d.message}`);
	};
	it('stands in place of a pattern, with a reason', () => {
		expect(bespoke(() => {})).toEqual([]);
		// further patterns may still apply
		expect(bespoke((m) => void (svc(m).patterns = ['api/guard']))).toEqual([]);
	});
	it('needs a reason', () => {
		expect(bespoke((m) => void (svc(m).bespoke = ''))).toEqual(['model-schema: must NOT have fewer than 1 characters']);
		expect(bespoke((m) => void (svc(m).bespoke = '  '))).toEqual(['bespoke-without-reason: element is bespoke but gives no reason']);
	});
	it('cannot stand beside a pattern, "no pattern" or a fit', () => {
		expect(bespoke((m) => void (svc(m).pattern = 'api/mutation'))).toEqual(['bespoke-with-pattern: element is bespoke and also states pattern "api/mutation"; state one']);
		expect(bespoke((m) => void (svc(m).pattern = null))).toEqual(['bespoke-with-pattern: element is bespoke and also states no pattern; state one']);
		expect(bespoke((m) => void (svc(m).patternFit = 'partial'))).toEqual(['bespoke-with-pattern: element is bespoke and also states a pattern fit; a fit belongs to a pattern']);
	});
	it('holds for a part as for an element', () => {
		expect(bespoke((m) => void (svc(m).parts = [{ title: 'retry', bespoke: 'Only this caller retries.' }, { title: 'guard', pattern: 'api/guard', patternFit: 'partial' }]))).toEqual([]);
		expect(bespoke((m) => void (svc(m).parts = [{ title: 'retry', bespoke: 'x', pattern: 'api/guard' }]))).toEqual([
			'bespoke-with-pattern: part "retry" is bespoke and also states pattern "api/guard"; state one'
		]);
	});
});

describe('missing pattern', () => {
	const missing = (edit: (m: Model) => void, profile?: unknown) => {
		const m = clone(base);
		edit(m);
		return check(m, profile)
			.diagnostics.filter((d) => d.code === 'missing-pattern')
			.map((d) => `${d.severity} ${d.at}: ${d.message}`);
	};
	const svc = (m: Model) => m.elements[1];
	it('warns on new or modified code or data that states neither a pattern nor bespoke', () => {
		expect(missing((m) => void delete svc(m).pattern)).toEqual(['warning svc: new component states neither a pattern nor "bespoke" with a reason']);
		expect(
			missing((m) => {
				delete m.elements[2].pattern;
				m.elements[2].change = 'modified';
			})
		).toEqual(['warning tbl: modified data states neither a pattern nor "bespoke" with a reason']);
	});
	it('accepts a pattern, "no pattern", bespoke, or parts that each state one', () => {
		expect(missing(() => {})).toEqual([]);
		expect(missing((m) => void (svc(m).pattern = null))).toEqual([]);
		expect(
			missing((m) => {
				delete svc(m).pattern;
				svc(m).bespoke = 'One-off.';
			})
		).toEqual([]);
		const parts = (second: object) => (m: Model) => {
			delete svc(m).pattern;
			svc(m).parts = [{ title: 'a', pattern: 'api/guard' }, { title: 'b', ...second }];
		};
		expect(missing(parts({ bespoke: 'One-off.' }))).toEqual([]);
		expect(missing(parts({}))).toEqual(['warning svc: new component states neither a pattern nor "bespoke" with a reason (on itself or on each of its parts)']);
	});
	it('leaves alone what is unchanged, removed, or not code or data', () => {
		expect(
			missing((m) => {
				delete svc(m).pattern;
				svc(m).change = 'reused';
			})
		).toEqual([]);
		expect(
			missing((m) => {
				delete svc(m).pattern;
				svc(m).change = 'removed';
				m.relationships![0].change = 'removed';
			})
		).toEqual([]);
		// the container is modified and has no pattern
		expect(missing(() => {})).toEqual([]);
		expect(missing((m) => void m.elements.push({ id: 'who', kind: 'person', title: 'Clerk', change: 'new' }))).toEqual([]);
	});
	it('follows the category of the kind and the severity of the rule in the profile', () => {
		const profile = (extra: object) => ({ profileVersion: 0, id: 'p', title: 'P', extends: 'default', ...extra });
		const job = (m: Model) => void m.elements.push({ id: 'job', kind: 'job', parent: 'app', title: 'Nightly job', change: 'new' });
		expect(missing(job, profile({ elementKinds: { job: { label: 'Job' } } }))).toEqual([]);
		expect(missing(job, profile({ elementKinds: { job: { label: 'Job', category: 'code' } } }))).toEqual(['warning job: new job states neither a pattern nor "bespoke" with a reason']);
		const drop = (m: Model) => void delete svc(m).pattern;
		expect(missing(drop, profile({ rules: { missingPattern: 'error' } }))).toEqual(['error svc: new component states neither a pattern nor "bespoke" with a reason']);
		expect(missing(drop, profile({ rules: { missingPattern: 'off' } }))).toEqual([]);
		expect(codes(clone(base), profile({ elementKinds: { job: { label: 'Job', category: 'thing' } } }))).toEqual(['profile-schema']);
	});
});

describe('scenarios', () => {
	const step = (scenarios?: string[]) => ({ id: 's', title: 'S', view: 'eng', focus: ['app', 'svc', 'w'], ...(scenarios && { scenarios }) });
	const withScenarios = (ids: string[], walked?: string[], tour = true): Model => ({
		...clone(base),
		scenarios: ids.map((id) => ({ id, title: `Scenario ${id}` })),
		...(tour && { tours: [{ id: 'review', title: 'Review', steps: [step(walked)] }] })
	});
	const said = (m: Model, profile?: unknown) => check(m, profile).diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`);
	it('pass when a step walks each', () => {
		expect(said(withScenarios(['S1', 'S2'], ['S1', 'S2']))).toEqual([]);
	});
	it('reports a scenario no step walks, with or without a tour', () => {
		const unwalked = 'warning scenario-coverage: scenario "Scenario S2" (S2) is walked by no tour step — name it in the "scenarios" of the steps that show it';
		expect(said(withScenarios(['S1', 'S2'], ['S1']))).toEqual([unwalked]);
		expect(said(withScenarios(['S2'], undefined, false))).toEqual([unwalked]);
	});
	it('counts a step of any tour', () => {
		const m = withScenarios(['S1', 'S2'], ['S1']);
		m.tours!.push({ id: 'second', title: 'Second', steps: [step(['S2'])] });
		expect(said(m)).toEqual([]);
	});
	it('rejects a step that names a scenario the model does not have, and an id used twice', () => {
		expect(said(withScenarios(['S1'], ['S1', 'S9']))).toEqual(['error unknown-ref: scenario "S9" is not in the model\'s scenarios']);
		expect(said(withScenarios(['S1', 'S1'], ['S1']))).toEqual(['error duplicate-id: scenario id "S1" is not unique']);
	});
	it('takes its severity from the tour coverage rule', () => {
		const profile = (tourCoverage: string) => ({ profileVersion: 0, id: 'p', title: 'P', extends: 'default', rules: { tourCoverage } });
		expect(said(withScenarios(['S1']), profile('error')).map((d) => d.split(':')[0])).toEqual(['error scenario-coverage']);
		expect(said(withScenarios(['S1']), profile('off'))).toEqual([]);
	});
});

describe('a profile that replaces a catalog', () => {
	const own = { patternFamilies: { svc: { label: 'Service', icon: 'query', colour: '#2563eb' } }, patterns: { 'svc/job': { label: 'job', family: 'svc' } } };
	const profile = (replaces?: string[]) => ({ profileVersion: 0, id: 'p', title: 'P', extends: 'default', ...(replaces && { replaces }), ...own });
	it('adds to the default without `replaces`, and holds only its own entries in each catalog it replaces', () => {
		const added = resolveProfile(profile() as never);
		expect(Object.keys(added.patterns)).toContain('api/read-query');
		expect(Object.keys(added.patterns)).toContain('svc/job');
		const replaced = resolveProfile(profile(['patterns', 'patternFamilies']) as never);
		expect(Object.keys(replaced.patterns)).toEqual(['svc/job']);
		expect(Object.keys(replaced.patternFamilies)).toEqual(['svc']);
		// the other catalogs still come from the default
		expect(replaced.elementKinds).toEqual(defaultProfile.elementKinds);
		expect(replaced.replaces).toEqual(['patterns', 'patternFamilies']);
	});
	it('makes a dropped pattern unknown to a model', () => {
		const m = clone(base);
		expect(m.elements.some((e) => e.pattern === 'api/mutation')).toBe(true);
		expect(codes(m, profile())).not.toContain('unknown-ref');
		const res = check(m, profile(['patterns', 'patternFamilies']));
		expect(res.ok).toBe(false);
		expect(res.diagnostics.some((d) => d.severity === 'error' && d.message.includes('api/mutation'))).toBe(true);
	});
	it('is rejected when it leaves a pattern without its family, or names something that is not a catalog', () => {
		const res = check(base, profile(['patternFamilies']));
		expect(res.diagnostics.filter((d) => d.code === 'unknown-pattern-family').map((d) => d.at)).toContain('profile:pattern:api/read-query');
		expect(res.ok).toBe(false);
		expect(check(base, profile(['rules'])).ok).toBe(false);
	});
});

describe('pattern reference implementations', () => {
	const profile = (code: string[]) => ({ profileVersion: 0, id: 'p', title: 'P', extends: 'default', patterns: { 'api/job': { label: 'job', family: 'api', code } } });
	it('are code references, on a pattern of the profile and on a proposed one', () => {
		expect(codes(base, profile(['src/jobs/nightly.ts#run', 'src/jobs/README.md']))).toEqual([]);
		const m = clone(base);
		m.proposedPatterns = [{ id: 'api/new-thing', label: 'new thing', family: 'api', code: ['src/thing.ts#Thing.make'] }];
		expect(codes(m)).toEqual([]);
	});
	it('are rejected when they are not references', () => {
		const res = check(base, profile(['/abs/nightly.ts', 'src/a.ts', 'src/a.ts']));
		expect(res.ok).toBe(false);
		expect(res.diagnostics.map((d) => `${d.code} ${d.at}`)).toEqual(['invalid-code-ref profile:pattern:api/job', 'invalid-code-ref profile:pattern:api/job']);
		const m = clone(base);
		m.proposedPatterns = [{ id: 'api/new-thing', label: 'new thing', family: 'api', code: ['src/thing.ts#'] }];
		expect(check(m).diagnostics.map((d) => `${d.code} ${d.at}`)).toEqual(['invalid-code-ref api/new-thing']);
	});
});
