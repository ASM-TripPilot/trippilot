# AI 담당 Epic · Story 백로그

> 기준: `unit-of-work.md`(U1~U6) + 2026-07-16 심화 설계 6종(application-design/)의 신규 작업을 스토리로 반영.
> 상태 기준일: 2026-07-21. 현재 위치 — **CONSTRUCTION, U1 Functional Design 산출물 승인 대기**.
> 표기: ✅ 완료 · 🔄 진행 중 · ⬜ 대기 · **🔑 실 API 승인 후** — LLM API 결제 승인 전에는 착수 불가(또는 fake로 개발 후 실검증만 보류). 스토리 ID는 `S{에픽}.{번호}`.
>
> **🔑 원칙**: D37(CI 실 API 호출 0) + Port 격리 덕분에 U1~U5 전체는 실 API 없이 완성 가능. 🔑 표시는 "실모델 검증" 부분만이며, 해당 스토리의 로직 개발은 fake로 선행한다. 상세 → §승인 후 작업 모음.

---

## 에픽 전체 지도

| Epic | 이름 | 유래 | 소요 | 상태 | 의존 |
|---|---|---|---|---|---|
| EP-1 | Domain & Ports | U1 | 2~3일 | 🔄 FD 승인 대기 | — |
| EP-2 | C2 Assembly Core | U2 | 5~7일 | ⬜ | EP-1 |
| EP-3 | M7 Place Data Core | U3 | 3~5일 | ⬜ | EP-1 |
| EP-4 | C1 LLM Gateway | U4 | 4~5일 | ⬜ | EP-1, EP-3 |
| EP-5 | Orchestration & API | U5 | 3~4일 | ⬜ | EP-2·3·4 |
| EP-6 | Extended Features (RAG·소싱·워커) | U6 | 5~7일 | ⬜ | EP-5 |
| EP-7 | **정보 에이전트 계층** (신규) | agent-hierarchy-design | 3~5일 | ⬜ | 1차: EP-3 / 2차: EP-6 |
| EP-8 | **의도 파악 하이브리드** (신규) | intent-matching-design | 2~3일 | ⬜ | EP-4 (pgvector는 EP-6과 공유) |
| EP-9 | **평가지표 · Ops 파이프라인** (신규) | evaluation-metrics + mlops-llmops | 2~3일 | ⬜ | 타입은 EP-1, 집계는 EP-5 |

**합계**: 기존 22~31일 + 신규 7~11일 ≈ **29~42일** (1인 기준)

```
EP-1 ──┬── EP-2 ──┐
       ├── EP-3 ──┼── EP-5 ──┬── EP-6 ── EP-7(2차: Persona·Transit)
       └── EP-4 ──┘          ├── EP-7(1차: PlaceScout·Weather)
                             └── EP-8, EP-9(집계)
(EP-9의 타입·로그 스키마는 EP-1에 선반영 — S1.5·S1.6)
```

---

## EP-1. Domain & Ports (U1) — 🔄 진행 중

> **지금 할 일**: functional-design 산출물 3종 승인 → NFR Requirements(경량) → Code Generation

| ID | Story | 완료 조건 | 상태 |
|---|---|---|---|
| S1.1 | 도메인 dataclass 전체 (poi·itinerary·travel·trigger·edit, frozen) | 직렬화 왕복 PBT(U5-P10) 통과 | ⬜ (FD 완료) |
| S1.2 | Port Protocol 7종 + Fake 7종 (FakeLlm·FakeTravel·InMemoryPoi·InMemoryTrace 등). **FakeLlm은 3모드 필수** — golden(시나리오별 정답 JSON 재생) / timeout(2.5s 폴백 경로) / violation(스키마 위반·화이트리스트 밖 poi_id → 게이트 검증). FakeEmbedding은 결정론 해시 벡터 | 모든 Port에 fake 존재, CI 실 API 0 (D37). 3모드로 폴백 계단·게이트 전 경로 테스트 가능 | ⬜ (FD 완료) |
| S1.3 | Hypothesis generators | 유효 인스턴스 생성 확인 | ⬜ (FD 완료) |
| S1.4 | LLMOps 타입 — LlmCallRecord·FallbackEvent·GateDropEvent·TracePort·PromptRef·Eval 3종 | NFR-7.1~7.4 충족 | ⬜ (FD 반영됨) |
| S1.5 | **(신규)** 위임 봉투 타입 — AgentTask·AgentResult·ContextRef·TaskConstraints·RequestMeta | orchestrator-delegation-design.md §2·3 스키마와 일치, deadline 상속 속성(SPEED-P1) generator 포함 | ⬜ |
| S1.6 | **(신규)** FreshnessMeta + 정보 에이전트 I/O 타입 (PlaceScoutResponse·DailyWeather·TransitInfo·PersonaContext) | agent-io-contracts.md §5와 일치. TransitInfo Display 계열에 duration 부재 정적 확인 (INV-3) | ⬜ |
| S1.7 | **(신규)** 학습 로그 6종 스키마 타입 (preference_feedback·dwell_actual·travel_actual·alternative_choice·trigger_response·intent_resolution) | mlops-llmops-design.md §2.2와 일치 — Phase L "로깅 먼저" | ⬜ |

