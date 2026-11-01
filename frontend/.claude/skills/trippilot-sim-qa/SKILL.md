---
name: trippilot-sim-qa
description: TripPilot 앱을 iOS 시뮬레이터 실화면으로 QA하는 루프 — 기능 지도(`frontend/docs/feature-map/`)를 커버리지 정본으로 삼아 agent-device(접근성 트리·한글 입력)로 진입 경로·세부 기능을 전부 밟고, 연타(더블탭) 스택 중복을 검사하고, 발견을 리포트로 남기고 지도를 갱신한다. "시뮬레이터로 QA 돌려", "실화면 QA", "설정 QA해", "기능 지도 돌려", "죽을 때까지 QA", "더블탭 확인해", "재QA", "티켓 고친 거 실기로 확인", "웹 버전 QA", "웹에서도 되는지 확인", "기능 지도 정비", "지도 점검", "머지 뒤 지도 확인" 요청 시 사용(웹은 Aside 브라우저로, 정비는 「정비 패스」 절). 프리뷰(_dev/preview)가 아니라 실제 화면·백엔드로 도는 QA다.
---

# TripPilot 실화면 QA 루프

첫 실행(발견 67건 → TRIP-976 서브 15칸)에서 굳힌 절차다. 원본 리포트·증거: `frontend/_workspace/qa-dogfood/20260925/` (report.md가 리포트 서식의 실물).

## 기능 지도 (커버리지 정본)

**무엇을 누를지는 `frontend/docs/feature-map/`이 정한다.** 기능 하나 = 파일 하나(세부 기능 · 사용자 진입 경로 · 조작법 · 함정), 목록은 `README.md`. 지도는 사용자 관점이다 — 소스 경로·함수 이름은 없고 testID·라벨·문구·딥링크만 있다. 내부가 궁금하면 그때 코드를 본다.

- **시작 전:** 요청 화면이 속한 기능 파일을 README 목록에서 찾아 **통째로** 읽는다. `Gotchas`부터 본다 — 조작을 헛돌게 하거나 데이터를 망치는 함정이 거기 있다.
- **진입 경로는 전부 밟는다.** 한 경로로 들어가 통과했다고 다른 경로까지 "검증됨"이라 하지 않는다. 막힌 경로는 막힌 이유와 함께 적는다.
- **통과시키려고 시나리오를 약하게 고치지 않는다.** 전제(계정 상태·데이터)가 없으면 도달 불가로 보고하고 그 이유를 `Gotchas`에 적는다.
- **화면이 지도와 다르면 먼저 가른다** — 앱 결함인가(리포트에 한 줄), 지도가 틀렸나(그 자리에서 지도를 고친다 = drift).
- **끝나면:** 판정표(세부 기능별 pass / drift 고침 / 결함 / 도달 불가)를 남기고, 그 파일의 `status`(`live-verified` / `live-unreachable`)·`live_verified_at: <날짜> (<커밋>)`을 갱신한 뒤 `node docs/feature-map/check.mjs`가 OK인지 본다.
- 라우트를 새로 보면(지도에 없는 화면) `check.mjs`가 잡는다 — 그 화면을 맞는 기능 파일 `routes`에 넣고 세부 기능을 적는다.
- **기능 전용 함정은 그 기능 파일 `Gotchas`에, 도구·시뮬 공통 함정은 이 SKILL.md §2에** 적는다.

## 0. 준비 (매 세션)

```bash
.claude/skills/trippilot-sim-qa/scripts/preflight.sh "$PWD"   # frontend/ 에서
```

