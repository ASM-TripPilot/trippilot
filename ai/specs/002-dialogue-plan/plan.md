# Implementation Plan: 범위 밖 질문의 도구 계획 (DIALOGUE_PLAN · 2‴)

**Branch**: `feat/ai-dialogue-plan` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**설계 정본(재서술하지 않는다)**: `ai/aidlc-docs/construction/assistant-orchestrator/functional-design/`
- business-rules.md — BR-AO-28(계획 단계: 진입·도구·출력·게이트·상한·실행·병합·수렴) · BR-AO-29(관측) · AO-P18~21
- business-logic-model.md — DEC-AO-17·18 · §3 2‴ 행 · §4·§6 시한 배분 · §7 폴백 표 · §11·§13 2런 배포
- domain-entities.md — §2.10 DIALOGUE_PLAN 행 · §2.11 `DialoguePlanDraft`·`PLAN_TOOLS`·`merge_facts`·로그 필드

이 plan 은 FD 의 각 절이 떨어지는 코드 자리만 적는다.

## 코드 자리

| FD | 코드 |
|---|---|
| DE §2.11 도구 표 · BR-AO-28 도구 | `ai/src/trippilot/domain/plan_tools.py` (신규, 도메인 — c1 이 import 한다, L-1) |
| DE §2.10 · BR-AF-07 세트 | `ai/src/trippilot/domain/llm.py` · `ai/src/trippilot/llm_gateway/config.py` · `.env.example` |
| BR-AO-28 게이트 · AO-P18 | `ai/src/trippilot/llm_gateway/gates/dialogue_plan.py` (신규) |
| DE §6 변수 | `ai/prompts/dialogue_plan.yaml` · `ai/src/trippilot/llm_gateway/workers/dialogue_plan.py` (신규) |
| BR-AO-21 가드레일 계단 | `ai/src/trippilot/llm_gateway/gates/base.py` `_INJECTIONISH` 칸 머리 `[도구]` |
| BLM §3 2‴ · BR-AO-28 실행·병합 · AO-P19·20 | `ai/src/trippilot/orchestrator/dialogue_plan.py` (신규) · `orchestrator/dialogue_orchestrator.py` (진입 2줄·`_plan_turn`·`_compose(closed=)`·요약 미룸) |
| BLM §11 조립 · DEC-AO-18 | `ai/src/trippilot/api/dialogue.py` `build_dialogue_orchestrator` (포트 선계산·배정 시 워커 조립·기동 줄) |
| BLM §8 측정 | `ai/data/dialogue_plan_eval_set.yaml` · `ai/scripts/measure/measure_prompt_ab.py plan` |

**무변경**(이 spec 의 PR 기준 — 뒤이은 `dialogue_intent.yaml` 0.2.4 는 두 질문 말을 null 로 닫아 US1 시나리오 2 가 계획 단계에 오게 한다,
별도 PR · 2026-10-20): `ai/docs/openapi.json` · `prompts/{intent,dialogue_intent,dialogue_answer}.yaml` · `workers/dialogue_answer.py` ·
`orchestrator/dialogue_handlers.py` · `domain/dialogue.py` · `api/wiring.py` · `tests/fixtures/intent_gate/*` · 백엔드·프론트·배포 전부.

## Constitution Check

- 4 불변식: 계획은 닫힌 도구 이름·문자열 인자만 내고(INV-1), 인자 시각은 게이트가 버리며 원문 인자가 Facts 에 닿지 않는다(INV-2),
  거리 문자열뿐(INV-3), 모든 갈래가 종전 범위 밖·템플릿으로 수렴하고 폴백에 이벤트가 짝이다(INV-4).
- TDD + PBT: 각 단위는 실패하는 테스트 먼저. AO-P18(게이트 closed-set)~P21(인자 비유출)이 차단 게이트.
- 최소주의: 도구를 새로 만들지 않는다 — 핸들러·인자표·`tool_specs` 를 그대로 쓰고 표 한 장만 더한다.
