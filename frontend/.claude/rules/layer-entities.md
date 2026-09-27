---
paths:
  - "src/entities/**"
---
# `src/entities/` — FSD entities 층 (둘 이상 feature가 쓰는 도메인 단위)

둘 이상 feature가 쓰는 **도메인 단위**(place·stay·trip·itinerary-slot·style-analysis의 카드·타입·업무 규칙)를 두는 층. 소비처는 `@/entities/...`를 직접 문다(옛 자리 재수출 shim을 두지 않는다). 슬라이스별 파일 목록의 정본은 `src/entities` 디렉토리와 `docs/structure.generated.md`.

## import 방향
- entities → shared 만 참조한다. features · widgets · pages · app · app-shell 은 참조하지 못한다(하위 층은 상위 층을 모른다).
- **형제 슬라이스는 서로 모른다**: `entities/place`는 `entities/stay`를 직접 import 하지 못한다(슬라이스마다 zone이 자동 생성). 공용이 생기면 형제에서 꺼내지 말고 `shared`로 내린다.
- **교차는 `@x` 창구로만**: 도메인끼리 꼭 참조해야 하면 **제공자가 소비자에게만** 내주는 `entities/<제공자>/@x/<소비자>/**` 폴더를 통한다(예: `entities/place/@x/itinerary-slot/`은 `entities/itinerary-slot/**`만 import 가능). 실제 폴더는 필요할 때 만든다.
- `eslint.config.js`의 층 zone(`import/no-restricted-paths`)이 강제한다 — 형제 격리 except는 자기 슬라이스 + `entities/*/@x/<자기>/**`를 **전부 절대 glob**으로 둔다(상대 glob은 정당한 자기 import까지 오탐). `src/__tests__/importBoundaryLayers.test.ts`가 형제 차단·`@x` 통과를 실측한다.
- entities→features 역참조 금지라 features 글리프를 못 쓴다 — 필요한 글리프는 슬라이스 `*Glyphs.tsx`에 바이트 복제한다(리포 글리프 로컬 복제 관례).

## 세그먼트
- `ui` / `model` / `lib` / `config` 넷 + **entities 한정 `@x`**(교차 창구). 옛 칸 `screens·containers·hooks·store` 부활 금지. `api` 세그먼트는 두지 않는다 — 서버 통신은 `shared/api` 단일 계층. `fsdLayerStructure.test.ts`가 이 세그먼트 목록을 잠근다.
- 각 슬라이스 `model/index.ts`는 `@/shared/api/generated/schemas`의 서버 타입을 **얇게 재수출**하고(새 shape 아님 — 원본 변경을 자동 추종) 화면 전용 뷰모델을 둔다. **generated 직참조는 `model/index.ts`만 허용**(G2 스캔 예외) — `ui/`·`lib/`가 `@/shared/api/generated`를 직접 물면 경계 위반.

## `src/entities/place/`

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `Place`·`PoiCategory`·`SavedPlace` 재수출 + 화면 전용 `PlaceCardVM`(서버 계약 아님). |
| `lib/formatDistance.ts` | 미터→`"820m"`/`"3.2km"` 반올림 코어. 거리 라벨은 이걸 위임해 쓴다(재발명 금지). |
| `ui/PlaceRailCard.tsx` | d05 목적지 상세 레인 카드(폭 `160px`). |
| `ui/PlaceGridCard.tsx` | d04 탐색 그리드 카드. 하트 저장 testID·"담음" 배지·pending(연타 방지) 가드. |
| `ui/PlaceRowCard.tsx` | 범용 행 카드(save?/trailing?/subtitle 옵셔널 슬롯). |
| `ui/SlotCandidateCard.tsx` | itinerary(h08·h10)·planb(i14) 후보 시트 공용, `testIDPrefix`로 소비처 구조 차이를 흡수. `tags?`·`nameKo?`·`showRationale?`·`distanceLabel?`·`distanceTone?`·`dimmed?`는 전부 기본값이 기존 렌더 불변(`entitiesPlaceConsumers` 앵커). candidates 응답에 이름·사진·태그·"반경 밖" 필드가 없어 이 값들은 픽스처로만 채워진다(프로덕션 톤다운 0). planb 루트 정규식이 `image-`·`name-`를 감산하지 않으니 테스트에서 `queryByTestId`로 null을 확인한다. |
| `ui/PlaceSubtitle.tsx` | 부제 조각(`parts.join(' · ')`만). 기존 부제 공식들을 통일하지 않고 조각만 인자화했다. |

