# Flow Editor Redesign — "The Drawing"

**Date:** 2026-07-17
**Type:** Presentational redesign (no behavior change)
**Status:** Approved design, ready for implementation plan

## Summary

Redesign the flow editor and its surrounding app shell around a **blueprint / schematic**
identity: a flow *is* a technical drawing of a data pipeline. The editor becomes a drafting
table; each step is a component stamped on the sheet; the chain of `{{token}}` references is the
wiring. This is a purely presentational change — state, event handlers, server actions, the
run API, and the saved payload shape are all untouched.

Two themes ship: a light **"drafting paper"** default optimized for reading long prompts and JSON,
and a true **cyanotype** dark mode (deep Prussian-blue ground, pale-cyan ink).

### Why this direction

FlowForge builds linear LLM pipelines for a technical audience. The pipeline-as-schematic
metaphor is grounded in the subject rather than borrowed from a generic SaaS template. It is
deliberately none of the three current AI-design defaults (cream/serif/terracotta;
near-black/acid-accent; broadsheet hairlines). The single aesthetic risk is the literal cyanotype
dark mode; it is justified because it pays off the blueprint metaphor on theme flip while staying
legible (pale text on Prussian blue, never blue-on-blue).

## Scope

### In scope (files touched)

- `src/app/globals.css` — design tokens (light + cyanotype dark), blueprint grid background,
  focus ring, exposed through Tailwind v4 `@theme`.
- `src/app/layout.tsx` — swap Geist fonts for Archivo Expanded / IBM Plex Sans / IBM Plex Mono via
  `next/font/google`; correct the stale `Create Next App` metadata to FlowForge.
- `src/app/flows/FlowEditor.tsx` — restructure to a two-pane layout (drawing + test rig) with a
  connector rail, title block, restyled step cards, and a schematic trace readout.
- `src/app/flows/[id]/page.tsx` — title-block header and a collapsible run-history strip.
- `src/app/flows/new/page.tsx` — matching shell for the new-flow page (single column, no test rig).
- `src/app/page.tsx` — home/list page restyled to the same drafting shell.

### Out of scope

- Any change to behavior, state shape, handlers, server actions (`actions.ts`), the run API,
  `runFlow`, validation, or the saved `Step`/`Flow`/`Run` payloads.
- New runtime dependencies. Fonts come from `next/font/google`; the grid is pure CSS. No
  drag-and-drop, no icon library, no component library (consistent with `PROJECT-SCOPE.md`).
- New editor capabilities. Reorder stays up/down buttons; steps stay a linear sequence.

## Design tokens

### Color — light "drafting paper" (default)

