# TripPilot AI 서비스 — 요구사항 정의

> **범위**: Python AI 서비스 (C1 LLM Gateway + C2 Solver Engine + M7 Place Data)
> **역할**: AI Engineer 담당
> **출처**: ai-architecture.md, ai-implementation-design.md, ai-data-design.md, ai-prompt-design.md, ai-testing-guide.md, ai-adr.md + reverse-engineering 산출물

---

## Intent Analysis

- **User Request**: TripPilot AI 서비스의 1차 출시 범위를 Python으로 구현
- **Request Type**: New Project (설계 완료, 코드 미작성)
- **Scope**: Multiple Components (C1 + C2 + M7 + API Layer + 테스트)
- **Complexity**: Complex (LLM 하이브리드, 최적화 솔버, 4대 불변식, PBT 12+속성)

---

## 1. 기능 요구사항 (Functional Requirements)

### FR-1. C2 Solver Engine — 선택·순서·시각 배치

| ID | 요구사항 | 우선순위 | 근거 |
|---|---|---|---|
| FR-1.1 | OPTW/TOPTW 최적화 — 후보 POI + 선호 점수를 받아 하드 제약을 만족하는 최적 방문 순서·시각 배치를 반환 | P0 | ADR-0008, §5.1 |
| FR-1.2 | 하드 제약 4종 검증 (HC1: 영업시간, HC2: 이동 부등식, HC3: 고정 블록 불변, HC4: 시간창) — 위반 배치는 해에서 구조적 배제 | P0 | §5.2, G114 |
| FR-1.3 | 이동시간 추정 — 어댑터 순서(카카오→네이버→직선거리), 안전계수 적용, 내부 전용(DTO 미노출) | P0 | ADR-0009, D25 |
| FR-1.4 | 결정론적 폴백 — LLM 점수 부재 시 규칙 점수(시드 고정)로 동일 입력→동일 출력 보장 | P0 | ADR-0011, INV-4 |
| FR-1.5 | warm-start 재생성 — 고정 블록(숙소·사용자 고정) 보존, 나머지만 재배치 | P1 | U5-P2 |
| FR-1.6 | validate — 일정의 하드 제약 위반 여부를 단일 진입점으로 검증 | P0 | §1.2 |
| FR-1.7 | repair — 위반 배치를 시각·순서만 최소 조정하여 수리 (POI 불변) | P1 | §1.2 |
| FR-1.8 | 예산 소프트 가중치 — 저예산일수록 저비용 카테고리 보상 증가 (하드 차단 아님) | P1 | U5-P6 |

### FR-2. C1 LLM Gateway — 판단·해석

| ID | 요구사항 | 우선순위 | 근거 |
|---|---|---|---|
| FR-2.1 | feature별 LLM 호출 (`call`) — feature·context_refs·prompt·schema를 받아 구조화 결과 반환 | P0 | §1.1 |
| FR-2.2 | closed-set 출구 게이트 — OutputSchema 파싱 + poi_id ∈ 화이트리스트 교차. 밖이면 드롭·계측 | P0 | INV-1, §3.2 |
| FR-2.3 | 티어 라우팅 — feature에 따라 경량/상위 모델 분기 | P0 | D11, §3.1 |
| FR-2.4 | 의도 라우팅 (`route`) — 자연어 의도 분류 + 슬롯 추출 → 워커 디스패치(Dispatch) 반환 | P1 | AI-D02, §3.4 |
| FR-2.5 | 서버 재조회 컨텍스트 주입 (`resolve_context`) — 요청자 권한으로 ResourceRef 재조회, 권한 밖은 PermissionDenied | P0 | D31, SECURITY-11 |
| FR-2.6 | PreferenceScoring 워커 — 후보 POI에 취향 기반 선호 점수 부여 (전 일자 공용 1회) | P0 | §2.1 |
| FR-2.7 | Explanation 워커 — 슬롯별 추천 이유 텍스트 생성 (상위 티어) | P2 | §2.2 |
| FR-2.8 | Reflection 워커 — 회고/요약 서술 생성 (상위 티어) | P2 | §2.3 |
| FR-2.9 | PlaceExtraction 워커 — 자유 웹 텍스트 → 구조화 POI 추출 (AI-D03) | P1 | AI-D03 |
| FR-2.10 | Conversation 워커 — 자유 대화 응답 + 다음 행동 1개 | P2 | ADR-0015 |
| FR-2.11 | 폴백 신호 발행 — 출력 전량 드롭/타임아웃 시 isFallback=true | P0 | INV-4 |