- **preflight가 `FAIL`로 끝나면 시작하지 않는다** — Metro가 꺼졌거나·다른 폴더를 서빙하거나·`CI=1`로 떴거나·뜬 뒤 라우트 파일이 생겼으면 실패한다(낡은 번들로 코드 결함을 오판한 실측 8건 — 상세는 하네스 변경이력). **Metro cwd가 이번 QA 대상 워크트리인지 확인.** 아니면 `lsof -ti :8081 -sTCP:LISTEN | xargs kill` 후 그 워크트리에서 `LANG=en_US.UTF-8 pnpm start`(백그라운드). `pkill`로는 옛 Metro가 안 죽는다(repo-traps).
- **다른 세션이 같은 워크트리를 편집 중이면 시작하지 않는다** — 저장마다 리로드돼 가짜 버그가 섞인다(첫 실행에서 실측). `git status`로 세션 시작 이후 바뀐 파일이 있는지 본다.
- 앱 세션: `xcrun simctl terminate booted com.trippilot.travel; xcrun simctl launch booted com.trippilot.travel` → 12초 대기 → `agent-device open com.trippilot.travel --platform ios --udid <UDID>` (첫 open은 XCTest 러너 빌드로 느림). 외부 재시작 직후엔 `snapshot -i`를 한 번 먼저 찍는다(첫 settle 기준 트리가 낡을 수 있음).
- 출력 폴더: `frontend/_workspace/qa-dogfood/<YYYYMMDD>/` 에 `report.md`·`screenshots/`. 스크립트는 `OUT=<그 폴더>`로 부른다.
- **preflight는 시작에만 돌리는 게 아니다** — 크래시·Render Error·조작 무반응·예상 밖 화면처럼 이상한 일이 한 번 생기면 **다음 조작 전에 다시 돌린다**. 프로세스는 살아 있는데 화면 상태가 꼬인 경우(preflight가 못 보는 것)는 앱 재기동으로 알려진 상태부터 다시 시작한다. 이상한 일 뒤에 그대로 이어 누르면 그다음 판정이 전부 오염된다.
- **증거는 정리 뒤에도 남아야 한다** — 띄운 것(Metro·드라이버 서버·임시 파일)은 끝날 때 내가 띄운 것만 끄고, 스크린샷·리포트는 출력 폴더에 남았는지 `ls`로 확인한 뒤 끝낸다.

## 1. 도구 분담

| 할 일 | 도구 |
|---|---|
| 화면 읽기·탭·입력(한글 포함)·스크롤 | `agent-device` — `snapshot -i`, `press <sel>`, `fill <sel> "텍스트"`, `scroll down 0.8`, `--settle`로 변경 diff |
| 눈으로 볼 것(레이아웃·색·겹침), 지도 화면 | 내장 `mcp__Claude_Code_iOS_Simulator__control` screenshot/tap/swipe/touch2_path |
| 요약 스냅샷 | `scripts/s.sh [줄수]` |
| 연타 스택 검사 | `OUT=… scripts/dt.sh '<selector>' <이름>` |
| 서버 쪽 사실 | `docker logs --since 3m trippilot-backend` / `trippilot-ai`, `docker exec trippilot-db psql -U postgres -d trippilot` (스키마 `app`) — **읽기만** |

내장 시뮬 MCP의 `text`는 쓰지 않는다(클립보드 고장 — 한글 인코딩 에러, 영문도 필드에 안 들어감).

## 2. 셀렉터·조작 함정 (전부 실측)

