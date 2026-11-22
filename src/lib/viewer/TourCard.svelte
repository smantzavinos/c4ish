<script lang="ts">
	import type { Scenario, Tour } from '../model/types.js';
	import type { DiagramNote } from '../render/diagram.js';
	import { narrationHtml } from './tour.js';

	let {
		tour,
		index,
		exploring,
		notes,
		scenarios = [],
		floating = false,
		onprev,
		onnext,
		ongoto,
		onresume,
		onexit,
		oncollapse,
		onhide
	}: {
		tour: Tour;
		index: number;
		exploring: boolean;
		/** Notes of the current view the step spotlights. */
		notes: DiagramNote[];
		/** Scenarios the current step walks. */
		scenarios?: Scenario[];
		/** Over the diagram (the compact layout) rather than in a column of its own. */
		floating?: boolean;
		onprev: () => void;
		onnext: () => void;
		ongoto: (i: number) => void;
		onresume: () => void;
		onexit: () => void;
		/** Given with `floating`: the card can be collapsed to a bar, or hidden until called back. */
		oncollapse?: () => void;
		onhide?: () => void;
	} = $props();

	const step = $derived(tour.steps[index]);
	const total = $derived(tour.steps.length);
	let listOpen = $state(false);
</script>

<section class="tour" class:floating aria-label="Guided tour" aria-live="polite">
	<div class="top">
		{#if oncollapse}
			<button class="label fold" onclick={oncollapse} aria-label="Collapse the step card" title={tour.title}>
				<span class="chev" aria-hidden="true">▾</span> TOUR · {tour.title}
			</button>
			<span class="acts">
				{#if onhide}<button class="text" onclick={onhide}>Hide</button>{/if}
				<button class="text" onclick={onexit} aria-label="Exit tour">Exit</button>
			</span>
		{:else}
			<span class="label">TOUR · {tour.title}</span>
			<button class="x" onclick={onexit} aria-label="Exit tour" title="Exit tour (Esc)">×</button>
		{/if}
	</div>
	<div class="count">{index + 1} / {total}</div>
	<h2>{step.title}</h2>
	<div class="body">{@html narrationHtml(step.body)}</div>

	{#if scenarios.length}
		<ul class="scenarios" aria-label="Scenarios this step walks">
			{#each scenarios as s (s.id)}<li><span class="sid">{s.id}</span> {s.title}</li>{/each}
		</ul>
	{/if}

	{#each notes as n (n.num)}
		<div class="note {n.note.kind ?? 'note'}">
			<span class="disc">{n.num}</span>
			<strong>{(n.note.kind ?? 'note').toUpperCase()}{n.note.title ? ` — ${n.note.title}` : ''}</strong>
			<p>{n.note.text}</p>
		</div>
	{/each}

	{#if exploring}
		<button class="resume" onclick={onresume}>↺ Back to this step</button>
	{/if}

	<div class="nav">
		<button onclick={onprev} disabled={index === 0} aria-label="Previous step">← Prev</button>
		<div class="dots" aria-hidden="true">
			{#each tour.steps as s, i (s.id)}
				<button class="dot" class:on={i === index} class:done={i < index} onclick={() => ongoto(i)} title={s.title} tabindex="-1"></button>
			{/each}
		</div>
		<button class="primary" onclick={onnext} disabled={index === total - 1} aria-label="Next step">Next →</button>
	</div>

	<button class="list-toggle" onclick={() => (listOpen = !listOpen)} aria-expanded={listOpen}>{listOpen ? '▾' : '▸'} All steps</button>
	{#if listOpen}
		<ol class="steps">
			{#each tour.steps as s, i (s.id)}
				<li><button class:on={i === index} onclick={() => ongoto(i)}>{i + 1}. {s.title}</button></li>
			{/each}
		</ol>
	{/if}
	{#if !floating}<p class="keys">← / → step · Esc exits</p>{/if}
</section>

<style>
	.tour {
		padding: 14px 16px 18px;
		font-size: 13.5px;
		line-height: 1.5;
		color: #0f172a;
		border-left: 4px solid #2563eb;
		background: #f8fbff;
		border-bottom: 1px solid #e2e8f0;
		box-sizing: border-box;
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.label {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #2563eb;
		text-transform: uppercase;
	}
	.x {
		border: 0;
		background: none;
		font-size: 20px;
		cursor: pointer;
		color: #64748b;
		padding: 0 4px;
	}
	/* Floating (the compact layout): the header stays in reach while the card scrolls. */
	.tour.floating {
		border-left: 0;
		border-top: 4px solid #2563eb;
		border-bottom: 0;
	}
	.floating .top {
		position: sticky;
		top: 0;
		z-index: 1;
		/* up to the card's top edge, and across its full width */
		margin: -14px -16px 0;
		padding: 10px 8px 8px 16px;
		background: #f8fbff;
		border-bottom: 1px solid #e2e8f0;
	}
	/* The step navigation is pinned the same way, at the other edge: long narration or notes do not put Next below the fold. */
	.floating .nav {
		position: sticky;
		bottom: 0;
		z-index: 1;
		margin: 0 -16px -18px;
		padding: 6px 16px 10px;
		background: #f8fbff;
		border-top: 1px solid #e2e8f0;
	}
	.floating .list-toggle {
		margin-top: 16px;
	}
	.fold {
		border: 0;
		background: none;
		padding: 0;
		max-width: 62%;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		text-align: left;
	}
	.chev {
		margin-right: 2px;
	}
	.acts {
		flex: none;
		display: flex;
		gap: 2px;
	}
	.text {
		border: 0;
		background: none;
		color: #1d4ed8;
		font-weight: 600;
	}
	/* A finger, not a cursor: the controls are taller, and a second tap is not a double-tap zoom. */
	.floating .fold,
	.floating .text,
	.floating .resume,
	.floating .list-toggle,
	.floating .nav > button,
	.floating .steps button {
		min-height: 40px;
		touch-action: manipulation;
	}
	.floating .dot {
		position: relative;
		width: 12px;
		height: 12px;
	}
	.floating .dot::after {
		content: '';
		position: absolute;
		inset: -9px;
	}
	.count {
		margin-top: 6px;
		font-size: 12px;
		font-weight: 700;
		color: #475569;
	}
	h2 {
		margin: 2px 0 6px;
		font-size: 19px;
		line-height: 1.3;
	}
	.body :global(p) {
		margin: 0 0 8px;
	}
	.body :global(ul) {
		margin: 0 0 8px;
		padding-left: 18px;
	}
	.body :global(code) {
		font-size: 12px;
		background: #e2e8f0;
		padding: 0 4px;
		border-radius: 3px;
	}
	.scenarios {
		list-style: none;
		margin: 8px 0;
		padding: 6px 10px;
		border-left: 3px solid #2563eb;
		background: #eff6ff;
		font-size: 12.5px;
	}
	.sid {
		font-weight: 700;
		color: #1d4ed8;
		margin-right: 4px;
	}
	.note {
		border: 1px solid #e2e8f0;
		background: #fff;
		padding: 6px 10px;
		margin: 8px 0;
		font-size: 12.5px;
	}
	.note.risk {
		border: 1.5px solid #334155;
	}
	.note p {
		margin: 3px 0 0;
		color: #334155;
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
	button {
		font: inherit;
		font-size: 12.5px;
		padding: 5px 10px;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		background: #fff;
		color: #0f172a;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.primary {
		background: #2563eb;
		border-color: #2563eb;
		color: #fff;
	}
	.resume {
		width: 100%;
		margin: 6px 0 2px;
		border-color: #2563eb;
		color: #1d4ed8;
	}
	.nav {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
	}
	.dots {
		flex: 1;
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 4px;
	}
	.dot {
		width: 8px;
		height: 8px;
		padding: 0;
		border-radius: 50%;
		border: 0;
		background: #cbd5e1;
	}
	.dot.done {
		background: #93c5fd;
	}
	.dot.on {
		background: #2563eb;
	}
	.list-toggle {
		margin-top: 12px;
		border: 0;
		background: none;
		padding: 0;
		color: #475569;
	}
	.steps {
		list-style: none;
		padding: 0;
		margin: 6px 0 0;
	}
	.steps button {
		display: block;
		width: 100%;
		text-align: left;
		border: 0;
		background: none;
		padding: 3px 6px;
		color: #334155;
	}
	.steps button.on {
		background: #dbeafe;
		color: #0f172a;
		font-weight: 600;
	}
	.keys {
		margin: 10px 0 0;
		font-size: 11.5px;
		color: #94a3b8;
	}
</style>
