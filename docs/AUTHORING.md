# Writing a c4ish model

A short reference for whoever writes a model: an agent or an engineer. It covers model schema v0 and profile v0. The full contract is `c4ish schema model` and `c4ish schema profile`; larger examples are in the `examples/` directory of the c4ish repository.

## The loop

```bash
c4ish validate plan.c4ish.json --strict   # schema, references, notation lint, tour coverage
c4ish view plan.c4ish.json --tour         # local viewer, reloads on save
c4ish tour plan.c4ish.json                # static review pages in ./tour/ (add --png for rasters)
c4ish render plan.c4ish.json --all        # one SVG per view
c4ish code plan.c4ish.json                # does every code reference resolve?
```

Write the model, run `validate --strict` until it prints `0 error(s), 0 warning(s)`, then look at the tour yourself before handing it to a reviewer. `validate` checks that the model is well formed. It cannot tell whether the design is right or whether something was left out.

## What goes in a model

A model describes **one planned change** and the unchanged context it touches. It is not an inventory of the system. A rule of thumb for context: one hop from anything that changes.

| Key | Holds |
|---|---|
| `schemaVersion` | `1` |
| `title`, `id`, `summary` | What the change is |
| `profile` | Relative path to the project profile. Omit to use the built-in default |
| `views` | The pictures: usually `engineering`, plus `product` when users see a difference |
| `elements` | Containers, components, data, libraries, product concepts |
| `relationships` | Connectors between elements |
| `contracts` | Interfaces two parties build against, as named clauses |
| `notes` | Callouts on an element or connector: `focus`, `risk`, `note`, `question` |
| `absences` | Things deliberately not built, stated where they would be |
| `proposedPatterns` | Patterns this change introduces that the profile doesn't have yet |
| `tours` | The guided review; one tour with id `review` is expected |

## Elements

```json
{ "id": "listNotes", "kind": "component", "parent": "api",
  "title": "notes.list", "subtitle": "Newest first, at most 50",
  "pattern": "api/read-query", "change": "new" }
```

- **`kind`** comes from the profile. The default has `system`, `container`, `component`, `data`, `store`, `external`, `person`, `library`, `product`, `version`, `configuration` and `page`.
- **`parent`** nests the element. Structure is nesting; a reference is a connector. Don't chain siblings to imply a flow.
- **`change`** is required on everything: `new`, `modified`, `reused` (unchanged context) or `removed`. Keep removed items in the model; they are drawn struck through.
- **`title`** is at most 40 characters and **`subtitle`** at most 64. Longer text goes in `details`, which the viewer shows in the side panel.
- **Data elements** can list `fields` and `indexes`, each with its own `change`. A `tie` joins two fields that must agree.
- **`parts`** are grouped members with their own `pattern` and `change`. Give a part or a tie an `id` when its title or its fields may change later (see Comparing two versions).
- **Libraries** are elements of kind `library`. A component names the ones it uses in `libraries`.
- **Product concepts** name the elements that implement them in `implementedBy`.
- **`code`** lists where the element lives in the repository (see Code references).

## Code references

`code` on an element, or on one of its `parts`, lists where it lives in the repository. Nothing is drawn from it; `c4ish code` checks it against the files.

| Form | Names |
|---|---|
| `src/notes/list.ts` | A whole file, of any type |
| `src/notes/list.ts#listNotes` | A top-level definition: a function, class, `const`, type, interface, enum or namespace |
| `src/schema.ts#tables.notes` | A definition inside another: an object property, a class member, an enum member |
| `src/schema.ts#default` | An `export default` with no name |

