---
session: 0b997ca7-adb2-4e38-a9f2-eff6624f750d
area: root
cwd: .
branches_seen: [develop]
current_branch: develop
span_kst: "10-19 19:45 → 10-20 18:00"
ended_by: idle-since-10-19 20:03 (10-20 은 broadcast 수신만)
status: 완료
resume_local: "claude --resume 0b997ca7-adb2-4e38-a9f2-eff6624f750d"
related_prs: []
tickets: []
---
# (완료) `/wiki-sync ai/src/trippilot/agents` — 볼트 노트 b95f9407 기준 갱신

## 목적
llm-wiki 볼트의 `ai/src/trippilot/agents` 범위 노트를 코드 커밋 `b95f9407` 기준으로 맞추는 1회성 sync.

## 오늘(10-20) 한 일
- 18:00 broadcast 수신만.

## 멈춘 지점 (현재 상태)
10-19 20:03 완료. 볼트 커밋 `ae8749d`, push 완료. 낡은 노트 10개 갱신·새 노트 3개(`pg_memory_store`, `planb composition`, `request_verification`), lint 0 오류, 표본 5개 코드 대조 일치. 허브 기준 커밋 표기는 **일부 범위 갱신이라 올리지 않음**.

## 다음에 이어서 할 일
1. 없음. 다음 sync 는 필요한 영역에 `/wiki-sync <경로>` 로.

## 함정 / 주의 (이 sync 에서 뒤집힌 노트 전제 — 코드 작업 시 참고)
- **/replan 에서 대체지 선택 LLM 은 돌지 않는다.** #1149 부터 PlanB 에이전트는 `use_llm=False`. 구성 LLM(하루 일정 고르기)만 운영에 연결. KB-5 장소 지식이 프롬프트에 실리는 곳은 `/alternatives` 하나.
- `directive_feedback` 캐시가 호출되지 않는 이유는 "번역 워커 미조립" 이 아니라(#970 부터 돈다) `remember_free_text` 호출 한 줄이 빠진 것.
- Reflect 사진 하이라이트 워커는 연결돼 있다(#1238). #1320 부터 AI 는 사진 자리만 내고 앱이 기기 사진으로 채운다.
- 재계획에서 잠긴 블록을 못 넣을 때 처리가 바뀌었고(#1181), 질문뱅크는 #1185 부터 의도적으로 메모리에만 둔다.
- 범위 밖이라 그대로 둔 낡은 노트: `prompt replan_request_extraction`.

## 참조
- 볼트: `~/dev/llm-wiki/wiki/trippilot/ai/src/agents/`, `MOC - agents` (로컬 전용)
