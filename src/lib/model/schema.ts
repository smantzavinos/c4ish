/**
 * JSON Schemas (draft-07) for c4ish models and profiles, schema v0.
 * `pnpm gen:schema` writes them to `schema/*.json` for editors and other tools.
 */

const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.:/-]*$' };
const text = { type: 'string' };
const textOrLines = { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };
const divergence = {
	anyOf: [
		{ type: 'string' },
		{
			type: 'object',
			required: ['id'],
			additionalProperties: false,
			properties: { id: text, text }
		}
	]
};
const direction = { enum: ['right', 'down', 'left', 'up', 'auto'] };
const lineStyle = { enum: ['solid', 'dashed', 'dotted', 'long-dash', 'double'] };
const colour = { type: 'string', pattern: '^#[0-9a-fA-F]{3,8}$' };
const severity = { enum: ['error', 'warning', 'off'] };

const patternDef = {
	type: 'object',
	required: ['label', 'family'],
	additionalProperties: false,
	properties: {
		id,
		label: text,
		family: text,
		status: { enum: ['catalogued', 'proposed'] },
		icon: text,
		colour,
		catalog: text,
		description: text
	}
};

export const modelSchema = {
	$schema: 'http://json-schema.org/draft-07/schema#',
	$id: 'https://c4ish.dev/schema/v0/model.json',
	title: 'c4ish model (schema v0)',
	type: 'object',
	required: ['schemaVersion', 'title', 'views', 'elements'],
	additionalProperties: false,
	properties: {
		$schema: text,
		schemaVersion: { const: 0 },
		id: text,
		title: text,
		summary: text,
		profile: text,
		provenance: { type: 'object' },
		views: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				required: ['id', 'kind', 'title'],
				additionalProperties: false,
				properties: {
					id,
					kind: text,
					title: text,
					subtitle: text,
					focus: { type: 'array', items: text },
					include: { type: 'array', items: id },
					exclude: { type: 'array', items: id },
					omitRelationships: { type: 'array', items: id },
					direction,
					fields: { enum: ['all', 'changed', 'none'] }
				}
			}
		},
		elements: {
			type: 'array',
			items: {
				type: 'object',
				required: ['id', 'kind', 'title'],
				additionalProperties: false,
				properties: {
					id,
					kind: text,
					parent: id,
					title: text,
					subtitle: text,
					details: textOrLines,
					pattern: { anyOf: [text, { type: 'null' }] },
					patternFit: { enum: ['full', 'partial'] },
					patterns: { type: 'array', items: text },
					change: text,
					lifecycle: text,
					area: text,
					libraries: { type: 'array', items: id },
					version: text,
					fields: {
						type: 'array',
						items: {
							type: 'object',
							required: ['id'],
							additionalProperties: false,
							properties: { id: text, title: text, type: text, change: text, note: text }
						}
					},
					indexes: {
						type: 'array',
						items: {
							type: 'object',
							required: ['id', 'fields'],
							additionalProperties: false,
							properties: { id: text, fields: { type: 'array', items: text }, change: text }
						}
					},
					ties: {
						type: 'array',
						items: {
							type: 'object',
							required: ['fields'],
							additionalProperties: false,
							properties: {
								id: text,
								fields: { type: 'array', items: text, minItems: 2, maxItems: 2 },
								label: text,
								enforcement: text,
								change: text,
								divergence
							}
						}
					},
					parts: {
						type: 'array',
						items: {
							type: 'object',
							required: ['title'],
							additionalProperties: false,
							properties: { title: text, pattern: { anyOf: [text, { type: 'null' }] }, change: text }
						}
					},
					divergence,
					implementedBy: { type: 'array', items: id },
					mappingLabel: text,
					sources: { type: 'array', items: text },
					views: { type: 'array', items: id }
				}
			}
		},
		relationships: {
			type: 'array',
			items: {
				type: 'object',
				required: ['id', 'from', 'to', 'kind'],
				additionalProperties: false,
				properties: {
					id,
					from: id,
					to: id,
					kind: text,
					enforcement: text,
					change: text,
					label: text,
					details: textOrLines,
					contract: id,
					divergence,
					delta: { enum: ['added', 'removed'] },
					fromField: text,
					toField: text,
					views: { type: 'array', items: id }
				}
			}
		},
		contracts: {
			type: 'array',
			items: {
				type: 'object',
				required: ['id', 'clauses'],
				additionalProperties: false,
				properties: {
					id,
					title: text,
					change: text,
					clauses: { type: 'object', additionalProperties: text }
				}
			}
		},
		notes: {
			type: 'array',
			items: {
				type: 'object',
				required: ['text'],
				additionalProperties: false,
				properties: {
					id,
					on: id,
					kind: { enum: ['focus', 'risk', 'note', 'question'] },
					title: text,
					text,
					views: { type: 'array', items: id }
				}
			}
		},
		absences: {
			type: 'array',
			items: {
				type: 'object',
				required: ['id', 'text'],
				additionalProperties: false,
				properties: { id, parent: id, text, views: { type: 'array', items: id } }
			}
		},
		proposedPatterns: {
			type: 'array',
			items: { ...patternDef, required: ['id', 'label', 'family'] }
		},
		tours: {
			type: 'array',
			items: {
				type: 'object',
				required: ['id', 'title', 'steps'],
				additionalProperties: false,
				properties: {
					id,
					title: text,
					summary: text,
					steps: {
						type: 'array',
						minItems: 1,
						items: {
							type: 'object',
							required: ['id', 'title', 'view'],
							additionalProperties: false,
							properties: {
								id,
								title: text,
								body: text,
								view: id,
								focus: { type: 'array', items: id },
								select: id,
								highlight: {
									type: 'object',
									additionalProperties: false,
									properties: {
										patterns: { type: 'array', items: id },
										change: { type: 'array', items: id },
										enforcement: { type: 'array', items: id },
										proposed: { type: 'boolean' }
									}
								},
								path: {
									type: 'array',
									items: {
										anyOf: [
											id,
											{ type: 'object', required: ['jump'], additionalProperties: false, properties: { jump: { const: true }, text } }
										]
									}
								},
								notes: { type: 'array', items: id },
								dimOthers: { type: 'boolean' },
								onlyChanges: { type: 'boolean' }
							}
						}
					}
				}
			}
		}
	}
} as const;

