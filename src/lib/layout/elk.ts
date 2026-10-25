import ElkModule from 'elkjs/lib/elk.bundled.js';
import type { ELK as ElkInstance, ELKConstructorArguments, ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api.js';

// elkjs is CommonJS; depending on the loader the constructor is the module or its `default`.
const ELK = ((ElkModule as unknown as { default?: unknown }).default ?? ElkModule) as unknown as new (args?: ELKConstructorArguments) => ElkInstance;
import type { EdgeGeometry, LayoutEngine, LayoutInput, LayoutResult, Rect } from './types.js';

const DIRECTION = { right: 'RIGHT', down: 'DOWN', left: 'LEFT', up: 'UP' } as const;

export interface ElkEngineOptions {
	/** Extra ELK layout options merged into the root (advanced tuning). */
	rootOptions?: LayoutOptions;
}

/** Layered, hierarchical (compound) layout with orthogonal routing via elkjs. */
export class ElkLayoutEngine implements LayoutEngine {
	readonly name = 'elk-layered';
	private elk = new ELK();
	constructor(private options: ElkEngineOptions = {}) {}

	async layout(input: LayoutInput): Promise<LayoutResult> {
		const warnings: string[] = [];
		const spacing = { node: 40, layer: 64, edge: 14, ...input.spacing };
		const byId = new Map<string, ElkNode>();
		const roots: ElkNode[] = [];
		const hasChildren = new Set(input.nodes.filter((n) => n.parent).map((n) => n.parent!));
		// ELK reads spacing from each compound node itself (no inheritance), so every graph level gets it.
		const spacingOptions: LayoutOptions = {
			'elk.spacing.nodeNode': String(spacing.node),
			'elk.layered.spacing.nodeNodeBetweenLayers': String(spacing.layer),
			'elk.spacing.edgeNode': String(Math.round(spacing.edge * 1.5)),
			'elk.spacing.edgeEdge': String(spacing.edge),
			'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.round(spacing.edge * 1.5)),
			'elk.layered.spacing.edgeEdgeBetweenLayers': String(spacing.edge)
		};

		for (const n of input.nodes) {
			if (n.fixed) warnings.push(`elk: fixed position for "${n.id}" ignored (pins are not supported yet)`);
			const node: ElkNode = { id: n.id, layoutOptions: {} };
			if (hasChildren.has(n.id)) {
				const p = n.padding ?? { top: 40, right: 16, bottom: 16, left: 16 };
				node.layoutOptions!['elk.padding'] = `[top=${p.top},left=${p.left},bottom=${p.bottom},right=${p.right}]`;
				node.layoutOptions!['elk.nodeSize.constraints'] = 'MINIMUM_SIZE';
				node.layoutOptions!['elk.nodeSize.minimum'] = `(${n.minWidth ?? n.width},${p.top + p.bottom + 24})`;
				Object.assign(node.layoutOptions!, spacingOptions);
				node.children = [];
			} else {
				node.width = n.width;
				node.height = n.height;
			}
			if (n.ports?.length) {
				node.layoutOptions!['elk.portConstraints'] = 'FIXED_POS';
				node.ports = n.ports.map((p) => ({
					id: p.id,
					width: 1,
					height: 1,
					x: p.side === 'left' ? 0 : p.side === 'right' ? n.width - 1 : p.offset,
					y: p.side === 'top' ? 0 : p.side === 'bottom' ? n.height - 1 : p.offset,
					layoutOptions: { 'elk.port.side': p.side.toUpperCase() }
				}));
			}
			byId.set(n.id, node);
		}
		for (const n of input.nodes) {
			const node = byId.get(n.id)!;
			const parent = n.parent ? byId.get(n.parent) : undefined;
			if (n.parent && !parent) throw new Error(`layout: unknown parent "${n.parent}" for "${n.id}"`);
			(parent ? parent.children! : roots).push(node);
		}

		const edges: ElkExtendedEdge[] = input.edges.map((e) => ({
			id: e.id,
			sources: [e.sourcePort ?? e.source],
			targets: [e.targetPort ?? e.target],
			labels: e.label ? [{ id: `${e.id}__label`, text: ' ', width: e.label.width, height: e.label.height, layoutOptions: { 'elk.edgeLabels.inline': 'true' } }] : [],
			layoutOptions: e.priority ? { 'elk.layered.priority.shortness': String(e.priority), 'elk.layered.priority.straightness': String(e.priority) } : undefined
		}));

		const graph: ElkNode = {
			id: '__root',
			layoutOptions: {
				'elk.algorithm': 'layered',
				'elk.direction': DIRECTION[input.direction],
				'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
				'elk.edgeRouting': 'ORTHOGONAL',
				'elk.json.edgeCoords': 'ROOT',
				'elk.json.shapeCoords': 'ROOT',
				...spacingOptions,
				'elk.spacing.edgeLabel': '4',
				'elk.spacing.labelNode': '6',
				'elk.edgeLabels.placement': 'CENTER',
				'elk.edgeLabels.inline': 'true',
				'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
				'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
				'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
				'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
				'elk.layered.mergeEdges': 'false',
				'elk.layered.thoroughness': '20',
				'elk.spacing.componentComponent': String(spacing.node),
				'elk.padding': '[top=0,left=0,bottom=0,right=0]',
				...this.options.rootOptions
			},
			children: roots,
			edges
		};

		const out = await this.elk.layout(graph);

		const nodes = new Map<string, Rect>();
		const walk = (n: ElkNode) => {
			for (const c of n.children ?? []) {
				nodes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 });
				walk(c);
			}
		};
		walk(out);

		const edgeGeo = new Map<string, EdgeGeometry>();
		const collect = (n: ElkNode) => {
			for (const e of (n.edges ?? []) as ElkExtendedEdge[]) {
				const s = e.sections?.[0];
				if (!s) continue;
				const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x, y: p.y }));
				const l = e.labels?.[0];
				edgeGeo.set(e.id, {
					points,
					label: l ? { x: l.x ?? 0, y: l.y ?? 0, width: l.width ?? 0, height: l.height ?? 0 } : undefined
				});
			}
			for (const c of n.children ?? []) collect(c);
		};
		collect(out);
		for (const e of input.edges) if (!edgeGeo.has(e.id)) warnings.push(`elk: no route for edge "${e.id}"`);

		return { width: out.width ?? 0, height: out.height ?? 0, nodes, edges: edgeGeo, warnings };
	}
}
