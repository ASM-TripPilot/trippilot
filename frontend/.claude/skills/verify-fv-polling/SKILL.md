---
name: verify-fv-polling
description: "AI 일정 생성 POST 와 그 결과 폴링(생성 화면 h09 · 초안 h11 · 앱 셸 생성 감시)을 TLA+ 모델 체크 + 실제 코드 적합성 검사로 검증한다 — 늦은 GET 응답·POST/GET 실패·재시도·화면 이탈/복귀·웹 새로고침·연타가 아무 순서로 섞여도 '완료 전 결과 표시'·'진행 얼굴 고착'·'한 번 누른 생성의 중복 요청'이 없는지. GeneratingPage·DraftPage·draftView(폴링 상한)·useGenerationWatch·생성 진입 버튼(꼭 갈 곳 「다음」·거점 「다시 만들기」)을 바꿀 때, '생성 폴링 꼬일 수 있어?', '새로고침하면 생성 또 돼?', '만드는 중에서 안 넘어가', 'verify-fv-polling' 요청 시 사용하라."
---

# verify-fv-polling — AI 일정 생성·폴링 순서 형식 검증

테스트는 누가 떠올린 순서만 본다. 이 스킬은 **여행 하나의 생성 한 판에서 사용자 누름(시작·[다시 시도]·[다시 짜기]·연타)·POST 단계(서버 수신·1일차 저장·응답/실패)·일정 GET(시작·서버 읽기·늦은 도착·실패)·서버 2차(완성/실패/스위퍼)·화면 이탈/복귀·웹 새로고침의 모든 순서**를 TLC 로 다 돌리고(약 100만 상태), 그 모델의 화면 판정이 실제 코드와 같은지 실제 DraftPage·useGenerationWatch 에 조합 전수(72건)로 대조한다.

## 지키는 약속

| 속성(모델 이름) | 사용자 말 | 피해 | 근거 |
|---|---|---|---|
| P1 `ResultOnlyAfterComplete` | 생성 결과는 서버가 완료를 알린 뒤에만 보인다 — 조용해진 초안이 「완성된 일정」 얼굴이면 그것은 서버의 지금 일정이고 서버에서 도는 생성이 없다(TRIP-1690 정정 — 아래 「모델 정정」) | 다시 만들기를 눌렀는데 예전 일정이 완성본처럼 보이고 폴링도 멈춘다(서버는 새 일정을 만드는 중) | BR-U3-04(1일차 먼저·나머지 폴링) · INV-4(침묵 실패 금지) |
| P2 `NoStuckProgress` | 실패하면 생성 중 화면에 갇히지 않는다 — 요청·폴링이 다 멈췄는데 「만드는 중」(생성 화면 진행·초안 진행 카드·로딩)이 남지 않는다 | 폴링 상한(30회 ≒ 105초) 뒤엔 다시 묻지 않는데 진행 카드가 실패 안내 없이 남는다 — 서버가 실패로 닫아도 모른다 | INV-4 · 출시 게이트 ④(DraftPage C2 — 상한에서 멈춘다) · draftView `pollExhausted` 주석("이 항이 없으면 폴링만 조용히 멈춘다") |
| P3 `OnePostPerPress` | 한 번 누른 생성은 한 번만 요청된다 — 보낸 POST 수 ≤ 사용자가 누른 수(다시 그려지기 전 같은 버튼 연타는 한 번으로 센다) | 같은 여행 POST 는 서버가 이전 세션을 닫고 새로 시작해 **AI 하루 한도를 또 쓴다** | GenerationSessionService.start(같은 여행 재생성도 한도에 센다) · 웹 QA 2026-10-31(mode= 새로고침 재요청 의심) |

## 결과 기준선 (sync 커밋에서 측정)