- **testID는 `id="…"`로 누른다.** `label="<testID>"`는 에러 없이 무시된다.
- **testID와 접근성 라벨이 둘 다 있는 요소는 트리에 라벨만 보인다** → `role=button label="…"`(설정 행은 `role=cell`)로 잡는다. 토글 켜짐·칩 선택은 `snapshot -i`에 없다 — `snapshot --json`의 `value`·`selected`로 본다.
- 같은 라벨이 여럿이면 `role=button label="…"`. 참조(`@e12`)는 다음 변경 뒤 무효 — 스크립트에선 셀렉터를 쓴다.
- **탭바는 좌표로**(홈 72·탐색 137·일정 201·기록 265·마이 329, y=835). 화면 루트 [other]가 "홈"·"1일차" 라벨을 가져 `label="홈"`이 화면 중앙을 누른다.
- **`agent-device back`(기본)은 루트 홈에서 검색바를 누른다.** `back --system`·`swipe`는 엣지 스와이프가 아니다. 뒤로는 화면의 `*-back` id를 누르거나 내장 MCP `swipe x=2→300`.
- **`find`는 찾기만 하지 않고 탭한다.**
- 지도 화면(여행 중 라이브·편집기·장소 추가)은 접근성 캡처가 워치독 타임아웃 → 스크린샷+좌표. 스크린샷 좌표는 402×874 포인트(`scale` 줘도 좌표계는 그대로). 러너가 "still finishing" 에러면 10~15초 쉬고 재시도.
- 키보드가 떠 있으면 첫 탭은 키보드만 닫는다. `keyboard dismiss`는 안 되니 '검색'/'Return 키' 버튼을 누른다.
- 스크린샷 직후 즉시 press는 씹힐 수 있다 — 1초 쉼.
- **지도+시트 화면(MapSheetShell) 위 중첩 시트는 다음 터치 전까지 안 그려질 수 있다**(실측 3곳, 상세는 하네스 변경이력) — 누른 뒤 무반응이면 `snapshot -i`에 "Bottom Sheet"/시트 testID가 있는지 먼저 보고, 빈 곳을 한 번 더 눌러 확인한 뒤 "무반응"으로 판정한다.
- 시트가 전체 높이로 올라가 뒤로 버튼을 가려도 `press @e<뒤로 ref>`(좌상단 34,88)는 통한다. 핸들을 끌어내려도 안 내려갈 수 있다.
- **시트를 올리고 내리는 것은 `swipe`가 아니라 `gesture pan`으로 핸들을 천천히** — `swipe`는 시트 아래 지도만 끈다(예 최상단으로 `gesture pan 201 521 0 -440 800`, 시트 안 목록 `gesture pan 201 700 0 -400 500`). 전면 스크림(딤)은 `id=`로 누르면 가운데(=시트 위)를 누르므로 **좌표로** 누른다(예 y≈120). 시트 안 화면 밖 버튼은 `scroll down 0.3` 뒤 ref로.
- **OS 공유 시트는 바깥 빈 곳을 탭해 닫지 마라** — 그 탭이 아래 화면 행까지 눌린다(설정에서 로그아웃 다이얼로그가 열린 실측 1건, 상세는 하네스 변경이력). 시트 안 닫기 버튼이나 아래로 끌기로 닫는다.
- 딥링크 정본 경로: 회고 `trips/<id>/records/reflection/<date>`, 공유 `trips/<id>/records/share` (`records/…` 단독은 "페이지를 찾을 수 없어요").
- **딥링크 스킴은 `com.trippilot.travel://`** — `trippilot://`는 네이버 로그인 SDK가 같은 스킴을 가로채 화면이 안 바뀐다(실측, 결함 의심 FM-L1-04). `xcrun simctl openurl booted "com.trippilot.travel://<경로>"`.
- 딥링크로 연 화면은 스택에 계속 쌓인다 — 루트 딥링크로는 초기화가 안 되니 화면별 뒤로·엣지 스와이프로 하나씩 닫는다.
- **앱을 끈 상태에서 딥링크로 연 화면(콜드 진입)은 뒤로가 무반응일 수 있다**(여러 화면 실측, 결함 의심 FM-L1-02 계열) — 갇히면 앱 재기동으로 빠져나온다. 이걸 그 화면만의 결함으로 새로 적지 말고 기존 ID에 붙인다.
- 탭바 좌표(y=835)는 탭바가 숨는 스택 화면(저장한 숙소 등)에선 그 자리의 하단 CTA를 누른다 — 탭 이동 전에 탭바가 보이는지 확인.
- **산출물을 `frontend/_workspace/` 안에 쓰면 Metro 「Refreshing...」가 뜰 수 있다**(실측 1회·원인 추정, 상세는 하네스 변경이력) — 화면 갱신 지연·상태 초기화 같은 가짜 증상이 섞인다. 스크린샷·리포트는 frontend 밖(scratchpad)에 쓰고 끝에 옮긴다.
- 연타 스크립트(`dt.sh`)의 둘째 탭이 새 화면의 같은 좌표를 누를 수 있다(연타 관통) — 「DUP?/?」가 나오면 새 화면에서 시트가 저절로 열렸는지부터 본다.
- **내장 시뮬 MCP `tap`이 어느 순간부터 씹힐 수 있다**(실측 — LogBox 경고 배너가 뜬 뒤 탭바·지도 화면 버튼 무반응). 같은 좌표를 `agent-device press <x> <y>`로 누르면 통한다. 지도 화면(허브·편집기)의 버튼은 처음부터 agent-device 좌표 탭을 쓴다.
- 허브(i01) 메모 입력칸은 이제 `[text-view]`로 잡힌다 — `fill @ref`. j01 인라인 메모는 `fill 'id="…"'`도 된다. 키보드가 떠 있어도 `완료`·`저장` 첫 탭은 먹는다.
- 시뮬레이터 위치: `xcrun simctl location booted set 37.5663,126.9779`, 권한: `xcrun simctl privacy booted grant location com.trippilot.travel`.
- **`xcrun simctl openurl` 딥링크가 앱에 닿는데 화면이 안 바뀔 수 있다**(실측 — 프리뷰·`_dev/fault`·`trips/…` 전부, 앱 로그엔 `UIOpenURLAction` 수신) → `node scripts/nav.mjs '<경로>'` 로 JS 런타임에서 `router.push` 한다(`--back`, `--eval '<식>'`). 같은 길로 `__r.getModules()` 를 뒤져 모듈을 직접 부를 수 있다 — 오프라인 흉내(`@tanstack/query-core` `onlineManager.setOnline(false)`)·토스트 띄우기(`shared/ui/Toast` `showToast`). 개발 빌드·Metro 8081 에서만 된다.
- **8081을 도커 `trippilot-collect-backend`가 쥐고 있을 수 있다**(실측 — preflight의 "Metro cwd"가 Docker 경로로 찍힘). 컨테이너는 끄지 말고 `pnpm start --port 8082` 후 `xcrun simctl openurl booted "com.trippilot.travel://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"`로 붙인다. 이 상태에선 딥링크가 화면을 안 바꿨다 — 딥링크 화면은 UI로 들어가거나 미확인으로 적는다.
- **agent-device 세션은 cwd에 묶인다** — 다른 폴더에서 `open`하면 DEVICE_IN_USE. 기기 세션을 연 폴더(`trippilot/frontend`)에서 실행하면 기존 세션을 그대로 쓴다 — 다른 워크트리를 QA할 때도 명령은 그 폴더에서 친다.
- **`xcrun simctl privacy booted reset location`은 앱을 죽인다** — 위치 권한을 초기화하면 dev-client URL로 다시 띄운다.
- **같은 폴더에서도 DEVICE_IN_USE가 날 수 있다**(다른 cwd 세션이 기기를 쥔 채 남음, `session list`엔 안 보임). 에러에 찍힌 이름으로 `agent-device close --session <이름>` 하면 풀린다.
- **Metro 포트를 바꿨던 시뮬은 앱 기본값이 남는다** — 다른 포트로 띄우면 앱이 옛 포트를 찾는다. `xcrun simctl spawn <UDID> defaults read com.trippilot.travel RCT_jsLocation`으로 보고 `defaults write … RCT_jsLocation localhost:8081`(앱 종료 상태에서). 부팅된 시뮬이 여러 대면 `booted` 대신 UDID를 쓴다.
- **푸시 탭 라우팅은 `xcrun simctl push <UDID> com.trippilot.travel <파일>`로 볼 수 있다** — 데이터는 Expo 형식으로 `"body": {"actionType":"REFLECTION_DAILY","tripId":…,"dayDate":…}` 안에 넣어야 한다(최상위 키에 두면 탭해도 이동 없음). 배너는 1초 안에 사라지므로 push 직후 바로 `agent-device press 150 90`(상단)으로 누른다.
- **자동 도착(U10) 재생 좌표는 로컬 DB에서 가져오면 안 된다** — dev-api의 POI id·좌표가 로컬 `app.poi`와 달라(같은 이름 다른 id) 반경 밖이 된다. 좌표는 `frontend/docs/u10-location-sim.md` 절차대로 그 서버 데이터 기준으로 잡는다.
- **사진 선택기를 연 직후 시뮬레이터가 멈출 수 있다**(실측 1회, 상세는 하네스 변경이력) → `killall -9 com.apple.CoreSimulator.CoreSimulatorService` → 기기 Shutdown → `xcrun simctl boot <UDID>` → 앱 launch → `agent-device open … --udid`. 재부팅 직후 「Apple 계정 확인」은 「지금 안 함」. 로그인·데이터는 유지된다. 사진 추가는 꼭 필요할 때만 한다.
- **이 Mac엔 `timeout` 명령이 없다** — 오래 걸릴 수 있는 스크린샷·녹화는 백그라운드로 돌리고 15초 뒤 끊는다. 순간 깜빡임(첫 조회 빈 얼굴 등)은 `xcrun simctl io booted recordVideo` + `ffmpeg` 프레임으로 본다.
- 공유 이미지 결과물은 시뮬 앨범(`data/Media/DCIM/100APPLE`) 최신 파일을 직접 열어 확인한다.
- **실패·로딩 얼굴은 네트워크를 끊지 말고 실패 주입으로 연다(개발 빌드 전용)** — `xcrun simctl openurl booted "com.trippilot.travel://_dev/fault?path=/trips/*/itinerary&status=500"`(`&delay=5000` 로딩 · `&code=GENERATION_IN_PROGRESS` 에러 코드 · `*`=경로 한 칸 `**`=여러 칸, `/api/v1` 은 붙여도 빼도 된다). GET 에만 걸리고 앱을 재시작해도 남으며, 켜져 있으면 오른쪽 위에 「실패 주입 켜짐 · N」이 뜬다. 확인 화면에서 [돌아가기] → 대상 화면을 다시 연다(이미 받은 캐시는 안 바뀐다). 끝나면 반드시 `…://_dev/fault?clear=1` — 표시가 사라졌는지 본다.

