# c4ish — Design (draft)

Status: draft for discussion. Concepts first; the JSON contract is a sketch to be settled by modelling 2–3 real changes (see [`PLAN.md`](PLAN.md)).

## 1. Purpose

Render a **planned change** to a software system so a human can review it in minutes. The model is written by an agent or engineer, validated by c4ish against a **project profile**, laid out automatically, adjusted by hand if needed, and exported.

The questions a diagram must answer at a glance:
1. What changes for the user? (product view)
2. What is being built, and where does it live? (engineering view)
3. Which known pattern does each piece follow, and where does it deviate or introduce a new one?
4. What is new, modified, reused or removed?
5. Who guarantees each relationship holds?

### Non-goals
- A maintained inventory of a whole system. A model is scoped to one change, plus the unchanged context it touches.
- Strict C4 conformance. C4's levels are a starting point, not a constraint.
- Code generation, or reverse-engineering models from code (possible later; not designed for).
- Live collaboration.

## 2. Concepts

### Elements
| Element | Meaning |
|---|---|
| **System** | The outermost boundary; external systems are drawn as references |
| **Container** | A runtime, deployment or data boundary (a web app, a backend, a database) |
| **Component** | A unit inside a container, of a profile-defined **type** and **variation** (its pattern) |
| **Data element** | A table, document or record type; can show **fields** |
| **Product concept** | A user-facing concept the change touches (an entity, a page, a workflow) |
| **Library** | An external library or tool used *inside* a component, drawn as a badge or nested element (C4 usually loses this) |
| **Contract** | An interface between components that two parties build against |

Levels nest: system → container → component → data → field. A diagram can render any level and depth.

### Two views of one change
- **Product view:** product concepts and their relationships.
- **Engineering view:** containers, components, data.
- **Mapping:** a product concept can be linked to the elements that implement it, and a view can show both side by side.

Each view has its own notation (shape family and colour meaning), so a reader knows within a second which view they're looking at.

### Structure versus reference
**Structure is drawn as nesting; reference is drawn as a connector.** A child that cannot exist without its parent sits inside it. Two things that exist independently are linked by an edge. Siblings never chain to imply flow; they converge on their parent.

### Relationships
Every relationship has:
- a **kind** from the profile (calls, reads, writes, subscribes, contains-reference, traces-to, …), with a defined arrow direction;
- an **enforcement** level: who rejects a bad state. The default scale is *platform enforces* / *our code enforces* / *nothing enforces*. **No neutral lines:** lint flags a relationship without enforcement where the profile requires it;
- optionally, a **contract** reference.

Line style carries the meaning; colour reinforces it. Diagrams must survive greyscale.

### Constraints between fields
A **tie** joins two fields that must agree but are stored separately. It is drawn as a bar, labelled with what must be true. The goal state is no ties.

### Change state
Every element and relationship has a change state: **new**, **modified**, **reused** (unchanged, shown for context) or **removed**. Removed items stay visible, greyed, never deleted from the picture. When two versions of something are compared, every item carries a state: carried, changed, added or removed.

### Lifecycle
Profiles can define lifecycle states (for example draft and released) with their own style, such as a dashed border versus a solid one with a lock glyph.

