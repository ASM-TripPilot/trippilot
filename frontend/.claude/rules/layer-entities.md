---
paths:
  - "src/entities/**"
---
# `src/entities/` — FSD entities 층 (TRIP-804 규칙 신설 · TRIP-806~809 4슬라이스 입주 · TRIP-810 옛 자리 shim 전부 정리)

둘 이상 feature가 쓰는 **도메인 단위**(place·stay·trip·itinerary-slot 같은 카드·타입·업무 규칙)를 두는 층. **입주 순서 = `place`(TRIP-806) → `stay`(TRIP-807) → `trip`(TRIP-808) → `itinerary-slot`(TRIP-809).** TRIP-810이 806~809가 남긴 옛 자리 재수출 shim 10종(순수 6 삭제 + 부분 4 재수출 줄 제거)을 전부 걷어, 소비처는 이제 전부 `@/entities/...`를 직접 문다(옛 경로 shim 0). 슬라이스별 파일 목록의 정본은 `src/entities` 디렉토리와 `docs/structure.generated.md`.

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
| `ui/SlotCandidateCard.tsx` | itinerary(h08·h10)·planb(i14) 후보 시트 공용, `testIDPrefix`로 두 소비처 구조 발산을 흡수. **TRIP-793 추가(additive 5종, 전부 기본값이 기존 렌더 불변)**: `tags?`(태그줄 `{prefix}-tags-{poiId}`, 첫 태그만 `#`)·`nameKo?`(실이름, 미주입 시 종전 "이름 준비 중" 플레이스홀더 유지)·`showRationale?`(기본 `true`, `false`면 rationale leaf 미렌더)·`distanceLabel?`(**필수→옵셔널 완화**, 미주입이면 라벨 Text 자체를 안 그림)·`distanceTone?`(기본 `'ink'`, `'muted'`면 거리 leaf가 태그줄과 같은 muted — h08 시트 전용). planb·features 위임 래퍼(CC)는 신규 prop 전부 미전달이라 무회귀(entitiesPlaceConsumers 앵커). **이름·사진·태그의 실서버 값은 여전히 없음**(candidates 응답에 필드 자체가 없다, BE 후속) — h08은 **픽스처**로만 채운다. ⚠️ **BE 후속 티켓 ID 드리프트(관측)**: TRIP-793 결정문은 "TRIP-823"을 가리키는데 이 행은 종전 "TRIP-851"을 적어 왔다 — 같은 BE 계약 공백을 가리키는 두 번호가 공존(aidlc 미반영, 정정 권한 밖). planb 루트 정규식이 `image-`·`name-`를 감산 안 함 주의(테스트에서 `queryByTestId`로 null 확인 필수). |
| `ui/PlaceSubtitle.tsx` | 부제 조각(`parts.join(' · ')`만, 표시 로직 무변경 — 3-a 결정: 조각을 인자화했을 뿐 기존 3공식 중 어느 것도 통일하지 않음). |
| ~~`ui/PlaceGlyphs.tsx`~~ | **TRIP-807로 `shared/ui/HeartGlyphs.tsx`로 이동(git mv, 내용 무변경)** — place·stay 카드가 공유하는 entities 교차 0 배선. 이 파일은 더 이상 없다. 하트 글리프 정본은 `layer-shared.md`의 `HeartGlyphs.tsx` 행 참고. |

## `src/entities/stay/` (TRIP-807)

