# c4ish — Plan

**Status:** phase 2 built (M1, M2, M4; M3 automatic only; M5 viewing only) · **Date:** 2026-10-21

## Goal

A first usable version: an agent writes a model; `c4ish validate` and `lint` check it against a profile; `c4ish render` produces SVG; a human opens it in the viewer, adjusts the layout and exports. Good enough to review real planned changes.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | **Model real changes by hand** | 2–3 representative changes are written as JSON against a draft profile, with a hand-drawn or throwaway render. The schema is settled from what they needed, not designed upfront |
| M1 | **Schema, profile and validator** | JSON Schema plus semantic validation (references, tree, profile types); a precompiled validator; `c4ish validate`; example models pass, broken fixtures fail with clear messages |
| M2 | **Lint** | Profile notation rules run as `c4ish lint`, with element-level messages |
| M3 | **Layout** | Automatic layout of nested elements and relationships (TALA first; built reproducibly in the Nix flake). Pins and a sidecar layout file. Re-layout respects pins; new elements are placed automatically |
| M4 | **Renderer and SVG export** | Svelte components draw both views with the profile's notation: change states, enforcement styles, ties, libraries, divergence and new-pattern markers. Greyscale-safe. `c4ish render` writes a standalone SVG |
| M5 | **Viewer** | An offline SvelteKit app: open or drop a model and profile; view switch; details panel; drag, resize, pin, re-layout, reset; save the sidecar; export SVG. Ctrl/Cmd + scroll zooms; plain scroll scrolls the page |
| Later | Model editing in the viewer; side-by-side version comparison; guided routes and ports | — |

## Phase 1 status (2026-10-21)

| Milestone | State |
|---|---|
| M0 | Done on two real changes (outside this repo) and two invented examples in `examples/` |
| M1 | Done: JSON Schema (`schema/*.json`, generated from `src/lib/model/schema.ts`), semantic validation, `c4ish validate` |
| M2 | Done: lint runs inside `validate` (severity is configurable per profile `rules`) |
| M3 | Automatic layout via elkjs behind `LayoutEngine`. Pins/sidecar and TALA are **not** built |
| M4 | Static SVG renderer and `c4ish render [--png]`. No Svelte components yet: the demo page inlines the SVG |
| M5 | Not started |

## Phase 2 status (2026-10-21)

| Area | State |
|---|---|
| Notation | Card colour = pattern, line colour = enforcement; change state on badge + border, reused faded (DECISIONS 19–20) |
| Page | Diagram first, notes and compact key in a right column; details/contracts in `--appendix` markdown (21) |
| Layout | Own label placement after routing; `direction: 'auto'` picks top-down or left-to-right by score (22) |
| M4 | Svelte components (`c4ish/viewer`) over the shared `Diagram` (23) |
| M5 | Viewing done: `/viewer` (offline, adapter-static) opens or drops model + profile, bundled examples, view tabs, Ctrl/Cmd+wheel zoom, pan, fit, side panel, hover neighbourhood, legend highlights, "only changes", SVG export, deep links. **Not built:** drag/resize/pin, sidecar save, re-layout |

Next: pins and the sidecar layout file (via the `override` hook); a TALA adapter spike against the same layout invariants; less dead space in disconnected views (component packing).

## Risks
- **Layout and routing quality.** TALA handles hierarchical placement but ignores preset waypoints; strict containment and stable routes after manual moves aren't guaranteed by any tested open-source option. The fallback: recompute only the routes a move affects, and accept engine routes otherwise. A commercial router is an option, but only after it passes the same tests.
- **TALA availability and build.** Confirm licensing and a reproducible Nix build early (M3 spike before M4 work depends on it).
- **Label measurement.** Approximate text sizes cause overlaps; measure text in the browser for the viewer and use a fixed font for CLI renders.
- **Schema overreach.** M0 exists to stop the schema growing beyond what real changes need.

## Open questions
1. Default generic profile: how much notation ships built in versus per project.
2. Model splitting: one file per change, or includes for shared context.
3. ~~Server-side rendering for the CLI~~ — settled: pure TypeScript SVG output (DECISIONS 12).
4. Comparing two versions of a model (before/after a change) as a first-class view, or only through change states.
