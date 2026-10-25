# c4ish — Visual specification (v0)

**Status:** revised for phase 2 (DECISIONS 19–23) · **Date:** 2026-10-21

This page fixes how a c4ish diagram looks. It's written before the renderer and is the yardstick for it: if the SVG and this page disagree, one of them is a bug.

The bar: **a reviewer understands what changes, which patterns are used and where the risk is within about two minutes per diagram.** Everything here serves that. A box isn't a paragraph. Colour isn't decoration. A reader should never need prose to tell what's new.

## 1. Principles

1. **Glance first, then read.** The picture answers the five questions in [DESIGN.md §1](DESIGN.md#1-purpose) without reading any sentence longer than a title. Explanations live in callout cards and footnotes, outside the boxes.
2. **One channel, one meaning.** Each visual variable carries exactly one thing:

   | Channel | Carries | Never carries |
   |---|---|---|
   | Card hue (header tint, left band, icon, caps label) | Pattern (engineering default) or model area (product default) | Change state |
   | Badge, border weight/dash, opacity | Change state | Pattern, enforcement |
   | Icon glyph | Pattern family (element kind when there's no pattern) | Change state |
   | Hatching | Proposed (uncatalogued) pattern | Anything else |
   | Line hue | Enforcement on data connectors (engineering) or relationship kind (product) | Change state |
   | Line style | Enforcement for data connectors; runtime connectors are thin and solid | Change state, except removed (grey dashed) |
   | Corner radius | View family: sharp = engineering, rounded = product | — |
   | Nesting | Structure (a child can't exist without its parent) | References |
   | Connector | Reference | Containment |

3. **Change state is hue-free.** Cards spend hue on patterns and lines on enforcement, so no hue is left for "modified". Change state uses a badge, border and opacity instead, and survives greyscale by construction. The key says both colour meanings in words: *card colour = pattern · line colour = who enforces*.
4. **Greyscale-safe.** Every meaning that hue carries is also carried by line style, a glyph, a badge or text.
5. **Text budget.** A title has at most ~40 characters and two lines. A subtitle has one line (≤ 64 characters) and is truncated with an ellipsis if longer; lint warns. Long text goes in `details`: the viewer's side panel, or the `--appendix` markdown for static renders. Connector labels are at most ~2 short lines; longer rationale goes in the relationship's `details`.
6. **The legend is generated.** It's drawn from only the styles a view actually uses, as graphical samples, never as a block of text.

## 2. Page anatomy (static SVG)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Title (22/700)                                                           │
│ Subtitle (13.5/400, muted)                                               │
│ ┃ REVIEW FOCUS  · bullet · bullet                                        │
│                                                                          │
│ ┌─────────────── diagram ───────────────┐   NOTES  ① ② ③ …               │
│ │ frames, cards, connectors             │   KEY    card colour = pattern  │
│ │                                       │          line colour = enforces │
│ └───────────────────────────────────────┘          change · markers       │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Diagram first.** The right column (330px) holds the numbered notes, then the compact key. If the diagram is much wider than tall (aspect > 2.4), both go below it instead.
- **Review focus** is the view's `focus` list. It's the one thing the author most wants checked, so it sits under the title, before the picture.
- **Details and contracts are not printed on the page.** `c4ish render --appendix` writes `<out>.appendix.md` with notes, lettered details (A, B, …), connector details and contracts (C1, …); the letter and contract tags on the diagram point into it. The viewer shows the same content in its side panel.

## 3. Typography and spacing

**Font:** Noto Sans (OFL). Its advance widths for weights 400/600/700 and italic 400 are bundled as a metric table (`src/lib/text/metrics.ts`, generated from `@fontsource/noto-sans`), so the CLI measures text deterministically without a DOM. The SVG font stack is `'Noto Sans', 'Inter', 'Segoe UI', system-ui, sans-serif`. The demo page loads Noto Sans, and a 3% width margin absorbs small fallback-font differences.

| Role | Size/weight | Colour |
|---|---|---|
| View title | 22 / 700 | ink `#0f172a` |
| View subtitle | 13.5 / 400 | muted `#64748b` |
| Frame title | 11.5 / 700, uppercase, +0.06em tracking | graphite `#334155` (or area colour) |
| Frame subtitle | 11 / 400 italic | muted |
| Pattern label (above the title) | 9.5 / 700, uppercase | shade of the pattern colour |
| Node title | 14.5 / 600 | ink |
| Node subtitle | 12.5 / 400 | slate `#475569` |
| Chip | 10.5 / 600 | per chip |
| Field row | 12 / 400 (name), 10.5 / 400 (type) | ink / faint |
| Connector label | 11.5 / 500 on a white halo | graphite |
| Callout title / body | 12 / 700, 11.5 / 400 | ink / slate |
| Key and footnotes | 11 / 400, 10.5 / 400 | slate |

Spacing is a 4px scale: 4, 8, 12, 16, 24, 32, 48. Node padding is 10px. Chip gap is 4px. Gaps between sibling nodes and layers are 40px/56px (layout engine). Frame padding is 16px, plus the frame header.

Neutral palette: ink `#0f172a`, graphite `#334155`, slate `#475569`, muted `#64748b`, faint `#94a3b8`, line `#cbd5e1`, hairline `#e2e8f0`, surface `#f8fafc`.

## 4. Node anatomy

```
 ①                                   ← callout marker (if a note targets it)
┌─────────────────────────────────────┐
┃ [⌕] SCOPED READ QUERY          [NEW]│ ← header tinted in the pattern colour: icon, caps pattern label, change badge
┃     Short title                     │   title (≤3 lines); left band in the pattern colour
┃─────────────────────────────────────│
┃ one-line subtitle                   │
┃ [⌗ tag pattern] [🔒 released]       │ ← chips: secondary (tag) patterns, lifecycle
│ {} libA  {} libB +                  │ ← library chips
│ ▪ fieldName            type     +   │ ← fields (data elements), tie-bars at the right
│ • part — [pattern chip]             │ ← parts (grouped members with their own pattern)
│ ↳ implemented by …             [A]  │ ← mapping (product), details tag
└─────────────────────────────────────┘
```

- **Pattern identity:** the primary pattern's colour (`PatternDef.colour`, else its family colour) fills the header with a 15% tint, draws a 7px band down the left edge and shades the icon and the caps pattern label. The same pattern looks the same everywhere, and different patterns differ at a glance. Secondary (`patterns`) are tag chips.
- **Partial fit** adds a half-filled disc after the pattern label. An explicit `pattern: null` shows `NO PATTERN` with a white, dashed band, so a deliberate gap is visible.
- **Proposed pattern (not in the catalog):** the band is strongly hatched, the header lightly hatched, and the label reads `PROPOSED · NAME` in a dashed box. Hatching is used for nothing else, so the reviewer finds every proposal by its texture.
- **Area mode (product views):** the same anatomy, coloured by model area, with the element kind as the caps label.
- **Divergence:** a warning triangle with the divergence id (`IN-3`), on the element or connector that is wrong, in the profile's divergence colour (rose by default). It's never in the legend alone.
- **Libraries:** `{}` chips inside the component. A new library has an ink border and a `+`.
- **Fields:** rows with a small filled square when the field is in an index. A new field is bold with a `+`. A removed field is struck through. Only changed indexes are listed, as `⌗ index` rows; reused indexes are summarised as a count.
- **Tie-bar:** a grey bracket on the right edge joins two fields that must agree, labelled with what must be true. The bracket's line style is the tie's enforcement (rose dotted = nothing enforces).

### 4.1 Change state

Change state never touches the header (that's the pattern's).

| State | Badge | Border | Card |
|---|---|---|---|
| **new** | `NEW`, solid ink | 1.5 ink | full contrast |
| **modified** | `MODIFIED`, outlined | 1.5 ink | full contrast |
| **reused** (context) | none | 1 grey | 50% opacity |
| **removed** | `REMOVED`, solid slate | 1.25 slate, dashed | surface fill, title struck through |

Context recedes; what changes, what's proposed and what's at risk stands out. Removed stays in place, never deleted.

### 4.2 Lifecycle

The profile defines lifecycle states. In the default and product notation:
- **released**: a padlock glyph (drawn as a shape, never an emoji) plus a `released` chip, solid slate border;
- **draft**: a dashed amber border plus a `draft` chip with a dashed outline.

Border precedence: removed > lifecycle > change state. The chip always carries lifecycle in text, so it survives greyscale.

## 5. Frames (containers, systems, grouping product concepts)

A titled frame (unchanged in phase 2): hairline border, very light surface fill (alternating with white by depth), and corner radius from the view family. The header has a kind glyph, an uppercase title, a change badge and an optional one-line italic subtitle. A new frame gets an ink border. A removed frame is dashed and grey. In area-coloured views (product), the frame's border, title and fill tint come from its area (for example, product model = blue, system model = teal).

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

**Labels:** short (≤ 40 characters, wrapped to ~2 lines at ~160px), on a white halo. They're placed after routing by `placeLabels`: candidate spots along the line (or beside it), scored against cards, frame headers, other labels and crossings, preferring spots near the source. A contract reference adds a `C1` tag. A divergence adds a warning triangle.

## 7. Callouts, focus, absence

- **Callout** = a model `note` with `on`. A numbered ink disc (①) sits on the target's top-left corner or on the connector label. The card in the callout column repeats the number, a kind label (`FOCUS`, `RISK`, `NOTE`, `QUESTION`), an optional bold title and the text. Monochrome; the kind is in text.
- **Absence:** an `absence` is a grey italic caption with no box, placed by the layout engine inside the parent where the missing thing would be. "Nothing requires it in this configuration."
- **Details tag:** a small grey square with a letter at a node's bottom-right. The `--appendix` markdown (and the viewer panel) lists the node title and its details.

## 8. Legend (Key)

Generated per view from a data model (`buildLegend`), with only used items. The static page draws it as a compact column; the viewer draws the same rows as filter buttons. It opens with the view's colour meaning in words (`Card colour = pattern · line colour = who enforces a data relationship`).
1. **Card colour = pattern:** one row per pattern used, with a card swatch in its colour and the usage count. Proposed patterns are hatched and listed first; tag-only patterns use a chip swatch and come last; "No pattern (deliberate)" and "Partial fit" if used. (Product views: **card colour = model area**.)
2. **Line colour = who enforces:** a line sample per used style; runtime kinds that look identical share one row.
3. **Change (badge + border):** the badges used.
4. **Lifecycle, markers:** padlock, draft, divergence, tie-bar, callout disc, details tag and absence, if used.

## 9. View families

| | Engineering (default) | Product (default) |
|---|---|---|
| Corners | sharp (2px) | rounded (10px) |
| Hue means | pattern (cards) and enforcement (data connectors) | model area (cards) and relationship kind (connectors) |
| Pattern identity | card colour + glyph + caps label | caps kind label (patterns are rare in product views) |
| Typical elements | containers, components, data, libraries | product concepts, versions, configurations |

Views pick colour meanings with `colour.nodes` (`pattern`, `area`, `none`) and `colour.edges` (`enforcement`, `kind`, `none`). Lint warns only for pattern + kind, where the two palettes compete.

## 10. Rejected alternatives

- **Hue for change state** (green new, amber modified): collides with enforcement amber and emerald in engineering views, and fails greyscale.
- **Glyph and chip only for patterns** (the phase 1 default): reviewers couldn't tell patterns apart at a glance. Replaced by pattern-coloured cards (DECISIONS 19); collisions with enforcement are avoided by keeping rose and amber out of pattern palettes and by colouring cards, not lines.
- **Details as footnotes on the page:** they doubled the page height and were rarely read. Moved to the appendix and the viewer panel (DECISIONS 21).
- **Prose captions inside boxes:** this was the first experiment's main readability failure. Captions became `subtitle` (one line) plus `details` (footnotes).
