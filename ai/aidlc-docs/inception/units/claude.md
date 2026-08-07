# units — Units of Work (implementation unit breakdown)

> Korean version: ./claude.ko.md

Documents defining the implementation units, broken down into 6 units.

## File List

- `unit-of-work.md` — detailed definitions of the 6 units (scope · deliverables · success criteria · effort · risks)
- `unit-of-work-dependency.md` — inter-unit dependencies + parallelizable areas + implementation order
- `unit-of-work-story-map.md` — FR/NFR mapping per unit + assignment of the 19 PBT properties

## Unit Summary

| Unit | Name | Effort |
|---|---|---|
| U1 | Domain & Ports | 2–3 days |
| U2 | C2 Solver Core | 5–7 days |
| U3 | M7 Place Data Core | 3–5 days |
| U4 | C1 LLM Gateway | 4–5 days |
| U5 | Orchestration & API | 3–4 days |
| U6 | Extended Features | 5–7 days |

## Implementation Order

U1 → U2/U3/U4 (parallel) → U5 → U6
