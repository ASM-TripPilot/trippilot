---
name: dictate
description: "말로 남긴 요청을 자리 비운 사이 처리하는 워크플로 — 녹음(rec) → 전사(transcribe.sh) → triage(분류·제안) → 지라 본문(생성은 승인 뒤) → 항목마다 코드 레인(dev-cycle 자율)·피그마 레인(figma-build) 순차 실행 → 브리핑. 'dictate 돌려', '녹음한 거 처리해', '말한 거 정리해서 티켓·사이클 돌려', '아침에 볼 수 있게 해놔' 요청 시 사용하라. 시간대 무관. 전사만·triage만 같은 부분 실행도 이 스킬."
---

# Dictate — 말 → 항목 → 실행 → 브리핑

## 진입 (세션에서)
```
! ~/.claude/scripts/rec.sh start [슬러그]   …말함…   ! ~/.claude/scripts/rec.sh stop   # 여러 번 가능, ~/Dictate/{날짜}/*.m4a (새 터미널은 별칭 rec)
dictate 돌려          # 기본 planOnly = 할일 목록까지
dictate 실행해        # 목록 보고 고른 뒤 — 레인 실행(cap 2)
```
메뉴 막대 단축어 경로(`rec.sh toggle`·`ingest` + Monitor 트리거)는 시도 후 접었다 — 단축어 백그라운드 실행기가 마이크 권한을 요청하지 못해 ffmpeg 캡처가 막힘(사용자 결정 "세션에서 시작", 상세는 하네스 변경이력). 명령은 스크립트에 남아 있으나 진입점이 아니다.

## 순서
1. **전사** — `~/.claude/scripts/transcribe.sh ~/Dictate/{날짜}` = **가장 최근 미처리 녹음 1개**(회차 = 녹음 1개, 사용자 결정; `.processed`에 적힌 파일 제외, 1초 미만 제외, 전사 후 등록). 미처리 0건이면 "새 녹음 없음"으로 끝. 여러 개를 한 회차로 묶고 싶으면 한 번에 길게 녹음한다. 회차 id = `{날짜}-{HHMM}`, 산출 `<볼트>/구술/{회차}/00_transcript.md`(원문 + 녹음 파일명). 볼트 실경로는 `_workspace`의 부모(`…/Obsidian/TripPilot/`). 새 세션도 이 규칙만 따르면 된다 — 어느 녹음이 처리됐는지는 파일이 안다.
2. **Workflow** — `Workflow({ scriptPath: '<리포 루트>/frontend/.claude/workflows/dictate.js', args: { date, run, transcript, cap, planOnly } })`. **기본 = planOnly**(전사 → triage → 할일 목록 브리핑, 지라·레인 없음) — 메뉴 막대 트리거·"dictate 돌려"는 이 모드. **실행은 사용자가 "dictate 실행해"라고 명시할 때만** `planOnly:false`(첫 3회 `cap: 2`, 사람 동석). 할일 목록을 보고 항목을 골라 실행하는 게 정상 경로다.
   - Triage → `구술/{회차}/01_triage.md` (자유 층, 행동 없음). 직전 회차 폴더의 question·hold를 읽어 followUp 판정.
   - Jira → **code 레인 항목만** 본문 작성 후 **생성**(`jira.sh create-sub`). `jira-fe-subtask` §5 승인 게이트는 "dictate 실행해" 자체로 충족 — 사람이 planOnly 목록을 보고 고른 뒤에만 이 단계가 돈다. figma 레인은 티켓 없음(새 밴드는 탐색, 채택되면 코드 티켓).
   - Lanes → **figma 항목 전부 먼저, 그다음 code**, 항목마다 순차(병렬 없음). figma = figma-build(스펙 게이트 → figma-builder → figma-qa), 새 밴드까지만. code = 항목마다 `git worktree add -B feature/{키}-FE-{slug} .claude/worktrees/{slug} origin/develop`(**develop에서 분기** — 컨벤션; Workflow 자체 worktree 격리는 main 기준·호출마다 새 워크트리라 쓰지 않는다) 한 뒤 그 디렉토리에서 dev-cycle 단계를 `agent()` 사슬로(`--autonomous`: 3-a·퀴즈 생략, 5-b·6·8 생략 불가) → draft PR(제목에 키).
   - Brief → `구술/{날짜}/brief.md` + 아티팩트.
3. **브리핑 게시 — 고정 URL 아티팩트 + 푸시.** 워크플로 반환의 `html`을 `<스크래치패드>/dictate-brief.html`에 쓰고 **항상 같은 파일 경로로** `Artifact` 재게시(label = 날짜) → URL이 고정돼 폰 북마크 하나로 매 회차를 본다(이전 회차는 버전 선택기). 첫 게시 URL은 메모리 `dictate-voice-workflow`에 적어 두고 세션이 바뀌어도 `url`로 같은 아티팩트를 갱신한다. 게시 직후 `PushNotification`: "dictate {날짜}: figma N · code M · question Q · 승인 대기 K — {URL}". 옵시디언 `brief.md`는 검색용 기록. 사람이 보는 순서: 원문↔해석 대조 → question 답 → 지라 승인 → PR/밴드(스크린샷 내장) → 슬롭 의심 → 퀴즈 대기.

## 결과물에 대한 피드백 — dictate 밖에서
- **코드(PR)** → GitHub 리뷰 코멘트를 달고, 그 브랜치에서 별도로 "PR 코멘트 반영해"(dev-cycle 재개). dictate는 수집하지 않는다(사용자 결정: PR은 따로 처리).
- **피그마(밴드)·질문 답** → 다음 녹음에서 "그 e05 안…"처럼 재언급 → triage followUp → 같은 밴드 node 수정.

## 녹음 파일은 사용자 것이다
`~/Dictate/{날짜}/` 아래를 에이전트가 **삭제하지 않는다** — 전사 뒤에도 남긴다(원문 대조·재전사). 에이전트 시험 녹음은 `REC_TEST=1 rec start`로 `~/Dictate/.test/`에만 쓰고 그 폴더만 지운다(실측: 시험 파일 정리하며 사용자 녹음을 같이 지운 사고, 상세는 하네스 변경이력).

## 죽었을 때
Workflow는 `resumeFromRunId`로 그 자리부터. 사이클은 `_workspace/{날짜}-dictate-{slug}/RESUME.md`. 브리핑에 "중단, RESUME 참조"로 올라온다 — 조용한 생략 금지.

## 사람만 하는 것
지라 생성 승인 · draft PR 머지 · 밴드→정본 이식 · 슬롭 의심 동의 · 퀴즈. 자율 실행은 이 다섯을 **대기 목록**으로 만들 뿐이다.

## 유지 판정 (검사별)
- **triage 분류**: 3회 실행에서 code/figma로 보낸 항목 중 사람이 "그런 뜻 아니었음"으로 뒤집은 비율 > 1/3이면 triage를 question·제안 전용으로 격하.
- **cap**: 3회 모두 뒤집힘 0이면 올린다.
- **지라 생성(실행 시)**: 3회에서 잘못 만든 티켓(사람이 닫음)이 1건이라도 나오면 본문만 쓰고 생성은 사람 뒤로 되돌린다.
- **전사 후교정**: 3회에서 고유명사 오인식이 triage 후교정을 통과해 사이클에 들어간 건이 1건이라도 있으면 `transcribe.sh` prompt에 그 용어를 추가한다(격하 아님, 누적).
