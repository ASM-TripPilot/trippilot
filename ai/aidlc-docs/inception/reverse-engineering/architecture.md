# System Architecture

## System Overview

TripPilot AI는 **LLM + 최적화 솔버 하이브리드** 아키텍처다. 독립 Python AI 서비스(C1 LLM Gateway + C2 Solver Engine + M7 Place Data)를 중심으로, Kotlin 백엔드가 기능별 오케스트레이션(M8·M9·M10·M13·M16)을 수행한다. 4대 불변식(INV-1~4)이 LLM과 솔버의 역할 경계를 구조적으로 강제한다.

## Architecture Diagram

```mermaid
flowchart TD
    subgraph Client["클라이언트 (React Native + Expo)"]
        UI["일정 UI\n버튼/드래그/DB선택"]
        CHAT["AI 도우미\n사이드 패널"]
        LOC["위치/시간 Tick\n포그라운드"]
    end

    subgraph KotlinBE["Kotlin 백엔드"]
        M8["M8 Itinerary Generation\n생성 오케스트레이션"]
        M9["M9 Plan-B Detection\n트리거 감지"]
        M10["M10 Recalculation\n재계획 세션"]
        M11["M11 Weather & Context\n기상 폴링"]
        M13["M13 AI Reflection\n회고·요약"]
        M16["M16 AI Assistant\n자연어 중개"]
    end

    subgraph PythonAI["Python AI 서비스 (독립 배포)"]
        C1["C1 LLM Gateway\n라우터 + 워커 + 검증 게이트"]
        C2["C2 Solver Engine\nOPTW + HC1~HC4 + 이동추정"]
        M7["M7 Place Data\nclosed-set 풀 + 수집 게이트"]
    end

    subgraph External["외부 서비스"]
        LLM["LLM API\n(벤더 미확정)"]
        KAKAO["카카오모빌리티\n도로 거리"]
        NAVER["네이버 지도\n폴백 거리"]
        PLACES["Places API\n(카카오/구글)"]
        WEB["자유 웹 검색"]
        WEATHER["기상청 예보 API"]
        SM["Secrets Manager\nAPI 키 보관"]
    end

    subgraph DataStore["데이터 저장소"]
        DB["POI DB\n(M7 정본)"]
        ITIN["일정 저장소\nplan + current"]
        CACHE["캐시\n(POI TTL 24h)"]
    end

    UI --> M8
    CHAT --> M16
    LOC --> M9

    M16 -->|"API 호출"| C1
    M8 -->|"API 호출"| C1
    M8 -->|"API 호출"| C2
    M8 -->|"API 호출"| M7
    M9 -->|"API 호출"| C2
    M10 -->|"API 호출"| C1
    M10 -->|"API 호출"| C2
    M10 -->|"API 호출"| M7
    M13 -->|"API 호출"| C1
    M11 --> WEATHER

    C1 --> LLM
    C1 --> SM
    C2 --> KAKAO
    C2 --> NAVER
    M7 --> PLACES
    M7 --> WEB
    M7 --> DB
    M7 --> CACHE
    M8 --> ITIN
```

## Component Descriptions

### C1 LLM Gateway
- **Purpose**: LLM 판단·해석 계층 (자연어 의도 분류, 선호 점수, 설명, 회고, 웹 텍스트 추출)
- **Responsibilities**: 티어 라우팅, 의도 라우팅(INTENT), 워커 디스패치, OutputSchema 검증 + closed-set 교차, 서버 재조회 컨텍스트 주입, rate-limit
- **Dependencies**: LLM API, Secrets Manager, M7 (closed-set 화이트리스트)
- **Type**: Application (AI Core)

### C2 Solver Engine
- **Purpose**: 선택·순서·시각 보장 계층 (최적화 + 하드 제약 검증)
- **Responsibilities**: OPTW/TOPTW 최적화, HC1~HC4 검증, 이동시간 추정(카카오→네이버→직선거리), 결정론 폴백, repair, warm-start
- **Dependencies**: 카카오모빌리티 API, 네이버 지도 API (이동시간 추정용)
- **Type**: Application (AI Core)

### M7 Place Data
- **Purpose**: POI 정본 + closed-set 후보 풀 + 수집 게이트
- **Responsibilities**: POI CRUD, 후보 풀 생성(6단계 필터), 영업시간 감지, 웹 후보 소싱, 수집 게이트(5단), 엔티티 해소, 캐싱
- **Dependencies**: Places API, 자유 웹 검색, POI DB, 캐시
- **Type**: Application (Data Layer)

