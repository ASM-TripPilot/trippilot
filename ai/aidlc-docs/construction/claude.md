# construction — CONSTRUCTION Phase Artifacts

> Korean version: ./claude.ko.md

Per-unit detailed designs and code summaries produced in the CONSTRUCTION Phase go here.
They define "HOW — how it is built."

## Originally Planned Structure (2026-07 plan — not what this directory holds)

```
construction/
├── plans/
├── u1-domain-ports/
│   ├── functional-design/
│   └── code/
├── u2-solver/
│   ├── functional-design/
│   ├── nfr-requirements/
│   └── code/
├── u3-m7-place-data/
│   ├── functional-design/
│   └── code/
├── u4-c1-gateway/
│   ├── functional-design/
│   └── code/
├── u5-orchestration-api/
│   ├── functional-design/
│   └── code/
├── u6-extended/
│   ├── functional-design/
│   └── code/
└── build-and-test/
```

## Current State

CONSTRUCTION is under way — the "not yet started, U1 first" note that stood here until
2026-09-02 was written in 2026-07 and never updated. Functional designs live in
`<unit>/functional-design/`; read that directory for the actual unit list instead of
restating it here. Progress canon is `../../claude.md` §Current Status.

Two gaps against the planned tree above are decisions, not backlog:
- **No `code/` directories.** Application code is written at the workspace root
  (`ai/src/trippilot/`), never under `aidlc-docs/` — Code Location Rules in
  `../aidlc-state.md`. The planned tree contradicted that rule from the start.
- **U5 (Orchestration & API) has no functional design.** It was built straight from code
  (TRIP-237/238 orchestrator, TRIP-239 FastAPI boundary, TRIP-241 real wiring, TRIP-242
  IntentRouter) without an FD gate.
