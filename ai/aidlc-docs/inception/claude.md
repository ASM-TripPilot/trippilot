# inception — INCEPTION Phase Artifacts

> Korean version: ./claude.ko.md

All documents produced in the INCEPTION Phase live here.
They define "WHAT we build and WHY we build it that way."

## Subfolders

- `design-artifacts/` — ai-*.md design canon (architecture · implementation · data · prompts · testing · ADR · cost)
- `reverse-engineering/` — 8 analysis artifacts from the pre-existing design documents
- `requirements/` — functional/non-functional requirements (5 FR groups + 6 NFR groups)
- `plans/` — Execution Plan (6-unit breakdown, execution order)
- `application-design/` — component · method · service layers + **agent structure** (canon: `agent-structure-v2.md`)
- `units/` — Units of Work (unit definitions · dependencies · story mapping)
- `user-stories/` — (SKIP — internal AI service)

## Reading Order (context loading)

1. `design-artifacts/README.md` — design document hierarchy index
2. `requirements/requirements.md` — full requirements
3. `plans/execution-plan.md` — execution plan
4. `application-design/agent-structure-v2.md` — latest canon for agent structure (2026-08-02, tool-exclusivity revision). `agent-redesign.md` and `agent-hierarchy-design.md` are its predecessors, kept for history
5. `units/unit-of-work.md` — unit breakdown