| 검사 | 기준선 | 뜻 |
|---|---|---|
| 적합성(코드==모델) | 같음 | CODE MIRROR(`DraftFace`·`DraftPollDue`·`ShellPollDue`)가 실제 DraftPage 렌더·관찰자 `refetchInterval` 과 72조합(초안 24 — 세션 축 포함 · 셸 48)에서 같다 |
| 반례 재현 R1~R6 | 기대대로 | R1~R5 = 고쳐진 동작(FV-POLL-01~04, TRIP-1690) · R6 = 남은 웹 잔여(FV-POLL-05)의 지금 동작 |
| `TypeOK`·교착 없음 | 성립 | |
| `ResultOnlyAfterComplete` | 깨짐 | 남은 두 원인 — 둘 다 이 화면 코드 밖이다. ① FV-POLL-05(웹) 새로고침 전 보낸 POST 가 새 페이지의 첫 GET 뒤에 서버에 닿으면, 새 페이지는 그 생성을 모른다(R6 재현). ② FV-POLL-06(BE) 닫힌 세션의 1차가 `replaceForTrip` 로 새 완성본을 덮는다(`GenerateItineraryService.generate` — 세션 확인 없음) |
| `ResultOnlyAfterComplete(앱이면)` | 깨짐 | ② 만 남는다(반례 13단계: 1번째 POST 응답 유실 → [다시 시도] → 2번째 완성 → 1번째 1차가 늦게 저장) |
| `ResultOnlyAfterComplete(앱·서버세션확인)` | 성립 | 서버가 닫힌 세션의 1차를 버리면 앱에서 성립 — 프론트 고침(취소·무효화·세션 술어)으로 충분하다는 뜻 |
| `NoStuckProgress` | 성립 | FV-POLL-02 고침 — PARTIAL 셸이 상한·조회 오류를 실패 안내 + [다시 시도]로 말한다 · 세션이 도는 옛 행은 로딩 → 상한이면 옛 목록 + 안내 |
| `OnePostPerPress` | 성립 | FV-POLL-03·04 고침 — 연타 잠금(`inFlightRef`·`guardPress`) + 쏜 뒤 주소에서 `mode` 제거 |
| `OnePostPerPress(잠금없다면)` | 깨짐 | 원인 증명 — 잠금 상수를 빼면 2~3단계 반례가 돌아온다 |
| `OnePostPerPress(새로고침재요청이면)` | 깨짐 | 원인 증명 — 새로고침이 mode 로 다시 쏘면 반례가 돌아온다 |

깨짐은 **보고된 결함**이다. 모델이나 속성을 약하게 고쳐 통과시키지 마라. 제품 코드는 사용자가 요청할 때만 고친다. 결함을 고치면 「결과 읽기」 3 으로 기준선을 옮긴다.

### 모델 정정 (TRIP-1690 — 고친 뒤 나온 반례 중 거짓이었던 것)

- **실패를 본 요청이 뒤늦게 서버에 닿는 경로**를 뺐다(`PostErr` 가 아직 안 받은 요청을 `lost` 로) — HTTP 에서 클라이언트가 실패를 본 요청은 그 뒤 서버에 도착하지 않는다. 새로고침으로 **버린** 요청은 실패를 보지 않으므로 여전히 늦게 닿을 수 있다(그게 FV-POLL-05).
- **P1 식**을 "마지막으로 시작한 생성의 COMPLETE"에서 "서버의 지금 일정이고 도는 생성이 없다"로 바꿨다 — 옛 식은 서버 1차가 실패해(A3) 행이 예전 일정 그대로일 때 그 예전 일정을 보이는 것까지 깨짐으로 셌다. 서버가 가진 일정을 그대로 보이는 것은 이 속성이 막는 피해가 아니다(단, 그때 생성 화면을 떠나 있었으면 실패 안내가 없다 — 서버가 실패 세션을 일정 GET 에 싣지 않아 이 화면만으로는 못 고친다).

## 실행 — 명령 하나

```sh
frontend/.claude/skills/verify-fv-polling/scripts/run.sh [--frontend <node_modules 있는 frontend>] [--model <모델 폴더 사본>] [--skip-jest|--skip-tlc]
```