- **Paths** are relative to the repository root.
- **A name is the full chain** of named definitions around it, outermost first. Unnamed wrappers, such as a call's arguments, are skipped. When a short name doesn't resolve, `c4ish code` suggests the full one.
- **Several references** go on an element that spans several definitions or files.
- **Names resolve in TypeScript and JavaScript** (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`). Any other file takes a whole-file reference.
- **One name declared several times in one place** (overloads, a `const` and a `type`) is one definition. The same name in two different places is ambiguous: qualify it.
- **A whole-file reference** stands for whatever the named references into that file don't cover.

```bash
c4ish code plan.c4ish.json                    # every reference resolves in the working tree
c4ish code plan.c4ish.json --base <commit>    # what changed in each since that commit (--json for the full report)
```

With `--base`, each reference is `added`, `removed`, `modified` or `unchanged`:
- The definition's text is compared, so one that only moved within its file is unchanged.
- The comment lines directly above a definition are outside it. A change there is reported as a changed comment.
- `changed through` names a changed top-level definition in the same file that this one is built from.
- A definition that was renamed or moved stops resolving, with a hint to where it went. Correct the reference.
- Every changed line is listed with the references that contain it, so lines inside no reference stand out.

## Patterns

Every component and data element says which project pattern it follows.

| Case | Write |
|---|---|
| Follows a pattern in the profile | `"pattern": "api/read-query"` |
| Follows it only in part | add `"patternFit": "partial"`, and say what differs in `details` |
| Several members with their own patterns | `"parts": [{ "title": "…", "pattern": "…", "change": "…" }]` |
| More than one pattern applies | `"patterns": ["data/tenant-scoped"]` beside the main one |
| A new pattern | add it to `proposedPatterns` and reference its id; it is drawn hatched |
| Deliberately no pattern | `"pattern": null` |
| Code that departs from its declared pattern | `"divergence": { "id": "DV-1", "text": "…" }` on the element or connector |

A proposed pattern is `{ "id": "api/bounded-read", "label": "bounded read", "family": "api" }`. The family must exist in the profile.

## Relationships

```json
{ "id": "addWrites", "from": "addNote", "to": "notes", "kind": "writes",
  "enforcement": "our-code", "change": "new", "label": "one row per note" }
```

- **`kind`** comes from the profile. The default has runtime kinds (`calls`, `subscribes`, `submits`, `uses`, `composes`, `authorizes`) and data kinds (`reads`, `writes`, `references`, `pins`), plus `replaced-by`, `provides`, `requires`, `created-from`, `traces-to` and `selects`.
- **`enforcement`** is required on data kinds. It says who rejects a bad state: `platform`, `platform-correlated`, `our-code`, `nothing` or `derived`.
- **`contract`** names a contract by id. `fromField` and `toField` attach the connector to a field.
- **`label`** is at most 40 characters.

A contract is `{ "id": "listContract", "title": "notes.list", "change": "new", "clauses": { "args": "…", "returns": "…", "access": "…" } }`. Clause names are free; common ones are `args`, `returns`, `access`, `limits`, `ordering`, `atomicity` and `security`.

## Views

```json
{ "id": "engineering", "kind": "engineering", "title": "Order notes: add and list",
  "focus": ["Only staff of the order's tenant can add a note."] }
```

- **`focus`** lists what the reviewer must check first. It is drawn as a card at the top.
- **`include`** and **`exclude`** take element ids and mean their whole subtrees. With neither, the view shows everything its kind allows.
- **`omitRelationships`** hides repetitive connectors in this view. The model keeps them.

## The review tour

A tour is an ordered list of steps. Each step is a view plus what is lit, with a few sentences of narration in `body`.

| Step key | Does |
|---|---|
| `focus` | Spotlights elements or connectors. A frame lights everything inside it |
| `select` | Selects one element or connector and opens its details |
| `path` | Ordered connector ids, numbered on the drawing |
| `notes` | Note ids to show |
| `highlight` | Lights by `change`, `patterns`, `enforcement` or `proposed`. For overview steps |

**Coverage.** Every new, modified or removed element, every element with a proposed pattern, every risk note and every divergence must be pointed at by some step. Only these count:
- `focus` or `select` covers that element, or that connector and its two ends. A frame's children are not covered;
- `path` covers its connectors, their ends and the frames those ends sit in;
- `notes` covers the note and what it is on.

`highlight` and `onlyChanges` never count.

**Paths must be contiguous.** Each connector starts where the last one ended. Write an intended gap as `{ "jump": true, "text": "later" }`.

A good order: what changes for the user, the main flows as paths, the patterns in use, proposed patterns, what is removed, then the risks.

## Comparing two versions

```bash
c4ish diff approved.c4ish.json plan.c4ish.json    # two files
c4ish diff plan.c4ish.json --base <commit>        # the same file at that commit, against the working tree
c4ish diff ... --only structure                   # keep some aspects (comma-separated)
c4ish diff ... --json                             # the full comparison
c4ish diff ... --out review.c4ish.json            # a review model; open with `c4ish view review.c4ish.json --tour`
```

Items are matched by **id**, so ids must not change between versions. An item is `added`, `removed` or `changed`, and a changed item lists each property that differs with its value before and after.

| Aspect | Holds |
|---|---|
| `structure` | What the design is: kind, parent, change state, patterns and fit, libraries, lifecycle, fields, indexes, ties and their enforcement, parts, relationship ends, kind, enforcement and contract, contract clauses, absences, proposed patterns, and risk and question notes with what they are on |
| `text` | Titles, subtitles, labels, details, and the wording of notes. A plain remark is text as a whole |
| `code` | Code references |
| `presentation` | Views, tours, per-view restrictions, icons and colours |
| `provenance` | The model's `id` and `provenance` |

- **Members are matched by name too.** A field or an index by its `id`; a tie by its `id`, or else by its pair of fields; a part by its `id`, or else by its title. Without an id, a retitled part reads as one part removed and another added.
- **A note without an id** is matched by what it is on, its kind and its rank among those. Give a note an id to keep it stable.
- **Order doesn't matter,** except the fields of an index.
- **The review model** from `--out` is the later version with its tours replaced by one generated tour: an overview, then one step per item that differs. An item that is gone is described in words, with the place it was spotlit. It honours `--only`. It is for viewing; its tour does not try to pass tour coverage.

## Example

A complete model on the default profile. It validates with no warnings.

```json
{
  "schemaVersion": 1,
  "id": "order-notes",
  "title": "Order notes",
  "views": [
    {
      "id": "engineering",
      "kind": "engineering",
      "title": "Order notes: add and list",
      "focus": ["Only staff of the order's tenant can read or add a note."]
    }
  ],
  "elements": [
    { "id": "web", "kind": "container", "title": "Web app", "change": "modified" },
    { "id": "api", "kind": "container", "title": "Backend", "change": "modified" },
    { "id": "db", "kind": "store", "title": "Database", "change": "modified" },
    { "id": "orderPage", "kind": "component", "parent": "web", "title": "Order page", "subtitle": "Lists notes and adds one", "pattern": "web/page", "change": "modified" },
    { "id": "listNotes", "kind": "component", "parent": "api", "title": "notes.list", "subtitle": "Newest first, at most 50", "pattern": "api/read-query", "change": "new" },
    { "id": "addNote", "kind": "component", "parent": "api", "title": "notes.add", "pattern": "api/mutation", "change": "new" },
    { "id": "guard", "kind": "component", "parent": "api", "title": "Order access guard", "pattern": "api/guard", "change": "reused" },
    {
      "id": "notes", "kind": "data", "parent": "db", "title": "orderNotes", "pattern": "data/table", "change": "new",
      "fields": [
        { "id": "orderId", "type": "Id<orders>", "change": "new" },
        { "id": "body", "type": "string", "change": "new" }
      ]
    },
    { "id": "orders", "kind": "data", "parent": "db", "title": "orders", "pattern": "data/table", "change": "reused" }
  ],
  "relationships": [
    { "id": "pageList", "from": "orderPage", "to": "listNotes", "kind": "subscribes", "change": "new", "contract": "listContract" },
    { "id": "pageAdd", "from": "orderPage", "to": "addNote", "kind": "submits", "change": "new" },
    { "id": "listGuard", "from": "listNotes", "to": "guard", "kind": "authorizes", "change": "new" },
    { "id": "addGuard", "from": "addNote", "to": "guard", "kind": "authorizes", "change": "new" },
    { "id": "listReads", "from": "listNotes", "to": "notes", "kind": "reads", "enforcement": "our-code", "change": "new" },
    { "id": "addWrites", "from": "addNote", "to": "notes", "kind": "writes", "enforcement": "our-code", "change": "new" },
    { "id": "noteOrder", "from": "notes", "to": "orders", "kind": "references", "enforcement": "platform", "change": "new", "fromField": "orderId" }
  ],
  "contracts": [
    {
      "id": "listContract", "title": "notes.list", "change": "new",
      "clauses": { "args": "orderId", "returns": "notes, newest first, at most 50", "access": "staff of the order's tenant" }
    }
  ],
  "notes": [
    { "id": "n-delete", "on": "notes", "kind": "risk", "title": "No delete yet", "text": "A note cannot be removed in this change." }
  ],
  "tours": [
    {
      "id": "review",
      "title": "Review: order notes",
      "steps": [
        {
          "id": "read", "view": "engineering", "title": "Reading notes",
          "path": ["pageList", "listReads", "noteOrder"],
          "body": "The order page subscribes to `notes.list`, which reads the new table. Each note references its order."
        },
        {
          "id": "write", "view": "engineering", "title": "Adding a note",
          "path": ["pageAdd", "addWrites"], "select": "addNote",
          "body": "The page submits to `notes.add`, which writes one row."
        },
        {
          "id": "access", "view": "engineering", "title": "Access",
          "focus": ["listGuard", "addGuard"],
          "body": "Both functions check the **existing** order access guard before touching data."
        },
        {
          "id": "risk", "view": "engineering", "title": "Risk",
          "notes": ["n-delete"],
          "body": "Notes cannot be deleted yet."
        }
      ]
    }
  ]
}
```

## Common mistakes

- **A connector with no enforcement** on a data kind (`missing-enforcement`).
- **An element with no `change`**. It is drawn as reused and lint warns.
- **A tour that lights changes only with `highlight`**. Coverage then lists them as uncovered.
- **A removed element that still has live connectors.** Mark those connectors removed too.
- **Titles that carry the explanation.** Keep the title a name; put the explanation in `subtitle`, `details` or a note.
- **A code reference by short name.** `schema.ts#notes` doesn't find a property of `tables`; write `schema.ts#tables.notes`.
- **Too much context.** Reused elements that nothing changed touches make the diagram slower to read.
