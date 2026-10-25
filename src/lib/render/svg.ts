/** Minimal SVG string helpers (no DOM). */

export function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type AttrValue = string | number | undefined | null | false;

export function attrs(a: Record<string, AttrValue>): string {
	let out = '';
	for (const [k, v] of Object.entries(a)) {
		if (v === undefined || v === null || v === false) continue;
		const val = typeof v === 'number' ? fmt(v) : v;
		out += ` ${k}="${esc(String(val))}"`;
	}
	return out;
}

export function fmt(n: number): string {
	return String(Math.round(n * 100) / 100);
}

export function el(tag: string, a: Record<string, AttrValue>, children?: string): string {
	return children === undefined ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${children}</${tag}>`;
}

export interface TextOpts {
	size: number;
	weight?: number;
	fill: string;
	anchor?: 'start' | 'middle' | 'end';
	italic?: boolean;
	letterSpacing?: number;
	opacity?: number;
}

export function text(x: number, y: number, s: string, o: TextOpts): string {
	return el(
		'text',
		{
			x,
			y,
			'font-size': o.size,
			'font-weight': o.weight && o.weight !== 400 ? o.weight : undefined,
			'font-style': o.italic ? 'italic' : undefined,
			'text-anchor': o.anchor && o.anchor !== 'start' ? o.anchor : undefined,
			'letter-spacing': o.letterSpacing ? `${fmt(o.letterSpacing)}em` : undefined,
			fill: o.fill,
			opacity: o.opacity
		},
		esc(s)
	);
}

export function rect(x: number, y: number, w: number, h: number, a: Record<string, AttrValue> = {}): string {
	return el('rect', { x, y, width: w, height: h, ...a });
}

export function line(x1: number, y1: number, x2: number, y2: number, a: Record<string, AttrValue>): string {
	return el('line', { x1, y1, x2, y2, ...a });
}

export function g(children: string, a: Record<string, AttrValue> = {}): string {
	return `<g${attrs(a)}>${children}</g>`;
}

export function translate(x: number, y: number): string {
	return `translate(${fmt(x)},${fmt(y)})`;
}
