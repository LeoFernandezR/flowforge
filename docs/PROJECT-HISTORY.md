# FlowForge — Project History

**Companion to:** [`PROJECT-SCOPE.md`](./PROJECT-SCOPE.md)

A record of what's been built, by phase, plus a to-do list of what's left. Each phase is one
sub-project (a spec + plan under `docs/superpowers/`).

---

## Phase 1 — Thin vertical slice

*Spec & plan: `2026-07-08-flowforge-slice1`. Merged 2026-07-14.*

- Flow and Run data model (Postgres + Prisma)
- Structured-output engine: dynamic Zod + JSON schema from user-defined fields
- `LlmProvider` interface + Gemini adapter
- `extract` step, `runFlow`, step registry
- Run API route, flow CRUD, flow editor, test panel, run history UI
- Error handling: every execution persists a `Run`

## Phase 2 — Multi-provider (Groq)

*Spec & plan: `2026-07-14-flowforge-multi-provider`. Merged 2026-07-14.*

- Groq adapter (strict `json_schema` output)
- Providers build their own schema from neutral fields
- Per-flow provider selection (dropdown)

## Phase 3 — Visual multi-step editor

*Spec & plan: `2026-07-15-flowforge-multi-step-editor`. Merged 2026-07-17.*

- `Flow.steps` — a flow is now a linear pipeline of steps
- `generate` step type alongside `extract`
- Prompt chaining via `{{input}}` / `{{key.field}}` templates
- Per-step provider override
- Per-step run trace + save-time chain validation
- Visual step editor: cards, add/remove/reorder, variable-chip inserter, trace panel

## Phase 4 — Retry on invalid output

*Spec & plan: `2026-07-17-flowforge-retry-invalid-output`. Merged 2026-07-17.*

- Bounded retry in `runStructured` on Zod validation failure (both `extract` and `generate`)
- Validation error + previous output fed back to the model on each retry
- Bound from `FLOWFORGE_MAX_VALIDATION_RETRIES` (default 2 → up to 3 attempts; `0` disables)
- Per-step attempt count recorded in the run trace and shown in the editor trace panel

## Phase 5 — Editor redesign

*Spec & plan: `2026-07-17-flow-editor-redesign`. Merged 2026-07-18.*

- Blueprint/schematic visual identity: drafting-paper light theme, cyanotype dark theme, and a
  technical type system — IBM Plex Sans (body) / IBM Plex Mono (keys, tokens, JSON) / Archivo for
  display (Archivo Expanded was specced but is not in Next's bundled Google Fonts catalog; shipped
  as regular-width Archivo, 600/700, with heavy uppercase tracking)
- `FlowEditor` rewrite: two-pane layout, connector rail with ref annotations, step cards, title-block
  signature, plot-in animation on Run (reduced-motion respected), collapsible run history
- Edit page and new-flow page restyled to match
- Home list shell restyled: masthead, node-bullet flow list, drafting-table empty state

---

## To do

Not started yet. Each is a fresh phase (brainstorm → spec → plan → build).

- [ ] CSV input with row-by-row processing + progress bar
- [ ] Export results
- [ ] "See the real prompt sent" mode
- [ ] Preloaded example flows (3-4: support tickets, invoice extraction, product categorization)
- [ ] Deploy + README + demo GIF