## 3. 루프 (한 바퀴 = 기능 파일 하나)

1. 상태 점검: `s.sh 5` — Render Error·Bundling·흰 화면이면 그것부터 기록하고 앱 재시작.
2. 그 기능 파일의 `Driving it with agent-device`를 따라 세부 기능을 하나씩 실행한다. **동작마다 `--settle` diff 또는 스냅샷으로 판정**, 레이아웃은 스크린샷을 실제로 연다.
3. 진입 버튼마다 `dt.sh`로 연타 검사. `DUP?`면 뒤로 버튼을 반복해 스택 깊이를 세어 확정(대부분 오탐이었다). `NO-NAV`면 시트인지 무반응인지 스크린샷으로 가른다.
4. 기대가 애매하면 정본(inception stories · construction business-rules)과 대조. 판정 못 하면 "판단 필요".
5. 발견은 **그 자리에서** report.md 표에 한 줄: `ID | 심각도(critical/high/medium/low) | 분류 | 화면 | 증상(재현·기대/실제) | 판정(확정/판단 필요)` + 증거 스크린샷 파일명. 영문 파일명만 쓴다(한글 파일명은 디스크에서 깨진다).
6. 서버 에러는 로그·DB로 원인까지 한 줄 붙인다. **원인 추정은 "추정"이라 적는다** — 첫 실행에서 서버 로그 시각을 안 맞춰 원인을 잘못 짚었다(065: 로그가 생성 시작보다 앞섰음).
7. 지도가 틀렸으면 그 기능 파일을 고치고, 바퀴가 끝나면 위 「기능 지도」 끝 절차(판정표·`status`·`check.mjs`)를 한다.