- 약 40초(jest 약 25초 + TLC 약 10초, `-workers auto`). 처음엔 mise 로 Temurin 25 · TLC 1.7.4 를 받는다(네트워크, `brew install mise`). `TLA2TOOLS`·`JAVA` 로 바꿔 쓸 수 있다.
- 기준선과 모두 같으면 exit 0. 끝 표의 「결과」와 「기준선」 칸을 본다. 「비고」의 반례 단계 수·상태 수는 멀티 워커라 실행마다 조금 다를 수 있다(판정에 안 쓴다).
- 검사 파일은 `checks/*.check.tsx` 다 — 리포 jest·tsc 가 `.claude/` 를 제외하므로 `.test` 이름을 쓰지 않는다. 스크립트가 리포 밖 임시 폴더에 `.integration.test.tsx` 로 복사해 통합 버킷(`jest.integration.config.js`, MSW)으로 돌리고 지운다(`FV_POLLING_KEEP=1` 이면 남긴다).
- 반례 경로와 상태도는 **`/statechart` 스킬**로 `model/MCGenPolling.tla`(view = `model/view.mjs`)를 돌려 읽는다. 깨진 규칙마다 가장 짧은 경로가 한국어 단계로 나온다. 상태가 많아(예산 500 초과) 상태도는 버그 경로만 그린다.

## 이 변경이 덮는 코드에 닿는가

아래 파일을 바꿨으면 이 스킬을 돌린다. 스크립트가 sync 커밋 대비 바뀐 파일을 `!! 동기화` 로 먼저 알린다.

| 파일 (frontend/ 기준) | 함수·식 | 모델 대응 |
|---|---|---|
| `src/pages/itinerary/itinerary-draft/ui/DraftPage.tsx` | `refetchInterval`(shouldKeepPollingDraft — 세션 id 포함·`pollBaseline`) · `regenerating` 로딩 덮기 · `resolveDraftView` 입력 · PARTIAL 갈래(`listed && isPartial` — `staleFailed` 면 안내 + `itinerary-draft-partial-retry`) · 완성 셸 `staleFailed` · `handleRetry`(`leavingRef`) | `DraftPollDue` · `DraftFace`(적합성) · `PressRegenerate`(잠금 있음, 읽어서) |
| `src/features/itinerary/model/draftView.ts` | `shouldKeepPollingDraft` · `DRAFT_POLL_MAX_COUNT` · `resolveDraftView` | `MaxPoll`(30 → 2 축소) · `DraftFace`(적합성) |
| `src/pages/itinerary/itinerary-generating/ui/GeneratingPage.tsx` | `firedRef` 마운트 1회 POST + `router.setParams({mode: undefined})` · `const [mode] = useState(modeParam)` · 훅 옵션 `onSuccess`(await cancelQueries → setQueryData) · `onError`(invalidateQueries) · `onSettled`(`inFlightRef` 풂) · 호출별 `onSuccess`(replace 초안) · `fire` 의 `inFlightRef` · `ObserveGeneration`(data 생기면 초안) | `PressStart` 의 `Fire` · `Reload`(`ReloadRefires = FALSE` → Obs) · `PostWritesCache`·`PostOk`(GET 취소) · `PostErr`(`stale`) · `PressRetry`/`EchoTap`(`RetryGuarded = TRUE`) · `Return`/`PostOk` 의 Obs→Draft (재현 R1·R1b·R3·R4·R6) |
| `src/pages/itinerary/itinerary-generating/ui/GeneratingScreen.tsx` | 실패 얼굴 [다시 시도] 버튼(잠금은 페이지 `fire` 가 쥔다) | `GenFace` · `RetryGuarded` |
| `src/app/model/useGenerationWatch.ts` · `generationWatch.ts` | `isInFlight` · 조회 오류면 멈춤 · `isGenerationScreenOf` 양보 | `ShellPollDue`(적합성) |
| `src/pages/itinerary/itinerary-mustvisit/ui/MustVisitListPage.tsx` · `src/pages/trip/trip-new-step2/ui/TripBasesPage.tsx` | `guardPress(goToGenerating)` · `regenerate = guardPress(...)` | `PressStart`·`EchoTap`(`EntryGuarded = TRUE`, 재현 R5 는 MustVisitListPage) |
| `app/trips/[tripId]/itinerary/generating.tsx` | `mode` 를 주소 파라미터로 받는다 | `Reload`(웹) |
| `src/app/entrypoint/AppProviders.tsx` · `src/shared/api/mutator.ts` | staleTime 30초·retry · 생성 POST timeout 0 | 가정(아래). GET 재시도는 `GetFail` 한 덩어리 |
| `../backend/.../itinerary-generation/application/{GenerateItineraryService,GenerationSessionService,SecondPhaseGenerator,StalePartialSweeper}.kt` | 서버 규칙 — 가정 A1~A5 · 1차 저장의 세션 확인 없음(`ServerChecksSession = FALSE`) | 가정. 바뀌면 `GenPolling.tla` ASSUMPTION 주석·상수와 재현 테스트의 가짜 서버를 함께 고친다 — 서버가 세션을 확인하게 되면 cfg 를 TRUE 로 |

