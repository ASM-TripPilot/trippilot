# TripPilot AI — Project Root

> Korean version: ./claude.ko.md

## Project Overview

TripPilot AI is an **independent Python AI service** that generates, replans, and reflects on travel itineraries with an LLM + optimization/assembly hybrid architecture.

## Core Structure

- `aidlc-docs/` — AI-DLC workflow artifacts (design · requirements · plans)
- `.kiro/` — Kiro IDE steering + detailed AI-DLC rules
- `README.md` — overall design overview (the reference for the latest information)

## Four Invariants

1. **INV-1**: The LLM selects only from within the closed-set candidates (zero hallucination)
2. **INV-2**: User-visible times and order come only from assembly-verified values
3. **INV-3**: Duration is never displayed — distance only
4. **INV-4**: On AI failure, fall back deterministically (silent failure is forbidden)

## Multi-Agent Structure

> **Canon is `agent-structure-v2.md`** (TRIP-530, 2026-08-25). The two-tier
> "agent-as-tool" model below described `agent-hierarchy-design.md` (v1), which v2
> **superseded**: information sources are Providers gathered by `InfoCollector`
> (envelope-only, no tool overlap), not sub-agents invoked at depth 2.

**Task tier** (agent-redesign.md):
- **Orchestrator**: intent detection (hybrid question-bank matching) + Fast Path + parallel dispatch via AgentTask envelopes
- **ScheduleAgent**: itinerary generation (Generation pattern) — **wired** (2026-09-09): `agents/schedule/agent.py`
  `ScheduleAgent.run(ScheduleTask)`; `ScheduleCoordinator` verifies ownership, allocates the deadline,
  collects/digests info and delegates. The assembly engine stays its own layer — the agent only calls `solve()`
- **PlanBAgent**: contingency handling (RAG pattern, 3 KBs + pgvector) — `agents/planb/rag.py` `PlanBRagPipeline.run(PlanBRagRequest)`
- **ReflectAgent**: reflection generation — `agents/reflect/agent.py` `ReflectAgent.run(ReflectTask)`; text and vision (Phase 2) share one entry via `ReflectTask.vision`
- **EditAgent**: itinerary editing (translate → validate → confirm gate → retime → assembly validate) — `agents/edit/agent.py` `EditAgent.run(EditTask) -> EditOutcome`
- **UnknownHandlingAgent**: place facts the card shows as "unknown" (hours · closed days · fee) found by vendor web search *after* answering — `agents/unknown_handling/agent.py` `UnknownHandlingAgent.run(UnknownTask) -> UnknownOutcome(facts, pending)`; the GET_POI_INFO dialogue handler calls it (not a `ROUTING_TABLE` row), the lookup runs in the background and the result is stored (ai_kb `place_fact_cache`) for the next ask. Moved here from `orchestrator/` on 2026-10-22 to match the other four. Second job (2026-10-23): general travel knowledge answered this turn — `run(KnowledgeTask) -> UnknownOutcome(answer)` (feature `DIALOGUE_KNOWLEDGE`, no web search)
- **RecommendationAgent**: the choosing behind the assistant's two recommendation intents (which candidate set, what order, how many places · which regions and why) — `agents/recommendation/agent.py` `RecommendationAgent.run(RecommendTask) -> RecommendOutcome`; LLM 0, the dialogue handlers gather the material and build the answer (Facts). Added 2026-10-23 (user decision)