### FR-3. M7 Place Data — closed-set 후보 풀

| ID | 요구사항 | 우선순위 | 근거 |
|---|---|---|---|
| FR-3.1 | closed-set 후보 풀 생성 — 반경·예산·영업일·데이터품질 필터 + 상한(5천) | P0 | §3, INV-1 |
| FR-3.2 | POI 정본 관리 — Poi 스키마(좌표·영업시간·카테고리·체류 기본값·태그) CRUD | P0 | §2 |
| FR-3.3 | 엔티티 해소 — 지역·POI명 fuzzy match(edit-distance), 결정론, 신뢰도 분기(자동확정/확인/미해소) | P1 | AI-D04, §8 |
| FR-3.4 | 웹 후보 소싱 — Places API 어댑터(1단계) + 자유 웹 워커(2단계) 계층형 | P1 | AI-D03, §2.1 |
| FR-3.5 | 수집 게이트(5단) — 스키마·실재·중복·신뢰·정책 검증. 통과 후에만 M7 등록 | P1 | AI-D03 |
| FR-3.6 | 영업시간·휴무 변경 감지 — 당일 아침 배치 갱신, Plan-B 트리거 입력 | P1 | D27 |
| FR-3.7 | 캐싱 — POI 기본 24h, 영업시간 6h, 가격 캐싱 금지(G195) | P1 | D13 |
| FR-3.8 | 데이터 커버리지 게이트 — 좌표 95%·영업시간 70%·카테고리 90% | P2 | G192 |

### FR-4. API Layer — Kotlin 백엔드 인터페이스

| ID | 요구사항 | 우선순위 | 근거 |
|---|---|---|---|
| FR-4.1 | AI 서비스 HTTP/gRPC 엔드포인트 — C1(call/route/resolve_context), C2(solve/validate/repair), M7(candidate-pool/entity-resolve) | P0 | AI-D01 |
| FR-4.2 | 요청/응답 스키마 검증 — pydantic 기반 | P0 | — |
| FR-4.3 | 헬스체크·레디니스 엔드포인트 | P1 | — |

### FR-5. 일정 생성 오케스트레이션 (AI 서비스 내)

| ID | 요구사항 | 우선순위 | 근거 |
|---|---|---|---|
| FR-5.1 | score_preferences → solve 파이프라인 — M7 후보 풀 → C1 선호 점수 → C2 day별 배치 | P0 | §2 시퀀스 |
| FR-5.2 | day별 독립 처리 — LLM은 1회만, 솔버는 day별로 | P0 | D38 |
| FR-5.3 | 폴백 계단 구현 — LLM 실패→규칙점수, API 실패→캐시/직선거리, 전체 실패→최소 일정 | P0 | §7 |

---

## 2. 비기능 요구사항 (Non-Functional Requirements)

### NFR-1. 성능

| ID | 요구사항 | 기준 | 근거 |
|---|---|---|---|
| NFR-1.1 | C2 solve (day1) 응답 시간 | ≤ 3초 (5초 예산 중 네트워크 홉 제외) | D38, nfr §1.1 |
| NFR-1.2 | C1 LLM 호출 타임아웃 | 2.5초 (초과 시 폴백) | D11 |
| NFR-1.3 | 전체 일정 생성 | ≤ 20초 한계 | D38 |
| NFR-1.4 | AI 도우미 첫 응답 | 3초, 전체 15초 타임아웃 | nfr §1.1 |
| NFR-1.5 | Plan-B 대안 생성 | 10초 목표 | §5.2 |
| NFR-1.6 | 동시 일정 생성 처리 | 10건 | G142 |

### NFR-2. 신뢰성·복원력

