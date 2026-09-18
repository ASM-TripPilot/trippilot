# U4 — C1 LLM Gateway: 비즈니스 로직 모델 (FD)

## 0. 설계 축 — "코드-주도 단발 호출"

Claude tool-use(LLM 주도 루프)는 **미채택**. 모든 LLM 호출은 `프롬프트 1개 → 구조화 JSON 1개` 단발이며,
무엇을 언제 부를지는 100% 파이썬 코드가 결정한다 (결정론 INV-4 · 지연 D38 · 검증 INV-1 · 비용).
"제한된 소형 LLM"은 4겹 장치로 구현: ① LlmFeature closed-set ② 전용 프롬프트 ③ 스키마 파서 강제 ④ ClosedSetGate.

## 1. 모듈 배치

```
src/trippilot/c1/
  config.py        C1Config — TIER_MAP(feature→tier)·MODEL_IDS(tier→model_id, 설정값)·
                   timeout_sec=2.5·max_tokens·temperature=0.0(결정론 지향)
  prompts.py       PromptRegistry — prompts/*.yaml 로드 → render(변수) 결정론 → (프롬프트 문자열, PromptRef)
  gate.py          ClosedSetGate + 스키마 파서 — raw_text → RawScore들 → 풀 교차 → (ScoredPoi들, GateDropEvent?)
  context.py       ContextResolver — resolve(principal, ref) 권한 재조회 · 위반 → PermissionDeniedError
  gateway.py       TierRouter + GatewayFacade — 호출 파이프라인의 유일한 관문
  workers/
    preference.py  PreferenceScoringWorker — score(pool, persona_ref, principal) → TypedResult[tuple[ScoredPoi,...]]
  adapters/
    anthropic_adapter.py  AnthropicAdapter(LlmPort) — client 주입식(테스트는 fake client), 실 스모크 = K-1
prompts/
  preference_scoring.yaml  v0.1.0 — 정본 §2.1 시스템 프롬프트 실체 (few-shot은 K-2에서 보강)
```

의존 방향: `workers → gateway → (prompts·gate·config) → domain/ports`. c1은 c2·m7을 import하지 않는다
(규칙 점수 폴백 실행은 호출측 몫 — §3). 아키텍처 테스트로 강제.

## 2. GatewayFacade.call — 7단계 파이프라인

```
call(feature, prompt_vars, pool | None, trace_id, clock) → TypedResult[T]

 1 feature ∈ LlmFeature 검증          (밖이면 ValueError — 호출 자체가 버그)
 2 TierRouter: feature → tier → model_id   (전부 C1Config 조회 — 결정론)
 3 PromptRegistry.render(feature, vars) → (prompt, PromptRef)
 4 LlmPort.invoke(LlmRequest(timeout 2.5s))          ← SDK가 닿는 유일한 지점
 5 스키마 파서: raw JSON → RawScore들      (파싱 실패 = 폴백 경로)
 6 ClosedSetGate: pool.contains 교차       (풀 밖 드롭 + GateDropEvent, 전량 드롭 = 폴백 경로)
 7 TypedResult(value, call_record) 조립 + trace.emit(LlmCallRecord)
```

**실패 경로 (5·6단 실패, LlmTimeoutError, LlmPort 예외) — 전부 동일 형태로 수렴:**
`TypedResult(value=None, is_fallback=True, error=사유)` + `FallbackEvent` + `LlmCallRecord(success=False)`.
침묵 실패 없음(INV-4) — 예외를 위로 던지지 않고 **폴백 신호로 변환**하는 것이 게이트웨이의 책임.

## 3. PreferenceScoringWorker (경량 티어, 전 일자 공용 1회)

```
score(pool, persona_ref, principal):
  1 ContextResolver.resolve(principal, persona_ref) → PersonaSummary   (D31 — 권한 위반 시 즉시 예외)
  2 prompt_vars = {취향 7축, 동반자, 예산, 후보(poi_id·카테고리·상호명 — 좌표 미포함 G181)}
  3 gateway.call(PREFERENCE_SCORING, vars, pool) → TypedResult[tuple[ScoredPoi,...]]
```

