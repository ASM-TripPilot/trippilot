# Component Inventory

## Application Components (Python AI 서비스)

| 컴포넌트 | 역할 | 유형 |
|---|---|---|
| C1 LLM Gateway | LLM 판단·해석 계층 (라우터 + 워커 + 검증 게이트) | AI Core |
| C2 Assembly Engine | 선택·순서·시각 보장 (OPTW + HC1~HC4 + 이동추정) | AI Core |
| M7 Place Data | closed-set 후보 풀 + POI 정본 + 수집 게이트 + 엔티티 해소 | Data Layer |

## Application Components (Kotlin 백엔드 — 본 저장소 범위 밖)

| 컴포넌트 | 역할 | 유형 |
|---|---|---|
| M8 Itinerary Generation | 일정 생성 오케스트레이션 | Orchestration |
| M9 Plan-B Detection | 자동 트리거 4종 감지 | Event Processing |
| M10 Itinerary Recalculation | 재계획 후보 생성·검증·확정 | Orchestration |
| M11 Weather & Context | 기상 예보·특보 폴링 | Data Provider |
| M13 AI Reflection | 회고·전체 요약·스타일 분석 | AI Consumer |
| M16 AI Assistant | 자연어 통역·중개 (라우터 경유) | AI Consumer |

## Shared Components

| 컴포넌트 | 역할 | 유형 |
|---|---|---|
| Domain Models | Poi, ItineraryProblem/Solution, VisitSlot, TravelEstimate 등 | Models |
| Port Interfaces | LlmPort, TravelPort, PlacesPort, WeatherPort | Interfaces (DI) |
| Config/Settings | remote config 파라미터 (G106 이동 파라미터, 트리거 임계 등) | Configuration |

## Test Components

| 컴포넌트 | 역할 | 유형 |
|---|---|---|
| PBT Generators | Hypothesis 기반 도메인 타입 생성기 | Test Utilities |
| Brute-Force Oracle | 소규모 인스턴스 전수 열거 (C2 이중 검증) | Test Oracle |
| Fake Adapters | FakeLlmAdapter, FakeTravelAdapter (D37) | Test Doubles |
| Property Tests | U5-P1~P12, M16-P1~P3, SRC-P1~P3, RES-P1 | Integration/Property |

## Total Count
- **Total Components**: 16
- **Application (Python AI 서비스)**: 3 (C1, C2, M7)
- **Application (Kotlin — 범위 밖)**: 6 (M8, M9, M10, M11, M13, M16)
- **Shared**: 3 (Domain, Ports, Config)
- **Test**: 4 (Generators, Oracle, Fakes, Property Tests)

## 4대 불변식 (아키텍처 제약)

| ID | 불변식 | 검증 방법 |
|---|---|---|
| INV-1 | LLM은 closed-set 후보 안에서만 선택 | C1 출구 게이트 + U5-P5 PBT |
| INV-2 | 사용자에게 보이는 시각·순서는 어셈블리 검증값만 | 편집 경로 수렴 + M16-P1 PBT |
| INV-3 | 소요시간 미표시 — 거리만 | VisitSlotDisplay 타입 정적 보장 + U5-P4 PBT |
| INV-4 | AI 실패 시 결정론 폴백 | 폴백 계단 + U5-P3 PBT |
