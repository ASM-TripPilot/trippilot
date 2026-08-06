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

## Multi-Agent Structure (2 tiers — task + information)

**Task tier** (agent-redesign.md):
- **Orchestrator**: intent detection (hybrid question-bank matching) + Fast Path + parallel dispatch via AgentTask envelopes
- **ScheduleAgent**: itinerary generation (Generation pattern)
- **PlanBAgent**: contingency handling (RAG pattern, 3 KBs + pgvector)
- **ReflectAgent**: reflection generation (phase 1: simple LLM Generation; Multi-step expansion later)
- **EditAgent**: itinerary editing (intent interpretation → solver verification → apply)

**Information tier** (agent-hierarchy-design.md — invoked by task agents as agent-as-tool):
- **PlaceScoutAgent** (place candidates, INV-1 gate) / **WeatherAgent** (daily weather + triggers) / **TransitAgent** (transit·distance + delay triggers) / **PersonaAgent** (KB-2) / **EventAgent** (events, P2)
- Rules: depth fixed at 2, no writes, FreshnessMeta required in responses

Each agent is assigned only the tools it needs (50–60% token savings).

## Key Design Documents (application-design/)

- Delegation protocol: `orchestrator-delegation-design.md` (AgentTask/AgentResult, deadline inheritance, trace_id)
- I/O contracts: `agent-io-contracts.md` (FE↔BE↔Agent mapping)
- Intent matching: `intent-matching-design.md` / evaluation metrics (freshness·responsiveness): `evaluation-metrics-design.md`
- MLOps/LLMOps + ML pattern typology: `mlops-llmops-design.md`

## Solver Hybrid Strategy

OR-Tools (1st: deterministic) → LLM (Anthropic) (2nd: creative proposals) → rule-based fallback (final guarantee)
All output must pass HC1~HC4 verification.

## Tech Stack

- Python 3.11+ / Anthropic API directly (Claude — AI-D06) / OR-Tools
- LangChain (partial adoption — only for PlanBAgent RAG + LLM calls)
- pgvector / Titan Embeddings v2 / pytest + Hypothesis (19 PBT properties)

## Current Status

INCEPTION complete. Mentor feedback incorporated (agents redesigned around task responsibilities).
Next: CONSTRUCTION Phase (starting from U1 Domain & Ports).

## AI-DLC Rules

Detailed rules in `.kiro/aws-aidlc-rule-details/`.
Check current progress state in `aidlc-docs/aidlc-state.md`.