## 4. 시나리오 범위

**범위는 기능 지도 README 목록이다** — 전 시나리오 QA = 목록의 기능 파일 전부. 한 바퀴 크기는 기능 묶음(README의 그룹) 하나가 알맞다. 여행 중·Plan-B 기능은 시작일이 오늘인 여행을 만들어서 돈다. [도착]은 시각이 아니라 날짜로 켜진다 — 보는 일차가 오늘이면 활성이다.

## 5. 하지 않는 것

- 코드 수정 · 지라 생성(끝나고 사용자가 고르면 `jira-fe-subtask` 스킬로)
- 파괴적/비가역 동작: 로그아웃(재로그인 불가), 계정 삭제 확정, 동의 철회, 위치·개인화 동의 토글 반복(법적 append-only 로그 — 켤 필요가 있으면 사용자에게 먼저 알린다), 외부 결제, 「이 안내를 다시 보지 않기」 체크
- 테스트로 만든 데이터(여행·저장·등록·방문 기록·건너뜀)는 리포트 끝 "바뀐 것"에 적는다 — 건너뛴 방문은 되돌릴 수 없으니 버릴 여행에서만 한다

## 6. 종료·보고

- 멈춤 조건: 같은 지점 3회 연속 크래시, Metro/백엔드 복구 불가, 사용자 중지. 한 바퀴 다 돌면 요약을 쓰고 경계 상태 위주로 2회차.
- report.md 맨 위에: 심각도 집계 · **기능별 판정표(세부 기능 수 / pass / drift / 결함 / 도달 불가)** · 연타 결과 한 줄. 끝에: 도달 불가(막힌 전제) · 바뀐 데이터.
- **빈 칸은 통과가 아니다.** 범위에 넣은 기능 파일마다 판정표 행이 있어야 한다 — 못 돈 기능은 `미실행 — {사유}`로 적는다. 도달 불가는 **막힌 전제(계정 상태·권한·외부 상태)와 시도한 경로**가 있을 때만 도달 불가다.
- **결함 줄마다 근거 꼬리표**: `측정함`(화면·로그로 봤다) / `추론함`(코드만 보고 판단) / `추측`. 코드 대조로만 나온 의심은 실화면 결함과 같은 표에 섞지 말고 따로 둔다.
- **여러 갈래로 나눠 돌았으면** 갈래마다 같은 형식으로 보고받는다 — `PASS / ISSUES / BLOCKED` + 증거, 그리고 **어느 빌드(웹 `last-modified`·앱 커밋)를 어떤 방법으로 봤는지**. 그 둘이 없는 갈래 결과는 버리고 그 갈래를 한 번 다시 돌린다. 두 번째도 없으면 빈 칸으로 남긴다. 갈래마다 쓰는 자리(래퍼 스크립트·증거 폴더·드라이버 포트)는 **갈래 고유 이름**으로 나눈다 — 공유 자리를 덮어써 남의 결과를 무효로 만든 실측 1건.

