<script lang="ts">
	import { untrack } from 'svelte';
	import { check } from '../api.js';
	import { buildDiagram, type Diagram } from '../render/diagram.js';
	import { renderView } from '../render/page.js';
	import type { Model, Profile } from '../model/types.js';
	import type { Diagnostic } from '../model/validate.js';
	import DiagramCanvas from './DiagramCanvas.svelte';
	import LegendPanel from './LegendPanel.svelte';
	import Panel from './Panel.svelte';
	import TourCard from './TourCard.svelte';
	import { stepBounds } from '../render/tour.js';
	import { currentStep, explore, gotoStep, startTour, stepFilter, tourFromHash, tourHash, type TourState } from './tour.js';
	import { classify, initialState, isHighlighted, itemKeys, toggleHighlight, type FilterState, type ViewerExample } from './state.js';

	let { examples = [] }: { examples?: ViewerExample[] } = $props();

	// Deep links: ?example=<id>&view=<id>&select=<id>&highlight=<key,key>&only=changes
	const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
	const first = untrack(() => examples.find((x) => x.id === params.get('example')) ?? examples[0]);
	let pending: FilterState | undefined = {
		...initialState(),
		highlight: (params.get('highlight') ?? '').split(',').filter(Boolean),
		onlyChanges: params.get('only') === 'changes',
		selected: params.get('select') ?? undefined
	};
	let modelJson: unknown = $state(first?.model);
	let profileJson: unknown = $state(first?.profile);
	let sourceName = $state(first?.label ?? '');
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

	const checked = $derived(modelJson ? check(modelJson, profileJson) : undefined);
	const views = $derived(checked?.model?.views ?? []);
	const tours = $derived(checked?.model?.tours ?? []);
	const active = $derived(currentStep(tourState, tours));

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
				filter = pending ?? { ...initialState(), onlyChanges: filter.onlyChanges };
				pending = undefined;
				const touring = untrack(() => tourState && !tourState.exploring);
				requestAnimationFrame(() => (touring ? canvas?.focusOn(stepBounds(d, filter), false) : canvas?.fit()));
			})
			.catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)));
		return () => {
			cancelled = true;
		};
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

	/** Show a tour step: switch view if needed, apply its filter state, glide the camera to it. */
	function applyStep(next: TourState) {
		const res = checked;
		const cs = currentStep(next, res?.model?.tours ?? []);
		if (!res?.model || !res.profile || !cs) return;
		tourState = { ...next, exploring: false };
		const f = stepFilter(res.model, res.profile, cs.step);
		const hash = tourHash(cs.tour.id, cs.step.id);
		if (location.hash !== hash) history.replaceState(null, '', hash);
		if (diagram && diagram.scene.view.id === cs.step.view && viewId === cs.step.view) {
			filter = f;
			canvas?.focusOn(stepBounds(diagram, f));
		} else {
			pending = f;
			viewId = cs.step.view;
		}
	}

	function startOrExit() {
		if (tourState) return exitTour();
		if (tours[0]) applyStep(startTour(tours[0]));
	}

	function exitTour() {
		tourState = undefined;
		filter = initialState();
		if (location.hash) history.replaceState(null, '', location.pathname + location.search);
		canvas?.fit();
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
			applyStep(gotoStep(tourState, active.tour, tourState.index + 1));
		} else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
			e.preventDefault();
			applyStep(gotoStep(tourState, active.tour, tourState.index - 1));
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

