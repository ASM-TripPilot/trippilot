---
paths:
  - "src/entities/**"
---
# `src/entities/` — FSD entities 층 (TRIP-804 규칙 신설 · TRIP-806 첫 입주·형제 격리 · TRIP-807 stay 입주)

둘 이상 feature가 쓰는 **도메인 단위**(place·stay·trip·itinerary-slot 같은 카드·타입·업무 규칙)를 두는 층. **첫 입주 = `place`(TRIP-806) → 둘째 = `stay`(TRIP-807).** 슬라이스별 파일 목록의 정본은 `src/entities` 디렉토리와 `docs/structure.generated.md`.

## import 방향
- entities → shared 만 참조한다. features · widgets · pages · app · app-shell 은 참조하지 못한다(하위 층은 상위 층을 모른다).
- **형제 슬라이스는 서로 모른다**: `entities/place`는 `entities/stay`를 직접 import 하지 못한다(features 슬라이스 격리와 동형 — 슬라이스마다 zone이 자동 생성). 공용이 생기면 형제에서 꺼내지 말고 `shared`로 내린다.
- **교차는 `@x` 창구로만**: 도메인끼리 꼭 참조해야 하면 **제공자가 소비자에게만** 내주는 `entities/<제공자>/@x/<소비자>/**` 폴더를 통한다. 예: place가 itinerary-slot에게 `entities/place/@x/itinerary-slot/`로 공개 API를 내주면, `entities/itinerary-slot/**`만 그 경로를 import할 수 있다(다른 슬라이스는 여전히 차단). `@x`는 **미래 대비 규약**이라 실제 폴더는 필요할 때 만든다(TRIP-806 시점엔 없음).
- `eslint.config.js`의 층 zone(`import/no-restricted-paths`)이 강제하고 — 형제 격리 except는 자기 슬라이스 + `entities/*/@x/<자기>/**`를 **전부 절대 glob**으로 둔다(상대 glob은 정당한 자기 import까지 오탐, 문제로그 2026-09-12) — `src/__tests__/importBoundaryLayers.test.ts`가 형제 차단·`@x` 통과를 실측한다.

## 세그먼트
- `ui` / `model` / `lib` / `config` 넷 + **entities 한정 `@x`**(교차 창구, 위 참고). 옛 칸 `screens·containers·hooks·store` 부활 금지. `api` 세그먼트는 두지 않는다 — 서버 통신은 `shared/api` 단일 계층. `fsdLayerStructure.test.ts`가 이 세그먼트 목록(entities만 `@x` 추가)을 잠근다.

## `src/entities/place/` (TRIP-806)

