<script lang="ts">
	import '@fontsource/noto-sans/400.css';
	import '@fontsource/noto-sans/500.css';
	import '@fontsource/noto-sans/600.css';
	import '@fontsource/noto-sans/700.css';
	import '@fontsource/noto-sans/400-italic.css';
	import Viewer from '../../lib/viewer/Viewer.svelte';

	let { data } = $props();
</script>

<svelte:head><title>c4ish viewer</title></svelte:head>

<Viewer examples={data.examples} />

<style>
	:global(body) {
		margin: 0;
	}
</style>
