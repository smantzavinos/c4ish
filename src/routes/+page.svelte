<script lang="ts">
	import '@fontsource/noto-sans/400.css';
	import '@fontsource/noto-sans/500.css';
	import '@fontsource/noto-sans/600.css';
	import '@fontsource/noto-sans/700.css';
	import '@fontsource/noto-sans/400-italic.css';

	let { data } = $props();
</script>

<svelte:head><title>c4ish examples</title></svelte:head>

<main>
	<header>
		<h1>c4ish</h1>
		<p>JSON model + project profile → reviewable architecture diagrams of a planned change. These SVGs are rendered by the library from <code>examples/</code>.</p>
		<nav>
			{#each data.diagrams as d (d.example + d.view)}
				<a href="#{d.example}-{d.view}">{d.example} / {d.view}</a>
			{/each}
		</nav>
	</header>
	{#each data.diagrams as d (d.example + d.view)}
		<section id="{d.example}-{d.view}">
			<h2>{d.example} <span>/ {d.view}</span></h2>
			{#if d.diagnostics.length}
				<ul class="diag">
					{#each d.diagnostics as m, i (i)}<li>{m}</li>{/each}
				</ul>
			{/if}
			<div class="svg">{@html d.svg}</div>
		</section>
	{/each}
</main>

<style>
	:global(body) {
		margin: 0;
		background: #f1f5f9;
		font-family: 'Noto Sans', system-ui, sans-serif;
		color: #0f172a;
	}
	main {
		padding: 24px;
	}
	header {
		max-width: 900px;
	}
	h1 {
		margin: 0 0 4px;
	}
	nav {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}
	h2 {
		font-size: 15px;
		margin: 32px 0 8px;
	}
	h2 span {
		color: #64748b;
		font-weight: 400;
	}
	.svg {
		overflow-x: auto;
		background: white;
		border: 1px solid #e2e8f0;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
	}
	.svg :global(svg) {
		display: block;
		max-width: 100%;
		height: auto;
	}
	.diag {
		color: #b45309;
		font-size: 13px;
	}
</style>
