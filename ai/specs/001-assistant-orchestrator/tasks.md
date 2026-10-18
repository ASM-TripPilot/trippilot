---
description: "도우미 오케스트레이터 1단계 구현 태스크 (spec.md · plan.md · FD 3종 기준)"
---

# Tasks: 도우미 오케스트레이터 (assistant-orchestrator) — 1단계

**Input**: `specs/001-assistant-orchestrator/{spec,plan,research}.md` + FD `ai/aidlc-docs/construction/assistant-orchestrator/functional-design/` 3종

**Prerequisites**: plan.md ✅ · spec.md ✅ · FD domain-entities ✅ · FD business-logic-model·business-rules(작성 중 — BR-AO-* · AO-P* ID 는 그 문서가 정본)

**Tests**: 요청됨 — 헌법 III(TDD + PBT 차단 게이트). 각 구현 태스크는 실패하는 테스트를 먼저 쓴다. CI 실 외부 호출 0.

**Organization**: 사용자 스토리별이 아니라 **의존 계층별**이다 — US1~US5 가 전부 같은 오케스트레이터 한 턴을 공유해 독립 배포 단위가 아니고, AI·BE 계약은 한 PR 이어야 한다(plan.md Structure Decision). 각 태스크에 관련 스토리를 적는다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일·의존 없음 → 병렬 가능
- 경로는 모노레포 루트 기준. 작업 트리 `/Users/juna/dev/trippilot/wt-chat-orchestrator`

## Phase 1: LLM 기능 3종 (BR-AF-07 세트 — worker-builder 레시피)

**Purpose**: 분류·답변·요약 워커. 전부 새 파일, 공유 파일은 enum·config 표 항목 추가만.