---

## EP-2. C2 Assembly Core (U2)

| ID | Story | 완료 조건 |
|---|---|---|
| S2.1 | ConstraintChecker — HC1~HC4 순수 함수 4종 | U5-P1 (HC PBT + oracle) 100% |
| S2.2 | OR-Tools VRPTW Optimizer (3초 제한, 결정론) | U5-P3 (동일 입력→동일 출력), day1 ≤ 3초(후보 50개) |
| S2.3 | TravelEstimator 어댑터 체인 (카카오→네이버→직선×1.3) | U5-P4 (결정성 + INV-3) |
| S2.4 | FallbackScorer (규칙 점수) + MINIMAL 모드 | INV-4 — 어떤 입력에도 해 반환 |
| S2.5 | RepairEngine (최소 변경 수리) + warm-start 재생성 | U5-P2 (warm-start 멱등) |
| S2.6 🔑 | Bedrock 2차 어셈블리 (LangChain) + HC 검증·수리 경유 — 체인 연결·HC 검증은 fake로 개발, **실모델 배치 품질 실험만 승인 후** | Bedrock 출력이 검증 없이 반환되는 경로 0 (INV-2). U2 완성 자체는 1차 OR-Tools + 규칙 폴백만으로 가능 |

---

## EP-3. M7 Place Data Core (U3)

| ID | Story | 완료 조건 |
|---|---|---|
| S3.1 | CandidatePoolBuilder — 6단계 필터 (반경→예산→영업→품질→인기→상한 5천) | 필터별 단위 테스트 + frozenset O(1) 멤버십 |
| S3.2 | PoiRepository (CRUD + 공간 쿼리, InMemory fake 우선) | U1 Port 계약 준수 |
| S3.3 | EntityResolver — 결정론 fuzzy match (edit-distance + 자모) | RES-P1 (결정론) |
| S3.4 | 캐싱 — POI 24h · 영업시간 6h · **가격 캐싱 금지** | TTL 정책 테스트 + FreshnessMeta 원천 시각 기록 (EP-9 연계) |

---

## EP-4. C1 LLM Gateway (U4)

| ID | Story | 완료 조건 |
|---|---|---|
| S4.1 🔑 | GatewayFacade — LLM 호출 + 타임아웃 2.5s + FallbackSignal. 게이트웨이 로직·폴백은 FakeLlm 3모드로 완성, **실 벤더 어댑터(ChatBedrock/ChatAnthropic) 연결·스모크만 승인 후** | 타임아웃 시 is_fallback=true 발행 (fake 기반 검증 가능) |
| S4.2 | ClosedSetGate — OutputSchema 파싱 + poi_id ∈ 화이트리스트 | U5-P5 (환각 0 PBT) 100% |
| S4.3 | TierRouter (feature → 경량/상위 모델) | 매핑 테이블 테스트 |
| S4.4 | ContextResolver — 요청자 권한 재조회 (D31) | 권한 밖 참조 → PermissionDenied |
| S4.5 | PreferenceScoringWorker + 규칙 점수 폴백 | 전 일자 1회 호출 정책 |
| S4.6 | **(신규)** 프롬프트 레지스트리 — `prompts/{feature}/{version}.yaml` + 전 호출 version 강제 | 로그에서 prompt_version 조인 가능 (mlops §1.2) |

---

## EP-5. Orchestration & API (U5)

| ID | Story | 완료 조건 |
|---|---|---|
| S5.1 | Orchestrator 3모드 (Fast Path / Delegate / Fallback) + 복잡도 판단 | Fast Path p95 ≤ 500ms (LLM 0회) |
| S5.2 | **(개정)** ExecutionPlan + AgentTask 봉투 발행·회신 — context_refs 참조 전달, deadline 상속, trace_id 전 구간 전파, PARTIAL 조립 | delegation-design §4 시퀀스 재현, SPEED-P1 통과 |
| S5.3 | ScheduleAgent end-to-end (후보→점수→어셈블리→설명) + 폴백 계단 | fake 기반 E2E, 폴백 전 단계 트리거 가능 |
| S5.4 | day1 우선 반환 (5초, 독립 TX) + 전체 20초 타임아웃 | 지연 예산 SLO 계측과 연동 |
| S5.5 | FastAPI 엔드포인트 + 스키마 검증 + rate-limit + 헬스체크 | Kotlin 연동 가능 계약 (agent-io-contracts 기준) |

