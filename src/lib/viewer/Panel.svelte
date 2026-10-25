<script lang="ts">
	import type { Diagram } from '../render/diagram.js';
	import { changeStyle } from '../render/node.js';

	let { diagram, id, onselect }: { diagram: Diagram; id: string; onselect: (id: string | undefined) => void } = $props();

	const scene = $derived(diagram.scene);
	const profile = $derived(scene.profile);
	const node = $derived(diagram.nodes.find((n) => n.id === id) ?? diagram.frames.find((f) => f.id === id));
	const edge = $derived(diagram.edges.find((e) => e.id === id));
	const notes = $derived(diagram.notes.filter((n) => n.note.on === id));
	const list = (x: string | string[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
	const title = (eid: string) => scene.elementsById.get(eid)?.title ?? eid;
	const isUrl = (s: string) => /^https?:\/\//.test(s);
	const changeLabel = (c: string | undefined) => {
		const st = changeStyle(profile, c);
		return Object.values(profile.changeStates).find((x) => x.style === st)?.label ?? st;
	};
	const patternInfo = (pid: string) => {
		const p = scene.patterns.get(pid);
		const fam = p ? profile.patternFamilies[p.family] : undefined;
		return { id: pid, label: p?.label ?? pid, family: fam?.label, colour: p?.colour ?? fam?.colour ?? '#64748b', status: p?.status, catalog: p?.catalog, description: p?.description };
	};
	const contract = $derived(edge?.rel.contract ? scene.model.contracts?.find((c) => c.id === edge!.rel.contract) : undefined);
</script>

<aside class="panel">
	<button class="close" onclick={() => onselect(undefined)} aria-label="Close">×</button>
	{#if node?.el}
		{@const e = node.el}
		<p class="kind">{profile.elementKinds[e.kind]?.label ?? e.kind} · <span class="change {changeStyle(profile, e.change)}">{changeLabel(e.change)}</span></p>
		<h2>{e.title}</h2>
		{#if e.subtitle}<p class="sub">{e.subtitle}</p>{/if}

		{#if e.pattern || e.pattern === null || e.patterns?.length}
			<h3>Pattern</h3>
			{#if e.pattern === null}<p class="muted"><em>Deliberately no pattern.</em></p>{/if}
			{#each [e.pattern, ...(e.patterns ?? [])].filter((p): p is string => !!p) as pid, i (pid)}
				{@const p = patternInfo(pid)}
				<div class="pattern" style:--c={p.colour}>
					<strong>{p.label}</strong>
					{#if i === 0 && e.patternFit === 'partial'}<span class="tag">partial fit</span>{/if}
					{#if p.status === 'proposed'}<span class="tag proposed">proposed</span>{/if}
					{#if i > 0}<span class="tag">tag</span>{/if}
					<div class="muted small">{p.family ?? ''} · <code>{p.id}</code></div>
					{#if p.description}<p class="small">{p.description}</p>{/if}
					{#if p.catalog}
						<div class="small">Catalog: {#if isUrl(p.catalog)}<a href={p.catalog} target="_blank" rel="noreferrer">{p.catalog}</a>{:else}<code>{p.catalog}</code>{/if}</div>
					{/if}
				</div>
			{/each}
		{/if}

		{#if e.parts?.length}
			<h3>Parts</h3>
			<ul>
				{#each e.parts as part (part.title)}
					<li>{part.title}{#if part.pattern} — <span class="muted">{patternInfo(part.pattern).label}</span>{/if}</li>
				{/each}
			</ul>
		{/if}

		{#if list(e.details).length}
			<h3>Details</h3>
			<ul>
				{#each list(e.details) as d, i (i)}<li>{d}</li>{/each}
			</ul>
		{/if}

		{#if e.libraries?.length}
			<h3>Libraries</h3>
			<ul>
				{#each e.libraries as lid (lid)}
					{@const lib = scene.elementsById.get(lid)}
					<li>{lib?.title ?? lid}{lib?.version ? ` ${lib.version}` : ''} <span class="muted">· {changeLabel(lib?.change)}</span></li>
				{/each}
			</ul>
		{/if}

		{#if e.fields?.length}
			<h3>Fields</h3>
			<table>
				<tbody>
					{#each e.fields as f (f.id)}
						<tr class={changeStyle(profile, f.change)}><td>{f.title ?? f.id}</td><td class="muted">{f.type ?? ''}</td><td class="muted small">{changeStyle(profile, f.change) === 'reused' ? '' : changeLabel(f.change)}</td></tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if e.implementedBy?.length}
			<h3>Implemented by</h3>
			<ul>
				{#each e.implementedBy as iid (iid)}<li>{title(iid)}</li>{/each}
			</ul>
		{/if}
	{:else if edge}
		{@const r = edge.rel}
		{@const kind = profile.relationshipKinds[r.kind]}
		{@const enf = r.enforcement ? profile.enforcement[r.enforcement] : undefined}
		<p class="kind">{kind?.label ?? r.kind} · <span class="change {changeStyle(profile, r.change)}">{changeLabel(r.change)}</span></p>
		<h2>{r.label ?? `${title(r.from)} → ${title(r.to)}`}</h2>
		<p class="route">
			<button class="link" onclick={() => onselect(r.from)}>{title(r.from)}</button> →
			<button class="link" onclick={() => onselect(r.to)}>{title(r.to)}</button>
		</p>
		{#if enf}
			<h3>Enforcement</h3>
			<p><span class="swatch" style:background={enf.colour}></span><strong>{enf.label}</strong></p>
			{#if enf.description}<p class="small muted">{enf.description}</p>{/if}
		{:else if kind?.category === 'data'}
			<p class="warn">Enforcement not stated.</p>
		{/if}
		{#if list(r.details).length}
			<h3>Details</h3>
			<ul>
				{#each list(r.details) as d, i (i)}<li>{d}</li>{/each}
			</ul>
		{/if}
		{#if contract}
			<h3>Contract {diagram.contractTags.get(contract.id) ?? ''} · {contract.title ?? contract.id}</h3>
			<dl>
				{#each Object.entries(contract.clauses) as [k, v] (k)}
					<dt>{k}</dt>
					<dd>{v}</dd>
				{/each}
			</dl>
		{/if}
		{#if r.divergence}
			<h3>Divergence</h3>
			<p>{typeof r.divergence === 'string' ? r.divergence : `${r.divergence.id}${r.divergence.text ? ` — ${r.divergence.text}` : ''}`}</p>
		{/if}
	{/if}

	{#if notes.length}
		<h3>Notes</h3>
		{#each notes as n (n.num)}
			<div class="note {n.note.kind ?? 'note'}">
				<span class="disc">{n.num}</span>
				<strong>{(n.note.kind ?? 'note').toUpperCase()}{n.note.title ? ` — ${n.note.title}` : ''}</strong>
				<p>{n.note.text}</p>
			</div>
		{/each}
	{/if}
</aside>

<style>
	.panel {
		position: relative;
		padding: 16px 18px 24px;
		font-size: 13.5px;
		line-height: 1.45;
		color: #0f172a;
	}
	.close {
		position: absolute;
		right: 10px;
		top: 8px;
		border: 0;
		background: none;
		font-size: 22px;
		cursor: pointer;
		color: #64748b;
	}
	.kind {
		margin: 0;
		font-size: 11px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #64748b;
		font-weight: 700;
	}
	h2 {
		margin: 4px 0 4px;
		font-size: 18px;
	}
	h3 {
		margin: 16px 0 6px;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #475569;
	}
	.sub {
		margin: 0;
		color: #334155;
	}
	ul {
		margin: 0;
		padding-left: 18px;
	}
	li {
		margin: 2px 0;
	}
	.muted {
		color: #64748b;
	}
	.small {
		font-size: 12px;
	}
	.pattern {
		border-left: 5px solid var(--c);
		background: color-mix(in srgb, var(--c) 10%, white);
		padding: 6px 10px;
		margin-bottom: 6px;
	}
	.pattern p {
		margin: 4px 0 0;
	}
	.tag {
		display: inline-block;
		margin-left: 6px;
		font-size: 10.5px;
		padding: 0 5px;
		border: 1px solid #94a3b8;
		border-radius: 3px;
		color: #475569;
	}
	.tag.proposed {
		border-style: dashed;
	}
	.change {
		color: #0f172a;
	}
	.change.reused {
		color: #94a3b8;
	}
	.change.removed {
		text-decoration: line-through;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 12.5px;
	}
	td {
		border-top: 1px solid #e2e8f0;
		padding: 2px 4px;
	}
	tr.new td:first-child {
		font-weight: 700;
	}
	tr.removed td:first-child {
		text-decoration: line-through;
		color: #94a3b8;
	}
	.swatch {
		display: inline-block;
		width: 22px;
		height: 3px;
		margin-right: 8px;
		vertical-align: middle;
	}
	.warn {
		color: #c026d3;
	}
	dl {
		margin: 0;
	}
	dt {
		font-weight: 700;
		font-size: 12px;
	}
	dd {
		margin: 0 0 6px 0;
	}
	.route {
		margin: 0;
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: #2563eb;
		cursor: pointer;
		font: inherit;
		text-decoration: underline;
	}
	.note {
		border: 1px solid #e2e8f0;
		padding: 6px 10px;
		margin-bottom: 6px;
	}
	.note.risk {
		border-color: #334155;
		border-width: 1.5px;
	}
	.note p {
		margin: 4px 0 0;
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
</style>
