# 도우미 오케스트레이터 설계 브리프 (assistant-orchestrator) — 2026-10-17

> 이 문서가 FD 3종·정본 개정 블록·spec.md·구현의 **단일 출처**다. 사실 근거는 조사 보고 8편(파일:줄 포함) — 리포 밖 `~/.claude/projects/-Users-juna-dev-trippilot-trippilot/work/assistant-orchestrator/understand/*.md`(세션 산출, 커밋하지 않음).
> 작업 트리: `/Users/juna/dev/trippilot/wt-chat-orchestrator` (origin/develop 3dc23b4b, 브랜치 `feat/assistant-orchestrator`).
> 메인 체크아웃 `/Users/juna/dev/trippilot/trippilot` 은 534 커밋 뒤 — 읽지 말 것.

## 0. 사용자 결정 (2026-10-17, 원문 요지)

1. 의도 파악을 3단(뱅크 임베딩→투표→LLM)으로 거치지 않고 **LLM 이 바로 분류**한다. 이상한 프롬프트는 막는다.
2. AI 에 **오케스트레이터**를 둔다 — 의도 파악 → 필요한 에이전트·Provider 에 **병렬**로 일을 시키고 결과를 받는다. 간단한 건 오케스트레이터가 직접 DB 조회.
3. 결과를 조합해 **사용자에게 보일 답변**을 만든다. 결과는 DB 에도 반영.
4. **장단기 메모리**: 세션 id 당 10턴을 20줄로 요약해 DB 에 저장, 같은 사용자가 다시 쓰면 로드.
5. 오케스트레이터에 agent·provider·DB 를 전부 연결. 새 agent/provider 추가 가능. EditAgent 를 살리는 방향도 좋다.
6. 질문뱅크 3단 경로는 **서비스에서 빼되 병렬로 돌려 성능만 측정**한다(섀도).

**AskUserQuestion 결정(2026-10-17)**: ① 접근 = 안 A(기존 경계 `/ai/v1/dialogue/interpret` 확장) ② 메모리 = **AI 자체 DB 새 테이블** ③ EDIT_SCHEDULE = 2단계로 분리(1단계는 BE 기존 경로 FRAME 유지) ④ LLM 턴 상한 일 30→100, 섀도 DEV 100%·운영 20%, 섀도 LLM 호출은 사용량 상한 제외(로그에만).

## 1. 확정된 제약 (조사 결과 — 설계가 반드시 지키는 사실)