### M8 Itinerary Generation (Kotlin)
- **Purpose**: 일정 생성 오케스트레이션
- **Dependencies**: C1, C2, M7, 일정 저장소
- **Type**: Application (Orchestration)

### M9 Plan-B Detection (Kotlin)
- **Purpose**: 자동 트리거 4종 감지
- **Dependencies**: C2 (이동 부등식 계산), M11 (날씨)
- **Type**: Application (Event Processing)

### M10 Itinerary Recalculation (Kotlin)
- **Purpose**: 재계획 후보 생성·검증·확정
- **Dependencies**: C1, C2, M7
- **Type**: Application (Orchestration)

### M11 Weather & Context (Kotlin)
- **Purpose**: 기상청 예보·특보 폴링
- **Dependencies**: 기상청 API
- **Type**: Application (Data Provider)

### M13 AI Reflection (Kotlin)
- **Purpose**: 회고·전체 요약·스타일 분석
- **Dependencies**: C1 (상위 티어)
- **Type**: Application (AI Consumer)

### M16 AI Assistant (Kotlin)
- **Purpose**: 자연어 통역·중개
- **Dependencies**: C1 (라우터 + 워커), M8/M10 (편집 반영)
- **Type**: Application (AI Consumer)

## Data Flow — 일정 생성 (핵심 플로우)

```mermaid
sequenceDiagram
    participant U as 사용자
    participant KB as Kotlin 백엔드 (M8)
    participant M7 as M7 PlaceData
    participant C1 as C1 LLM Gateway
    participant C2 as C2 Solver Engine
    participant LLM as LLM API

    U->>KB: generate_itinerary(trip_id, FULL_AUTO)
    KB->>M7: get_candidate_pool(trip_id)
    M7-->>KB: CandidatePool (closed-set)
    KB->>C1: score_preferences(candidates, user_prefs)
    C1->>LLM: PREFERENCE_SCORING (경량 티어, 2.5s 타임아웃)
    alt 성공
        LLM-->>C1: scores
        C1-->>KB: ScoredCandidates (is_fallback=false)
    else 타임아웃/스키마 위반
        C1-->>KB: ScoredCandidates (is_fallback=true, 규칙 점수)
    end
    KB->>C2: solve(day1_problem)
    C2-->>KB: DaySolution (HC1~HC4 검증 완료)
    KB-->>U: 첫 1일 응답 (5초 게이트)
    loop 잔여 일자 (백그라운드)
        KB->>C2: solve(dayN_problem)
        C2-->>KB: DaySolution
    end
    KB-->>U: 전체 완료 (20초 한계)
```

## Integration Points

- **External APIs**:
  - LLM API (벤더 미확정) — 취향 해석·선호 점수·설명·회고·웹 텍스트 추출
  - 카카오모빌리티 — 도로 거리 (이동시간 추정 1순위)
  - 네이버 지도 — 도로 거리 (2순위 폴백)
  - Places API (카카오/구글) — POI 구조화 데이터 (웹 소싱 1단계)
  - 기상청 예보 API — 날씨 트리거 (1시간 폴링)
  - 자유 웹 검색 — POI 비정형 데이터 (웹 소싱 2단계)

- **Databases**:
  - POI DB (M7 정본) — 좌표·영업시간·카테고리·체류 기본값
  - 일정 저장소 — plan(불변) + current(수정 가능) 분리 저장
  - 캐시 (POI TTL 24h, 영업시간 TTL 6h, 가격 캐싱 금지)

- **Third-party Services**:
  - Secrets Manager — LLM API 키 보관
  - CloudWatch — 비용 계측·쿼터 알람·어댑터 실패율 관측

## Infrastructure Components
- **Deployment Model**: Python AI 서비스 (독립 배포) + Kotlin 백엔드 (별도 배포)
- **Service Communication**: REST/gRPC (미확정 — AI-D01 후속)
- **Scaling**: DAU 1천 / 동시 생성 10건 / 지역당 POI 5천 (MVP 규모, 과설계 금지)
- **Resilience**: 전 외부 호출에 타임아웃 + 서킷 브레이커 + 우아한 성능 저하
