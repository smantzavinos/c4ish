<script lang="ts">
	import type { Diagram } from '../render/diagram.js';
	import DiagramEdge from './DiagramEdge.svelte';
	import DiagramNode from './DiagramNode.svelte';
	import { opacityFor, type Emphasis } from './state.js';
	import { fitCamera, panCamera, zoomCamera, type Camera } from './camera.js';

	let {
		diagram,
		emphasis,
		selected,
		zoom = $bindable(1),
		onhover,
		onselect
	}: {
		diagram: Diagram;
		emphasis: Map<string, Emphasis>;
		selected?: string;
		zoom?: number;
		onhover: (id: string | undefined) => void;
		onselect: (id: string | undefined) => void;
	} = $props();

	const PAD = 24;
	const vw = $derived(diagram.width + PAD * 2);
	const vh = $derived(diagram.height + PAD * 2);
	let viewport: HTMLDivElement | undefined = $state();
	let offset = $state({ x: 0, y: 0 });
	const camera = $derived({ ...offset, zoom });

	function setCamera(next: Camera) {
		offset = { x: next.x, y: next.y };
		zoom = next.zoom;
	}

	export function fit() {
		if (!viewport) return;
		endDrag(true);
		setCamera(fitCamera({ width: viewport.clientWidth, height: viewport.clientHeight }, { width: vw, height: vh }));
	}

	export function zoomBy(factor: number, cx?: number, cy?: number) {
		if (!viewport) return;
		endDrag(true);
		setCamera(zoomCamera(camera, factor, {
			x: cx ?? viewport.clientWidth / 2,
			y: cy ?? viewport.clientHeight / 2
		}));
	}

	// Capture the original hit target so a genuine card/connector click still reaches it.
	let drag: { pointerId: number; target: Element; x: number; y: number; camera: Camera; moved: boolean } | undefined = $state();
	let suppressClick = false;
	function down(e: PointerEvent) {
		if (e.button !== 0 || !e.isPrimary || drag) return;
		suppressClick = false;
		const target = e.target as Element;
		drag = { pointerId: e.pointerId, target, x: e.clientX, y: e.clientY, camera, moved: false };
		target.setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!drag || drag.pointerId !== e.pointerId) return;
		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		if (!drag.moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
		if (!drag.moved) onhover(undefined);
		drag.moved = true;
		setCamera(panCamera(drag.camera, dx, dy));
	}
	function endDrag(cancelled = false) {
		if (!drag) return;
		const { target, pointerId, moved } = drag;
		suppressClick = moved || cancelled;
		drag = undefined;
		if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
	}
	function up(e: PointerEvent) {
		if (drag?.pointerId === e.pointerId) endDrag(e.type !== 'pointerup');
	}

	$effect(() => {
		const el = viewport;
		if (!el) return;
		// All wheel navigation updates the camera; there are no document scroll limits.
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const unitX = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
			const unitY = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
			if (e.ctrlKey || e.metaKey) {
				const box = el.getBoundingClientRect();
				zoomBy(Math.exp(-e.deltaY * unitY * 0.0015), e.clientX - box.left, e.clientY - box.top);
			} else {
				endDrag(true);
				setCamera(panCamera(camera, -e.deltaX * unitX, -e.deltaY * unitY));
			}
		};
		// Run before item click handlers so a completed pan never changes selection.
		const onClick = (e: MouseEvent) => {
			if (suppressClick && e.detail > 0) {
				suppressClick = false;
				e.preventDefault();
				e.stopImmediatePropagation();
				return;
			}
			if (!(e.target as Element).closest('.node, .edge, .label')) onselect(undefined);
		};
		const onBlur = () => endDrag(true);
		el.addEventListener('wheel', onWheel, { passive: false });
		el.addEventListener('click', onClick, { capture: true });
		window.addEventListener('blur', onBlur);
		return () => {
			endDrag(true);
			el.removeEventListener('wheel', onWheel);
			el.removeEventListener('click', onClick, { capture: true });
			window.removeEventListener('blur', onBlur);
		};
	});
	const em = (id: string): Emphasis => emphasis.get(id) ?? 'normal';
</script>

<div
	class="viewport"
	class:panning={drag?.moved}
	bind:this={viewport}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	onlostpointercapture={up}
	role="presentation"
>
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width={vw}
		height={vh}
		viewBox="{-PAD} {-PAD} {vw} {vh}"
		style:transform={`translate(${offset.x}px, ${offset.y}px) scale(${zoom})`}
		font-family="'Noto Sans', 'Helvetica Neue', Arial, sans-serif"
		role="img"
		aria-label={diagram.scene.view.title}
	>
		<defs>{@html diagram.defs}</defs>
		<rect x={-PAD} y={-PAD} width={vw} height={vh} fill="#ffffff" />
		<g class="frames">
			{#each diagram.frames as f (f.id)}
				<g data-id={f.id}>{@html f.svg}</g>
			{/each}
		</g>
		<g class="edges">
			{#each diagram.edges as e (e.id)}
				<DiagramEdge edge={e} emphasis={em(e.id)} selected={selected === e.id} {onhover} {onselect} />
			{/each}
		</g>
		<g class="nodes">
			{#each diagram.nodes as n (n.id)}
				<DiagramNode item={n} emphasis={em(n.id)} selected={selected === n.id} {onhover} {onselect} />
			{/each}
		</g>
		<g class="labels">
			{#each diagram.edges as e (e.id)}
				{#if e.label}
					<g
						class="label"
						style:opacity={opacityFor(em(e.id))}
						role="button"
						tabindex="-1"
						onpointerenter={() => onhover(e.id)}
						onpointerleave={() => onhover(undefined)}
						onclick={(ev) => {
							ev.stopPropagation();
							onselect(e.id);
						}}
						onkeydown={(ev) => ev.key === 'Enter' && onselect(e.id)}
					>
						{@html e.label.svg}
					</g>
				{/if}
			{/each}
		</g>
		<g class="discs" pointer-events="none">
			{#each diagram.discs as d (d.on)}
				<g style:opacity={opacityFor(em(d.on))}>{@html d.svg}</g>
			{/each}
		</g>
	</svg>
</div>

<style>
	.viewport {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: #f8fafc;
		cursor: grab;
		touch-action: none;
		user-select: none;
	}
	.viewport.panning,
	.viewport.panning :global(*) {
		cursor: grabbing;
	}
	svg {
		display: block;
		transform-origin: 0 0;
		background: #fff;
	}
	.label {
		cursor: pointer;
		transition: opacity 120ms ease;
		outline: none;
	}
</style>