- 성공: `ScoredPoi(is_llm_score=True)`, score는 0.0~1.0 클램프.
- 폴백: TypedResult(is_fallback=True)를 **그대로 반환** — 규칙 점수(U2 `scorer.build_rule_score`) 실행은
  호출측(U5 ScheduleAgent)의 몫. C1은 판단 재료 제공자이지 폴백 실행자가 아니다 (경계 = agent-structure-v2).

## 3.1 워커별 컨텍스트 재조회 소유 (D31 경계)

D31 재조회는 **정확히 한 계층에서만** 일어난다. "워커는 항상 ContextResolver를 거친다"가 아니라
**개인·소유 데이터 참조(`ResourceRef`)를 프롬프트 재료로 직접 조립하는 쪽이 재조회를 소유한다.**
이미 상위 계층이 재조회한 값을 워커가 다시 끌어오면 권한 검사·감사 로그가 이중으로 남고,
두 조회 사이 값이 갈려 프롬프트와 Agent 판단의 입력이 어긋난다.

| 워커 | ContextResolver 경유 | 재조회 소유자 | 근거 |
|---|---|---|---|
| `PreferenceScoringWorker` | **O** | 워커 자신 (`persona_ref`) | 호출측이 참조만 넘긴다 — 조립 지점이 워커 |
| `ExplanationWorker` | **O** | 워커 자신 (`persona_ref`) | 동일 (취향 요약을 워커가 조립) |
| `EditTranslationWorker` | **X** | **EditAgent (U5)** | 봉투 프로토콜상 Agent가 `context_refs`를 먼저 재조회한다 (agent-foundation FD business-logic-model §3 "Agent: context_refs 재조회(D31) → 판단"). 워커는 확정 입력(발화·대상 날짜·현재 슬롯·후보 풀)만 받고 **개인 데이터를 다시 끌어오지 않는다** |
| ~~`ReflectionWorker`~~ | — | — | **제거됨** (2026-08-25 TRIP-558 — `REFLECTION_TEMPLATE`으로 흡수). 후속 `ReflectionTemplateWorker`도 입력이 서버 조립값(`ReflectionRequest`)이라 `ResourceRef` 없음은 동일 |
| `PlaceExtractionWorker` | X | 해당 없음 | 입력이 웹 문서 — 개인·소유 데이터가 아니다 |

- 판정 기준 한 줄: **`ResourceRef`를 인자로 받으면 그 워커가 재조회 소유자, 확정값을 받으면 호출측이 소유자.**
  이 경계는 워커 생성자 시그니처로 드러난다 — `ContextResolver` 주입 여부가 곧 소유 표시다.
- `EditTranslationWorker`가 D31을 우회하는 것이 아니다: 재조회는 EditAgent에서 이미 수행됐고, C1은 그 결과를 소비할 뿐이다.
  따라서 BR-U4-07의 "재조회 값만" 요건은 여전히 충족된다 (재조회 **지점**이 워커 밖일 뿐).

## 4. AnthropicAdapter (LlmPort 플러그)

- `anthropic` SDK를 **생성자 주입** 클라이언트로 감싼다 — 테스트는 fake client 객체로 매핑만 검증 (D37: CI 실 API 0).
- `messages.create(model=request.model_id, max_tokens, timeout)` → `LlmResponse(raw_text, 토큰, latency_ms, model_id)`.
- SDK 타임아웃/APIError → `LlmTimeoutError`/재던짐 없이 게이트웨이 실패 경로로.
- 실 API 스모크는 **K-1(결제 승인 후)** — 이 유닛의 DoD에 실 호출은 없다.

## 5. 테스트 전략 (전부 U1 fake 재사용)

| 대상 | 도구 |
|---|---|
| 게이트 적대적 PBT (U5-P5) | U1 `polluted_scored_pois` generator — 오염 주입 후 환각 0 단언 |
| 게이트웨이 성공/타임아웃/거부 | `FakeLlm` 3모드 · `SlowLlm` · `FailingLlm` |
| 계측 정합 | `InMemoryTrace` — 이벤트 수집 후 단언 |
| 권한 | FakeResolver(신규, tests/fakes) — owner 불일치 → PermissionDeniedError |
| 어댑터 매핑 | fake anthropic client (record-and-return 객체) |
| 순수성 | 아키텍처 테스트 보강: c1은 c2·m7 import 금지, SDK import는 adapters만 |
