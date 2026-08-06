# units — Units of Work (구현 유닛 분해)

> English version: ./claude.md

6개 유닛으로 분해한 구현 단위 문서입니다.

## 파일 목록

- `unit-of-work.md` — 6유닛 상세 정의 (범위·산출물·성공기준·소요·리스크)
- `unit-of-work-dependency.md` — 유닛 간 의존 + 병렬 가능 영역 + 구현 순서
- `unit-of-work-story-map.md` — 유닛별 FR/NFR 매핑 + PBT 속성 19개 배정

## 유닛 요약

| Unit | 이름 | 소요 |
|---|---|---|
| U1 | Domain & Ports | 2~3일 |
| U2 | C2 Solver Core | 5~7일 |
| U3 | M7 Place Data Core | 3~5일 |
| U4 | C1 LLM Gateway | 4~5일 |
| U5 | Orchestration & API | 3~4일 |
| U6 | Extended Features | 5~7일 |

## 구현 순서

U1 → U2/U3/U4 (병렬) → U5 → U6
