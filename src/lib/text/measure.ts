import { NOTO_SANS_WIDTHS } from './metrics.js';

/** r = 400, m = 500, s = 600 (semibold), b = 700, i = 400 italic. */
export type FontStyle = 'r' | 'm' | 's' | 'b' | 'i';

export const FONT_FAMILY = "'Noto Sans', 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";

/** Widths are inflated slightly so a fallback font rarely overflows its box. */
const SAFETY = 1.03;
/** Width (1/1000 em) for glyphs missing from the table (wide symbols, CJK): conservative. */
const FALLBACK = 700;

const tables = new Map<FontStyle, Map<number, number>>();

function table(style: FontStyle): Map<number, number> {
	let t = tables.get(style);
	if (!t) {
		t = new Map();
		for (const pair of NOTO_SANS_WIDTHS[style].split(',')) {
			const [c, w] = pair.split(':');
			t.set(parseInt(c, 36), parseInt(w, 36));
		}
		tables.set(style, t);
	}
	return t;
}

/** Advance width of `text` in px at `size`, optionally with letter spacing in em. */
export function measure(text: string, size: number, style: FontStyle = 'r', letterSpacingEm = 0): number {
	const t = table(style);
	let units = 0;
	let n = 0;
	for (const ch of text) {
		units += t.get(ch.codePointAt(0)!) ?? FALLBACK;
		n++;
	}
	return (units / 1000) * size * SAFETY + n * letterSpacingEm * size;
}

/** Truncate to `maxWidth`, appending an ellipsis when cut. */
export function truncate(text: string, maxWidth: number, size: number, style: FontStyle = 'r'): string {
	if (measure(text, size, style) <= maxWidth) return text;
	const chars = [...text];
	let lo = 0;
	let hi = chars.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (measure(chars.slice(0, mid).join('').trimEnd() + '…', size, style) <= maxWidth) lo = mid;
		else hi = mid - 1;
	}
	return chars.slice(0, lo).join('').trimEnd() + '…';
}

/**
 * Greedy word wrap. Words longer than a line are broken. With `maxLines`, the last line is
 * truncated with an ellipsis when text remains.
 */
export function wrap(text: string, maxWidth: number, size: number, style: FontStyle = 'r', maxLines = Infinity): string[] {
	const lines: string[] = [];
	for (const para of text.split('\n')) {
		const words = para.split(/\s+/).filter(Boolean);
		let line = '';
		for (const word of words) {
			const candidate = line ? `${line} ${word}` : word;
			if (measure(candidate, size, style) <= maxWidth) {
				line = candidate;
				continue;
			}
			if (line) lines.push(line);
			// break overlong words
			let rest = word;
			while (measure(rest, size, style) > maxWidth && rest.length > 1) {
				const chars = [...rest];
				let k = chars.length - 1;
				while (k > 1 && measure(chars.slice(0, k).join(''), size, style) > maxWidth) k--;
				// prefer a natural break: after . / _ - or before a camelCase capital
				for (let j = k; j >= Math.max(3, Math.floor(k / 2)); j--) {
					if (/[./_-]/.test(chars[j - 1]) || (/[a-z]/.test(chars[j - 1]) && /[A-Z]/.test(chars[j] ?? ''))) {
						k = j;
						break;
					}
				}
				lines.push(chars.slice(0, k).join(''));
				rest = chars.slice(k).join('');
			}
			line = rest;
		}
		lines.push(line);
	}
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		kept[maxLines - 1] = truncate(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxWidth, size, style);
		return kept;
	}
	return lines;
}
