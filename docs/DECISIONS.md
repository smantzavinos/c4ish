# c4ish — design decisions

A dated log; later entries can supersede earlier ones. See [`DESIGN.md`](DESIGN.md) for the current design.

## 2026-10-21 — Founding decisions

1. **Purpose: review of a planned change.** The primary user is a human approving a proposed change quickly. Agents author models; humans read diagrams.
2. **Versioned JSON is canonical.** Diagrams are rendered from the model. A hand-edited diagram is never the source of truth. Layout adjustments live in a separate sidecar file, not in the model.
3. **C4-inspired, not C4-strict.** Levels go beyond C4: system → container → component → data → field. Libraries used inside a component are first-class.
4. **Product and engineering in one model.** One change can show what changes for the user and how it is built, as two views with a mapping between them.
5. **Notation carries meaning, and is data.** Projects define element types, relationship kinds, enforcement levels and visual notation in a profile. c4ish ships a generic default. Core rules: structure is nesting, reference is a connector; every connector states its enforcement; line style carries meaning without colour; colour means one thing per view.
6. **Change state everywhere.** New, modified, reused and removed are core, not decoration. Removed items stay visible.
7. **Patterns are references, not content.** An element names its project pattern (type/variation). c4ish links to the catalog but doesn't store pattern content.
8. **Throwaway models.** A model is scoped to one change. No whole-system inventory.
9. **Rendering and layout first; model editing later.** v0 renders, auto-lays out and lets the user adjust the layout. Editing the model in the viewer is deferred.
10. **Library-first, single repository.** Svelte 5 + TypeScript library with a small SvelteKit viewer in `src/routes`, a CLI for agents, Nix for tools, pnpm for dependencies.

## 2026-10-21 — Phase 1 (v0 implementation)

11. **ELK first, TALA later.** Layout goes through a `LayoutEngine` interface (`src/lib/layout/types.ts`). It returns absolute rects, edge polylines and label boxes. v0 ships an elkjs implementation: layered, `INCLUDE_CHILDREN` for compound nodes, orthogonal routing, fixed-side ports for fields, inline edge labels. elkjs is pure JS, so it builds reproducibly and runs in Node and the browser. A TALA adapter and pinned positions (`LayoutNodeInput.fixed`) fit the same interface. Supersedes "TALA is the first candidate" in DESIGN §4.
12. **Pure-TypeScript SVG renderer, no headless browser.** The renderer emits an SVG string and doesn't depend on the DOM. The CLI, tests and the SvelteKit demo all use the same code (`{@html}` in Svelte). This answers PLAN open question 3. Svelte components for an interactive viewer can wrap the same scene later.
13. **Deterministic text metrics.** Text is measured from Noto Sans advance widths baked into `src/lib/text/metrics.ts` (generated from `@fontsource/noto-sans`), with a 3% safety margin. The font stack is `'Noto Sans','Inter','Segoe UI',system-ui`. The same model gives byte-identical SVG on every machine (tested).
14. **Change state is hue-free.** New = ink header band; modified = light slate band; reused = muted; removed = dashed grey with strikethrough. Each also gets a text badge. Hue is left for the one per-view meaning (enforcement or area). See VISUAL_SPEC §4.1.
15. **Only data relationships are coloured by enforcement.** Runtime calls are quiet slate even when the model states an enforcement level. Colouring every connector amber made "our code" the dominant colour and hid the few relationships that carry integrity. Lint still requires enforcement on data kinds (`enforcementRequired`).
16. **Top-down by default for engineering and product views.** In layered left-to-right layouts, real models came out 3–4× wider than tall. Top-down reads as a page: UI, then backend, then data, with notes beside it. Views can still set `direction`.
17. **Text is split into title / subtitle / details.** Titles have a budget of 40 characters and subtitles 64 (lint). A subtitle wraps to two lines. Details become lettered footnotes, and contracts become C1… footnotes. Nothing is lost, and the diagram stays scannable.
18. **`include` means "these subtrees".** A listed element brings in its ancestors (as frames) and its descendants. `exclude` removes subtrees; element-level `views` restricts further.
