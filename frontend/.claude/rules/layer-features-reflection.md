---
paths:
  - "src/features/reflection/**"
---
# `src/features/reflection/` — j03 오늘의 회고 · j04 여행 요약 · j05 여행 스타일 · j06 공유 카드 (model·글리프·매거진 연출 부품)

화면 계약은 backend openapi `Reflection`(`ai/docs/openapi.json`의 `/ai/v1/reflection/generate`와는 무관). load-bearing 계약은 두 축 — **"어떤 응답이 와도 빈 화면을 안 그린다"(폴백 3단, PBT-U5-F1)** 와 **"표시본 결정을 한 곳에서만 한다"(AC-8)**. 판정은 순수 함수 단일 출처, 화면은 무상태 프레젠테이션.

**화면 뷰(Screen)는 여기 없다** — j03·j04·j05·j06 Screen과 그 전용 부품(+`styleThreshold`)은 TRIP-1153으로 각 page 슬라이스(`pages/{daily-reflection,trip-summary,share-card,travel-style}`)로 이사했다(`layer-pages.md`). 여기 남은 것은 page와 Screen이 함께 쓰거나 두 page 이상이 쓰는 model, page 하나만 쓰지만 Screen 전용이 아니라 이번에 옮기지 않은 model(`useDailyReflection`·`useStyleAnalysis`·`reflectionFallback`·`statsCard`·`editCard` — TRIP-1155 재평가 몫), 그리고 `ReflectionGlyphs`다. TRIP-1155로 그 5개(+`missingParts`)는 `pages/record/daily-reflection`·`pages/record/travel-style`로, 캡처 어댑터(`shareCapture`·`shareCaptureNative`)는 `features/share-trip-card`로 이사했다.

**예외 — 매거진 연출 부품(TRIP-1665)**: `ui/ReflectionMagazine`·`ui/MagazineParts`·`ui/MagazineMotion`은 j03 전용 Screen이 아니라 j04·j06 이 재사용하는 무상태 부품이라 여기 둔다(`index.view`로 나가 프리뷰도 네트워크 없이 읽는다). **j04(TRIP-1666)는 `ReflectionMagazine` 이 아니라 부품(`MagazineCover|Quote|Stats|Route`)을 골라 조립한다**(**j06 스토리 덱(TRIP-1667)도 같은 부품 `MagazineRoute`·`MagazineStats` 와 `CATEGORY_PALETTES`·`buildSummaryMagazineVM` 을 재사용한다** — 장 배경·글자색을 또 짜지 않는다). `index.view` 공개 목록은 TRIP-1667 에서 `buildSummaryMagazineVM`·`SummaryMagazineInput`·`SummaryMagazineVM`·`SummaryDayCardVM` 이 더 늘었고, TRIP-1666 에서 부품 4개·`CATEGORY_PALETTES`·`MAGAZINE_TONES`·`dominantPaletteKey`·`splitHighlight`·하위 타입들이 늘었다(전부 `@/shared/api` 값 import 없음 — 프리뷰 지뢰 안 건드린다). ⚠️ `index.ts`가 `index.view`를 `export *` 하므로 **`@/features/reflection`을 import하는 모든 화면**(j01·j04·j05·j06·프리뷰)이 쓰든 안 쓰든 매거진 모듈(reanimated 포함)을 함께 로드한다 — 번들 크기 영향은 미측정(03c R2, CI `bundle-report` 몫).

**경계**: 다른 `features/*`(특히 `record`)를 import할 수 없다 — eslint 층 zone이 막는다.

## j03 오늘의 회고

