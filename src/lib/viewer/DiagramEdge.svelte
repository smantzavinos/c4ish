<script lang="ts">
	import type { DiagramEdge } from '../render/diagram.js';
	import type { Emphasis } from './state.js';
	import { opacityFor } from './state.js';

	let {
		edge,
		emphasis,
		selected,
		onhover,
		onselect
	}: {
		edge: DiagramEdge;
		emphasis: Emphasis;
		selected: boolean;
		onhover: (id: string | undefined) => void;
		onselect: (id: string) => void;
	} = $props();

	const d = $derived(edge.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '));
</script>

<!-- One connector: visible line (library-drawn) + a wide invisible hit path. -->
<g
	class="edge"
	class:focus={emphasis === 'focus'}
	class:selected
	data-id={edge.id}
	style:opacity={opacityFor(emphasis)}
	role="button"
	tabindex="-1"
	aria-label={edge.rel.label ?? `${edge.from} → ${edge.to}`}
	onpointerenter={() => onhover(edge.id)}
	onpointerleave={() => onhover(undefined)}
	onclick={(e) => {
		e.stopPropagation();
		onselect(edge.id);
	}}
	onkeydown={(e) => e.key === 'Enter' && onselect(edge.id)}
>
	{#if selected || emphasis === 'focus'}
		<path {d} fill="none" stroke={selected ? '#2563eb' : '#94a3b8'} stroke-opacity="0.35" stroke-width="8" stroke-linejoin="round" />
	{/if}
	{@html edge.svg}
	<path {d} fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke" class="hit" />
</g>

<style>
	.edge {
		cursor: pointer;
		transition: opacity 120ms ease;
		outline: none;
	}
</style>
