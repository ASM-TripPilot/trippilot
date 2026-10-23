---
paths:
  - "src/features/reflection/**"
---
# `src/features/reflection/` — j03 오늘의 회고 · j04 여행 요약 · j05 여행 스타일 · j06 공유 카드 (model·글리프)

화면 계약은 backend openapi `Reflection`(`ai/docs/openapi.json`의 `/ai/v1/reflection/generate`와는 무관). load-bearing 계약은 두 축 — **"어떤 응답이 와도 빈 화면을 안 그린다"(폴백 3단, PBT-U5-F1)** 와 **"표시본 결정을 한 곳에서만 한다"(AC-8)**. 판정은 순수 함수 단일 출처, 화면은 무상태 프레젠테이션.

**화면 뷰는 여기 없다** — j03·j04·j05·j06 Screen과 그 전용 부품(+`styleThreshold`)은 TRIP-1153으로 각 page 슬라이스(`pages/{daily-reflection,trip-summary,share-card,travel-style}`)로 이사했다(`layer-pages.md`). 여기 남은 것은 page와 Screen이 함께 쓰거나 두 page 이상이 쓰는 model, page 하나만 쓰지만 Screen 전용이 아니라 이번에 옮기지 않은 model(`useDailyReflection`·`useStyleAnalysis`·`reflectionFallback`·`statsCard`·`editCard` — TRIP-1155 재평가 몫), 그리고 `ReflectionGlyphs`다. TRIP-1155로 그 5개(+`missingParts`)는 `pages/record/daily-reflection`·`pages/record/travel-style`로, 캡처 어댑터(`shareCapture`·`shareCaptureNative`)는 `features/share-trip-card`로 이사했다.

**경계**: 다른 `features/*`(특히 `record`)를 import할 수 없다 — eslint 층 zone이 막는다.

## j03 오늘의 회고

| 파일 | 역할 |
|---|---|
| `ui/ReflectionGlyphs.tsx` | 공용 SVG(뒤로·위치없음·사진없음·빈원·다시시도·기분 3종) — j03·j04·j05·j06 Screen이 각자 다른 page로 흩어져 여기 남았다 |

## j04 여행 요약

`TripSummaryStats`는 j03 `ReflectionStats`와 shape가 달라 `statsCard.ts`를 개조하지 않고 별 함수로 둔다.

| 파일 | 역할 |
|---|---|
| `model/summaryView.ts` | `shareEnabled(envelope)=envelope.ready===true` · `resolveSummaryView(stats)=hasLocationData?'MAP':'VISIT_LIST'` · `toOrderedVisitList`(일자 넘어 전역 1..N 평탄화, 순서 보존) · `distanceSourceLabel`(`ROUTE→'경로'`/그 외→`'근사'`) · `daySubtitle`(≥2→`첫→마지막`, 테마 문구 발명 금지 BR-U5-31) |
| `model/summaryView.test.ts` | 진리표 + `toOrderedVisitList` PBT(순서 보존·번호 연속) |
| `model/formatKm.ts` | `formatKm(km) → 'X.Ykm'` (TRIP-1086) — 서버 double 거리를 0.1 반올림·끝 `.0` 생략(`1.929…→'1.9km'`, `12→'12km'`). 거리 문자열은 **이 함수 하나**로 만든다(소비처: `ReflectionStatsRow`·`summaryStats`·`reflectionFallback` ③). ★ `toFixed(1)`은 0.15를 '0.1'로 내려 쓰지 않는다. **'—'(측정 못 함) 판정은 호출부 몫이고 `formatKm`은 모른다** — 그런데 `reflectionFallback` ③ `basicNarrative`에는 그 판정이 없어 방문 1곳 이하에도 `이동 0km`을 쓴다(타일은 `—`, 이번 diff 전부터의 동작·후속 티켓 후보). 50m 미만(방문 2곳 이상)은 `'0km'`. 미터 입력·m 단위의 `entities/place` `formatDistance`와는 별개다(입력 단위·`.0` 처리가 달라 재사용 안 함) |
| `model/formatKm.test.ts` | 경계 예제(0.15·0.35·0.95·1.15) + PBT(형식·오차≤0.05·단조·동점 half-up) — `toFixed(1)` 뮤테이션에 red |
| `model/summaryStats.ts` | `summaryStats(stats?)` — 방문·사진 `?? 0`, 거리는 `!hasLocationData`면 `'—'`(0km 아님), 아니면 `formatKm` |
| `model/summaryStats.test.ts` | 0채움·거리 대시·완전 입력 |
| `model/useTripSummary.ts` | `useGetTripsTripIdSummary` 얇은 래퍼(새 HTTP 0), envelope 그대로 |

