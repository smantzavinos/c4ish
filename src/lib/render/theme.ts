/** Design tokens from docs/VISUAL_SPEC.md. */
export const C = {
	ink: '#0f172a',
	inkBand: '#1e293b',
	graphite: '#334155',
	slate: '#475569',
	muted: '#64748b',
	faint: '#94a3b8',
	line: '#cbd5e1',
	hairline: '#e2e8f0',
	surface: '#f8fafc',
	white: '#ffffff',
	modifiedBand: '#e2e8f0',
	runtime: '#64748b',
	missing: '#c026d3'
} as const;

export const T = {
	viewTitle: 22,
	viewSubtitle: 13.5,
	frameTitle: 11.5,
	frameSubtitle: 11,
	nodeTitle: 13,
	nodeSubtitle: 11.5,
	chip: 10,
	field: 11,
	fieldType: 10,
	edgeLabel: 10.5,
	calloutTitle: 12,
	calloutBody: 11.5,
	key: 11,
	footnote: 10.5
} as const;

export const S = {
	nodeMinW: 196,
	nodeMaxW: 272,
	nodePad: 10,
	iconTile: 18,
	chipH: 17,
	chipGap: 4,
	rowGap: 5,
	fieldRow: 19,
	frameHeader: 30,
	framePad: 16,
	margin: 32,
	calloutW: 300,
	radiusSharp: 2,
	radiusRounded: 10
} as const;
