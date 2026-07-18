# FlowForge — Project Scope

**Status:** living document
**Companion:** [`PROJECT-HISTORY.md`](./PROJECT-HISTORY.md)

## What this is

This document defines the scope of FlowForge: what it does, what it will include, and what it
will not. It is the **source of truth for scope**. It does not track what has been built —
`PROJECT-HISTORY.md` does that, and its to-do list is whatever in-scope work here is not yet done.

It is not a phase design doc. The dated documents under `docs/superpowers/` design and implement
individual phases. When this document and a phase doc disagree about **scope**, this document
wins; about **design**, the phase doc wins.

## Product thesis

FlowForge is an AI automation builder. A user composes a **flow**: a linear pipeline of steps that
takes an input, processes it through an LLM one step at a time, and produces structured output
validated with Zod. Steps chain — each step's output can feed the prompts of later steps. The
pipeline is built in a visual editor, and every execution is recorded.

## In scope

Everything the project intends to include. Whether a given item is built yet is tracked in
`PROJECT-HISTORY.md`, not here.

- Persisted flows (`Flow` + `Run`), managed through CRUD and a visual editor.
- A flow as a linear pipeline of steps: add, remove, reorder.
- Step types: `extract` (user-defined output fields) and `generate` (free text).
- Structured LLM output validated with Zod.
- Prompt chaining between steps via `{{input}}` / `{{key.field}}` templates.
- Two LLM providers (Gemini, Groq) behind a common adapter — a flow-level default with a per-step
  override.
- Per-step execution trace and run history.
- Retry on invalid output: feed the validation error back to the model and retry, bounded, before
  recording a failure.
- Text and CSV input, with CSV processed row by row behind a progress bar.
- Export of results.
- A mode to view the real, resolved prompt sent to the model for a given step.
- Preloaded example flows.
- Deployment, with a README and a demo.

## Non-goals

Permanent. Not "later" — **not this project.** Each was considered and declined.

- **Authentication, sessions, ownership, sharing, multi-tenancy.** Single implicit user; `Flow`
  carries no `userId`. Auth is not one feature — it is sessions, a login surface, and an ownership
  check on every read, mutation, and run.
- **Branching / DAG topology.** Steps are a straight sequence.
- **Queues, async execution, background jobs.** Execution is synchronous, in the request.
- **Streaming responses.**
- **Cost or token tracking.**
- **Webhook triggers** or any input source beyond pasted text and CSV.
- **Per-flow or per-step model selection.** Each provider carries one env-overridable default
  model; the resolved model is recorded on the `Run` and in the trace.
- **Additional providers** beyond Gemini and Groq.
- **Additional step types** beyond `extract` and `generate`. The registry stays open, but this
  project registers no more.
- **A saved prompt-template library** (named prompts adoptable across flows).
- **Drag-and-drop reordering.** Up/down buttons, no new dependency.
- **Nested fields, enums, or unions** in output schemas. Flat fields of
  `string | number | boolean | string_array`.
- **Data migration or backfill.** Dev data is throwaway; the DB is reset when the schema moves.

## Invariants

Rules the project holds to; future work must not break them.

1. **Zod is the source of truth for model output.** Provider-side schema enforcement improves the
   odds; it is never trusted as a guarantee. Every response is parsed against Zod before use.
2. **Every execution persists a `Run`** — success or error, never an unrecorded exception.
3. **Providers stay behind `LlmProvider`.** No provider-specific format crosses that boundary;
   adapters receive neutral `FieldDef[]` and each builds its own request schema.
4. **No live LLM calls in the test suite.** Providers are injected as mocks.
5. **Steps are a linear sequence with stable, immutable keys**, referencing strictly backward.
6. **Execution halts on the first step error.** No partial-continue.
7. **`flowSchema` is the single source of truth for validation.** The UI mirrors it.

## Definition of done

The project is done when every in-scope capability is built, works end to end, and is deployed,
with no non-goal having crept in, and `npm run test` and `npm run build` both pass with no live
network calls in the suite.