파일 목록·export 전수는 `docs/structure.generated.md`(기계 생성). 여기엔 용도·함정만.

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `StayItem`·`SavedStay`·`StayPrice`를 `@/shared/api/generated/schemas`에서 **얇게 재수출** + 카드 뷰모델 `StayCardVM`(검색/레인, `ExploreLandingScreen`에서 이관)·`SavedStayCardVM`(저장 degrade, `SavedStayListScreen`에서 이관). `entities/place/model/index.ts`와 동형 — generated 직참조는 이 파일만 허용. |
| `lib/formatPrice.ts` | `features/stay/model/formatPrice.ts`에서 **바이트 그대로 이관**(출력 불변 `'가격 미확인'`/`'{천단위}원~'`, TRIP-70 확정 표기 유지). 옛 자리 shim(`features/stay/model/formatPrice.ts`)은 **TRIP-810에서 파일째 삭제**됨 — 807이 이미 소비처(StaySearchScreen·StayDetailScreen·OtaChoiceSheet·DestinationDetailPage 등)를 entities로 옮겨 둬 삭제 시점 prod importer는 0(고아 shim만 걷음). |
| `ui/StaySearchCard.tsx` | 검색 풀/레인 카드(e02·d01·d05, `variant: 'full'\|'rail'`). **명시적 testID 계약** — 소비처마다 save/글리프 testID 스킴이 달라(e02 `stay-card-save-{key}-filled` vs d01 `explore-stay-heart-filled-{key}`) 단일 prefix 대신 완성 문자열(root/photo/save/filled/outline)을 prop으로 받는다. 하트는 `@/shared/ui/HeartGlyphs`에서만. 사진 자리는 `SavedStay`/`StayItem`에 이미지 필드가 없어 항상 회색(`bg-surface-strong`, INV-1). |
| `ui/SavedStayCard.tsx` | degrade 카드(e04·g02 시트, `layout: 'vertical'\|'row'`). `SavedStay` 계약에 사진·지역·거리·가격이 없어 이름+`subtitle`(날짜)만 그린다 — 하트/체크는 카드가 소유하지 않고 소비처가 `trailing` ReactNode 슬롯으로 주입(카드는 하트 불가지). `save`(토글) prop 없음. |

**이관 안 한 것**: 거점 배지 `BaseBadgePinGlyph`(`features/trip/ui/TripGlyphs.tsx`)는 렌더 소비처 0인 고아라 이번에 entities로 옮기지 않았다(옮겨도 사변 코드). 밤별 행(`NightlyBaseCardVM`)·설정 행(`MyStayRowVM`)도 카드 shape가 접히지 않아 entities/stay 범위 밖(3-a 결정).

## `src/entities/trip/` (TRIP-808)

파일 목록·export 전수는 `docs/structure.generated.md`(기계 생성). 여기엔 용도·함정만.

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `Trip`·`TripStatus`·`TripDestination`을 `@/shared/api/generated/schemas`에서 **얇게 재수출** + 카드 뷰모델 `MyTripCardVM`·`MyTripBadge`(h06 이관)·`PastTripCardVM`(j07 이관). place·stay와 동형 — generated 직참조는 이 파일만 허용. **TRIP-788 추가**: `MyTripCardVM`에 `resume?: boolean`(resume CTA 노출 — 배지와 독립 신호, AC-5 seam)·`imageUrl?: string \| null`(픽스처 전용 사진, 프로덕션 항상 null, INV-1) additive 옵셔널 2필드(l03·a01 공용 계약이라 TC1~TC7 등 기존 소비처 무회귀). |
| `lib/formatTripPeriod.ts` | 기간 포맷터 **6벌**(`formatDateRange`·`formatSectionRange`·`formatTripRange`·`formatConfirmedDateRange`·`formatTripDateRange`·`formatDateRangeWithDow`) + `dayOfWeek`·`WEEKDAY_LABELS`를 각 원본에서 **바이트 그대로 이관**(en dash U+2013·미들닷 U+00B7·공백 유무·월 생략까지 출력 보존, 병합·통일 없음). 6벌이 살아있는 이유·실패값 계약은 [[바이트 지문과 심볼 보존의 자기모순]] 참고. |
| `lib/formatNights.ts` | 박수 포맷터 **3벌**(`formatNightsLabel` 실패 `''`·`nightsLabel` 실패 `null`·`nightsCountLabel` count 기반, 신규 export — tripSummary 인라인 템플릿의 함수화). **실패값 통일 금지**(`''`≠`null`이 계약). |
| `ui/TripCard.tsx` | h06 여행 카드. `testIDPrefix`(6종 sub-part 조립) 명시 prop — 카드가 `'my-trip'`을 하드코딩하지 않는다(l03 settings/TripCard도 같은 리터럴을 쓰는 D1 충돌 대비). `onPress={onResume ?? onPress}` 폴백으로 h06 옛 동작 보존. **TRIP-788 추가**: resume 렌더 게이트가 `badge==='draft'`(폴백) 단독에서 `vm.resume ?? (badge==='draft')`로 바뀜 — 생성중(PARTIAL)도 배지가 `'draft'`(작성중)라 종전엔 resume가 새어 나왔는데, 컨테이너가 명시 `resume:false`를 실으면 억제된다(seam, `MyTripCardVM.resume` 미전달이면 기존 배지 파생 그대로라 무회귀). 사진: `imageUrl` truthy면 `<Image testID="{prefix}-photo-{id}" source={{uri:imageUrl}}>`, 없으면 기존 회색 `bg-surface-soft`(사진 testID는 imageUrl 있을 때만 붙는다 — 여분 testID 0 계약). |
| `ui/PastTripRow.tsx` | j07 지난 여행 행. **완성 full `testID`**(`'record-calendar-past-trip-{id}'`) 명시 prop — PastTripList가 그 리터럴을 조립해 넘겨 리터럴이 소비처 파일에 잔존, 선재 `recordsCalendarStructure` G3 앵커 재조준 0. TripCard(6종 prefix)와 방식이 갈리는 이유는 sub-part 개수 차이(카드=6, 행=1). |
| `ui/TripGlyphs.tsx` | `ChevronRightGlyph` — `features/itinerary/ui/ItineraryGlyphs`판을 바이트 그대로 로컬 복제(entities→features 역참조 금지라 재사용 불가, 리포 글리프 로컬 복제 관례의 N번째 사본). |

