<script lang="ts">
	import type { DiagramItem } from '../render/diagram.js';
	import type { Emphasis } from './state.js';
	import { opacityFor } from './state.js';

	let {
		item,
		emphasis,
		selected,
		onhover,
		onselect
	}: {
		item: DiagramItem;
		emphasis: Emphasis;
		selected: boolean;
		onhover: (id: string | undefined) => void;
		onselect: (id: string) => void;
	} = $props();
	const r = $derived(item.rect);
</script>

<!-- One card (library-drawn fragment) with selection ring and pointer handling. -->
<g
	class="node"
	data-id={item.id}
	style:opacity={opacityFor(emphasis)}
	role="button"
	tabindex="-1"
	aria-label={item.el?.title ?? item.id}
	onpointerenter={() => onhover(item.id)}
	onpointerleave={() => onhover(undefined)}
	onclick={(e) => {
		e.stopPropagation();
		onselect(item.id);
	}}
	onkeydown={(e) => e.key === 'Enter' && onselect(item.id)}
>
	{#if selected}
		<rect x={r.x - 5} y={r.y - 5} width={r.width + 10} height={r.height + 10} rx="6" fill="none" stroke="#2563eb" stroke-width="2.5" />
	{:else if emphasis === 'focus'}
		<rect x={r.x - 4} y={r.y - 4} width={r.width + 8} height={r.height + 8} rx="5" fill="none" stroke="#94a3b8" stroke-width="2" />
	{/if}
	{@html item.svg}
</g>

<style>
	.node {
		cursor: pointer;
		transition: opacity 120ms ease;
		outline: none;
	}
</style>