- [X] T001 [P] [US1,US4] `ai/src/trippilot/domain/llm.py` — `LlmFeature.DIALOGUE_INTENT`·`DIALOGUE_ANSWER`·`DIALOGUE_MEMORY` 추가(주석에 근거). `ai/src/trippilot/llm_gateway/config.py` — `default_tier_map` 3항목 LIGHT, `default_feature_effort` 3항목 `low`, `default_feature_max_tokens`(DIALOGUE_INTENT 256·DIALOGUE_ANSWER 512·DIALOGUE_MEMORY 1024), `default_fallback_modes`: `("llm_dialogue_intent","out_of_scope")`·`("llm_dialogue_answer","template_text")`·`("llm_dialogue_memory","deterministic_compress")`. 테스트 `ai/tests/llm_gateway/test_llm_gateway_gateway.py::_EXPECTED_MODES` 3항목·`test_llm_output_caps.py` 기대값 추가.
- [X] T002 [P] [US1,US4] `ai/prompts/dialogue_intent.yaml` v"0.1.0" — `intent.yaml` 규칙 줄 복제 + 변수 `$utterance $intents $history $memory $trip`, 주입·역할변경·유해 → `{"intent": null}`, 이력은 참고만(현재 발화가 우선). `ai/src/trippilot/llm_gateway/workers/dialogue_intent.py` — `build_dialogue_intent_vars(utterance, recent_turns, memory_lines, trip_summary)`(전부 str·`inline()`·`(없음)` 기본) + `DialogueIntentWorker(gateway).classify(..., *, timeout_sec) -> TypedResult`(게이트 = 기존 `IntentGate` 재사용). 테스트 `ai/tests/llm_gateway/test_dialogue_intent_worker.py`: 렌더 결정론·FakeLlm canned→IntentDraft·null→폴백·주입 말뭉치(`tests/llm_gateway/test_gate_injection_defense.py` 자산 재사용)→폴백·`$intents`==`tool_specs_json()`.
- [X] T003 [P] [US1,US4] `ai/prompts/dialogue_answer.yaml` v"0.1.0" — 변수 `$intent $facts $utterance $history $memory $trip $style`; 규칙: facts 에 있는 사실만, 시각·소요시간 생성 금지, 평문·≤400자·줄 ≤6, 이모지 ≤1, JSON `{"text": str, "footnote": str|null}`. `ai/src/trippilot/llm_gateway/gates/dialogue_answer.py` — `DialogueAnswerGate`(비어있음·>400자·줄 >6·`_TIME_EXPR`·`has_contact_like` → 드롭 + GateDropEvent + `empty_result_error`). `ai/src/trippilot/llm_gateway/workers/dialogue_answer.py` — `build_dialogue_answer_vars(...)`(facts 는 `json.dumps(ensure_ascii=False, sort_keys=True)` 뒤 `inline()`) + `DialogueAnswerWorker.compose(..., *, timeout_sec) -> TypedResult` + 결정론 템플릿 `fallback_answer_text(intent, facts) -> str`(BE `AssistantTemplates` 문구 이식, 게이트 규칙 자가 만족 — 테스트 고정). 테스트 `ai/tests/llm_gateway/test_dialogue_answer.py`.
- [X] T004 [P] [US3] `ai/prompts/dialogue_memory.yaml` v"0.1.0" — 변수 `$previous_summary $recent_turns $trip`; 출력 `{"lines": [str]}` ≤20줄·줄 ≤120자, 사용자 선호·결정·거절·미해결만, 원문 인용 금지. `ai/src/trippilot/llm_gateway/gates/dialogue_memory.py` — `DialogueMemoryGate`(배열형: 항목 격리·중복 제거·상한 20·줄 ≤120·연락처·소요시간 → 항목 드롭, 빈 결과 = 실패). `ai/src/trippilot/llm_gateway/workers/dialogue_memory.py` — `DialogueMemoryWorker.summarize(previous, recent_turns, trip, *, timeout_sec) -> TypedResult`. 테스트 `ai/tests/llm_gateway/test_dialogue_memory_worker.py`.
- [X] T005 [P] [US1] `ai/tests/fakes/fake_llm.py` 에 `FeatureRoutingLlm({LlmFeature: canned|Exception})` 추가(`request.prompt_ref.feature` 로 분기, 미지정 feature 는 `echo:`) — 한 턴에 여러 feature 를 부르는 오케스트레이터 테스트 공용.
- [X] T006 [P] 루트 `.env.example` `AI_LLM_FEATURE_MODELS` 줄에 `DIALOGUE_INTENT=gpt-5.6-sol,DIALOGUE_ANSWER=gpt-5.6-sol,DIALOGUE_MEMORY=gpt-5.6-sol` 추가 + vault-rev +1 주석 규약 확인.

**Checkpoint**: `uv run pytest tests/llm_gateway -q` green.

---

## Phase 2: 포트·저장소·Provider·스키마 (오케스트레이터가 쓰는 부품)