**이관 안 한 것**: `formatStayDateRange`·`formatDday`(둘 다 features/trip 계열 별도 날짜 포맷, 이번 카드·포맷터 범위 밖) · l03 settings/TripCard·a01 홈 히어로·g01 위저드 요약값(entities 접기는 Figma 홈 재작성 후 재판정 대상, 3-a 결정 D5). `entities/trip/lib/formatTripPeriod.ts`·`formatNights.ts`의 옛 자리 중 **`planState.ts`·`baseScreen.ts`는 TRIP-810에서 재수출 줄만 제거**(파일은 존치, 실로직 함수는 그대로), **`tripWizardStep1.ts`는 공개 재수출(`export { dayOfWeek, formatDateRange }`)만 제거하고 내부 사용 `import { dayOfWeek }`는 존치**(내부 `presetRange`가 씀 — 재수출 제거와 자기 사용 import 유지는 다른 것, [[재수출 — 도메인 창구는 소유하지 않고 가리킨다]] TRIP-810 절 참고). `tripSummary.ts`·`recordsCalendar.ts`는 3-a에서 이번 범위 밖으로 확정(위임 구조 유지, 새 티켓 후보) — 이 둘만 아직 `import`+로컬 재수출 shim이 남아 있다.

## `src/entities/itinerary-slot/` (TRIP-809)

