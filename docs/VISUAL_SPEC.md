# c4ish — Visual specification (v0)

**Status:** decided for phase 1 · **Date:** 2026-10-21

This page fixes how a c4ish diagram looks. It's written before the renderer and is the yardstick for it: if the SVG and this page disagree, one of them is a bug.

The bar: **a reviewer understands what changes, which patterns are used and where the risk is within about two minutes per diagram.** Everything here serves that. A box isn't a paragraph. Colour isn't decoration. A reader should never need prose to tell what's new.

## 1. Principles

1. **Glance first, then read.** The picture answers the five questions in [DESIGN.md §1](DESIGN.md#1-purpose) without reading any sentence longer than a title. Explanations live in callout cards and footnotes, outside the boxes.
2. **One channel, one meaning.** Each visual variable carries exactly one thing:

   | Channel | Carries | Never carries |
   |---|---|---|
   | Header band fill and contrast | Change state | Pattern, enforcement |
   | Icon glyph and pattern chip | Pattern (and element kind when there's no pattern) | Change state |
   | Hatching | Proposed (uncatalogued) pattern | Anything else |
   | Hue | **One** per-view meaning chosen by the profile: enforcement (engineering default) or model area and relationship kind (product default) | Change state |
   | Line style | Enforcement for data connectors; runtime connectors are thin and solid | Change state, except removed (grey dashed) |
   | Corner radius | View family: sharp = engineering, rounded = product | — |
   | Nesting | Structure (a child can't exist without its parent) | References |
   | Connector | Reference | Containment |

3. **Change state is hue-free.** Engineering views spend hue on enforcement, so amber can't also mean "modified". Change state uses contrast, weight and a badge instead, and survives greyscale by construction.
4. **Greyscale-safe.** Every meaning that hue carries is also carried by line style, a glyph, a badge or text.
5. **Text budget.** A title has at most ~40 characters and two lines. A subtitle has one line (≤ 64 characters) and is truncated with an ellipsis if longer; lint warns. Long text goes in `details`: footnotes in a static SVG, a side panel in the future viewer.
6. **The legend is generated.** It's drawn from only the styles a view actually uses, as graphical samples, never as a block of text.

## 2. Page anatomy (static SVG)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Title (22/700)                                                           │
│ Subtitle (13.5/400, muted)                                               │
│ ┃ REVIEW FOCUS  · bullet · bullet                                        │
│                                                                          │
│ ┌─────────────── diagram ───────────────┐   ① callout card               │
│ │ frames, nodes, connectors             │   ② callout card               │
│ └───────────────────────────────────────┘   ③ …                          │
│                                                                          │
│ KEY   change │ patterns │ connectors │ lifecycle │ markers               │
│ DETAILS & CONTRACTS  A … B … C1 …                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Callouts** sit in a column to the right of the diagram, unless the diagram is much wider than tall (aspect > 1.6), in which case they wrap in a row grid below it.
- **Review focus** is the view's `focus` list. It's the one thing the author most wants checked, so it sits under the title, before the picture.
- **Details** (element `details`) and **contracts** are reference material at the bottom, keyed by letter tags (A, B, …) and contract tags (C1, C2, …).

## 3. Typography and spacing

**Font:** Noto Sans (OFL). Its advance widths for weights 400/600/700 and italic 400 are bundled as a metric table (`src/lib/text/metrics.ts`, generated from `@fontsource/noto-sans`), so the CLI measures text deterministically without a DOM. The SVG font stack is `'Noto Sans', 'Inter', 'Segoe UI', system-ui, sans-serif`. The demo page loads Noto Sans, and a 3% width margin absorbs small fallback-font differences.

| Role | Size/weight | Colour |
|---|---|---|
| View title | 22 / 700 | ink `#0f172a` |
| View subtitle | 13.5 / 400 | muted `#64748b` |
| Frame title | 11.5 / 700, uppercase, +0.06em tracking | graphite `#334155` (or area colour) |
| Frame subtitle | 11 / 400 italic | muted |
| Node title | 13 / 600 | white on a new band, ink otherwise |
| Node subtitle | 11.5 / 400 | slate `#475569` |
| Chip | 10 / 600 | per chip |
| Field row | 11 / 400 (name), 10 / 400 (type) | ink / faint |
| Connector label | 10.5 / 500 on a white halo | graphite |
| Callout title / body | 12 / 700, 11.5 / 400 | ink / slate |
| Key and footnotes | 11 / 400, 10.5 / 400 | slate |

Spacing is a 4px scale: 4, 8, 12, 16, 24, 32, 48. Node padding is 10px. Chip gap is 4px. Gaps between sibling nodes and layers are 40px/56px (layout engine). Frame padding is 16px, plus the frame header.

Neutral palette: ink `#0f172a`, graphite `#334155`, slate `#475569`, muted `#64748b`, faint `#94a3b8`, line `#cbd5e1`, hairline `#e2e8f0`, surface `#f8fafc`.

## 4. Node anatomy

```
 ①                                   ← callout marker (if a note targets it)
┌─────────────────────────────────────┐
│ [▣] Short title                [NEW]│ ← header band: icon tile, title (≤2 lines), change badge
├─────────────────────────────────────┤
│ one-line subtitle                   │
│ [⌕ read query] [▨ PROPOSED] [🔒 rel]│ ← chips: pattern, proposed/partial, lifecycle
│ {} libA  {} libB +                  │ ← library chips
│ ▪ fieldName            type     +   │ ← fields (data elements), tie-bars at the right
│ • part — [pattern chip]             │ ← parts (grouped members with their own pattern)
│ ↳ implemented by …             [A]  │ ← mapping (product), details tag
└─────────────────────────────────────┘
```

- **Icon tile:** 18×18, glyph from the pattern's family. With no pattern, the glyph comes from the element kind. The same pattern has the same glyph and chip label everywhere.
- **Pattern chip:** `glyph + pattern label`. A partial fit adds a half-filled disc and "partial". An explicit `pattern: null` shows a faint italic "no pattern" chip, so a deliberate gap is visible.
- **Proposed pattern (not in the catalog):** the chip is hatched with a dashed border and reads `PROPOSED`. A hatched 6px strip runs down the node's left edge. Hatching is used for nothing else, so the reviewer finds every proposal by its texture.
- **Divergence:** a warning triangle with the divergence id (`IN-3`), on the element or connector that is wrong, in the profile's divergence colour (rose by default). It's never in the legend alone.
- **Libraries:** `{}` chips inside the component. A new library has an ink border and a `+`.
- **Fields:** rows with a small filled square when the field is in an index. A new field is bold with a `+`. A removed field is struck through. Only changed indexes are listed, as `⌗ index` rows; reused indexes are summarised as a count.
- **Tie-bar:** a grey bracket on the right edge joins two fields that must agree, labelled with what must be true. The bracket's line style is the tie's enforcement (rose dotted = nothing enforces).

### 4.1 Change state

| State | Header band | Border | Text | Badge |
|---|---|---|---|---|
| **new** | filled ink `#1e293b` | 1.75 ink | white title | `NEW` (white pill) |
| **modified** | light slate `#e2e8f0` | 1.5 graphite | ink | `MODIFIED` (outlined pill) |
| **reused** (context) | white | 1 `#cbd5e1` | slate and muted | none: muted means context |
| **removed** | none, surface fill | 1.25 faint, dashed | faint, title struck through | `REMOVED` (faint outline) |

New is the darkest thing on the page. Context recedes. Removed stays in place, greyed, never deleted.

### 4.2 Lifecycle

The profile defines lifecycle states. In the default and product notation:
- **released**: a padlock glyph (drawn as a shape, never an emoji) plus a `released` chip, solid slate border;
- **draft**: a dashed amber border plus a `draft` chip with a dashed outline.

Border precedence: removed > lifecycle > change state. The chip always carries lifecycle in text, so it survives greyscale.

## 5. Frames (containers, systems, grouping product concepts)

A titled frame: hairline border, very light surface fill (alternating with white by depth), and corner radius from the view family. The header has a kind glyph, an uppercase title, a change badge and an optional one-line italic subtitle. A new frame gets an ink border. A removed frame is dashed and grey. In area-coloured views (product), the frame's border, title and fill tint come from its area (for example, product model = blue, system model = teal).

## 6. Connectors

Relationship kinds have a **category** in the profile:

| Category | Default style | Meaning carried by |
|---|---|---|
| `runtime` (calls, subscribes, submits, composes) | thin 1.25 solid slate `#64748b`; arrowhead by kind (filled = calls, open = subscribes, none = composes) | Label and arrowhead. Quiet by design: flow isn't where the risk is |
| `data` (reads, writes, references, pins) | **enforcement** style (below) | Line style + hue + legend |
| `trace` / `reference` (product: provides, requires, created from) | kind colour from the profile, solid, always labelled | Hue + label |
| `lifecycle` (replaced by, retired) | grey long-dash | Label |

**Enforcement** (who rejects a bad state; default scale, profile-defined):

| Level | Line | Colour |
|---|---|---|
| platform | solid 1.75 | emerald `#059669` |
| platform, correlated | double line | emerald |
| our code | dashed 6/4, 1.75 | amber `#b45309` |
| nothing | dotted 1.5/3.5, round caps | rose `#be123c` |
| derived | long-dash 10/4, 1.25 | grey `#94a3b8` |

A data connector without enforcement is a lint warning. It's drawn as a bright magenta "?" line, so it can't pass review unnoticed.

**Connector change state:** new and modified are full contrast. Reused is drawn at 50% opacity, so changes stand out. Removed is grey dashed with a struck-through label.

**Scenario delta** (an illustrative before/after inside one view, independent of feature change): `+` badge and heavier line for added; `−` badge, grey dashed and struck-through label for removed.

**Labels:** short (≤ 40 characters), on a white halo, placed by the layout engine. A contract reference adds a `C1` tag. A divergence adds a warning triangle.

## 7. Callouts, focus, absence

- **Callout** = a model `note` with `on`. A numbered ink disc (①) sits on the target's top-left corner or on the connector label. The card in the callout column repeats the number, a kind label (`FOCUS`, `RISK`, `NOTE`, `QUESTION`), an optional bold title and the text. Monochrome; the kind is in text.
- **Absence:** an `absence` is a grey italic caption with no box, placed by the layout engine inside the parent where the missing thing would be. "Nothing requires it in this configuration."
- **Details tag:** a small grey square with a letter at a node's bottom-right. The footnote lists the node title and its details.

## 8. Legend (Key)

Generated per view, with only used items, grouped left to right:
1. **Change:** mini header bands for each used change state.
2. **Patterns:** one row per pattern used, with icon, label, catalog id and usage count. Proposed patterns are hatched and listed first. This doubles as the "which patterns does this change use" summary.
3. **Connectors:** a line sample plus a label for each used combination of (runtime kind) or (enforcement level).
4. **Lifecycle, markers:** padlock, draft, divergence, tie-bar, callout disc, details tag and absence, if used.

## 9. View families

| | Engineering (default) | Product (default) |
|---|---|---|
| Corners | sharp (2px) | rounded (10px) |
| Hue means | enforcement on data connectors | model area (nodes) and relationship kind (connectors) |
| Pattern identity | glyph + chip | glyph + chip (patterns are rare in product views) |
| Typical elements | containers, components, data, libraries | product concepts, versions, configurations |

A profile can set `colour.nodes` to `pattern` for a "pattern map" view. In that view, family hue tints icon tiles and pattern chips, and connectors drop to line style only. Lint warns if a view asks for two unrelated hue meanings.

## 10. Rejected alternatives

- **Hue for change state** (green new, amber modified): collides with enforcement amber and emerald in engineering views, and fails greyscale.
- **Hue for patterns by default:** with eight or more patterns the palette becomes noise, and it collides with enforcement. Glyph plus chip plus a hatched proposal marker scales and stays legible. Pattern hue remains available as a view mode.
- **Prose captions inside boxes:** this was the first experiment's main readability failure. Captions became `subtitle` (one line) plus `details` (footnotes).
