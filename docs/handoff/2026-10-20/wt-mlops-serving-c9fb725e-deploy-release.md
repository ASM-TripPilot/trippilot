---
session: c9fb725e-3062-4457-aa4e-68a021f9c78f
area: wt-mlops-serving
cwd: .claude/worktrees/wt-mlops-serving   (세션 cwd 는 /Users/juna/dev 였고 여기 worktree 에서 release 브랜치를 만든다)
branches_seen: [release/main-2026-10-20a~e 외 다수 — 배포·릴리스 브랜치]
current_branch: release/main-2026-10-20e (머지 끝난 릴리스 브랜치, 원격은 삭제됨)
span_kst: "09-16 15:19 → 10-20 22:32"
ended_by: weekly-limit
status: 진행중 — 배포 큐에 머지된 PR 남음
resume_local: "claude --resume c9fb725e-3062-4457-aa4e-68a021f9c78f"
related_prs: [1442, 1444, 1453, 1460, 1467, 1470]
tickets: []
session_name: 배포 담당 세션
---
# 배포·운영 승격 담당 — develop→main 릴리스 5회(10-20a~e), 운영 2런 DIALOGUE_PLAN 켬, #1478 이후 미승격

## 목적
다른 세션들이 "배포 담당 세션" 이라 부르는 운영 세션. develop 을 `release/main-YYYY-MM-DD<x>` 브랜치로 main 에 `--no-ff` 머지 → `aws-deploy.yml` 워크플로로 개발(1런·2런)·운영 배포. 09-16 메모리 점검으로 시작해 MLOps 서빙(Bedrock 학생 모델)·배포 전반을 맡게 됐다.

