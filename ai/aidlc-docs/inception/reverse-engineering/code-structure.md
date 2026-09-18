# Code Structure

> **역사 기록 — 2026-07-12 리버스 엔지니어링 시점의 관측이다.** 그 뒤 U1~U6 이 구현돼 아래 서술(특히 "소스 코드 미작성 상태. 설계 문서만 존재.", 빌드 시스템 "미확정")은 현재와 다르다. 현재 코드 구조는 `ai/src/trippilot/`, 빌드는 uv(`ai/pyproject.toml`), 진행 상태 정본은 `../../../claude.md` §Current Status.

## Build System
- **Type**: 미확정 (Python — pip/poetry/uv 중 선정 필요)
- **Configuration**: 소스 코드 미작성 상태. 설계 문서만 존재.
- **Target Language**: Python (AI 서비스 전체)
- **Test Framework**: pytest + Hypothesis (PBT)
- **Deployment**: 독립 Python 서비스 (Kotlin 백엔드에서 API 호출)

## Design Documents Inventory (현재 워크스페이스)

| 파일 경로 | 목적/책임 |
|---|---|
| `ai-architecture.md` | 전략·아키텍처 정본 (WHAT/WHY). 4대 불변식, C1/C2/M7 역할, 기능별 파이프라인, 폴백, 품질 보증 |
| `ai-implementation-design.md` | 구현 설계 (HOW). 인터페이스 계약, 시퀀스, 알고리즘, 테스트 DoD |
| `ai-data-design.md` | 데이터 설계 (M7). POI 스키마, closed-set 풀 생성, 캐싱, 엔티티 해소 |
| `ai-prompt-design.md` | 프롬프트 설계. feature별 프롬프트·OutputSchema·검증 규칙 |
| `ai-testing-guide.md` | 테스트 가이드. PBT 속성 12개, oracle, fake 어댑터, CI 설정 |
| `ai-adr.md` | 결정 기록 (ADR). ADR-0008~0015, AI-D01~D05, D11~D38, G106 |

## Proposed Code Structure (설계 기반 권고)

```
tripilot-ai/                        # Python AI 서비스 루트
+-- src/
|   +-- tripilot_ai/
|   |   +-- __init__.py
|   |   +-- api/                    # HTTP/gRPC 엔드포인트
|   |   |   +-- routes.py
|   |   |   +-- schemas.py          # API 입출력 스키마
|   |   +-- c1/                     # C1 LLM Gateway
|   |   |   +-- gateway.py          # C1LlmGateway 구현
|   |   |   +-- router.py           # INTENT 라우터
|   |   |   +-- workers/            # 특화 워커들
|   |   |   |   +-- preference.py
|   |   |   |   +-- explanation.py
|   |   |   |   +-- reflection.py
|   |   |   |   +-- place_extraction.py
|   |   |   |   +-- conversation.py
|   |   |   +-- gate.py             # closed-set 출구 게이트
|   |   |   +-- context.py          # 서버 재조회 컨텍스트 주입
|   |   |   +-- prompts/            # feature별 프롬프트 템플릿
|   |   |   +-- schemas/            # OutputSchema 정의
|   |   +-- c2/                     # C2 Assembly Engine
|   |   |   +-- assembly.py           # C2AssemblyEngine 구현
|   |   |   +-- optimizer.py        # OPTW/TOPTW 최적화 (휴리스틱 + 지역탐색)
|   |   |   +-- constraints.py      # HC1~HC4 하드 제약
|   |   |   +-- travel.py           # 이동시간 추정 (어댑터 순서)
|   |   |   +-- fallback.py         # 결정론적 폴백 (규칙 점수)
|   |   |   +-- models.py           # ItineraryProblem / Solution
|   |   +-- m7/                     # M7 Place Data
|   |   |   +-- candidate_pool.py   # closed-set 후보 풀 생성
|   |   |   +-- poi_repository.py   # POI 정본 관리
|   |   |   +-- sourcing/           # 웹 후보 소싱
|   |   |   |   +-- places_api.py
|   |   |   |   +-- web_worker.py
|   |   |   |   +-- ingest_gate.py  # 수집 게이트 (5단 검증)
|   |   |   +-- entity_resolver.py  # 엔티티 해소 (fuzzy match)
|   |   |   +-- cache.py            # TTL 캐싱
|   |   +-- ports/                  # Port 인터페이스 (DI용)
|   |   |   +-- llm_port.py
|   |   |   +-- travel_port.py
|   |   |   +-- places_port.py
|   |   |   +-- weather_port.py
|   |   +-- domain/                 # 도메인 모델
|   |   |   +-- poi.py              # Poi, PoiCategory, OpenHour
|   |   |   +-- itinerary.py        # VisitSlot, DaySolution
|   |   |   +-- travel.py           # TravelEstimate, TransportMode
|   |   |   +-- trigger.py          # TriggerEvalResult, TriggerParams
|   |   +-- config/                 # 설정
|   |       +-- settings.py         # remote config 파라미터
+-- tests/
|   +-- generators/                 # PBT Generators (Hypothesis)
|   |   +-- itinerary_generators.py
|   |   +-- poi_generators.py
|   +-- oracle/                     # Brute-force oracle
|   |   +-- brute_force_oracle.py
|   +-- fakes/                      # Fake 어댑터 (D37)
|   |   +-- fake_llm.py
|   |   +-- fake_travel.py
|   +-- test_c2_constraints.py      # U5-P1: 하드 제약 PBT
|   +-- test_c1_gate.py             # U5-P5: closed-set 게이트 PBT
|   +-- test_assembly_determinism.py  # U5-P3: 결정론 폴백
|   +-- test_m8_state.py            # U5-P7~P10: 일정 상태머신
|   +-- test_m16_assistant.py       # M16-P1~P3: AI 도우미
|   +-- test_sourcing_gate.py       # SRC-P1~P3: 수집 게이트
|   +-- test_entity_resolver.py     # RES-P1: 엔티티 해소
+-- pyproject.toml                  # 프로젝트 설정
+-- Dockerfile
```