파일 목록·export 전수는 `docs/structure.generated.md`(기계 생성). 여기엔 용도·함정만.

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `PoiCategory`(값, `export {}`)·`ItineraryDaysItemSlotsItem`·`PlannedSlot`(타입)을 `@/shared/api/generated/schemas`에서 **얇게 재수출** + `ReplanSlotRow.tsx`에 로컬 정의돼 있던 `ReplanSlotVM`·`SlotBadgeKind`를 이관(신규 파생함수 0). `PoiCategory`는 **place를 거치지 않고 shared/api에서 직접 재수출**한다 — `@x` 창구를 통한 재재수출이 아니다(place도 같은 서버 타입을 병렬로 재수출 중일 뿐, 서로 무관). |
| `lib/categoryPlaceholder.ts` | `features/itinerary/model/categoryPlaceholder.ts`에서 **바이트 그대로 이관**(HEAD 대비 완전 IDENTICAL). `resolveCategoryPlaceholder` 순수 매핑(7종+폴백) + `hasOwnProperty` 프로토타입 키 가드 — 로직 무변경(개념 [[카테고리 플레이스홀더]]·[[프로토타입 키 폴백 함정]]). 옛 자리 shim은 **TRIP-810에서 파일째 삭제**(orphan shim, 런타임 소비처는 이미 0이었다). |
| `lib/slotKey.ts` | `features/itinerary/model/slotKey.ts`에서 **파일째 바이트 그대로 이관**(`buildSlotKey`·`parseSlotKey`·`buildSlotKeys` + 타입 5종). 옛 자리 shim은 **TRIP-810에서 파일째 삭제**, prod importer 11개(DraftScreen·TimelineScreen·ItineraryEditScreen·ManualPlanScreen·coPickSlots·pages 6종, LiveSlotCard는 로컬 `buildSlotKey`라 무관)를 전부 `@/entities/itinerary-slot/lib/slotKey`로 재조준(개념 [[단사성 (injectivity)]]·[[대조군 (control case)]]). |
| `lib/slotMapPin.ts` | **[TRIP-745 신규]** 슬롯 진행상태(execution 어휘 `'done'\|'active'\|'upcoming'`)를 지도 핀 어휘(`MapPinState`)로 바꾸는 변환기. `toMapPinState`(`active→current` 한 줄, 나머지 그대로) + `buildStatePins`(좌표 있는 것만 핀으로, `flatMap`으로 건너뛰되 번호는 **원 index+1 유지** — 재번호 금지). `SlotProgressState`·`StatePinInput`은 entities 로컬 재선언(entities→features import 금지라 `features/execution`의 `SlotState`를 못 가져와 다시 선언한 것, 서버 enum 아님). 개념 [[어휘 변환 레이어]]·[[FSD 층 경계]]. 화면 배선(소비처)은 TRIP-746, 이 파일 자체는 무소비 순수 함수. |
| `ui/SlotGlyphs.tsx` | 카테고리 아이콘 8종(`features/itinerary/ui/ItineraryGlyphs.tsx`에서 바이트 이사, SVG path 좌표까지 IDENTICAL) + `ChevronRightGlyph`·`LockGlyph`(`features/planb/ui/PlanbGlyphs.tsx` 판을 **바이트 복제** — entities→features 역참조 금지라 재사용 불가, 리포 글리프 로컬 복제 관례) + 색 상수 5(`INFO`·`SUCCESS`·`PRESENCE_BLUE`·`MUTED`·`PRIMARY_TEXT`). ⚠️ **`ICON_BY_KEY` 룩업(카테고리→글리프 매핑)은 jest 원리적 사각** — SVG `stroke`/`fill`이라 testID·className을 안 받고 raw-hex 스캔도 `*Glyphs.tsx` 제외라, 두 엔트리를 맞바꿔도 전 심판 green(traps-itinerary 참고, 이관 전부터 있던 사각을 그대로 승계 — 이관이 만든 신규 사각 아님). **[TRIP-783 추가]** `BODY` 색 상수 + `ClockGlyph`(시각 칩용, `ItineraryGlyphs`의 시계 아이콘 바이트 복제) 신설, `ChevronRightGlyph`에 `tone?: 'primaryText'\|'muted'` 확장(기본 `primaryText` — 무prop 호출 렌더 불변, `LockGlyph` tone 패턴 계승). |
| `ui/SlotStopCard.tsx` | **[TRIP-783 신규] → 편집 opt-in 확장(TRIP-797)** 결과 화면 5종(h07·h08·h11·h14·h16) + h12 편집기 공용 슬롯 카드. `PoiSlotCard`와 **신설·병존**(대체 아님 — 표면이 다름: 번호 배지·시각 칩·다른 후보 링크·72 사진). 번호 배지(index+1)·사진 72(없으면 `SlotPhotoPlaceholder`)·시각 칩(`timeLabel` 있을 때만)·이름›(이름 chevron은 글리프라 이름 leaf 텍스트가 `nameKo` 하나로 유지 — [[RNTL 완전일치 leaf]])·태그줄·필수/고정 배지·부제·"다른 후보 ›"(`onPressAlt` 있을 때만). **`warning?: string | null`(TRIP-801 D4 가산)** — 주면 이름 옆 "⏰ {warning}" 인라인(빨강 텍스트+시계 글리프). 미주입=미렌더(6종 공용 카드 후방호환) — h16 확정(CONFIRMED) 얼굴이 `slot.openingHoursKnown === false`일 때만 주입, 나머지 5화면·true/null/undefined는 무영향. presentation-only([[presentation-only 위젯 — 판단은 소비처로]]). **TRIP-797 추가분(옵셔널 3종, 전부 미전달=기존 leaf 그대로 — 개념 [[후방호환 옵셔널 파라미터 (additive prop)]])**: `onPressTimeChip?`(주면 시각칩이 `slot-stopcard-timechip-*` Pressable+⌄로 바뀜, `ChevronRightGlyph` 90도 회전 재사용 — 미주입이면 기존 `slot-stopcard-time-*` leaf 그대로, `SlotStopCard.test.tsx` 완전일치 단언 안 흔듦) · `unspecified?`(참이면 시각칩 대신 `UNSPECIFIED_CHIP_LABEL='시간대 설정'` 칩, `time` leaf 통째 부재) · `locked?`(참이면 `slot-stopcard-locked-*` "방문 완료" 배지 + `timechip` 미부착, `onPressTimeChip` 줘도 무시 — `editable = onPressTimeChip !== undefined && locked !== true`). `EditorView`(pages/itinerary-edit)가 이 세 prop의 유일한 소비처(h12) |
| `config/altLabel.ts` | **[TRIP-783 신규]** `ALT_LABEL = '다른 후보 ›'`(공백+U+203A) 단일 공용 상수. `DraftScreen.tsx`·`ItineraryEditScreen.tsx`의 옛 로컬 상수 2벌은 **이 티켓 범위 밖**(소비 화면 재작성 792/799가 교체). `fsdLayerStructure` AC-P0-5가 entities에 `config` 세그먼트를 허용. |
| `ui/SlotPhotoPlaceholder.tsx` | `features/itinerary/ui/SlotPhotoPlaceholder.tsx`에서 바이트 이관(import 2줄만 변경). `resolveCategoryPlaceholder` 소비 → 78×78 자리에 틴트+아이콘. 텍스트 0(INV-3). 옛 자리 shim은 **TRIP-810에서 파일째 삭제**(런타임 소비처가 이미 0이던 orphan shim, TimelineScreen이 유일한 소비처로 entities 직참조). |
| `ui/PoiSlotCard.tsx` | `features/itinerary/ui/PoiSlotCard.tsx`에서 바이트 이관(import 1줄만 변경). peek/list 겸용 통일 POI 카드. 옛 자리 shim은 **TRIP-810에서 파일째 삭제**(orphan shim, 소비처 TimelineScreen이 entities 직참조). |
| `ui/ReplanSlotRow.tsx` | `features/planb/ui/ReplanSlotRow.tsx`에서 바이트 이관(글리프 import→`SlotGlyphs`, VM 타입→`../model` import+재수출만 변경, 컴포넌트 본문 동일). ⚠️ 헤더 주석의 INV-3 가드명은 `entitiesItinerarySlotStructure G3`로 5-c에서 정정됨(이관 전 `executionDurationStructure` 표기는 stale — 그 가드는 이제 사정거리 밖). 옛 자리 shim(`features/planb/ui/ReplanSlotRow.tsx`)은 **TRIP-810에서 파일째 삭제** — 소비처 `ReplanDraftScreen`(809에 이미 재배선)·`app/_dev/preview.tsx`(810, `ReplanSlotVM` 타입 import 재조준, 6-b 발동)가 entities 직참조. |

