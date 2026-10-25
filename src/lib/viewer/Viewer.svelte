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

	const checked = $derived(modelJson ? check(modelJson, profileJson) : undefined);
	const views = $derived(checked?.model?.views ?? []);

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
				requestAnimationFrame(() => canvas?.fit());
			})
			.catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)));
		return () => {
			cancelled = true;
		};
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
					<button role="tab" aria-selected={diagram?.scene.view.id === v.id} class:active={diagram?.scene.view.id === v.id} title={v.title ?? v.id} onclick={() => (viewId = v.id)}>{v.id}</button>
				{/each}
			</div>
		{/if}
		<span class="grow"></span>
		<label class="check"><input type="checkbox" bind:checked={filter.onlyChanges} /> Only changes</label>
		{#if filter.highlight.length}<button onclick={() => (filter = { ...filter, highlight: [] })}>Clear highlight</button>{/if}
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
				<LegendPanel legend={diagram.legend} isOn={(f) => isHighlighted(filter, f)} ontoggle={(f) => (filter = toggleHighlight(filter, f))} />
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
					onhover={(id) => (filter = { ...filter, hover: id })}
					onselect={(id) => (filter = { ...filter, selected: id, hover: undefined })}
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
		{#if diagram && filter.selected}
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
