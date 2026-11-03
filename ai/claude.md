# TripPilot AI — Project Root

> Korean version: ./claude.ko.md

## Project Overview

TripPilot AI is an **independent Python AI service** that generates, replans, and reflects on travel itineraries with an LLM + optimization/assembly hybrid architecture.

## Four Invariants

1. **INV-1**: The LLM selects only from within the closed-set candidates (zero hallucination)
2. **INV-2**: User-visible times and order come only from assembly-verified values
3. **INV-3**: Duration is never displayed — distance only
4. **INV-4**: On AI failure, fall back deterministically (silent failure is forbidden)

## Architecture — one canon

**`ARCHITECTURE.md` is the single AI architecture canon (2026-11-02).** Layers, the BE↔AI boundary, request
flows, the 6 agents, orchestrator · Providers, LLM gateway, assembly engine, data/KB, deploy and the
"designed but not wired" list all live there — do not restate them here or in new docs. The older overviews
(README structure sections, `ai-architecture`, `agent-structure-v2`, `agent-redesign`, `components` …) carry a
"대체됨" banner and are history only. When code and a doc disagree, the code wins and `ARCHITECTURE.md` gets fixed.

Quick facts that sessions get wrong most often (verify in code before relying on them):
- **6 agents**, each a `run(<Task>)` object (`agents/__init__.py` is the roster canon). The
  `Agent.handle(AgentTask) -> AgentResult` envelope is unimplemented for all six.
- Assistant turns run through `DialogueOrchestrator` (LLM-direct `DIALOGUE_INTENT`) when
  `TRIPPILOT_DIALOGUE_ORCHESTRATOR=on` (on in dev/prod, code default off); the 3-stage `IntentRouter` then runs
  only as a shadow probe. With the switch off, `IntentRouter` is the service path.
- Assembly chain is **two stages** (`OrToolsAssembler` → `RuleFallbackAssembler`); the LLM 2nd stage is not wired.
- Judgment-free single-shot transforms (share-card copy, nudge, reminder copy) go boundary → worker directly, no agent.
- Model assignment is a deploy env (`TRIPPILOT_LLM_FEATURE_MODELS`) — never pin model names in docs.

## Tech Stack

- Python 3.11+ / FastAPI / OR-Tools / LLM vendors behind `llm_gateway` adapters (Anthropic · OpenAI · Bedrock).
- pgvector (`ai_kb` DB) + **`nlpai-lab/KURE-v1`** embeddings served by the separate embedding service.
- pytest + Hypothesis — don't pin counts; count with `grep -rc --include="*.py" "@given" ai/tests`.
- **Test layout mirrors `src/trippilot/`**: put a test in the folder of the package it mainly
  exercises — `tests/<package>/` (agents by agent: `tests/agents/<schedule|planb|reflect|edit|unknown_handling|recommendation>/`);
  tests of `ai/scripts` go in `tests/scripts/`. `fakes/`·`fixtures/`·`generators/` and
  `test_architecture.py` stay at the root.
- LangChain: **not used** — no dependency, zero imports. RAG is hand-built on psycopg + pgvector.

**Wire canon is `docs/openapi.json`** — never hand-edit it; regenerate with `scripts/export_openapi.py`.
CI (`ai-ci`) enforces "running app schema == committed `docs/openapi.json`" and fakes every external API.

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