| ID | 요구사항 | 기준 | 근거 |
|---|---|---|---|
| NFR-2.1 | 결정론적 폴백 | 동일 입력→동일 출력 (시드 고정, 무작위성 제거) | ADR-0011, INV-4 |
| NFR-2.2 | 침묵 실패 금지 | 모든 실패에 관찰 가능한 대체 경로 제공 | ADR-0011 |
| NFR-2.3 | 외부 호출 서킷 브레이커 | 전 외부 호출에 타임아웃 + 서킷 브레이커 | RESILIENCY-10 |
| NFR-2.4 | 웹 소싱 격리 | 웹 실패가 생성을 막지 않음 (보강 ≠ 의존) | AI-D03, INV-4 |
| NFR-2.5 | 라우터/워커 폴백 | 라우터 실패→기본의도, 워커 부분 실패→그 워커만 규칙 폴백 | AI-D02 |

### NFR-3. 보안

| ID | 요구사항 | 기준 | 근거 |
|---|---|---|---|
| NFR-3.1 | API 키 서버 보관 | Secrets Manager, 클라이언트 직접 호출 금지 | D11, SECURITY-11 |
| NFR-3.2 | 컨텍스트 권한 경계 | 서버 재조회로 타 계정 데이터 구조적 차단 (프롬프트 주입 우회 불가) | D31 |
| NFR-3.3 | LLM 입력 목적 최소화 | 필요한 필드만 주입, 내부 지표 미포함 | G181 |
| NFR-3.4 | rate-limit | 사용자별 호출 상한 (전역 레이트리미터 재사용) | nfr §3.2 |
| NFR-3.5 | 가드레일 | 역할 변경·지시 유출·유해 요청 거절 | ADR-0015 |

### NFR-4. 테스트 가능성

| ID | 요구사항 | 기준 | 근거 |
|---|---|---|---|
| NFR-4.1 | PBT 속성 12+ 전부 PR CI 통과 | 하드 제약·closed-set·결정론·상태머신 100% | G114, D37 |
| NFR-4.2 | 외부 의존 fake 교체 | Port 인터페이스로 격리, fake 주입 가능 | D37 Hexagonal |
| NFR-4.3 | oracle 이중 검증 | C2 소규모 인스턴스 무차별 대입 대조 | U5-P1 |
| NFR-4.4 | 시드 로깅·수축 | Hypothesis print_blob + shrinking | PBT-08 |
| NFR-4.5 | 실 LLM 회귀는 릴리스만 | PR CI에서 LLM 실 호출 0 | D37 |

### NFR-5. 관측·운영

| ID | 요구사항 | 기준 | 근거 |
|---|---|---|---|
| NFR-5.1 | LLM 비용 계측 | 호출당 토큰·비용 메트릭 | nfr §4 |
| NFR-5.2 | 외부 API 쿼터 알람 | 80% 도달 시 알람 | A11 |
| NFR-5.3 | 어댑터 실패율·서킷 상태 | 계측 + 대시보드 | A12 |
| NFR-5.4 | 폴백 발생률 계측 | 침묵 실패 계측 (isFallback 빈도) | nfr §4 |
| NFR-5.5 | 수집 게이트 격리율 | 격리/통과 비율 | AI-D03 |

### NFR-6. 확장성

| ID | 요구사항 | 기준 | 근거 |
|---|---|---|---|
| NFR-6.1 | 규모 가정 | DAU 1천 / 동시 10건 / 지역당 POI 5천 (과설계 금지) | G142 |
| NFR-6.2 | ML 도입 준비 | soft 신호 계층 + 규칙 폴백 존재 → ML 모델 스왑 가능 | AI-D05 |
| NFR-6.3 | LLM 벤더 교체 | Port 인터페이스로 격리, 소비 모듈 무영향 | D11 |
| NFR-6.4 | 워커 추가 | 라우터에 의도→워커 매핑 추가만으로 확장 | AI-D02 |

### NFR-7. LLMOps (2026-07-14 추가 — CONSTRUCTION U1에서 반영)