---

## EP-6. Extended Features (U6)

| ID | Story | 완료 조건 |
|---|---|---|
| S6.1 | PlanBAgent RAG 파이프라인 (LangChain RetrievalQA + PGVector + 로컬 임베딩). ~~Titan 재색인 보류~~ → **AI-D06으로 임베딩이 로컬 오픈소스가 되어 승인 불요 — 실벡터 색인까지 즉시 가능** (Generate 단계의 LLM 호출만 FakeLlm) | Retrieve→Augment→Generate→Validate, 대안 병렬 솔브, 10초 예산 |
| S6.2 | ReflectAgent 1차 (DB 조회 + Bedrock 1회 + FallbackCard) | 0건→스킵, LLM 실패→통계 카드 (INV-4) |
| S6.3 | EditAgent (parse_intent→엔티티 해소→검증→apply_mode 결정) | M16-P1~P3 통과, 파괴적 편집 확인 강제 |
| S6.4 | 웹 소싱 + 수집 게이트 5단 (비동기) | SRC-P1~P3 통과, 게이트 미통과 POI 후보화 0 (INV-1) |
| S6.5 | ~~KB retrieve 3종 (schedule·persona·situation)~~ → **PlanBAgent 전속 도구 2종 — `kb.retrieve_schedule` + `llm.select_alternatives`. persona·situation 정보는 Provider→InfoBundle 봉투 수령** (2026-08-11 TRIP-332 — agent-structure-v2 정본 채택, 도구 겹침 0 원칙) | ~~PlanB E2E에서 KB 3종 조립 확인~~ → **PlanB E2E에서 전속 도구 2종 + InfoBundle 조립 확인.** KB-2·KB-3의 봉투 전환은 InfoBundle 배선 후속 작업 — 그때까지 현행 retrieve 3종 구현 유지 (planb-rag-design 개정 기록 참조) |

---

## EP-7. 정보 에이전트 계층 (신규 — agent-hierarchy-design.md)

| ID | Story | 완료 조건 | 차수 |
|---|---|---|---|
| S7.1 | PlaceScoutAgent — M7 래핑 + 충분성 판단 + 웹소싱 발동 판단 + NO_CANDIDATES 상태값 | ScheduleAgent·PlanBAgent가 m7.* 직접 호출 제거, INV-1 관문 단일화 | 1차 (EP-5와 함께) |
| S7.2 | WeatherAgent — 기상청 어댑터 + 일 단위 사전 조회·캐시 + 강수 80% 트리거 판정 + stale 폴백 | FreshnessMeta 필수, WEATHER_UNKNOWN에도 파이프라인 진행 (INV-4) | 1차 |
| S7.3 | TransitAgent — TravelEstimatePort 공유 + 지연 30분+ 판정 + Fast Path 거리 응답 | Display 응답에 duration 부재 (INV-3), C2 경계 준수 | 2차 |
| S7.4 | PersonaAgent — KB-2 + pgvector 검색 + 거절 이력 + COLD_START | PlanB S6.1·Schedule 점수 컨텍스트가 동일 경로 사용 | 2차 (EP-6 후) |
| S7.5 | EventAgent — 인터페이스만 정의 (구현 유예) | EventRequest/EventInfo 타입 + 스텁 | P2 |

---

## EP-8. 의도 파악 하이브리드 (신규 — intent-matching-design.md)

| ID | Story | 완료 조건 |
|---|---|---|
| S8.1 | 질문뱅크 스키마(pgvector) + seed 대표질문 수기 작성 (13의도 × ~8개) + **로컬 임베딩 실벡터 색인 (AI-D06 — 승인 불요, 즉시 가능)** | 의도 간 유사도 ≥0.90 중복 없음 (위생 규칙, 실벡터 기준) |
| S8.2 | `intent.match_bank` — 임베딩 top-k + T_high/T_mid 판정 (1차 경로) | CONFIDENT 경로 p95 ≤ 100ms, LLM 0회 |
| S8.3 | `llm.paraphrase_query` + 가중 투표 (2차) + parse_intent 연결 (3차) | 3초 예산 내 전 경로 수렴 |
| S8.4 | 오프라인 평가셋 + CI 게이트 + 오분류 마이닝 로그 | accuracy 회귀 시 머지 차단, intent_resolution 로그 적재 (S1.7) |
| S8.5 🔑 | LLM 증강 변형 생성 + 검수 절차 (500~1,000개) — **생성 자체가 실 LLM 필요, 전체 승인 후** | 검수 통과분만 편입 |

---

## EP-9. 평가지표 · Ops 파이프라인 (신규 — evaluation-metrics + mlops-llmops)

