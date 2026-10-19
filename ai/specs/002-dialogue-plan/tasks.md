---
description: "범위 밖 질문의 도구 계획(DIALOGUE_PLAN · 2‴) 태스크 — spec.md · plan.md · FD BR-AO-28·29 기준"
---

# Tasks: 범위 밖 질문의 도구 계획 (DIALOGUE_PLAN)

**Tests**: 헌법 III — 각 구현 태스크는 실패하는 테스트를 먼저 쓴다(빨강 확인 뒤 구현). CI 실 외부 호출 0.

경로는 모노레포 루트 기준. 작업 트리 `/Users/juna/dev/trippilot/wt-dialogue-plan`.

## Phase 1: 독립 부분 (코드 대조 검증과 무관)

- [x] T001 `LlmFeature.DIALOGUE_PLAN` + config 4표(LIGHT · `("llm_dialogue_plan","out_of_scope")` · 1024 · low, 재시도 미배정 — 분류와 같은 값).
  테스트 `test_llm_gateway_gateway.py::_EXPECTED_MODES` · `test_llm_output_caps.py`.
- [x] T002 `domain/plan_tools.py` — `PLAN_TOOLS` 7종 · `NEVER_TOOLS` · `PLAN_GAPS` · `MAX_PLAN_CALLS=2` · `MAX_ARG_CHARS=40` · `plan_tool_specs_json` ·
  기동 검사. 테스트 `tests/domain/test_plan_tools.py`(분류 `$intents` 두 바이트 골든 불변 포함).
- [x] T003 `gates/dialogue_plan.py` — `DialoguePlanGate`·`DialoguePlanDraft`. 테스트 `tests/llm_gateway/test_dialogue_plan_gate.py` + AO-P18 PBT.
- [x] T004 `gates/base.py` `_INJECTIONISH` 칸 머리에 `도구`. 테스트 `test_gate_injection_defense.py` 사례.
- [x] T005 `prompts/dialogue_plan.yaml` v"0.1.0" · `workers/dialogue_plan.py` — `build_dialogue_plan_vars`·`DialoguePlanWorker`.
  테스트 `tests/llm_gateway/test_dialogue_plan_worker.py`(변수 4종·최근 4건·`$memory` 없음·골격 위조·gap 집합·예시 게이트 통과·누설 없음·설정 표).
- [x] T006 `ai/data/dialogue_plan_eval_set.yaml` — 측정셋 38문장(도구 1 ·도구 2 · 도구 없음 · 주입), 누설 대조는 T005 테스트가 한다.
- [x] T007 `.env.example` `AI_LLM_FEATURE_MODELS` 에 `DIALOGUE_PLAN=gpt-5.6-luna`(자리값 — 실측으로 정한다) + 배정이 곧 켜기·2런 배포·볼트 반영 보류 주석.
- [x] T008 `docs/conventions/anti-patterns.md` — 발화 자유문 슬롯을 사실 칸에 싣지 말 것(#1413).

## Phase 2: 오케스트레이터 (코드 대조 검증 정정본 수신 뒤)

- [ ] T009 `orchestrator/dialogue_plan.py` — `plan_tools(ports)` · `step_tasks`/`step_results` · `merge_facts` · 기동 검사. 테스트 `tests/orchestrator/test_dialogue_plan.py`(AO-P20).
- [ ] T010 `orchestrator/dialogue_orchestrator.py` — 생성자 `planner` · `_plannable` · 2‴ 진입 2줄 · `_plan_turn`·`_plan_declined`·`_log_plan` · 상수 ·
  `_compose(closed=)` · 요약 미룸(턴 LLM 3회). 테스트 계획 턴 시나리오 18건 · AO-P19·P21 · AO-P3·P5·P6·P10·P14·P17 확장.
- [ ] T011 `api/dialogue.py` — 포트 선계산 · 배정 시 워커 조립 · 기동 줄("on/off … 미배선"). 테스트 `tests/api/test_api_dialogue_turn.py`.
- [ ] T012 `scripts/measure/measure_prompt_ab.py plan` + answer 병합 사례 3 — 실 GPT 측정(luna·terra·sol), yaml 머리에 수치.
- [ ] T013 FD 개정(BLM·BR·DE) · 상위 문서 2종 한 줄 · `ai/aidlc-docs/audit.md`.
- [ ] T014 셀프 리뷰(invariant-reviewer) → PR.