<div
	class="viewer"
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
		<strong class="brand">c4ish</strong>
		{#if examples.length}
			<select aria-label="Example" bind:value={exampleId} onchange={(e) => loadExample(e.currentTarget.value)}>
				{#if !exampleId}<option value="">(opened file)</option>{/if}
				{#each examples as ex (ex.id)}<option value={ex.id}>{ex.label}</option>{/each}
			</select>
		{/if}
		<label class="file">Open model / profile…<input type="file" accept=".json,application/json" multiple onchange={(e) => e.currentTarget.files && readFiles(e.currentTarget.files)} /></label>
		<span class="src" title="Loaded model">{sourceName}</span>
		<span class="sep"></span>
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
		<span class="grow"></span>
		{#if tours.length}
			<button class="tour-btn" class:on={!!tourState} onclick={startOrExit} title={tourState ? 'Exit the guided tour (Esc)' : (tours[0].summary ?? tours[0].title)}>{tourState ? '■ Exit tour' : '▶ Tour'}</button>
		{/if}
		<label class="check"><input type="checkbox" checked={filter.onlyChanges} onchange={(e) => { touched(); filter = { ...filter, onlyChanges: e.currentTarget.checked }; }} /> Only changes</label>
		{#if filter.highlight.length}<button onclick={() => { touched(); filter = { ...filter, highlight: [] }; }}>Clear highlight</button>{/if}
		<div class="zoom">
			<button onclick={() => canvas?.zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
			<span>{Math.round(zoom * 100)}%</span>
			<button onclick={() => canvas?.zoomBy(1.25)} aria-label="Zoom in">+</button>
			<button onclick={() => canvas?.fit()}>Fit</button>
		</div>
		<button onclick={exportSvg} disabled={!diagram}>Export SVG</button>
	</header>

	<div class="body">
		<aside class="left">
			{#if diagram}
				<div class="title">
					<h1>{diagram.scene.view.title}</h1>
					{#if diagram.scene.view.subtitle}<p>{diagram.scene.view.subtitle}</p>{/if}
				</div>
				{#if diagram.scene.view.focus?.length}
					<div class="focus">
						<h3>Review focus</h3>
						<ul>
							{#each diagram.scene.view.focus as f, i (i)}<li>{f}</li>{/each}
						</ul>
					</div>
				{/if}
				<LegendPanel legend={diagram.legend} isOn={(f) => isHighlighted(filter, f)} ontoggle={(f) => {
						// during a tour, the key is a temporary override of the step's lighting
						const base = tourState && !tourState.exploring ? { ...filter, highlight: [], spotlight: undefined, path: undefined } : filter;
						touched();
						filter = toggleHighlight(base, f);
					}} />
			{/if}
		</aside>
		<main class="canvas">
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
					onhover={(id) => (filter = { ...filter, hover: id })}
					onselect={(id) => {
						if (id !== filter.selected) touched();
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
		</main>
		{#if active && tourState}
			<div class="right">
				<TourCard
					tour={active.tour}
					index={tourState.index}
					exploring={tourState.exploring}
					notes={stepNotes}
					onprev={() => applyStep(gotoStep(tourState!, active.tour, tourState!.index - 1))}
					onnext={() => applyStep(gotoStep(tourState!, active.tour, tourState!.index + 1))}
					ongoto={(i) => applyStep(gotoStep(tourState!, active.tour, i))}
					onresume={() => applyStep(tourState!)}
					onexit={exitTour}
				/>
				{#if diagram && filter.selected}
					<Panel {diagram} id={filter.selected} onselect={(id) => { touched(); filter = { ...filter, selected: id }; }} />
				{/if}
			</div>
		{:else if diagram && filter.selected}
			<div class="right">
				<Panel {diagram} id={filter.selected} onselect={(id) => (filter = { ...filter, selected: id })} />
			</div>
		{:else if diagram?.notes.length}
			<div class="right">
				<div class="notes">
					<h3>Notes</h3>
					{#each diagram.notes as n (n.num)}
						<button class="note {n.note.kind ?? 'note'}" onclick={() => n.note.on && (filter = { ...filter, selected: n.note.on })}>
							<span class="disc">{n.num}</span>
							<strong>{(n.note.kind ?? 'note').toUpperCase()}{n.note.title ? ` — ${n.note.title}` : ''}</strong>
							<span class="text">{n.note.text}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.viewer {
		display: flex;
		flex-direction: column;
		height: 100vh;
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
</style>