| token | hex | use |
|---|---|---|
| `--paper` | `#EEF2F7` | page ground (cool paper) |
| `--sheet` | `#FBFCFE` | card / panel surface |
| `--grid` | `#DCE6F2` | faint blueprint grid lines |
| `--ink` | `#0B2440` | primary text |
| `--blueprint` | `#16457A` | structural lines, borders, connector rail |
| `--azure` | `#0E6FE0` | interactive / active state, focus ring |
| `--redline` | `#C2452B` | destructive actions + validation errors (draftsman's red pencil — the one warm accent) |

### Color — dark "cyanotype"

| token | hex | use |
|---|---|---|
| `--paper` | `#0A2A49` | page ground (Prussian blue) |
| `--sheet` | `#0C3157` | card / panel surface |
| `--grid` | `#164675` | grid lines |
| `--ink` | `#DCEBFB` | primary text (pale cyan-white) |
| `--blueprint` | `#5FA8E6` | structural lines, rail |
| `--azure` | `#7FC4FF` | interactive / active, focus ring |
| `--redline` | `#FF7A5C` | destructive + errors |

Tokens are declared as CSS custom properties on `:root`, overridden inside
`@media (prefers-color-scheme: dark)`, and surfaced to Tailwind utilities via the existing
`@theme inline` block (e.g. `--color-paper`, `--color-ink`, `--color-blueprint`).

### Typography (3 roles, all `next/font/google`)

- **Display — Archivo Expanded** (600/700, uppercase, letter-spaced): flow title and the title
  block, echoing the lettering on an engineering drawing.
- **Body / UI — IBM Plex Sans**: labels, inputs, buttons, prose.
- **Mono — IBM Plex Mono**: step keys, `{{tokens}}`, field types, JSON output, trace timings.

Exposed as `--font-display`, `--font-sans`, `--font-mono`; Geist is removed.

## Layout

Two-pane on the edit page, collapsing to a single column below ~900px.

```
┌───────── TITLE BLOCK ────────────────────────────────────┐
│ FLOWFORGE · SHEET   NAME [Invoice parser ]  PROV [gemini▾]│
│                     STEPS 2   ·   REV —   ·   STATUS ok   │   ← signature
└──────────────────────────────────────────────────────────┘
┌─── THE DRAWING (left) ──────────┐ ┌─ TEST RIG (right,sticky)┐
│  ▢ input                        │ │  INPUT                  │
│  ●│  ┌ extract1 · extract ─────┐ │ │  [ paste text…       ]  │
│   │  │ prompt template …       │ │ │  [ ▶ RUN ]              │
│   │  │ ports: {{input}}        │ │ │  ── TRACE ──            │
│   │  │ fields ▸ name  date     │ │ │  ● extract1  ok  120ms  │
│  ●│  └─────────────────────────┘ │ │  ● generate1 ok   90ms  │
│   │                              │ │  ── FINAL ──            │
│  ●│  ┌ generate1 · generate ──┐ │ │  { … }                  │
│   │  │ ports: {{extract1.*}}   │ │ └─────────────────────────┘
│   ▼  └─────────────────────────┘ │
│  ▢ output {{generate1.text}}    │    (new-flow page: right
└─────────────────────────────────┘     pane shows a legend)
```

- **Left — "The Drawing":** an `input` node at the top, step cards connected by a vertical
  **connector rail**, and an `output` node at the bottom. The rail is informational, not
  decorative: nodes mark each step, the terminal arrow encodes data-flow direction, and short
  annotations along it name the refs that become available after each step (the real
  `availableRefs(...)` set, strictly backward).
- **Right — "Test Rig":** sticky panel with the input textarea, Run button, per-step trace, and
  final output. Only rendered in `edit` mode. In `new` mode there is no test rig; the drawing
  spans full width and a short legend explains steps/tokens.
- **Run history:** moves into a collapsible strip beneath the drawing on the `[id]` page.

### Step card

A card styled as a component on the schematic:

- Header row (the component's "title strip"): monospace `key` tag, `type`, optional label input,
  per-step provider select, up/down/remove controls. Remove uses `--redline`.
- Prompt template textarea (monospace).
- **Ports:** the insert-token chips, presented as the component's available input pins; clicking
  one inserts `{{ref}}` at the caret (existing `insertToken` behavior).
- `extract` steps: the output-field editor (name / type / required / remove) as the component's
  output pins. `generate` steps: the note that they output `{{key.text}}`.

### Signature element

The **title block** — the ruled metadata stamp every technical drawing carries — repurposed as the
flow header: `NAME · DEFAULT PROVIDER · STEPS · STATUS` in a real bordered grid. This is where the
design spends its boldness; everything else stays quiet and disciplined.

## Motion

One orchestrated moment, `prefers-reduced-motion` respected:

- **On Run:** the trace "plots in" — each rail node lights and its trace row fades in in sequence
  as the results render, so the pipeline appears to draw itself. Because execution is synchronous
  (no streaming, per scope), this is a short staggered reveal when the response lands, not live
  streaming.
- Elsewhere: only quiet focus and port-hover highlights. No scattered ambient animation.

## Quality floor

- Responsive: two-pane collapses to a single column on narrow viewports; page body never scrolls
  horizontally (wide content — JSON, traces — scrolls inside its own container).
- Visible keyboard focus (azure focus ring) on every interactive element.
- `prefers-reduced-motion: reduce` disables the plot-in reveal.
- Both themes styled; no unreadable blue-on-blue.

## Invariants preserved

- No change to the saved `Step` / `Flow` / `Run` shapes or the run payload.
- `flowSchema` remains the single source of truth for validation; the UI still mirrors it.
- Steps remain a linear sequence with stable keys referencing strictly backward.
- No new runtime dependency; no non-goal (drag-and-drop, streaming, extra step types) introduced.

## Verification

- `npm run test` and `npm run build` pass.
- Manual: new-flow page (single column, no test rig), edit page (two-pane, rail, title block,
  ports, field editor), run a flow and confirm the trace plots in, home list page, light and dark
  themes, and a narrow-viewport collapse.
