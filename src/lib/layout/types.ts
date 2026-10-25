/**
 * Layout engines turn sized boxes and connectors into geometry. The renderer depends only on
 * this interface, so other engines can be added later:
 * - an external binary (e.g. TALA) that receives the graph and returns geometry;
 * - pinned/manual positions from a sidecar layout file (`fixed` below), which an engine must
 *   respect or report as unsupported.
 */

export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LayoutPort {
	id: string;
	side: 'left' | 'right' | 'top' | 'bottom';
	/** Offset along the side, from the node's top (left/right) or left (top/bottom). */
	offset: number;
}

export interface LayoutNodeInput {
	id: string;
	/** Parent node id (compound nesting). Omit for top level. */
	parent?: string;
	/** Leaf size. Ignored for nodes that have children (computed from the children + padding). */
	width: number;
	height: number;
	/** Inner padding of a compound node (header space on top). */
	padding?: { top: number; right: number; bottom: number; left: number };
	/** Minimum size of a compound node (to fit its header). */
	minWidth?: number;
	ports?: LayoutPort[];
	/** Manual position relative to the parent (future: sidecar layout). */
	fixed?: Point;
}

export interface LayoutEdgeInput {
	id: string;
	source: string;
	target: string;
	sourcePort?: string;
	targetPort?: string;
	/** Label box to reserve space for, placed by the engine. */
	label?: { width: number; height: number };
	/** Relative routing weight; higher = keep short/straight. */
	priority?: number;
}

export interface LayoutInput {
	direction: 'right' | 'down' | 'left' | 'up';
	nodes: LayoutNodeInput[];
	edges: LayoutEdgeInput[];
	spacing?: { node?: number; layer?: number; edge?: number };
}

export interface EdgeGeometry {
	/** Absolute polyline: start, bends, end. */
	points: Point[];
	/** Absolute label box, if a label was requested. */
	label?: Rect;
}

export interface LayoutResult {
	width: number;
	height: number;
	/** Absolute rectangles for every node. */
	nodes: Map<string, Rect>;
	edges: Map<string, EdgeGeometry>;
	/** Engine notes, e.g. features it ignored (pins, ports). */
	warnings: string[];
}

export interface LayoutEngine {
	readonly name: string;
	layout(input: LayoutInput): Promise<LayoutResult>;
}
