# design-artifacts — AI Design Canon

> Korean version: ./claude.ko.md

This folder contains the **canonical design documents** for the TripPilot AI service.
The ai-*.md files that used to live at the root have been organized here.

## Document Hierarchy (dependency order)

| Layer | Document | Role |
|---|---|---|
| L1 | ai-architecture.md | Strategy & architecture (WHAT/WHY). Four invariants |
| L2 | ai-implementation-design.md | Implementation design (HOW). Interfaces · sequences · algorithms |
| L3 | ai-data-design.md | M7 data layer. POI schema · candidate pool · caching |
| L4 | ai-prompt-design.md | Per-C1-feature prompts · OutputSchema |
| L5 | ai-testing-guide.md | 19 PBT properties · oracles · fakes · CI |
| L6 | ai-adr.md | Architecture decision rationale (ADR-0008~0015, AI-D01~D05) |
| — | ai-cost-estimation.md | Cost estimation |

## Caution

- These documents are the **canon**. Record a change history when modifying them.
- For agent structure, the latest canon is `agent-structure-v2.md` (application-design/, 2026-08-02 tool-exclusivity revision).
  §3.4 (worker structure) of ai-implementation-design.md in this folder is the **old design**, superseded along the chain `agent-redesign.md` → `agent-hierarchy-design.md` → `agent-structure-v2.md`.
