---
session: ea9f15f0-9765-44ba-a865-7be4e7c8be45
area: wt-intent-langsmith
cwd: .claude/worktrees/intent-langsmith
branches_seen: [develop, park/fa-idle]
current_branch: park/fa-idle (develop 과 같음, 미커밋 없음)
span_kst: "11-03 → 11-09"
ended_by: user-close (사용자가 세션을 닫음)
status: 확인-대기
resume_local: "claude --resume ea9f15f0-9765-44ba-a865-7be4e7c8be45"
related_prs: [1639, 1682, 1821, 1860, 1868, 1927, 1991, 2018, 2052, 2053]
tickets: []
session_name: 도우미 날씨·현재 위치 세션(trippilot-fa) — "하던거 마저해" 로 이어 온 U8 O-U8-5·재계획 밤 일정
handed_to:
  - "trippilot-3b(도우미 세션) — 아래 1~4"
---
# 도우미 "오늘 날씨" = 지금 있는 곳 — 코드는 다 운영, 남은 것은 웹 실기 확인과 백로그 셋

## 목적
도우미에 "오늘 날씨"를 물으면 **지금 있는 곳** 날씨가 나오게 하는 일(U8 O-U8-5 현재 위치 싣기). 계기는 운영에서 세 번 연달아 나온 사용자 지적이다: 여행 없이 물으면 "먼저 여행을 만들어"(11-03) → 위치가 안 실려 그대로(11-04) → 수원에 있는데 일정의 청계천 날씨(11-06, 웹).

## 이 세션이 머지한 것
| PR | 내용 | 운영 |
|---|---|---|
| #1639 | 재계획 밤 늦게(21시~) 더 놀기 — 야경·나이트라이프 후보, 늦은 체류 단축 | 반영 |
| #1682 | 시트 시작 버튼 "오늘 날씨"(BE `QueryCards.weather`)에 하늘·기온·강수 행 | 반영 |
| #1860 · #1868 | 현재 위치 싣기 — 앱이 동의 켜짐일 때 `deviceLocation` 을 보내고, BE 가 동의 재확인·법정 로그 `USE`(목적 `ASSISTANT_TURN`) 뒤 AI 로 넘긴다 | 반영(폰은 새 스토어 빌드부터) |
| #1927 | 여행·위치 없으면 "먼저 여행을 만들어" 대신 지역 되묻기 | 반영 |
| #1991 | AI 턴 로그 `dialogue_turn {...}` — 턴마다 의도·결과·여행/위치 **유무**(원문·좌표 없음) | 반영 |
| #2018 | 날씨 앵커 순서: 말한 지역 → **오늘이면 현재 위치** → 그날 일정 장소 → 여행 지역. 여행 날이 아닌 오늘 + 위치 없음이면 되묻기. "현재 위치·내 위치"는 지역 아님 | 반영 |
| #2052 | **웹**에서 날씨를 처음 물을 때 브라우저 위치 권한을 한 번 묻고 그 위치를 싣는다(FE 경량 사이클 `20261108-assistant-web-location-ask`) | 반영(11-08 17:04 KST) |
| #2053 | 정본: U8 BR-U8-22 개정 블록·audit·openapi 설명 | 문서 |

## 멈춘 지점 (11-09)
- 코드는 전부 운영에 있다. **웹 권한 창이 실제로 뜨는지는 아직 아무도 못 봤다**(로컬 백엔드가 `deviceLocation` 이전 이미지라 실기 스모크 실행불가). 사용자 확인 대기 — 「내가 할 일」 `todo-weather-location-check`.
- 위치 사용 법정 로그를 '제3자 제공'이 아니라 '이용'으로 남기는 판단은 추천안대로 정함(「내가 할 일」 `dec-assistant-location-use-log`).

## 다음에 이어서 할 일
1. **[3b] 사용자가 웹에서 "오늘 날씨"를 다시 물었다고 하면 그 턴을 찾는다** — 운영 AI 로그에서 `dialogue_turn` 줄의 `intent`·`outcome`·`clarify`·`trip`·`here` 를 본다(로컬 전용 — `gh workflow run aws-dev-logs.yml --ref develop -f source=cloudwatch -f since=6h -f namespace=trippilot -f component=ai -f 'pattern=dialogue_turn'`, 아티팩트 `ai.log`). `here: false` 면 앱이 위치를 못 보낸 것 — 웹이면 브라우저가 이 사이트 위치를 차단해 뒀는지, 폰이면 새 빌드인지부터 본다.
2. **[3b · 백로그] 시트 시작 버튼 "오늘 날씨"(여행 있을 때)는 AI 를 안 거친다** — BE `QueryCards.weather` 가 여행 첫 목적지 지역만 쓰고 현재 위치·되묻기가 없다. 말로 물으면 지금 있는 곳, 버튼을 누르면 여행지라 둘이 갈린다. 고친다면 버튼을 말 경로(AI)로 보내거나, 버튼 경로에도 `ContextSnapshot.here` 를 넘겨 같은 순서를 쓴다(BE 몫).
3. **[3b · 백로그] 여행 중 + 위치 없음이면 지금도 오늘 일정 장소로 답한다**(의도한 보수안 — 위치를 못 싣는 폰으로 여행하는 사람이 매번 질문받지 않게). 사용자가 "여행 중에도 물어라"고 하면 `ai/src/trippilot/orchestrator/dialogue/dialogue_handlers.py` `weather_needs_region` 의 여행 중 조건을 빼면 되는데, 대화 테스트 40여 건이 "여행 중 오늘 날씨 → 일정 장소"를 기본 쓰임으로 전제한다(같이 고칠 것).
4. **[3b · 백로그] 계획 경로(DIALOGUE_PLAN 도구)는 지역 되묻기를 안 한다** — `Handler.ask` 는 분류 경로 전용이다. 계획 경로로 온 날씨 질문은 앵커 순서만 바뀐다.

## 함정 / 주의
- **웹 브라우저 권한은 거부해도 `canAskAgain: true`**(expo-location 웹 구현) — 물을지는 상태(`undetermined`)로만 가른다(`readDevicePosition({ask:true})`). 폰은 권한 창을 띄우지 않는다(O-U8-5 그대로).
- **BE 요청 매퍼는 모르는 키를 400 으로 거절한다** — 앱 요청에 새 칸을 싣는 FE 는 BE 를 먼저 올린다. 웹은 main push 로 자동 배포된다.
- **턴 로그 전에는 의도를 표본 섀도로만 남겨** 대부분 `sampled_out` 이었다 — 지금은 `dialogue_turn` 을 본다.
- 사용자 결정: "결정이 필요한 것은 웬만하면 추천안대로 진행"(10-30) — 웹 위치 묻기·법정 로그 분류가 이 지시로 정해졌다. 재제안하지 말 것.
- FE 하네스: `useTurnFlow` 에서 보내는 부분을 훅 본문 함수로 빼면 `react-hooks/purity` 가 기존 `Date.now()` 줄에 걸렸다(지역 클로저로 해소, 원인 미확정). `eslint --stdin` 은 억제 파일이 안 붙어 결과가 다르다(repo-traps).
- scribe 메모: `frontend/.claude/rules/repo-traps.md` 전역 항목이 17건으로 상한 12 초과 — 정리 후보 5건과 "대기 중 언마운트 함정 전역 승격" 후보가 사이클 폴더 `_workspace/20261108-assistant-web-location-ask/OBSIDIAN_MISSING.md` 에 있다(로컬 전용).
