---
paths:
  - "src/features/explore/**"
---
# `src/features/explore/` — 탐색 공유 모델·글리프 + 탐색 랜딩(d01)

d1b·e00 지역 선택, d01 탐색 랜딩(지역 필터 포함 — TRIP-1105로 옛 d03 목적지 상세 통합), d04 장소 탐색, d02 담은 장소(save·select 모드), d06 장소 상세가 함께 쓰는 모델·글리프. **이 폴더에 남은 화면 뷰는 d01 `ExploreLandingScreen` 하나다** — d02 뷰 3개는 TRIP-1144로 `pages/saved-places/ui/`, d04·d06·지역 피커 뷰(+d04 전용 `PartialFailureBanner`·`regionChipLabel`)는 TRIP-1147로 `pages/{place-explore,place-detail,region-picker}/`로 이사했다(행은 `layer-pages.md`). 배선은 각 화면의 `pages/` 슬라이스가 갖는다. 남은 화면은 props-only다 — 훅·라우터·query·`@/shared/api` import 0(기계 강제 없음 — TRIP-1145에서 스캔 삭제). 담기 토글 서버 상태는 `savedPlaces.ts` 한 곳이 소유하고, 판정 함수 `resolvePlaceListState`는 d04·d02가 공유한다.

| 파일 | 역할 |
|---|---|
| `src/features/explore/model/regions.ts` | 서버 지역 카탈로그. `useRegions(params?)`는 `places` 생성 클라이언트를 **호출 시점 지연 `require`**로 문다 — 정적 import면 `mutator→@/shared/api` 전이 의존이 `regionTint` 소비자 `RegionPickerScreen`까지 끌려가 프리뷰 스모크(`devPreviewReleaseGate`)의 지뢰 목이 터진다(load-bearing). `filterRegions(regions, query)`(빈 질의=전체·순서 보존) · `regionTint(code)`(`hashCode%6` 결정적 폴백, 임의 서버 코드에도 크래시 없음) · `groupRegionsBySido`(`regionCode.slice(0,2)`로 시/도 그룹, 서버 순서 보존, `poiCount` 재계산 없음) · `limitRegionsWhenEmpty`(프로덕션 소비처 0, 함수·테스트만 존치). `Region` 타입은 소비처가 generated에서 직접 import한다. |
| `src/features/explore/model/regionPickerPurpose.ts` | 지역 피커 URL `purpose` 철자의 정본. `RegionPickerPurpose = 'stay'\|'trip'\|'explore'\|'places'` + `regionPickerHref(purpose)`(템플릿 리터럴 타입 반환 — `typedRoutes`에서 `router.push` 인자로 받으려면 순수 `string`이면 안 된다). `trip`=위저드 "도시 추가"(담고 `back()`) · `explore`=탐색 랜딩·홈·d03 검색바(d03으로 `dismissTo`) · `places`=d04 "지역 바꾸기"(단일 지역으로 교체) · `stay`=숙소 검색(`StaySearchPage`는 아직 리터럴). 피커는 모르는 값을 전부 `stay`로 폴백한다(URL은 신뢰 경계) — 리터럴을 개명하며 피커 해석부를 안 맞추면 **호출자 쪽 테스트는 red가 안 난다**. |
| `src/features/explore/model/placeListView.ts` | `visiblePlaces(places, searchText)` — `nameKo` 부분일치 필터 후 `savedCount` 내림차순(안정 정렬). 캐시 배열을 제자리 정렬하지 않고 새 배열 반환. 프로덕션 소비처 0 — `PlaceExplorePage`는 서버 검색 결과(`items.length`)를 `itemCount`로 쓴다(TRIP-502). 테스트만 부른다. |
| `src/features/explore/model/placeListState.ts` | `PlaceListState`(`loading`\|`error`\|`results`\|`filter-zero`\|`empty`, `filter-zero`는 `blame: 'search'\|'category'`) + `resolvePlaceListState(...)`. 우선순위 `loading > error > results > filter-zero > empty`, blame은 검색어 우선. 지목 문구는 상태가 안 나르고 화면이 조립한다. PBT 대상(CI 차단). |
| `src/features/explore/model/mergePlaces.ts` | `mergePlacesByPoiId(lists)` — 지역별 목록을 입력 순서로 평탄화하되 같은 `poiId`는 첫 등장만, 항상 새 배열. |
| `src/features/explore/model/useMultiRegionPlaces.ts` | 2개 이상 지역 병렬 조회 — `Promise.allSettled` 후 병합. 일부 실패는 생존(부분 성공, `degraded`는 성공/실패 개수 파생), **전부 실패면 throw**(빈 목록을 성공으로 위장 안 함, INV-4). `enabled: regions.length>=2`, 무한 스크롤 없음. |
| `src/features/explore/model/usePlacesInfinite.ts` | d04·수동추가 '모두 보기' 커서 무한 스크롤. 검색은 서버(`q`)가 하고 `q`를 queryKey에 넣어 전체 재조회한다(페이지-내 필터의 조용한 누락 회피). queryKey가 `getGetPlacesQueryKey(params)` 접두라 d06 상세가 `InfiniteData`를 훑어 단건을 찾는다. |
| `src/features/explore/ui/ExploreGlyphs.tsx` | 탐색 글리프(Figma path 실측). 하트는 이 파일에 없다 — `@/shared/ui/HeartGlyphs`에서만. 선택 표시는 `CheckCircleFilledGlyph`/`CheckCircleOutlineGlyph` **별개 컴포넌트**(fill 색만 토글하면 jest가 못 잰다). `MapPinGlyph`·`FilterSlidersGlyph`·`WarningTriangleGlyph`·`SearchGlyph`(TRIP-1050, 기본 회색·`tone="on-primary"`면 흰 stroke — 기본값을 지키는 심판은 없다, 소비처 7곳이 회색에 기댐)는 `tone` prop을 갖는다. |

**계약 공백**: 목적지 집계(숙소 수·최저가)는 계약이 없다(US-EXPL-02 예외항). d04 상태 문구는 정본 규정이 없어 e02 문구를 도메인만 바꿔 썼다. `shared/location/LocationPreprompt.tsx`는 e00 동선에 자리가 없어 쓰지 않는다.