const record = (value: Record<string, unknown>) => ({ type: 'object', additionalProperties: value });

export const profileSchema = {
	$schema: 'http://json-schema.org/draft-07/schema#',
	$id: 'https://c4ish.dev/schema/v0/profile.json',
	title: 'c4ish profile (schema v0)',
	type: 'object',
	required: ['profileVersion', 'id', 'title'],
	additionalProperties: false,
	properties: {
		$schema: text,
		profileVersion: { const: 0 },
		id: text,
		title: text,
		extends: text,
		elementKinds: record({
			type: 'object',
			required: ['label'],
			additionalProperties: false,
			properties: {
				label: text,
				role: { enum: ['element', 'library'] },
				icon: text,
				area: text,
				parents: { type: 'array', items: text }
			}
		}),
		patternFamilies: record({
			type: 'object',
			required: ['label', 'icon', 'colour'],
			additionalProperties: false,
			properties: { label: text, icon: text, colour }
		}),
		patterns: record(patternDef),
		relationshipKinds: record({
			type: 'object',
			required: ['label', 'category'],
			additionalProperties: false,
			properties: {
				label: text,
				category: { enum: ['runtime', 'data', 'reference', 'trace', 'lifecycle'] },
				direction: { enum: ['forward', 'none', 'both'] },
				arrow: { enum: ['filled', 'open', 'diamond', 'none'] },
				enforcementRequired: { type: 'boolean' },
				colour,
				line: lineStyle
			}
		}),
		enforcement: record({
			type: 'object',
			required: ['label', 'colour', 'line'],
			additionalProperties: false,
			properties: { label: text, description: text, colour, line: lineStyle, width: { type: 'number' } }
		}),
		changeStates: record({
			type: 'object',
			required: ['label', 'style'],
			additionalProperties: false,
			properties: { label: text, style: { enum: ['new', 'modified', 'reused', 'removed'] }, badge: text }
		}),
		lifecycle: record({
			type: 'object',
			required: ['label', 'border', 'colour'],
			additionalProperties: false,
			properties: {
				label: text,
				border: { enum: ['solid', 'dashed'] },
				colour,
				fill: colour,
				glyph: { enum: ['lock', 'none'] }
			}
		}),
		areas: record({
			type: 'object',
			required: ['label', 'colour', 'fill'],
			additionalProperties: false,
			properties: { label: text, colour, fill: colour }
		}),
		views: record({
			type: 'object',
			required: ['label', 'corners', 'colour'],
			additionalProperties: false,
			properties: {
				label: text,
				corners: { enum: ['sharp', 'rounded'] },
				colour: {
					type: 'object',
					required: ['nodes', 'edges', 'meaning'],
					additionalProperties: false,
					properties: {
						nodes: { enum: ['area', 'pattern', 'none'] },
						edges: { enum: ['enforcement', 'kind', 'none'] },
						meaning: text
					}
				},
				forbidSiblingChains: { type: 'boolean' },
				direction
			}
		}),
		rules: {
			type: 'object',
			additionalProperties: false,
			properties: {
				missingEnforcement: severity,
				missingChange: severity,
				siblingChains: severity,
				textBudget: severity,
				removedWithLiveEdges: severity,
				tourCoverage: severity,
				titleMaxChars: { type: 'integer' },
				subtitleMaxChars: { type: 'integer' },
				labelMaxChars: { type: 'integer' }
			}
		},
		divergenceColour: colour
	}
} as const;
