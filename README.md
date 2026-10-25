# c4ish

**c4ish** is a JSON model and renderer for **reviewable architecture diagrams of a planned software change**. It is C4-inspired, not C4-strict. One model shows:
- what changes for the user: product concepts;
- how it is built: containers, components and data;
- which project-defined pattern each piece follows;
- what is new, modified, reused or removed.

A reviewer should be able to look at one diagram and say "yes, I understand what you're doing, go ahead".

> **Status: phase 1.** Schema v0, validation and lint, ELK layout, a static SVG renderer and a CLI work; there is no viewer yet. See [`docs/VISUAL_SPEC.md`](docs/VISUAL_SPEC.md) for the notation, and also [`docs/DESIGN.md`](docs/DESIGN.md) (concepts and JSON contract, draft), [`docs/DECISIONS.md`](docs/DECISIONS.md) (decision log) and [`docs/PLAN.md`](docs/PLAN.md) (build plan).

## What it is for
- **Plan review.** An agent or engineer writes a model of a proposed change. c4ish validates it against the project's catalog and notation and renders it. A human approves the change from the diagram.
- **Pattern visibility.** Every element names the project pattern it follows, so review can focus on deviations and new patterns.
- **Throwaway by design.** A model belongs to one change. It isn't a maintained inventory of the whole system.

## Planned pieces
| Piece | What |
|---|---|
| JSON Schema and validator | The model, plus project profiles: element types, relationship kinds, notation |
| Lint | Notation rules, such as "every connector states its enforcement" |
| Layout | Automatic layout (elkjs now; TALA adapter and pins later), with manual adjustments kept in a sidecar layout file |
| Renderer | Svelte components and a standalone SVG export |
| Viewer | A small offline SvelteKit app: open a model, review it, adjust the layout, export |
| CLI | `validate`, `lint`, `render` for agents and CI |

Editing the model itself in the viewer comes later.

## Usage

```bash
pnpm c4ish validate examples/paged-reads/model.c4ish.json
pnpm c4ish render examples/versioned-wiring/model.c4ish.json --view product --out product.svg --png
pnpm render:examples   # every example view -> examples/*/<view>.svg (+ --png)
pnpm c4ish render <model> --view engineering --out eng.svg --appendix   # + eng.svg.appendix.md (details, contracts, notes)
pnpm c4ish tour <model> --png   # guided review tour -> <model dir>/tour/: NN-<step>.svg/png, index.html, tour.md
pnpm dev               # demo page with the example diagrams; /viewer is the interactive viewer
pnpm build             # static site in build/ (open build/viewer/index.html via any static server; works offline)
pnpm check && pnpm test
```

### Viewer

`/viewer` opens a model (and optionally its profile) from a file picker or drag-and-drop, or one of the bundled examples. Ctrl/Cmd + wheel zooms around the cursor; a plain wheel pans. Drag to pan freely at any zoom, including beyond the diagram edges; dragging continues outside the canvas until release. **Fit** centres the whole diagram with a margin. Click a card or connector for its details, pattern (with catalog reference), libraries, fields, contract, enforcement and notes. Hover shows its neighbourhood. Click key rows to highlight a pattern, connector style or change state; **Only changes** hides reused context. **Export SVG** writes the same page as the CLI. Deep links: `?example=versioned-wiring&view=engineering&select=rewire&highlight=pattern:api/tenant-query&only=changes`.

**Tours.** When the model has `tours`, a **▶ Tour** button appears. The step card replaces the notes column (step n / N, narration, the step's notes, Prev/Next, the step list), ←/→ step and Esc exits. The camera glides to the step and path connectors are numbered in order. Click around freely: the card offers **Back to this step**. Deep link: `?example=versioned-wiring#tour=review&step=write-path`. The same tour exports as static pages with `c4ish tour` (see `examples/*/tour/`).

Library: `import { check, renderView, buildDiagram, buildLegend } from 'c4ish'`; Svelte components from `c4ish/viewer`. `check(modelJson, profileJson)` returns diagnostics plus the resolved model and profile. `renderView(model, profile, { view })` returns `{ svg, width, height, geometry }`. A model names its profile by relative path (`"profile": "../profile.c4ish.json"`); profiles can `"extends": "default"`.

## Development
Nix provides only the toolchain (Node 22, pnpm, Git); pnpm manages JS dependencies.

```bash
nix develop
```