## Design Patterns

### Hexagonal Architecture (Ports & Adapters)
- **Location**: 전체 AI 서비스
- **Purpose**: 외부 의존(LLM·지도·Places API)을 Port 인터페이스로 격리해 fake 교체 가능 (D37)
- **Implementation**: `ports/` 디렉토리에 Protocol 정의, 실 어댑터와 fake 어댑터를 DI로 주입

### Chain of Responsibility (폴백 계단)
- **Location**: C1 게이트웨이, C2 어셈블리, M7 소싱
- **Purpose**: 각 실패 지점마다 다음 단계로 우아하게 성능 저하 (INV-4)
- **Implementation**: 카카오→네이버→직선거리, LLM→규칙점수→최소일정

### Strategy Pattern (알고리즘 스왑)
- **Location**: C2 어셈블리 (라이브러리 선택), C1 (LLM 벤더 교체)
- **Purpose**: 어셈블리 알고리즘·LLM 벤더를 소비 모듈 무영향으로 교체
- **Implementation**: Port 인터페이스 + 설정 기반 어댑터 선택

### State Machine
- **Location**: M8 일정 생성 세션, M13 회고 상태
- **Purpose**: 유효한 상태 전이만 허용 (U5-P9)
- **Implementation**: Enum 기반 상태 + 전이 테이블 + PBT 검증

## Critical Dependencies (확정 시 결정 필요)

### LLM 벤더 (미확정)
- **Version**: TBD
- **Usage**: C1 전체 feature (경량: INTENT·PreferenceScoring·Conversation·Requery / 상위: Explanation·Reflection·PlaceExtraction)
- **Purpose**: 취향 해석·의도 분류·설명 생성·회고·웹 텍스트 구조화

### 어셈블리 라이브러리 (미확정)
- **Candidates**: OR-Tools (Python) / Timefold (Python) / 자체 구현
- **Usage**: C2 OPTW/TOPTW 최적화
- **Purpose**: day1 5초 게이트 통과하는 일정 배치 최적화
- **Decision Criteria**: day1 5초 벤치마크 결과

### pytest + Hypothesis
- **Version**: latest
- **Usage**: 전체 PBT 속성 테스트
- **Purpose**: 12+ 속성 기반 테스트 (하드 제약·closed-set·결정론·상태머신)
