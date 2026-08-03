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
