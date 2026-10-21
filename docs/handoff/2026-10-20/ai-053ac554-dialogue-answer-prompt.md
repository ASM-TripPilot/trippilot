---
session: 053ac554-b6e2-448f-944e-d12b0509f6ba
area: ai
cwd: ai
branches_seen: [develop, feat/assistant-friendly-tone, feat/assistant-answer-feedback-fe]
current_branch: develop (작업은 /Users/juna/dev/trippilot/wt-explore-events, 브랜치 feat/ai-explore-events)
span_kst: "10-17 22:34 → 10-20 22:32"
ended_by: weekly-limit
status: 리뷰-대기(PR)
resume_local: "claude --resume 053ac554-b6e2-448f-944e-d12b0509f6ba"
related_prs: [1468, 1482, 1486]
tickets: []
session_name: 답변 담당 세션 (답변 프롬프트·의도 분류·맞장구 소유)
---
# 도우미 답변 프롬프트 0.3.2(#1468)·0.3.3(#1482) 머지, 축제·행사 탐색 #1486 CI 통과 머지 대기

## 목적
10-17 "의도 파악 3단계 말고 바로 오케스트레이터 → 에이전트·프로바이더 병렬 호출 → 조합 답변" 지시로 도우미 오케스트레이터 시리즈(#1308~#1367)를 만들고, 지금은 **답변 말투·의도 분류·짧은 맞장구** 소유자. 챗봇 테스트 세션(f916bf14)·계획 단계 세션(ai-e3)과 분담.

## 오늘(10-20) 한 일
- 16:32~16:33 ai-e3 측정 검토: 분류·답변 effort `none` 전환 **확정**(0.3.1 에서 고친 말투 문제 3종 모두 0 유지, 지어낸 사실 0). 대가: 앞선 제안 없는 "응" 이 오늘 일정을 연다(수용)
- 16:36 분담 합의: 계획 단계 = ai-e3 / "서울 핫한 곳" 실데이터 = 챗봇 테스트 세션 / 말투·분류·맞장구 = 이 세션. NL2SQL 방식은 "LLM 이 정해진 값만 고르고 조회는 코드" 를 추천했으나 **사용자는 LLM 직접 SQL(#1461)로 결정**
- 19:02 **#1468 답변 0.3.2 머지**(66201f8d9): 탐색·대신 갈 곳 답의 지킬 수 없는 마무리("장소별 거리를 확인해 드릴까요?") 48/64→0/64, 내부 칸 이름 노출 5→0, 분류 그대로 읽는 답 47%→0~5%, 모르는 입장료는 답변 재료에서 제외(카드엔 유지)
- 20:52 **#1482 답변 0.3.3 머지**: 장소 소개(KB-5)를 통째로 옮기던 것 29/29→16/29, 소개 글 속 숨은 지시 추종 2/15→0(주입 방어를 소개 글까지)
- 20:43~20:55 **#1486 축제·행사(C)**: "이번 주말 서울 축제 있어?" 를 행사 저장소로 답함(기간 낱말 해석, 15km, 못 찾으면 "찾은 행사는 없어요" + 장소). 시각·주입 꼴 거르기 포함. 전체 5,940 통과, 지어낸 행사 0. 행사 답에 "궁금한 곳을 눌러서" 붙던 문제는 0.3.4 한 줄로 15/16→3/15
- 21:05 한도

## 멈춘 지점 (현재 상태)
- PR #1486 `feat/ai-explore-events`: CI test·image SUCCESS. **머지만 남음.** worktree `wt-explore-events` 미커밋 없음.
- 머지 뒤 "탐색 핸들러를 같이 쓰는 두 세션(f916bf14·bb335bd9)에 알린다" 가 미실행 — 두 세션 모두 `dialogue_handlers.py` 탐색 경로를 손대고 있어 **충돌 가능**.
- "불꽃축제 언제 해?" 가 날씨로 분류되는 건은 분류 프롬프트 변경이 필요해 ai-e3 몫으로 넘김(#1463 다음).
- 남은 말투 잔여: 다음 일정 답에 탐색 마무리 0~3/7, 방금 답한 영업시간 되묻기 1/8.

## 다음에 이어서 할 일
1. `gh pr merge 1486 --squash`. 머지 직후 `integ-recommend`/`feat/assistant-recommend-places`(bb335bd9)와 `fix/ai-place-sql-rich-order`(f916bf14) rebase 때 `dialogue_handlers.py` 충돌을 예상하고 처리.
2. 운영은 아직 effort `low` — `none` 전환은 #1463(ai-e3) 머지로 간다. 그 PR 상태 확인.
3. 행사 답의 마무리 잔여(3/15)·"불꽃축제" 분류는 0.3.4/분류 0.2.5 후속 — 측정은 `ai/scripts/measure/measure_prompt_ab.py` 로 기준 판과 나란히(144회×2 방식).

## 함정 / 주의
- 답변 프롬프트 측정 방식: **기준 판과 나란히, 같은 시각 A/B, effort none**. 한 번 측정으로 수치를 통일한다(ai-e3 문서 참조).
- 모르는 값은 답변 재료에서 빼되 카드에는 남긴다(입장료 사례). 프롬프트 문구로 못 고치면 코드로.
- 주입 방어는 사용자 발화뿐 아니라 **KB-5 소개 글**까지(0.3.3). 테스트: `test_gate_injection_defense.py`, `test_prompt_structure_forgery.py`.
- 서버 로그에는 설계상 발화 원문을 남기지 않는다 — "어제 테스트한 원문" 은 아무 세션에도 없다.
- 네이버 지역검색 적재·블로그 언급 수 인기 신호는 약관으로 **접었다**.

## 참조
- `ai/prompts/dialogue_answer.yaml`(0.3.3), `ai/src/trippilot/llm_gateway/workers/dialogue_answer.py`, `ai/src/trippilot/orchestrator/{dialogue_handlers.py,dialogue_orchestrator.py}`, `ai/src/trippilot/api/dialogue.py`
- 관련 세션: `ai-895e45c9-dialogue-plan-intent.md`, `root-f916bf14-chatbot-nl2sql-place-info.md`, `root-bb335bd9-decisions-codex-review-recommend.md`
