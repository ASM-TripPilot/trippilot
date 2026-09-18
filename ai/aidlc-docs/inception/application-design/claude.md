# application-design — Component & Service Design

> Korean version: ./claude.ko.md

This folder holds detailed design at the level just short of code implementation.

## File List

- `components.md` — internal module breakdown of C1·C2·M7·API·Ports·Domain, dependency rules
- `component-methods.md` — public/internal method signatures + business rules
- `services.md` — orchestration flows, error paths, state transitions, cross-cutting concerns
- `agent-redesign.md` — **the 4 task-agent structure** (mentor feedback incorporated)
- `agent-structure-v2.md` — **latest canon: the 4-box pipeline** (Orchestrator / 5 Providers / 4 Agents / Assembly gate — zero tool overlap)
- `agent-hierarchy-design.md` — (old edition) 2-tier refinement — superseded by v2
- `agent-io-contracts.md` — **I/O contracts** (FE screen IO ↔ BE DB·API ↔ Agent I/O mapping + FreshnessMeta)
- `orchestrator-delegation-design.md` — **delegation protocol** (AgentTask/AgentResult envelopes, context_refs, deadline inheritance, trace_id)
- `intent-matching-design.md` — **hybrid intent matching** (question-bank embedding matching + LLM similar-question voting)
- `evaluation-metrics-design.md` — **2-axis evaluation metrics** (freshness F1/F2, responsiveness SLO)
- `mlops-llmops-design.md` — **MLOps/LLMOps operations framework** + ML pattern typology (4 types, 10 candidates)
- `planb-rag-design.md` — **PlanBAgent RAG design** (vector store, retrieve strategy, pipeline)
- `langchain-adoption.md` — **LangChain partial adoption** (adoption scope + rationale + non-adopted parts)
- `reflect-agent-design.md` — **ReflectAgent design** (phase 1 A: simple LLM; later C: Multi-step)

## Important: The Latest Canon for Agent Structure

Per mentor feedback, the design was reworked from workers (tool-based) to agents (task-based) (`agent-redesign.md`).
On 2026-07-16 `agent-hierarchy-design.md` introduced the 2-tier split; **on 2026-08-02 `agent-structure-v2.md` was re-revised under the tool-exclusivity principle (mentor feedback)** — information agents renamed to Providers, Assembly made a common gate.
The latest canon is agent-structure-v2.md.

Key changes:
- 4 task-based agents (Schedule/PlanB/Reflect/Edit)
- Orchestrator Fast Path (handles simple tasks directly)
- Parallel execution across and within agents
- Assembly hybrid (OR-Tools → Bedrock → rule-based fallback)
- PlanBAgent: RAG-based (3 KBs + pgvector)
- ReflectAgent: phase 1 simple LLM Generation, Multi-step expansion later
- Per-agent tool restriction (token savings)
- LangChain partial adoption (Bedrock + RAG only)
