import type { Profile } from '../model/types.js';

/**
 * The generic c4ish default profile. Projects extend it (`"extends": "default"`)
 * and add their own pattern catalog, kinds and notation.
 */
export const defaultProfile: Profile = {
	profileVersion: 0,
	id: 'default',
	title: 'c4ish default',
	elementKinds: {
		system: { label: 'System', icon: 'system' },
		container: { label: 'Container', icon: 'container' },
		component: { label: 'Component', icon: 'component', parents: ['container', 'system', 'component'] },
		data: { label: 'Data', icon: 'table' },
		store: { label: 'Data store', icon: 'store' },
		external: { label: 'External system', icon: 'external' },
		person: { label: 'Person', icon: 'person' },
		library: { label: 'Library', role: 'library', icon: 'library' },
		product: { label: 'Product concept', icon: 'concept', area: 'product' },
		version: { label: 'Version', icon: 'version', area: 'product' },
		configuration: { label: 'Configuration', icon: 'configuration', area: 'system' },
		page: { label: 'Page', icon: 'page', area: 'product' }
	},
	patternFamilies: {
		web: { label: 'Web', icon: 'page', colour: '#2563eb' },
		api: { label: 'API', icon: 'gear', colour: '#7c3aed' },
		data: { label: 'Data', icon: 'table', colour: '#0f766e' },
		security: { label: 'Security', icon: 'guard', colour: '#be185d' },
		integration: { label: 'Integration', icon: 'link', colour: '#0369a1' }
	},
	patterns: {
		'web/page': { label: 'page', family: 'web', icon: 'page' },
		'web/form-action': { label: 'form action', family: 'web', icon: 'route' },
		'api/read-query': { label: 'read query', family: 'api', icon: 'query' },
		'api/mutation': { label: 'mutation', family: 'api', icon: 'mutation' },
		'api/guard': { label: 'access guard', family: 'security', icon: 'guard' },
		'data/table': { label: 'table', family: 'data', icon: 'table' },
		'data/join-table': { label: 'join table', family: 'data', icon: 'join' },
		'data/secret': { label: 'deployment secret', family: 'security', icon: 'secret' }
	},
	relationshipKinds: {
		calls: { label: 'calls', category: 'runtime', arrow: 'filled' },
		subscribes: { label: 'subscribes (live)', category: 'runtime', arrow: 'open' },
		submits: { label: 'submits', category: 'runtime', arrow: 'filled' },
		uses: { label: 'uses', category: 'runtime', arrow: 'filled' },
		composes: { label: 'composes', category: 'runtime', arrow: 'none' },
		authorizes: { label: 'checks with', category: 'runtime', arrow: 'filled' },
		reads: { label: 'reads', category: 'data', arrow: 'filled', enforcementRequired: true },
		writes: { label: 'writes', category: 'data', arrow: 'filled', enforcementRequired: true },
		references: { label: 'references', category: 'data', arrow: 'filled', enforcementRequired: true },
		pins: { label: 'pins version', category: 'data', arrow: 'filled', enforcementRequired: true },
		'replaced-by': { label: 'replaced by', category: 'lifecycle', arrow: 'open', line: 'long-dash' },
		provides: { label: 'provides', category: 'reference', arrow: 'filled', colour: '#b45309' },
		requires: { label: 'requires', category: 'reference', arrow: 'filled', colour: '#b45309' },
		'created-from': { label: 'created from', category: 'reference', arrow: 'filled', colour: '#2563eb' },
		'traces-to': { label: 'traces to', category: 'trace', arrow: 'filled', colour: '#7c3aed' },
		selects: { label: 'selects', category: 'reference', arrow: 'diamond', line: 'dashed', colour: '#475569' }
	},
	enforcement: {
		platform: {
			label: 'platform enforces',
			description: 'A bad state is rejected by the platform (type, constraint, transaction).',
			colour: '#059669',
			line: 'solid'
		},
		'platform-correlated': {
			label: 'platform enforces the pair',
			colour: '#059669',
			line: 'double'
		},
		'our-code': {
			label: 'our code enforces',
			description: 'Holds only if every write path calls the check.',
			colour: '#b45309',
			line: 'dashed'
		},
		nothing: {
			label: 'nothing enforces',
			description: 'Correctness rests on convention.',
			colour: '#be123c',
			line: 'dotted'
		},
		derived: { label: 'derived / redundant', colour: '#94a3b8', line: 'long-dash', width: 1.25 }
	},
	changeStates: {
		new: { label: 'new', style: 'new', badge: 'NEW' },
		modified: { label: 'modified', style: 'modified', badge: 'MODIFIED' },
		reused: { label: 'reused (context)', style: 'reused' },
		removed: { label: 'removed', style: 'removed', badge: 'REMOVED' }
	},
	lifecycle: {
		draft: { label: 'draft', border: 'dashed', colour: '#d97706', fill: '#fffbeb', glyph: 'none' },
		released: { label: 'released', border: 'solid', colour: '#475569', fill: '#f1f5f9', glyph: 'lock' }
	},
	areas: {
		product: { label: 'Product model', colour: '#2563eb', fill: '#eff6ff' },
		system: { label: 'System model', colour: '#0f766e', fill: '#f0fdfa' }
	},
	views: {
		engineering: {
			label: 'Engineering',
			corners: 'sharp',
			colour: { nodes: 'none', edges: 'enforcement', meaning: 'Colour = who enforces a data relationship' },
			direction: 'down'
		},
		product: {
			label: 'Product',
			corners: 'rounded',
			colour: { nodes: 'area', edges: 'kind', meaning: 'Colour = model area and relationship kind' },
			forbidSiblingChains: true,
			direction: 'down'
		},
		patterns: {
			label: 'Pattern map',
			corners: 'sharp',
			colour: { nodes: 'pattern', edges: 'none', meaning: 'Colour = pattern family' },
			direction: 'right'
		}
	},
	rules: {
		missingEnforcement: 'warning',
		missingChange: 'warning',
		siblingChains: 'warning',
		textBudget: 'warning',
		removedWithLiveEdges: 'warning',
		titleMaxChars: 40,
		subtitleMaxChars: 64,
		labelMaxChars: 40
	},
	divergenceColour: '#be123c'
};