- `SendUserFile`로 리포트 전달. 지도를 고쳤으면 그 diff도 함께 알린다.

## 웹 버전 QA (Aside)

웹(`https://app.trippilot.co.kr`, 모바일 뷰)도 같은 기능 지도로 돈다 — 지도의 기대 동작은 앱 기준이고, 웹은 **앱과 같은가**를 판정한다. 도구는 시뮬레이터 대신 **Aside 브라우저 디버깅 창 + `scripts/web.mjs`**(agent-device의 웹 짝)다.

- **창 띄우기(없을 때만):** `open -n -a Aside --args --remote-debugging-port=9333 --user-data-dir=<프로필 폴더> --no-first-run --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling`. **절전 옵션 4개는 필수다** — 없으면 가려진 창의 탭이 `visibilityState=hidden`이 되어 애니메이션 프레임이 0회로 멈추고, 바텀시트·휠·지도가 안 움직여 앱 결함처럼 보인다(실측). 시작할 때 `eval`로 `document.visibilityState`가 `visible`인지 본다. 로그인은 사람이 그 창에서 한다(소셜 팝업) — 로그인이 필요하면 사용자에게 말한다. 프로필 폴더에 세션이 남으므로 끝나면 정리 여부를 묻는다.
- **포트 9333에 Chrome도 붙어 있을 수 있다** — Aside는 IPv6(`[::1]:9333`), Chrome은 IPv4(`127.0.0.1`)로 갈렸다. `web.mjs`는 기본값이 `[::1]`이다. `localhost`로 부르면 엉뚱한 브라우저에 붙을 수 있다.
- **드라이버:** `node scripts/web.mjs serve [url]`을 백그라운드로 띄우면 새 창을 열고 모바일 뷰(412×915 안드로이드 크롬, 터치)를 건다. 탭·에뮬레이션은 서버가 살아 있는 동안만 유지된다. 병렬 갈래는 `PORT=94xx`로 서버를 하나씩 띄운다 — 서버마다 **새 창**을 연다(같은 창의 뒤쪽 탭은 렌더가 멈춰 터치·스크린샷이 걸린다, 실측). 같은 프로필이라 로그인은 공유된다. **명령마다 `PORT`를 붙인다** — 빠뜨리면 남의 탭을 조작해 두 갈래 결과가 다 무효가 된다(실측 1건).
- **조작:** `tree`(testID=`data-testid`·라벨·문구·좌표) → `press <testID|"text:문구"|x,y>` · `fill` · `swipe`(시트·지도) · `nav /경로` · `back`/`reload` · `geo <lat> <lng>` · `shot` · `console`(JS 예외·HTTP 4xx/5xx — 기능마다 본다).
- **입력은 페이지 안 합성 이벤트다** — CDP `Input.dispatch*`(진짜 터치·휠·키)는 가려지거나 뒤에 깔린 창에서 렌더 프레임을 기다리며 무기한 멈추고, 멈춘 입력이 나중에 실행될 수 있다(실측 — 로그아웃 행 터치가 2분 걸려 있었다). `web.mjs`는 그래서 포인터/키 이벤트를 JS로 쏜다. 위험 행(로그아웃·계정 삭제)은 웹에서 아예 누르지 않는다. 스크래치패드에 래퍼를 만들면 **갈래 고유 이름**으로 — 공용 이름 래퍼를 덮어써 남의 탭을 조작한 실측 1건.
- **합성 이벤트의 한계:** gorhom 시트 끌기·휠 피커 끌기는 합성 swipe로 안 움직일 수 있다(실측) — 그 판정은 도구 한계로 적고 실기기 크롬으로 넘긴다. 합성 press는 진짜 blur를 안 일으킨다(저장이 blur에 걸린 입력은 `eval`로 `document.activeElement.blur()`). `eval`은 전역이라 IIFE로 감싼다. `geo`는 드라이버를 재시작하면 풀린다.
- **딥링크 = URL 경로:** `com.trippilot.travel://<경로>` → `https://app.trippilot.co.kr/<경로>`(괄호 그룹 세그먼트는 빠진다).
- **실패·로딩 얼굴은 `fail`·`delay`로 연다** — 네트워크를 끊으면 조작 세션도 끊기므로 요청을 CDP로 가로챈다. `fail <경로glob> <status|net> [본문JSON]`(본문 기본 = 백엔드 `ErrorResponse` 봉투, 코드는 상태에 맞춰 `INTERNAL`·`RESOURCE_NOT_FOUND` 등) · `delay <경로glob> <ms>` · `fail-list`(맞은 횟수) · `fail-clear`. glob은 pathname만(`*`=한 마디, `**`=여러 마디, 예 `fail '/api/v1/trips/*/itinerary' 500` → `reload` → `hub-error`). **GET만 가로챈다**(쓰기 요청은 그대로 서버로). 규칙은 드라이버 메모리에만 있어 서버를 끄면 사라지지만, 켜 둔 채 다음 기능으로 넘어가면 그 판정이 오염되니 끝나면 `fail-clear`.
- 조회 화면은 재시도(첫 실패 뒤 3회)가 끝나야 실패 얼굴이 뜬다 — `fail` 뒤 10초쯤 기다리고 `fail-list`의 맞은 횟수로 요청이 실제로 걸렸는지 본다. 401은 토큰 갱신·로그아웃 흐름을 탈 수 있어(미실측) 쓰지 않는다.
- **판정 칸:** `same` / `web-diff` / `web-broken` / `web-n/a`(푸시·Apple 로그인·앨범처럼 웹에 없는 게 당연 — 대체 안내가 있는지도 본다) / `unreachable`.
- **웹에서 꼭 볼 것:** 브라우저 뒤로·새로고침 후 상태, URL 직접 진입, 지도 타일·핀, 바텀시트 끌기·시트 안 스크롤, 외부 링크(새 창/같은 창), 공유·다운로드·파일 선택, `console` 예외.
- 배포 웹과 시뮬레이터 앱은 **빌드 시점이 다를 수 있다** — 웹 번들의 `last-modified`와 앱 커밋을 리포트 머리에 적고, 차이가 버전 탓인지 가른다. 계정이 다르면 데이터 차이는 결함으로 치지 않는다.
- `useNativeDriver` 콘솔 경고는 웹의 정상 소음이다.

