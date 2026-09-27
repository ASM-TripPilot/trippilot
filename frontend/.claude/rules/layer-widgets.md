---
paths:
  - "src/widgets/**"
---
# `src/widgets/` — FSD widgets 층

여러 화면이 쓰는 **화면 조각**(지도+시트 셸 같은 조립 단위)을 두는 층. 담은 곳 FAB 스택(a01·d01·d03)은 소비처가 전부 features 층 화면이라 넣지 않았다 — features→widgets 상향 참조가 된다.

## import 방향
- widgets → entities · shared 만 참조한다. 층 린트는 widgets→features를 막지 않지만, 소스 스캔 `widgetsStructure`(위젯 UI 소스에 `@/features/` 0)·`editorWidgetStructure`(`widgets/map-sheet-shell` 재귀)가 막는다. 그래서 위젯은 features의 판단·글리프를 못 물고 로컬 복제하거나 소비처가 문자열로 넘긴다(`MapSheetGlyphs`·`EditorGlyphs`·`EditorView`의 `dateLabel`).
- pages · app · app-shell 은 참조하지 못한다. `eslint.config.js`의 층 zone이 강제하고 `src/__tests__/importBoundaryLayers.test.ts`가 실측한다.
- ⚠️ **features→widgets 는 상향 참조라 금지**다. 위젯을 쓰는 자리는 **pages/app** — features 화면은 `ReactNode` 슬롯으로 완성된 노드만 받는다(예: `ConceptPickerScreen`의 `stepperSlot`).

## 세그먼트
- `ui` / `model` / `lib` / `config` 넷만(옛 칸 `screens·containers·hooks·store` 부활 금지). `api` 세그먼트는 두지 않는다 — 서버 통신은 `shared/api` 단일 계층.
- 배럴 없음 — 소비처가 deep import한다.

## `src/widgets/map-sheet-shell/` — 지도+3스냅 시트 셸

소비처는 pages 층의 `DraftPage`·`ItineraryPlanPage`·`CoPickCompletePage`·`PlaceAddPage`·`LiveHubView`·`ReplanDraftView`·`ReplanSolvingView`·`StayRecommendView`와 같은 슬라이스의 `EditorView`(→ `ItineraryEditPage`·`ManualPlanPage`). presentation-only가 원칙이고 `useState`는 "판단을 소비처가 못 할 사실"만 쥔다 — 셸 2개(`mapFailed`·`snapIndex`)·`EditorView` 1개(`dragging`)가 `STATE_EXEMPT`에 등재돼 있다([[presentation-only 위젯 — 판단은 소비처로]]).

