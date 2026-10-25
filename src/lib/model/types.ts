/**
 * c4ish schema v0 — TypeScript types for models and profiles.
 *
 * The JSON Schemas in `./schema.ts` mirror these types; keep them in sync.
 */

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export interface Model {
	schemaVersion: 0;
	/** Short slug for the change. */
	id?: string;
	title: string;
	summary?: string;
	/** Path to a profile JSON file, relative to the model file. CLI `--profile` wins. */
	profile?: string;
	/** Free-form provenance (baseline commits, sources). Not rendered. */
	provenance?: Record<string, unknown>;
	views: View[];
	elements: Element[];
	relationships?: Relationship[];
	contracts?: Contract[];
	notes?: Note[];
	absences?: Absence[];
	/** Patterns this model proposes (not yet in the profile catalog). */
	proposedPatterns?: PatternDef[];
}

export interface View {
	id: string;
	/** A view kind defined in the profile (e.g. "engineering", "product"). */
	kind: string;
	title: string;
	subtitle?: string;
	/** What the reviewer must check first. Rendered as a "review focus" card. */
	focus?: string[];
	/** Element ids. Ancestors of included elements are included automatically. Omit = all elements allowed in this view. */
	include?: string[];
	exclude?: string[];
	/** Relationship ids hidden in this view (the model keeps them). */
	omitRelationships?: string[];
	direction?: Direction;
	/** Field rendering for data elements in this view. Default "all". */
	fields?: 'all' | 'changed' | 'none';
}

export type Direction = 'right' | 'down' | 'left' | 'up';

export interface Element {
	id: string;
	/** An element kind defined in the profile (system, container, component, data, product, library, …). */
	kind: string;
	parent?: string;
	/** Short title (≤ ~40 chars). */
	title: string;
	/** One line (≤ ~64 chars). */
	subtitle?: string;
	/** Long text: footnotes in static SVG, side panel in the viewer. */
	details?: string | string[];
	/** Pattern id from the profile catalog or `proposedPatterns`. `null` = deliberately no pattern. */
	pattern?: string | null;
	/** How well the element follows its pattern. Default "full". */
	patternFit?: 'full' | 'partial';
	/** Additional patterns that apply (e.g. data patterns on a table). */
	patterns?: string[];
	/** Change state id from the profile (new, modified, reused, removed). Missing = lint warning, drawn as reused. */
	change?: string;
	/** Lifecycle state id from the profile (draft, released, …). */
	lifecycle?: string;
	/** Model area for colour in area-coloured views (product, system, …). Inherited from the parent. */
	area?: string;
	/** Ids of `library` elements used inside this element. */
	libraries?: string[];
	/** Library version/label shown in the chip (library elements). */
	version?: string;
	fields?: Field[];
	indexes?: Index[];
	ties?: Tie[];
	/** Grouped members that carry their own pattern/change. */
	parts?: Part[];
	divergence?: Divergence;
	/** Product → engineering mapping. */
	implementedBy?: string[];
	/** Short text for the mapping footer (otherwise derived from implementedBy titles). */
	mappingLabel?: string;
	sources?: string[];
	/** Restrict this element to these view ids. */
	views?: string[];
}

export interface Field {
	id: string;
	title?: string;
	type?: string;
	change?: string;
	note?: string;
}

export interface Index {
	id: string;
	fields: string[];
	change?: string;
}

export interface Tie {
	id?: string;
	/** Two field ids of the same element that must agree. */
	fields: [string, string];
	/** What must be true. */
	label?: string;
	enforcement?: string;
	change?: string;
	divergence?: Divergence;
}

export interface Part {
	title: string;
	pattern?: string | null;
	change?: string;
}

export type Divergence = string | { id: string; text?: string };

export interface Relationship {
	id: string;
	from: string;
	to: string;
	/** Relationship kind id from the profile. */
	kind: string;
	enforcement?: string;
	change?: string;
	/** Short label (≤ ~40 chars). */
	label?: string;
	details?: string | string[];
	contract?: string;
	divergence?: Divergence;
	/** Illustrative scenario delta, independent of feature change. */
	delta?: 'added' | 'removed';
	fromField?: string;
	toField?: string;
	views?: string[];
}