| 파일 | 역할 |
|---|---|
| `ui/ReflectionGlyphs.tsx` | 공용 SVG(뒤로·위치없음·사진없음·빈원·다시시도·기분 3종) — j03·j04·j05·j06 Screen이 각자 다른 page로 흩어져 여기 남았다 |
| `model/categoryPalette.ts` | (TRIP-1665) 카드 팔레트 표. `CATEGORY_PALETTES`(11키 = 한글 카테고리 8 + `PLAN_B`·`SKIPPED`·`STATS`, 값 `bg`·`fg`·`accent`) · `paletteKeyForCategory`(한글 10종 + 영문 코드 8종 → 키, 미술→문화·술집→야경, 모르는 값·null·`'toString'`·사건 키는 중립 `STATS` — `Map` 조회라 프로토타입 이름에 안전) · `MAGAZINE_TONES`(종이·잉크·형광펜·사진 위 글자 — 카테고리 무관 고정색). 글자색은 바탕과 대비 ≥ 4.5 로 골랐다(액티비티 `#1E90FF` 위 흰 글자는 3.24 라 `#0A1A2E`, 테스트가 계산). **VM 은 hex 가 아니라 `PaletteKey` 만 들고 다니고 뷰가 이 표에서 색을 찾는다.** `dominantPaletteKey(categories)`(TRIP-1666) = 최빈 팔레트 키 한 함수 — j03 표지(방문 동선)·j04 표지·j04 일차 카드가 같이 쓴다(j03 `magazineVM` 인라인 루프를 그대로 옮긴 것). 미술+문화·술집+야경은 한 통으로 세고 모르는 값·null·`STATS`·사건 키는 안 센다, **동률은 먼저 나온 키**(`Map` 삽입 순서 + 엄격한 `>` — `>=` 로 바뀌면 단위 테스트 5건이 red), 하나도 못 세면 `'STATS'`. ⚠️ 영문 코드 8종 표는 `src/features/itinerary/model/draftView.ts` 의 비공개 표와 같은 값의 복제다(형제 feature 라 import 불가) — 카테고리 코드가 늘면 둘 다 고친다(기계 강제 없음) |
| `model/reflectionPayload.ts` | (TRIP-1665, `pages/record/daily-reflection/model/reflectionScenes.ts` 에서 `git mv` 후 확장) `parseReflectionPayload(payload) → {cover, hashtags, scenes}` — 깨진 JSON·null·타입 오류에도 던지지 않고 빈 결과(PBT). 해시태그는 trim·앞 `#` 전부 제거·중복 제거, 장면은 `sourceEvent`(PLAN_B·SKIPPED)를 읽는다. TEXT·모르는 layout 은 버리지 않고 `sceneKind`(`PHOTO`·`STATS`·`MAP`·`EVENT`·`TEXT`·`UNKNOWN`)만 붙인다(INV-4). `devicePhotoUri` = 그날·그 장소의 이 기기 사진(표지·장면 공통 규칙). 서버는 `payload` 를 `cover` 밖에선 해석하지 않는 불투명 JSON 문자열로 취급하므로 장면 파싱은 클라 몫이다. ⚠️ `slotUri` 는 매거진 이후 프로덕션 소비처가 0 인 고아 export 다(옛 단언이 아직 부른다 — 03b N3, 지우려면 그 단언을 `devicePhotoUri` 로 옮겨야 한다) |
| `model/magazineVM.ts` | (TRIP-1665) `buildMagazineVM(input) → MagazineVM` 순수 함수 — 매거진의 규칙(동선·표지 색·장면 분류·사진 선택·숫자 타일)이 전부 여기 산다. 서버 API 는 `import type` 만(값으로 물면 프리뷰 지뢰 `devPreviewReleaseGate` red). 동선: 건너뜀 제외·도착 시각순·이름은 슬롯→즉석→`N번째 장소`(지어내지 않음, BR-U5-31), `slots===undefined` 는 "아직 모름"이라 `route=null`(동선 박스만 안 그림). 표지 색: PLAN_B 띠 → 방문 카테고리 최빈(동률은 먼저 간 곳) → 중립. 장면: TEXT 는 카드에서 빼고, EVENT+PLAN_B/SKIPPED 는 띠, 나머지(모르는 layout 포함)는 번호 카드(`01`.., 사진 좌우 번갈아). `splitHighlight`(마지막 쉼표 뒤 구가 형광펜). **표지 사진은 기기 사진 uri 가 있을 때만 객체, 없으면 `cover.picture === null` = 카테고리 색이 선다**(D1, TRIP-1666 — 직전 사이클의 "표지 사진 자리가 있으면 기기 사진이 없어도 카테고리 그림이 깔린다" 서술은 폐기). **장면 카드는 사진이 없어도 카테고리 그림 그대로**(AC-2 가 지킨다 — `pictureOf` 자체를 null 로 바꾸면 red). 색 칠함 여부는 jest 가 못 봐서(README 판정 4) 실기 스모크(`reflection-magazine-no-photo`)가 확인했다. 하위 타입 4개 이름이 붙고 공개된다(`MagazineCoverVM`·`MagazineQuoteVM`·`MagazineStatTile`·`MagazineRouteStop`) — 부품이 받는 `cover` 는 `dateLabel?` 가 선택(j04 는 기간을 모를 수 있다)이고 j03 VM 은 `& { dateLabel: string }` 으로 좁다. ⚠️ 일정이 늦게 오면 표지·장면 카드가 중립색·이름 없음으로 먼저 그려졌다가 도착 후 카테고리 색으로 바뀐다 — 의도이고 VM 테스트가 굳혔지만 화면에서 전이는 6-b 미확인 |
| `model/summaryMagazineVM.ts` | (TRIP-1666 신규, **TRIP-1667 로 `pages/record/trip-summary/model` 에서 이사** — j04·j06 스토리 덱 공용) `buildSummaryMagazineVM({summary, trip?, itineraryDays?, routeSources?}) → SummaryMagazineVM` 순수 함수 — 화면이 계산 없이 그릴 값. 제목은 여행 제목, 비면 `이번 여행`(`tripTitleKnown=false`, 그때만 `reflection-summary-trip-title` 을 안 단다). 표지 색 = 전 일차 방문 카테고리 최빈(`dominantPaletteKey`), **일차 카드 색 = 그 날짜 일정 슬롯 중 이름이 방문지와 완전히 같은 것**의 최빈 — 다른 날짜의 같은 이름·부분 일치·이름 없는 슬롯은 안 센다; 일정을 모르거나(`undefined`) 못 맞추면 중립 `STATS`. **거리 줄은 서버 `distanceKm` 가 있고 방문 ≥ 2 일 때만**(측정 못 함을 `0km` 로 쓰지 않는다) — 출처는 `h.distanceSource ?? routeSources?.byDate[date] ?? 'VISIT_LINE'`(서버 우선)인데 숫자 타일은 `routeSources?.overall ?? summary.stats.distanceSource`(파생 우선)라 위치 자동화 ON 일 때 한 화면에서 `근사`/`경로` 가 갈릴 수 있다(03b N2, 제품 판단). `routePalette` = 표지 색. 소요시간 필드 없음(INV-3). `@/shared/api` 는 **타입만**(값 import 0 — 프리뷰 지뢰 안전). `index.view` 로 `buildSummaryMagazineVM`·`SummaryMagazineInput`·`SummaryDayCardVM`·`SummaryMagazineVM` 을 내보낸다(소비처 j04 `TripSummaryPage`·`TripSummaryScreen`·`DayHighlightCard`, j06 `ShareCardPage`, 프리뷰). 같은 슬라이스 안 import 는 상대 경로(자기 배럴 순환 금지) |
| `ui/ReflectionMagazine.tsx` | (TRIP-1665) 조립 — props `vm`·`testIDPrefix`(필수, j04·j06 이 재사용해도 testID 가 안 섞인다)·`onEditNarrative?`(있을 때만 인용문 옆 `수정`). 표지는 바로 그리고, 인용문 → 장면 → 띠 → 동선 → 숫자 → 해시태그를 `RevealItem` 순번(150ms 간격, 첫 300ms)으로 등장시킨다(동선 박스는 가만히 있고 정류장이 한 곳씩). ⚠️ 풀폭 종이색 바탕이라 `-mx-lg` 로 **부모의 좌우 `px-lg` 패딩을 되받는다** — 패딩 없는 부모에 얹으면 화면 밖으로 삐져나간다. ⚠️ 뷰가 VM 의 `route`·`scenes` 순서를 뒤집어도 통합이 green 이다(03b W1 — 순서는 VM 단위가 지키고 화면 순서는 6-b 육안 몫) |
| `ui/MagazineParts.tsx` | (TRIP-1665) 표지·인용문·장면 카드·일정 변경 띠·동선·숫자 타일·해시태그 — 조회·계산 0 인 무상태 뷰. 색은 VM 키 → `CATEGORY_PALETTES` → `style`(동적 hex 는 className 이 못 받는다), 숫자는 `shared/ui/CountUpText`. 표지 스티커는 두 줄 `<Text>`(`오늘의`/`회고`)다 — 한 줄이면 헤더 `하루 회고` 와 글자가 겹쳐 `getByText('하루 회고')` 가 깨진다. 규칙 카드(TEXT 장면)는 장면 카드 없이 동선 박스만 그린다. **j03·j04 가 함께 쓰는 부품이다(TRIP-1666)** — ① `MagazineQuote`·`MagazineRoute` 는 **`heading` 이 필수 prop**이다(j03 은 `ReflectionMagazine` 이 `오늘을 한 줄로`·`오늘의 동선`, j04 는 `이번 여행`·`여행 동선`을 넘긴다). 값이 틀리거나 지워져도 tsc 는 못 잡고, 통합이 j03 두 줄을 단언한다(5-b 보강). ② **`MagazineQuote` 는 루트가 Fragment 다** — 본문 View(`testID`)가 부모 `RevealItem` 의 직접 자식 호스트가 되어야 모션 테스트(`revealValues` 가 가장 가까운 호스트 조상을 래퍼로 읽는다)가 래퍼를 읽는다; 바깥 `View` 를 다시 씌우면 NaN 으로 red. 그래서 바깥 패딩은 머리말 줄·본문에 나눠 얹었고, j03 인용문 간격이 옛과 같은지는 계산상만이라 실화면 확인 대상이다. ③ `MagazineRoute` 의 `firstDelayMs` 기본 300 은 **j03 의 암묵값**이다(j04 는 1050 을 명시) — 기본값을 지우거나 바꾸는 변이를 잡는 테스트가 없다. `stopTestID?` 를 주면 모든 정류장이 그 testID 하나를 쓰고(j04), 정류장 `dayLabel?` 은 이름 오른쪽에 별도 Text 로 선다. ④ `MagazineCover` 는 `dateLabel?` 가 있을 때만 기간 칩을 그리고 `titleTestID?` 를 제목 글자만 담은 Text 에 단다(지역·기간과 한 노드로 섞이면 완전 일치 단언이 깨진다). ⑤ 사진 없는 표지는 색 바탕인데 지역·기간 칩은 `bg-scrim/40` 위 흰 글자 그대로다 — 노랑 같은 밝은 바탕에서도 실기에서 읽혔으나(`trip-summary-bright`) 기간 칩은 프리뷰 키 바에 가려 판독 못 했다 |
| `ui/MagazineMotion.tsx` | (TRIP-1665) `KenBurns`(1.02→1.14, 10초)·`StickerPop`·`Highlight`(900ms 타이머로 중첩 `<Text>` 배경색을 켬, 페이드 없음). 셋 다 `useReduceMotion()` 3상태 — true=끝 모습 정지, null=답 오기 전 시작 전(번쩍임 방지), false=마운트 시 1회. worklet(`useAnimatedStyle` 콜백) 안에서 모듈 상수·기본 매개변수를 쓰지 않는다(UI 스레드 사망). ⚠️ 재생·3상태·"끝 모습"(켄번스 1.14 배 정지 = 사진이 약간 크롭)은 jest 사각이다 — 통합은 동작 줄이기 `true` 만 본다(03b N1), `docs/feature-map/reflection.md` `rf-magazine-motion` + 실기 몫 |

## j04 여행 요약

`TripSummaryStats`는 j03 `ReflectionStats`와 shape가 달라 `statsCard.ts`를 개조하지 않고 별 함수로 둔다.

| 파일 | 역할 |
|---|---|
| `model/summaryView.ts` | `shareEnabled(envelope)=envelope.ready===true` · `resolveSummaryView(stats)=hasLocationData?'MAP':'VISIT_LIST'` · `toOrderedVisitList`(일자 넘어 전역 1..N 평탄화, 순서 보존) · `distanceSourceLabel`(`ROUTE→'경로'`/그 외→`'근사'`) · `daySubtitle`(≥2→`첫→마지막`, 테마 문구 발명 금지 BR-U5-31 — ⚠️ TRIP-1666 이후 **프로덕션 소비처 0 인 고아 export** 다: `index.view` 재수출과 `summaryView.test.ts` 만 읽는다, 지우려면 그 테스트 한 줄과 재수출을 같이 고친다) |
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
