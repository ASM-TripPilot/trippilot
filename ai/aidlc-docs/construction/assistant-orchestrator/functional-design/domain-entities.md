# 도우미 오케스트레이터 (assistant-orchestrator) — 도메인 엔티티 (FD **초안**, 2026-10-17)

> **초안이다.** 승인 게이트(PR 리뷰) 전이고, 정본을 **수정하지 않는다** — 필요한 개정은 business-rules §4 에
> 목록으로만 올린다. 구현(spec-kit 구현 스텝 `ai/specs/001-assistant-orchestrator/tasks.md`)은 이 FD 와 **같은 PR** 에 실린다 —
> 코드가 FD 초판과 달라진 자리는 본문에 코드 현행으로 반영했다(§2.6 dataclass 위치 · §2.6 `due`/`compress_fallback` 시그니처 · §2.10 요약 max_tokens).
>
> **유닛 번호를 붙이지 않는다.** 모노레포 정본은 이 영역을 **U8 Conversational Assistant** 라 부르고 ai 패키지
> 정본(`ai/aidlc-docs/inception/units/unit-of-work.md`)은 U1~U6 까지만 쓴다 — 번호가 충돌하면 이름으로 적는
> 팀 규칙(`docs/conventions/anti-patterns.md` §설계·문서). `assistant-dialogue`·`agent-foundation` 과 같은 표기다.
>
> **설계의 단일 출처는 설계 브리프(2026-10-17)** 다 — 사용자 결정 원문 요지는 business-logic-model §0 에 옮겨 적었다.
> 사실 근거는 조사 보고 8편(ai-intent-gateway · ai-agents-providers · ai-api-tests · ai-db-observability-deploy ·
> be-assistant · fe-assistant · design-canon · eval-shadow)이고, 아래 §0 의 `파일:줄` 은 전부 작업 트리
> **origin/develop 3dc23b4b** 기준이다. 노트와 코드가 다르면 코드가 정본이다.
>
> 근거 정본: 모노레포 U8 FD 3종 + NFR(`aidlc/aidlc-docs/construction/u8-conversational-assistant/`) ·
> `assistant-dialogue` FD(`ARGUMENT_TABLE`·`IntentFrame`·`DialogueContext`·BR-DLG) · `agent-foundation` FD(봉투·L-1~L-6·BR-AF) ·
> `intent-matching-design.md`(3단 파이프라인 — 이 FD 에서 **섀도 측정 전용**이 된다) · `orchestrator-delegation-design.md`
> (§5 라우팅 표·DL-1~5) · `agent-structure-v2.md`(Provider LLM 0회) · `ai-prompt-design.md` §3.3(프롬프트 레이아웃·semver) ·
> `ai/README.md` §4대 불변식.
>
> 범위: **1단계(이 PR)** — 조회·대안·안내 의도를 AI 안에서 `ANSWER` 로 끝내고, `EDIT_SCHEDULE` 은 `FRAME` 으로 두어
> 백엔드 제안 경로를 그대로 쓴다. 2단계(EDIT 인프로세스·`PROPOSAL`)는 §9 에 예고만 한다.

---

## 0. 지금 있는 것 / 없는 것 — 실측 (2026-10-17, 3dc23b4b)

이 표가 이 FD 의 출발선이다. **"설계에 있다"와 "코드에 있다"를 섞지 않는다.** 경로 약어 — `A` =
`backend/modules/assistant/src/main/kotlin/com/trippilot/assistant`, `AT` = 같은 모듈 `src/test/...`,
`IG` = `backend/modules/itinerary-generation/src/main/kotlin/com/trippilot/itinerarygeneration`,
`APP` = `backend/app`, `FE` = `frontend/src/pages/assistant/assistant-sheet`.

### 0.1 AI — 대화 경계와 해석기

| | 상태 | 위치 |
|---|---|---|
| 대화 경계 `POST /ai/v1/dialogue/interpret` | **실재 · 백엔드가 http 모드에서 실제로 부른다**(U8-INTERPRET-HTTP done) | `ai/src/trippilot/api/routes.py:457-471` · `api/dialogue.py:32-67`(사영) · `A/adapter/out/interpret/HttpDialogueInterpreter.kt:55`(PATH) |
| `DialogueInterpreter.interpret(utterance, context, trip, trace_id, now)` | **실재.** `pending` 있으면 `_answer`(되묻기 답 읽기) 먼저, 아니면 `router.route` → `_from_match`(missing·CLARIFY 계산). **deadline 인자가 없다** | `ai/src/trippilot/orchestrator/dialogue_interpreter.py:293-320` |
| `IntentRouter.route` 3단(뱅크 임베딩 → PARAPHRASE 투표 → INTENT LLM) | **실재.** `_route` = normalize → 빈/500자 초과 거절 → `bank_ready` 거짓이면 `_llm_direct(text, "bank_not_ready")` → … ; `_llm_direct`·`_classify` 는 **private**; INTENT 호출에 `timeout_sec` 를 넘기지 않아 `C1Config.timeout_sec` 10s 가 상한 | `orchestrator/intent_router.py:232-274, 360-407` · `llm_gateway/gateway.py:139` · `llm_gateway/config.py:268` |
| `CountingLlm` | **실재.** contextvar `_llm_calls`(기본 None) 에 걸린 카운터에만 +1(실패 호출도 셈); `interpret()` 이 `[0]` 을 set/reset. **스레드로 전파되지 않는다** — `api/cost.py` 가 같은 이유로 contextvar 대신 trace_id 키를 택했다 | `orchestrator/dialogue_interpreter.py:65-84, 306-320` · `api/cost.py:34-38` |
| wiring 조립 | `counted = CountingLlm(llm)` **하나**를 INTENT·PARAPHRASE 두 `GatewayFacade` 에 함께 넣고 `IntentRouter(embedding or UnwiredEmbedding(), bank_store, ..., bank_ready=lambda: bank_index.indexed)` → `DialogueInterpreter(router, bank_index)` → `dialogue=`; `WiredItineraryOrchestrator.dialogue_interpret` 은 위임 한 줄 | `ai/src/trippilot/api/wiring.py:3839-3861, 3539-3545` |
| 요청 스키마 `DialogueInterpretRequest` | `request_meta` · `utterance`(1..500) · `dialogue_context: dict\|None` · `context: DialogueContextSnapshot{surface, trip?{trip_id, regions, start_date, end_date, phase}, base_stays: list[str], itinerary?{status, days[{date, slots[{slot_key, name?, start_at, category?}]}]}}`. **세션·계정 식별자 없음. 슬롯에 `end_at`·`is_fixed`·좌표·`poi_id` 없음. `base_stays` 는 이름뿐(좌표 없음)** | `ai/src/trippilot/api/schemas.py:880-929` |
| 응답 스키마 `DialogueInterpretResponse` | `outcome: str`(FRAME\|ARGUMENT_CLARIFY\|OUT_OF_SCOPE — **평문 str, Literal 아님**) · `frames[{intent, arguments, missing, confidence, match_route}]` · `clarify?` · `dialogue_context: dict` · `llm_calls ≥0` | `schemas.py:932-953` |
| `extra=forbid` | `BoundaryModel` 전역 — **요청·응답 모두** `additionalProperties:false` | `schemas.py:14-16, 31-34` |
| `request_meta.deadline_ms` 의 흐름 | 미들웨어 백스톱(`deadline+5000` → 504)으로만 흐른다. **대화 경로는 핸들러에서 deadline 을 읽지 않는다** | `api/middleware.py:97-104, 485-557` · `api/dialogue.py:37-47` |
| `_deadline_budget(meta)` | 다른 경계가 쓰는 "deadline_ms 또는 600_000" 헬퍼 — 재사용 대상 | `api/wiring.py:294-296, 3906` |
| 되묻기 문안 | `CLARIFY_QUESTIONS` 고정 문안(인자표) — LLM 이 짓지 않는다 | `schemas.py:944` 주석 · `orchestrator/dialogue_interpreter.py` |
| `Agent.handle(AgentTask)` 봉투 | **미구현(넷 다).** `AgentTask` 생산처 0 · `spawn` 호출자 0 · `ExecutionPlan` 소비자 0; 출력 변환기 `agents/*/envelope.py` 4종만 실재(호출자는 테스트) | `ai/src/trippilot/agents/base.py:15-16` · grep |
| 아키텍처 테스트 | orchestrator → agents·providers·poi_curation·assembly_engine·`ports.llm_port` import **허용**(선례 `schedule_coordinator.py:41-74`); agents → orchestrator·providers·LlmPort **금지**(L-3/4/6); yaml 은 `llm_gateway/prompts.py` 한정; 벤더 SDK 는 `adapters/` 한정; **하위 계층(domain·ports·llm_gateway·assembly_engine·poi_curation) → orchestrator import 금지(L-1)**. 스레드·동시성 규칙 없음 | `ai/tests/test_architecture.py:46-322` |

### 0.2 AI — Provider·에이전트·게이트웨이

