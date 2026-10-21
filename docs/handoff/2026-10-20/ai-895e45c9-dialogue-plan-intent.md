---
session: 895e45c9-d493-4eb7-a659-b8b1ee84c83f
area: ai
cwd: ai
branches_seen: [develop]
current_branch: develop (worktree: wt-dialogue-plan=feat/ai-dialogue-compound · wt-plan-gaps=fix/ai-dialogue-plan-gaps · wt-answer-clock=fix/ai-answer-clock-forms)
span_kst: "09-29 18:11 → 10-20 22:31"
ended_by: weekly-limit
status: 리뷰-대기(PR 3개) — #1463 은 운영 조건부 머지
resume_local: "claude --resume 895e45c9-d493-4eb7-a659-b8b1ee84c83f"
related_prs: [1420, 1456, 1463, 1476, 1485]
tickets: []
session_name: ai-e3 (도구 계획 단계·분류 프롬프트 소유)
---
# 도우미 계획 단계 DIALOGUE_PLAN #1420 머지·개발 ON / #1463(사고 끔·분류 0.2.4) 운영 조건 대기 / #1476·#1485 CI

## 목적
**ai-e3**. 9-29 BE→AI 계약 점검으로 시작, 지금은 **도우미 도구 계획 단계(DIALOGUE_PLAN)와 분류 프롬프트(dialogue_intent.yaml)·계획 프롬프트(dialogue_plan.yaml)·측정셋** 소유자. "의도 하나로 안 떨어지는 말도 조회 도구 ≤2 로 답한다".

## 오늘(10-20) 한 일
- 15:33~15:47 #1420 rebase·충돌 해소, 실측 반영 커밋(사고 끔 none·프롬프트 0.1.1·말에 없는 지역 버림)
- 16:27~16:38 **#1456 머지** — LLM 연결 keepalive 5초→100초(턴마다 TLS 새로 맺던 것, 약 0.5s 절감)
- 17:48 **#1420 머지** — 계획 단계 DIALOGUE_PLAN(배정 시 켜짐). 개발 서버 ON(도구 7종, 런 39403152170). 운영 2런으로 ON(배포 세션 20:45)
- 18:05~18:54 **#1463** `feat/ai-dialogue-compound`: 분류·답변 사고 끔(none) + 분류 0.2.4 — 두 가지 같이 묻는 말은 계획 단계로(40%→90%), 한 의도 사례 100% 유지, p90 2.51→2.08s. 셀프 리뷰 6건 반영(축제·행사 분류 줄은 빼고 답변 세션 #1486 과 함께 가기로, 측정 채점 시한 실패를 정답 null 로 안 세게). 로컬 5,918 통과. **운영에 계획 단계가 켜진 뒤에만 머지**(그 전에 나가면 두 질문 말이 "도와드리기 어려워요" 카드)
- 18:10~18:34 공유 로컬 스택(wt-fe-sim) backend·ai 를 develop 최신으로 교체(결정 32). 이미지 2개 동시 빌드 중 임베딩 컨테이너 OOM → 재기동 정상. 다른 세션(ttys010)이 "백엔드 재시작 반복" 보고해 엇갈림 — 미해결
- 18:59~19:47 **#1476** `fix/ai-dialogue-plan-gaps`: 계획 프롬프트 0.1.2 — 일정 밖 등록 장소는 장소 정보 도구로, PLACE_DETAIL 은 메뉴·가격표처럼 도구에도 없는 정보, 계획 상한 3.5s
- 19:52 세션 한도 — 돌던 워크플로 3개(#1463 재검토·"사이 끼워 넣기" 설계·#1476 검토) 중지(단계 저장됨)
- 20:42~20:53 **#1485** `fix/ai-answer-clock-forms`: 답변 시각 검사(INV-2)가 "열두 시엔"·"세 시면"·"3pm"·전각 콜론을 놓침 → 한글 수사 시각은 낱말 첫머리에서만(위키 대조에서 '시(詩)'·'시도로' 오탐 방지). 21:00 CI 가 전혀 안 걸려 close/reopen
- 22:31 주간 한도

## 멈춘 지점 (현재 상태)
| PR | 브랜치 | 상태 | 조건 |
|---|---|---|---|
| #1463 | feat/ai-dialogue-compound | CI 통과 | **운영 DIALOGUE_PLAN ON 확인 후 머지** (배포 세션: 운영 2런 39417129852 로 켰음 — 결과 확인 필요) |
| #1476 | fix/ai-dialogue-plan-gaps | CI 통과 | 머지 가능 |
| #1485 | fix/ai-answer-clock-forms | **CI 체크 0건**(reopen 뒤에도) | 빈 커밋 push 나 `gh workflow run ai-ci.yml --ref fix/ai-answer-clock-forms` 로 CI 유발 필요 |
- worktree 3개 모두 미커밋 없음, 원격과 동일.
- "이태원→홍대 사이에 한 곳 더 넣을까요?" 설계(trippilot-df 에서 넘어옴)는 워크플로 중단 상태, 코드 없음.
- #1475(ea9f15f0) 머지 뒤 분류 A/B 재측정 + 계획 측정셋 "서울 날씨" 항목 추가가 이 세션 몫.

## 다음에 이어서 할 일
1. 운영 2런(39417129852) 성공 + 기동 로그 "계획 단계 on" 확인 → `gh pr merge 1463 --squash`.
2. `gh pr merge 1476 --squash`.
3. #1485: CI 유발 → 통과 시 머지.
4. 위 셋 머지 뒤 bb335bd9 의 `integ-recommend` 가 이 세 브랜치를 merge 해 두었으므로 그쪽 rebase 안내.
5. #1475 머지 뒤 `ai/scripts/measure/measure_prompt_ab.py` 로 분류 A/B 재측정, `ai/data/dialogue_plan_eval_set.yaml` 에 "서울 날씨" 항목.
6. 공유 로컬 스택 백엔드 재시작 반복 의혹 확인(`docker ps`, 로그).

## 함정 / 주의
- 측정은 **기준 판과 나란히 같은 시각 A/B**, 시한 초과를 정답으로 세지 않는다. 문서 수치는 한 번의 측정으로 통일.
- 분류 프롬프트에 축제·행사 줄은 **넣지 않았다**(답변 세션 #1486 이 행사 포트와 같은 판으로 가져감).
- `integ-recommend`(bb335bd9)가 `ai/prompts/dialogue_plan.yaml`·`dialogue_intent.yaml` 을 wip 로 건드렸다 — **프롬프트 소유자는 이 세션**. 그쪽 변경을 받을지 조율.
- 로컬 AI 이미지는 arm64 맥에서 직접 빌드(메모리: `local-ai-image-arm64-build.md`, 로컬 전용). 이미지 2개 동시 빌드 금지(OOM).
- 계획 LLM 시한 3.5s(0.1.2).

## 참조
- `ai/prompts/{dialogue_intent.yaml(0.2.4),dialogue_plan.yaml(0.1.2)}`, `ai/data/dialogue_plan_eval_set.yaml`, `ai/scripts/measure/measure_prompt_ab.py`
- `ai/src/trippilot/llm_gateway/adapters/deadline_http.py`(keepalive), `ai/aidlc-docs/construction/assistant-orchestrator/functional-design/business-rules.md`(미결 #28 등)
- 관련 세션: `ai-053ac554-dialogue-answer-prompt.md`, `ai-ea9f15f0-dialogue-weather-region.md`, `root-bb335bd9-decisions-codex-review-recommend.md`, `wt-mlops-serving-c9fb725e-deploy-release.md`