## 동기화

- **sync 커밋: `e752601a317a104cbe43a40fcf5e3a66786d9887`** (TRIP-1690 결함 수정, 2026-11-02). 이 커밋에서 위 표의 코드와 모델이 같다는 것을 적합성·재현·읽기로 확인했다. 폴백 인터스티셜 가드(`!regenLoading`)는 모델 밖이다(폴백 축을 모델링하지 않는다 — `DraftPage.integration` C7 이 지킨다). 처음 sync 는 `f153fe245`(결함 발견 시점).
- sync 커밋은 **위 표의 코드를 새 커밋에서 다시 읽어 모델이 그 코드를 그대로 기술한다고 확인한 뒤에만** 앞으로 옮긴다(이 파일과 `scripts/run.sh` 의 `SYNC=` 두 곳). 스크립트가 exit 0 이라는 것만으로 옮기지 마라 — 적합성은 CODE MIRROR 구역만 기계로 보고, 요청·잠금·화면 이동 단계는 읽어서 맞춰야 한다.

## 결과 읽기 — 실제 버그인가, 모델 오류인가

1. **적합성 「다름」** → 앱 결함이 아니다. 코드가 모델과 달라졌다. 로그의 ✕ 조합(`{ st, err, capped }` 또는 `{ scr, st, run, err }`)과 Expected/Received 가 어느 식이 갈렸는지 알려 준다.
   - 의도한 변경이면 아래 「의도한 변경일 때」로 모델을 고친다. 의도하지 않았으면 그 diff 가 회귀다.
2. **TLC 결과가 기준선과 다름**(새로 깨짐) → `/statechart` 로 반례 경로를 읽고, **그 경로를 실제 코드에서 한 단계씩 재현한다** — `checks/repro.integration.check.tsx` 에 R 하나를 더해 `run.sh` 로 돌린다(가짜 서버 `serve()`·`HomeProbe`·`postReply` 패턴을 그대로 쓴다). 재현되면 결함, 안 되면 모델 오류를 먼저 의심한다 — 모델이 한 덩어리로 본 단계가 코드에선 둘인가(기준: `await`·렌더 사이에 사용자가 끼어들 수 있으면 둘), 화면 이동 조건을 빠뜨렸나(실측: 관찰 모드가 setQueryData 로도 초안에 간다는 것을 처음에 빠뜨려 거짓 반례가 났다), 가정이 서버와 다른가.
3. **기준선 「깨짐」이 「성립」으로** 바뀜 → 결함이 고쳐졌을 수 있다. 그 재현 R 도 실패(「어긋남」)해야 정합이다. 둘 다 확인되면 기준선(이 파일 표 + `run.sh` `BASELINE`)을 바꾸고, 그 R 은 "고쳐진 동작"을 단언하도록 뒤집는다.
4. **반례 재현 「어긋남」, 적합성 「같음」** → 결함이 고쳐졌거나(3), 화면 testID·요청 순서가 바뀌었다. 재현 로그의 ✕ 를 보고 가른다.