## 정비 패스 (지도가 앱을 따라가게)

지도는 앱이 바뀌는 순간부터 썩는다. 이 패스는 **기능 지도와 이 스킬이 거짓말을 안 하게** 맞추는 주기 점검이다(출처: pstack `maintain-verification-skill`). 단위는 문장이 아니라 기능이다 — 모든 기능 파일을 소스로 한 번, 실화면으로 한 번 덮는다.

**고치는 범위:** `frontend/docs/feature-map/`과 이 스킬 폴더(SKILL.md·`scripts/`)만. **제품 코드는 손대지 않는다** — 지도가 적은 동작을 앱이 안 하면 지도가 틀린 것(drift — 지도를 고친다)이거나 앱이 깨진 것(결함 — 보고만 한다, 지도에 덮어 쓰지 않는다)이다.

**언제·얼마나:**
- **변경분 모드(기본)** — develop에 배치가 머지된 뒤. 각 기능 파일의 `live_verified_at` 커밋 이후 `git log --name-only <그 커밋>..HEAD -- src app`이 그 기능의 화면을 건드린 파일만 대상이다. 어느 기능인지는 그 파일 `routes`와 testID로 가른다.
- **전체 모드** — 사용자가 요청할 때. README 목록 전부.

**절차:**
1. **색인 정리** — README와 형제 파일을 대조해 빠진·남는·중복·죽은 항목을 고친다. `node docs/feature-map/check.mjs`.
2. **소스 웨이브** — 대상 기능을 README 그룹 단위로 묶어(기능마다 하나씩 띄우지 않는다) 그룹마다 읽기 전용 `Agent(Explore)`를 한 메시지에서 병렬로 띄운다. 각자 돌려줄 것: 기능 요약 / 소스 진입점 / 지도와 다를 것 같은 곳(`파일:줄` 근거) 또는 없음 / 실화면 확인 레시피 1개. **에이전트는 앱을 조작하지 않고 파일을 고치지 않는다.**
3. **대조** — 모든 대상 기능에 요약이 돌아왔는지 본다(빈 칸이면 그 그룹을 다시 띄운다). 레시피를 앱 상태(계정·여행 상태)별로 묶어 상태 전환을 줄인다. 지목된 drift는 표본 확인하고, 깨끗하다는 주장은 다시 증명하지 않는다. 최근 변경에 지도에 없는 화면이 있으면 — 실제 라우트·testID를 짚을 수 있을 때만 — 누락으로 친다.
4. **실화면 패스 (소스가 깨끗해 보여도 필수)** — 조작은 이 세션 하나가 직렬로 한다(시뮬레이터 1대·Metro 8081 하나라 병렬 불가). 대상 기능을 전부 최소 한 번 밟는다. 패스 내내 지킨다: 이상한 일 뒤 preflight 재실행(§0) · 증거는 정리 뒤에도 남는다 · 실패한 시도의 흔적(띄운 서버·임시 데이터)은 그 자리에서 치운다. 웹도 대상이면 「웹 버전 QA」 절로 같은 기능을 한 번 더.
5. **분류** — 설명이 틀림·빠짐 → **drift**, 지도를 고친다. 앱은 되는데 도구로 못 누름 → **도구 구멍**, `scripts/`나 §2를 고치고 그 기능을 다시 밟아 확인한다. 앱이 실제로 깨짐 → **결함**, 리포트에만 적는다.
6. **결과는 셋 중 하나** — `clean`(전부 덮었고 고칠 것 없음 — 커밋 없음) / `changed`(증명된 정정만 PR 하나 — 커밋 전에 바뀐 파일을 전부 다시 읽는다) / `blocked`(무엇에 막혔는지 정확히). 덮은 기능 수·도달 불가 전제·확인된 drift·결함을 그대로 보고한다.

실행 메모(덮은 기능·막힌 전제·drift·결과)는 스크래치에 두고 커밋하지 않는다.

*유지 판정: 3회 관찰 — 변경분 모드가 drift·도구 구멍을 1건도 못 고쳤고 그 사이 다른 QA에서 지도 drift가 나왔으면 대상 고르는 방법(`routes`·testID 매칭)이 새는 것이니 고친다. 3회 연속 `clean`이고 다른 QA에서도 drift가 0이면 주기를 늘린다(머지마다 → 주 1회).*

## 재QA (티켓 고친 뒤 확인)

티켓 본문의 "재현" 절을 그대로 따라 돌고, 원 리포트 번호 옆에 `재QA <날짜>: 해소/잔존`을 적는다. **그다음 고친 화면이 속한 기능 파일의 진입 경로를 전부 다시 밟는다** — 티켓이 짚은 경로만 보면 옆 경로가 깨진 채 남는다. 워크트리 여러 개면 **Metro 출처를 반드시 그 워크트리로 바꾼 뒤** 확인한다.
