---
paths:
  - "src/features/explore/**"
  - "src/pages/saved-places/**"
  - "src/pages/place-*/**"
  - "src/pages/region-picker/**"
  - "src/app/(tabs)/explore.tsx"
  - "src/pages/explore-landing/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **`savedPlaces.integration.test.tsx`는 react-query 알림 경합 처방이 적용돼 있다** — `beforeAll`에 `notifyManager.setScheduler` 5ms 잠금 + `@/test-support/flushNotifications`로 `result.current`를 읽기 전 순서를 기다린다. 롤백 단언 앞 flush는 지워도 green으로 남는 무방비 지점이다(상세·이유는 `traps-record.md` 동일 항목). 새 낙관 업데이트 테스트를 이 파일에 더할 때 flush 없이 `act` 직후 읽으면 같은 flake가 재발한다.

## 지역 카탈로그 (explore/region)

- **`TripNewStep1Page`·`RegionPickerScreen`을 렌더하는 node-버킷 테스트는 `useRegions`를 목해야 크래시 안 남** → 두 화면 모두 `useRegions()`(react-query)를 물어 `QueryClientProvider` 없는 node 버킷에서 렌더하면 `No QueryClient set` throw. 이 화면들을 렌더하는 새 테스트 파일을 추가할 때마다 같은 목이 필요하다는 사실을 기계가 강제하지 않는다(형제 테스트 누락 실측 1건).
- **시/도→구/군 드릴다운의 레이아웃·'전체' 행 비주얼은 jest가 원리적으로 못 본다** → Figma에 이 상호작용 패턴 자체가 없어 픽셀 대조 대상이 없다. jest는 `explore-region-sido-{code}`·`explore-region-drilldown-back` 등 testID 존재/부재와 press→콜백 배선만 잠근다. 시/도 행이 실제로 눌러 들어가는지·'전체' 행이 구/군 카드와 시각적으로 구분되는지·문구 중복("인천광역시" 카드 vs "인천광역시 전체" 라벨)은 6-b 실기로만 확인된다.

## 탐색 랜딩 (explore/d01)

- **`ExploreLandingScreen`을 렌더하는 node-버킷 테스트는 `useGetPlaces`도 목해야 크래시 안 남** → `ExploreLandingPage`(`pages/explore-landing`)가 가볼 곳 레인용으로 `useGetPlaces()`(react-query)를 문다. `QueryClientProvider` 없는 node 버킷에서 이 page(또는 그것을 꽂은 라우트 래퍼)를 렌더하는 새 테스트 파일은 지역 카탈로그의 `useRegions` 함정(위 절)과 동형으로 이 목이 필요하다는 걸 기계가 강제하지 않는다.

## 하트 글리프 정본

- **하트 저장 글리프(Outline·Filled) 정본은 `shared/ui/HeartGlyphs.tsx`다** — place·stay 검색 카드가 공유한다. 옛 경로(`entities/place/ui/PlaceGlyphs`·`features/explore/ui/ExploreGlyphs`의 동명 함수)는 삭제됐다. 새 하트 소비처가 feature 로컬 글리프에 하트를 다시 그리면 조용히 두 벌로 되돌아간다(`traps-glyphs.md`의 `LocationOffGlyph` 세 벌과 동형, 실측 2건) — raw-hex·fill 스캔은 `*Glyphs.tsx` 제외 관례라 기계가 못 잡는다.

## 지역 피커 → 결과 화면 복귀 (`dismissTo`)

