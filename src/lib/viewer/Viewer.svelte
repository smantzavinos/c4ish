<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { check } from '../api.js';
	import { buildDiagram, type Diagram, type DiagramNote } from '../render/diagram.js';
	import { renderView } from '../render/page.js';
	import type { Model, Profile } from '../model/types.js';
	import type { Diagnostic } from '../model/validate.js';
	import DiagramCanvas from './DiagramCanvas.svelte';
	import LegendPanel from './LegendPanel.svelte';
	import Panel from './Panel.svelte';
	import TourCard from './TourCard.svelte';
	import { stepScenarios } from '../model/tours.js';
	import { stepBounds } from '../render/tour.js';
	import { currentStep, explore, gotoStep, startTour, stepFilter, tourFromHash, tourHash, type TourState } from './tour.js';
	import { classify, initialState, isHighlighted, itemKeys, toggleHighlight, type FilterState, type ViewerExample } from './state.js';

	let { examples = [] }: { examples?: ViewerExample[] } = $props();

	// Deep links: ?example=<id>&view=<id>&select=<id>&highlight=<key,key>&only=changes
	const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
	// Served models (c4ish view): ?src=<model url>[&profile=<url>][&live=<server-sent events url>][&name=<label>]
	const src = params.get('src');
	const first = src ? undefined : untrack(() => examples.find((x) => x.id === params.get('example')) ?? examples[0]);
	let pending: FilterState | undefined = {
		...initialState(),
		highlight: (params.get('highlight') ?? '').split(',').filter(Boolean),
		onlyChanges: params.get('only') === 'changes',
		selected: params.get('select') ?? undefined
	};
	let modelJson: unknown = $state(first?.model);
	let profileJson: unknown = $state(first?.profile);
	let sourceName = $state(first?.label ?? params.get('name') ?? src ?? '');
	/** Set by a live reload: keep the reader's view, selection, tour step and camera. */
	let reloading = false;
	let exampleId = $state(first?.id ?? '');
	let viewId: string | undefined = $state(params.get('view') ?? undefined);
	let diagram: Diagram | undefined = $state.raw();
	let diagnostics: Diagnostic[] = $state([]);
	let error = $state('');
	let filter: FilterState = $state(initialState());
	let zoom = $state(1);
	let canvas: DiagramCanvas | undefined = $state();
	let dragging = $state(false);
	/** Guided tour (DECISIONS 24): the step drives the same filter state a reviewer reaches by hand. */
	let tourState: TourState | undefined = $state();
	let hashPending = typeof location !== 'undefined' && location.hash.includes('tour=') || (typeof location !== 'undefined' && location.hash.includes('step='));

	// The compact layout (DECISIONS 64): below this width there is no room beside the diagram for the
	// two columns. They float over it, one sheet at a time, and start closed.
	const COMPACT = '(max-width: 999px)';
	const compactQuery = typeof matchMedia === 'undefined' ? undefined : matchMedia(COMPACT);
	let compact = $state(compactQuery?.matches ?? false);
	let leftOpen = $state(false);
	let menuOpen = $state(false);
	/** The step card in the compact layout, which floats over the diagram. */
	let card: 'open' | 'collapsed' | 'hidden' = $state('open');
	let notesOpen = $state(false);
	/** The reader picked the selected item themselves, as against a tour step selecting it. */
	let picked = $state(!!params.get('select'));
	/** The part of the canvas no floating panel covers. Fit, the zoom buttons and tour steps frame it. */
	let stage: HTMLElement | undefined = $state();
	/** The reader has panned or zoomed since the viewer last framed the diagram. */
	let readerMoved = false;

	/** For pointers: a tap on anything in the menu chooses it and closes the menu, short of the file picker. */
	function pickAndClose(node: HTMLElement) {
		const onClick = (e: MouseEvent) => {
			if (!(e.target as Element).closest('.file')) menuOpen = false;
		};
		node.addEventListener('click', onClick);
		return { destroy: () => node.removeEventListener('click', onClick) };
	}

	const checked = $derived(modelJson ? check(modelJson, profileJson) : undefined);
	const views = $derived(checked?.model?.views ?? []);
	const tours = $derived(checked?.model?.tours ?? []);
	const active = $derived(currentStep(tourState, tours));
	/** What the one sheet of the compact layout shows, if anything. */
	const sheet = $derived.by(() => {
		if (diagram && filter.selected && (picked || !tourState)) return 'detail';
		if (active && tourState) return card;
		if (diagram?.notes.length) return 'notes';
		return 'none';
	});
	/** The same for the styles: a closed list of notes is only a bar. */
	const sheetShape = $derived(sheet === 'notes' && !notesOpen ? 'notes-closed' : sheet);

	$effect(() => {
		const mq = compactQuery;
		if (!mq) return;
		const onChange = () => {
			compact = mq.matches;
			leftOpen = false;
			menuOpen = false;
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	// A drag that runs off the canvas must not rubber-band the page or pull to refresh.
	$effect(() => {
		if (!compact) return;
		const root = document.documentElement;
		const was = root.style.overscrollBehavior;
		root.style.overscrollBehavior = 'none';
		return () => (root.style.overscrollBehavior = was);
	});

	// A turn between portrait and landscape changes the room a step was framed for: frame it again, unless the
	// reader has moved the camera since. Only a real turn counts: a browser bar that hides itself also resizes
	// the page, and must not disturb a pinch.
	$effect(() => {
		if (!compact) return;
		let portrait = window.innerWidth <= window.innerHeight;
		let timer = 0;
		const onResize = () => {
			clearTimeout(timer);
			timer = window.setTimeout(() => {
				const now = window.innerWidth <= window.innerHeight;
				if (now === portrait) return;
				portrait = now;
				if (readerMoved) return;
				if (!tourState) fitView();
				else if (!tourState.exploring) frameStep();
			}, 150);
		};
		window.addEventListener('resize', onResize);
		return () => {
			clearTimeout(timer);
			window.removeEventListener('resize', onResize);
		};
	});

	// A tap outside the side panel or the menu closes it; Esc closes them without ending the tour.
	$effect(() => {
		if (!compact || (!menuOpen && !leftOpen)) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target as Element | null;
			if (!t?.closest('.menu, .menu-toggle')) menuOpen = false;
			if (!t?.closest('.left, .left-toggle')) leftOpen = false;
		};
		const onEscape = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			menuOpen = false;
			leftOpen = false;
			e.stopPropagation();
		};
		document.addEventListener('pointerdown', onDown, true);
		document.addEventListener('keydown', onEscape, true);
		return () => {
			document.removeEventListener('pointerdown', onDown, true);
			document.removeEventListener('keydown', onEscape, true);
		};
	});

	$effect(() => {
		const res = checked;
		diagnostics = res?.diagnostics ?? [];
		if (!res?.model || !res.profile) {
			diagram = undefined;
			return;
		}
		const view = res.model.views.some((v) => v.id === viewId) ? viewId : res.model.views[0]?.id;
		let cancelled = false;
		buildDiagram(res.model, res.profile, { view, idPrefix: 'vw-' })
			.then((d) => {
				if (cancelled) return;
				diagram = d;
				error = '';
				const touring = untrack(() => tourState && !tourState.exploring);
				if (reloading) {
					reloading = false;
					pending = undefined;
					const cs = untrack(() => currentStep(tourState, res.model!.tours ?? []));
					if (touring && cs && cs.step.view === d.scene.view.id) filter = stepFilter(res.model!, res.profile!, cs.step);
					return;
				}
				filter = pending ?? { ...initialState(), onlyChanges: filter.onlyChanges };
				pending = undefined;
				readerMoved = false;
			requestAnimationFrame(() => (touring ? canvas?.focusOn(stepBounds(d, filter), false) : canvas?.fit()));
			})
			.catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)));
		return () => {
			cancelled = true;
		};
	});

	async function loadServed(reload: boolean) {
		if (!src) return;
		try {
			const get = async (url: string) => {
				const r = await fetch(url, { cache: 'no-store' });
				if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
				return r.json();
			};
			const profileUrl = params.get('profile');
			const [m, p] = await Promise.all([get(src), profileUrl ? get(profileUrl) : Promise.resolve(undefined)]);
			reloading = reload && !!diagram;
			modelJson = m;
			profileJson = p;
			exampleId = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	$effect(() => {
		if (!src) return;
		untrack(() => loadServed(false));
		const live = params.get('live');
		if (!live) return;
		const es = new EventSource(live);
		es.addEventListener('change', () => {
			if (!untrack(() => exampleId)) loadServed(true); // not after the reader picked an example
		});
		return () => es.close();
	});

	// a deep link (#tour=…&step=…) starts the tour once the model is loaded
	$effect(() => {
		const m = checked?.model;
		if (!m || !hashPending) return;
		hashPending = false;
		const ts = tourFromHash(location.hash, m.tours ?? []);
		if (ts) untrack(() => applyStep(ts));
	});

	$effect(() => {
		const onHash = () => {
			const m = checked?.model;
			if (!m) return;
			const ts = tourFromHash(location.hash, m.tours ?? []);
			const cur = untrack(() => tourState);
			if (ts && (ts.tour !== cur?.tour || ts.index !== cur?.index)) applyStep(ts);
		};
		window.addEventListener('hashchange', onHash);
		return () => window.removeEventListener('hashchange', onHash);
	});

	/**
	 * Run once the layout has caught up with the state just set. In the compact layout the floating
	 * card's height decides what a step has room to frame.
	 */
	function afterLayout(fn: () => void) {
		if (compact) tick().then(fn);
		else fn();
	}
	/** Frame the current step for the room the card leaves. The camera is where the viewer put it. */
	function frameStep() {
		readerMoved = false;
		const d = diagram;
		const f = filter;
		if (d && tourState && !tourState.exploring) afterLayout(() => canvas?.focusOn(stepBounds(d, f)));
	}
	/** Fit the whole diagram into the part of the canvas that is visible. */
	function fitView() {
		readerMoved = false;
		canvas?.fit();
	}

	/** Show a tour step: switch view if needed, apply its filter state, glide the camera to it. */
	function applyStep(next: TourState) {
		const res = checked;
		const cs = currentStep(next, res?.model?.tours ?? []);
		if (!res?.model || !res.profile || !cs) return;
		// a tour that starts shows its card, whatever became of the last one
		if (!tourState) card = 'open';
		tourState = { ...next, exploring: false };
		picked = false;
		const f = stepFilter(res.model, res.profile, cs.step);
		const hash = tourHash(cs.tour.id, cs.step.id);
		if (location.hash !== hash) history.replaceState(null, '', hash);
		if (diagram && diagram.scene.view.id === cs.step.view && viewId === cs.step.view) {
			const d = diagram;
			const bounds = stepBounds(d, f);
			filter = f;
			readerMoved = false;
			afterLayout(() => canvas?.focusOn(bounds));
		} else {
			pending = f;
			viewId = cs.step.view;
		}
	}

	function stepBy(delta: number) {
		const s = tourState;
		const a = active;
		if (s && a) applyStep(gotoStep(s, a.tour, s.index + delta));
	}

	/** Bring the step card back. The step is framed again for the room the card takes. */
	function showCard() {
		card = 'open';
		frameStep();
	}

	function startOrExit() {
		if (tourState) return exitTour();
		if (tours[0]) applyStep(startTour(tours[0]));
	}

	function exitTour() {
		tourState = undefined;
		filter = initialState();
		if (location.hash) history.replaceState(null, '', location.pathname + location.search);
		afterLayout(fitView);
	}

	/** Any hand interaction during a tour: keep the step, offer "Back to this step". */
	function touched() {
		if (tourState) tourState = explore(tourState);
	}

	function onKey(e: KeyboardEvent) {
		if (!tourState || !active) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.closest('input, select, textarea') || t.isContentEditable)) return;
		if (e.key === 'ArrowRight' || e.key === 'PageDown') {
			e.preventDefault();
			stepBy(1);
		} else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
			e.preventDefault();
			stepBy(-1);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			exitTour();
		}
	}

	const stepNotes = $derived.by(() => {
		const keys = new Set(filter.notes ?? []);
		const all = checked?.model?.notes ?? [];
		if (!diagram || !keys.size) return [];
		return diagram.notes.filter((n) => keys.has(n.note.id ?? `note:${all.indexOf(n.note) + 1}`));
	});

	const keys = $derived(diagram ? itemKeys(diagram) : new Map());
	const emphasis = $derived(diagram ? classify(diagram, filter, keys) : new Map());
	const errors = $derived(diagnostics.filter((d) => d.severity === 'error'));
	const warnings = $derived(diagnostics.filter((d) => d.severity !== 'error'));

	function loadExample(id: string) {
		const ex = examples.find((x) => x.id === id);
		if (!ex) return;
		modelJson = ex.model;
		profileJson = ex.profile;
		sourceName = ex.label;
		viewId = undefined;
	}

	async function readFiles(files: FileList | File[]) {
		for (const f of Array.from(files)) {
			try {
				const json = JSON.parse(await f.text()) as Record<string, unknown>;
				if ('profileVersion' in json) profileJson = json;
				else {
					modelJson = json;
					sourceName = f.name;
					exampleId = '';
					viewId = undefined;
				}
			} catch (e) {
				error = `${f.name}: ${e instanceof Error ? e.message : String(e)}`;
			}
		}
	}

	async function exportSvg() {
		const res = checked;
		if (!res?.model || !res.profile || !diagram) return;
		const r = await renderView(res.model as Model, res.profile as Profile, { view: diagram.scene.view.id });
		const url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = `${diagram.scene.model.id ?? 'diagram'}-${diagram.scene.view.id}.svg`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:window onkeydown={onKey} />

{#snippet side(d: Diagram)}
	<div class="title">
		<h1>{d.scene.view.title}</h1>
		{#if d.scene.view.subtitle}<p>{d.scene.view.subtitle}</p>{/if}
	</div>
	{#if d.scene.view.focus?.length}
		<div class="focus">
			<h3>Review focus</h3>
			<ul>
				{#each d.scene.view.focus as f, i (i)}<li>{f}</li>{/each}
			</ul>
		</div>
	{/if}
	<LegendPanel legend={d.legend} isOn={(f) => isHighlighted(filter, f)} ontoggle={(f) => {
		// during a tour, the key is a temporary override of the step's lighting
		const base = tourState && !tourState.exploring ? { ...filter, highlight: [], spotlight: undefined, path: undefined } : filter;
		touched();
		filter = toggleHighlight(base, f);
	}} />
{/snippet}

{#snippet viewTabs()}
	{#if views.length > 1}
		<div class="tabs" role="tablist">
			{#each views as v (v.id)}
				<button role="tab" aria-selected={diagram?.scene.view.id === v.id} class:active={diagram?.scene.view.id === v.id} title={v.title ?? v.id} onclick={() => {
					touched();
					viewId = v.id;
				}}>{v.id}</button>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet picker()}
	{#if examples.length}
		<select aria-label="Example" bind:value={exampleId} onchange={(e) => loadExample(e.currentTarget.value)}>
			{#if !exampleId}<option value="">(opened file)</option>{/if}
			{#each examples as ex (ex.id)}<option value={ex.id}>{ex.label}</option>{/each}
		</select>
	{/if}
{/snippet}

{#snippet filePicker()}
	<label class="file">Open model / profile…<input type="file" accept=".json,application/json" multiple onchange={(e) => e.currentTarget.files && readFiles(e.currentTarget.files)} /></label>
{/snippet}

{#snippet tourButton()}
	{#if tours.length}
		<button class="tour-btn" class:on={!!tourState} onclick={startOrExit} title={tourState ? 'Exit the guided tour (Esc)' : (tours[0].summary ?? tours[0].title)}>{tourState ? '■ Exit tour' : '▶ Tour'}</button>
	{/if}
{/snippet}

{#snippet filters()}
	<label class="check"><input type="checkbox" checked={filter.onlyChanges} onchange={(e) => { touched(); filter = { ...filter, onlyChanges: e.currentTarget.checked }; }} /> Only changes</label>
	{#if filter.highlight.length}<button onclick={() => { touched(); filter = { ...filter, highlight: [] }; }}>Clear highlight</button>{/if}
{/snippet}

{#snippet zoomControls()}
	<div class="zoom">
		<button onclick={() => canvas?.zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
		<span>{Math.round(zoom * 100)}%</span>
		<button onclick={() => canvas?.zoomBy(1.25)} aria-label="Zoom in">+</button>
		<button onclick={fitView}>Fit</button>
	</div>
{/snippet}

{#snippet exportButton()}
	<button onclick={exportSvg} disabled={!diagram}>Export SVG</button>
{/snippet}

{#snippet tourCard(cs: NonNullable<ReturnType<typeof currentStep>>, state: TourState, floating: boolean)}
	<TourCard
		tour={cs.tour}
		index={state.index}
		exploring={state.exploring}
		notes={stepNotes}
		scenarios={stepScenarios(checked?.model ?? {}, cs.step)}
		{floating}
		onprev={() => stepBy(-1)}
		onnext={() => stepBy(1)}
		ongoto={(i) => applyStep(gotoStep(state, cs.tour, i))}
		onresume={() => applyStep(state)}
		oncollapse={floating ? () => (card = 'collapsed') : undefined}
		onhide={floating ? () => (card = 'hidden') : undefined}
		onexit={exitTour}
	/>
{/snippet}

{#snippet details(d: Diagram, id: string)}
	<Panel diagram={d} {id} onselect={(next) => {
		if (tourState) touched();
		picked = !!next;
		filter = { ...filter, selected: next };
	}} />
{/snippet}

{#snippet noteList(notes: DiagramNote[])}
	{#each notes as n (n.num)}
		<button class="note {n.note.kind ?? 'note'}" onclick={() => {
			if (!n.note.on) return;
			picked = true;
			filter = { ...filter, selected: n.note.on };
		}}>
			<span class="disc">{n.num}</span>
			<strong>{(n.note.kind ?? 'note').toUpperCase()}{n.note.title ? ` — ${n.note.title}` : ''}</strong>
			<span class="text">{n.note.text}</span>
		</button>
	{/each}
{/snippet}

<div
	class="viewer"
	class:compact
	class:dragging
	role="application"
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(e) => {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files.length) readFiles(e.dataTransfer.files);
	}}
>
	<header class="bar">
		{#if compact}
			<button class="icon left-toggle" aria-expanded={leftOpen} aria-label="Title, review focus and key" onclick={() => (leftOpen = !leftOpen)}>
				<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h13M1.5 8h13M1.5 12.5h13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
			</button>
			<strong class="brand">c4ish</strong>
			<span class="src" title="Loaded model">{sourceName}</span>
			{@render zoomControls()}
			<button class="icon menu-toggle" class:active={filter.onlyChanges || filter.highlight.length > 0} aria-expanded={menuOpen} aria-label="Model, filters and export" onclick={() => (menuOpen = !menuOpen)}>
				<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.7" fill="currentColor" /><circle cx="8" cy="8" r="1.7" fill="currentColor" /><circle cx="13" cy="8" r="1.7" fill="currentColor" /></svg>
			</button>
			{#if menuOpen}
				<div class="menu" use:pickAndClose>
					{@render picker()}
					{@render filePicker()}
					{@render filters()}
					{@render exportButton()}
				</div>
			{/if}
			{@render viewTabs()}
			{@render tourButton()}
		{:else}
			<strong class="brand">c4ish</strong>
			{@render picker()}
			{@render filePicker()}
			<span class="src" title="Loaded model">{sourceName}</span>
			<span class="sep"></span>
			{@render viewTabs()}
			<span class="grow"></span>
			{@render tourButton()}
			{@render filters()}
			{@render zoomControls()}
			{@render exportButton()}
		{/if}
	</header>

	<div class="body">
		{#if compact}
			{#if leftOpen && diagram}
				<aside class="left floating">
					<button class="close left-toggle" aria-label="Close" onclick={() => (leftOpen = false)}>×</button>
					{@render side(diagram)}
				</aside>
			{/if}
		{:else}
			<aside class="left">
				{#if diagram}{@render side(diagram)}{/if}
			</aside>
		{/if}
		<main class="canvas" data-sheet={compact ? sheetShape : undefined}>
			{#if errors.length || error}
				<div class="errors">
					<strong>Cannot render</strong>
					<ul>
						{#if error}<li>{error}</li>{/if}
						{#each errors as d, i (i)}<li><code>{d.code}</code> {d.message} <span class="muted">{d.at ?? ''}</span></li>{/each}
					</ul>
				</div>
			{/if}
			{#if diagram}
				<DiagramCanvas
					bind:this={canvas}
					bind:zoom
					{diagram}
					{emphasis}
					selected={filter.selected}
					path={filter.path ?? []}
					stage={compact ? stage : undefined}
					onusercamera={() => (readerMoved = true)}
					onhover={(id) => (filter = { ...filter, hover: id })}
					onselect={(id) => {
						if (id !== filter.selected) touched();
						picked = !!id;
						filter = { ...filter, selected: id, hover: undefined };
					}}
				/>
			{:else if !errors.length && !error}
				<p class="empty">Drop a model JSON (and optionally a profile JSON) here, or pick an example.</p>
			{/if}
			{#if warnings.length}
				<details class="warnings">
					<summary>{warnings.length} lint warning{warnings.length > 1 ? 's' : ''}</summary>
					<ul>
						{#each warnings as d, i (i)}<li><code>{d.code}</code> {d.message}</li>{/each}
					</ul>
				</details>
			{/if}
			{#if compact}
				<div class="stage" bind:this={stage} aria-hidden="true"></div>
				{#if sheet === 'detail' && diagram && filter.selected}
					<div class="sheet detail">{@render details(diagram, filter.selected)}</div>
				{:else if active && tourState}
					{#if card === 'open'}
						<div class="sheet">{@render tourCard(active, tourState, true)}</div>
					{:else if card === 'collapsed'}
						<div class="sheet mini" role="group" aria-label="Tour step">
							<button class="crumb" title="Show the step card" onclick={showCard}>▴ {tourState.index + 1} / {active.tour.steps.length} · {active.step.title}</button>
							<button onclick={() => stepBy(-1)} disabled={tourState.index === 0} aria-label="Previous step">←</button>
							<button onclick={() => stepBy(1)} disabled={tourState.index === active.tour.steps.length - 1} aria-label="Next step">→</button>
							<button onclick={() => (card = 'hidden')}>Hide</button>
						</div>
					{:else}
						<button class="show-card" title="Show the step card" onclick={showCard}>▴ {tourState.index + 1} / {active.tour.steps.length}</button>
					{/if}
				{:else if sheet === 'notes' && diagram}
					<div class="sheet notes-sheet">
						<button class="notes-toggle" aria-expanded={notesOpen} onclick={() => (notesOpen = !notesOpen)}>Notes · {diagram.notes.length} {notesOpen ? '▾' : '▴'}</button>
						{#if notesOpen}
							<div class="notes">
								<h3>Notes</h3>
								{@render noteList(diagram.notes)}
							</div>
						{/if}
					</div>
				{/if}
			{/if}
		</main>
		{#if !compact}
			{#if active && tourState}
				<div class="right">
					{@render tourCard(active, tourState, false)}
					{#if diagram && filter.selected}{@render details(diagram, filter.selected)}{/if}
				</div>
			{:else if diagram && filter.selected}
				<div class="right">{@render details(diagram, filter.selected)}</div>
			{:else if diagram?.notes.length}
				<div class="right">
					<div class="notes">
						<h3>Notes</h3>
						{@render noteList(diagram.notes)}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.viewer {
		display: flex;
		flex-direction: column;
		/* dvh: the height on screen, under no browser bar (where it is the same as vh) */
		height: 100vh;
		height: 100dvh;
		font-family: 'Noto Sans', system-ui, sans-serif;
		color: #0f172a;
		background: #fff;
	}
	.viewer.dragging {
		outline: 3px dashed #6366f1;
		outline-offset: -6px;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 14px;
		border-bottom: 1px solid #e2e8f0;
		font-size: 13px;
		flex-wrap: wrap;
	}
	.brand {
		font-size: 15px;
	}
	.tour-btn {
		border-color: #2563eb;
		color: #1d4ed8;
		font-weight: 600;
	}
	.tour-btn.on {
		background: #2563eb;
		color: #fff;
	}
	.grow {
		flex: 1;
	}
	.sep {
		width: 1px;
		height: 20px;
		background: #e2e8f0;
	}
	.src {
		color: #64748b;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	button,
	select,
	.file {
		font: inherit;
		font-size: 12.5px;
		padding: 4px 9px;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		background: #fff;
		color: #0f172a;
		cursor: pointer;
		/* touch only: a second tap on a control is not a double-tap zoom */
		touch-action: manipulation;
	}
	.file input {
		display: none;
	}
	.tabs {
		display: flex;
	}
	.tabs button {
		border-radius: 0;
		margin-left: -1px;
	}
	.tabs button:first-child {
		border-radius: 4px 0 0 4px;
	}
	.tabs button:last-child {
		border-radius: 0 4px 4px 0;
	}
	.tabs button.active {
		background: #0f172a;
		border-color: #0f172a;
		color: #fff;
	}
	.zoom {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.zoom span {
		min-width: 42px;
		text-align: center;
		color: #475569;
	}
	.check {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	.left {
		width: 290px;
		flex: none;
		overflow: auto;
		border-right: 1px solid #e2e8f0;
	}
	.title {
		padding: 14px 14px 0;
	}
	.title h1 {
		font-size: 16px;
		margin: 0 0 4px;
	}
	.title p {
		margin: 0;
		font-size: 12.5px;
		color: #64748b;
	}
	.focus {
		margin: 12px 14px 0;
		padding: 8px 10px 8px 12px;
		border-left: 4px solid #0f172a;
		background: #f8fafc;
		font-size: 12.5px;
	}
	.focus h3,
	.notes h3 {
		margin: 0 0 4px;
		font-size: 10.5px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #475569;
	}
	.focus ul {
		margin: 0;
		padding-left: 16px;
	}
	.canvas {
		flex: 1;
		min-width: 0;
		position: relative;
	}
	.right {
		width: 340px;
		flex: none;
		overflow: auto;
		border-left: 1px solid #e2e8f0;
	}
	.notes {
		padding: 14px;
	}
	.note {
		display: block;
		box-sizing: border-box;
		width: 100%;
		text-align: left;
		margin-bottom: 8px;
		padding: 8px 10px;
		font-size: 12.5px;
		line-height: 1.45;
	}
	.note.risk {
		border: 1.5px solid #334155;
	}
	.note .text {
		display: block;
		color: #334155;
		margin-top: 2px;
	}
	.disc {
		display: inline-grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #0f172a;
		color: #fff;
		font-size: 10.5px;
		font-weight: 700;
		margin-right: 6px;
	}
	.errors {
		margin: 16px;
		padding: 10px 14px;
		border: 1.5px solid #be123c;
		color: #881337;
		font-size: 13px;
	}
	.warnings {
		position: absolute;
		left: 12px;
		bottom: 12px;
		max-width: 60%;
		background: #fff;
		border: 1px solid #e2e8f0;
		padding: 4px 10px;
		font-size: 12px;
	}
	.empty {
		padding: 40px;
		color: #64748b;
	}
	.muted {
		color: #64748b;
	}

	/* Compact (DECISIONS 64): the columns float over the diagram, one sheet at a time. */
	.viewer.compact .bar {
		position: relative;
		gap: 6px;
		padding: 6px 8px;
	}
	.viewer.compact .bar button,
	.viewer.compact .bar select {
		min-height: 36px;
		padding: 6px 10px;
		font-size: 13px;
	}
	.viewer.compact .bar .icon {
		position: relative;
		width: 36px;
		padding: 0;
		line-height: 1;
	}
	.viewer.compact .bar .icon[aria-expanded='true'] {
		background: #e0e7ff;
		border-color: #6366f1;
	}
	.viewer.compact .bar .icon.active::after {
		content: '';
		position: absolute;
		top: 4px;
		right: 4px;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #2563eb;
	}
	/* The model name takes what is left: little enough that the controls stay on one row at 360px. */
	.viewer.compact .src {
		flex: 1 1 3rem;
		min-width: 0;
		max-width: none;
	}
	.viewer.compact .bar .zoom button {
		padding: 6px 8px;
	}
	.viewer.compact .bar .zoom span {
		min-width: 38px;
	}
	.viewer.compact .menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 8px;
		z-index: 20;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 6px;
		min-width: 240px;
		padding: 6px;
		background: #fff;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
	}
	.viewer.compact .bar .menu > * {
		min-height: 40px;
	}
	.viewer.compact .menu .file {
		display: flex;
		align-items: center;
	}
	.viewer.compact .menu .check {
		padding: 8px 10px;
	}
	.viewer.compact .tabs {
		flex: 1 1 10rem;
		min-width: 0;
		overflow-x: auto;
		overscroll-behavior-x: contain;
	}
	.viewer.compact .body {
		position: relative;
	}
	.viewer.compact .left.floating {
		position: absolute;
		top: 8px;
		left: 8px;
		z-index: 10;
		width: min(360px, calc(100% - 16px));
		max-height: calc(100% - 16px);
		overflow: auto;
		overscroll-behavior: contain;
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
		--legend-row: 36px;
	}
	/* Stays in reach while the panel scrolls; the title keeps clear of it. */
	.viewer.compact .left.floating .close {
		position: sticky;
		top: 4px;
		float: right;
		z-index: 1;
		box-sizing: border-box;
		display: grid;
		place-items: center;
		min-width: 44px;
		min-height: 44px;
		margin: 0 4px -44px 0;
		padding: 0;
		border: 0;
		font-size: 22px;
		line-height: 1;
	}
	.viewer.compact .left.floating .title {
		padding-right: 56px;
	}
	.viewer.compact .canvas {
		display: flex;
		flex-direction: column;
	}
	.viewer.compact .canvas > .errors,
	.viewer.compact .canvas > .empty {
		position: absolute;
		z-index: 3;
	}
	.viewer.compact .canvas > .empty {
		margin: 0;
	}
	.viewer.compact .warnings {
		top: 8px;
		right: 8px;
		bottom: auto;
		left: auto;
		z-index: 2;
		max-width: calc(100% - 16px);
	}
	/* The diagram shows through; touches on the canvas go to it. */
	.viewer.compact .stage {
		flex: 1;
		min-height: 0;
		pointer-events: none;
	}
	/* The one sheet: the step card, what the reader picked, or the notes. */
	.viewer.compact .sheet {
		position: relative;
		z-index: 1;
		flex: none;
		min-height: 0;
		max-height: 55%;
		overflow: auto;
		overscroll-behavior: contain;
		background: #fff;
		border-top: 1px solid #e2e8f0;
		border-radius: 16px 16px 0 0;
		box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.14);
	}
	.viewer.compact .sheet.detail {
		--close-pad: 10px;
	}
	.viewer.compact .notes-toggle {
		display: block;
		width: 100%;
		min-height: 44px;
		border: 0;
		border-radius: 0;
		text-align: left;
		font-weight: 600;
	}
	.viewer.compact .mini {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px 4px 4px;
		background: #f8fbff;
	}
	.viewer.compact .mini button {
		min-height: 32px;
		padding: 4px 10px;
	}
	.viewer.compact .mini .crumb {
		flex: 1;
		min-width: 0;
		text-align: left;
		font-weight: 600;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.viewer.compact .show-card {
		position: absolute;
		right: 10px;
		bottom: 10px;
		z-index: 2;
		min-height: 36px;
		padding: 6px 12px;
		border-color: #2563eb;
		color: #1d4ed8;
		font-weight: 600;
		box-shadow: 0 4px 14px rgba(15, 23, 42, 0.2);
	}
	@media (min-width: 560px) {
		/* On its side the phone is wide enough for the sheet to float in a corner over the diagram, and
		 a step frames the room left beside it rather than the room above it. */
		.viewer.compact .sheet {
			position: absolute;
			right: 10px;
			bottom: 10px;
			width: min(480px, 56%);
			max-height: calc(100% - 20px);
			border: 1px solid #e2e8f0;
			border-radius: 12px;
			box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
		}
		.viewer.compact .canvas:is([data-sheet='open'], [data-sheet='detail'], [data-sheet='notes']) .stage {
			flex: none;
			width: calc(100% - min(480px, 56%) - 20px);
			height: calc(100% - 10px);
		}
		.viewer.compact .canvas:is([data-sheet='collapsed'], [data-sheet='notes-closed']) .stage {
			flex: none;
			height: calc(100% - 66px);
		}
	}
</style>