## 기록 하단 바 칸 이동 (j01·j03·j04 공용 — TRIP-1584)

세 page 가 같은 25줄을 풀어 쓰지 않으려고 여기 모았다(소비처 3 page · 도메인 판단 · 안 모으면 3곳 복제 — 추출 규칙 세 조건). 바 자체(그림·모션)는 `widgets/bottom-nav-bar`(`layer-widgets.md`).

| 파일 | 역할 |
|---|---|
| `model/recordBarNav.ts` | 순수. `RecordBarNav`(`onBack`·`onPressRecords`·`onPressReflection?`·`onPressSummary?` 콜백 묶음 타입 — 바에 그대로 펼쳐 넣는다; 없는 칸 콜백 = 그 칸은 안 눌림) + `pickReflectionDate(여행 일차 날짜 오름차순, 오늘)` — 오늘이 기간 안이면 오늘 · 끝난 여행이면 마지막 일차 · 시작 전이거나 일정이 아직 없으면(빈 배열) `undefined`(칸 비활성). ISO 날짜는 사전순 = 시간순이라 문자열로 비교한다(⚠️ jest 에서 `toBeLessThanOrEqual` 은 숫자 전용 — 문자열은 `(a <= b)` + `toBe(true)`). `index.view` 로도 나간다(프리뷰·순수 Screen 이 타입만 필요 — 훅까지 끌면 프리뷰 지뢰 목이 터진다) |
| `model/recordBarNav.test.ts` | 경계 행(미래 일차 불가·끝난 여행 마지막 일차·시작 전·일정 없음) |
| `model/useRecordBarNav.ts` | `useRecordBarNav({tripId, recordsDay?, reflectionDate?}) → RecordBarNav`. **이동 규칙**: 앞으로 가는 칸은 `router.push`(화면이 한 장씩 쌓여 모프가 다시 안 돎), 가려는 화면이 **이미 스택에 있으면** `dismissTo`(위를 걷어내고 파라미터 교체) — 🧪 `dismissTo` 는 스택에 **없으면 push 가 아니라 맨 위 화면을 바꿔치기**하므로 일괄 dismissTo 면 입장 모프가 다시 돈다(2026-10-22 `renderRouter` 실측). "있나"는 **누르는 순간** `useStackRoutes().getRoutes()` 로 읽는다(렌더 때 굳히면 낡은 스택). 세 이동 모두 `guardPress`(400ms 모듈 전역 연타 창). 요약 칸은 `useTripSummary` 의 `ready:true` 일 때만(BR-U5-48 — 조회 중·실패·`ready:false` 는 꺼짐, 실패를 "준비됨"으로 접지 않는다 INV-4). 회고 칸은 `reflectionDate` 가 있을 때만. `recordsDay` 가 있으면 기록 칸이 `?day=` 로 싣고 간다(j03 → j01 에서 보던 날짜 유지). 뒤로(`onBack`, TRIP-1600 이 TRIP-1591 "어디서든 기록 탭"을 절충안으로 개정): 스택 맨 위 **기록 3종 묶음 바로 아래** 화면(`recordBlockBelow`)이 **탭 `(tabs)` 이거나 없으면** 기록 탭 `router.dismissTo(shellTabHref('records'))`(TRIP-1591 유지 — 스택에 `(tabs)` 가 없는 딥링크·푸시 직행도 이 한 호출이 `['(tabs)']` 로 만들어 폴백이 필요 없다, `renderRouter` 실측), **탭이 아닌 화면**(알림함·도우미·허브)이면 그 화면으로 `router.dismiss(묶음 장 수)`. 이유: j03·j04 스와이프 뒤로를 끄면(`SplashGate` `NO_SWIPE_ROUTES`) 도우미·알림함이 `push` 로 연 회고·요약에서 돌아갈 길이 바 뒤로뿐이 되기 때문이다(근거: TRIP-1600 구현 결정 — 요구사항 아님). 묶음 장 수가 2 가 되는 경우(도우미→j03→j04)는 `dismiss(count)` 가 아니면 red. `RecordBarNav.exitToTab`(렌더 때 같은 판정 `backLeavesToNonTab` 로 계산)은 `RecordNavBar` 에 넘어가 **도착지가 탭이 아니면 5칸 탭 바로 접히는 역순 모프를 생략**하고 곧장 이동한다 — j03·j04 는 `{...recordBar}` 펼침으로 자동 전달, j01 은 `TripRecordsPage` `backExitToTab` → `TripRecordsView` `exitToTab`. 도착지가 탭이면 역순 모프는 `exitTab="records"` 로 재생한다. ⚠️ 도우미(`transparentModal`) 위에서 돌아왔을 때 시트가 그대로 보이는지·`exitToTab` 배선이 모프 유무까지 맞는지는 jest 사각(진짜 라우터 테스트는 도우미를 기본 Stack 으로 세우고 동작 줄이기가 켜져 모프를 안 본다) — 6-b 전용. ⚠️ **features 가 `expo-router` 의 `router` 를 직접 부르는 첫 사례**다(지금까지는 href 문자열만 만들고 호출은 pages 가 했다) — 싫으면 세 page 에 풀어 쓰는 쪽으로 되돌릴 수 있다(테스트 영향 작음). 이 파일은 `index.ts` 로만 나간다(`index.view` 아님 — 네트워크 훅이라 프리뷰가 값으로 로드하면 안 된다) |