- **`router.dismissTo(href)`는 재마운트를 안 한다** → expo-router가 `POP_TO` 액션으로 바꾸고(`expo-router/build/global-state/routing.js`), React Navigation `StackRouter`가 처리한다(`@react-navigation/routers`). 스택에 **같은 라우트 이름**이 있으면 그 자리로 올라가 그 화면의 params를 **통째로 교체**(merge 없음, expo가 `merge` 플래그를 안 싣는다) — 없으면 지금 화면(피커)을 그 자리에서 바꿔 끼운다. "같은 화면"은 **이름만**으로 판정한다(루트 Stack에 `getId`·`dangerouslySingular` 없음) — 코드가 다른 지역이어도 같은 라우트 이름이면 같은 인스턴스로 취급된다.
- **재사용되는 인스턴스는 로컬 `useState`가 이전 params 시절 값을 그대로 들고 있다** → params만 바뀌고 컴포넌트는 새로 안 만들어지므로, 이전 지역에서 세운 배너·대기 표식이 새 지역 화면에 남을 수 있다(탐색 탭 `ExploreLandingPage`(`pages/explore-landing`)가 그래서 지역 부품에 `key={region}` 재마운트를 얹었다 — TRIP-1105로 옛 `DestinationDetailPage`를 통합, 뮤테이션 red 확인 R-1·R-2). **이 화면으로 `dismissTo`가 새로 들어오는 상태를 추가할 때마다 같은 함정이 재발할 수 있다** — `key` 재마운트 없이 상태를 추가하면 지역이 바뀌어도 안 지워진다.
- **jest는 이 재사용/재마운트 여부를 원리적으로 못 본다** — 피커 테스트는 `dismissTo`가 어떤 인자로 불렸는지까지만 잠그고, expo-router는 목이라 실제 스택 동작을 실행하지 않는다. 실제 스택 상태 확인은 6-b 실기 전용이다.
- **같은 params 통째 교체가 기능 신호(`from=wizard`)도 지운다** — 위저드 출처 d04(`PlaceExplorePage`)에서 '지역 바꾸기'로 피커를 거쳐 `dismissTo` 복귀하면 params가 `{ region }`으로 교체되어 `from`이 함께 사라진다. `isWizardOrigin`이 false가 되어 ＋ FAB가 다시 그려지고, 누르면 `reset()`이 돌아 위저드 입력이 소실된다. expo-router `getNavigateAction`(merge 미지원)과 `StackRouter` `POP_TO` 분기(merge 거짓 시 새 params만 씀) 소스 대조로 확정. 기능 신호를 params로 싣는 화면은 `dismissTo` 복귀 인자에 그 신호를 다시 실어야 한다.
- **위저드 출처 d04의 ♥는 `router.back()`이라 "스택 바로 아래가 d02 select"라는 전제에 기댄다 — 그 전제를 지키는 심판이 없다** → "`from=wizard`를 달고 d04를 여는 곳은 `SavedPlacesPage` 하나"를 세던 소스 스캔은 TRIP-1145에서 지웠고, jest는 라우터가 목이라 `back`이 실제로 d02 select로 돌아가는지는 못 본다(`mockBack` 호출까지). 딥링크·알림으로 `from=wizard`가 붙은 d04에 직접 들어오면 ♥가 스택 밖으로 나가거나 무반응일 수 있다(미확인, 화면의 `onBack`도 같은 `back()`이라 새 위험은 아니다). 근거: TRIP-1093 구현 결정 — 요구사항 근거로 인용 금지. 6-b 실기 전용.

## 장소 상세 (explore, d06)

- **d06은 캐시 전용이라 오류 얼굴이 없다** → `PlaceDetailPage.tsx`는 `GET /places`를 부르지 않고 목록·담은목록 캐시에서만 장소를 찾아, 어느 캐시에도 없으면(콜드 딥링크·담은목록 조회 실패 포함) "장소를 찾을 수 없어요"(notFound)로 접는다. 웜 캐시 주 동선(d04→d06·d02→d06)은 무해. 오류 얼굴을 붙일 땐 `LivePlacePage`·`LiveItineraryPage`의 `resolveLiveState`(error/notFound 분리) 선례를 복제한다.
- **d06 하트 해제(un-save) 경로에 회귀 심판이 없다** → `PlaceDetailPage.tsx`의 `remove(poiId)` 분기(이미 담긴 하트 press)를 누르는 통합테스트가 0이라(목 서버에 DELETE 핸들러는 있다), `remove` 인자를 잘못 바꾸거나 조건을 반전해도 green. 코드는 현재 옳다(`remove(poiId)`가 내부에서 `findSavedPlaceId`로 역인덱스, d02와 같은 함수).
