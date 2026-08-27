---
paths:
  - "src/features/explore/**"
  - "src/pages/place-*/**"
  - "src/pages/region-picker/**"
  - "src/app/(tabs)/explore.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 지역 카탈로그 (explore/region, TRIP-445)

- **`TripNewStep1Page`·`RegionPickerScreen`을 렌더하는 node-버킷 테스트는 `useRegions`를 목해야 크래시 안 남** → 두 화면 모두 `useRegions()`(react-query)를 물어 `QueryClientProvider` 없는 node 버킷에서 렌더하면 `No QueryClient set` throw. 승인 테스트는 목을 걸었지만 sibling 테스트(`.budget`·`.mustVisit`·`.stayImport`·`tripWizardEntryReset`)는 처음엔 안 걸려 있었다(qa n=1 FAIL 실측) — 이 화면들을 렌더하는 새 테스트 파일을 추가할 때마다 같은 목이 필요하다는 사실을 기계가 강제하지 않는다.
- **`regionTint` 팔레트 hex는 어느 raw-hex 스캔에도 안 걸린다** → `placeExploreStructure.test.ts`의 raw-hex 가드(AC-G7)는 `PlaceExploreScreen.tsx` 한 파일만 대상이고 `RegionPickerScreen.tsx`를 주석으로 명시 제외한다. `regionCatalogStructure.test.ts`도 hex 값 자체는 안 본다(URL·zustand·duration만 스캔). `regions.ts`의 `TINT_PALETTE`를 임의 hex로 바꿔도 어떤 심판도 안 잡는다.

## 탐색 랜딩 (explore/d01, TRIP-470)

- **`ExploreLandingScreen`을 렌더하는 node-버킷 테스트는 `useGetPlaces`도 목해야 크래시 안 남** → TRIP-470이 가볼 곳 레인을 복원하며 `(tabs)/explore.tsx`가 `useGetPlaces()`(react-query)를 새로 문다. `QueryClientProvider` 없는 node 버킷에서 이 라우트를 렌더하는 새 테스트 파일은 지역 카탈로그의 `useRegions` 함정(위 절)과 동형으로 이 목이 필요하다는 걸 기계가 강제하지 않는다.

## 장소 상세 (explore, d06, TRIP-456)

- **d06 조회 오류가 notFound로 접힌다** → `PlaceDetailPage.tsx`는 `GET /places`가 5xx·네트워크로 실패해도 별도 오류 얼굴이 없어 "장소를 찾을 수 없어요"로 접는다(`live-place`/i05와 동형 한계, 위 execution 절 참고). 콜드 딥링크+조회 실패에서만 발동, 웜 캐시 주 동선(d04→d06·d02→d06)은 무해. 오류 얼굴을 붙일 땐 `LiveItineraryPage`의 `resolveLiveState`(error/notFound 분리) 선례를 복제한다.
- **d06 하트 해제(un-save) 경로에 회귀 심판이 없다** → `PlaceDetailPage.tsx`의 `remove(poiId)` 분기(이미 담긴 하트 press)를 누르는 통합테스트가 0이라, `remove` 인자를 잘못 바꾸거나 조건을 반전해도 승인 6스위트 전부 green. 코드는 현재 옳다(`remove(poiId)`가 내부에서 `findSavedPlaceId`로 역인덱스, d02와 같은 함수) — 지적 대상은 동작이 아니라 보호 심판 부재(h20 add→PUT 무심판과 동형 계열).