| ID | 요구사항 | 기준 | 근거 |
|---|---|---|---|
| NFR-7.1 | 관측 이벤트 타입 기반 | 모든 LLM 호출·폴백·게이트 드롭이 도메인 이벤트 타입(LlmCallRecord·FallbackEvent·GateDropEvent)으로 기록 가능 | NFR-5.1~5.4의 타입 선행 정의 |
| NFR-7.2 | 계측 발행 추상화 | TracePort로 계측 백엔드 격리 (테스트는 InMemoryTrace로 이벤트 검증) | NFR-4.2 확장 |
| NFR-7.3 | 프롬프트 버저닝 | 모든 LLM 호출 기록에 PromptRef(prompt_id, version) 포함. 프롬프트는 파일 + git 버전 관리 | 프롬프트 변경 → eval 회귀 연결 |
| NFR-7.4 | Eval 파이프라인 타입 기반 | EvalCase/EvalRun/EvalScore 도메인 타입 정의. 골든 데이터셋 회귀 eval 실행 가능 구조 | INV-1 환각률·솔버 통과율·폴백률 지표화 |

---

## 3. 아키텍처 제약 (4대 불변식)

| ID | 불변식 | 위반 = 재설계 | 검증 방법 |
|---|---|---|---|
| INV-1 | LLM은 closed-set 후보 안에서만 선택 | LLM이 후보 밖 POI ID 반환 | C1 출구 게이트 코드 + U5-P5 PBT |
| INV-2 | 사용자에게 보이는 시각·순서는 솔버 검증값만 | 라우터/워커가 시각을 직접 확정 | 편집 경로 수렴 + M16-P1 PBT |
| INV-3 | 소요시간 미표시 — 거리만 | DTO에 duration 필드 추가 | VisitSlotDisplay 타입 정적 보장 + U5-P4 |
| INV-4 | AI 실패 시 결정론 폴백 | LLM 타임아웃 시 빈 응답 반환 | 폴백 계단 + U5-P3 PBT |

---

## 4. 구현 우선순위 (1차 출시)

### Phase 1 — AI Core Foundation (P0)
- C2 Solver: 하드 제약 4종 + 휴리스틱 최적화 + 이동추정 + 결정론 폴백
- C1 Gate: closed-set 출구 게이트 + OutputSchema 검증
- M7 Core: POI 정본 + closed-set 후보 풀 생성
- Domain Models: Poi, ItineraryProblem/Solution, VisitSlot 등
- Ports: LlmPort, TravelPort, PlacesPort
- PBT: U5-P1~P6 + generators + oracle + fakes

### Phase 2 — LLM Integration (P0~P1)
- C1 Gateway: call() 구현, 티어 라우팅, 컨텍스트 주입
- PreferenceScoring 워커
- API Layer: HTTP 엔드포인트 (C1/C2/M7)
- 일정 생성 오케스트레이션 (score→solve 파이프라인)
- 폴백 계단 통합

### Phase 3 — Extended Features (P1~P2)
- 의도 라우팅 (INTENT) + 워커 디스패치
- 엔티티 해소 (fuzzy match)
- 웹 후보 소싱 + 수집 게이트
- Explanation·Reflection·Conversation 워커
- warm-start 재생성, repair
- Plan-B 재계획 지원 (사유 해석 + 후보 소싱)

---

## 5. Open Items (착수 시 확정 필요)

| # | 항목 | 현재 상태 | 영향 범위 |
|---|---|---|---|
| 1 | LLM 벤더·모델 (경량/상위) | 미확정 | C1 전체 |
| 2 | 솔버 라이브러리 (OR-Tools vs Timefold vs 자체) | 미확정 | C2 optimizer |
| 3 | AI 서비스↔Kotlin 백엔드 프로토콜 (REST/gRPC) | 미확정 | API Layer |
| 4 | Places API 벤더 + 약관 | 미확정 | M7 sourcing |
| 5 | 취향 7축 택소노미 | UX팀 협의 필요 | M13 스타일 분석 |
| 6 | fuzzy match 임계값 (자동확정/확인 컷) | 캘리브레이션 필요 | M7 엔티티 해소 |

---

## 6. Tool 구현 책임 분류

> 각 tool을 "직접 구현"해야 하는지 "LangChain이 대신하는지" 분류.

### LangChain이 해주는 부분 (설정·래핑 수준)