- [X] T007 [P] [US3] `ai/src/trippilot/ports/memory_store_port.py` — `MemoryStorePort` Protocol(FD DE 시그니처 그대로: `get`·`put`·`recent_for_account`·`delete(*, session_id|trip_id|account_ref) -> int`·`purge_expired(now) -> int`) + `DialogueMemory` dataclass(to_dict/from_dict — 포트 모듈 안, 선례 `llm_port.py`·`vector_store_port.py`; FD BR §5 미결 #20 안 B). `ai/src/trippilot/orchestrator/dialogue_memory.py` — `DialogueMemory`·`MemoryStorePort` 재export·`due(turn_index, summarized_turn_index, every=10)`·`compress_fallback(recent_turns, previous=(), *, max_lines=20, line_chars=120)`(결정론·멱등)·`expires_at_for`·`MEMORY_TTL_DAYS = 90`. 테스트 `ai/tests/orchestrator/test_dialogue_memory.py`(PBT: 상한·멱등·원문 길이 절단).
- [X] T008 [P] [US3] `ai/src/trippilot/agents/adapters/memory_memory_store.py` — `InMemoryDialogueMemoryStore`. `ai/src/trippilot/agents/adapters/pg_memory_store.py` — `PgDialogueMemoryStore(connect)`(테이블 `dialogue_memory`, DML 만, `%s` 플레이스홀더, upsert `ON CONFLICT (session_id) DO UPDATE`, `delete` 는 셋 중 하나만 허용, `purge_expired`). 테스트: InMemory 계약 테스트 + Pg 어댑터는 SQL 문자열·파라미터 단위(연결 fake) — 실 DB 0.
- [X] T009 [P] [US1] `ai/src/trippilot/providers/poi_info.py` — `PoiInfoProvider(poi_db, fees)`: params `{poi_ids: frozenset[PoiId], on: date}` → `InfoPacket(POI_INFO, OK|UNAVAILABLE, {pois: [{poi_id,name,category,lat,lng,hours_label,fee,source_ref}]}, FreshnessMeta(source="M7"))`. `ai/src/trippilot/domain/freshness.py` — `ProviderKind.POI_INFO`. `ai/src/trippilot/orchestrator/info_collector.py` — `Intent.GET_POI_INFO: (ProviderKind.POI_INFO,)` 행 + 조립기(`_build_poi_info_params`). 테스트 `ai/tests/providers/test_poi_info_provider.py`(InMemory poi_db, `hours_label` 요일·fee None·미등록 id 누락 보고).
- [X] T010 [P] [US1,US3] `ai/src/trippilot/api/schemas.py` — 요청 `DialogueInterpretRequest` += `session_id: str | None`, `account_ref: str | None`, `recent_turns: list[DialogueTurnSchema] (≤20)`; `DialogueTurnSchema{role: Literal["USER","ASSISTANT"], text: str (1..300)}`; 응답 `DialogueInterpretResponse` += `answer: DialogueAnswerSchema | None`; `DialogueAnswerSchema{kind: Literal["TEXT","INFO","CANDIDATES"], text: str (1..600), payload: dict | None, next_actions: list[DialogueNextActionSchema] (≥1), quick_replies: list[DialogueQuickReplySchema] | None, footnote: str | None}`; `outcome` 주석에 ANSWER 추가; 메모리 경계 `DialogueMemoryDeleteResponse{deleted: int ≥0}`·`DialogueMemoryExportResponse{memories: list[{session_id, trip_id, summary: list[str], updated_at}]}`. INV-3 금칙 토큰 없는 필드명.

**Checkpoint**: `uv run pytest tests/orchestrator/test_dialogue_memory.py tests/providers tests/agents -q` green.

---

## Phase 3: 오케스트레이터 본체 · 핸들러 · 섀도

- [X] T011 [US1,US2] `ai/src/trippilot/orchestrator/dialogue_handlers.py` — `TurnContext`(스냅샷·인자·now·tz·remaining_ms) · `Facts` · `HandlerTask(name, fn)` · `Handler(intent, plan, assemble, handoff_frame)` · `HANDLERS: dict[Intent, Handler]`(브리프 §2.3 표: SHOW_SCHEDULE·GET_NEXT_SLOT 스냅샷 계산 / GET_WEATHER·GET_DISTANCE·GET_POI_INFO Provider / SUGGEST_ALTERNATIVE PlanBAgent·풀·Weather / EDIT_SCHEDULE FRAME / GENERATE·REGENERATE·REPLAN·회고 3종 handoff) · `resolve_slot(snapshot, *, day, target, now)`(날짜·순번·이름 부분일치·"점심/저녁"→FOOD+시각대·여럿이면 None) · `parse_slot_key(slot_key) -> (date, PoiId)` · 여행 없음 → `needs_trip` 처리. **순수 함수** — I/O 는 Task 콜러블로만. 테스트 `ai/tests/orchestrator/test_dialogue_handlers.py`(결정론 PBT, 슬롯 해소 경계, 각 의도 facts 모양, next_actions ∈ 17종).
- [X] T012 [US5] `ai/src/trippilot/orchestrator/shadow_probe.py` — `ShadowCountingLlm(inner)`(인스턴스 카운터·Lock) · `TaggedTrace(inner, component="c1.gateway.shadow")` · `ShadowIntentProbe(router, *, rate, pool=ThreadPoolExecutor(2,"intent-shadow"), max_inflight=4, rng, logger)`: `submit(utterance, trace_id, now, *, service: IntentMatch, service_ms, service_llm_calls, turn_index, meta)` → 스레드에서 `router.route(utterance, TraceId(f"{trace_id}:shadow"), now)` → `intent_shadow {json}`(FD DE §5 필드표, 원문·slots 금지, `utterance_sha12`); 포화 시 `intent_shadow_skipped` 카운트 로그. `orchestrator/intent_eval.py` — `_is_refusal` → 공개 `is_refusal`. 테스트 `ai/tests/orchestrator/test_shadow_probe.py`(동기 executor 주입으로 결정론, 로그 JSON 필드·원문 부재·rate 0/1·포화 skip).
- [X] T013 [US1,US2,US3,US4] `ai/src/trippilot/orchestrator/dialogue_orchestrator.py` — 시한·상한 모듈 상수(설정 묶음 없음)·`TurnInput`·`TurnOutcome`·`DialogueOrchestrator.turn()`(파이프라인 0~7: 리터럴 능력 안내 → 보류 되묻기 답(기존 `DialogueInterpreter._answer` 재사용/추출) → 분류(DIALOGUE_INTENT, timeout=min(2.5s, 잔여×0.35)) ∥ 섀도 submit → 필수 인자 되묻기(기존 `_finish` 로직) → `HANDLERS[intent].plan` 팬아웃(공유 풀 `_DLG_POOL`, submit 전 마감, `wait`, pending cancel, 미완 → TIMEOUT 상태값 + 작업별 `FallbackEvent(stage="fanout")`) → 답변(DIALOGUE_ANSWER, 잔여 <1.5s 면 템플릿) → 메모리(due ∧ 잔여 ≥2.5s → DIALOGUE_MEMORY, 실패 → `compress_fallback`) → `TurnOutcome(outcome ANSWER|FRAME|ARGUMENT_CLARIFY|OUT_OF_SCOPE, answer, frame, clarify, context, llm_calls(서비스만), reason)`). 예외 경계 밖 금지(DL-5). 관측은 `FallbackEvent` 한 길(분류 미호출·워커 예외도 오케스트레이터가 낸다). 테스트 `ai/tests/orchestrator/test_dialogue_orchestrator.py` — `FeatureRoutingLlm`·`FakeClock`·InMemory 스토어·fake Provider: 의도별 ANSWER 모양·EDIT→FRAME·`{"intent": null}`→OUT_OF_SCOPE·시한 소진 폴백·메모리 due·llm_calls 섀도 미포함(PBT AO-P*).

**Checkpoint**: `uv run pytest tests/orchestrator -q` green(기존 `test_intent_eval_gate` 포함 무변경 통과).

---

## Phase 4: 경계·조립·env

- [X] T014 [US1,US3] `ai/src/trippilot/api/dialogue.py` — `interpret()` 확장: 오케스트레이터가 주입됐으면 `TurnInput`(session_id·account_ref·recent_turns·deadline=`_deadline_budget` 또는 9,000) 조립 → `turn()` → 응답(ANSWER 면 `answer` 채움, FRAME/CLARIFY/OOS 는 종전 모양); 미주입이면 종전 `DialogueInterpreter` 경로 그대로. 메모리 경계 핸들러 `memory_delete(request params)`·`memory_export(account_ref)`.
- [X] T015 [US3] `ai/src/trippilot/api/routes.py` — `DELETE /ai/v1/dialogue/memory`(쿼리 셋 중 정확히 하나, 아니면 422; 200 `{deleted}`)·`GET /ai/v1/dialogue/memory?account_ref=` 추가(getattr 패턴 `dialogue_memory_delete`·`dialogue_memory_export`). `ai/tests/api/test_api_openapi_contract.py` 경로 집합에 2개 추가. `scripts/export_openapi.py` 재생성 → `ai/docs/openapi.json`.
- [X] T016 [US1] `ai/src/trippilot/api/wiring.py` — **최소 줄**: `WiredItineraryOrchestrator` 생성자 인자 `dialogue_orchestrator`·`memory_store`, 메서드 `dialogue_memory_delete`·`dialogue_memory_export`(위임 한 줄), `build_orchestrator(...)` 에 인자 `dialogue_orchestrator_enabled: bool`, `memory_store`, `shadow_rate`, 조립 본체는 `api/dialogue.build_dialogue_orchestrator(...)`(3 GatewayFacade feature 별 `counted` 공유 + 섀도 전용 IntentRouter(ShadowCountingLlm·TaggedTrace, 뱅크 스토어·bank_ready 공유) + `DialogueOrchestrator(...)`) — wiring 은 그 호출 한 줄. `build_dev_app(...)` 인자 관통. `ai/tests/api/test_boundary_wiring_gate.py` 통과(getattr 이름 실존).
- [X] T017 [US1,US3,US5] `ai/main.py` — env `TRIPPILOT_DIALOGUE_ORCHESTRATOR`(on|off, 기본 off, 오타 기동 실패)·`TRIPPILOT_DIALOGUE_SHADOW_RATE`(0~1, 기본 1.0, 범위 밖 기동 실패); 메모리 스토어 = `TRIPPILOT_VECTOR_DB_URL` 있으면 `PgDialogueMemoryStore(lambda: psycopg.connect(url))` 아니면 InMemory + `_warn_unwired` 에 "도우미 메모리 미설정(TRIPPILOT_VECTOR_DB_URL) — 세션 기억 없이 동작" WARN. `ai/tests/api/test_main_startup_warnings.py` 갱신.
- [X] T018 [US1] `ai/tests/api/test_api_dialogue_turn.py`(신규) — `build_dev_app(llm=FeatureRoutingLlm(...), ...)` + 오케스트레이터 on 으로 HTTP 200 ANSWER 왕복 1건 이상(배선 게이트 선례: 스텁 전용 금지), off 면 종전 FRAME 응답 그대로, 메모리 경계 2종 200/422.

**Checkpoint**: `cd ai && uv run pytest -q` 전체 green · openapi 스냅샷 일치.

---

## Phase 5: 백엔드 (같은 PR)

- [X] T019 [P] [US1] `backend/modules/assistant/src/main/kotlin/com/trippilot/assistant/domain/Dialogue.kt` — `InterpretOutcome.ANSWER`, `InterpretedAnswer(kind, text, payload, nextActions, quickReplies, footnote)`, `Interpretation.answer: InterpretedAnswer?`, `InterpretRequest` += `sessionId: UUID`, `accountRef: String`, `recentTurns: List<RecentTurn(role, text)>`.
- [X] T020 [US1] `.../adapter/out/interpret/HttpDialogueInterpreter.kt` — Wire 요청 += `session_id`·`account_ref`·`recent_turns`; `WireResponse.answer: WireAnswer? = null`; `toDomain` 검증(text ≤2000 아니면 `DialogueInterpretFailed` 대신 answer 를 버리고 FRAME 폴백? → **폴백 메시지**(BR-U8-40), next_actions ≥1·type ∈ `NextAction.TYPES`(아니면 SHOW_CAPABILITIES 대체), kind ∈ {TEXT,INFO,CANDIDATES}); `DIALOGUE_PATHS` 상수(interpret·memory) + read timeout `require(read >= interpretStageMaxMs + 5000)`; 메모리 경계 호출 `deleteMemory(...)`·`exportMemory(accountRef)`(`DialogueMemoryPort`, http 모드만). 테스트 `HttpDialogueInterpreterTest` 응답 키 집합 갱신(`answer` 추가·새 스키마 이름)·ANSWER 파싱·길이 초과 폴백·메모리 경로 실재.
- [X] T021 [US1,US2] `.../application/AssistantTurnService.kt` — `respond()`: `recent_turns` = `messages.findPage(sessionId, null, 20)` 중 text != null·role 매핑·300자 절단; `InterpretRequest` 에 sessionId·accountRef 전달; `answer()`: `InterpretOutcome.ANSWER` 분기 → `NewMessage(kind, text, payload, nextActions, quickReplies=issue(...)`(id `qr-ai-{8자}-{i}`, action ∈ QuickReplyAction, PICK_CANDIDATE 는 slotKey 가 plan 에 실재해야), intent·matchRoute·outcome="ANSWER")`; CANDIDATES 는 `PoiSurfaceFacade.findSurfaces` 로 poiId 실존·이름 대조(없는 후보 제외, 전부 없으면 폴백). 테스트 `AssistantTurnServiceTest`: ANSWER 저장·quick reply 발급·후보 정본 대조·recent_turns 구성(가려진 입력 제외)·llm_calls 집계·PBT(next_actions ≥1·TYPES·INV-3).
- [X] T022 [P] [US1] `.../application/AssistantProperties.kt` + `backend/app/src/main/resources/application.yml` — `interpret-stage-max-ms` 9000, `daily-llm-turn-limit` 100(주석에 근거: 모든 TEXT 턴이 LLM 턴). `FakeDialogueInterpreter.kt` — ANSWER 도 낼 수 있는 낱말 표(로컬 기본·IT 연습).
- [X] T023 [US3] `.../application/AssistantSessionService.kt`(`clear` → `memory.delete(sessionId)` best-effort WARN) · `deleteForTrip` → `memory.delete(tripId)` · `AssistantRetention.purgeAccount` → `memory.delete(accountRef)`(실패 시 throw → 아웃박스 재시도) · `AssistantExportContributor` 섹션 `assistantMemory`(GET 결과 줄 단위). `DialogueMemoryPort` 가 없는 모드(off/fake)에서는 no-op. 테스트 + `AssistantApiIT`/`AssistantTurnIT` 갱신.

**Checkpoint**: `cd backend && ./gradlew :modules:assistant:test` green · `AiBoundaryOpenApiTest` 무영향 확인.

---

## Phase 6: 배포·DDL·운영

- [X] T024 [P] [US3] `deploy/eks/bootstrap.sql` + `ai/docker/vector-init/02-dialogue-memory.sql` — `dialogue_memory` 테이블·인덱스 2개·`GRANT SELECT, INSERT, UPDATE, DELETE ... TO ai_user`(FD DE §4 DDL 그대로).
- [X] T025 [P] [US3,US5] `deploy/eks/runtime_secrets.py` — `TRIPPILOT_VECTOR_DB_URL` 항상 합성(embedding_enabled 무관), `AI_KEYS` allowlist += `TRIPPILOT_DIALOGUE_ORCHESTRATOR`·`TRIPPILOT_DIALOGUE_SHADOW_RATE`. `deploy/eks/chart/templates/ai.yaml` — VECTOR_DB_URL 을 `embedding.enabled` 블록 밖으로(EMBEDDING_PROVIDER/BASE_URL 만 조건부), range 목록에 새 키 2개. `deploy/eks/chart/tests/test_chart.py`·`deploy/eks/tests/test_runtime.py` 갱신. `docker-compose.yml`·`.env.example` 통로(`AI_DIALOGUE_ORCHESTRATOR`·`AI_DIALOGUE_SHADOW_RATE` → TRIPPILOT_*).
- [X] T026 [P] [US5] `.github/workflows/aws-dev-logs.yml` — `namespace` 입력(기본 `trippilot`, 선택 `trippilot-dev`) 을 kubectl `-n` 과 Logs Insights 필터에 반영.
- [X] T027 [P] [US5] `ai/scripts/mlops/intent_shadow_report.py` — stdin 로그 → `intent_shadow` 줄 파싱 → `Sample(label=Intent(service.intent), match=IntentMatch.from_dict(shadow), latency_ms=shadow.latency_ms)` → `intent_eval.score`/`format_report` + 섀도 llm 호출 합·skip 수·조건 메타 집계 → 마크다운(stdout). 머리말에 "최소 2회 측정" 규약. 테스트 `ai/tests/scripts/test_intent_shadow_report.py`(합성 로그 3줄).

**Checkpoint**: `cd deploy/eks && python -m pytest chart/tests tests -q` green.

---

## Phase 7: 문서·마무리

- [ ] T028 [P] FD BR §4 "적용됨" 표기 확인, `ai/aidlc-docs/construction/assistant-orchestrator/functional-design/business-rules.md` DoD 체크, `ai/README.md`·`ai/claude.md`·`ai/claude.ko.md` 현황 註(이미 개정 블록 있음 — 구현 뒤 "이 PR 로 배선" 문구 사실 확인), `ai/docs/README-openapi.md` 경로 2개 추가.
- [ ] T029 `docs/conventions/anti-patterns.md` — 구현 중 재현·검증된 새 실패가 있으면 한 줄 규칙 제안(없으면 생략).
- [ ] T030 리뷰: `invariant-reviewer`(INV-1~4·DL-5·L-규칙) + `canon-auditor`(FD ↔ 코드) 병렬 → 지적 0 까지 수정.
- [ ] T031 실연동: 로컬 `docker compose --profile full up -d ai`(또는 `uv run uvicorn main:app` + `../.env`) + BE http 모드 또는 `curl` 로 `/ai/v1/dialogue/interpret` 한 턴(날씨·다음 장소·대안) → ANSWER 200·`intent_shadow` 로그 1건·메모리 행 1건(InMemory 면 로그) 확인. 결과를 PR 본문 "테스트 리포트" 절에.
- [ ] T032 PR: 제목 `feat(ai,be): 도우미 오케스트레이터 — LLM 직접 분류·병렬 팬아웃·LLM 답변·세션 메모리·3단 섀도 측정 (assistant-orchestrator 1단계)`, 본문 8단계 매핑(정의=spec·설계=FD·테스트 시나리오=BR §2·구현 리포트·테스트 리포트·매뉴얼=README/openapi), 티켓 키 없음(조회 전), Co-Authored-By·세션 링크 금지. CI 초록이면 squash 머지(10-02 지시). 머지 뒤: DEV 시크릿 `TRIPPILOT_DIALOGUE_ORCHESTRATOR=on` + `TRIPPILOT_LLM_FEATURE_MODELS` 3항목 추가는 **쓰기 세션/사용자 몫** → 배포 → `ai-wiring:` 표식 확인.

---

## Dependencies & Execution Order

- Phase 1·2 는 서로 독립(병렬). Phase 3 은 1·2 뒤(T011 은 T009·T010 과 독립 — 순수 함수라 먼저 가능). T013 은 T002~T005·T007·T011·T012 뒤.
- Phase 4 는 3 뒤(T014·T016 순차, T015·T017 병렬). Phase 5 는 AI 스키마(T010·T015 openapi) 뒤 — BE 계약 테스트가 `ai/docs/openapi.json` 을 읽는다. Phase 6 은 독립(병렬 가능). Phase 7 은 전부 뒤.
- 2단계(EDIT 인프로세스·PROPOSAL)는 이 목록 밖 — FD DE §9.

## Parallel Example

```
# 1차 병렬(파일 겹침 없음): T001 T002 T003 T004 T005 T006 T007 T008 T009 T010 T024 T025 T026 T027
# 2차: T011 T012 (→ T013)
# 3차: T014 T016 (순차) ∥ T015 T017 ∥ T019 T022
# 4차: T018 ∥ T020 T021 T023
# 5차: T028~T032
```

## Notes

- 공유 파일 수정은 네 곳만: `domain/llm.py`·`llm_gateway/config.py`(항목 추가), `api/schemas.py`·`api/routes.py`(추가), `api/wiring.py`(주입 줄), `main.py`(env). 나머지는 새 파일.
- `prompts/intent.yaml`·`tests/fixtures/intent_gate`·`data/intent_question_bank*` 는 **건드리지 않는다**(섀도 측정 대상 보존).
- 발화 원문·account_ref 는 어떤 로그에도 싣지 않는다.
