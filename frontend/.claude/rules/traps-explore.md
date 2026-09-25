---
paths:
  - "src/features/explore/**"
  - "src/pages/place-*/**"
  - "src/pages/region-picker/**"
  - "src/app/(tabs)/explore.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

- **`savedPlaces.integration.test.tsx`는 react-query 알림 경합 처방이 적용돼 있다(TRIP-953)** — `beforeAll`에 `notifyManager.setScheduler` 5ms 잠금 + `@/test-support/flushNotifications`로 `result.current`를 읽기 전 순서를 기다린다. 롤백 단언 앞 flush 3자리(`:405`·`:432`·`:451`)는 지워도 green으로 남는 무방비 지점이다(상세·이유는 `traps-record.md` 동일 항목). 새 낙관 업데이트 테스트를 이 파일에 더할 때 flush 없이 `act` 직후 읽으면 같은 flake가 재발한다.

## 지역 카탈로그 (explore/region, TRIP-445)

- **`TripNewStep1Page`·`RegionPickerScreen`을 렌더하는 node-버킷 테스트는 `useRegions`를 목해야 크래시 안 남** → 두 화면 모두 `useRegions()`(react-query)를 물어 `QueryClientProvider` 없는 node 버킷에서 렌더하면 `No QueryClient set` throw. 승인 테스트는 목을 걸었지만 sibling 테스트(`.budget`·`.mustVisit`·`.stayImport`·`tripWizardEntryReset`)는 처음엔 안 걸려 있었다(qa n=1 FAIL 실측) — 이 화면들을 렌더하는 새 테스트 파일을 추가할 때마다 같은 목이 필요하다는 사실을 기계가 강제하지 않는다.
- **`regionTint` 팔레트 hex는 어느 raw-hex 스캔에도 안 걸린다** → `placeExploreStructure.test.ts`의 raw-hex 가드(AC-G7)는 `PlaceExploreScreen.tsx` 한 파일만 대상이고 `RegionPickerScreen.tsx`를 주석으로 명시 제외한다. `regionCatalogStructure.test.ts`도 hex 값 자체는 안 본다(URL·zustand·duration만 스캔). `regions.ts`의 `TINT_PALETTE`를 임의 hex로 바꿔도 어떤 심판도 안 잡는다.
- **시/도→구/군 드릴다운(TRIP-597)의 레이아웃·'전체' 행 비주얼은 jest가 원리적으로 못 본다** → Figma에 이 상호작용 패턴 자체가 없어(미설계 신규 패턴) 픽셀 대조 대상이 없다. jest는 `explore-region-sido-{code}`·`explore-region-drilldown-back` 등 testID 존재/부재와 press→콜백 배선만 잠근다. 시/도 행이 실제로 눌러 들어가는지·'전체' 행이 구/군 카드와 시각적으로 구분되는지·문구 중복("인천광역시" 카드 vs "인천광역시 전체" 라벨)은 6-b 실기로만 확인된다.

## 탐색 랜딩 (explore/d01, TRIP-470)

- **`ExploreLandingScreen`을 렌더하는 node-버킷 테스트는 `useGetPlaces`도 목해야 크래시 안 남** → TRIP-470이 가볼 곳 레인을 복원하며 `(tabs)/explore.tsx`가 `useGetPlaces()`(react-query)를 새로 문다. `QueryClientProvider` 없는 node 버킷에서 이 라우트를 렌더하는 새 테스트 파일은 지역 카탈로그의 `useRegions` 함정(위 절)과 동형으로 이 목이 필요하다는 걸 기계가 강제하지 않는다.

## 하트 글리프 정본 (TRIP-806 → TRIP-807로 shared 이동)

- **하트 저장 글리프(Outline·Filled) 정본은 이제 `shared/ui/HeartGlyphs.tsx`다** — TRIP-806이 `entities/place/ui/PlaceGlyphs.tsx`로 승격했던 것을 TRIP-807이 `git mv`로 다시 `shared/ui`로 내렸다(place·stay 검색 카드가 공유, entities 교차 0). `features/explore/ui/ExploreGlyphs.tsx`의 동명 함수는 806 5-c에서 이미 삭제됐다. `traps-glyphs.md`의 `LocationOffGlyph` 세 벌 함정과 동형 위험이 두 차례(806 explore↔entities, 807 stay 신규 소비) 발생했다 — 새 하트 소비처를 만들 때 옛 경로(`entities/place/ui/PlaceGlyphs`·`ExploreGlyphs`)에서 다시 끌어오면 조용히 두 벌로 되돌아간다. raw-hex·fill 스캔은 `*Glyphs.tsx` 제외 관례라 분기해도 기계가 못 잡는다.

## 장소 상세 (explore, d06, TRIP-456)

- **d06 조회 오류가 notFound로 접힌다** → `PlaceDetailPage.tsx`는 `GET /places`가 5xx·네트워크로 실패해도 별도 오류 얼굴이 없어 "장소를 찾을 수 없어요"로 접는다(`live-place`/i05와 동형 한계, 위 execution 절 참고). 콜드 딥링크+조회 실패에서만 발동, 웜 캐시 주 동선(d04→d06·d02→d06)은 무해. 오류 얼굴을 붙일 땐 `LiveItineraryPage`의 `resolveLiveState`(error/notFound 분리) 선례를 복제한다.
- **d06 하트 해제(un-save) 경로에 회귀 심판이 없다** → `PlaceDetailPage.tsx`의 `remove(poiId)` 분기(이미 담긴 하트 press)를 누르는 통합테스트가 0이라, `remove` 인자를 잘못 바꾸거나 조건을 반전해도 승인 6스위트 전부 green. 코드는 현재 옳다(`remove(poiId)`가 내부에서 `findSavedPlaceId`로 역인덱스, d02와 같은 함수) — 지적 대상은 동작이 아니라 보호 심판 부재(h20 add→PUT 무심판과 동형 계열).
