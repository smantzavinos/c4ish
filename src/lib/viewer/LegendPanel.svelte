<script lang="ts">
	import type { Legend } from '../render/legend.js';

	let { legend, isOn, ontoggle }: { legend: Legend; isOn: (filter: string) => boolean; ontoggle: (filter: string) => void } = $props();
</script>

<div class="legend">
	<p class="meaning">{legend.meaning}</p>
	{#each legend.sections as s (s.id)}
		<h3>{s.title}</h3>
		<ul>
			{#each s.items as it (it.id)}
				<li>
					{#if it.filter}
						<button class:on={isOn(it.filter)} onclick={() => ontoggle(it.filter!)} title="Highlight on the diagram">
							<svg width={Math.max(30, it.swatchW)} height="20" aria-hidden="true">{@html it.swatch}</svg>
							<span>{it.label}{#if it.count && it.count > 1}<em> ×{it.count}</em>{/if}</span>
						</button>
					{:else}
						<div class="static">
							<svg width={Math.max(30, it.swatchW)} height="20" aria-hidden="true">{@html it.swatch}</svg>
							<span>{it.label}</span>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/each}
</div>

<style>
	.legend {
		padding: 4px 14px 16px;
		font-size: 12.5px;
	}
	.meaning {
		color: #64748b;
		font-style: italic;
		margin: 8px 0;
	}
	h3 {
		margin: 12px 0 4px;
		font-size: 10.5px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #475569;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	button,
	.static {
		display: flex;
		box-sizing: border-box;
		gap: 8px;
		align-items: center;
		width: 100%;
		padding: 2px 4px;
		border: 1px solid transparent;
		border-radius: 4px;
		background: none;
		font: inherit;
		text-align: left;
		color: #334155;
	}
	button {
		cursor: pointer;
	}
	button:hover {
		background: #f1f5f9;
	}
	button.on {
		background: #e0e7ff;
		border-color: #6366f1;
		color: #0f172a;
	}
	svg {
		flex: none;
	}
	em {
		color: #94a3b8;
		font-style: normal;
	}
</style>
