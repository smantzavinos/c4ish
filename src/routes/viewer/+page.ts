import profile from '../../../examples/profile.c4ish.json';
import pagedReads from '../../../examples/paged-reads/model.c4ish.json';
import versionedWiring from '../../../examples/versioned-wiring/model.c4ish.json';

export const prerender = true;
// The viewer lays out in the browser (ELK runs client-side); the shell is prerendered.
export const ssr = false;
export const trailingSlash = 'always';

export const load = () => ({
	examples: [
		{ id: 'paged-reads', label: 'Example · paged reads', model: pagedReads as unknown, profile: profile as unknown },
		{ id: 'versioned-wiring', label: 'Example · versioned wiring', model: versionedWiring as unknown, profile: profile as unknown }
	]
});
