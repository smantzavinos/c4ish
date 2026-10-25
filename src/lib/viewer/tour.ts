import type { Model, Profile, Tour, TourStep } from '../model/types.js';
import { pathRelationships, stepDims, stepLit } from '../model/tours.js';
import type { FilterState } from './state.js';
import { initialState } from './state.js';

/**
 * Guided tours in the viewer (DECISIONS 24). A step is the viewer's own state — view, selection,
 * highlight keys, spotlight, path, "only changes" — plus narration. Nothing here touches the DOM.
 */

/** Viewer filter state for a step (the same state a person would reach by clicking around; see FilterState.spotlight/path). */
export function stepFilter(model: Model, profile: Profile, step: TourStep): FilterState {
	const h = step.highlight ?? {};
	const proposed = h.proposed ? (model.proposedPatterns ?? []).map((p) => p.id) : [];
	const highlight = [
		...[...(h.patterns ?? []), ...proposed].map((p) => `pattern:${p}`),
		...(h.change ?? []).map((c) => `change:${profile.changeStates[c]?.style ?? c}`),
		...(h.enforcement ?? []).map((x) => `edge:enf:${x}`)
	];
	const lit = stepLit(model, profile, step);
	const noteKeys = new Set((model.notes ?? []).map((n, i) => n.id ?? `note:${i + 1}`));
	return {
		...initialState(),
		highlight: [...new Set(highlight)],
		onlyChanges: step.onlyChanges ?? false,
		selected: step.select,
		spotlight: [...lit].filter((id) => !noteKeys.has(id)),
		path: pathRelationships(step),
		dimOthers: stepDims(step),
		notes: step.notes ?? []
	};
}

/** Where the viewer is in a tour. `exploring` = the reviewer changed something since the step began. */
export interface TourState {
	tour: string;
	index: number;
	exploring: boolean;
}

export function startTour(tour: Tour, stepId?: string): TourState {
	const i = stepId ? tour.steps.findIndex((s) => s.id === stepId) : 0;
	return { tour: tour.id, index: Math.max(0, i), exploring: false };
}

export function gotoStep(state: TourState, tour: Tour, index: number): TourState {
	return { ...state, index: Math.max(0, Math.min(tour.steps.length - 1, index)), exploring: false };
}

export const nextStep = (s: TourState, t: Tour) => gotoStep(s, t, s.index + 1);
export const prevStep = (s: TourState, t: Tour) => gotoStep(s, t, s.index - 1);
/** The reviewer clicked, highlighted or panned: keep the step, mark it for "Resume". */
export const explore = (s: TourState): TourState => (s.exploring ? s : { ...s, exploring: true });
/** Back to the step exactly as scripted. */
export const resume = (s: TourState): TourState => ({ ...s, exploring: false });

export function currentStep(s: TourState | undefined, tours: Tour[]): { tour: Tour; step: TourStep } | undefined {
	if (!s) return undefined;
	const tour = tours.find((t) => t.id === s.tour);
	const step = tour?.steps[s.index];
	return tour && step ? { tour, step } : undefined;
}

/** `#tour=<id>&step=<id>` — the deep link of one step. */
export function tourHash(tour: string, step: string): string {
	return `#tour=${encodeURIComponent(tour)}&step=${encodeURIComponent(step)}`;
}

export function parseTourHash(hash: string): { tour?: string; step?: string } {
	const p = new URLSearchParams(hash.replace(/^#/, ''));
	return { tour: p.get('tour') ?? undefined, step: p.get('step') ?? undefined };
}

/** Resolve a deep link against the model's tours (unknown step → first step; unknown tour → none). */
export function tourFromHash(hash: string, tours: Tour[]): TourState | undefined {
	const { tour, step } = parseTourHash(hash);
	if (!tour && !step) return undefined;
	const t = tour ? tours.find((x) => x.id === tour) : tours[0];
	return t ? startTour(t, step) : undefined;
}

/** Minimal, safe markdown → HTML for step narration: paragraphs, lists, **bold**, *em*, `code`. */
export function narrationHtml(md: string | undefined): string {
	if (!md) return '';
	const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const inline = (s: string) =>
		esc(s)
			.replace(/`([^`]+)`/g, '<code>$1</code>')
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
	const out: string[] = [];
	let list: string[] = [];
	const flush = () => {
		if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
		list = [];
	};
	for (const para of md.split(/\n\s*\n/)) {
		for (const line of para.split('\n')) {
			const m = /^\s*[-*]\s+(.*)$/.exec(line);
			if (m) list.push(m[1]);
			else {
				flush();
				if (line.trim()) out.push(`<p>${inline(line.trim())}</p>`);
			}
		}
		flush();
	}
	return out.join('');
}

/** Plain text for static captions. */
export function narrationText(md: string | undefined): string {
	return (md ?? '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/(^|[^*])\*([^*]+)\*/g, '$1$2');
}