### Patterns and deviations
- A component's `type/variation` refers to a **pattern** in the project's catalog (by id and link).
- A **proposed** pattern is marked distinctly: it is the thing a reviewer must look at.
- A **divergence** (code that doesn't follow its declared pattern, or an implementation that differs from intent) carries a marker on the element or edge that is wrong, not in a footnote.

### Absence
Something deliberately missing is stated: a grey italic caption where it would be. A reader should never have to notice a missing arrow.

## 3. Profiles

A **profile** is project-owned data: element types and variations (with catalog links), relationship kinds and directions, enforcement levels, lifecycle states, and the notation for each view (shapes, line styles, colours, glyphs). c4ish ships a default generic profile; projects extend or replace it.

**Notation rules** are part of the profile and run as lint:
- every connector states its enforcement;
- colour means one thing per view;
- every compared item carries a change state;
- no sibling chains.

### Tours

A **tour** is an authored walkthrough of the change for review. Each step is a view plus the state a reviewer could set by hand: what is lit (`focus`, `select`, legend `highlight` keys), an ordered `path` of connectors (numbered on the drawing), which notes to show, plus short narration. The viewer plays it as a step card. The CLI exports it as static pages. Lint checks references and path contiguity, and warns about changes, proposals, risks and divergences that no step covers. A good review tour follows: what changes for the user → main flows as paths → patterns in use → proposed patterns → removed/reused → risks. See DECISIONS 24–26.

```json
"tours": [{ "id": "review", "title": "Review: wiring writes", "steps": [  // excerpt; read-path ids illustrative
  { "id": "write-path", "view": "engineering", "title": "Write path",
    "body": "Every pin write goes through the **wiring guard**.",
    "path": ["routeFrame", "framePicker", "pickerWrite", "guardWrites", "pinContract"],
    "select": "guard" },
  { "id": "read-path", "view": "engineering", "title": "Read path",
    "path": ["pageRead", { "jump": true, "text": "later" }, "tableRead"], "notes": ["n-pin"] },
  { "id": "proposed", "view": "engineering", "title": "Proposed patterns",
    "highlight": { "proposed": true } }
]}]
```

## 4. Layout

- **Automatic first.** v0 uses elkjs (layered, compound, orthogonal) behind a `LayoutEngine` interface; a TALA adapter can be added later (DECISIONS 11).
- **Manual adjustment in the viewer:** drag, resize, pin. Re-layout respects pins.
- **Sidecar layout file** beside the model (`<name>.layout.json`): positions, sizes, pins and viewport, keyed by stable element ids. When the model changes, surviving ids keep their saved geometry and new ones are placed automatically. The model never holds geometry.
- **Routing** is a known hard problem: guided routes, exact ports, strict containment. v0 accepts the layout engine's routes and recomputes only the edges a manual move affects.

## 5. JSON contract

**Schema v0 is now normative:** `src/lib/model/types.ts` (TypeScript), `src/lib/model/schema.ts` → `schema/model.schema.json` and `schema/profile.schema.json`. The examples in `examples/` are the reference. Main differences from the original sketch below:
- `name` is split into `title` / `subtitle` / `details`;
- `type`/`variation` became one `pattern` id. `null` means deliberately no pattern; `patternFit: "partial"` and `parts[]` handle mixed fits. Unapproved patterns go in `proposedPatterns`;
- other additions: `fields[]`, `indexes[]`, `ties[]` (with enforcement and `divergence`), `libraries[]` (ids of `library` elements), `lifecycle`, `area`, `implementedBy` + `mappingLabel`;
- relationships gain `delta` (an illustrative scenario +/−, independent of change state), `contract` and `fromField`/`toField`;
- contracts are named `clauses`; notes have `kind` (`focus|risk|note|question`); `absences[]` are stated gaps;
- views have `focus[]`, `include`/`exclude` (subtrees), `omitRelationships`, `direction` and `fields` (`all|changed|none`).

### Original sketch (historical)

```json
{
  "schemaVersion": 0,
  "profile": "./profile.json",
  "title": "Lead inbox",
  "views": [
    { "id": "product", "kind": "product", "include": ["lead", "inbox"] },
    { "id": "eng", "kind": "engineering", "root": "sys" }
  ],
  "elements": [
    { "id": "sys", "kind": "system", "name": "App" },
    { "id": "web", "kind": "container", "parent": "sys", "name": "Web app" },
    { "id": "api", "kind": "container", "parent": "sys", "name": "Backend" },
    { "id": "leadList", "kind": "component", "parent": "api", "type": "query", "variation": "paginated", "change": "new" },
    { "id": "inbox", "kind": "component", "parent": "web", "type": "page", "variation": "list", "change": "new",
      "libraries": ["virtual-list"] },
    { "id": "leads", "kind": "data", "parent": "api", "change": "modified",
      "fields": [{ "id": "ownerId", "change": "new" }] },
    { "id": "lead", "kind": "product", "name": "Lead", "implementedBy": ["leads"] }
  ],
  "relationships": [
    { "from": "inbox", "to": "leadList", "kind": "calls", "contract": "leadListContract", "change": "new" },
    { "from": "leadList", "to": "leads", "kind": "reads", "enforcement": "platform" }
  ],
  "contracts": [{ "id": "leadListContract", "summary": "args, returns, access rule, ordering" }],
  "notes": [{ "on": "leadList", "text": "Tenant-scoped; see access rule" }]
}
```

Settle the real schema after modelling real changes. Validation is in two layers, schema and semantics:
- references resolve;
- parents form a tree;
- types and kinds exist in the profile;
- profile notation rules hold.

## 6. Library shape

Same shape for every piece: model, validation and layout logic are pure TypeScript; rendering is Svelte components; a small public API; standalone SVG export; a CLI for agents (`validate`, `lint`, `render`); and a small offline viewer app.