| | 상태 | 위치 |
|---|---|---|
| `InfoCollector.collect(intent, params, *, only)` | **순차 for 루프, 시한 인자 없음**("병렬 수집은 후속"). 미등록 Provider 는 건너뛰고 Provider 예외는 UNAVAILABLE 패킷(PermissionDeniedError 만 관통) | `ai/src/trippilot/orchestrator/info_collector.py:181-234` |
| `INFO_REQUIREMENTS` | 11행. `GET_NEXT_SLOT`·`SHOW_SCHEDULE` = `()` ("백엔드 DB 조회" 주석), `GET_WEATHER=(WEATHER,)`, `GET_DISTANCE=(TRANSIT,)` — 호출측이 `purpose=INFO_DISPLAY`·`mode` 기본값을 채워야 한다. **`GET_POI_INFO` 무행 → `UnknownIntentError`**(PlaceProvider 가 풀 조립기라 단건 조회에 안 맞는다는 이유) | `info_collector.py:39-128, 131-138` |
| `PlaceProvider.fetch/resolve` | 풀을 `uuid` 키로 OrderedDict(상한 64)에 넣고 `pool_ref` 를 돌려준다; **`resolve` 는 `pop` — 한 번만 꺼낼 수 있다**, 잠금 없음 | `ai/src/trippilot/providers/place.py:34-89` |
| `WeatherProvider` | params `anchor: GeoPoint`·`days`·`now` → `{daily:{iso:pop}, hourly:{iso:pop}, triggers}` / 실패 `WEATHER_UNKNOWN`. **좌표가 필요하다** | `providers/weather.py:29-95` |
| `TransitProvider` | params `origin`·`destination`·`mode`·`now`·`purpose` → `TransitInfo.to_dict()`(공개 `to_public_dict` 는 `distance_m`·`distance_range` 만, `internal_minutes` 제외 — INV-3) / 실패 `UNAVAILABLE` | `providers/transit.py:53-169` · `domain/transit.py:116-175` |
| `PersonaProvider` | prod 는 `StaticPersonaStore`(빈 페르소나) — 실 취향은 요청 인라인 `preference_profile`(AI-D09) 인데 **대화 요청에는 그 칸이 없다** | `api/wiring.py:3952-3962, 4089-4094` · `ai/main.py`(context_store 미주입) |
| `PlanBAgent.run(PlanBRagRequest)` | 필수 `trigger`·`reason`·`pool`·`trace_id`·`now`; 선택 `excluded_poi_ids`·`current_slot_ids`·`deadline_ms`·`rain_prob_by_date`·`persona`·`use_llm`. **`use_llm=False` 또는 워커 미주입이면 규칙 랭킹**(우천 강등 → 저장 장소 → 앵커 거리). 결과 `alternatives`(시각 필드 없음) | `ai/src/trippilot/agents/planb/rag.py:132-145, 180-242, 245-251, 367` |
| `EditTask` | 필수 `solution`(`VisitSlot` 은 `start_at<end_at` 강제 → `end_at` 필요)·`pool`·`poi_index`·`transport`·`deadline_ms`, `is_fixed` 닻 판정 — **스냅샷(`start_at`·`name`·`category`·`slot_key`)으로는 정직하게 못 만든다** | `agents/edit/agent.py:84-108` · `domain/itinerary.py:159-176` · `api/wiring.py:926-950` |
| 백엔드 /edit 재호출 경로 | `ReplaceSlot`(LLM 0회)도 `scheduleAgent.proposeEdit`(`/ai/v1/itinerary/edit`)를 반드시 거친다 — AI 재호출 없이 제안을 만드는 길은 없다; `ProposalCards.proposed` 가 ground·fingerprint·diff | `IG/application/EditProposalService.kt:75-116` · `IG/adapter/out/external/HttpScheduleAgentAdapter.kt:264-314` · `A/application/ProposalCards.kt` |
| `PoiDbPort` 와 prod 어댑터 | 포트는 6메서드 선언이지만 `BackendPoiDb` 는 `find_by_radius`·`find_by_ids`·`lookup_by_ids` 셋만 구현(`get_open_window`·`batch_check_closed` 없음). 배치 상한 200. **read-only Protocol — 쓰기 추가 금지** | `ai/src/trippilot/ports/poi_db_port.py:1-5, 61-71` · `poi_curation/adapters/backend_poi_db.py:48-54, 162-204` |
| 영업시간·입장료 부품 | `Poi.open_hours`(백엔드 원문을 파서로 읽음, 보유율 47.3%) + `composition.hours_label(poi, weekday) -> str\|None`; `FeeTable.of(source_ref) -> int\|None`(0=무료·None=불명), `load_fee_table()` | `poi_curation/adapters/backend_poi_db.py:12-17` · `agents/planb/composition.py:95` · `poi_curation/place_fees.py:36-92` |
| 팬아웃 선례 `measure_within` | **프로세스 공유** `ThreadPoolExecutor(8, "route-budget")`; 마감을 **submit 전에** 잡고 `wait(timeout)` 뒤 pending `cancel`, done 의 예외는 벤더 실패로 셈, 결과를 버리지 않음. 주석: 요청마다 풀을 만들면 N×8 호출·submit 지연 | `ai/src/trippilot/api/route_budget.py:29-35, 85-124` |
| 배경 submit 선례 `_NL_POOL` | `ThreadPoolExecutor(8, "nl-extract")` — 추출 LLM 을 배경으로 띄워 Future 로 받음(#1225) | `api/wiring.py:1524, 2633-2650` |
| `GatewayFacade.call(feature, prompt_vars, pool, trace_id, now, *, timeout_sec, retry_timeout_sec, ...)` | 게이트 1개 = 인스턴스 1개. `timeout_sec` None → `C1Config.timeout_sec`(10s). 벤더·게이트 실패는 `TypedResult(is_fallback=True)`+`FallbackEvent`; **feature 밖·변수 누락은 ValueError(폴백 아님)** | `llm_gateway/gateway.py:69-107, 124-196` |
| 프롬프트 레지스트리 | `string.Template` 치환만(조건부·반복 없음), 변수 전부 str, 누락 ValueError, **feature 당 yaml 1개(중복 ValueError)**, `inline()` 로 제3자 문자열 한 줄 압축 | `llm_gateway/prompts.py:22-46, 56-107` |
| `prompts/intent.yaml` | feature INTENT · version `"0.2.0"` · 변수 `$utterance`·`$intents` 둘뿐; 헤더가 "히스토리·일정 요약 주입은 라우터 배선 확장 선행 — 후속 티켓" | `ai/prompts/intent.yaml:26-56` |
| 재생 픽스처 `tests/fixtures/intent_gate` | llm.jsonl 61건(INTENT 26 · PARAPHRASE 35) · embeddings 784 · meta(baseline 85/87). 재생 키 = `sha256(model_id\nprompt_id@version\n렌더 전문)` → **intent.yaml 한 글자·변수 하나만 바뀌어도 전건 미스** | `ai/tests/fakes/replay_fixtures.py:60-72` · `tests/orchestrator/test_intent_eval_gate.py:109-134` |
| `IntentGate.apply(raw, pool, *, feature, trace_id, now)` | `intent` 키 필수, null → `parse_error: not_classifiable`(폴백 신호), enum 밖 라벨 전량 드롭, 표 밖 인자 키는 그 칸만 드롭(GateDropEvent). **feature 는 인자로만 받는다 → 새 feature 에 그대로 끼울 수 있다** | `llm_gateway/gates/intent.py:57-186` |
| 사용자 노출 문장 게이트 선례 `ReflectionNudgeGate` | `{"message": str}` → str; 빈·60자 초과·`_TIME_EXPR`(INV-3)·`has_contact_like` 드롭 + `gate_dropped_all`; 폴백 문구는 워커 모듈 상수 | `llm_gateway/gates/reflection_nudge.py:40-88` · `gates/base.py:96-121` · `gates/reflection_template.py`(`_TIME_EXPR`) |
| 배열형 게이트 선례 `ParaphraseGate` | `{"questions":[str]}` → tuple, 항목 격리·중복 제거·상한 8·빈 결과 실패(`empty_result_error`) | `gates/paraphrase.py:35-86` |
| 새 `LlmFeature` 한 세트 | `LlmFeature` 20종 enum + `default_tier_map`(전 feature 스윕 테스트) + `default_fallback_modes`(+테스트 `_EXPECTED_MODES` 키 집합 == enum) + (`default_feature_effort`/`max_tokens`) + `.env.example` 배정 + Secrets Manager 값. env **키** 자체는 늘지 않는다 | `ai/src/trippilot/domain/llm.py:29-96` · `llm_gateway/config.py:17-222` · `tests/llm_gateway/test_llm_gateway_gateway.py:249-254, 288-343` · `.env.example:183-202` |
| `intent_eval` | `Sample(label, utterance, match, latency_ms)` · `score() -> EvalReport` · `format_report()` 순수 함수; `is_refusal`(표지 `not_classifiable`·`intent_not_routable`·`out_of_scope_anchor`)은 이 PR 에서 **공개**로 바뀌었다(섀도 프로브가 쓴다, 로직 무변경) | `ai/src/trippilot/orchestrator/intent_eval.py:28-35, 38-64, 67-96` |
| 섀도·요약 선례 | **없다.** src·scripts 에 shadow/섀도 0건; 요약 feature 0건. 정본에는 mlops-llmops "모델 교체 시 섀도 병행" 한 줄 | grep · `mlops-llmops-design.md:75` |

### 0.3 AI — 저장소·관측·배포

| | 상태 | 위치 |
|---|---|---|
| AI → 백엔드 DB 직접 SQL | **없다.** 열린 길은 `GET /internal/pois?centerLat&centerLng&radiusKm` · `POST /internal/pois/batch-get {poi_ids}`(≤200) 를 `X-Service-Token` 으로 — `BackendPoiDb`. **trip_id 로 일정을 가져오는 어댑터 없음**(grep 0). 일정은 요청 스냅샷으로만 온다 | `poi_curation/adapters/backend_poi_db.py:8-10, 48-54, 162-204` |
| AI 자체 DB | RDS 안 `ai_kb`(역할 `ai_user`, **CREATE 권한 없음**, DML 만 GRANT). 테이블 `kb_vectors` 하나. **DDL 정본 두 곳** — `deploy/eks/bootstrap.sql`(마스터 Job, 매 배포 멱등 `IF NOT EXISTS`) + `ai/docker/vector-init/01-kb-vectors.sql`(compose initdb **1회** — 기존 볼륨엔 재적용 안 됨) | `deploy/eks/bootstrap.sql:27-41` · `ai/docker/vector-init/01-kb-vectors.sql:1-11` |
| DSN `TRIPPILOT_VECTOR_DB_URL` | 배포 도구가 합성(`postgresql://ai_user:…@<host>:5432/ai_kb?sslmode=require`)하되 **`embedding_enabled` 일 때만**; 차트도 `if .Values.embedding.enabled` 블록 안에서만 꽂는다 → 임베딩 꺼진 배포에선 AI 가 어떤 DB 에도 닿지 않는다 | `deploy/eks/runtime_secrets.py:198-206` · `deploy/eks/chart/templates/ai.yaml:74-80` · `deploy/eks/tests/test_runtime.py:506` |
| 어댑터 선례 `PgVectorStore(connect: Callable)` | psycopg 3 직접(`pgvector` 파이썬 패키지·`psycopg_pool` 미의존), **호출마다 connect 하고 닫음**, DML 만 | `ai/src/trippilot/agents/adapters/pgvector_store.py:11-17, 46-103` |
| 프로세스 로컬 상태 | uvicorn `--workers 2` × 복제본(dev-target 1·운영 2~3) → dict/캐시는 요청 간 공유 불가(`cost.py:42-43`·`preference_cache.py:18` 가 명시) | `deploy/eks/chart/templates/ai.yaml:37-40` · `values-dev.yaml:24-37` |
| 관측 콘센트 | `TracePort.emit`(예외 안 냄) → `LoggingTrace`: `trace_event <dataclass repr>` + LlmCallRecord 면 `llm_cost {json}`(로거 `trippilot.wiring`); `TraceMiddleware` 가 `http_request {json}`; 선례 #1136 `replan_reason {json}` **접두어 + JSON 한 줄**; `LlmCallRecord.component` 는 `'c1.gateway'` 고정 | `api/wiring.py:265-286, 2195-2203` · `api/cost.py:170-203` · `api/middleware.py:279-337` · `domain/observability.py:26-44` |
| DEV 로그 워크플로 | `aws-dev-logs.yml`·`ai-llm-fallback-watch.yml` 이 네임스페이스 **`trippilot` 하드코딩** — 개발 대상 `trippilot-dev` 파드 로그는 꺼낼 수 없다. prd 는 컨테이너 로그 수집 꺼짐 | `.github/workflows/aws-dev-logs.yml:66, 72-74, 121` · `ai-llm-fallback-watch.yml:63` · `infra/terraform/environments/prd.tfvars:7` |
| ai-wiring 표식 | 배포 smoke 가 기동 로그에서 `'미설정'`·`'미배선'` 등 토큰 든 줄만 끌어올린다(단언 없음) | `deploy/eks/runtime_smoke.py:65-96` |
| 새 env 키 1개의 비용 | `runtime_secrets.py` allowlist + 차트 `range` 목록 + `chart/tests/test_chart.py`·`deploy/eks/tests/test_runtime.py` + `.env.example` + `docker-compose.yml` — 5곳(TRIP-882 빈 문자열 `int()` 함정 포함) | `deploy/eks/runtime_secrets.py:23-29, 134-138` · `chart/templates/ai.yaml:71` |

### 0.4 백엔드 assistant 모듈

| | 상태 | 위치 |
|---|---|---|
| 세션 수명 | (계정, 여행) ACTIVE 행 1 + 일반 세션 1(부분 유니크), `expires_at = 마지막 턴 + 90일`(턴마다 연장), 조회는 `expires_at>now` 만. **사라지는 길 4가지** — 만료 청소(`AssistantRetention.deleteExpired` 하루 1회) · 이력 지우기(`AssistantSessionService.clear`, hard delete) · 여행 삭제(`TripDeletedSubscriber` → `deleteByTrip`) · 계정 삭제(`AccountDeletionSubscriber` → `AssistantRetention.purgeAccount` 즉시). 내보내기 `AssistantExportContributor`(섹션 `assistantMessages`). (AI 메모리 파기는 이 중 **뒤 셋의 호출** + 만료는 AI TTL — §4.1) | `A/adapter/out/persistence/AssistantPersistence.kt:45-94` · `A/application/AssistantRetention.kt:29-57` · `A/application/AssistantSessionService.kt:35-53, 76, 103-105` · `APP/src/main/resources/db/migration/V2.64__assistant.sql:15-35` |
| `dialogue_context` | jsonb NOT NULL DEFAULT '{}', 크기 CHECK 없음; 백엔드는 `turn_index` 만 +1(`bumpTurnIndex`, INV-U8-07), 다른 키는 PBT-U8-7 로 보존 | `A/application/AssistantTurnService.kt:444-452` · `AT/application/AssistantTurnServiceTest.kt:923-944` |
| 턴 예산 | `turnBudgetMs 13000` · `interpretStageMaxMs 5000` · `editStageMaxMs 8000` · `readMarginMs 1000` · `dailyLlmTurnLimit 30` · 월 20000 · 분당 20; 해석 `deadline = min(5000, remaining − 1000)`; 해석 read timeout = `interpretStageMaxMs + readMarginMs`(**6s, 백스톱 여유 없음**). 다른 두 경계는 `require(read ≥ deadline + 5000)` | `A/application/AssistantProperties.kt:30-57` · `AssistantTurnService.kt:358-361` · `HttpDialogueInterpreter.kt:160-185` · `notification/.../ReminderCopyConfiguration.kt:39-49` |
| 와이어 파서 | `InterpretOutcome` 3종 enum — **모르는 outcome 은 `DialogueInterpretFailed` → 매 턴 AI_UNAVAILABLE 폴백**; Jackson 3 `FAIL_ON_UNKNOWN_PROPERTIES=false`(런타임은 모르는 응답 필드를 무시) | `A/domain/Dialogue.kt:15-22` · `HttpDialogueInterpreter.kt:101-151` |
| 와이어 게이트 테스트 | 응답 스키마 키 집합 **정확 동등** `{outcome, frames, clarify, dialogue_context, llm_calls}` · Frame 5키 · Clarify 4키; 요청은 `키 ⊆ 계약 ∧ 계약 required ⊆ 키`. 계약 파일은 `ai/docs/openapi.json` 을 위로 올라가 찾는다; **backend-ci 가 그 파일 변경에 트리거** | `AT/adapter/out/interpret/HttpDialogueInterpreterTest.kt:125-158` · `.github/workflows/backend-ci.yml:16, 19` |
| `answer()` 분기 | OUT_OF_SCOPE → SCOPE 카드 + 거절 스트릭 · `frames.size > 1` → `oneAtATime` · frames 비면 폴백 · ARGUMENT_CLARIFY → CLARIFY 카드(PICK_OPTION) · 그 외 `dispatched(intent, arguments − SERVER_ISSUED_ARGUMENTS{slotKey, poiId})`; `reply()` 가 `llmCalls`(해석+처리기)·`matchRoute = frames.first().matchRoute`·`dialogueContext` 를 메시지에 합친다 | `A/application/AssistantTurnService.kt:378-413, 492` |
| 도우미 메시지 제약 | `text ≤2000`(DB CHECK, 앱 검사 없음) · `next_actions ≥1`(DB CHECK) · `kind ∈` CHECK 10종(새 kind = 마이그레이션) · `intent varchar(40)` · `match_route varchar(16)` · `outcome varchar(32)` · 제약 위반은 500 + "응답 없는 턴" | `V2.64__assistant.sql:70-71, 81-91` · `AssistantTurnService.kt:113-121` |
| `NextAction.TYPES` 17종 | `OPEN_ITINERARY` `OPEN_ITINERARY_EDIT` `OPEN_ITINERARY_METHOD` `OPEN_REGENERATE` `OPEN_REPLAN` `OPEN_LIVE` `OPEN_PLACE` `OPEN_STAY_SEARCH` `OPEN_OTA` `OPEN_REFLECTION` `OPEN_TRIP_SUMMARY` `OPEN_STYLE` `CREATE_TRIP` `RETRY_TURN` `CONTINUE_WITHOUT_ASSISTANT` `SHOW_CAPABILITIES` `RESTORE_REVISION`; `QuickReplyAction` 6종 `SEND_TEXT` `REVIEW` `PICK_CANDIDATE` `PICK_OPTION` `SHOW_CAPABILITIES` `RETRY` | `A/domain/AssistantMessage.kt:40-49, 62` |
| 템플릿·조회 카드(이식 원문) | `needTrip` "먼저 여행을 만들거나 숙소를 등록하면 일정을 함께 볼 수 있어요." · `info(kind, text, title, rows)` payload `{infoKind, title, rows[{label,value}]}` · `clarify` 보기 id `qr-option-{8자}-{i}` · `QueryCards` 의 "아직 일정이 없어요"·"남은 일정이 없어요"·"지금 날씨를 확인할 수 없어요"·"구간 거리는 일정에서 확인할 수 있어요"·"장소 정보는 일정에서 장소를 눌러 볼 수 있어요"·"지금 일정을 확인할 수 없어요"; INFO rows 라벨 "날짜"·"계획 시각"·"직전 구간"·"분류"·"영업시간"·"오늘 최대 강수확률"·"특보"(특보 행은 BE 만 — AI `WeatherProvider` 패킷에 특보 칸이 없어 1단계 WEATHER 카드는 강수확률 행만, BLM §5) | `A/application/AssistantTemplates.kt:57-60, 84-87, 133-140` · `A/application/QueryCards.kt:103-193, 205-208` |
| 빠른 답 | 서버 발급 id 만 ACTION 턴으로 받는다(없으면 400); `PICK_CANDIDATE` params `poiId`·`slotKey`, id `qr-pick-{slotKey}-{poiId}` → EDIT_SCHEDULE dispatched → `ProposalCards.edit` 의 ReplaceSlot | `AssistantTurnService.kt:270-274, 316-336` · `ProposalCards.kt:174-180, 227-228` |
| 입력 가드레일 | 분당 20 · `TextModerationFacade.inspect` fail-closed(원문 미저장 redacted) · 스냅샷 화이트리스트(BR-U8-22, `ContextSnapshotBuilderTest` 가 `lat`/`lng` 부재를 명시 단언) · **출력 문장 검열 코드는 없다** | `AssistantTurnService.kt:187-202` · `AT/application/ContextSnapshotBuilderTest.kt:63-68, 81-84, 137` |
| 경로 목록 게이트 | `CALLED_PATHS`(itinerary-generation 7경로)에 dialogue 는 없다 — dialogue 경로의 게이트는 `HttpDialogueInterpreterTest` 자체(경로·스키마 이름 하드코딩) | `IG/adapter/out/external/HttpScheduleAgentAdapter.kt:401-421` · `HttpDialogueInterpreterTest.kt:67, 101, 112` |

### 0.5 프론트엔드 도우미 시트

| | 상태 | 위치 |
|---|---|---|
| 그리는 것 | `MessageKind` 10종 · `NextAction.type` closed-set 17(모르는 type 은 버튼 제거 → `SHOW_CAPABILITIES` 대체) · quick reply 는 **서버 발급 id 만**(마지막 ASSISTANT 메시지의 것; `null`=시작 칩 복귀, `[]`=상시 칩만) · `text` 는 RN `<Text>` 평문 그대로(마크다운·링크·말줄임 없음, `\n` 줄바꿈) | `FE/api/assistantContract.ts:27-37, 40-67, 106-193` · `FE/model/displayActions.ts:22-74` · `FE/model/sheetModel.ts:9-20` · `FE/ui/MessageList.tsx:31-48` |
| 깨지는 조건 | kind 는 맞는데 **필수 배열 누락**(INFO `rows`·CANDIDATES `candidates`·REVIEW `summary/problems`·PROPOSAL `diff/violations`) → `.map` TypeError, **ErrorBoundary 없음**. 모르는 kind·null payload·모르는 추가 필드는 안전 | `FE/ui/AssistantCards.tsx:98, 109, 144, 178, 374-443` |
| 후보 탭 | `CANDIDATES` 카드 탭 → 전 메시지에서 `action=PICK_CANDIDATE ∧ params.poiId` 일치 quick reply 검색 → ACTION 턴; 없으면 조용히 무시 | `FE/ui/AssistantSheetPage.tsx:159-168` |
| 리터럴 발화 | 서버가 SHOW_CAPABILITIES quick reply 를 안 줬으면 상시 칩이 **"내가 할 수 있는 것 보기"** 를 TEXT 턴으로 보낸다 | `FE/ui/AssistantSheetPage.tsx:148-157` |
| 턴 타이밍 | 동기 POST 1회, FE 하드 타임아웃 없음(mutator `timeout:0`), 15s 는 UI 경고선, 취소는 클라 abort(서버는 끝까지 처리), 재전송은 같은 `clientTurnId` | `frontend/src/shared/api/mutator.ts:14-22, 36-45` · `FE/model/turnTiming.ts:5-10` · `FE/model/useTurnFlow.ts:68-74, 127-136` |

**이 FD 가 새로 만드는 것**은 `TurnInput`·`TurnOutcome`·`DialogueAnswer`·`Facts`·`HandlerTask`·`DialogueMemory`·
`MemoryStorePort`·`ShadowRecord`·시한 모듈 상수(§2.8)·`PoiInfo` 패킷(+ `ProviderKind.POI_INFO`)·`LlmFeature` 3종이고,
나머지는 위 실재물을 **조립**하는 일이다. 특히 되묻기(보류 프레임·`CLARIFY_QUESTIONS`·`clarify_count ≤1`)는 새로 만들지
않고 `DialogueInterpreter` 의 것을 그대로 부른다.

---

## 1. 재사용 — 변경 0

U1~U6·agent-foundation·assistant-dialogue 가 만든 규격을 **소비만** 한다. 필드·불변식 개정 없음.

| 타입·함수 | 위치 | 이 FD 에서의 용도 |
|---|---|---|
| `Intent`(14종) · `ROUTING_TABLE` · `MatchRoute` · `IntentMatch`(FALLBACK⇔OUT_OF_SCOPE·폴백 reason 필수) · `IntentDraft` | `domain/intent.py` | 분류 결과 타입. `DIALOGUE_INTENT` 산출을 `IntentMatch(match_route=LLM_DIRECT)` 로 조립 |
| `ARGUMENT_TABLE` · `asked_specs_of` · `tool_specs_json` · `IntentFrame` · `ArgumentClarify` · `PendingFrame` · `DialogueContext`(pending·turn_index·clarify_count) · `CLARIFY_QUESTIONS` | `domain/dialogue.py` · `orchestrator/dialogue_interpreter.py` | `$intents` 변수 = `tool_specs_json()` 그대로; 되묻기·보류 프레임 로직 그대로 |
| `extract_arguments` | `orchestrator/arguments.py` | 보류 되묻기 답 읽기(기존 `_answer` 안) |
| `IntentGate` | `llm_gateway/gates/intent.py` | **그대로 재사용** — `feature` 인자만 `DIALOGUE_INTENT`. 선례: `ExplanationGate` 를 `ALTERNATIVE_EXPLANATION` 이 재사용 |
| `IntentRouter` · `IntentRouterConfig` · `BankIndex` · `InMemoryVectorStore`(뱅크) | `orchestrator/intent_router.py` · `dialogue_interpreter.py` | **섀도 전용으로 재조립**(코드 무변경). 뱅크 스토어·`bank_index.indexed` 는 서비스 것과 공유, 읽기 전용 |
| `DialogueInterpreter._answer` · `_from_match` | `orchestrator/dialogue_interpreter.py:322-` | 파이프라인 1·3 단계. **로직 무변경, 이름만 공개로 승격**(`answer_pending`·`from_match`) — 미결 #17 |
| `Provider` Protocol · `WeatherProvider` · `TransitProvider` · `PlaceProvider` | `providers/` | 팬아웃 작업 실행자. 변경 0 |
| `InfoPacket` · `ProviderStatus` · `FreshnessMeta` | `domain/freshness.py` | 작업 결과 타입. **`ProviderKind` 에 `POI_INFO` 1값 추가**는 §2.9(변경 있음 — 여기 아님) |
| `PlanBAgent` · `PlanBRagRequest` · `PlanBRagResult` · `TriggerParams`/`TriggerKind` | `agents/planb/rag.py` · `domain/trigger.py` | `SUGGEST_ALTERNATIVE` — `run(PlanBRagRequest(use_llm=False, …))` 인프로세스 |
| `CandidatePool` · `CandidatePoolRequest` · `CandidatePoolBuilder` · `restrict_pool_to_target_role` | `domain/poi_curation.py` · `poi_curation/pool_builder.py` · `api/wiring.py:1072` | 대상 좌표 앵커 풀 조립(INV-1 closed-set) |
| `PoiDbPort.lookup_by_ids`/`find_by_radius` · `BackendPoiDb` | `ports/poi_db_port.py` · `poi_curation/adapters/backend_poi_db.py` | `PoiInfoProvider` 의 유일한 외부 조회. **쓰기 메서드 추가 금지**(read-only, POI 정본은 C7) |
| `FeeTable.of` · `load_fee_table` · `Poi.open_hours`·요일 라벨 규칙 | `poi_curation/place_fees.py` · `agents/planb/composition.py:95` | 장소 정보 행(입장료·영업시간). 요일 라벨 함수의 **위치**는 미결 #16(providers 가 agents 를 import 하지 않게) |
| `GatewayFacade` · `TypedResult` · `C1Config` · `TierRouter` · `PromptRegistry` · `inline` · `PromptRef` | `llm_gateway/` | LLM 3 feature 호출. 변경 0 (config **표 3종에 행 추가**는 데이터) |
| `GateOutcome` · `has_contact_like` · `strip_code_fence` · `_load_json_object` · `empty_result_error` · `_TIME_EXPR` | `gates/base.py` · `gates/reflection_template.py` | 답변·메모리 게이트의 부품 |
| `LlmCallRecord` · `FallbackEvent` · `GateDropEvent` · `TracePort` · `LoggingTrace` | `domain/observability.py` · `ports/trace_port.py` · `api/wiring.py` | 관측. 섀도는 **래퍼**로 `component` 만 바꿔 위임(타입 개정 없음) |
| `TraceId` · `GeoPoint` · `TransportMode` · `Clock`(`monotonic_ms`) · `to_iso`/`from_iso` | `domain/common.py` · `domain/serialization.py` | 공통 |
| `intent_eval.Sample` · `score` · `format_report` · `EvalReport` | `orchestrator/intent_eval.py` | 섀도 집계 스크립트 재사용. **`_is_refusal` 공개 승격**(이름만, 로직 무변경) |
| `_deadline_budget` 산식 · `UNBOUNDED_DEADLINE_MS` | `api/wiring.py:294-296` | 참조만 — 대화는 기본값이 600_000 이 아니라 **9_000** 이다(§2.8) |
| `prompts/intent.yaml`(v0.2.0) · `prompts/paraphrase.yaml`(v0.1.0) · `tests/fixtures/intent_gate/*` · `data/intent_question_bank.yaml` | — | **무변경** — 섀도가 재는 대상이 현행 3단 그대로여야 한다(BR-AO-14) |
| `AssistantTemplates`·`QueryCards` 문구(백엔드) | `A/application/` | 결정론 템플릿 문구의 **이식 원문**(BLM §5 처리표의 폴백 텍스트 — 정본은 `workers/dialogue_answer.py`, BE 에 없는 문구는 ★ 신설) — 백엔드 코드 자체는 변경 없음 |

---

## 2. 신규 타입

전부 `@dataclass(frozen=True, slots=True)`. dict 필드는 JSON 원시 타입만, datetime 은 tz-aware 만(BR-AF-12 동형).
**배치 원칙** — 하위 계층(`ports/`)이 참조하는 타입은 `domain/` 에, 그 외는 쓰는 모듈에 둔다(L-1).

### 2.1 `TurnInput` — 한 턴의 입력 (`orchestrator/dialogue_orchestrator.py`)

경계 사영(`api/dialogue.py`)이 와이어 요청을 이 타입으로 바꾼다. 오케스트레이터는 pydantic 스키마를 import 하지 않는다.

```
RecentTurn (frozen):
  role: str                        # "USER" | "ASSISTANT"
  text: str                        # 1..300 (백엔드가 절단해 보낸다 — AI 는 다시 자르지 않고 그대로 받는다)

SlotView (frozen):
  slot_key: str                    # "{date}#{poiId}" — 백엔드 PlannedSlotView.slotKey 와 같은 모양(BR-U2-04)
  poi_id: str | None               # slot_key 를 '#' 로 1회 rsplit 한 뒤 토큰. 모양이 다르면 None (해소 실패로 다룬다)
  name: str | None
  start_at: time                   # 저장된(검증된) 계획 시각 — 그대로 보여도 되는 유일한 시각 (INV-2)
  category: str | None

DayView   (frozen): date: date · slots: tuple[SlotView, ...]
TripInfo  (frozen): trip_id: str · regions: tuple[str, ...] · start_date: date · end_date: date · phase: str  # PLANNING|IN_TRIP|ENDED
TurnSnapshot (frozen):
  surface: str                     # HOME|STAY_SEARCH|ITINERARY|LIVE|STAY_DETAIL
  trip: TripInfo | None
  base_stays: tuple[str, ...]      # 이름뿐 — 좌표 없음
  itinerary_status: str | None
  days: tuple[DayView, ...]

TurnInput (frozen):
  utterance: str                   # 1..500 (경계가 이미 검증)
  context: DialogueContext         # 기존 타입 — pending·turn_index·clarify_count (+ shown — 2026-10-30, BR-AO-27)
  snapshot: TurnSnapshot
  session_id: str | None           # 메모리 키 — 없으면 메모리 단계 전체를 건너뛴다
  account_ref: str | None          # 불투명 문자열. 로그·프롬프트 금지 — 저장 칸과 "지난 여행 기억" 조회 키로만
  recent_turns: tuple[RecentTurn, ...]   # ≤ 20
  trace_id: TraceId                # = request_meta.request_id
  now: datetime                    # = request_meta.requested_at (tz-aware 보정)
  deadline_ms: int                 # > 0. 백엔드 None 이면 9_000 (미결 #5)
  started_ms: int                  # 단조시계 원점 — 경계 진입 시 1회 (모든 잔여 계산의 기준, ScheduleTask.started_ms 선례)
```

post-init: `deadline_ms > 0` · `len(recent_turns) ≤ 20` · `RecentTurn.text` 1..300 · `role ∈ {USER, ASSISTANT}` ·
`now` tz-aware. `poi_id` 파생 규칙은 생성자가 아니라 `SlotView.from_wire(slot_key, …)` 한 곳.

### 2.2 `TurnOutcome` — 한 턴의 출력

```
TurnOutcome (frozen):
  outcome: str                     # "ANSWER" | "FRAME" | "ARGUMENT_CLARIFY" | "OUT_OF_SCOPE"
  frames: tuple[IntentFrame, ...]  # 길이 0 또는 1 (DEC-U8-11 단일 의도 유지)
  clarify: ArgumentClarify | None
  answer: DialogueAnswer | None
  context: DialogueContext         # 갱신본 — turn_index 는 그대로(백엔드가 올린다, INV-U8-07)
  llm_calls: int                   # ≥ 0 — **서비스 경로 호출만** (섀도 제외, BR-AO-07)
  reason: str | None               # 폴백·강등 사유 (와이어 미노출, 로그·trace 용)
```

**post-init 불변식**

| 조건 | 강제 |
|---|---|
| `outcome = ANSWER` | `answer ≠ None` ∧ `len(frames) ≤ 1` — 분류를 거친 턴은 1(분류 프레임이 백엔드 관측 칸 `intent`·`match_route` 의 원천), 0단계 리터럴 능력 안내와 2″ 맞장구·인사 답(BR-AO-26)은 0(BE 는 `frames.firstOrNull()` 로 읽어 `intent null`·`match_route "NONE"` 저장 — 미결 #19 A) ∧ `clarify = None` **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 프레임 0 의 출처가 셋 — 0단계 능력 안내·2″ 맞장구·**2‴ 계획 답**(BR-AO-28). |
| `outcome = FRAME` | `answer = None` ∧ `len(frames) = 1` ∧ 그 프레임 `executable` — 1단계에서는 **`EDIT_SCHEDULE` 만** 여기로 온다 |
| `outcome = ARGUMENT_CLARIFY` | `clarify ≠ None` ∧ `len(frames) = 1` ∧ `clarify.argument ∈ frames[0].missing` ∧ `answer = None` |
| `outcome = OUT_OF_SCOPE` | `frames` 비어 있음 ∧ `answer = None` ∧ `reason ≠ None`(거절 표지 또는 실패 사유) — **문장 없음**(BE SCOPE 카드) |
| 공통 | `llm_calls ≥ 0`; `len(frames) ≤ 1`(프레임 2개 이상인 인스턴스는 생성 불가) |

### 2.3 `DialogueAnswer` — 사용자에게 보일 답변

```
AnswerKind (Enum): TEXT · INFO · CANDIDATES              # 1단계. 2단계에 PROPOSAL (§9)

NextAction (frozen):
  type: str                        # NextAction.TYPES 17종 안 (post-init 검사 — 집합 리터럴은 domain 상수 NEXT_ACTION_TYPES 한 곳)
  label: str                       # 1..30
  params: dict[str, str]           # OPEN_PLACE 면 poiId 필수. OPEN_OTA 는 만들지 않는다(stayId 를 알 길이 없다)

QuickReplyDraft (frozen):          # **id 가 없다** — 서버 발급은 백엔드 몫 (qr-ai-{8자}-{i})
  label: str                       # 1..30
  action: str                      # SEND_TEXT | PICK_CANDIDATE | SHOW_CAPABILITIES | RETRY (REVIEW·PICK_OPTION 은 AI 가 내지 않는다)
  params: dict[str, str]           # PICK_CANDIDATE: poiId·slotKey 필수 · SEND_TEXT: intent(+slotKey) 선택

DialogueAnswer (frozen):
  kind: AnswerKind
  text: str                        # 1..400 (출구 게이트 상한; 와이어 스키마는 600, DB 는 2000)
  payload: dict | None             # INFO: {infoKind, title, rows[{label, value}]} / CANDIDATES: {candidates[{poiId, name, distanceRange?, reason}]} / TEXT: None
  next_actions: tuple[NextAction, ...]       # ≥ 1
  quick_replies: tuple[QuickReplyDraft, ...] | None   # None=시작 칩 복귀 · ()=상시 칩만 (FE sheetModel 의미 그대로)
  footnote: str | None             # ≤ 120
```

**post-init 불변식**

| 조건 | 강제 |
|---|---|
| `kind = INFO` | `payload["infoKind"] ∈ {NEXT_SLOT, DISTANCE, PLACE, WEATHER}` ∧ `payload["rows"]` 가 **list**(빈 배열 허용, 누락 금지 — FE `rows.map` 크래시) ∧ 각 행 `{label, value}` 문자열 |
| `kind = CANDIDATES` | `payload["candidates"]` list, 1..5 ∧ 각 `{poiId, name, distanceRange?, reason}` ∧ `quick_replies` 에 각 `poiId` 의 `PICK_CANDIDATE{poiId, slotKey}` 가 **정확히 하나** 있음(FE 후보 탭이 그 짝을 찾는다) — **[개정 · 2026-10-19 · 장소 탐색]** 전부 있거나 전부 없다. 없으면(EXPLORE_PLACES) 후보마다 `OPEN_PLACE{poiId}` 가 next_actions 에 있고 탭은 조용히 무시된다. 대안(SUGGEST_ALTERNATIVE)의 "후보마다 하나"는 `Facts` post-init 이 지킨다 |
| `kind = TEXT` | `payload = None` |
| `text` | 비어 있지 않음 ∧ `len ≤ 400` ∧ 줄 수 ≤ 6 ∧ `_TIME_EXPR` 매치 없음(INV-3) ∧ `not has_contact_like(text)` — **게이트와 타입이 같은 검사**(어긋나면 게이트 통과값이 생성 불가가 된다) |
| `next_actions` | `≥ 1` ∧ 전부 `type ∈ TYPES` ∧ `OPEN_PLACE ⇒ "poiId" in params` |
| `footnote` | None 또는 1..120, 같은 `_TIME_EXPR`·연락처 검사 |

`DialogueAnswer` 안의 모든 시각·거리·장소명은 **`Facts`(§2.5) 에서 복사된 값**이다. LLM 이 만드는 것은 `text`(와 `footnote`)뿐이고,
그조차 게이트 실패·시한 부족이면 `Facts.template_text` 로 대체된다(BR-AO-04·06).

문장의 출처(LLM·템플릿·의도된 결정론)는 타입에 두지 않는다(초판의 `text_source` 는 와이어·로그 어디에도 안 실리는 테스트 전용 메타라 2026-10-18
리뷰로 지웠다). 구분은 트레이스로 본다 — **LLM 을 시도했거나 시도해야 했던(재료는 있는데 잔여 부족) 턴**의 템플릿에는
`FallbackEvent(from="llm_dialogue_answer")` 짝이 있고(AO-P5), **의도된 결정론**(0단계 능력 안내 BR-AO-18 · `needTrip` BR-AO-23 · 사실 없는 `Facts` 직행 BR-AO-25(2026-10-19) ·
`Facts.status = UNAVAILABLE` 템플릿 직행 BR-AO-25 — LLM 미시도)에는 없다. 팬아웃 실패는 작업별 `FallbackEvent(stage="fanout")` 로 보고된다(BLM §7).

### 2.4 `HandlerTask` · `Handler` — 의도별 처리 계획 (`orchestrator/dialogue_handlers.py`)

```
TaskKind (Enum): PROVIDER · PLANB · COMPUTE          # Provider.fetch / PlanBAgent.run / 스냅샷 순수 계산

HandlerTask (frozen):
  name: str                        # 결정론 병합 키 ("weather"·"poi_info"·"transit"·"pool"·"planb"·"next_slot" …) — 한 플랜 안에서 유일
  kind: TaskKind
  provider: ProviderKind | None    # PROVIDER 일 때 필수
  params: dict                     # 1파는 확정값. 2파는 **1파 결과로 조립하는 순수 함수** `build(ctx, results) -> dict | None` 의 산출 (None = 조립 불가 → UNAVAILABLE 로 기록)
  timeout_share: float             # 이 작업이 팬아웃 예산에서 받는 몫 (0 < x ≤ 1, 기본 1.0 — 전부 같은 마감을 공유한다)

TaskResult (frozen):
  name: str
  status: str                      # "OK" | "LOW" | "UNAVAILABLE" | "TIMEOUT" | "SKIPPED"
  packet: InfoPacket | None        # PROVIDER
  planb: PlanBRagResult | None     # PLANB
  value: dict | None               # COMPUTE (JSON-safe)
  elapsed_ms: int

Handler (Protocol):
  def plan(self, ctx: TurnContext) -> tuple[tuple[HandlerTask, ...], ...]   # 파(wave) ≤ 2 — 파 안은 병렬, 파 사이는 순차
  def assemble(self, ctx: TurnContext, results: Mapping[str, TaskResult]) -> Facts   # **순수** — 같은 입력에 같은 Facts (BR-AO-16)

HANDLERS: Mapping[Intent, Handler]   # 13종 전수 (OUT_OF_SCOPE 제외) — [개정 · 2026-10-19 · 장소 탐색] DIALOGUE_INTENTS 14종. 없는 의도는 기동 시 ValueError
```

`TurnContext` 는 `TurnInput` + 분류 프레임 + 로드된 메모리 + 잔여 시계(`remaining_ms()` 콜러블)를 묶은 읽기 전용 뷰다.
파가 둘인 이유는 브리프 §2.3 자체에 있다 — `GET_WEATHER`·`GET_DISTANCE`·`SUGGEST_ALTERNATIVE` 는 **스냅샷에 좌표가 없어**
`PoiInfo`(배치 조회)로 좌표를 먼저 얻어야 Weather·Transit·풀 조립이 가능하다. 파를 셋 이상 두지 않는다(BLM §4 시한 배분표가
팬아웃 전체를 한 예산으로 본다). 브리프의 `plan(ctx) -> tuple[Task, ...]` 는 이 표기의 1파 특수형이다.

슬롯 참조 해소(`resolve_slot(ctx, said: str | None, *, default_next: bool) -> SlotView | None`)도 이 모듈의 순수 함수다 —
날짜("둘째 날"=`start_date+1`, DATE·ORDINAL 정규식 재사용) · 순번 · 이름 **부분일치가 하나뿐일 때만**(백엔드 `mentioned` 와 같은
규칙: 2자 미만 무시, 둘 이상이면 None) · "점심/저녁" → `FOOD` 카테고리 ∧ 시각대(11~14시 / 17~20시). 못 풀면 None 이고
지어내지 않는다 — 호출측이 일정 화면 안내로 간다.

### 2.5 `Facts` — 답변의 결정론 뼈대 + LLM 재료

```
FactRow   (frozen): label: str · value: str
FactPlace (frozen): poi_id: str · name: str · category: str | None · hours_label: str | None · fee: int | None · distance_range: str | None · reason: str | None
FactStatus (Enum): OK · PARTIAL · EMPTY · UNAVAILABLE

Facts (frozen):
  intent: Intent
  status: FactStatus
  rows: tuple[FactRow, ...]              # INFO 의 rows 와 동형 — 라벨·값은 백엔드 QueryCards 어휘 그대로
  places: tuple[FactPlace, ...]          # 답변 문장에 등장해도 되는 장소의 **닫힌 목록** (CANDIDATES 후보 포함)
  notes: tuple[str, ...]                 # "날씨 미확인"·"거리 미확인" — 사용자 문장 재료이자 PARTIAL 보고
  kind: AnswerKind                       # 결정론 — Facts 가 정한다
  payload: dict | None                   # kind 별 모양 (§2.3) — LLM 이 건드리지 않는다
  next_actions: tuple[NextAction, ...]   # ≥ 1
  quick_replies: tuple[QuickReplyDraft, ...] | None
  template_text: str                     # 결정론 폴백 문장 (정본 workers/dialogue_answer.py — BE 이식 + ★ 신설, BLM §5 처리표)
  footnote: str | None
```

post-init: `template_text` 가 §2.3 의 `text` 검사를 전부 통과 ∧ `kind/payload/next_actions/quick_replies` 가 §2.3 불변식을 통과 —
즉 **`Facts` 만으로 유효한 `DialogueAnswer` 가 항상 만들어진다**(`DialogueAnswer.from_facts(facts, text=None)`). 이것이 INV-4 의
구조적 보장이다: LLM 이 아무것도 못 해도 응답은 있다.

`$facts` 프롬프트 변수 = `Facts` 의 `rows·places(좌표 없음)·notes·status` 를 JSON 으로 직렬화해 `inline()` 한 문자열 **[개정 · 2026-10-20 · 답변 0.3.2]** rows 에서 ("입장료", "미확인") 줄은 뺀다(카드 payload 는 그대로 — 프롬프트 rows ≠ 카드 rows). 모르는 입장료는 물었든 안 물었든 답이 "확인할 수 없다"로 같고, 실어 두면 카페 답마다 "입장료도 미확인이에요"가 붙었다. 좌표·poi_id 내부
값은 넣지 않는다(워커 규칙 "좌표 미포함"). `places[].name` 은 `inline()` 으로 눌러 골격 위조를 막는다.

### 2.6 `DialogueMemory` · `MemoryStorePort` — 장기 기억

**배치(코드 현행 — business-rules §5 미결 #20 해소, 안 B)**: 브리프 초판은 `DialogueMemory` dataclass 를 `orchestrator/dialogue_memory.py` 에 두었다.
그러나 `ports/memory_store_port.py` 가 `put(memory: DialogueMemory)` 로 그 타입을 참조해야 하고, **ports 는 orchestrator 를 import 할 수
없다**(L-1, `tests/test_architecture.py`). 그래서 dataclass 는 **`ports/memory_store_port.py` 안**에 둔다(포트 모듈 내 dataclass 선례
`ports/llm_port.py` LlmRequest/LlmResponse · `ports/vector_store_port.py` VectorHit), `orchestrator/dialogue_memory.py` 가 재export 하고
`due`·`compress_fallback`·`expires_at_for` 를 둔다. `domain/dialogue_memory.py` 는 만들지 않는다. 모양·필드는 브리프 그대로다.

```
DialogueMemory (frozen):                          # ports/memory_store_port.py
  session_id: str                                 # 백엔드 assistant_session.session_id (PK)
  account_ref: str | None                         # 불투명 — 로그 금지
  trip_id: str | None
  summary: tuple[str, ...]                        # ≤ 20 줄 · 줄 ≤ 120 자 · 빈 줄 없음 · 중복 없음
  summarized_turn_index: int                      # ≥ 0 — 이 요약이 덮은 마지막 turn_index
  updated_at: datetime                            # tz-aware
  expires_at: datetime                            # = updated_at + 90 일 (BE DATA-U8-01 과 같은 값)
  to_dict / from_dict 왕복

MemoryStorePort (Protocol):                       # ports/memory_store_port.py
  def get(self, session_id: str) -> DialogueMemory | None
  def put(self, memory: DialogueMemory) -> None                      # upsert + 만료 연장 + 같은 트랜잭션에서 만료 행 정리 1회(필수 — TTL 백스톱, §4·BR-AO-09)
  def recent_for_account(self, account_ref: str, *, exclude_session: str, limit: int) -> tuple[DialogueMemory, ...]   # updated_at DESC
  def delete(self, *, session_id: str | None = None, trip_id: str | None = None, account_ref: str | None = None) -> int   # 정확히 하나만 지정
  def purge_expired(self, now: datetime) -> int
```

- 포트 구현은 예외를 던질 수 있다(psycopg). **삼키는 것은 오케스트레이터 몫** — 읽기 실패는 "메모리 없이 진행", 쓰기 실패는
  `FallbackEvent(stage="memory")` + 다음 턴 재시도(BR-AO-09). 경계(`DELETE/GET`)에서는 예외가 500 으로 나가 백엔드가 재시도한다
  (purge 경로가 그것을 원한다 — DATA-U8-02).
- (종전 — 아래 2026-10-23 판이 대신한다) `due(turn_index: int, summarized_turn_index: int, every: int = 10) -> bool` = `turn_index − summarized_turn_index ≥ every`(기억이 없으면
  호출측이 `summarized_turn_index=0` 을 넘긴다).
- (종전 — 2026-10-23 없앴다) `compress_fallback(recent_turns, previous: Sequence[str] = (), *, max_lines=20, line_chars=120) -> tuple[str, ...]` — **결정론**: `previous` 뒤에
  최근 턴을 `"- 사용자: …"`/`"- 도우미: …"` 줄로 붙이되 줄을 `line_chars` 로 자르고 뒤에서부터 `max_lines` 만 남긴다. 멱등(두 번 적용 =
  한 번). **이 산출이 발화 조각을 담는 점은 미결 #10**(SEC-U8-06 과의 관계).
- `_memory_lines(current, others) -> tuple[str, ...]`(`dialogue_orchestrator`) — `$memory` 재료(줄 목록; 워커가 `inline()`·join). 현재 세션 줄들 + 헤더 `지난 여행 기억:` + 다른 세션(≤2) 줄들, 각 줄 `inline()`,
  없으면 `(없음)`.

구현 2종(브리프): `agents/adapters/pg_memory_store.py` `PgDialogueMemoryStore(connect)` — 테이블 `dialogue_memory`, DML 만,
`PgVectorStore` 와 같은 connect 주입(호출마다 connect) · `agents/adapters/memory_memory_store.py` `InMemoryDialogueMemoryStore` — 테스트·로컬.
어댑터 위치가 `agents/adapters/` 인 것은 `pgvector_store.py` 선례를 따른 것이고 agents 계층 규칙(L-2~L-6)의 대상이 아니다(어댑터는
orchestrator 가 import 한다 — 허용).

**[개정 · 2026-10-23 · 장기 기억 꺼내기(BLM DEC-AO-19)]** 같은 모듈에 더한 것과 바뀐 것:

```
GIST_KIND = "요약" ; MEMORY_KINDS = ("요약", "선호", "제약", "결정", "거절", "미해결")   # ports/memory_store_port.py — 프롬프트·게이트·오케스트레이터 한 곳
split_kind(line) -> (kind | None, body)            # "선호: 카페" → ("선호", "카페"); 표지 없음·목록 밖 → (None, line) — 옛 줄도 사실 줄로 읽는다
MemoryHit(session_id, line, score)                 # search 한 건 — 그 세션 요약에 지금 있는 줄만

MemoryStorePort (Protocol) +=
  def advance(self, memory, vectors: Mapping[str, tuple[float, ...]] | None = None, *, model: str | None = None) -> bool
      # 있는 행만·summarized_turn_index 가 커질 때만 UPDATE(없으면 False — 그사이 지워진 대화를 되살리지 않는다) + 만료 행 정리 1회
      # + vectors 를 주면 그 세션 줄 벡터를 새 요약에 맞춘다(요약에 없는 줄 삭제·준 줄 upsert). vectors 를 주면 model 필수
  def search(self, vector, *, session_id: str, account_ref: str | None, model: str, top_k: int) -> tuple[MemoryHit, ...]
      # 이 세션 + 같은 계정 다른 세션 줄 중 가까운 top_k(점수 내림차순, 동점 session_id·줄). 만료·다른 model·요약에 없는 줄 제외
  put(memory)  — 그대로(upsert). 오케스트레이터는 요약 차례에 행이 없을 때 턴 시작에 빈 행을 만들 때만 쓴다
```

- `orchestrator/dialogue_memory.py`: `due(…, every=SUMMARY_EVERY_TURNS)` — **3**(= `PROMPT_TURNS`, 프롬프트 창의 턴 수) · `material(recent_turns,
  turn_index, summarized)` — 아직 요약하지 않은 지난 턴(끝에서 (turn − summarized − 1)번째 사용자 말부터 — `last_turns`, 턴 밖 노트가 섞여도 안 빠진다) · `gist_lines(memory)` — "요약" 줄(주입 꼴 제외) ·
  `kept_lines(previous)` — 비운 배열일 때 남길 이전 줄(게이트 술어·옛 원문 조각 제외, 멱등). **`compress_fallback` 은 없앴다**(미결 #10 B안).
- `dialogue_orchestrator._recalled_lines(current, others, mine, theirs)`(mine = 이 세션 검색, theirs = 같은 계정 검색) — 꺼낸 `$memory`: "요약" 줄 + 점수 ≥0.45 사실 줄 ≤6(이 대화 먼저, 다른 세션은
  헤더 아래). `_memory_lines(current, others)` 는 임베딩이 없거나 꺼내기가 실패했을 때의 줄로 남는다.
- 오케스트레이터 생성자 += `embedding: EmbeddingPort | None`(조립은 질문뱅크·KB-5 와 같은 임베딩) · `memory_pool: Executor | None`(뒤의 요약 —
  기본 전용 풀 2, 테스트는 같은 스레드 실행기).

### 2.7 `ShadowRecord` — 섀도 비교 기록 (`orchestrator/shadow_probe.py`)

```
ShadowSide (frozen):
  intent: str                      # Intent.value
  route: str                       # 서비스: "LLM_DIRECT" 고정 / 섀도: MatchRoute.value
  confidence: float
  llm_calls: int                   # 서비스: TurnOutcome 의 분류 호출 수 / 섀도: ShadowCountingLlm 인스턴스 카운터
  latency_ms: int
  refused: bool                    # intent_eval.is_refusal(match)
  reason: str | None               # 섀도만 (escalated_from·bank_miss…). 서비스 측은 None

ShadowRecord (frozen):
  trace_id: str                    # 원 요청 trace_id (섀도 LLM 호출의 trace_id 는 f"{trace_id}:shadow" — 비용 장부 분리)
  turn_index: int
  service: ShadowSide
  shadow: ShadowSide
  utterance_chars: int             # normalize 뒤 길이
  utterance_sha12: str             # sha256(normalize(utterance))[:12]
  meta: Mapping[str, object]       # 측정 조건 dict — bank_sha · t_high · t_mid · vote_ratio · intent_margin · intent_prompt · shadow_prompt
                                   # (`api/dialogue.shadow_meta` 가 채운다); post-init 이 utterance·slots·account_ref 키를 거절한다
  agree -> bool                    # 파생 property: service.intent == shadow.intent (필드가 아니다 — 어긋날 수 없다)
  to_json() -> str                 # 한 줄, ensure_ascii=False, 키 순서 고정 — 첫 키 "event":"intent_shadow"(skip 줄은 "intent_shadow_skipped")
```

(초판의 `ShadowMeta` dataclass·`agree: bool` 필드는 코드가 dict + 금지 키 검사·파생 property 로 접었다 — 2026-10-18 코드 현행으로 개정.)

**원문·slots·account_ref 필드가 타입에 없다** — 구조로 로그 금지를 보장한다(SEC-U8-06, AO-P9). 샘플링에서 빠진 턴·포화로 건너뛴 턴은
`intent_shadow_skipped {"trace_id","why":"sampled_out"|"saturated"}` 한 줄로 따로 남긴다(세는 쪽이 분모를 알아야 한다).

### 2.8 시한·상한 상수 — `dialogue_orchestrator` 모듈 상수 (초판 `DialogueOrchestratorConfig` 는 2026-10-18 리뷰로 삭제)

```
# dialogue_orchestrator.py 모듈 상수 — 값은 아래 그대로 (코드 이름: DEFAULT_DEADLINE_MS · _INTENT_CAP_MS/_INTENT_SHARE · _FANOUT_CAP_MS/_FANOUT_SHARE ·
# _ANSWER_CAP_MS/_ANSWER_RESERVE_MS/_ANSWER_MIN_REMAINING_MS · _MEMORY_MIN_REMAINING_MS/_MEMORY_CAP_MS · _OTHER_SESSIONS_LIMIT)
# [개정 · 2026-10-23] _MEMORY_MIN_REMAINING_MS·_MEMORY_CAP_MS·_TURN_LLM_CAP 삭제(요약이 턴 밖) → _MEMORY_TIMEOUT_S = 8.0 ·
#   _RECALL_TOP_K = 6 · _RECALL_MIN_SCORE = 0.45 · _RECALL_WAIT_MS = 300. summary_every_turns 10 → 3, 프롬프트 $history 최근 3턴(PROMPT_TURNS) + 기억이 덮지 못한 턴
  default_deadline_ms: int = 9_000        # 백엔드가 deadline 을 안 보냈을 때 (미결 #5)
  max_recent_turns: int = 20
  recent_turn_chars: int = 300
  utterance_max_chars: int = 500
  # 시한 배분 (BLM §4)
  intent_timeout_cap_ms: int = 4_000 ; intent_timeout_share: float = 0.45   # 2026-10-18 실측 개정(초판 2_500·0.35, BLM §4 註)
  fanout_cap_ms: int = 3_000 ; fanout_share: float = 0.40
  answer_timeout_cap_ms: int = 3_500 ; answer_reserve_ms: int = 400 ; answer_min_remaining_ms: int = 1_500   # 초판 2_500
  memory_min_remaining_ms: int = 2_500 ; memory_timeout_cap_ms: int = 2_000
  # 메모리
  summary_every_turns: int = 10 ; summary_max_lines: int = 20 ; summary_line_chars: int = 120
  memory_ttl_days: int = 90 ; other_sessions_limit: int = 2
  # 답변
  answer_max_chars: int = 400 ; answer_max_lines: int = 6 ; candidates_max: int = 5
```

값은 브리프가 고정한 숫자다. **env 로도 생성자로도 노출하지 않는다**(바뀌지 않는 값의 설정화 금지) — 코드 현행은 위 표의 시한 배분·
`default_deadline_ms`(공개 `DEFAULT_DEADLINE_MS`, 경계 사영이 import)·`other_sessions_limit` 만 `dialogue_orchestrator.py` 모듈 상수
(`_INTENT_CAP_MS`·`_INTENT_SHARE`·`_FANOUT_CAP_MS`·`_FANOUT_SHARE`·`_ANSWER_CAP_MS`·`_ANSWER_RESERVE_MS`·`_ANSWER_MIN_REMAINING_MS`·
`_MEMORY_MIN_REMAINING_MS`·`_MEMORY_CAP_MS`·`_OTHER_SESSIONS_LIMIT`)로 둔다. 운영 조립도 테스트도 비기본값을 넣은 적이 없어 설정 묶음과
그 범위 검증을 지웠다 — 시한 시나리오는 주입 시계(`FakeClock.advance`)로 만든다. 답변·요약 길이 상한(400자·6줄·20줄·120자·후보 5)의
정본은 게이트(`gates/dialogue_answer`·`gates/dialogue_memory`)와 `dialogue_handlers`·`DialogueMemory` 상수다.

**[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 상수 넷 — `_PLAN_CAP_MS = 3_000`→**3_500**(**[개정 · 2026-10-20 · 계획 상한]** 로컬 러너 시한 잘림 — 같은 시각 짝 4/78 → 2/78, 날 합 10/154 → 15/864. 운영 실효 시한은 min(3.5s, 0.45R) ≈ 3.3s(분류 1.6s 턴) — BLM §4) · `_PLAN_SHARE = 0.45` · `_PLAN_MIN_REMAINING_MS = 4_600`(답변 시도선 1.5s 를 지키는 최소 4,542ms — BLM §4 註) · `_TURN_LLM_CAP = 3`(턴당 서비스 LLM 상한 — 계획 턴의 요약 미룸, BR-AO-09). 같은 규칙으로 env·생성자에 노출하지 않는다. 도구 계획 상한 `MAX_PLAN_CALLS = 2`·`MAX_ARG_CHARS = 40` 은 `domain/plan_tools.py`(게이트·프롬프트가 같은 값을 본다).

### 2.9 `PoiInfo` 패킷 — `ProviderKind.POI_INFO` 신설 (`providers/poi_info.py`)

`domain/freshness.py` 의 `ProviderKind` 에 **`POI_INFO` 1값을 추가**한다(closed-set 변경 — 전 Provider 스윕 테스트가 있으면 함께 갱신).
`INFO_REQUIREMENTS[Intent.GET_POI_INFO] = (ProviderKind.POI_INFO,)` 행을 넣어 `UnknownIntentError` 를 없앤다. 그 외 의도의 행은 바꾸지
않는다 — 오케스트레이터는 `collect` 를 부르지 않고 Provider 를 직접 팬아웃하므로(BLM §6) 표는 **문서·테스트용 정합**이다.

```
PoiInfoProvider(poi_db: PoiDbPort, fees: FeeTable).fetch(params) -> InfoPacket
  params: {"poi_ids": tuple[str, ...] (1..200), "on": date | None, "now": datetime}
  data (status OK | LOW):
    {"pois": [{"poi_id", "name", "category", "lat", "lng", "hours_label": str|None, "fee": int|None, "source_ref": str|None}],
     "misses": [poi_id, ...]}
  status: OK = 전부 찾음 · LOW = 일부 miss · UNAVAILABLE = poi_db 예외 (data {"reason"})
  freshness: FreshnessMeta(source="M7", fetched_at=now, cache_hit=False, ttl_sec=86400, stale=False)
```

LLM 0회(L-5). `hours_label` 은 `on` 의 요일(없으면 `now` 의 요일)로 `Poi.open_hours` 에서 결정론으로 만든다 — 규칙은
`agents/planb/composition.hours_label` 과 같아야 하며 providers 가 agents 를 import 하지 않게 함수의 집을 옮기는 일은 미결 #16.
`lat`·`lng` 는 패킷 안에만 있고 `Facts`·프롬프트·응답으로 나가지 않는다 — 2파 작업(Weather anchor·Transit origin/destination·풀 anchor)의 재료다.

### 2.10 `LlmFeature` 3종 추가 (`domain/llm.py` — BR-AF-07 세트)

| 값 | 티어 | effort | max_tokens | fallback_modes | 게이트 | 프롬프트 |
|---|---|---|---|---|---|---|
| `DIALOGUE_INTENT` | LIGHT | ~~low~~ **none**(**[개정 · 2026-10-20 · 분류·답변 사고 끔]** 0.2.4 와 함께 — 규칙+effort 합친 효과, 238회 나란히: p50 1.53→1.23s·p90 2.51→2.08s·두 질문 40→90%(n=10, 같은 설정의 앞선 런 기준선은 10%)·평가셋 판단 오답 2→3(모양 드롭 1), 시한 초과 0→4 는 앞선 런과 합쳐 5 대 5. 0.2.4+low 판은 재지 않았다) | 1024(초판 256 — DEV 배포 smoke 실측 출력 239/256, 사고 포함, 2026-10-18) | `("llm_dialogue_intent", "out_of_scope")` | `IntentGate`(재사용) | `prompts/dialogue_intent.yaml` ~~v"0.2.1"(의도 정의·판단 순서·예시, 고정부 앞)~~ **[개정 · 2026-10-19 · 짧은 수락]** v"0.2.2"(의도 정의·판단 순서·예시 + 짧은 수락을 마지막 도우미 제안으로 푸는 규칙 한 줄·예시 2건, 고정부 앞) **[개정 · 2026-10-19 · 장소 탐색]** v"0.2.3"(+ EXPLORE_PLACES 정의 한 줄·SUGGEST_ALTERNATIVE 와의 갈림·판단 순서 4 한 갈래·예시 2건; `$intents` 는 `tool_specs_json(DIALOGUE_INTENTS)` — 14종, intent.yaml 은 13종 그대로 — BR-AO-27) **[개정 · 2026-10-20 · 두 질문은 계획으로]** v"0.2.4"(+ 서로 다른 조회 둘 이상을 같이 묻는 말은 `{"intent": null}` 규칙 한 줄·판단 순서 4 꼬리·예시 1건 — 한 곳의 여러 속성·바꾸는 요청은 하나, BR-AO-28) **[개정 · 2026-10-22 · 행사 탐색]** v"0.2.6"(0.2.5 위 + EXPLORE_PLACES 정의에 "축제·공연·전시가 열리는지·언제인지도 여기" 한 구절 — 예시·판단 순서는 그대로, BR-AO-27) — `$utterance $intents $history $memory $trip` |
| `DIALOGUE_ANSWER` | LIGHT | ~~low~~ **none**(**[개정 · 2026-10-20 · 분류·답변 사고 끔]** 27회 나란히(단일 사실 9사례): 폴백 3→2건(시한 3→1·게이트 드롭 0→1)·p90 3.50→2.34s(low 쪽은 시한이 p90 자리라 3.5s 상한 값)·짝 위반 0·말투 셋 0 — 답변 담당 세션 원문 검수. **[개정 · 2026-10-21]** 계획 병합 답을 넣은 22사례 ×3 재측정: low 게이트 100%·p50 1.35s·p90 1.87s·시한 0 / none 98.5%·1.43s·2.42s·시한 1, 짝 위반 둘 다 0, 출력 토큰 63.5 대 64.4 — low 도 사고를 거의 쓰지 않아 effort 의 지연 차이는 잡음 수준이다(none 유지는 계획 단계와 같은 값이라는 정도의 근거)) | 512 | `("llm_dialogue_answer", "template_text")` | `DialogueAnswerGate`(신규 파일) | `prompts/dialogue_answer.yaml` ~~v"0.2.0"(답변 순서·예시, 고정부 앞)~~ **[개정 · 2026-10-19 · 친근한 말투]** ~~v"0.3.0"(친근한 해요체 대화 — 맞장구 → 답 → 다음 한 걸음 제안·되묻기, 예시 2건 재작성·숫자 말 규칙, 고정부 앞)~~ **[개정 · 2026-10-19 · 여는 말]** v"0.3.1"(0.3.0 + 어디에나 붙는 여는 말 금지·질문과 이어지는 마무리 규칙, 예시 여는 말 제거 + 날씨 예시, 고정부 앞) **[개정 · 2026-10-20 · 후보 마무리]** v"0.3.2"(후보 답은 같이 물은 것을 다 답한 뒤 마지막 문장만 [의도]에 맞는 고르기 — 탐색 OPEN_PLACE·대신 갈 곳 PICK_CANDIDATE, 여러 곳 영업시간·거리 제안·분류 읽기·칸 이름 금지, 병합 예시) **[개정 · 2026-10-20 · 장소 소개]** v"0.3.3"(0.3.2 + 장소 소개 detail.intro 는 한두 문장으로 줄여 말하기·주입 방어 대상을 소개 글까지) **[개정 · 2026-10-22 · 행사 답]** v"0.3.6"(0.3.5 + 행사를 알려 준 답은 누르라고 하지 않고 근처에 가 볼 만한 곳을 찾아 드릴지 물으며 마무리) — `$intent $facts $utterance $history $memory $trip $style` |
| `DIALOGUE_MEMORY` | LIGHT | low | 2048(20줄×120자 ≈ 1,000~1,500 토큰 + JSON — 1024 는 잘림 위험; 상한은 잘림 방지용, 과금은 실 출력만) | ~~`("llm_dialogue_memory", "deterministic_compress")`~~ **[개정 · 2026-10-23]** `("llm_dialogue_memory", "kept_previous")` — 실패면 이전 기억 그대로 | `DialogueMemoryGate`(신규 파일) — **[2026-10-23]** += ⑦ 종류 표지 6종 ⑧ "요약" ≤2 | `prompts/dialogue_memory.yaml` ~~v"0.1.0"~~ **v"0.2.0"**(줄마다 종류 표지·재료는 아직 요약하지 않은 턴) — `$previous_summary $recent_turns $trip` |
| `DIALOGUE_PLAN` **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** | LIGHT | **none**(2026-10-20 실측 — low 대비 p50 1.61→1.36s·출력 60→32 토큰·도구 일치 90.0→95.0%; luna 는 minimal 거부·none 수용) | 1024(분류와 같은 근거 — JSON 한 줄 + 사고 토큰) | `("llm_dialogue_plan", "out_of_scope")` | `DialoguePlanGate`(신규 파일 — 노출 도구 closed-set) | `prompts/dialogue_plan.yaml` v"0.1.1"(값 출처에서 [여행 상황] 제외·region 은 말한 지역만·"둘 다"·지역 둘 예시) **[개정 · 2026-10-20 · gap 좁힘]** v"0.1.2"(gap PLACE_DETAIL = 장소 정보 도구에도 없는 정보(메뉴·가격표·후기·주차) — #1466 부터 일정 밖 등록 장소는 그 도구가 찾는다 · 일정 밖 장소 입장료 예시 1건) **[개정 · 2026-10-22 · 행사 탐색]** v"0.1.5"(0.1.4 위 + 장소 찾기에 축제·공연·전시 포함·gap EVENTS 를 예매·출연진·세부 순서로·예시 1건) — `$tools $history(최근 4건) $trip $utterance`(`$memory` 없음) · 출력 `{"calls", "refused", "gap"}` · 재시도 미배정(턴당 1회) |
| `DIALOGUE_KNOWLEDGE` **[신설 · 2026-10-23 · 일반 지식 즉답(BR-AO-32)]** | LIGHT | none(답변과 같은 자리) | 512(2~4문장 JSON) | `("llm_dialogue_knowledge", "out_of_scope")` | `DialogueKnowledgeGate`(신규 — 답변 게이트 + 가격·특정 날짜·연도·거리·노선 번호, `{"text": null}` = 성공·0건) | `prompts/dialogue_knowledge.yaml` v"0.1.0" — `$utterance $history(오케스트레이터가 자른 창) $memory $trip` · 워커 `DialogueKnowledgeWorker`(UnknownHandlingAgent 의 손) |

**[개정 · 2026-10-19 · 친근한 말투]** 답변 프롬프트 0.3.0 — 사용자 요청 "지금은 너무 answer 만 띄워 주는 느낌". 0.2.0 은 "짧게 답하세요"·"첫 문장에 답,
다음 문장에 꼭 필요한 보충만"을 시켰고 예시 둘이 한두 문장 단답이었다(말투는 규칙 줄보다 예시가 정한다). 해요체 대화로 **맞장구·공감 한마디 → 답(사실은
`$facts` 에서만) → 도우미가 이어서 할 수 있는 일(날씨·거리·다음 장소·대신 갈 곳·영업시간) 하나를 제안하거나 되묻기**로 바꾸고 예시 2건을 그 말투로 다시 썼다
(시각은 "14:00" 표기 그대로, Figma 밴드 b 말풍선 근거). 친근함이 사실을 늘리지 않는다 — 장소의 분위기·특징도 `$facts` 에 없으면 말하지 않고, 맞장구에 발화의 시각·숫자를
옮기지 않는다(문장 속 시각은 Facts 로만 대조한다 — 발화는 사실이 아니다, §7 INV-2). 공유 정규식
`_TIME_EXPR`·`_NUM`(리마인드·회고 게이트와 공유 — 바꾸지 않는다)이 "두 분이"·"이 분께"·"이 시간에는"을 소요 표현으로 읽어 답 전체가 템플릿으로 떨어지므로
규칙 줄로 피하게 하고 예시에도 쓰지 않는다. 400자·6줄·이모지 한도·평문·시각 표기·주입 방어 규칙, 게이트·티어·effort·max_tokens 는 그대로.
마무리 제안 규칙에는 "방금 확인할 수 없다고 한 것을 다시·더·따로 확인해 주겠다고 하지 말 것"·"길 안내·이동 경로" 금지를 함께 둔다 — 실 LLM 54회에서 "영업시간을 더 확인해 드릴까요?"(같은 답이 되풀이된다) 17회·"이동 경로" 3회가 나왔고, 이 줄을 넣은 판은 0·0(같은 시각 나란히, 게이트·지연 차이 없음 — 2026-10-19).

**[개정 · 2026-10-19 · 짧은 수락]** 분류 프롬프트 0.2.2 — 위 답변 0.3.0 이 답을 제안·되묻기("…날씨도 확인해 드릴까요?")로 끝내므로 "응"·"좋아"·"그래"·"네 알려줘"
같은 짧은 수락 턴이 는다. 0.2.1 에는 그 수락을 `$history` 의 마지막 도우미 제안으로 풀어 읽는 규칙·예시가 없어 `{"intent": null}`(→ OUT_OF_SCOPE)로 떨어질 수 있었다.
규칙 한 줄 — 마지막 도우미 말이 제안·되묻기로 끝났고 현재 발화가 짧은 수락이면 **그 제안의 의도**로 고르고, 제안에 나온 장소·날짜를 **그 의도의 parameters 에 있는
이름으로만** 담는다. 짧은 사양("아니"·"괜찮아")은 할 일이 없어 그대로 `{"intent": null}`(범위 밖)이지만 규칙을 바꾸려는 요청과는 다르다 — 지시 주입은 발화 전체가
null 이고, 사양 뒤에 붙은 요청은 그 요청으로 고른다. 판단 순서 1·5 에 같은 뜻의 괄호를 달았다("응"을 홀로 보고 null 로 닫거나 "발화에 나온 값만"으로 제안의 값을 비우지 않게).
예시 2건(GET_WEATHER `date` · SUGGEST_ALTERNATIVE `target`)은 평가셋(`data/intent_eval_set.yaml`)·측정 스크립트 문장이 아니다(leak 금지). GET_WEATHER 는 묻는 인자가
`date`·`period` 뿐이라(`region` 은 `lands_in=None` — 묻지 않는다) 제안의 장소를 담지 않는다 — 표 밖 키는 `IntentGate` ⑤가 그 키만 버리고 `GateDropEvent` 로 센다.
게이트는 그대로다 — 슬롯의 모양·키만 보고 값이 발화에 있는지는 보지 않는다(지시어 풀이와 같은 선례). 티어·effort·max_tokens·출력 모양·`$intents` 무변.

출력 모양 — INTENT: `{"intent": str|null, "slots": {...}, "confidence": n}`(intent.yaml 과 동형) · ANSWER: `{"text": str, "footnote": str|null}` ·
MEMORY: `{"lines": [str]}`. 게이트 규칙은 BR-AO-04(답변)·BR-AO-09(메모리). 세 feature 모두 **벤더 호출 본문에 발화·최근 턴이 실린다**
— SEC-U8-06 의 "LLM 벤더 호출 본문" 범주(허용된 두 곳 중 하나).

`fallback_modes` 의 to_mode 라벨은 구현 스텝의 `llm_gateway/config.py` 와 같게 적었다 — 답변 폴백은 `template_text`(`Facts.template_text` 로 간다는 뜻).
`Facts.template_text`(답변 타입의 결정론 문장 칸 — §2.5)와는 다른 자리다(전자는 게이트웨이 `FallbackEvent` 의 to_mode 어휘).

---

### 2.11 도구 계획(2‴) 타입 **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]**

```
PlanTool (frozen, domain/plan_tools.py):
  summary: str                    # 모델에게 보일 "무엇을 돌려주나 · 못 하는 것" 한 줄 1..80자
  needs: tuple[str, ...] = ()     # 쓰는 HandlerPorts 칸 — 하나라도 None 이면 노출하지 않는다
  hide: tuple[str, ...] = ()      # 인자표에 있지만 핸들러가 안 읽는 인자 — 광고·게이트 허용 키에서 뺀다(GET_WEATHER period)
PLAN_TOOLS: Mapping[Intent, PlanTool]   # 정보 핸들러 7종 · NEVER_TOOLS(편집·넘기기 6·범위 밖) · PLAN_TOOLS ∪ NEVER_TOOLS = DIALOGUE_INTENTS ∪ {OUT_OF_SCOPE}
PLAN_GAPS = (EVENTS, REGION_WEATHER, PLACE_DETAIL, TRANSPORT, AMENITY, BOOKING, LODGING, KNOWLEDGE, ACCOUNT, CHAT, OTHER)   # 관측 전용

DialoguePlanDraft (frozen, llm_gateway/gates/dialogue_plan.py):
  calls: tuple[IntentDraft, ...] = ()   # 0..2 · slots 는 str 값 · confidence None (IntentDraft 재사용 — 새 call 타입 없음)
  refused: bool = False
  gap: str | None = None
  # post-init: len(calls) ≤ 2 · refused ⇒ calls=() · gap ∈ PLAN_GAPS ∪ {None} · calls ⇒ gap None · 값 전부 str

merge_facts(parts: Sequence[Facts]) -> Facts   (orchestrator/dialogue_plan.py, 순수)
  # 1건이면 그대로. 대표 = min(쓸 수 없음, UNAVAILABLE, 종류 순위 CANDIDATES<INFO<TEXT, PARTIAL, 계획 순서)
  # 카드·버튼·템플릿·상태·의도·places = 대표 것 · 나머지 사실 있는 부분 → detail["also"] = [p.to_prompt_dict()] · needTrip 부분은 다른 부분이 있으면 뺀다
```

`dialogue_plan` 로그 필드(BR-AO-29):

| 필드 | 값 |
|---|---|
| `event` | `"dialogue_plan"` |
| `trace_id` | 턴 trace |
| `decision` | TOOLS · NO_TOOL · REFUSED · FALLBACK · SKIPPED |
| `tools` · `arg_keys` | 고른 도구 이름 · 도구별 인자 **키**(정렬) — 값은 없다 |
| `gap` | NO_TOOL 의 `PLAN_GAPS` 값 또는 null |
| `primary` | 병합 대표 의도 또는 null |
| `plan_ms` | 계획 호출 경과(부르지 않았으면 null) |
| `task_status` | 작업별 전송 결과(`{"0.weather": "OK", "1.explore": "TIMEOUT"}`) — 도구별 TIMEOUT 률 |

금지 칸: 발화·인자 값·account_ref(SEC-U8-06).

## 3. 와이어 변경 (경계 `POST /ai/v1/dialogue/interpret` + 새 경계 2개)

**규칙**: 요청 필드 추가는 `extra=forbid` 라 **AI 가 먼저 배포**돼야 백엔드가 보낼 수 있고, 응답 필드·`outcome` 값 추가는 백엔드 와이어
게이트(정확 동등)·`InterpretOutcome` enum 때문에 **백엔드가 받을 준비가 된 뒤** AI 가 내야 한다. 그래서 한 PR, 배포는 AI(오케스트레이터 off) →
BE → DEV 시크릿 on 순(BLM §13).

### 3.1 요청 `DialogueInterpretRequest` +=

| 필드 | 타입·제약 | BE 출처 | 비고 |
|---|---|---|---|
| `session_id` | `str \| None` (1..64) | `assistant_session.session_id` | 메모리 PK. None 이면 메모리 단계 생략 |
| `account_ref` | `str \| None` (1..64) | 계정 id 문자열 | **AI 경계를 처음 넘는 사용자 식별자** — 보안 검토 미결 #8. 로그·프롬프트 금지 |
| `recent_turns` | `list[DialogueTurnSchema{role: Literal["USER","ASSISTANT"], text: str(1..300)}]`, `max_length=20`, 기본 `[]` | `messages.findPage(sessionId, null, 20)` 중 `text != null`(가려진 입력 제외), 오래된 → 최신 순, 300자 절단 | 단기 기억. AI 저장 0 |

`DialogueContextSnapshot`·`DialogueSlotSchema` 는 **1단계 무변경**(좌표·`end_at`·`is_fixed` 추가는 2단계 §9 — 백엔드 화이트리스트 테스트
`ContextSnapshotBuilderTest` 의 부재 단언을 함께 바꿔야 하는 일이라 이 PR 에 넣지 않는다).

### 3.2 응답 `DialogueInterpretResponse` +=

| 필드 | 타입·제약 | 비고 |
|---|---|---|
| `outcome` | 값 `"ANSWER"` 추가 (타입은 평문 `str` 유지 — 스냅샷 무변경, 주석 갱신) | 백엔드 `InterpretOutcome.ANSWER` 동시 추가. `varchar(32)` 안 |
| `answer` | `DialogueAnswerSchema \| None` = `{kind: Literal["TEXT","INFO","CANDIDATES"], text: str(1..600), payload: dict \| None, next_actions: list[DialogueNextActionSchema{type: str, label: str, params: dict[str,str]}] (min_length=1), quick_replies: list[DialogueQuickReplySchema{label, action, params}] \| None, footnote: str \| None}` | 백엔드 `HttpDialogueInterpreterTest` 의 응답 키 집합 단언을 `{…, "answer"}` 로, 새 스키마 3종의 키 집합 단언 추가. 백엔드 `WireResponse.answer` 기본 null |

`frames`·`clarify`·`dialogue_context`·`llm_calls` 는 무변경. ANSWER 일 때 `frames` 는 길이 1(분류 프레임), `clarify` null.
`INV-3` 계약 게이트(필드명에 `duration·minutes·stay_min·travel_time·elapsed` 금지)는 새 스키마 이름이 자동으로 통과한다 — `distanceRange` 는
payload 안 값이고 필드명이 아니다.

### 3.3 새 경계 — `/ai/v1/dialogue/memory` (쿼리 전용, 본문 없음)

| 메서드 | 쿼리 | 응답 | 호출자 |
|---|---|---|---|
| `DELETE /ai/v1/dialogue/memory` | `session_id` \| `trip_id` \| `account_ref` **정확히 하나**(둘 이상·없음 → 422) | **200** `DialogueMemoryDeleteResponse{deleted: int}` — **멱등**, 지울 것이 없으면 `deleted: 0`(오류 아님). 미결 #12 **해소**(2026-10-17 브리프 최신판 — 204 는 본문 `{deleted}` 와 양립 불가라 200 으로 확정) | BE `AssistantSessionService.clear`(session_id) · `deleteForTrip`(trip_id) · `AssistantRetention.purgeAccount`(account_ref) |
| `GET /ai/v1/dialogue/memory` | `account_ref` 필수 | `DialogueMemoryExportResponse{memories: list[{session_id, trip_id, summary: list[str], summarized_turn_index, updated_at, expires_at}]}` | BE `AssistantExportContributor` → 섹션 `assistantMemory`(DATA-U8-06) |

- 두 경계 모두 `ServiceAuthMiddleware`(`X-Service-Token`) 뒤에 있다(기존 전 경로와 같음). `request_meta` 가 없는 **첫 경계**다 —
  미들웨어 `parse_wire_meta` 는 본문이 없으면 None 을 돌려주므로 trace_id 는 `x-trace-id` 헤더 또는 uuid4 가 된다(기존 규약).
- 라우트는 `getattr(orchestrator, "dialogue_memory_delete"/"dialogue_memory_export")` 패턴 + 배선 게이트(`build_dev_app()` 에 실존 —
  오케스트레이터 off 여도 `InMemoryDialogueMemoryStore` 가 있어 성립).
- `tests/api/test_api_openapi_contract.py` 의 경로 집합 리터럴에 `/ai/v1/dialogue/memory` 추가, `scripts/export_openapi.py` 재생성,
  `README-openapi.md` 갱신. 백엔드 assistant 모듈에 `DIALOGUE_PATHS = listOf("/ai/v1/dialogue/interpret", "/ai/v1/dialogue/memory")` +
  계약 실재 테스트(CALLED_PATHS 선례).
- 멱등: 같은 DELETE 를 두 번 보내면 두 번째는 `deleted: 0`(상태값, 오류 아님).

---

## 4. 메모리 테이블 — `ai_kb.public.dialogue_memory`

DDL 은 브리프 §2.2 **그대로**. 두 정본에 같이 넣는다 — `deploy/eks/bootstrap.sql`(`kb_vectors` 블록 뒤) + `ai/docker/vector-init/02-dialogue-memory.sql`(신규).

```sql
CREATE TABLE IF NOT EXISTS public.dialogue_memory (
  session_id            text PRIMARY KEY,      -- BE assistant_session.session_id
  account_ref           text,                  -- BE account id (불투명 문자열, 로그 금지)
  trip_id               text,
  summary               jsonb NOT NULL DEFAULT '[]',   -- ≤20 줄, 줄 ≤120자 (LLM 요약 또는 결정론 압축)
  summarized_turn_index integer NOT NULL DEFAULT 0,    -- 이 요약이 덮은 마지막 turn_index
  updated_at            timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL           -- updated_at + 90일 (BE DATA-U8-01 과 같은 값, 쓸 때 연장)
);
CREATE INDEX IF NOT EXISTS ix_dialogue_memory_account ON public.dialogue_memory (account_ref, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_dialogue_memory_trip ON public.dialogue_memory (trip_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dialogue_memory TO ai_user;
```

**[개정 · 2026-10-23 · 줄 벡터]** 같은 두 정본에 기억 줄 임베딩 표를 더한다(`deploy/eks/tests` 가 둘을 대조한다 — FK 대상보다 뒤에 만든다):

```sql
CREATE TABLE IF NOT EXISTS public.dialogue_memory_vectors (
  session_id text NOT NULL REFERENCES public.dialogue_memory (session_id) ON DELETE CASCADE,
  line       text NOT NULL,                 -- 그 세션 summary 의 한 줄 그대로
  model      text NOT NULL,                 -- 임베딩 모델 id — 바뀌면 옛 벡터는 검색에 안 걸리고 다음 요약 때 다시 만든다
  embedding  vector(1024) NOT NULL,
  PRIMARY KEY (session_id, line)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dialogue_memory_vectors TO ai_user;   -- bootstrap 에만(compose 는 소유자 롤)
```

- 행은 기억 행을 따라 지워진다(`ON DELETE CASCADE`) — 파기 3호출·TTL 정리가 벡터에도 그대로다. 검색은 기억 행과 조인해 계정·만료를 거르고
  `m.summary ? v.line` 으로 요약에 지금 있는 줄만 본다(`put` 이 요약을 갈아 끼운 행의 옛 줄 벡터가 남아도 걸리지 않는다). ANN 인덱스는 두지
  않는다 — 한 계정의 세션 수 × ≤20줄이라 조인 뒤 전수 비교로 충분하다.
- 기존 compose 볼륨에는 initdb 가 다시 돌지 않는다 — `02-dialogue-memory.sql` 을 `ai-vectordb` 에 다시 적용(멱등)하면 이 표만 생긴다.

- `ai_user` 는 CREATE 권한이 없다 — 어댑터는 DDL 을 하지 않는다(`PgVectorStore` 와 같은 규칙). 기존 compose 볼륨에는 initdb 가 다시 돌지
  않으므로 로컬은 `docker compose down -v` 또는 수동 적용(README-local 한 줄).
- 행 수명: `expires_at` 은 매 `put` 에서 `updated_at + 90일` 로 **연장**(슬라이딩 — 백엔드 세션과 같은 값). `put` 은 같은 트랜잭션에서
  `DELETE … WHERE expires_at <= now()` 를 한 번 실행한다(TTL 백스톱 — 백엔드 호출이 유실돼도 90일 뒤에는 사라진다).
- 길이 상한(20줄·120자)은 **애플리케이션 불변식**(`DialogueMemory` post-init)이고 DB CHECK 로 두지 않는다 — jsonb 배열 길이 CHECK 는
  가능하지만 두 정본 SQL 과 코드 셋에 같은 숫자를 박는 일이라 한 곳(타입)만 둔다.

### 4.1 파기 3호출(이력 지우기·여행 삭제·계정 삭제) + 만료는 AI TTL + 내보내기

| # | 사라지는 길 | 백엔드 트리거 | AI 호출 | 실패 시 |
|---|---|---|---|---|
| 1 | **만료** | `AssistantRetention.deleteExpired`(하루 1회) — AI 호출 없음 | AI 자체 TTL: `expires_at` + `put` 시 `purge_expired` | — (백스톱 자체) |
| 2 | **이력 지우기** | `AssistantSessionService.clear(sessionId)` (hard delete, 멱등) | `DELETE ?session_id=` | WARN 로그 + TTL 백스톱(90일). "지웠는데 기억한다"가 최장 90일 남을 수 있음 → 미결 #13 |
| 3 | **여행 삭제** | `TripDeletedSubscriber` → `deleteByTrip` | `DELETE ?trip_id=` | WARN + TTL 백스톱 |
| 4 | **계정 삭제** | `AccountDeletionSubscriber` → `AssistantRetention.purgeAccount` | `DELETE ?account_ref=` | **예외로 올려 아웃박스 재시도**(DATA-U8-02 즉시 파기 — 유실 금지) |
| E | **내보내기** | `AssistantExportContributor` | `GET ?account_ref=` → 섹션 `assistantMemory` | 실패는 내보내기 섹션 누락으로 드러난다(미결 #13 과 묶음) |

**[개정 · 2026-10-23]** 행 1~4 가 지우는 기억 행의 줄 벡터(`dialogue_memory_vectors`)는 FK `ON DELETE CASCADE` 로 같이 지워진다 —
호출·경계 변경 없음. 뒤에서 도는 요약의 저장은 있는 행만 고쳐(`advance`) 지운 뒤에 되살리지 않는다.

BE → AI 호출은 **3호출**(행 2·3·4)뿐이다. 행 1(만료)은 호출이 아니라 AI 쪽 TTL 백스톱이고, 그래서 이 표는 "4경로"가 아니라
**"3호출 + TTL"** 로 읽는다(브리프 최신판 2026-10-17). `http` 모드가 아닐 때(`fake`·`off`) 백엔드 `DialogueMemoryPort` 는 no-op 이다 —
AI 메모리가 생기지 않으니 지울 것도 없다.

---

## 5. 섀도 로그 — `intent_shadow {json}` 필드표 (로거 `trippilot.intent.shadow`, INFO, 턴당 1줄)

| 키 | 타입 | 출처 | 비고 |
|---|---|---|---|
| `event` | str | 고정 `"intent_shadow"` | 줄 종류 표지 — `intent_shadow_skipped`·`intent_shadow_error` 줄도 같은 키를 가진다(집계기가 줄을 가른다) |
| `trace_id` | str | `request_meta.request_id` | 섀도 LLM 호출 자체는 `f"{trace_id}:shadow"` 로 나가 `llm_cost` 누계가 섞이지 않는다 |
| `turn_index` | int | `DialogueContext.turn_index` | |
| `service.intent` · `.route`(`"LLM_DIRECT"`) · `.confidence` · `.llm_calls` · `.latency_ms` · `.refused` | | 서비스 분류 단계 결과(`TurnOutcome`·분류 LLM 1회) | `refused` = `is_refusal` 표지 |
| `shadow.intent` · `.route` · `.confidence` · `.reason` · `.llm_calls` · `.latency_ms` · `.refused` | | `IntentRouter.route(utterance, TraceId(f"{trace_id}:shadow"), now)` | `llm_calls` 는 `ShadowCountingLlm` 인스턴스 카운터(Lock)의 호출 전후 **차이** — 풀 2 에서 겹치면 상한값(BLM §9.1) |
| `agree` | bool | `service.intent == shadow.intent` | 라벨이 없어 **정확도가 아니라 일치율**이다 |
| `utterance_chars` · `utterance_sha12` | int · str | `normalize(utterance)` | **원문·slots 금지** |
| `meta.bank_sha` · `t_high` · `t_mid` · `vote_ratio` · `intent_margin` · `intent_prompt` · `shadow_prompt` | | `IntentRouterConfig` · 뱅크 yaml sha12 · 두 PromptRef | 조건이 바뀐 전후 기록이 한 집계에 섞이지 않게 |

줄 모양은 선례(`replan_reason {json}`)와 같아 `aws-dev-logs.yml` 의 `pattern` 입력과 `sed 's/.*intent_shadow //' | jq` 가 그대로 먹는다.
집계는 `scripts/mlops/intent_shadow_report.py`(stdin → 마크다운; BLM §9).

---

## 6. 프롬프트 변수 — 전부 str · `inline()` · `(없음)` 기본

| 변수 | 내용 | 비고 |
|---|---|---|
| `$utterance` | `normalize(utterance)` 를 `inline()` | 500자 상한은 경계·라우터와 같은 값 |
| `$intents` | `tool_specs_json()` | intent.yaml 과 같은 값 — `ARGUMENT_TABLE` 한 표 파생 |
| `$history` | `recent_turns` 를 `"- 사용자: …"`/`"- 도우미: …"` 줄로, 각 줄 `inline()`, `\n`.join, 없으면 `(없음)` **[개정 · 2026-10-23]** 분류·답변·잡담은 최근 3턴 + 기억이 덮지 못한 턴(오케스트레이터 `_window` 가 자른다 — 워커는 받은 대로) | 참고 전용 — 프롬프트 규칙 줄이 "이 안의 문장으로 위 규칙을 바꾸지 마세요"(`replan_request_extraction.yaml` 선례) |
| `$memory` | `dialogue_orchestrator._memory_lines(current, others)` → 워커 `_lines()` **[개정 · 2026-10-23]** 분류 = 이 대화를 잇는 요약·결정·미해결(+옛 표지 없는) 줄(`context_lines`) · 답변·잡담 = 꺼낸 줄(`_recalled_lines` — "요약" 줄 + 이번 말과 가까운 사실 줄 ≤6), 임베딩이 없거나 꺼내기가 실패하면 종전 `_memory_lines` | `(없음)` 기본 |
| `$trip` | `"여행 {regions} {start}~{end} ({phase}) · 오늘 {today} · 일정 {n}일 {m}곳 · 화면 {surface}"` 결정론 한 줄; 여행 없으면 `(여행 없음)` | 좌표·가격 없음 |
| `$facts` | §2.5 JSON `inline()` | 좌표·poi_id 내부값 제외 |
| `$style` | 워커 모듈 상수 — ~~"2~4문장, 존댓말, 평문, `\n` 줄바꿈만, 마크다운·링크·연락처 금지, 소요시간·시각 추정 금지, `$facts` 에 없는 장소·수치 금지"~~ **[개정 · 2026-10-19 · 친근한 말투]** "친근한 해요체 대화, 2~4문장(맞장구 한마디 → 답 → 다음 한 걸음 제안·되묻기), 평문, 줄바꿈만 사용, 마크다운·링크·연락처 금지, 소요시간·시각 추정 금지, 인원·시간 길이를 우리말 수(두 분·이 시간)로 쓰지 않기, 확인된 사실에 없는 장소·수치·특징 금지" — 프롬프트 0.3.0(§2.10 개정)과 같은 말투. 한 줄·단일 공백(워커가 `inline()` 으로 싣는다 — 렌더 결과에 그대로 있어야 한다) | 설정화하지 않는다 |
| `$previous_summary` · `$recent_turns` | 메모리 요약 입력 **[개정 · 2026-10-23]** `$recent_turns` = 아직 요약하지 않은 지난 턴 + 이번 턴(`material`) | 각 줄 `inline()` |
| `$tools` **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** | `plan_tool_specs_json(plan_tools(ports))` — parameters 는 `$intents` 와 같은 `tool_specs`(숨긴 인자 제외), description 만 도구 설명(+" (여행 필요)") | 배포마다 고정 — 고정부(벤더 캐시 접두), 7종 2,207자(렌더 전문 ≈4,800자). 계획 프롬프트의 `$history` 는 최근 4건, `$memory` 는 싣지 않는다 |

---

## 7. 불변식 정합

| 불변식 | 이 FD 에서의 의미 |
|---|---|
| **INV-1** | 의도 라벨은 `Intent` enum — `IntentGate` 가 `DIALOGUE_INTENT` 산출을 closed-set 으로 검사(벤더 아님). 후보(`CANDIDATES`)는 `PlanBAgent` 가 **반경 풀**(`CandidatePool`) 안에서만 고르고 일정 전부를 `excluded` 로 뺀다; `Facts.places` 는 배치 조회·풀에서 온 닫힌 목록이다. **LLM 문장 안의 장소명은 검사하지 못한다** — 그러나 그 문장은 선택·저장을 일으키지 않으므로 INV-1(후보 선택) 위반이 아니라 "보이는 문장 오염"이고, 수용된 blast radius 다(메모리 노트 prompt-injection-blast-radius, 재제안 금지) **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 계획 LLM 이 내는 것은 닫힌 도구 이름과 문자열 인자뿐 — 장소를 만들 수 없다. 후보는 등록 POI 반경 풀 안에서만, 문장은 목록 밖 장소 검사를 강제로 거치고 BE 가 poiId·OPEN_PLACE 를 정본 대조한다. |
| **INV-2** | 사용자에게 보이는 시각은 **스냅샷 `start_at`**(백엔드가 저장·검증한 값)만, 순서는 스냅샷 순서만. `PlanBRagResult.alternatives` 에는 시각 필드가 없다. LLM 은 `$facts` 밖 시각을 만들지 않도록 프롬프트 규칙 + `_TIME_EXPR` 게이트 + **Facts 대조(2026-10-18 — 문장 시각 ⊆ Facts, 장소에 붙은 시각은 그 장소의 값, BR §6 ③; 이름 없이 떠 있는 슬롯 시각끼리는 스냅샷 순서를 따른다, BR §6 ⑨)**가 막는다(`N시`·`오전/오후 N시` 매치 → 드롭 → 템플릿; `HH:MM` 은 Facts 복사만 — 프롬프트 규칙, BR-AO-05). `EDIT_SCHEDULE` 을 1단계에서 FRAME 으로 두는 이유도 이것이다 — 스냅샷에 `end_at`·`is_fixed` 가 없어 AI 가 시각을 지어내야 EditTask 가 만들어진다 **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 계획 스키마에 시각 칸이 없고 시각 꼴 인자는 게이트가 버린다. 핸들러는 원문 인자를 Facts 에 싣지 않는다. 병합 답의 시각은 also 까지 Facts 와 대조하고, 카드 종류와 관계없이 시각을 문장마다 그 문장의 이름에 귀속시킨다(`_unpaired_time` — 2026-10-20 #1420 리뷰로 정정본 C5 의 엄격 모드를 교체). 시각을 내는 도구(일정·다음 일정·장소 정보)는 계획당 1건이다. |
| **INV-3** | 거리만 — `TransitInfo.to_public_dict`(`distance_range`), `FactPlace.distance_range`. 소요시간 필드·문장 없음: 스키마 필드명 게이트 + `_TIME_EXPR` 출구 게이트 + AO-P2 **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 계획 경로도 거리 문자열뿐 — 답변 게이트 무변경. |
| **INV-4** | 계단 전부 결정론 수렴(BLM §7): 분류 실패 → OUT_OF_SCOPE(거절 표지 사유), 답변 실패 → `template_text`, 메모리 실패 → ~~`compress_fallback`~~ 이전 기억 그대로(`kept_previous`, 2026-10-23), Provider 실패 → 있는 것만 + `notes`, PlanB 실패 → TEXT 안내. 모두 `FallbackEvent`/`notes` 로 보고하고 침묵하지 않는다. 섀도 실패는 응답에 영향 없이 skip 로그 **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 계획의 모든 갈래가 종전 범위 밖·템플릿·needTrip 으로 수렴하고 폴백에는 이벤트 짝(BLM §7). 병합본도 post-init 을 통과해 Facts 만으로 항상 답이 만들어진다. |
| **DL-3** | 분류 1회(`DIALOGUE_INTENT`). Handler·PlanB 는 프레임의 intent 를 재해석하지 않는다; 섀도는 **관측 전용**으로 서비스 판정에 영향 0 **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** 계획은 분류가 판단해서 닫은 턴에만 — 분류가 고른 의도는 덮지 않고, 계획은 프레임을 만들지 않는다. |
| **DL-4** | 모든 하위 호출에 잔여 시한을 `timeout_sec` 로 내린다(BLM §4). 잔여 ≤0 이면 호출하지 않고 폴백 |
| **DL-5** | 오케스트레이터 경계에서 예외 금지 — 수렴값은 미결 #14 (두 안 병기) |

---

## 8. 테스트 더블 (신규 — `tests/fakes/`)

| 더블 | 용도 |
|---|---|
| `FeatureLlm(by_feature: Mapping[LlmFeature, str \| Exception])` | 한 요청에서 분류·답변·메모리 3 feature 를 다른 canned 로 — `request.prompt_ref.feature` 분기(`test_replan_composition` 로컬 클래스를 공용으로 승격). `FakeLlm` 은 feature 무관 1개라 부족 **[개정 · 2026-10-19 · 도구 계획(DIALOGUE_PLAN)]** `DIALOGUE_PLAN` canned 도 같은 더블 — 오케스트레이터 테스트 `_build(with_planner=True)` 가 운영과 같은 길(노출 도구 = 배선된 포트, 같은 counted LLM)로 계획 워커를 붙인다. |
| `InMemoryDialogueMemoryStore` | 운영 구현(`agents/adapters/memory_memory_store.py`)을 그대로 쓴다 — 별도 fake 없음 |
| `ScriptedProvider(kind, packets \| delays)` | 느린·실패하는 Provider — 팬아웃 시한 PBT(`FakeClock` 과 함께) |
| `StubPlanB(result)` | `PlanBAgent.run` 대역 — CANDIDATES closed-set PBT |
| `FakeClock` | 기존 — `build_orchestrator(clock=)` 로 주입 |

---

## 9. 2단계 예고 — EDIT 인프로세스 (이 PR 범위 밖)

| 변경 | 내용 |
|---|---|
| 스냅샷 슬롯 | `DialogueSlotSchema += end_at: time, is_fixed: bool` (좌표는 여전히 배치 조회로) — 백엔드 `ContextSnapshotBuilder`·`SlotBlock`·`ContextSnapshotBuilderTest` 화이트리스트 개정 + AI 스키마, **한 PR** |
| `EditTask` 조립 | `solution` ← 스냅샷(`start_at`·`end_at`·`is_fixed`), `pool` ← 대상 좌표 앵커 반경 풀, `poi_index` ← 배치 조회, `transport=PUBLIC`·`budget=MID` 기본(현 /edit 와이어 기본값과 동일) |
| 답변 | `AnswerKind.PROPOSAL` + `proposal{base_days, days, apply_hint, violations}`(`EditProposal.Proposed` 와 같은 모양) → 백엔드 `ProposalCards.proposed` 재사용(ground·`ItineraryFingerprint.of(baseDays)`·diff) — **저장은 여전히 `/apply`**(DEC-U8-2/3) |
| `CONFIRM_REQUIRED` | `EditOutcome.CONFIRM_REQUIRED` 는 사용자 확인 왕복 — `ArgumentClarify`·`NEED_MORE_INFO` 와 **섞지 않는다**(BR-DLG-25) — 별도 outcome 또는 PROPOSAL 의 `apply_hint` 로 표현(2단계 FD 에서 결정) |