## 오늘(10-20) 한 일
- 11:49~12:05 `release/main-2026-10-20b`(#1442) 머지 → 운영 배포 (`push_mode=keep`, `poi_close_missing_dry_run=true`)
- 15:29~15:46 서빙 원장 주간 PR #1436 머지, `ai-serving-judge.yml` auto-merge → 직접 머지로 수정 #1444(develop 에 보호 규칙이 없어 `--auto` 거절됨)
- 16:07~16:27 `release/main-2026-10-20c`(#1453, develop f090e906) 머지·운영 승격
- 17:28~17:44 `release/main-2026-10-20d`(#1460, develop 00d197a7) — 카페 9,105곳·동네 분산·지역 이동 다시 짜기
- 18:13 #1467 문서: arm64 맥에서 `docker compose pull` 이 조용히 실패(종료 코드 0) — 이미지 날짜 확인 후 build 모드로
- 18:12~18:41 #1461(NL2SQL) 배포 검토 5가지(V2.77 뷰·AI 계정 읽기 전용·접속 주소 비시크릿·되돌리기·켜기). 개발 1런 39401021225(74654ca0) 성공: "NL2SQL off(미배선)"·"계획 단계 off(미배선)" 기동 줄 확인, 모델 23종 배정·미배정 2종
- 19:18~19:43 `release/main-2026-10-20e`(#1470, develop b95bb429) 머지 → **운영 1런 39409958055(main 18d80cfc) 정상**
- 20:45 운영 2런 **39417129852 — `DIALOGUE_PLAN` 만 켬**. 처음 건 2런(39416881559, NL2SQL 포함)은 #1478(캐시 키 버그) 이 막 들어와 **취소**(검증 단계에서 멈춤, 운영 시크릿 미변경)
- 21:07~22:32 한도

## 멈춘 지점 (현재 상태)
- 운영 main 은 develop `b95bb429`(10-20 19:18) 기준. 그 뒤 develop 에 머지된 것은 **운영에 없다**: #1478(NL2SQL 캐시 키) #1480(회고 요약) #1472(FE QA 7회차) #1482(답변 0.3.3) #1483(오늘 창 +4h) #1484(도보 실측 가드) #1468(답변 0.3.2 — 19:02 머지, b95bb429 이후인지 확인 필요).
- `DIALOGUE_SQL` 운영 배정은 "#1478 을 승격하는 런에 `DIALOGUE_SQL=gpt-5.6-luna` 를 넣어 켠다" 로 합의했고 **미실행**.
- 개발 서버에도 #1478·#1480·#1472·#1483·#1484 를 "함께 올린다" 고 했으나 한도 전에 런을 걸었는지 **digest 로 확인 불가** → `gh run list --workflow aws-deploy.yml --limit 10` 으로 확인.
- 이 worktree(`wt-mlops-serving`)는 `release/main-2026-10-20e` 에 체크아웃된 채이고 미커밋 없음. 다음 릴리스는 `git fetch && git switch -c release/main-2026-10-21a origin/main && git merge --no-ff --no-edit <develop sha>` 로 새로 만든다.

## 다음에 이어서 할 일
1. `gh run list --workflow aws-deploy.yml --limit 10 --json databaseId,status,conclusion,headSha,createdAt` 로 20:45 이후 개발 배포가 돌았는지 확인. 안 돌았으면 develop 최신으로 개발 1런(입력 없음).
2. 개발 서버에서 #1483·#1484·#1464 를 실기 확인하는 것은 trippilot-df 세션 문서 참조(사용자가 앱에서 서울·도보 생성).
3. 운영 승격: `release/main-2026-10-21a` ← develop 최신. `.github` 차이 0 확인 → PR → `gh pr merge --merge` → 운영 1런(입력 없음) → 운영 2런에 `llm_feature_models=DIALOGUE_PLAN=gpt-5.6-luna,DIALOGUE_SQL=gpt-5.6-luna` 로 NL2SQL 켬 → 로그에 `InsufficientPrivilege` 없는지 확인.
4. 2런 끝나면 계획 단계 세션(ai-e3)에 런 번호 전달 — 그 세션은 **운영에 계획 단계가 켜진 뒤에만 #1463 을 머지**한다.
5. 상황 감지 세션 요청 대기: 운영 공휴일 휴무 켜기(결정 ⑦) + 운영 dry-run — 상황 감지 문서의 조건(10-21 아침 회차 경고 없음) 충족 확인 후.
6. 미결(사용자 결정): 멀티아키(arm64) 이미지 발행 여부 — CI 이미지 잡 시간 2배 vs Apple Silicon 수동 빌드 지속. 티켓도 결정 문서에도 없다(34d55fc6 세션이 지적).

## 함정 / 주의
- 운영 배포는 **1런(코드만, 기능 off) → 2런(기능 배정)** 두 단계. 2런은 해당 커밋의 ai-ci 가 끝나야 걸 수 있다.
- NL2SQL 켜기 전 조건: #1478 포함. AI 계정 권한은 부트스트랩이 Flyway 보다 먼저 돌아 1런에서는 뷰가 없을 수 있다 → 2런에서 확실히 걸린다.
- `ai-serving-judge.yml` 의 원장 PR 은 `--auto` 가 아니라 **직접 머지**(#1444). 10-19 에 넣은 auto-merge 는 한 번도 안 걸렸었다.
- arm64 맥: `docker compose pull` 종료 코드 0 이어도 실패일 수 있다 — 이미지 날짜 확인(`docs/guides/로컬-개발-컨테이너.md`).
- 공공데이터 키 때 생긴 "옛 커밋으로 되돌리면 검증에 걸리는" 문제는 NL2SQL 접속 주소에는 없다(배포 때 생성되는 값).
- 전 세션 규칙: AWS 키 재발급 필요 시 `open https://isb.etslearning.co.kr/` 로 포털 띄우기, `~/.aws/credentials` 해당 섹션 3줄만 교체 안내.
- 이 세션의 기억은 로컬 메모리와 claude.ai artifact 에 분산 — 클라우드는 이 문서만 본다.

## 참조
- `.github/workflows/{aws-deploy.yml,ai-serving-judge.yml}`, `deploy/`, `ai/docs/mlops/serving-ledger.md`
- 관련 세션: `ai-dddebc4b-serving-codex-review.md`(서빙 트랙 리뷰), `root-1b098b1e-planb-situation-awareness.md`, `root-f916bf14-chatbot-nl2sql-place-info.md`, `ai-895e45c9-dialogue-plan-intent.md`