파일 목록·export 전수는 `docs/structure.generated.md`(기계 생성). 여기엔 용도·함정만.

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `Place`·`PoiCategory`·`SavedPlace`를 `@/shared/api/generated/schemas`에서 **얇게 재수출**(새 shape 아님 — 원본이 바뀌면 자동 추종) + 화면 전용 뷰모델 `PlaceCardVM`(서버 계약 아님, `ExploreLandingScreen`에서 이관). generated 직참조는 이 파일만 허용(G2 스캔 예외) — `ui/`·`lib/`가 `@/shared/api/generated`를 직접 물면 경계 위반. |
| `lib/formatDistance.ts` | 미터→`"820m"`/`"3.2km"` 문자열 반올림 코어. `legDistance`(itinerary)·`radiusUsedLabel`(itinerary)이 각자 복붙하던 반올림 로직을 위임하도록 바뀜(계약·출력 불변, 재발명 0). |
| `ui/PlaceRailCard.tsx` | d05 목적지 상세 레인 카드. 폭 `160px`(Seed 정본값) — 옛 d05 로컬 카드의 `150px`에서 10px 넓어짐(testID·텍스트는 보존, 폭만 6-b 실기 확인 대상). |
| `ui/PlaceGridCard.tsx` | d04 탐색 그리드 카드. 하트 저장 testID·"담음" 배지·pending(연타 방지) 가드. |
| `ui/PlaceRowCard.tsx` | 범용 행 카드(save?/trailing?/subtitle 옵셔널 슬롯). **이번 사이클 소비처 0**(d02는 로컬 `SavedPlaceRow` 유지, h13은 로컬 구조 유지 — 둘 다 entities에서는 글리프·부제만 가져간다). AC·승인 테스트가 요구해 존재하지만 존치 여부는 d02(TRIP-706)·h13(TRIP-798) 정합 시 재판단(문제로그 아님 — 개발로그 인수인계 참고). |
| `ui/SlotCandidateCard.tsx` | itinerary(h13)·planb 후보 시트 공용, 옵셔널 슬롯 7개(showImage·showNameTestId·badge·selected·slack·trailing·distanceLabel)+`testIDPrefix`로 두 소비처 구조 발산을 흡수. **실값 옵셔널 prop(이름·이미지·태그) 미구현**(현재 "이름 준비 중" 고정 문구) — BE 계약 보강 TRIP-851 완료 후 연계. planb 루트 정규식이 `image-`·`name-`를 감산 안 함 주의(테스트에서 `queryByTestId`로 null 확인 필수). |
| `ui/PlaceSubtitle.tsx` | 부제 조각(`parts.join(' · ')`만, 표시 로직 무변경 — 3-a 결정: 조각을 인자화했을 뿐 기존 3공식 중 어느 것도 통일하지 않음). |
| ~~`ui/PlaceGlyphs.tsx`~~ | **TRIP-807로 `shared/ui/HeartGlyphs.tsx`로 이동(git mv, 내용 무변경)** — place·stay 카드가 공유하는 entities 교차 0 배선. 이 파일은 더 이상 없다. 하트 글리프 정본은 `layer-shared.md`의 `HeartGlyphs.tsx` 행 참고. |

## `src/entities/stay/` (TRIP-807)

파일 목록·export 전수는 `docs/structure.generated.md`(기계 생성). 여기엔 용도·함정만.

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `StayItem`·`SavedStay`·`StayPrice`를 `@/shared/api/generated/schemas`에서 **얇게 재수출** + 카드 뷰모델 `StayCardVM`(검색/레인, `ExploreLandingScreen`에서 이관)·`SavedStayCardVM`(저장 degrade, `SavedStayListScreen`에서 이관). `entities/place/model/index.ts`와 동형 — generated 직참조는 이 파일만 허용. |
| `lib/formatPrice.ts` | `features/stay/model/formatPrice.ts`에서 **바이트 그대로 이관**(출력 불변 `'가격 미확인'`/`'{천단위}원~'`, TRIP-70 확정 표기 유지). 옛 자리엔 `export { formatPrice } from '@/entities/stay/lib/formatPrice'` 한 줄 shim만 남았다(TRIP-810이 shim 정리 예정, 아직 존치). |
| `ui/StaySearchCard.tsx` | 검색 풀/레인 카드(e02·d01·d05, `variant: 'full'\|'rail'`). **명시적 testID 계약** — 소비처마다 save/글리프 testID 스킴이 달라(e02 `stay-card-save-{key}-filled` vs d01 `explore-stay-heart-filled-{key}`) 단일 prefix 대신 완성 문자열(root/photo/save/filled/outline)을 prop으로 받는다. 하트는 `@/shared/ui/HeartGlyphs`에서만. 사진 자리는 `SavedStay`/`StayItem`에 이미지 필드가 없어 항상 회색(`bg-surface-strong`, INV-1). |
| `ui/SavedStayCard.tsx` | degrade 카드(e04·g02 시트, `layout: 'vertical'\|'row'`). `SavedStay` 계약에 사진·지역·거리·가격이 없어 이름+`subtitle`(날짜)만 그린다 — 하트/체크는 카드가 소유하지 않고 소비처가 `trailing` ReactNode 슬롯으로 주입(카드는 하트 불가지). `save`(토글) prop 없음. |