export interface Contract {
	id: string;
	title?: string;
	change?: string;
	/** Named clauses: args, returns, access, limits, ordering, atomicity, security, … */
	clauses: Record<string, string>;
}

export interface Note {
	id?: string;
	/** Element or relationship id. Omit for a view-level note. */
	on?: string;
	kind?: 'focus' | 'risk' | 'note' | 'question';
	title?: string;
	text: string;
	views?: string[];
}

export interface Absence {
	id: string;
	/** Element inside which the caption sits (omit = view root). */
	parent?: string;
	text: string;
	views?: string[];
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'long-dash' | 'double';
export type ArrowHead = 'filled' | 'open' | 'diamond' | 'none';
export type Corners = 'sharp' | 'rounded';

export interface Profile {
	profileVersion: 0;
	id: string;
	title: string;
	/** "default" = the built-in c4ish default profile; entries here override/add. */
	extends?: string;
	elementKinds: Record<string, ElementKindDef>;
	patternFamilies: Record<string, PatternFamilyDef>;
	patterns: Record<string, Omit<PatternDef, 'id'>>;
	relationshipKinds: Record<string, RelationshipKindDef>;
	enforcement: Record<string, EnforcementDef>;
	changeStates: Record<string, ChangeStateDef>;
	lifecycle: Record<string, LifecycleDef>;
	areas: Record<string, AreaDef>;
	views: Record<string, ViewNotation>;
	rules?: LintRules;
	divergenceColour?: string;
}

/** element = card, or titled frame when it has children in the view; library = chip inside its users. */
export type ElementRole = 'element' | 'library';

export interface ElementKindDef {
	label: string;
	role?: ElementRole;
	icon?: string;
	area?: string;
	/** Allowed parent kinds (omit = any). */
	parents?: string[];
}

export interface PatternFamilyDef {
	label: string;
	icon: string;
	colour: string;
}

export interface PatternDef {
	id: string;
	label: string;
	family: string;
	/** "catalogued" (default) or "proposed". */
	status?: 'catalogued' | 'proposed';
	icon?: string;
	catalog?: string;
	description?: string;
}

export interface RelationshipKindDef {
	label: string;
	category: 'runtime' | 'data' | 'reference' | 'trace' | 'lifecycle';
	/** Arrow at the `to` end (forward), none, or both ends. */
	direction?: 'forward' | 'none' | 'both';
	arrow?: ArrowHead;
	/** Lint: relationship must state enforcement. */
	enforcementRequired?: boolean;
	/** Used when the view colours connectors by kind. */
	colour?: string;
	line?: LineStyle;
}

export interface EnforcementDef {
	label: string;
	description?: string;
	colour: string;
	line: LineStyle;
	width?: number;
}

export interface ChangeStateDef {
	label: string;
	/** Visual treatment from the c4ish change vocabulary. */
	style: 'new' | 'modified' | 'reused' | 'removed';
	badge?: string;
}

export interface LifecycleDef {
	label: string;
	border: 'solid' | 'dashed';
	colour: string;
	fill?: string;
	glyph?: 'lock' | 'none';
}

export interface AreaDef {
	label: string;
	colour: string;
	fill: string;
}

export interface ViewNotation {
	label: string;
	corners: Corners;
	colour: {
		/** Hue on nodes: area colour, pattern-family colour, or none. */
		nodes: 'area' | 'pattern' | 'none';
		/** Hue on connectors: by enforcement, by relationship kind, or none. */
		edges: 'enforcement' | 'kind' | 'none';
		/** The single sentence a reader learns: what colour means in this view. */
		meaning: string;
	};
	/** Lint: siblings must not chain (A→B→C among siblings). */
	forbidSiblingChains?: boolean;
	direction?: Direction;
}

export type Severity = 'error' | 'warning' | 'off';

export interface LintRules {
	missingEnforcement?: Severity;
	missingChange?: Severity;
	siblingChains?: Severity;
	textBudget?: Severity;
	removedWithLiveEdges?: Severity;
	titleMaxChars?: number;
	subtitleMaxChars?: number;
	labelMaxChars?: number;
}

/** A profile as written on disk: every catalog is optional when it `extends` another profile. */
export type ProfileInput = Partial<Omit<Profile, 'profileVersion' | 'id' | 'title'>> & {
	profileVersion: 0;
	id: string;
	title: string;
};