| ID | Story | 완료 조건 |
|---|---|---|
| S9.1 | LLM 호출 전량 구조화 로깅 (trace_id·prompt_version·tokens·latency·is_fallback) + 어셈블리 로그 | 요청 1건의 전체 호출 트리 복원 가능 |
| S9.2 | 최신성 집계 — F1(도메인별 age/TTL) + F2 체크리스트(CUR-1~6, CUR-2·4는 hard 승격) | stale_serve_rate < 5% 측정 가능 |
| S9.3 | 신속도 집계 — 업무별 SLO + budget_burn + stage_breakdown | day1 5s / 전체 20s / Plan-B 10s 위반율 대시보드 |
| S9.4 | 신규 PBT 5속성 (FRESH-P1·P2, CUR-P1·P2, SPEED-P1) CI 편입 | 기존 19속성 + 5 = 24속성 통과 |
| S9.5 | 학습 로그 6종 적재 경로 (Phase L — 모델 없음, 스키마만 가동) | 사용자 행동이 자동 라벨로 쌓이는 것 확인 |
| S9.6 | 비용·쿼터 — feature별 토큰 집계 + 상한 서킷 | ai-cost-estimation 추정 대비 실측 비교 가능 |

---

## 🔑 승인 후 작업 모음 (실 LLM API 필요 — 결제 승인 시 일괄 실행)

> LLM API 결제 승인 전에는 아래만 보류된다. **나머지 전체 백로그는 fake 기반으로 진행 가능** (D37 + Port 격리가 이 상황을 전제로 설계됨).
> 승인이 나오면 "실검증 스프린트" 1회(2~3일)로 일괄 소화한다.

| # | 작업 | 연결 스토리 | 승인 전 준비 (지금 가능) |
|---|---|---|---|
| K-1 | 실 벤더 어댑터 연결 + 스모크 — **`ChatAnthropic`/anthropic SDK로 확정 (AI-D06)**. 티어: 경량 haiku-4-5 / 상위 sonnet-5 / 오프라인 opus-4-8 | S4.1 | LlmPort 뒤 어댑터 자리만 마련, model_id는 설정값으로 |
| K-2 | 프롬프트 6종 실모델 튜닝 (score/explain/select/reflect/parse/paraphrase) | S4.6, EP-6 | 프롬프트 yaml 전부 작성 + golden 기대응답 정의 (FakeLlm golden 모드와 공유) |
| ~~K-3~~ | ~~실벡터 일괄 재색인~~ → **해소 (AI-D06)**: 임베딩이 로컬 오픈소스(multilingual-e5-large/BGE-M3, 1024차원)로 확정되어 **승인 없이 즉시 가능**. S6.1·S8.1 본문으로 이동 | S6.1, S8.1 | — |
| K-4 | 질문뱅크 LLM 증강 (500~1,000개) + 검수 | S8.5 | seed 수기 작성 + 검수 절차 문서화 |
| K-5 | LLM 2차 어셈블리 실모델 배치 품질 실험 (Anthropic API 경유) | S2.6 | 체인·HC 검증 연결은 fake로 완성 (실험은 품질 비교만) |
| K-6 | LLM-as-judge 평가 배치 (L3) | EP-9 | 채점 프롬프트 작성 + 평가셋 구축 |
| K-7 | 비용 실측 (ai-cost-estimation 추정 대비) | S9.6 | 토큰 집계 계측 코드 선행 (fake 호출에도 동작) |

**승인 전 병행 태스크**: K-2·K-4·K-6의 "작성" 부분(프롬프트 yaml, seed 질문, 채점 기준)은 API 없이 지금 할 수 있는 작업이므로 대기 시간에 소화할 것.

---

## 스프린트 제안 (1인, 주 단위)

| 주차 | 목표 | 에픽/스토리 |
|---|---|---|
| **W1 (지금)** | U1 승인 → 코드 생성 완료 | EP-1 전체 (S1.5~S1.7 신규 타입 포함) |
| W2~W3 | 코어 3종 병렬 (Port로만 참조하므로 순서 자유) | EP-2 → EP-3 → EP-4 (+S4.6) |
| W4 | 통합 + 1차 정보 에이전트 | EP-5 + S7.1·S7.2 + S9.1 |
| W5~W6 | 확장 기능 | EP-6 + S7.3·S7.4 + EP-8 |
| W7 | 지표·Ops 마감 + 안정화 | EP-9 잔여 + 24속성 CI 완성 |

**주의 — 순서 원칙**: S1.5~S1.7(신규 타입)을 U1에 넣지 않으면 U5·U7·U9에서 재작업이 난다 (U1 FD가 LLMOps 타입을 선반영한 것과 같은 이유). U1 승인 전에 이 3개 스토리의 FD 반영 여부를 결정할 것.