## 의도한 변경일 때 모델 고치기

1. `model/GenPolling.tla` 의 CODE MIRROR 구역 식을 새 코드에 글자 그대로 맞춘다(옆 주석의 파일·식 이름 유지). 같은 식을 `checks/conformance.check.tsx` 의 `modelDraftFace`·`modelDraftPollDue`·`modelShellPollDue` 에도 옮긴다.
2. 요청·잠금·이동이 바뀌었으면 해당 액션(`PressStart`·`PressRetry`·`EchoTap`·`PostOk`·`GetOk`·`Return`·`Reload` 등)이나 상수(`EntryGuarded`·`RetryGuarded`)를 고친다. **코드에서 한 덩어리가 아닌 것을 한 액션으로 합치지 마라.**
3. 먼저 모델 사본에서 시험하려면 `cp -R model <사본>` 뒤 `run.sh --model <사본>`.
4. `run.sh` 가 기준선과 같거나, 다르면 위 「결과 읽기」로 판정한다. 속성(INVARIANT)을 약하게 바꿔 맞추지 마라.
5. 코드를 다시 읽어 대조한 뒤 sync 커밋을 옮긴다.

⚠️ **FV-POLL-02 를 "오류면 폴링을 멈춘다"(`status === 'error'` → false)로만 고치면 더 나빠진다** — 증명에서 실측했다: 반례가 9단계에서 6단계(조회 한 번 실패로 고착)로 짧아진다. PARTIAL 갈래가 `staleFailed` 를 먼저 그려야 한다.

## 범위·가정 (통과가 뜻하는 것)

- **경계**: 여행 하나, 누름 ≤ 2, POST ≤ 2, JS 실행(새로고침) ≤ 2, 초안 폴링 상한 2(코드 30 의 축소 — 상한 도달 여부만 의미가 있다), 시작 서버 일정 ∈ {없음, 예전 COMPLETE}. 약 100만 상태 전수(TRIP-1690 고친 코드 기준 — 연타 잠금으로 줄었다).
- **가정(서버, 백엔드 코드에서 읽음)**: A0 클라이언트가 실패를 본 요청은 그 뒤 서버에 닿지 않는다(새로고침으로 버린 요청은 예외) · A1 POST 를 받으면 같은 여행의 이전 세션을 닫고 새로 연다(하루 한도에 센다) · A2 1차 동안 GET 은 옛 행 + 새 세션 id, 1차가 끝나면 행을 PARTIAL 로 갈아끼우고 201 · A3 1차 실패면 세션 실패·오류 응답 · A4 2차는 자기 세션이 돌 때만 COMPLETE·FAILED, 세션 없는 PARTIAL 은 스위퍼가 FAILED · A5 행이 없으면 404. 네트워크 실패는 어느 요청에나(서버가 이미 받았을 수도 있다).
- **가정(클라이언트)**: 일정 GET 은 쿼리 키 하나 — 한 번에 하나, 누가 묻든(초안 폴링·셸 감시·마운트·포커스 복귀·홈 카드) 아무 때나 하나 나갈 수 있다(`StartGet` — 포커스 복귀를 덮으려고 일부러 넓게 둔다). "조용함"(`Quiet`)은 응답 기다리는 요청·예약된 폴링·마운트 조회가 없는 상태다 — 사용자가 앱을 껐다 켜거나 화면을 옮기면 풀린다. 1일차에는 장소가 있다. 재조회의 react-query 재시도는 `GetFail` 한 덩어리다.
- **덮지 않는 것**: 1일차 0곳 PARTIAL(`generatingNow` 로딩 얼굴), 같이 짜기(CO_PLAN → 슬롯 채우기 `SlotFillPage` 폴링), 재계획 모드(`ReplanGeneration` — 세션 폴링·2분 상한), 다른 여행 생성 중 409 안내(`useGenerationBusy`)·429 한도 얼굴·여행 중 409 → 재계획 넘김, 셸 감시의 완료/실패 토스트 문구·홈 카드 얼굴(셸은 폴링 주체로만 모델링), 내 여행 목록 폴링(`MyTripsList`), 오프라인 일시정지(`onlineManager`), 다른 기기, 서버 쪽 규칙 자체(백엔드 Kotest 몫). 실기기에서 "다시 그려지기 전 두 번째 탭"이 실제로 닿는지와 웹 주소에 `mode=` 가 남는지는 jest 로 못 본다(실화면 QA 몫).

