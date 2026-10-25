import { check, renderView } from '../lib/index.js';
import profile from '../../examples/profile.c4ish.json';
import pagedReads from '../../examples/paged-reads/model.c4ish.json';
import versionedWiring from '../../examples/versioned-wiring/model.c4ish.json';
import type { PageLoad } from './$types';

export const prerender = true;

const examples = [
	{ id: 'paged-reads', json: pagedReads as unknown },
	{ id: 'versioned-wiring', json: versionedWiring as unknown }
];

export const load: PageLoad = async () => {
	const diagrams = [];
	for (const ex of examples) {
		const res = check(ex.json, profile);
		if (!res.model || !res.profile) {
			diagrams.push({ example: ex.id, view: '-', title: ex.id, svg: '', diagnostics: res.diagnostics.map((d) => d.message) });
			continue;
		}
		for (const v of res.model.views) {
			const r = await renderView(res.model, res.profile, { view: v.id, idPrefix: `${ex.id}-${v.id}-` });
			diagrams.push({ example: ex.id, view: v.id, title: v.title, svg: r.svg, diagnostics: res.diagnostics.map((d) => d.message) });
		}
	}
	return { diagrams };
};