| Tool | LangChain 모듈 | 해야 할 일 |
|---|---|---|
| `llm.generate_reflection` | `langchain_aws.ChatBedrock` | 프롬프트 정의만. 호출·파싱·재시도·스트리밍은 LangChain 내장 |
| `llm.score_preferences` | `langchain_aws.ChatBedrock` | 프롬프트 정의만. 구조 동일 |
| `llm.select_alternatives` | `langchain_aws.ChatBedrock` | 프롬프트 정의만. 구조 동일 |
| `llm.explain_slot` | `langchain_aws.ChatBedrock` | 프롬프트 정의만. 구조 동일 |
| `llm.parse_intent` | `langchain_aws.ChatBedrock` | 프롬프트 정의만. 구조 동일 |
| `llm.analyze_style` | `langchain_aws.ChatBedrock` | 프롬프트 정의만. (추후 C 확장 시) |
| `kb.retrieve_schedule` | `langchain.retrievers` | Retriever 설정 + DB 쿼리 정의 |
| `kb.retrieve_persona` | `langchain_community.vectorstores.PGVector` | 벡터 스토어 연결 설정 + 메타데이터 필터 정의 |
| `kb.retrieve_situation` | `langchain.retrievers` | 실시간 API 래핑 (날씨·POI 상태) |
| 임베딩 생성 | `langchain_aws.BedrockEmbeddings` | 모델 ID 지정만 |

### 직접 구현해야 하는 부분

| Tool | 난이도 | 구현 내용 |
|---|---|---|
| `solver.solve` | **높음** | OR-Tools VRPTW 구현 — RoutingModel 생성, Time Windows 제약, 고정 블록, 목적함수(선호 점수), 시간 제한(3초) |
| `solver.validate` | 중간 | HC1~HC4 검증 순수 함수 구현 (영업시간·이동부등식·고정블록·시간창) |
| `solver.repair` | 중간 | 위반 배치 최소 수리 알고리즘 (시각·순서만 조정, POI 불변) |
| `m7.get_candidates` | 중간 | 6단계 필터 파이프라인 (반경→예산→영업→품질→인기→상한5000) |
| `m7.resolve_entity` | 중간 | fuzzy match 알고리즘 (edit-distance + 자모 유사), 신뢰도 분기 로직 |
| `m7.source_web` | 중간~높음 | Places API 어댑터 연동 + 수집 게이트 5단 검증 (스키마·실재·중복·신뢰·정책) |
| `db.get_visit_history` | 낮음 | DB 쿼리 함수 (방문 기록 조회, 통계 집계) |
| `db.get_current_schedule` | 낮음 | DB 쿼리 함수 (현재 일정 조회) |
| Orchestrator 라우팅 | 중간 | 의도 파악 + 복잡도 판단 + Fast Path/Delegate 분기 로직 |
| 에이전트 병렬 실행 | 낮음 | asyncio.gather 기반 병렬 디스패치 |
| 폴백 계단 | 중간 | 각 에이전트별 실패 분기 + FallbackCard 생성 |
| Bedrock Solver (2차) | 중간 | Bedrock에 배치 제안 요청 + 응답 파싱 + HC 검증 연결 |

### 프롬프트 (직접 작성, LangChain은 실행만)

| 프롬프트 | 대상 에이전트 | 내용 |
|---|---|---|
| 선호 점수 프롬프트 | ScheduleAgent | 후보 POI 목록 → 점수 JSON |
| 대안 선택 프롬프트 | PlanBAgent | 상황+후보 → 대안 A/B/C JSON |
| 회고 생성 프롬프트 | ReflectAgent | 방문 기록 → 회고 텍스트 JSON |
| 의도 파싱 프롬프트 | EditAgent | 자연어 → 편집 명령 JSON |
| 설명 생성 프롬프트 | ScheduleAgent | 배치 결과 → 추천 이유 텍스트 |
| 스타일 분류 프롬프트 | ReflectAgent (추후) | 방문 이력 → 7축 분류 JSON |

### 요약

| 구분 | 항목 수 | 비고 |
|---|---|---|
| LangChain이 해줌 (설정·래핑) | 10개 | LLM 호출 + 벡터 검색 + 임베딩 |
| 직접 구현 (비즈니스 로직) | 12개 | 솔버·필터·검증·라우팅·폴백 |
| 프롬프트 작성 | 6개 | LangChain이 실행하지만 내용은 직접 |
