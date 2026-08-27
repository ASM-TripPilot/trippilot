# TripPilot AI — Project Root

> Korean version: ./claude.ko.md

## Project Overview

TripPilot AI is an **independent Python AI service** that generates, replans, and reflects on travel itineraries with an LLM + optimization-solver hybrid architecture.

## Core Structure

- `aidlc-docs/` — AI-DLC workflow artifacts (design · requirements · plans)
- `.kiro/` — Kiro IDE steering + detailed AI-DLC rules
- `README.md` — overall design overview (the reference for the latest information)

## Four Invariants

1. **INV-1**: The LLM selects only from within the closed-set candidates (zero hallucination)
2. **INV-2**: User-visible times and order come only from solver-verified values
3. **INV-3**: Duration is never displayed — distance only
4. **INV-4**: On AI failure, fall back deterministically (silent failure is forbidden)

## Multi-Agent Structure

> **Canon is `agent-structure-v2.md`** (TRIP-530, 2026-08-25). The two-tier
> "agent-as-tool" model below described `agent-hierarchy-design.md` (v1), which v2
> **superseded**: information sources are Providers gathered by `InfoCollector`
> (envelope-only, no tool overlap), not sub-agents invoked at depth 2.

**Task tier** (agent-redesign.md):
- **Orchestrator**: intent detection (hybrid question-bank matching) + Fast Path + parallel dispatch via AgentTask envelopes
- **ScheduleAgent**: itinerary generation (Generation pattern)
- **PlanBAgent**: contingency handling (RAG pattern, 3 KBs + pgvector)
- **ReflectAgent**: reflection generation (phase 1: simple LLM Generation; Multi-step expansion later)
- **EditAgent**: itinerary editing (intent interpretation → solver verification → apply)

**Information sources** (v2 — `orchestrator/info_collector.py` + `providers/`):
Place · Weather · Transit · Persona · Event Providers. The Orchestrator collects
them per the INFO_REQUIREMENTS table and passes results **in the AgentTask envelope**
— task agents do not call Providers directly. Each returns a `ProviderStatus`
(`OK`/`LOW`/`NO_CANDIDATES`/`WEATHER_UNKNOWN`/`COLD_START`/`UNAVAILABLE`).

⚠️ `IntentRouter` (question-bank matching) is **implemented but not wired** — the
Orchestrator's intent detection above is design, not running code (TRIP-529).

## Key Design Documents (application-design/)

- Delegation protocol: `orchestrator-delegation-design.md` (AgentTask/AgentResult, deadline inheritance, trace_id)
- I/O contracts: `agent-io-contracts.md` (FE↔BE↔Agent mapping)
- Intent matching: `intent-matching-design.md` / evaluation metrics (freshness·responsiveness): `evaluation-metrics-design.md`
- MLOps/LLMOps + ML pattern typology: `mlops-llmops-design.md`

## Solver Hybrid Strategy

OR-Tools (1st: deterministic) → LLM (2nd: creative proposals) → rule-based fallback (final guarantee)
All output must pass HC1~HC4 verification.

⚠️ **The LLM 2nd stage is not wired** (TRIP-529, 2026-08-25): `api/wiring.py` builds
`stages = (OrToolsSolver, RuleFallbackSolver)` because the solver prompt canon and
model settings do not exist yet. AI-D07's "run the 2nd stage if ≥ 2.5s remains"
branch therefore cannot fire on any path.

## Tech Stack

- Python 3.11+ / Anthropic API directly (Claude — AI-D06) / OR-Tools / FastAPI
- pgvector + **local `nlpai-lab/KURE-v1` embeddings** (AI-D06 addendum 2026-08-23,
  wired in TRIP-514). Titan is a fallback adapter; it is Bedrock-only.
- pytest + Hypothesis — **170 `@given` properties across 41 test files** (measured
  2026-08-25; count with `grep -rc "@given" ai/tests/*.py`). Earlier "19"/"52"
  figures were stale.
- LangChain: **declared but not used** — no dependency in `pyproject.toml`, zero
  imports in `src/`. RAG is hand-built on psycopg + pgvector (TRIP-522 tracks the
  retraction record).

## Current Status

**U1–U6 built and running** (as of 2026-08-25). FastAPI boundaries are live and the
backend calls them round-trip: `POST /ai/v1/itinerary/{generate,validate,repair,
alternatives,explanations,edit}` + `/health` + `POST /ai/v1/reflection/{generate,nudge}`.
CI (`ai-ci`) enforces "running app schema == committed `docs/openapi.json`" and fakes
every external API (zero real calls). GHCR images publish on develop.

**Wire canon is `docs/openapi.json`** — never hand-edit it; regenerate with
`scripts/export_openapi.py`.

## AI-DLC Rules

Detailed rules in `.kiro/aws-aidlc-rule-details/`.
Check current progress state in `aidlc-docs/aidlc-state.md`.