- AI → BE DB 직접 SQL 없음. 열린 길: `GET /internal/pois`(반경)·`POST /internal/pois/batch-get`(배치 ≤200) via `PoiDbPort`(BackendPoiDb, X-Service-Token). 일정은 요청 스냅샷으로만 온다. 페르소나 재조회 어댑터는 미배선(prod 는 StaticPersonaStore).
- AI 자체 DB = RDS 안 `ai_kb`(역할 `ai_user`, CREATE 권한 없음). DDL 정본 두 곳: `deploy/eks/bootstrap.sql`(마스터 Job, 매 배포 멱등) + `ai/docker/vector-init/*.sql`(compose initdb). DSN env `TRIPPILOT_VECTOR_DB_URL` 은 **embedding.enabled 일 때만** 차트가 꽂는다(runtime_secrets.py:198-206, ai.yaml:74-80). 어댑터 선례 `PgVectorStore(connect: Callable)` — psycopg 3, 호출마다 connect, 풀 없음.
- 응답 스키마 키 집합은 BE `HttpDialogueInterpreterTest` 가 **정확 동등** 단언 → AI 응답 필드 추가 = BE 테스트 동시 수정, **한 PR**. 모르는 `outcome` 값은 BE 에서 매 턴 폴백(enum) → BE enum 추가가 같은 PR 에.
- 요청 스키마는 `extra=forbid`. BE 가 새 키를 보내려면 AI 스키마가 같은 PR 에서 열려야 한다(BE 요청 키 게이트: 키 ⊆ 계약).
- `dialogue_context` 는 BE 가 저장·반송만(INV-U8-07, turn_index 만 +1). 모양을 바꾸지 않는다.
- 현 대화 경로는 `request_meta.deadline_ms` 를 읽지 않는다(INTENT 호출 10s 기본). 새 설계는 **반드시** 읽어 모든 LLM·Provider 호출에 timeout 을 내린다.
- `CountingLlm` 의 contextvar 카운터는 스레드로 전파되지 않는다. 섀도는 **별도 LLM 래퍼**로 세고 응답 `llm_calls` 에 넣지 않는다.
- 아키텍처 테스트: orchestrator → agents·providers·poi_curation·assembly_engine import 허용(선례 schedule_coordinator). agents → orchestrator·providers·LlmPort 금지(L-3/4/6). yaml 은 llm_gateway/prompts.py 한정(데이터 yaml 은 main.py 에서 로드). 벤더 SDK 는 adapters 한정. 새 LLM 기능 = `LlmFeature` enum + `default_tier_map` + `default_fallback_modes`(+테스트 `_EXPECTED_MODES`) + (effort/max_tokens) + prompts yaml + 게이트 + 워커 + 테스트 + `.env.example` 배정 + Secrets Manager 값.
- `prompts/intent.yaml`(v0.2.0) 과 `tests/fixtures/intent_gate`(61 LLM 기록, baseline 85/87) 는 **건드리지 않는다** — 섀도가 측정하는 대상이 현행 3단 그대로여야 한다. 새 분류는 새 feature·새 yaml.
- 프롬프트 템플릿은 `string.Template` 치환만(조건부 없음). 제3자 문자열은 `inline()` 으로 한 줄로.
- FE 는 kind 10종·NextAction 17종·서버 발급 quick reply·평문 text 만 그린다. kind 별 필수 배열 누락은 렌더 크래시. INFO payload `{infoKind, title, rows[{label,value}]}`, CANDIDATES `{candidates[{poiId,name,distanceRange?,reason}]}` + PICK_CANDIDATE quick reply. 리치 텍스트 없음, `\n` 줄바꿈만. **FE 변경 0 이 목표.**
- BE 도우미 메시지 DB 제약: text ≤2000, next_actions ≥1, kind ∈ CHECK 목록, intent varchar(40)·match_route varchar(16)·outcome varchar(32).
- BE 턴 예산: turn 13s·interpret 5s·edit 8s·readMargin 1s, read timeout = interpret+readMargin. 앱 15s 는 UI 경고선(하드 타임아웃 없음).
- 세션 = (계정, 여행) ACTIVE 행 1개 + 일반 세션 1개, 보존 90일 슬라이딩, 삭제 경로 4종(만료 청소·이력 지우기 `AssistantSessionService.clear`·여행 삭제 `TripDeletedSubscriber`·계정 삭제 `AccountDeletionSubscriber`→`AssistantRetention.purgeAccount`). 내보내기 `AssistantExportContributor`(섹션 assistantMessages).
- 섀도 로그 선례: `replan_reason {json}` 한 줄(trippilot.wiring 로거). DEV 로그 워크플로 `aws-dev-logs.yml`·`ai-llm-fallback-watch.yml` 은 네임스페이스 `trippilot` 하드코딩(개발 대상 `trippilot-dev` 못 읽음).
- 발화 원문은 로그에 싣지 않는다(SEC-U8-06). 섀도 기록은 길이·sha12 만.

## 2. 아키텍처 (안 A)

```
FE ──(변경 없음)──▶ BE AssistantTurnService
      │ POST /ai/v1/dialogue/interpret  { request_meta(deadline 9s), utterance, dialogue_context,
      │                                   context(스냅샷), session_id, account_ref, recent_turns[≤20] }
      ▼
AI api/dialogue.py (사영) ──▶ orchestrator/dialogue_orchestrator.DialogueOrchestrator.turn()
      0 리터럴 "내가 할 수 있는 것 보기" → 능력 안내(결정론)
      1 보류 되묻기 답 읽기(기존 DialogueInterpreter._answer 로직 재사용)
      2 DIALOGUE_INTENT(LLM 직접 분류, IntentGate 재사용, history·memory·trip 요약 변수)
        ∥ ShadowIntentProbe.submit(기존 IntentRouter.route, 별도 LLM 카운터·trace 접미, fire-and-forget, 샘플링)
      3 필수 인자 비면 ARGUMENT_CLARIFY(기존 로직)
      4 의도별 Handler.plan(ctx) → 작업 목록 → 공유 풀 팬아웃(submit 전 마감, wait, 미완 cancel → PARTIAL)
        - Provider(Weather·Transit·PoiInfo[신규]) · PlanBAgent(인프로세스) · 스냅샷 계산
      5 DIALOGUE_ANSWER(LLM 문장) + 출구 게이트(길이·INV-3·연락처) → 실패·시한 부족이면 결정론 템플릿
      6 메모리: turn_index − summarized_turn_index ≥ 10 ∧ 잔여 ≥ 2.5s → DIALOGUE_MEMORY(20줄) → PgDialogueMemoryStore.put
        실패 → 결정론 압축(최근 턴 줄 자르기)로라도 전진(INV-4)
      7 응답: outcome ANSWER | FRAME(EDIT_SCHEDULE 1단계) | ARGUMENT_CLARIFY | OUT_OF_SCOPE, llm_calls(서비스 호출만)
      ◀──
BE answer(): ANSWER → 검증(길이·TYPES·kind·quick reply 서버 id 발급·CANDIDATES poiId 정본 대조) → NewMessage 저장
            FRAME → 기존 IntentDispatcher(EDIT 1단계·오케스트레이터 off 시 전부)
```