> **All six agents are objects that wrap their gateway workers** (2026-09-09; RecommendationAgent wraps none — it only chooses): constructor DI, one
> `run(<Task>) -> <Outcome>` entry, no exceptions across the boundary (DL-5). The literal
> `Agent.handle(AgentTask) -> AgentResult` envelope is still unimplemented for all six —
> it lands with IntentRouter wiring (business-rules 미결 #8).
> One codified exception: **judgment-free single-shot transforms are wired boundary→worker directly**
> (`reflection_nudge` — u6-reflect FD §2.1, decided 2026-09-09).

**Information sources** (v2 — `orchestrator/info_collector.py` + `providers/`):
Place · Weather · Transit · Persona · Event Providers. The Orchestrator collects
them per the INFO_REQUIREMENTS table and passes results **in the AgentTask envelope**
— task agents do not call Providers directly. Each returns a `ProviderStatus`
(`OK`/`LOW`/`NO_CANDIDATES`/`WEATHER_UNKNOWN`/`COLD_START`/`UNAVAILABLE`).

`IntentRouter` (question-bank matching) is **wired** (2026-10-14) through one boundary only —
`POST /ai/v1/dialogue/interpret` for the U8 assistant (`orchestrator/dialogue_interpreter.py`).
AI interprets; the backend `assistant` module dispatches (U8 DEC-U8-1). The question bank is
indexed into an in-memory store at startup from precomputed vectors
(`data/intent_question_bank.vectors.json.gz` — regenerate with `scripts/intent/build_bank_vectors.py`
after editing the bank; a stale file falls back to remote indexing, never loads wrong vectors). No DB load.

> **Orchestrator update (2026-10-17 — `assistant-orchestrator` FD)**: the boundary's caller is still
> `POST /ai/v1/dialogue/interpret` (TRIP-1410, 2026-10-14). This PR puts `orchestrator/dialogue_orchestrator.py`
> `DialogueOrchestrator.turn(TurnInput) -> TurnOutcome` behind it: LLM-direct intent classification
> (`DIALOGUE_INTENT`, IntentGate closed-set) → parallel fan-out to Providers (Weather · Transit · new PoiInfo) and the
> in-process PlanBAgent on a shared pool within `request_meta.deadline_ms` (9,000 ms) → an LLM-composed answer
> (`DIALOGUE_ANSWER`; exit gate ≤400 chars · INV-3 · contact patterns · deterministic template fallback) returned as
> `outcome=ANSWER` → session memory: a 20-line summary every 10 turns in the AI's own `ai_kb.dialogue_memory`
> (90-day TTL, purged through `DELETE /ai/v1/dialogue/memory`). The 3-stage `IntentRouter` is **off the service
> path**: `ShadowIntentProbe` runs it in the background on a sample (dev 1.0 · prod 0.2) and logs one `intent_shadow`
> line per turn for agreement measurement; shadow LLM calls are not counted in `llm_calls`. `EDIT_SCHEDULE` still
> returns `FRAME` (backend proposal path) in phase 1. Env: `TRIPPILOT_DIALOGUE_ORCHESTRATOR` (default off) ·
> `TRIPPILOT_DIALOGUE_SHADOW_RATE`. Why: the user decided (2026-10-17) to classify with the LLM directly and to
> compose answers from parallel results inside the AI. FD: `aidlc-docs/construction/assistant-orchestrator/functional-design/`.

## Key Design Documents (application-design/)

- Delegation protocol: `orchestrator-delegation-design.md` (AgentTask/AgentResult, deadline inheritance, trace_id)
- I/O contracts: `agent-io-contracts.md` (FE↔BE↔Agent mapping)
- Intent matching: `intent-matching-design.md` / evaluation metrics (freshness·responsiveness): `evaluation-metrics-design.md`
- MLOps/LLMOps + ML pattern typology: `mlops-llmops-design.md`

## Assembly Hybrid Strategy

OR-Tools (1st: deterministic) → LLM (2nd: creative proposals) → rule-based fallback (final guarantee)
All output must pass HC1~HC4 verification.

⚠️ **The LLM 2nd stage is not wired** (TRIP-529, 2026-08-25): `api/wiring.py` builds
`stages = (OrToolsAssembler, RuleFallbackAssembler)` because the assembly prompt canon and
model settings do not exist yet. AI-D07's "run the 2nd stage if ≥ 2.5s remains"
branch therefore cannot fire on any path.

## Tech Stack

- Python 3.11+ / Anthropic API directly (Claude — AI-D06) / OR-Tools / FastAPI
- pgvector + **local `nlpai-lab/KURE-v1` embeddings** (AI-D06 addendum 2026-08-23,
  wired in TRIP-514). Titan is a fallback adapter; it is Bedrock-only.
- pytest + Hypothesis — **170 `@given` properties across 41 test files** (measured
  2026-08-25; count with `grep -rc --include="*.py" "@given" ai/tests`). Earlier "19"/"52"
  figures were stale.
- **Test layout mirrors `src/trippilot/`**: put a test in the folder of the package it mainly
  exercises — `tests/<package>/` (agents by agent: `tests/agents/<schedule|planb|reflect|edit|unknown_handling|recommendation>/`);
  tests of `ai/scripts` go in `tests/scripts/`. `fakes/`·`fixtures/`·`generators/` and
  `test_architecture.py` stay at the root.
- LangChain: **declared but not used** — no dependency in `pyproject.toml`, zero
  imports in `src/`. RAG is hand-built on psycopg + pgvector (TRIP-522 tracks the
  retraction record).

## Current Status

**U1–U6 built and running** (as of 2026-08-25). FastAPI boundaries are live and the
backend calls them round-trip: `POST /ai/v1/itinerary/{generate,validate,repair,
alternatives,explanations,edit}` + `/health` + `POST /ai/v1/reflection/{generate,nudge}`
+ `POST /ai/v1/notification/copies` (TRIP-836 — reminder copy).
CI (`ai-ci`) enforces "running app schema == committed `docs/openapi.json`" and fakes
every external API (zero real calls). GHCR images publish on develop.

**Wire canon is `docs/openapi.json`** — never hand-edit it; regenerate with
`scripts/export_openapi.py`.

## Development Workflow (spec-kit + subagents)

[spec-kit](https://github.com/github/spec-kit) is installed in this package (`.specify/`,
`.claude/skills/speckit-*`). Feature work goes `/speckit-specify` → (`/speckit-clarify`) →
`/speckit-plan` → `/speckit-tasks` → `/speckit-implement`, producing `specs/NNN-<name>/`.
The constitution `.specify/memory/constitution.md` is a **summary** of the repo canon
(4 invariants · canon order · TDD+PBT · ponytail minimalism · architecture boundaries) —
when they disagree, the canon wins and the constitution gets fixed. Mapping to the team's
8-step workflow and the size rule (bug fixes / chores skip the spec) is in the constitution.
spec-kit does **not** create branches here — branch per `docs/conventions/`, in a worktree.

**Subagents** (`.claude/agents/`) carry the tooling with them:
- Code writers (`worker-builder`, `pbt-writer`) preload `ponytail:ponytail` + `superpowers:test-driven-development`
  via frontmatter `skills:`, call `speckit-implement` when a spec dir is given, and end with
  `superpowers:verification-before-completion`.
- `fd-designer` writes the FD, then `speckit-plan` (plan.md points at the FD, never restates it).
- `invariant-reviewer` / `canon-auditor` call `speckit-analyze` when a spec dir exists;
  the reviewer runs `ponytail:ponytail-review` only when asked for an over-engineering pass.
- When dispatching, pass the spec dir path in the prompt (subagents inherit no context).

`ponytail` and `superpowers` are user-scope Claude Code plugins; on a machine without them the
`skills:` preload is simply absent and the constitution's summary of those rules still applies.

## AI-DLC Rules

Detailed rules in `.kiro/aws-aidlc-rule-details/`.
Check current progress state in `aidlc-docs/aidlc-state.md`.