## j06 공유 카드

카드는 지도·경로 핀·사진을 그리지 않는다 — 계약에 좌표가 없다. 워터마크·동선 목록·그라디언트 오버레이로만 조립한다. 캡처(PNG)·앨범 저장·OS 공유·해시태그 인라인 편집은 TRIP-1071로 실구현(네이티브 3종 — `traps-reflection.md`, 재빌드 전엔 버튼 줄 자체가 안 뜬다).

| 파일 | 역할 |
|---|---|
| `model/shareCard.ts` | `SHARE_FORMATS`(story·square·feed) · `buildShareCard({summary,trip,format})` 카드 VM(j04 모델 재사용, `totalPhotos===0`→`'no-photo'`, duration 필드 0) · `validateCaption`/`validateHashtags`(온디바이스만, 해시태그 인라인 편집이 재사용) · `periodText`는 시작·종료 **둘 다** 있을 때만 조합([[반쪽 방어 (half-applied guard)]]). 옛 `captureShareImage()` degrade 스텁은 제거됨(→ `model/shareCapture.ts`) |
| `model/shareCard.test.ts` | 조립·mode·aspect·폼검증·INV-3(`JSON.stringify` 소요시간 0)·INV-4·null 방어 |

## j05 여행 스타일 분석

**계정 단위**(`/me/style`, tripId 없음, INV-U5-08). 승격 권위는 서버 `official` 플래그뿐 — `progress.current`는 표시용이고 승격 판정에 관여시키지 않는다(PBT-U5-F4, CI 차단). 판정(`resolveStyleFace`)은 `entities/style-analysis/lib/styleFace.ts`(`layer-entities.md`). 표시 라벨 `categoryLabel`은 TRIP-1153으로 `pages/record/travel-style/model/styleThreshold.ts`로 이사(`layer-pages.md`).

| 파일 | 역할 |
|---|---|

## 관련

- 개념: [[회고 폴백 3단 (방어층 — 서버가 표시본 결정)]] · [[옵셔널 체이닝은 매 단계 필요]] · [[degrade 스텁 — 못 켜는 기능은 정직하게 꺼둔다]] · [[가드의 사정거리 (opt-in 등재는 넓히되 기존 사각은 그대로다)]] · [[소스 스캔 가드의 폴더 전수와 자동 편입]] · [[반쪽 방어 (half-applied guard)]] · [[페이지 조립은 jest 무심판]] · [[마운트당 1회 발사 가드 (firedRef)]] · [[invalidateQueries (쿼리 무효화)]]
