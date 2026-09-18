# U4 — C1 LLM Gateway: 비즈니스 규칙 + PBT 게이트 (FD)

## 1. 규칙 (BR-U4)

| # | 규칙 | 근거 |
|---|---|---|
| BR-U4-01 | LLM 경유 출력이 사용자/후속 단계로 가려면 **반드시 ClosedSetGate를 통과** — 풀 밖 poi_id는 드롭 + GateDropEvent | INV-1 |
| BR-U4-02 | 게이트 전량 드롭·파싱 실패·타임아웃·벤더 예외 → `TypedResult(is_fallback=True)` + FallbackEvent. **예외를 밖으로 던지지 않는다** | INV-4 |
| BR-U4-03 | 모든 호출(성공·실패 불문)에 `LlmCallRecord` 발행 — TypedResult.call_record 첨부 | NFR-7.1 |
| BR-U4-04 | 타임아웃 2.5초 (요청 예산 5초의 절반 이하) | NFR-1.2, D38 |
| BR-U4-05 | `LlmFeature` enum 밖의 기능으로 게이트웨이 호출 불가 (ValueError) — "기능 목록도 closed-set" | AI-D06, 소형 LLM 제한 원칙 |
| BR-U4-06 | 프롬프트는 `prompts/*.yaml` + semver — PromptRef 없는 LlmRequest는 타입상 불가능. 렌더는 결정론 | NFR-7.3 |
| BR-U4-07 | 프롬프트 입력은 ResourceRef 재조회 값만, 필드 최소화(좌표 미포함) — 권한 위반 시 PermissionDeniedError, **조용한 제외 금지**. 재조회는 **한 계층에서만**: `ResourceRef`를 받는 워커가 소유(PreferenceScoring·Explanation), 상위 계층이 이미 재조회해 확정값을 넘긴 경우 워커는 다시 조회하지 않는다(EditTranslation ← EditAgent) — 소유 표는 business-logic-model §3.1 | D31, G181 |
| BR-U4-08 | model_id는 항상 설정값(C1Config) — 코드에 모델 문자열 하드코딩 금지 | AI-D06 |
| BR-U4-09 | 규칙 점수 폴백 **실행**은 호출측(U5) — C1은 신호만. c1 → c2·m7 import 금지 | agent-structure-v2 경계 |
| BR-U4-10 | 실 API 호출은 CI·테스트에서 0건 — 어댑터는 주입식, 스모크는 K-1 | D37 |

## 2. PBT 게이트 (hypothesis — 전부 통과해야 유닛 종료)

| ID | 속성 | 전략 |
|---|---|---|
| GATE-P1 | **어떤 오염된 LLM 출력에도** 결과 poi_id ⊆ 풀, 드롭 수 = 입력−생존 (U5-P5 승계) | `polluted_scored_pois` |
| GATE-P2 | 전량 드롭 → is_fallback=True (부분 생존 시엔 생존분만 반환) | 오염률 0~100% 스윕 |
| GW-P1 | 타임아웃·예외·파싱실패 → is_fallback=True ∧ value=None ∧ FallbackEvent 1건 ∧ record.success=False | SlowLlm·FailingLlm·쓰레기 텍스트 |
| GW-P2 | 성공 경로: call_record의 (feature, model_id, prompt_ref, 토큰)이 요청·응답과 정합 | FakeLlm echo |
| ROUTE-P1 | 라우팅 결정론 + 결과 model_id ∈ C1Config 값 집합 | 전 feature 스윕 |
| CTX-P1 | owner ≠ principal인 ref가 하나라도 있으면 PermissionDeniedError (부분 성공 0) | ref 목록 무작위 |
| PROMPT-P1 | 렌더 결정론 ∧ 후보 poi_id 전원이 프롬프트 문자열에 포함(누락 금지) ∧ 좌표 문자열 미포함 | 무작위 풀 |
| SER-P1 | PersonaSummary 직렬화 왕복 (U5-P10 승계) | 무작위 생성 |

## 3. DoD

- [ ] 위 PBT 전부 green (기존 91개 포함 전체 회귀 green)
- [ ] 아키텍처 테스트: c1 순수성(c2·m7 금지), `anthropic` import는 adapters 한정
- [ ] `prompts/preference_scoring.yaml` v0.1.0 존재 + Registry 로드 왕복
- [ ] demo.py에 "오염 출력 → 게이트 드롭 → 폴백 신호" 라이브 시연 추가
- [ ] 실 API 0건 (K-1·K-2는 결제 승인 후 백로그 유지)