**이관 안 한 것**: 거점 배지 `BaseBadgePinGlyph`(`features/trip/ui/TripGlyphs.tsx`)는 렌더 소비처 0인 고아라 이번에 entities로 옮기지 않았다(옮겨도 사변 코드). 밤별 행(`NightlyBaseCardVM`)·설정 행(`MyStayRowVM`)도 카드 shape가 접히지 않아 entities/stay 범위 밖(3-a 결정).

## `src/entities/trip/` (TRIP-808)

파일 목록·export 전수는 `docs/structure.generated.md`(기계 생성). 여기엔 용도·함정만.

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `Trip`·`TripStatus`·`TripDestination`을 `@/shared/api/generated/schemas`에서 **얇게 재수출** + 카드 뷰모델 `MyTripCardVM`·`MyTripBadge`(h06 이관)·`PastTripCardVM`(j07 이관). place·stay와 동형 — generated 직참조는 이 파일만 허용. |
| `lib/formatTripPeriod.ts` | 기간 포맷터 **6벌**(`formatDateRange`·`formatSectionRange`·`formatTripRange`·`formatConfirmedDateRange`·`formatTripDateRange`·`formatDateRangeWithDow`) + `dayOfWeek`·`WEEKDAY_LABELS`를 각 원본에서 **바이트 그대로 이관**(en dash U+2013·미들닷 U+00B7·공백 유무·월 생략까지 출력 보존, 병합·통일 없음). 6벌이 살아있는 이유·실패값 계약은 [[바이트 지문과 심볼 보존의 자기모순]] 참고. |
| `lib/formatNights.ts` | 박수 포맷터 **3벌**(`formatNightsLabel` 실패 `''`·`nightsLabel` 실패 `null`·`nightsCountLabel` count 기반, 신규 export — tripSummary 인라인 템플릿의 함수화). **실패값 통일 금지**(`''`≠`null`이 계약). |
| `ui/TripCard.tsx` | h06 여행 카드. `testIDPrefix`(6종 sub-part 조립) 명시 prop — 카드가 `'my-trip'`을 하드코딩하지 않는다(l03 settings/TripCard도 같은 리터럴을 쓰는 D1 충돌 대비). `onPress={onResume ?? onPress}` 폴백으로 h06 옛 동작 보존. |
| `ui/PastTripRow.tsx` | j07 지난 여행 행. **완성 full `testID`**(`'record-calendar-past-trip-{id}'`) 명시 prop — PastTripList가 그 리터럴을 조립해 넘겨 리터럴이 소비처 파일에 잔존, 선재 `recordsCalendarStructure` G3 앵커 재조준 0. TripCard(6종 prefix)와 방식이 갈리는 이유는 sub-part 개수 차이(카드=6, 행=1). |
| `ui/TripGlyphs.tsx` | `ChevronRightGlyph` — `features/itinerary/ui/ItineraryGlyphs`판을 바이트 그대로 로컬 복제(entities→features 역참조 금지라 재사용 불가, 리포 글리프 로컬 복제 관례의 N번째 사본). |

**이관 안 한 것**: `formatStayDateRange`·`formatDday`(둘 다 features/trip 계열 별도 날짜 포맷, 이번 카드·포맷터 범위 밖) · l03 settings/TripCard·a01 홈 히어로·g01 위저드 요약값(entities 접기는 Figma 홈 재작성 후 재판정 대상, 3-a 결정 D5). `entities/trip/lib/formatTripPeriod.ts`·`formatNights.ts`의 옛 자리(`baseScreen.ts`·`tripSummary.ts`·`tripWizardStep1.ts`·`planState.ts`·`recordsCalendar.ts`)는 재수출 shim만 남았다(TRIP-810이 shim 정리 예정, 아직 존치 — 내부에서 이관 함수를 쓰는 `tripSummary`·`tripWizardStep1`·`recordsCalendar`는 `import`+로컬 재수출, 안 쓰는 `planState`·`baseScreen`은 순수 `export … from` — 구분은 [[재수출 — 도메인 창구는 소유하지 않고 가리킨다]] 참고).
