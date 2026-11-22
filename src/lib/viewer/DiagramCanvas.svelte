<script lang="ts">
	import type { Diagram } from '../render/diagram.js';
	import DiagramEdge from './DiagramEdge.svelte';
	import DiagramNode from './DiagramNode.svelte';
	import { opacityFor, type Emphasis } from './state.js';
	import { fitCamera, fitRectCamera, panCamera, tweenCamera, zoomCamera, type Camera, type Size } from './camera.js';
	import { dragMove, grab, release, type Drag } from './gesture.js';
	import type { Rect } from '../layout/types.js';
	import { BADGE_R, edgePathD, pathMarks, TOUR, viewerBadgeScale } from '../render/tour.js';

	let {
		diagram,
		emphasis,
		selected,
		path = [],
		zoom = $bindable(1),
		stage,
		onhover,
		onselect,
		onusercamera
	}: {
		diagram: Diagram;
		emphasis: Map<string, Emphasis>;
		selected?: string;
		/** Tour path: ordered relationship ids, drawn with a glow and numbered badges. */
		path?: string[];
		zoom?: number;
		/**
		 * The part of the viewport that no floating panel covers (the compact layout), sharing its top-left
		 * corner. Fit, the zoom buttons and tour steps frame this; given, it replaces the whole viewport.
		 */
		stage?: HTMLElement;
		/** The reader moved the camera themselves: a drag, a pinch, the wheel, a zoom button. */
		onusercamera?: () => void;
		onhover: (id: string | undefined) => void;
		onselect: (id: string | undefined) => void;
	} = $props();

	const PAD = 24;
	const vw = $derived(diagram.width + PAD * 2);
	const vh = $derived(diagram.height + PAD * 2);
	let viewport: HTMLDivElement | undefined = $state();
	let offset = $state({ x: 0, y: 0 });
	const camera = $derived({ ...offset, zoom });
	const sizeOf = (el: HTMLElement): Size => ({ width: el.clientWidth, height: el.clientHeight });

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
		endDrag();
		const port = sizeOf(stage ?? viewport);
		// a phone screen has little to spare: keep less of it free around a step
		const margin = stage ? Math.max(24, Math.min(56, Math.round(port.width / 12))) : 56;
		const target = rect
			? fitRectCamera(port, { x: rect.x + PAD, y: rect.y + PAD, width: rect.width, height: rect.height }, margin, 1.25)
			: fitCamera(port, { width: vw, height: vh });
		if (animate) animateTo(target);
		else setCamera(target);
	}

	export function fit() {
		if (!viewport) return;
		stopAnim();
		endDrag();
		setCamera(fitCamera(sizeOf(stage ?? viewport), { width: vw, height: vh }));
	}

	export function zoomBy(factor: number, cx?: number, cy?: number) {
		if (!viewport) return;
		stopAnim();
		endDrag();
		// a button zooms about the middle of what is visible; the wheel about the cursor
		const about = cx === undefined && stage ? stage : viewport;
		setCamera(zoomCamera(camera, factor, {
			x: cx ?? about.clientWidth / 2,
			y: cy ?? about.clientHeight / 2
		}));
		onusercamera?.();
	}

	// One pointer pans, two pinch (gesture.ts). Each is captured by the element it went down on, so a
	// genuine card/connector tap still reaches it, and the click after a pan or a pinch is not a selection.
	let drag: Drag | undefined = $state();
	const captured = new Map<number, Element>();
	let suppressClick = false;
	function releaseCapture(id: number) {
		const target = captured.get(id);
		captured.delete(id);
		if (target?.hasPointerCapture(id)) target.releasePointerCapture(id);
	}
	function down(e: PointerEvent) {
		// a second mouse button, or a third finger, is not part of the gesture
		if (e.button !== 0 || drag?.pointers.length === 2) return;
		stopAnim();
		suppressClick = false;
		const wasMoved = drag?.moved ?? false;
		const target = e.target as Element;
		drag = grab(drag, { id: e.pointerId, x: e.clientX, y: e.clientY }, camera);
		captured.set(e.pointerId, target);
		target.setPointerCapture(e.pointerId);
		// a pinch is not a look at the card under the first finger
		if (!wasMoved && drag.moved) onhover(undefined);
	}
	function move(e: PointerEvent) {
		if (!drag) return;
		const next = dragMove(drag, e.pointerId, e.clientX, e.clientY);
		if (!next) return;
		if (next.started) onhover(undefined);
		drag = next.drag;
		if (next.camera) {
			setCamera(next.camera);
			onusercamera?.();
		}
	}
	function up(e: PointerEvent) {
		if (!drag) return;
		// taken away (cancelled, or its capture lost) while it is part of the gesture: the gesture ends,
		// and cannot select
		if (e.type !== 'pointerup') {
			if (drag.pointers.some((p) => p.id === e.pointerId)) endDrag();
			return;
		}
		const next = release(drag, e.pointerId, camera);
		releaseCapture(e.pointerId);
		// set once a pan or a pinch begins, so no finger of it can select as it lifts
		suppressClick = next.moved;
		drag = next.drag;
	}
	/** End the gesture as if nothing was tapped. */
	function endDrag() {
		if (!drag) return;
		suppressClick = true;
		const ids = drag.pointers.map((p) => p.id);
		if (drag.away) ids.push(drag.away.id);
		drag = undefined;
		ids.forEach(releaseCapture);
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
				endDrag();
				setCamera(panCamera(camera, -e.deltaX * unitX, -e.deltaY * unitY));
				onusercamera?.();
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
		const onBlur = () => endDrag();
		el.addEventListener('wheel', onWheel, { passive: false });
		el.addEventListener('click', onClick, { capture: true });
		window.addEventListener('blur', onBlur);
		return () => {
			endDrag();
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
