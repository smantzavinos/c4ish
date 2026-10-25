<script lang="ts">
	import type { Diagram } from '../render/diagram.js';
	import DiagramEdge from './DiagramEdge.svelte';
	import DiagramNode from './DiagramNode.svelte';
	import { opacityFor, type Emphasis } from './state.js';
	import { fitCamera, fitRectCamera, panCamera, tweenCamera, zoomCamera, type Camera } from './camera.js';
	import type { Rect } from '../layout/types.js';
	import { BADGE_R, edgePathD, pathMarks, TOUR, viewerBadgeScale } from '../render/tour.js';

	let {
		diagram,
		emphasis,
		selected,
		path = [],
		zoom = $bindable(1),
		onhover,
		onselect
	}: {
		diagram: Diagram;
		emphasis: Map<string, Emphasis>;
		selected?: string;
		/** Tour path: ordered relationship ids, drawn with a glow and numbered badges. */
		path?: string[];
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

	let anim = 0;
	function stopAnim() {
		if (anim) cancelAnimationFrame(anim);
		anim = 0;
	}
	/** Glide to a camera (instant when the reader prefers reduced motion). */
	function animateTo(target: Camera, ms = 520) {
		stopAnim();
		const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduce || ms <= 0) return setCamera(target);
		const from = camera;
		const t0 = performance.now();
		const tick = (now: number) => {
			const t = Math.min(1, (now - t0) / ms);
			setCamera(tweenCamera(from, target, t));
			anim = t < 1 ? requestAnimationFrame(tick) : 0;
		};
		anim = requestAnimationFrame(tick);
	}

	/** Frame a diagram-space rect (or the whole diagram), animated. Used by tours. */
	export function focusOn(rect: Rect | undefined, animate = true) {
		if (!viewport) return;
		endDrag(true);
		const port = { width: viewport.clientWidth, height: viewport.clientHeight };
		const target = rect
			? fitRectCamera(port, { x: rect.x + PAD, y: rect.y + PAD, width: rect.width, height: rect.height }, 56, 1.25)
			: fitCamera(port, { width: vw, height: vh });
		if (animate) animateTo(target);
		else setCamera(target);
	}

	export function fit() {
		if (!viewport) return;
		stopAnim();
		endDrag(true);
		setCamera(fitCamera({ width: viewport.clientWidth, height: viewport.clientHeight }, { width: vw, height: vh }));
	}

	export function zoomBy(factor: number, cx?: number, cy?: number) {
		if (!viewport) return;
		stopAnim();
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
		stopAnim();
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
	const edgeById = $derived(new Map(diagram.edges.map((e) => [e.id, e])));
	// badges keep a readable on-screen size when zoomed out; placement uses a coarse scale step so it
	// does not shuffle during a camera glide
	const badgeScale = $derived(viewerBadgeScale(zoom));
	const placeScale = $derived(Math.round(badgeScale * 2) / 2);
	const marks = $derived(path.length ? pathMarks(diagram, path, placeScale) : []);
	// restart the draw-on animation whenever the path changes
	const pathKey = $derived(path.join('|'));
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
		{#key pathKey}
			<g class="path-glow" pointer-events="none">
				{#each path as id, i (i)}
					{@const e = edgeById.get(id)}
					{#if e}
						<path d={edgePathD(e)} pathLength="1" style:animation-delay="{i * 260}ms" fill="none" stroke={TOUR} stroke-opacity="0.3" stroke-width="9" stroke-linejoin="round" stroke-linecap="round" />
					{/if}
				{/each}
			</g>
		{/key}
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
		{#key pathKey}
			<g class="path-badges" pointer-events="none">
				{#each marks as m (m.n)}
					<g transform="translate({m.x} {m.y}) scale({badgeScale})">
						<g class="badge" style:animation-delay="{(m.n - 1) * 260 + 180}ms">
							<circle r={BADGE_R} fill={TOUR} stroke="#fff" stroke-width="2.5" />
							<text y="4" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff">{m.n}</text>
						</g>
					</g>
				{/each}
			</g>
		{/key}
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
	.path-glow path {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: draw 420ms ease-out forwards;
	}
	.path-badges .badge {
		opacity: 0;
		animation: pop 220ms ease-out forwards;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.6);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.path-glow path {
			animation: none;
			stroke-dashoffset: 0;
		}
		.path-badges .badge {
			animation: none;
			opacity: 1;
		}
	}
	.label {
		cursor: pointer;
		transition: opacity 120ms ease;
		outline: none;
	}
</style>
