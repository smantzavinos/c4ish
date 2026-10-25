/**
 * Built-in glyphs, drawn as SVG paths in a 16×16 box (stroke-based, no emoji, no fonts).
 * Profiles refer to them by name. Unknown names fall back to "component".
 */
export const ICONS: Record<string, string> = {
	// structure
	system: 'M2 3h12v10H2z M2 6h12',
	container: 'M2.5 3.5h11v9h-11z M2.5 6.5h11 M4.5 5h0.01 M6.5 5h0.01',
	component: 'M3 4h10v8H3z M1.5 6h3 M1.5 10h3',
	external: 'M3 3h10v10H3z M6 10l4-4 M7 6h3v3',
	person: 'M8 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M3 14c0-3 2.2-5 5-5s5 2 5 5',
	library: 'M6 2.5c-2 0-2 1-2 2.5s-1 2.5-2 3c1 .5 2 1.5 2 3s0 2.5 2 2.5 M10 2.5c2 0 2 1 2 2.5s1 2.5 2 3c-1 .5-2 1.5-2 3s0 2.5-2 2.5',
	// data
	table: 'M2 3h12v10H2z M2 6.3h12 M2 9.6h12 M6.5 3v10',
	join: 'M2 3h12v10H2z M2 6.3h12 M2 9.6h12 M3.3 3v10',
	store: 'M2.5 4c0-1.1 2.5-2 5.5-2s5.5.9 5.5 2v8c0 1.1-2.5 2-5.5 2s-5.5-.9-5.5-2z M2.5 4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2',
	secret: 'M5.5 10.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6z M8.3 7.5h6 M12 7.5v2.5 M14 7.5v2',
	document: 'M4 2h5.5L12 4.5V14H4z M9.5 2v2.5H12 M6 8h4 M6 10.5h4',
	// web
	page: 'M2 3h12v10H2z M2 5.8h12 M3.8 4.4h0.01 M5.4 4.4h0.01 M4.5 8.5h7 M4.5 11h4.5',
	route: 'M8 14V2 M8 3.5h5l1.5 1.5-1.5 1.5H8 M8 8.5H3L1.5 10 3 11.5h5',
	adapter: 'M5 2v4 M11 2v4 M3.5 6h9v2.5a4.5 4.5 0 0 1-9 0z M8 13v1.5',
	frame: 'M2 2.5h12v11H2z M2 5.5h12 M5.5 5.5v8',
	picker: 'M2.5 3.5h11v3h-11z M2.5 9.5h11v3h-11z M4 5h0.01 M4 11h0.01 M6 5h6',
	history: 'M3 8a5 5 0 1 0 1.5-3.6 M2.5 2.5v2.4h2.4 M8 5v3.2l2 1.3',
	// backend
	query: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z M10.3 10.3L14 14',
	mutation: 'M3 13l1-3.5 7-7 2.5 2.5-7 7z M9.5 4l2.5 2.5',
	guard: 'M8 1.8l5 2v4c0 3.2-2.2 5.3-5 6.4-2.8-1.1-5-3.2-5-6.4v-4z M5.8 8l1.6 1.6 3-3.2',
	merge: 'M3 2.5v3c0 2.5 5 2.5 5 5v3 M13 2.5v3c0 2.5-5 2.5-5 5 M6 11.5l2 2.2 2-2.2',
	filter: 'M2 3h12l-4.5 5.5V13l-3 1.2V8.5z',
	cursor: 'M3 8h7 M7.5 5l3 3-3 3 M12.5 3v10',
	seal: 'M4.5 7V5a3.5 3.5 0 0 1 7 0v2 M3 7h10v7H3z M8 9.5v2',
	compare: 'M2.5 3h4.5v10H2.5z M9 3h4.5v10H9z M4 6h1.5 M10.5 6h1.5 M4 8.5h1.5 M10.5 8.5h1.5',
	gear: 'M8 10.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4',
	terminal: 'M2 3h12v10H2z M4.5 6.5l2 1.8-2 1.8 M8 10.5h3.5',
	link: 'M6.8 9.2l2.4-2.4 M7.5 4.8l1.3-1.3a2.6 2.6 0 0 1 3.7 3.7l-1.3 1.3 M8.5 11.2l-1.3 1.3a2.6 2.6 0 0 1-3.7-3.7l1.3-1.3',
	queue: 'M2 4.5h12 M2 8h12 M2 11.5h12 M12 2.5l2 2-2 2',
	clock: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M8 4.5V8l2.5 1.5',
	// product
	concept: 'M8 2l5.5 3v6L8 14l-5.5-3V5z M2.5 5L8 8l5.5-3 M8 8v6',
	version: 'M2 5.5h12v5H2z M4.5 8h0.01 M7 8h5',
	configuration: 'M2.5 2.5h11v11h-11z M5 5.5h6 M5 8h6 M5 10.5h4',
	flow: 'M2 8h3 M11 8h3 M5 5.5h6v5H5z M12.5 6.5L14 8l-1.5 1.5'
};

export function iconPath(name: string | undefined): string {
	return (name && ICONS[name]) || ICONS.component;
}

export const ICON_NAMES = Object.keys(ICONS);
