---
session: 4f5391d2-f299-42f4-ba69-6c079b350747
area: root
cwd: .
branches_seen: [develop]
current_branch: develop
span_kst: "09-13 16:42 → 10-20 18:00"
ended_by: idle-since-10-19 22:30 (10-20 은 broadcast 수신만)
status: 완료 — 대기
resume_local: "claude --resume 4f5391d2-f299-42f4-ba69-6c079b350747"
related_prs: []
tickets: []
---
# llm-wiki 운영 세션 — 자동 sync 는 꺼진 상태 유지(결정 18 보류), 색 에이전트 2개 유지

## 목적
개인 Obsidian 볼트 `~/dev/llm-wiki`(Karpathy llm-wiki 패턴, 코드 미러 노트)의 sync 자동화·훅·에이전트를 다루는 세션. 09-13 "금요일 새벽 전체 sync, 실패분 토요일 재시도" 설계로 시작.

## 오늘(10-20) 한 일
- 18:00 전 세션 broadcast(AWS 키 포털 띄우기 규칙) 수신만. 작업 없음.

## 멈춘 지점 (현재 상태)
10-19 저녁 정리로 끝난 상태:
- 사용자가 본 "프롬프트 창 파란 테두리 + wiki-sync" 는 백그라운드 에이전트를 작업 패널에서 **보는 상태**의 배너였다(Claude Code 바이너리에서 확인). 작업 종류에 따라 테두리가 저절로 바뀌는 설정은 **없다**.
- 그래도 sync 배치 에이전트 = 파랑, 위키 조회 에이전트(`wiki-lookup`) = 초록으로 만들어 두었고 전역 `~/.claude/CLAUDE.md` 에 한 줄로 연결했다. 사용자 요청이라 **유지**.
- 결정 18(자동 sync 재개)·19(조회 훅 2개) 는 **보류** → launchd 자동 sync 는 10-10 부터 꺼진 채, 훅은 켜진 채.
- 전역 `~/.claude/CLAUDE.md` 52행 "정기 갱신은 launchd 가 자동으로 한다" 는 **실제(꺼짐)와 다르지만 보류 결정에 따라 고치지 않음**. 고칠 문안은 세션 기록에 있다.

## 다음에 이어서 할 일
1. 할 일 없음. 사용자가 자동 sync 재개를 결정하면: `~/dev/llm-wiki/scripts/wiki_autosync.sh` 를 launchd(`com.juna.llm-wiki-sync`)에 다시 걸고 전역 CLAUDE.md 52행을 함께 고친다.
2. 볼트 노트가 낡았을 때는 범위를 줘서 `/wiki-sync <리포경로>` 로 그 영역만 갱신(전 영역 sync 는 세션에서 먼저 제안하지 않는다).

## 함정 / 주의
- 볼트는 **이 Mac 로컬 전용**(`/Users/juna/dev/llm-wiki`, 원격 github.com/JunaPark831/llm-wiki). 클라우드 세션은 못 본다.
- 볼트 규약: `raw/` 불변, `wiki/index.md`·`wiki/log.md`(append-only) 갱신 필수, Co-Authored-By 트레일러 금지, 커밋 메시지 한국어 한 줄.
- 다른 세션이 "자동 sync 를 다시 켜자" 거나 "52행을 고치자" 고 하면 **보류 결정**을 알려 준다(메모리에 기록돼 있음).

## 참조
- `~/dev/llm-wiki/CLAUDE.md`, `~/dev/llm-wiki/scripts/{wiki_check.sh,wiki_autosync.sh,wiki_stale.py,wiki_lint.py}`
- `ai/.claude/agents/obsidian-wiki.md`(리포 안, 볼트 사서 서브에이전트 정의)
- 관련 세션: `root-a353999c-prompt-border-investigation.md`, `root-0b997ca7-wiki-sync-agents.md`
