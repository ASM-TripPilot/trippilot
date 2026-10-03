---
paths:
  - "src/widgets/**"
---
# `src/widgets/` — FSD widgets 층

여러 화면이 쓰는 **화면 조각**(지도+시트 셸 같은 조립 단위)을 두는 층. 담은 곳 FAB 스택(a01·d01·d03)은 소비처가 전부 features 층 화면이라 넣지 않았다 — features→widgets 상향 참조가 된다. **소비처가 한 page뿐인 부품은 위젯이 아니라 그 page 안에 둔다**(공식 FSD — TRIP-1143으로 `CoPickStepper`·`GenerationDoneBar`가 `pages/itinerary/itinerary-copick`·`pages/itinerary/itinerary-list`로 들어갔다). 지금 이 층은 `map-sheet-shell`·`time-sheet` 둘뿐이다.

## import 방향
- widgets → entities · shared 만 참조한다. 층 린트는 widgets→features를 막지 않는다(그것을 막던 소스 스캔은 TRIP-1145에서 지웠다 — 기계 강제 없음). 그래서 위젯은 features의 판단·글리프를 못 물고 로컬 복제하거나 소비처가 문자열로 넘긴다(`MapSheetGlyphs`·`EditorGlyphs`·`EditorView`의 `dateLabel`).
- pages · app · app-shell 은 참조하지 못한다. `eslint.config.js`의 층 zone이 강제하고 `src/__tests__/importBoundaryLayers.test.ts`가 실측한다.
- ⚠️ **features→widgets 는 상향 참조라 금지**다. 위젯을 쓰는 자리는 **pages/app** — features 화면은 `ReactNode` 슬롯으로 완성된 노드만 받는다.

## 세그먼트
- `ui` / `model` / `lib` / `config` 넷만(옛 칸 `screens·containers·hooks·store` 부활 금지). `api` 세그먼트는 두지 않는다 — 서버 통신은 `shared/api` 단일 계층.
- 공개 API는 슬라이스 루트 `index.ts`다 — 소비처는 그것으로만 import한다(딥 경로는 lint error, TRIP-1157).

## `src/widgets/map-sheet-shell/` — 지도+3스냅 시트 셸

소비처는 pages 층의 `DraftPage`·`ItineraryPlanPage`·`CoPickCompletePage`·`PlaceAddPage`·`LiveHubView`·`ReplanDraftView`·`ReplanSolvingView`·`StayRecommendView`와 같은 슬라이스의 `EditorView`(→ `ItineraryEditPage`·`ManualPlanPage`). presentation-only가 원칙이고 `useState`는 "판단을 소비처가 못 할 사실"만 쥔다 — 셸 2개(`mapFailed`·`snapIndex`)·`EditorView` 1개(`dragging`)가 `STATE_EXEMPT`에 등재돼 있다([[presentation-only 위젯 — 판단은 소비처로]]).