**이관 안 한 것(entities/itinerary-slot 범위 밖, TRIP-809 시점 서술)**: 티켓이 프레이밍한 "공용 슬롯 카드 하나로 통합"·"`HH:mm–HH:mm` 시각 칩 포맷터"는 **당시 코드에 존재하지 않아 신설하지 않았다**(01 브리프 실측 — `slice(0,5)` 인라인 처리가 표면마다 다 다름, 병합하면 회귀). **[TRIP-783 갱신]** 이후 h공통·지도+시트 셸 티켓이 위 `ui/SlotStopCard.tsx`로 공용 카드를 **신설**했다 — 단 `PoiSlotCard` **통합·대체가 아니라 병존**(둘 다 남고, 대체는 여전히 소비 화면 재작성 후속 몫)이라 이 문단의 "통합하지 않았다"는 결론 자체는 유지된다. `DraftScreen`/`ManualPlanScreen`/`ItineraryEditScreen` 슬롯·`LiveSlotCard`(execution)·`ManualEditShell`(widgets) 슬롯은 화면 고유 계약이라 접히지 않음(3-a 결정). (**`TimelineSlotCard`는 TRIP-801로 `TimelineScreen.tsx`째 삭제**됨 — 옛 예시였을 뿐 이 결정에 영향 없음, 아래 layer-features-itinerary.md 참고.) `SlotState`('done'|'active'|'upcoming', execution 방문기록 파생 사영)는 서버 enum이 아니라 이관하지 않고 정본 관측만(D1). **TRIP-810로 옛 자리 shim 6종(순수, orphan 3 포함) 전부 파일째 삭제 + `ItineraryGlyphs.tsx`의 Category 8종 재수출 줄 제거** — `ConceptPickerScreen.tsx`(브리프 오측 3, 실제 importer 존재)가 entities `SlotGlyphs`를 직참조하도록 재조준(위 `layer-features-itinerary.md` ItineraryGlyphs 행 참고). 옛 자리 파일 참조는 이제 0.