## `src/entities/stay/`

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `StayItem`·`SavedStay`·`StayPrice` 재수출 + `StayCardVM`(검색/레인)·`SavedStayCardVM`(저장 degrade). |
| `lib/formatPrice.ts` | 가격 표기(출력 계약 `'가격 미확인'`/`'{천단위}원~'`). |
| `ui/StaySearchCard.tsx` | 검색 풀/레인 카드(e02·d01·d05, `variant: 'full'\|'rail'`). **testID는 완성 문자열 prop**(root/photo/save/filled/outline) — 소비처마다 save/글리프 testID 스킴이 달라 단일 prefix로 못 접는다. 하트는 `@/shared/ui/HeartGlyphs`에서만. 이미지 필드가 없어 사진 자리는 항상 회색(INV-1). |
| `ui/SavedStayCard.tsx` | degrade 카드(e04·g02 시트, `layout: 'vertical'\|'row'`). 계약에 사진·지역·거리·가격이 없어 이름+`subtitle`만. 하트/체크는 소비처가 `trailing` 슬롯으로 주입(카드는 하트 불가지, `save` prop 없음). |
| `ui/StayRecommendCard.tsx` | h15 동선 기준 추천 카드(props-only). 거리만(INV-3), 문자열은 소비처가 서식해 넘긴다. 선택은 `accessibilityState.selected`와 테두리를 **같은 루트**에 건다. `SavedStayCard`의 layout으로 얹지 않는다 — degrade 카드 계약(배지·거리 줄·선택 테두리 없음)이 흐려진다. |

## `src/entities/trip/`

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `Trip`·`TripStatus`·`TripDestination` 재수출 + `MyTripCardVM`·`MyTripBadge`·`PastTripCardVM`. `resume?`·`imageUrl?`·`photoLabel?`은 additive 옵셔널(미전달 소비처 무회귀, `imageUrl`은 픽스처 전용 — 프로덕션 null, INV-1). |
| `lib/formatTripPeriod.ts` | 기간 포맷터 **6벌** + `dayOfWeek`·`WEEKDAY_LABELS`. en dash(U+2013)·미들닷(U+00B7)·공백·월 생략이 벌마다 달라 **병합·통일 금지**(합치면 회귀). 근거는 개념 [[바이트 지문과 심볼 보존의 자기모순]]. |
| `lib/formatNights.ts` | 박수 포맷터 **3벌**(`formatNightsLabel` 실패 `''`·`nightsLabel` 실패 `null`·`nightsCountLabel`). **실패값 통일 금지**(`''`≠`null`이 계약). |
| `ui/TripCard.tsx` | h06 여행 카드. `testIDPrefix` 명시 prop(카드가 `'my-trip'`을 하드코딩하지 않는다). resume 게이트는 `vm.resume ?? (badge==='draft')` — 생성중도 배지가 `'draft'`라 컨테이너가 `resume:false`를 실어 억제한다. 사진 testID는 `imageUrl`이 있을 때만 붙는다. |
| `ui/PastTripRow.tsx` | j07 지난 여행 행. **완성 full `testID`** prop(sub-part가 하나라 prefix 대신). `compact?`(기본 `false`)가 참이면 l03 변형(64/r12), 아니면 j07 원형(72/r10·카드 r16)이 className 그대로 유지된다. |
| `ui/PastTripRow.compact.test.tsx` | `compact` 변형 단위 테스트 — 공백 분할 className 배열로 두 변형을 가른다(부분 문자열 오탐 방지). |
| `ui/TripGlyphs.tsx` | `ChevronRightGlyph` 로컬 복제. |

`features/record/model/recordsCalendar.ts`는 아직 `formatTripDateRange`·`nightsLabel`을 로컬 재수출한다(유일하게 남은 shim).

## `src/entities/itinerary-slot/`