## 모델 파일

- `model/GenPolling.tla` — 명세(변수·CODE MIRROR·ASSUMPTION·액션·속성). `model/MCGenPolling.tla`·`.cfg` — 상수. `model/view.mjs` — `/statechart` 용 한국어 라벨.
- `checks/conformance.check.tsx` — 적합성(통합 버킷, 조합 전수 72건). 관찰자의 `refetchInterval(query)` 를 직접 불러 "폴링이 예약되나"를 본다 — 타이머를 기다리지 않는다. react-query 알림은 `setTimeout(0)` 뒤에 오므로 `settle()` 로 여러 틱 흘린다(한 틱만 기다리면 흔들린다 — 실측).
- `checks/repro.integration.check.tsx` — 반례 재현 R1~R6(MSW 가짜 서버 A1~A5). R1~R5 는 고친 동작, R6 은 남은 웹 잔여의 지금 동작을 단언한다. 폴링 상한 상수는 배럴(`@/features/itinerary`)에 없어 `@/features/itinerary/model/draftView` 에서 직접 가져온다(배럴로 가져오면 `undefined` 라 반복이 0번 돈다 — 실측).

## 증명 기록

**고친 뒤(TRIP-1690 fix)**: 제품 코드의 고친 조각 8개를 하나씩 `cp` 사본으로 되돌리자 대응 테스트가 모두 red(취소·무효화·`inFlightRef`·`setParams`·mode 굳히기·PARTIAL 안내·폴링 세션 술어·로딩 덮기), 원복 diff 0. 모델 쪽은 `잠금없다면`·`새로고침재요청이면` 변형이 늘 깨짐으로 원인을 증명한다.

**처음(TRIP-1690 lane)**: 
sync 커밋에서 ① `DraftPage.tsx` `refetchInterval` 앞에 `query.state.status !== 'error' &&` 를 넣자 → `!! 동기화` + 적합성 「다름」(`{ st: 'Partial', err: true, capped: false }` 기대 poll true / 실제 false), exit 1. 모델 사본 `DraftPollDue` 에 `/\ ~err` 를 맞추자 `NoStuckProgress` 반례가 6단계(조회 실패 한 번)로 짧아졌다. ② `GeneratingPage.tsx` 의 `if (firedRef.current) return;` 를 지우자 → 반례 재현 「어긋남」(R1·R1b·R3·R4 ✕ — 마운트 뒤 POST 가 여러 번), exit 1. 둘 다 `cp` 사본으로 원복 → 제품 파일 diff 없음, `run.sh` 기준선 그대로 exit 0.

*유지 판정: maintain-formal-verification-skill 결과로 판정한다 — 3회 연속 `in sync` 이고 그 사이 이 영역 결함 0 이면 실행 주기를 늘린다. 6개월 동안 결함을 1건도 못 내면 이 스킬을 뗀다(첫 실행 결함 4건 FV-POLL-01~04 모두 실제 코드 재현·고침 · 고친 뒤 실행에서 잔여 2건 FV-POLL-05·06 — 상세는 하네스 변경이력).*