| 파일 | 역할 |
|---|---|
| `src/widgets/map-sheet-shell/ui/MapSheetShell.tsx` | 전면 지도(`<MapView viewOnly>`)+3스냅 바텀시트(`header`+`children`, `BottomSheetScrollView`)+좌상단 오버레이+하단 CTA 바. `<MapView>` 태그는 이 파일이 소유 — 소비처는 별도 `<MapView>`를 넣지 않는다(census 보호, `itineraryMapSurfaceStructure`의 `LOCKED_CALLERS`). 옵셔널 가산 prop(`overlay`·`cta`·`initialIndex`·`mapFallback`·`mapCard`·`snapPoints`·`mapViewOnly`·`currentLocation`·`radiusCircle`·`list`)은 전부 `??` 널 병합이라 미전달 시 기존 동작. `mapCard`는 지도 위 오버레이 카드 슬롯 — h16 확정 성공 배너가 이 슬롯을 썼으나 TRIP-1047로 그 배너(`ConfirmedBanner.tsx`)가 삭제되면서 지금 유일한 소비처는 i01 `LiveHubView.tsx`의 트리거 알약이다(확정 알림은 이제 이 슬롯이 아니라 `showToast` 1회) — `\|\|`로 바꾸면 `mapViewOnly={false}`가 조용히 `true`로 덮인다(개념 [[후방호환 옵셔널 파라미터 (additive prop)]]). 기본 `SNAP_POINTS=[28,'45%','88%']`, 진입 칸은 `initialIndex ?? (snapPoints ? 0 : 1)`. `sheetClosed`는 배열 **전달 여부**로 판정해 그때만 지도 잠금을 풀고 CTA 바를 숨긴다. `enableDynamicSizing={false}`를 양쪽 배열에 명시해야 한다 — v5 기본 true가 내용 높이 칸을 끼워 index·onChange 번호를 민다(통과형 목은 재현 못 함). 지도 로드 실패 시 `MapFallbackBar`로 대체(우선순위 `mapFallback` > 폴백 바 > `MapView`), 재시도는 `MapView`를 재마운트한다. `list` 슬롯을 주면 시트 몸통이 `BottomSheetFlatList`가 된다 — 스크롤뷰 안에 무한스크롤 `FlatList`를 넣으면 페이징이 죽기 때문. `list` 경로는 `keyboardShouldPersistTaps="handled"` 고정이라 탭 처리부가 `Keyboard.dismiss()`를 직접 불러야 한다. 스크롤 도달·시트 높이는 jest 사각(6-b 전용) |
| `src/widgets/map-sheet-shell/ui/SheetHeader.tsx` | 시트 헤더 — `title`·`dayLabel`·`dateLabel`·`meta` 4문자열 leaf([[RNTL 완전일치 leaf]]). 빈 세그먼트는 걸러 렌더 안 하고 구분자(` · `)는 세그 사이에만 |
| `src/widgets/map-sheet-shell/ui/GenerationProgressCard.tsx` | 부분 결과 상단 진행 카드(`overlay`로 주입) — back + ✦ + 일자별 게이지. **셀은 주입받는다** — 위젯은 `buildGenerationGauge`를 못 물어 판단은 소비처가 한다. 퍼센트·캡션은 그리지 않는다(진행 수치 계약 없음). `title?`·`onCancel?`(있을 때만 `generation-progress-cancel` 렌더)·`cancelDisabled?`는 옵트인 |
| `src/widgets/map-sheet-shell/ui/DistanceConnector.tsx` | 카드 사이 거리 커넥터 — 서버 `distanceRange`를 값이 있으면 **가공 없이** 렌더(INV-3). 값 없음(null·undefined·'')은 문구 칸 자체를 렌더하지 않고 글리프만 남긴다(TRIP-1054, QA #038 — 옛 `이동 거리 계산 중`은 "계산 진행 중"이라는 거짓 신호였다). `약 0.0km`로 시작하는 문자열은 판정 함수 `isZeroDistance`(named export, `startsWith('약 0.0km')`와 동치)가 참이면 `바로 옆`으로 바꿔 보여준다(QA #035, `약 0km`·`약 0m`는 대상 밖 — fake 백엔드의 정수 나눗셈 결과라 최대 900m일 수 있다). 이동수단 글리프 선택은 SVG라 jest 사각 |
| `src/widgets/map-sheet-shell/ui/CtaBar.tsx` | 하단 고정 CTA 바 — 1/2버튼 변형(`buttons`). `disabled?`면 회색 + press가 `onPress`를 안 부른다 |
| `src/widgets/map-sheet-shell/ui/DayChipOverlay.tsx` | 좌상단 back + 일차 칩 오버레이(선택 칩 `accessibilityState.selected`) |
| `src/widgets/map-sheet-shell/ui/MapSheetGlyphs.tsx` | 커넥터 이동수단·Back·✦·✓ 글리프 로컬 복제(widgets→features 금지). raw-hex 스캔 제외 |
| `src/widgets/map-sheet-shell/ui/MapFallbackBar.tsx` | 지도 폴백 바(`map-sheet-fallback`·`-retry`) — 재시도 상태는 셸이 쥐고 이 바는 `onRetry`만 부른다 |
| `src/widgets/map-sheet-shell/ui/EditorView.tsx` | h12 통일 편집기 뷰 — `ItineraryEditPage`(h12·i07 `inTrip`)와 `ManualPlanPage`가 같은 뷰를 쓴다. 셸 조립·드래그 판정만 지고 조회·저장·시트 개폐는 페이지 몫. `DraggableFlatList` data = 활성 일자 슬롯 + **맨 끝 센티널**(드롭존) — 놓은 카드가 센티널 뒤면 `onDeleteViaDrag`, 아니면 `onReorder`. 고정·방문 완료 카드는 끌기로 안 이어지고 판정에서 한 번 더 거른다(스토어 삭제는 고정 여부를 안 본다). ⚠️ **끄는 중에도 카드 사이 "+" 줄은 언마운트하지 않고 투명·누름 불가로 남긴다** — 레이아웃이 바뀌면 끌기 시작 때 잡힌 위치가 어긋나 롱프레스만으로 삭제 판정이 난다(데이터 손실, [[드래그 시작 위치 스냅샷 (레이아웃 불변 전제)]]). 위반 문구는 `entities/itinerary-slot/lib/violationLabel.ts`. 실제 제스처는 6-b 전용(`traps-draglist.md`). **가산 prop `saveLabel?: string`**(기본 `일정 저장하기`, TRIP-1038) — CTA 라벨만 이 값으로 바꾼다. 0곳 비활성 규칙은 불변(소비처가 `loadedDays=[]`로 슬롯을 숨기면 저절로 잠김) |
| `src/widgets/map-sheet-shell/ui/SlotDropZone.tsx` | 드래그 삭제 드롭존(`itinerary-edit-dropzone`) — `isActive`면 `-active` 표식 View(색은 jest 사각이라 표식 존재로 계약) |
| `src/widgets/map-sheet-shell/ui/EditorGlyphs.tsx` | 편집 뷰·드롭존 글리프 로컬 복제(`TrashGlyph`·`PlusGlyph`·`InfoCircleGlyph`). raw-hex 스캔 제외 |

## `src/widgets/time-sheet/` — 공용 시각 조정 시트

소비처는 `testIDPrefix`·`labels`·`title`만 주입한다.

| 파일 | 역할 |
|---|---|
| `src/widgets/time-sheet/ui/TimeSheet.tsx` | 공용 시각 시트 — props는 **`mode`로 가르는 판별 유니온**. 기본 모드: `onApply({startAt,endAt,endsNextDay})`, 시·분 셀-press 피커(`ScrollView`+map), 분 셀은 bare 숫자(INV-3), `<BottomSheet onClose={onCancel}>`로 딤 탭 닫힘도 소비처에 알린다. 열의 `contentOffset`은 `useRef(...).current`로 첫 렌더 값에 고정 — New Arch는 값이 바뀔 때마다 재적용해 셀 탭마다 열이 튄다. `mode:'h04'`: 장소 요약 행 + 시작/종료 세그(`shared/ui/SegmentedControl`) + 12시간 휠(`shared/ui/WheelPicker`) + 단일 '적용', `onApply`가 종료 미설정 갈래(`endAt:null`, `endsNextDay` 키 없음)를 가질 수 있다. `endsNextDay` 유도는 `entities/itinerary-slot/lib/endsNextDay.ts`의 `deriveEndsNextDay`만 쓴다 — `TimeSheet.h04.source.test.ts`가 `<=` 개수로 재구현을 막는다. h04 시트에는 `enablePanDownToClose`·`enableContentPanningGesture={false}`(휠 스크롤이 시트 끌기로 새지 않게) — jest 통과형 목의 사각이라 6-b 전용. 선택 셀 `useState`는 `widgetsStructure` 예외 |

## `src/widgets/generation-done-bar/` — 완료 도킹 배너

| 파일 | 역할 |
|---|---|
| `src/widgets/generation-done-bar/ui/GenerationDoneBar.tsx` | `{tripName, onPressView}` — 체크 + `{tripName} 일정이 완성됐어요`(완전일치) + `보기`. border만·그림자 없음(Figma 우선). presentation-only — 표시 판정은 소비처 `MyTripsListPage`(last-seen은 `shared/storage/idSet.ts`). docstring의 "소비처는 프리뷰뿐"은 낡았다 |
| `src/widgets/generation-done-bar/ui/GenerationDoneBarGlyphs.tsx` | `DoneCheckGlyph` 로컬 복제(widgets→features 금지) |

## `src/widgets/copick-stepper/` — 공용 3단 스텝퍼(h09·h10)

**prop 계약이 소비 화면 둘을 구속한다**(개념 [[공용 위젯 prop 계약]]).

| 파일 | 역할 |
|---|---|
| `src/widgets/copick-stepper/ui/CoPickStepper.tsx` | `{prev?, current, next?}`(각 `{title, status, iconKey?, done?}`) — 3열, 현재만 `text-primary`. presentation-only. `iconKey`는 미배선(항상 `StepperSunGlyph`). **INV-3 그물은 이 파일의 렌더 단언뿐**(위젯 층은 소스 스캔 모집단 밖, [[가드의 사정거리]]) |
| `src/widgets/copick-stepper/ui/CoPickStepperGlyphs.tsx` | `StepperSunGlyph`·`StepperCheckBadge` 로컬 복제. raw-hex 스캔 제외 |