| 파일 | 용도·함정 |
|---|---|
| `model/index.ts` | `PoiCategory`·`ItineraryDaysItemSlotsItem`·`PlannedSlot` 재수출 + `ReplanSlotVM`(`tone: 'planned'\|'visited'`·`photo`·`timeLabel`·`categoryLabel`·`distanceRange`). `PoiCategory`는 place를 거치지 않고 shared/api에서 직접 재수출한다(place와 병렬, `@x` 아님). |
| `lib/categoryPlaceholder.ts` | `resolveCategoryPlaceholder` 순수 매핑(7종+폴백) + `hasOwnProperty` 프로토타입 키 가드(개념 [[카테고리 플레이스홀더]]·[[프로토타입 키 폴백 함정]]). |
| `lib/slotKey.ts` | `buildSlotKey`·`parseSlotKey`·`buildSlotKeys` + 타입 5종. 단사성이 계약(개념 [[단사성 (injectivity)]]). |
| `lib/endsNextDay.ts` | `deriveEndsNextDay(startAt, endAt)` — zero-pad `HH:mm:ss` 사전식 `<=` 비교, 자정 넘김 유도의 **유일한 생산처**. `TimeSheet.h04.source.test.ts`가 이 파일·`TimeSheet.tsx`·`ItineraryEditPage.tsx`의 `<=` 개수를 함께 센다(소비처는 0이어야 함 — 재구현 금지). |
| `lib/suggestNextSlotTime.ts` | 새 장소 기본 시각(앞 장소 종료부터 1시간, `% 1440` 자정 순환). 앞 슬롯 없음·자정 넘김은 폴백 `10:00–11:00`. **`endsNextDay`를 반환하지 않는다** — 자정 넘김 판정은 `deriveEndsNextDay` 한 벌. 상수명이 `SPAN_MINUTES`인 이유는 G3 `duration` 부분일치 스캔. "앞 슬롯"을 고르는 것은 소비처(`PlaceAddPage`) 몫 — 슬롯 1개 픽스처로는 "마지막"과 "첫" 선택이 구분되지 않는다. |
| `lib/violationLabel.ts` | 위반 표식 문구. ① `VIOLATION_NOTICE`(고정 상수) — 서버 `violationReason`을 읽지 않는다(FE 파싱 금지, `hasViolation` 한 비트만). h08 셸·`DraftScreen` 폴백·`ItineraryPlanPage`가 쓴다. ② `violationLabel(item)` — 서버 원문의 `~`로 이은 분값 쌍만 `HH:mm`로 번역한 상세 문구, 편집기(`EditorView`)만 쓴다. ②는 서버 문구를 그대로 흘려 HC2 "이동 N분 필요"가 INV-3을 누수하므로 새 표면은 ①을 쓴다(개념 [[INV-3 예외를 값 인터폴레이션으로 통과시키기]]). |
| `lib/slotMapPin.ts` | 슬롯 진행상태(`'done'\|'active'\|'upcoming'`)→`MapPinState` 변환(`active→current`). `buildStatePins`는 좌표 없는 슬롯을 건너뛰되 번호는 **원 index+1 유지**(재번호 금지). `SlotProgressState`는 entities 로컬 재선언(서버 enum 아님, features import 불가). |
| `lib/openingHoursLabel.ts` | 영업시간 원문→상태줄 라벨. `normalizeOpeningHours`로 먼저 정리 → `^HH:mm\s*[-–]\s*HH:mm$`면 `HH:mm–HH:mm 영업`, 빈 값이면 `null`, 그 밖은 정리된 원문. "24시간" 같은 리터럴은 소스에 두지 않는다(INV-3 스캔 오탐 회피). |
| `lib/normalizeOpeningHours.ts` | `<br>` 계열 태그 변형(대소문자·태그 안 공백·뒤 줄바꿈 1개)을 `\n`으로 치환 후 trim. 소비: 탐색 상세·실행 상세 뷰 조립·`openingHoursLabel`. 모양이 깨진 태그(`<br<`·절단 태그)는 거르지 못한다. |
| `ui/SlotGlyphs.tsx` | 카테고리 아이콘 8종 + `ChevronRightGlyph`(`tone`)·`LockGlyph`·`ClockGlyph`·`PhotoGlyph`·`MemoGlyph`·`CheckGlyph` + 색 상수. ⚠️ **`ICON_BY_KEY`(카테고리→글리프) 매핑은 jest 원리적 사각** — SVG `stroke`/`fill`이라 두 엔트리를 맞바꿔도 전 심판 green(`traps-itinerary` 참고). |
| `ui/SlotProgressCard.tsx` | i01 허브 슬롯 카드 — 진행 상태 하나로 done/active/upcoming 세 모양 중 하나를 찍는 무상태 카드(`useState` 금지, `entitiesItinerarySlotStructure` G2). "준비 중" 힌트는 부모의 `soonHintVisible`을 받기만 한다. upcoming 아이콘은 `Pressable disabled`+`accessibilityState.disabled`. 사진·후기는 조회 계약에 필드가 없어 미전달=칸 생략. |
| `ui/SlotStopCard.tsx` | 결과 화면(h07·h08·h11·h14·h16)과 편집기(h12·i07 `EditorView`) 공용 슬롯 카드, `PoiSlotCard`와 **병존**(대체 아님). presentation-only — 옵셔널 prop(`warning`·`onPressTimeChip`·`unspecified`·`locked`·`numberOutside`·`violation`·`dragging`)은 전부 미전달=기존 leaf 그대로. `violation`은 카드가 `slot.hasViolation`을 스스로 읽지 않고 소비처가 문구를 내려준다(자가 판독하면 다른 화면이 조용히 배지를 얻는다). `locked`면 시각 알약 View 자체가 `slot-stopcard-locked-*`이고 `onPressTimeChip`을 무시한다(`editable = onPressTimeChip !== undefined && locked !== true`) — "잠김"과 "누를 수 없음"이 한 요소의 두 성질이라 press 단언까지 걸어야 잡힌다. `dragging`의 실제 강조는 목에서 `isActive`가 항상 false라 6-b 전용. |
| `config/altLabel.ts` | `ALT_LABEL = '다른 후보 ›'`(공백+U+203A) 공용 상수. |
| `ui/SlotPhotoPlaceholder.tsx` | `resolveCategoryPlaceholder` 소비 → 78×78 틴트+아이콘. 텍스트 0(INV-3). |
| `ui/PoiSlotCard.tsx` | peek/list 겸용 POI 카드. |
| `ui/ReplanSlotRow.tsx` | 재계획 초안 행. 번호 원 톤(`tone==='visited'`→`bg-success`)·사진/플레이스홀더·시간 알약·흐림(`opacity-45`, 카드 루트에만)·"다른 후보"(예정 행만). INV-3 가드는 `entitiesItinerarySlotStructure G3`. |