### 2.1 새 모듈 (전부 새 파일, wiring.py 는 주입 줄만)

| 파일 | 역할 |
|---|---|
| `ai/src/trippilot/orchestrator/dialogue_orchestrator.py` | `DialogueOrchestrator.turn(TurnInput) -> TurnOutcome`. 생성자 DI: intent_worker, answer_worker, memory_worker, memory_store, providers(dict), poi_db, planb_agent, pool_builder, shadow(옵션), clock, trace, tz, config(DialogueOrchestratorConfig: max_recent_turns=20, summary_every_turns=10, summary_max_lines=20, summary_line_chars=120, answer_max_chars=400, intent_timeout_share, …). 예외를 밖으로 내지 않는다(DL-5). |
| `ai/src/trippilot/orchestrator/dialogue_handlers.py` | 의도별 핸들러 표 `HANDLERS: dict[Intent, Handler]`. `Handler.plan(ctx) -> tuple[Task,...]`, `Handler.assemble(ctx, results) -> Facts`(순수). 스냅샷 계산·슬롯 참조 해소(`resolve_slot`: 날짜·순번·이름 부분일치·"점심/저녁"→FOOD+시각대) 도 여기. |
| `ai/src/trippilot/ports/memory_store_port.py` · `ai/src/trippilot/orchestrator/dialogue_memory.py` | `DialogueMemory` dataclass(session_id, account_ref, trip_id, summary: tuple[str,...], summarized_turn_index, updated_at, expires_at) → **`ports/memory_store_port.py` 안**(L-1: ports·어댑터가 참조하므로 orchestrator 에 둘 수 없다; 포트 모듈 내 dataclass 선례 `llm_port.py`·`vector_store_port.py` — 초판의 "orchestrator/" 표기 정정, FD BR §5 미결 #20 안 B), `MemoryStorePort` Protocol(같은 파일). `orchestrator/dialogue_memory.py` 는 재export + `due(turn_index, summarized_turn_index, every=10) -> bool`·`compress_fallback(recent_turns, previous=(), *, max_lines=20, line_chars=120) -> tuple[str, ...]`(결정론·멱등)·`expires_at_for`·`$memory` 조립(`dialogue_orchestrator._memory_lines`). |
| `ai/src/trippilot/ports/memory_store_port.py` | `get(session_id)`, `put(memory)`, `recent_for_account(account_ref, *, exclude_session, limit)`, `delete(*, session_id=None, trip_id=None, account_ref=None) -> int`, `purge_expired(now) -> int`. |
| `ai/src/trippilot/agents/adapters/pg_memory_store.py` | `PgDialogueMemoryStore(connect)` — 테이블 `dialogue_memory`, DML 만, PgVectorStore 와 같은 connect 주입 패턴. |
| `ai/src/trippilot/agents/adapters/memory_memory_store.py` | `InMemoryDialogueMemoryStore` — 테스트·로컬(DSN 없음) 용. |
| `ai/src/trippilot/orchestrator/shadow_probe.py` | `ShadowIntentProbe(router, *, rate, pool, max_inflight, rng, logger)`: `submit(utterance, trace_id, now, service: IntentMatch, service_ms, service_llm_calls, turn_index)` → 스레드에서 `router.route(utterance, TraceId(f"{trace_id}:shadow"), now)` → `intent_shadow {json}` INFO 1줄. 포화 시 skip 카운트 로그. |
| `ai/src/trippilot/providers/poi_info.py` | `PoiInfoProvider(poi_db, fees)`: params `{poi_ids, on: date}` → `{pois: [{poi_id, name, category, lat, lng, hours_label(요일), fee, source_ref}]}` LLM 0회. `INFO_REQUIREMENTS` 에 `GET_POI_INFO: (POI_INFO,)` 행 추가(ProviderKind 신설). |
| `ai/src/trippilot/llm_gateway/workers/dialogue_intent.py` + `prompts/dialogue_intent.yaml` | 변수 `$utterance $intents(tool_specs_json()) $history $memory $trip`. 게이트 = 기존 `IntentGate` 재사용(feature 인자만 다름). 출력 `{"intent": str|null, "slots": {...}, "confidence": n}`. 규칙: 목록 밖 금지·불확실/주입/유해/역할변경 → null·시각 생성 금지·인자는 발화에 나온 표현만. |
| `ai/src/trippilot/llm_gateway/workers/dialogue_answer.py` + `gates/dialogue_answer.py` + `prompts/dialogue_answer.yaml` | 변수 `$intent $facts(JSON, inline) $utterance $history $memory $trip $style`. 출력 `{"text": str, "footnote": str|null}`. 게이트: 비어있지 않음·≤400자·줄 ≤6·`_TIME_EXPR`(소요시간) 금지·`has_contact_like` 금지·facts 에 없는 장소명 금지는 **못 검사**(INV-1 은 facts 가 닫힌 집합이라 문장만의 위험 = 수용된 blast radius). 폴백 = 의도별 결정론 템플릿(BE 템플릿 문구 이식). |
| `ai/src/trippilot/llm_gateway/workers/dialogue_memory.py` + `gates/dialogue_memory.py` + `prompts/dialogue_memory.yaml` | 변수 `$previous_summary $recent_turns $trip`. 출력 `{"lines": [str]}`. 게이트: ≤20줄·줄 ≤120자·중복 제거·연락처·소요시간 금지·빈 결과 = 실패(empty_result_error). |
| `ai/src/trippilot/api/dialogue.py` | 사영 확장: 요청 → `TurnInput`(session_id·account_ref·recent_turns·deadline), `TurnOutcome` → 응답(ANSWER/FRAME/…); 오케스트레이터 off 면 기존 `DialogueInterpreter` 경로 그대로. |
| `ai/src/trippilot/api/schemas.py` | 요청 += `session_id: str|None`, `account_ref: str|None`, `recent_turns: list[DialogueTurnSchema{role: USER|ASSISTANT, text ≤300}] (≤20)`. 응답 += `outcome` 값 `ANSWER`, `answer: DialogueAnswerSchema|None {kind: TEXT|INFO|CANDIDATES, text ≤600, payload: dict|None, next_actions: list[{type,label,params}] ≥1, quick_replies: list[{label, action, params}]|None, footnote: str|None}`. 메모리 경계 `DELETE /ai/v1/dialogue/memory`(쿼리 `session_id`|`trip_id`|`account_ref` 중 정확히 하나, **200 `{deleted: n}`** — 멱등, 없으면 0) · `GET /ai/v1/dialogue/memory?account_ref=`(내보내기). |
| `ai/main.py` | env `TRIPPILOT_DIALOGUE_ORCHESTRATOR`(on|off, 기본 off), `TRIPPILOT_DIALOGUE_SHADOW_RATE`(0~1, 기본 1.0); 메모리 스토어 = `TRIPPILOT_VECTOR_DB_URL` 있으면 Pg, 없으면 InMemory + WARN `도우미 메모리 미설정`(ai-wiring 표식). |
| `ai/scripts/mlops/intent_shadow_report.py` | stdin 로그 → `intent_shadow` 줄 파싱 → `intent_eval.score(Sample(label=service_intent…))` 재사용 → 마크다운(일치율·경로 비중·p95·혼동쌍·unrefused·섀도 llm 호출 수). `_is_refusal` 공개 승격. |
| deploy | `bootstrap.sql` + `ai/docker/vector-init/02-dialogue-memory.sql`: 테이블 + GRANT. `runtime_secrets.py`: VECTOR_DB_URL 항상 합성 + 새 키 2개 allowlist. `chart/templates/ai.yaml`: VECTOR_DB_URL 항상 주입(embedding.enabled 는 EMBEDDING_* 만), 새 키 range. `chart/tests/test_chart.py`·`deploy/eks/tests/test_runtime.py` 갱신. `.env.example`·`docker-compose.yml` 통로. `aws-dev-logs.yml` namespace 입력 추가(기본 trippilot). |

### 2.2 메모리 테이블 (ai_kb)

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

- **단기 기억** = BE 가 요청에 싣는 `recent_turns`(최근 10턴 = 사용자·도우미 메시지 ≤20, 가려진 입력 제외, text ≤300). AI 는 원문을 저장하지 않는다 → SEC-U8-06 의 "두 곳" 유지(요청 본문은 LLM 호출 본문 범주).
- **장기 기억** = `summary` 20줄. 로드: 현재 세션 행 + 같은 `account_ref` 의 다른 세션 최근 2건(헤더 "지난 여행 기억") → 분류·답변 프롬프트의 `$memory`.
- 요약 시점: `turn_index − summarized_turn_index ≥ 10` 이고 잔여 시한 ≥ 2.5s. LLM 실패·시한 부족 → `compress_fallback`(최근 턴을 "- 사용자: …" 줄로 자르고 20줄 상한) 로 전진 + FallbackEvent. 다음 턴에 LLM 이 다시 시도해 덮어쓴다. 잔여 ≤0 이면 압축·put 도 하지 않고 이번 턴은 건너뛴다(summarized_turn_index 불변 → due 유지, FallbackEvent 만 남긴다 — FD BLM §3 에서 올린 줄).
- 파기: BE `clear`(세션)·`deleteForTrip`(여행)·`purgeAccount`(계정) 가 `DELETE /ai/v1/dialogue/memory` 호출. purge 는 실패 시 예외로 올려 아웃박스 재시도(DATA-U8-02). clear/trip 은 WARN + TTL 백스톱(90일, 쓰기 시 만료 행 정리). 내보내기: `GET /ai/v1/dialogue/memory?account_ref=` → BE `AssistantExportContributor` 섹션 `assistantMemory` 추가(DATA-U8-06).

### 2.3 의도별 처리표 (1단계)

| 의도 | plan(병렬 작업) | 답변 kind | next_action | 비고 |
|---|---|---|---|---|
| SHOW_SCHEDULE | 스냅샷 계산(scope: 오늘 남은/전체/N일차) | TEXT(LLM 요약, `\n` 줄) | OPEN_ITINERARY | 일정 없으면 "아직 일정이 없어요" + OPEN_ITINERARY_METHOD |
| GET_NEXT_SLOT | 스냅샷(now 이후 첫 슬롯) | INFO(NEXT_SLOT rows: 날짜·계획 시각) | OPEN_LIVE(여행 중)/OPEN_ITINERARY | quick reply "다른 곳 추천"(SEND_TEXT, params intent=SUGGEST_ALTERNATIVE, slotKey) |
| GET_WEATHER | PoiInfo(좌표) → WeatherProvider(anchor, [date]) | INFO(WEATHER rows: 최대 강수확률·특보) | OPEN_ITINERARY | WEATHER_UNKNOWN → "지금 날씨를 확인할 수 없어요" |
| GET_DISTANCE | 슬롯 해소(dest, origin=직전) → PoiInfo 좌표 → TransitProvider(purpose INFO_DISPLAY, mode 인자 또는 PUBLIC) | INFO(DISTANCE rows: 직전 구간 거리) | OPEN_ITINERARY | 거리만(INV-3). 해소 실패 → 일정 화면 안내 |
| GET_POI_INFO | 슬롯 해소(place) → PoiInfoProvider(poi_id, date) | INFO(PLACE rows: 분류·영업시간·입장료) | OPEN_PLACE{poiId} | 모르는 값은 "미확인" |
| SUGGEST_ALTERNATIVE | 슬롯 해소(target) ∥ PoiInfo 좌표 → [풀 조립(anchor=대상 좌표, 반경 규칙) ∥ Weather] → PlanBAgent.run(use_llm=False, excluded=일정 전부, rain) | CANDIDATES(≤5: poiId·name·distanceRange·reason) | OPEN_ITINERARY | quick reply PICK_CANDIDATE{poiId, slotKey} → BE 기존 ReplaceSlot 제안 경로 |
| EDIT_SCHEDULE | 인자 해소만(day/target) | **FRAME** | — | 1단계: BE ProposalCards 경로(/edit 재호출). 2단계에서 EditAgent 인프로세스 + PROPOSAL |
| GENERATE_SCHEDULE / REGENERATE | 없음 | TEXT(LLM 한 줄) | OPEN_ITINERARY_METHOD / OPEN_REGENERATE | 여행 없으면 CREATE_TRIP·OPEN_STAY_SEARCH 안내 |
| REPLAN | 없음 | TEXT | 여행 중 OPEN_REPLAN, 아니면 OPEN_REGENERATE | |
| GENERATE_REFLECTION / TRIP_SUMMARY / STYLE_ANALYSIS | 없음 | TEXT | OPEN_REFLECTION / OPEN_TRIP_SUMMARY / OPEN_STYLE | |
| OUT_OF_SCOPE | — | (outcome OUT_OF_SCOPE, 문장 없음) | BE SCOPE 카드 | LLM 문장 없음 — 거절·스트릭은 BE 그대로 |

공통: 여행이 없는데 여행이 필요한 의도(STYLE_ANALYSIS·OUT_OF_SCOPE 외) → "먼저 여행을 만들거나 숙소를 등록하면…" + CREATE_TRIP·OPEN_STAY_SEARCH(BE needTrip 과 같은 문구).

### 2.4 시한 배분 (deadline_ms = BE interpret 9,000 기준; BE 가 None 이면 AI 기본 9,000)

| 단계 | 상한 | 비고 |
|---|---|---|
| 분류 LLM | min(2.5s, 잔여×0.35) → **2026-10-18 실측으로 min(4.0s, 잔여×0.45)**(FD BLM §4 註) | effort low, max_tokens 256 |
| 팬아웃 | min(3.0s, 잔여×0.4) | submit 전 마감 고정, wait, pending cancel → PARTIAL |
| 답변 LLM | min(2.5s → **3.5s**, 잔여−0.4s), 잔여 <1.5s 면 템플릿 | effort low, max_tokens 512 |
| 메모리 LLM | 잔여 ≥2.5s 일 때만, 상한 2.0s | 아니면 결정론 압축 |
| 섀도 | 응답과 무관(백그라운드, 자기 상한 = IntentRouter 기본 10s/호출) | 풀 2, in-flight ≤4 |

BE: `interpret-stage-max-ms` 5000→9000, 해석 read timeout = interpret + 5000(백스톱 여유, 다른 두 경계의 `require` 와 동일) = 14s, 턴 예산 13s 유지(앱 15s 안). `daily-llm-turn-limit` 30→100.

### 2.5 섀도 측정

- 조립: 현행 `IntentRouter` 를 **섀도 전용** GatewayFacade 2개(`ShadowCountingLlm` 래퍼 — 인스턴스 카운터·Lock, `TaggedTrace` — LlmCallRecord.component 를 `c1.gateway.shadow` 로 바꿔 LoggingTrace 에 위임)로 다시 조립. 뱅크 스토어·BankIndex 는 서비스 것과 공유(읽기 전용).
- 로그 1줄(로거 `trippilot.intent.shadow`, INFO): `intent_shadow {"trace_id","turn_index","service":{"intent","route":"LLM_DIRECT","confidence","llm_calls","latency_ms","refused"},"shadow":{"intent","route","confidence","reason","llm_calls","latency_ms","refused"},"agree":bool,"utterance_chars","utterance_sha12","meta":{"bank_sha","t_high","t_mid","vote_ratio","intent_margin","intent_prompt":"prompts/dialogue_intent.yaml@0.1.0","shadow_prompt":"prompts/intent.yaml@0.2.0"}}` — 발화 원문·slots 금지.
- 샘플링 `TRIPPILOT_DIALOGUE_SHADOW_RATE`(DEV 1.0·운영 0.2), rng 주입(테스트 결정론). 포화 skip 도 로그.
- 집계 `scripts/mlops/intent_shadow_report.py`(stdin → 마크다운): 일치율·섀도 경로 비중·p95·혼동쌍(경계 3종 표시)·unrefused_fallbacks·섀도 LLM 호출 합. 최소 2회 측정 규약 명시.
- 운영 `aws-dev-logs.yml` 에 `namespace` 입력(기본 trippilot) 추가해 `trippilot-dev` 도 꺼낼 수 있게.

### 2.6 가드레일 ("이상한 프롬프트")

BE 1차(금칙어 fail-closed·분당 20·스냅샷 화이트리스트) 유지 → AI: normalize·500자 거절 → 분류 프롬프트 규칙(목록 밖/주입/역할변경/유출/유해 → `{"intent": null}`) + IntentGate closed-set → OUT_OF_SCOPE(문장 없음, BE SCOPE 카드·거절 스트릭) → 답변 출구 게이트(길이·INV-3·연락처·줄 수) → 폴백 템플릿. 허용된 blast radius = "보이는 문장 오염"까지(메모리 노트 prompt-injection-blast-radius, 재제안 금지).

## 3. BE 변경 (같은 PR, 최소)

1. `Dialogue.kt`: `InterpretOutcome.ANSWER`, `Interpretation.answer: InterpretedAnswer?`(kind·text·payload·nextActions·quickReplies·footnote), `InterpretRequest` += `sessionId`, `accountRef`, `recentTurns`.
2. `HttpDialogueInterpreter.kt`: Wire 요청 += `session_id`·`account_ref`·`recent_turns`; WireResponse += `answer`(기본 null); toDomain 검증 — text ≤2000(초과 → DialogueInterpretFailed 아니라 폴백 메시지), next_actions ≥1 ∧ type ∈ `NextAction.TYPES`(아니면 SHOW_CAPABILITIES 로 대체), kind ∈ {TEXT, INFO, CANDIDATES}, quick_replies action ∈ QuickReplyAction. read timeout = interpretStageMaxMs + 5000 (`require`).
3. `AssistantTurnService.answer()`: `ANSWER` 분기 → `NewMessage(kind, text, payload, nextActions, quickReplies=서버 발급 id `qr-ai-{8자}-{i}`, footnote = answer.footnote(기존 `NewMessage.footnote: String? = null` 칸), intent, matchRoute, outcome="ANSWER")`; CANDIDATES 는 `PoiSurfaceFacade.findSurfaces` 로 poiId 실존·이름 대조(없으면 제외, 전부 없으면 폴백), PICK_CANDIDATE params 의 slotKey 가 plan 에 실재하는지 확인. `recent_turns` 는 `messages.findPage(sessionId, null, 20)` 에서 text != null 인 행만(role·text 300자 절단). `session_id`·`account_ref` 전달.
4. `AssistantProperties`/`application.yml`: `interpret-stage-max-ms` 9000, `daily-llm-turn-limit` 100.
5. 메모리 파기·내보내기: `DialogueMemoryPort`(http 모드만: DELETE/GET `/ai/v1/dialogue/memory`) → `AssistantSessionService.clear`·`deleteForTrip`, `AssistantRetention.purgeAccount`(실패 시 throw), `AssistantExportContributor` 섹션 `assistantMemory`.
6. `FakeDialogueInterpreter`: ANSWER 도 낼 수 있게(로컬 기본·IT 연습). 테스트: `HttpDialogueInterpreterTest` 키 집합 갱신, `AssistantTurnServiceTest` ANSWER 분기·quick reply 발급·길이 초과 폴백·llm_calls 집계, IT.
7. 새 BE env 없음(값은 yml 기본). `CALLED_PATHS` 류: assistant 모듈에 `DIALOGUE_PATHS` 상수 + 계약 실재 테스트(interpret·memory).

## 4. 뒤집는 정본 결정 → 개정 블록 (원문 보존, `[개정 · 2026-10-17 · assistant-orchestrator FD]`)

| 문서 | 대상 | 개정 요지 |
|---|---|---|
| aidlc U8 `business-logic-model.md` | DEC-U8-1 | AI 오케스트레이터가 조회·대안·안내는 AI 안에서 끝내고(ANSWER), 저장을 수반하는 변경(EDIT·적용)은 여전히 BE 제안·[적용] 경로(DEC-U8-2/3 유지). D-U8-5 "수명주기 우회" 에 대한 답: 저장 지점은 바뀌지 않는다 |
| 〃 | DEC-U8-4/5 | 대화 기록은 BE 소유 그대로. AI 는 **요약 20줄**만 자체 DB(`ai_kb.dialogue_memory`) 에 세션 키로 보관. BE 의 이력 지우기·여행 삭제·계정 삭제 3경로가 AI 삭제 경계를 부르고, 만료 청소(90일)는 AI 쪽 TTL(`expires_at`, 쓰기 시 정리)이 맡는다. 최근 턴은 BE 가 요청에 싣는다 |
| 〃 | DEC-U8-6 | LLM 문장 허용 — 단 출구 게이트(≤400자·INV-3·연락처·줄 수)와 결정론 템플릿 폴백 필수, OUT_OF_SCOPE·거절·되묻기는 여전히 고정 문안 |
| 〃 | DEC-U8-8 · DEC-U8-11 | 첫 응답 정의: 모든 TEXT 턴이 LLM ≥1회. 단일 의도 유지(frames ≤1) |
| aidlc U8 `business-rules.md` | BR-U8-22 · BR-U8-26 | 스냅샷 화이트리스트에 `session_id`·`account_ref`·`recent_turns` 추가(목적: 메모리 키·단기 기억). BR-U8-26 개정(게이트 조건) |
| aidlc U8 `nfr-requirements.md` | SEC-U8-03/05/06 · COST-U8-02/06 · PERF-U8-01/02/05 · DATA-U8-02/05/06/07 · OBS-U8-02 | LLM 문장 허용+게이트 · 원문 장소 불변(요약은 파생물, AI DB) · 턴당 LLM ≤3(+요약 1/10턴) · 해석 상한 9s(read 14s 백스톱) · 첫 응답 정의 개정 · AI 메모리 파기·내보내기 연동 · 섀도 지표 추가 |
| ai `assistant-dialogue/functional-design/business-rules.md` | BR-DLG-07 · BR-DLG-20 · BR-DLG-21 · §4 목록 | 서비스 경로는 LLM 직접(3단은 섀도) · AI 는 요약만 보유 · §4 에 본 FD 개정 행 추가 |
| ai `intent-matching-design.md` | §2 · §7 註 | "3단 파이프라인은 섀도 측정 전용, 서비스 판정은 DIALOGUE_INTENT" 註(배선 상태 註 갱신) |
| ai `agent-structure-v2.md` §1·§3 · `orchestrator-delegation-design.md` §5 | Orchestrator "판단 최소" | LLM 분류·답변 조합은 오케스트레이터 몫으로 개정 註, FAST_PATH "DB 조회" = 스냅샷+POI 배치 조회 |
| ai `ai/CLAUDE.md` · `ai/README.md` | 현황 절 | IntentRouter "미배선" 표기 갱신, 오케스트레이터 실재 표기 |
| audit | `ai/aidlc-docs/audit.md` append · `aidlc/aidlc-docs/audit.md` append | 사후 개정 승인 대기(같은 PR 머지 = 승인, #1071 선례) |

## 5. 단계

- **1단계(이 PR)**: §2 전부(EDIT 제외) + §3 + §4 + 테스트 + openapi 재생성 + 배포 설정. 배포 뒤 DEV 시크릿 `TRIPPILOT_DIALOGUE_ORCHESTRATOR=on`·`TRIPPILOT_LLM_FEATURE_MODELS` 에 DIALOGUE_INTENT/ANSWER/MEMORY 배정 추가(쓰기 세션/사용자 몫) → ai-wiring 표식 확인.
- **2단계**: 스냅샷 슬롯 += `end_at`·`is_fixed`(BE ContextSnapshotBuilder·화이트리스트 테스트·AI 스키마) → EditAgent 인프로세스(solution from snapshot, pool via 반경, poi_index via batch) → `answer.kind=PROPOSAL` + `proposal{base_days, days, apply_hint, violations}` → BE `ProposalCards.proposed` 재사용(ground·fingerprint·diff).
- **후속**: 다중 의도(DEC-U8-11), 여행 간 장기 기억 UX, prod 시크릿 값, LLM 단가표에 GPT 모델 추가(비용 측정).

## 6. 테스트·게이트 (구현 DoD)

- AI: `uv run pytest -q` 전체 green; 새 PBT — ① ANSWER 는 항상 next_actions ≥1 ∧ type ∈ 17종 ② text 에 소요시간·연락처 패턴 0 ③ `llm_calls` 는 섀도 호출을 포함하지 않는다 ④ 요약 ≤20줄·줄 ≤120자·멱등 ⑤ 시한: FakeClock 으로 잔여가 줄어도 응답은 항상 deadline 안(폴백) ⑥ 분류 `{"intent": null}`·주입 말뭉치 → OUT_OF_SCOPE ⑦ EDIT_SCHEDULE → FRAME ⑧ 핸들러 결정론(같은 입력 → 같은 facts) ⑨ 섀도 로그에 발화 원문 부재. openapi 재생성·경로 집합 갱신(`/ai/v1/dialogue/memory`)·배선 게이트(getattr 이름 실존)·`test_architecture` 통과. 재생 픽스처 `intent_gate` 무변경.
- BE: `./gradlew :modules:assistant:test` + app IT; 와이어 키 집합 테스트 갱신; ANSWER 분기·quick reply 발급·길이 초과 폴백·llm_calls; 파기 호출 멱등.
- deploy: `deploy/eks/chart/tests`·`deploy/eks/tests` green(새 env 키·VECTOR_DB_URL 상시 주입·bootstrap 테이블).
- 실연동: 로컬 `docker compose --profile full up ai` + BE http 모드로 한 턴 왕복(날씨·다음 장소·대안) 확인, `intent_shadow` 줄 1건 이상 확인.