| 파일 | 역할 |
|---|---|
| `src/widgets/map-sheet-shell/ui/MapSheetShell.tsx` | 전면 지도(`<MapView viewOnly>`)+3스냅 바텀시트(`header`+`children`, `BottomSheetScrollView`)+좌상단 오버레이+하단 CTA 바. `<MapView>` 태그는 이 파일이 소유 — 소비처는 별도 `<MapView>`를 넣지 않는다(기계 강제 없음 — 지도 호출부 명부 스캔은 TRIP-1145에서 삭제). 옵셔널 가산 prop(`overlay`·`cta`·`initialIndex`·`mapFallback`·`mapCard`·`snapPoints`·`mapViewOnly`·`currentLocation`·`radiusCircle`·`list`·**`fitPins?: boolean`(TRIP-1076)**·**`animatedPosition?: SharedValue<number>`(TRIP-1083)**)은 전부 `??` 널 병합이라 미전달 시 기존 동작. `animatedPosition`은 `<BottomSheet animatedPosition>`으로 **통과만** 한다 — gorhom이 매 프레임 시트 윗변 y를 그 상자에 써 넣고(**`topInset`이 이미 더해진 셸 루트 기준 값**이라 소비처가 `safeTop`을 또 더하면 이중 계산), 소비처(현재 `LiveHubView`만)가 `useSharedValue`로 상자를 만들어 넘겨 시트를 따라가는 버튼을 `useAnimatedStyle`로 그린다. 시트에 붙어 움직이는 요소가 필요한 다른 화면은 셸을 고치지 말고 이 prop만 쓴다. 심판은 `MapSheetShell.animatedPosition.test.tsx`(통과·미전달 무회귀 2케이스 — 목이 `...props`를 host View에 펼쳐 `snapPoints` 가진 노드의 prop으로 상자를 꺼낸다). `fitPins`는 그대로 소유 `<MapView fitPins={fitPins}>`에 흘려보낼 뿐(핀 2개 이상→region, 미만→camera 택일은 `MapView` 소관, TRIP-1022) — 현재 소비처는 `DraftPage`(셸 2곳)·`CoPickCompletePage`·`ItineraryPlanPage`뿐이고 `StayRecommendView`(h15)·`LiveHubView`(i01)는 아직 켜지 않았다. ⚠️ 셸은 풀블리드 지도 위에 시트가 아래 최대 88%를 덮으므로, `fitPins`가 만드는 `region`은 화면 전체 기준이라 시트가 넓게 열려 있으면 아래쪽 핀이 시트 뒤로 들어갈 수 있다(인셋 미반영, TRIP-1076 03 구현노트) — jest 가짜 지도는 `onLayout` 재맞춤을 안 불러 이 사각을 못 잡는다(`traps-map.md`의 region 임시 프레임 함정과 같은 축). `mapCard`는 지도 위 오버레이 카드 슬롯 — h16 확정 성공 배너가 이 슬롯을 썼으나 TRIP-1047로 그 배너(`ConfirmedBanner.tsx`)가 삭제되면서 지금 유일한 소비처는 i01 `LiveHubView.tsx`의 트리거 알약이다(확정 알림은 이제 이 슬롯이 아니라 `showToast` 1회) — `\|\|`로 바꾸면 `mapViewOnly={false}`가 조용히 `true`로 덮인다(개념 [[후방호환 옵셔널 파라미터 (additive prop)]]). 기본 `SNAP_POINTS=[28,'45%','88%']`, 진입 칸은 `initialIndex ?? (snapPoints ? 0 : 1)`. `sheetClosed`는 배열 **전달 여부**로 판정해 그때만 지도 잠금을 풀고 CTA 바를 숨긴다. `enableDynamicSizing={false}`를 양쪽 배열에 명시해야 한다 — v5 기본 true가 내용 높이 칸을 끼워 index·onChange 번호를 민다(통과형 목은 재현 못 함). 지도 로드 실패 시 `MapFallbackBar`로 대체(우선순위 `mapFallback` > 폴백 바 > `MapView`), 재시도는 `MapView`를 재마운트한다. `list` 슬롯을 주면 시트 몸통이 `BottomSheetFlatList`가 된다 — 스크롤뷰 안에 무한스크롤 `FlatList`를 넣으면 페이징이 죽기 때문. `list` 경로는 `keyboardShouldPersistTaps="handled"` 고정이라 탭 처리부가 `Keyboard.dismiss()`를 직접 불러야 한다. 스크롤 도달·시트 높이는 jest 사각(6-b 전용) |
| `src/widgets/map-sheet-shell/ui/SheetHeader.tsx` | 시트 헤더 — `title`·`dayLabel`·`dateLabel`·`meta` 4문자열 leaf([[RNTL 완전일치 leaf]]). 빈 세그먼트는 걸러 렌더 안 하고 구분자(` · `)는 세그 사이에만 |
| `src/widgets/map-sheet-shell/ui/GenerationProgressCard.tsx` | 부분 결과 상단 진행 카드(`overlay`로 주입) — back + ✦ + 일자별 게이지. **셀은 주입받는다** — 위젯은 `buildGenerationGauge`도 `foldGenerationGauge`도 못 물어 상한·접기 판단은 전부 소비처가 한다(위젯은 받은 칸 수·순서를 그대로 그리기만). 셀 타입은 유니온(TRIP-1040): `{status:'done'|'active'|'waiting'; label}` \| `{status:'more'}` — `'more'` 갈래는 label 필드가 아예 없어 리터럴에 타입을 직접 적은 자리(GP11)에서만 초과 속성 검사가 걸린다(`.map` 콜백 반환에는 안 걸린다 — 참고-1, 화면 영향 없음: 이 분기가 `cell.label`을 안 읽고 I-5d가 `…` 완전 일치로 잠근다). 접기 칸은 트랙 없이 `text-muted` 톤의 `…` 한 글자, `justify-end`로 라벨 줄 쪽에 붙임(세로 위치는 Figma 미확정 — 6-b 몫). 라벨은 `numberOfLines={1}`+`ellipsizeMode="tail"`+`shrink`(글자)+`min-w-0`(행 조상) — RN 가로 행 안 Text는 기본 flexShrink 0이라 `shrink` 없이는 칸이 좁아져도 말줄임이 안 생긴다. 퍼센트·캡션은 그리지 않는다(진행 수치 계약 없음). `title?`·`onCancel?`(있을 때만 `generation-progress-cancel` 렌더)·`cancelDisabled?`는 옵트인 |
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
| `src/widgets/time-sheet/ui/TimeSheet.tsx` | 공용 시각 시트 — 모든 소비처가 **한 입력**을 쓴다(TRIP-1196): 시작/종료 세그(`shared/ui/SegmentedControl`) + readout + 12시간 휠 3열(`shared/ui/WheelPicker`) + 단일 '적용'(취소 버튼 없음). 소비처 차이는 `title`(기본 '시각 조정', 편집기만 '시간대 조정')과 `placeSummary`(편집기만 장소 요약 행)뿐. `onApply({startAt,endAt,endsNextDay})` — 종료를 안 건드리면 `endAt`은 현재 값 유지(null 없음)·`endsNextDay`만 재유도. 분은 bare 숫자(INV-3), `endsNextDay` 유도는 `entities/itinerary-slot/lib/endsNextDay.ts`의 `deriveEndsNextDay`만 쓴다 — `TimeSheet.source.test.ts`가 `<=` 개수로 재구현을 막는다. `enablePanDownToClose`·`enableContentPanningGesture={false}`(휠 스크롤이 시트 끌기로 새지 않게)·`onClose={onCancel}` — jest 통과형 목의 사각이라 6-b 전용(prop 값만 `TimeSheet.test.tsx` D1 이 잠금) |