화면 고유 슬롯(`DraftScreen`·`ManualPlanScreen`·`ItineraryEditScreen`·widgets `ManualEditShell`)은 계약이 달라 이 슬라이스로 접지 않는다. execution의 `SlotState`는 서버 enum이 아니라 방문기록 파생 사영이라 이관하지 않는다.

## `src/entities/style-analysis/`

| 파일 | 용도·함정 |
|---|---|
| `lib/styleFace.ts` | "정식 분석인가 임시 미리보기인가" 판정의 단일 소유처. `resolveStyleFace(envelope)` — `official===true && analysis!=null`만 official(BR-U5-40, PBT-U5-F4). `progress.current`는 읽지 않아 자체 승격을 구조적으로 차단한다. 중첩 결측에도 크래시 0·항상 insufficient(개념 [[반쪽 방어 (half-applied guard)]]). 표시 라벨(`categoryLabel`)은 j05 전용이라 `features/reflection/model/styleThreshold.ts`에 남는다. |
| `lib/styleFace.test.ts` | PBT-U5-F4 property + 9↔10 경계 예제 + 반쪽 방어 형태. |
| `lib/styleProgress.ts` | `resolveStyleProgress(envelope)` — `progress`를 **필드 단위**로 폴백(`current ?? 0`, `required ?? 10`). 객체 단위 폴백(`progress ?? {…}`)은 `progress: {}`를 그대로 통과시켜 "현재 undefined곳"을 낸다 — 쓰지 않는다. 소비처가 progress를 직접 읽지 않게 하는 것이 목적. |
| `lib/styleProgress.test.ts` | 값 표(it.each) + property("숫자면 그 값, 아니면 기본값"을 `typeof`로 따로 적어 구현식 복붙 방지). |

`features/settings/model/styleCardModel.ts`의 `\|\| analysis == null`은 판정과 별개인 TS 타입 좁히기용 중복이다(동치 property `styleCardModel.face.test.ts`가 잠금).
