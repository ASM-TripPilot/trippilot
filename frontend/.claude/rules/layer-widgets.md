---
paths:
  - "src/widgets/**"
---
# `src/widgets/` — FSD widgets 층 (TRIP-804 규칙 신설 → TRIP-805 첫 입주)

여러 화면이 쓰는 **화면 조각**(지도+시트 셸 같은 조립 단위)을 두는 층. **TRIP-805가 첫 입주** — `itinerary-edit`(shared→widgets 승격 이동)·`time-sheet`(쌍둥이 시각 시트 통일 신규) 두 슬라이스. **TRIP-788이 세 번째 슬라이스 `generation-done-bar`를 신설**(prop-driven 완료 도킹 배너, 아래 절). 담은 곳 FAB 스택(a01·d01·d03 3벌)은 **이번에 넣지 않았다** — 소비처가 전부 features 층 화면이라 features→widgets 상향 참조가 되어 층 린트와 충돌(실측 `eslint-disable` 3곳으로만 통과). page/route 층에서 형제로 렌더하는 배치로 후속 티켓(정합 티켓 TRIP-695·703·708·725와 함께).

## import 방향
- widgets → features · entities · shared 만 참조한다.
- pages · app · app-shell 은 참조하지 못한다(하위 층은 상위 층을 모른다).
- `eslint.config.js`의 층 zone이 강제하고, `src/__tests__/importBoundaryLayers.test.ts`가 widgets→pages 차단·pages→widgets 허용을 실측한다.
- ⚠️ **features→widgets 는 상향 참조라 금지**다(`importBoundaryLayers`가 실대상으로 실측). 위젯을 쓰는 자리는 **pages/app** — features 화면 안에서 위젯을 직접 렌더하려는 순간 이 경계에 걸린다(TRIP-805에서 담은 곳 FAB 추출이 이 이유로 빠짐).

## 세그먼트
- `ui` / `model` / `lib` / `config` 넷만(옛 칸 `screens·containers·hooks·store` 부활 금지). `api` 세그먼트는 두지 않는다 — 서버 통신은 `shared/api` 단일 계층.

## `src/widgets/map-sheet-shell/` — 지도+3스냅 시트 셸 (TRIP-783 신규, TRIP-920으로 2스냅→3스냅)

결과 화면 6종(h07·h08·h11·h14·h16)이 공유할 부품. **h07 partial(TRIP-790)·h08 default(TRIP-792, narrow 라우팅) 두 화면이 실제 조립**했다 — 나머지(h11·h14·h16)는 후속 티켓(799 등). **TRIP-920부터 `useState` 2개**(TRIP-919 `mapFailed` + TRIP-920 `snapIndex`, `STATE_EXEMPT`에 `{ rel: 'MapSheetShell.tsx', count: 2 }`로 등재) — presentation-only 예외는 상태 개수 자체가 아니라 "판단을 소비처가 못 할 사실만 최소로 쥔다"는 원칙 쪽([[presentation-only 위젯 — 판단은 소비처로]] 참고).

| 파일 | 역할 |
|---|---|
| `src/widgets/map-sheet-shell/ui/MapSheetShell.tsx` | 전면 지도(`<MapView viewOnly>`, 시트 뒤 형제)+2스냅 바텀시트(`header`+`children`)+좌상단 오버레이+하단 CTA 바를 4층으로 배치. 시트 콘텐츠는 `BottomSheetScrollView`로 **`BottomSheetScrollView`로 경고-1 해소됨(TRIP-790)** — 다중 슬롯 소비 시 하단 카드가 CTA 바 뒤로 가려 도달 불가하던 문제를 스크롤화로 고쳤다(단 `@gorhom/bottom-sheet` 목이 통과형이라 실제 스크롤 도달·기존 h08 `flex-1` 유지 여부는 jest 사각, 6-b 실기 전용 — 03b 참고-1). `overlay?`(ReactNode, 주면 `DayChipOverlay` 대체 — TRIP-790 D3)·`cta?`(CtaButton[], 미전달·빈 배열이면 CTA 바 자체 미렌더 — TRIP-790 D9, PARTIAL처럼 확정 CTA가 없는 얼굴용)·**`initialIndex?: number`(기본 0, `<BottomSheet index={initialIndex ?? 0}>` — TRIP-792, 펼침 프리뷰 `h08-draft-expanded`만 1 전달)**·**`mapFallback?: ReactNode`(TRIP-799 — 주면 지도 스트립 자리를 `mapFallback ?? <MapView…/>`로 대체, day-chip·시트·CTA는 유지)** 전부 옵셔널 가산이라 기존 소비처는 무변경 시 그대로 동작(회귀 앵커: `MapSheetShell.test.tsx` SH5a=미전달 시 0, SH6a/b=`mapFallback`). **`mapFallback`은 현재 프리뷰만 강제 주입한다** — 페이지가 실 지도 실패(`MapView.onLoadFailed`)를 감지해 주입하는 배선은 없음(`MapSheetShell`에 forward prop 부재, 후속 티켓 후보). `<MapView>` 태그는 이 파일이 소유 — 소비처(preview 포함)는 별도 `<MapView>`를 넣지 않는다(census S2 카운트 보호). **`mapCard?: ReactNode`(TRIP-801 D3 가산)** — 주면 day-chip 오버레이 **아래에 추가로**(교체 아닌 추가, `overlay?`와 다른 결) 렌더. 미전달=미렌더(후방호환). h16 확정 성공 배너(`ConfirmedBanner`, pages)가 이 슬롯의 첫 소비처. **[TRIP-746 가산 3종]** `snapPoints?: (string\|number)[]`(기본 `SNAP_POINTS` 옛 2스냅 유지)·`viewOnly={mapViewOnly ?? true}`(기본 잠금 유지, i01 허브만 `false`로 열어 자유 탐색 — S2b census, `layer-test.md` 참고)·`currentLocation?`(그대로 forward). 전부 `??` 널 병합이라 기존 6개 소비처는 무변경(회귀 앵커 SH9a·SH10a·SH11a) — `??`가 `\|\|`였다면 `mapViewOnly={false}`가 기본값 `true`로 덮여 허브 지도가 조용히 잠겼을 것(개념 [[후방호환 옵셔널 파라미터 (additive prop)]]). **[TRIP-920 가산]** 기본 배열이 `SNAP_POINTS=[28,'45%','88%']`(2스냅 `[45%,88%]`에서 확장, 진입 기본 `DEFAULT_INDEX=1`)로 늘고, `BottomSheet onChange={setSnapIndex}`로 현재 칸을 셸 `useState`(2개째)에 쥔다. `sheetClosed = snapPoints === undefined && snapIndex === 0`(배열 **전달 여부**로 판정 — "0번 칸 값이 28"이 아님, 03b 참고-1)일 때만 `mapLocked`를 풀고 CTA 바를 미렌더(둘 다 태그 밖 이름 붙인 상수로 계산 — census 정규식 절단 회피, ★10). `enableDynamicSizing={false}`를 기본 배열·직접 전달 배열 양쪽에 명시(TRIP-920 5-b 후속) — `@gorhom/bottom-sheet` v5는 기본 true라 시트 내용 높이 칸을 몰래 끼워 index·onChange 번호가 밀린다(통과형 목은 이 재정렬을 재현하지 않는다, 03b 경고-1). |
| `src/widgets/map-sheet-shell/ui/SheetHeader.tsx` | 시트 헤더 — `title`·`dayLabel`·`dateLabel`·`meta` 4문자열 leaf(완전일치 계약, [[RNTL 완전일치 leaf]]). pre-composed 문자열만 받는 presentation-only. 빈 세그먼트는 `filter`로 걸러 렌더 안 하고 구분자(` · `)는 세그 사이에만 넣는다(D5, TRIP-790 신설 — 현재 유일 소비처 h07은 `title`에 날짜까지 합쳐 실사용하지 않음, 후속 소비자용 가산 기능) |
| `src/widgets/map-sheet-shell/ui/GenerationProgressCard.tsx` | h07 부분 결과 전용 상단 진행 카드(TRIP-790 신규, `DayChipOverlay` 자리에 `overlay`로 주입) — 좌 원형 back + ✦ AI 표식 + 4셀까지 일자별 진행 게이지(done/active/waiting 3톤 트랙 + 한글 라벨). **셀은 주입받는다**(`GenerationProgressCell[] = {status,label}[]`) — widgets는 `features`의 `buildGenerationGauge`를 못 물어 스스로 게이지를 도출하지 못하므로([[presentation-only 위젯 — 판단은 소비처로]]) 판단은 소비처(DraftPage)가 하고 이 위젯은 결과만 그린다. 퍼센트·캡션은 그리지 않는다(계약 — `generationState`는 3값 열거뿐이라 진행 수치가 없음, Figma 67% 무시). `MapSheetGlyphs.FullAiGlyph`·`CheckGlyph` 소비. **TRIP-752 가산 3종(전부 옵트인, `?`+기본값·조건부 렌더 — 기존 소비처 h07 무변경)**: `title?`(기본값 매개변수, 안 주면 옛 게이지 문구) · `onCancel?`(있을 때만 제목 행 오른쪽에 `취소` `Pressable` 렌더, testID `generation-progress-cancel`) · `cancelDisabled?: boolean`(그 `Pressable`의 `disabled`에 연결 — 대기 중 연타 방지, i05 `PlanbSolvingPage`가 `cancel.isPending`으로 넘김) |
| `src/widgets/map-sheet-shell/ui/DistanceConnector.tsx` | 카드 사이 거리 커넥터 — 서버 `distanceRange`를 **가공 없이(verbatim)** 렌더, null이면 `이동 거리 계산 중`(INV-3 — 소요시간 0). 이동수단 글리프(🚗/🚶)는 `distanceRange.includes('차량')`로 선택하나 SVG라 jest 사각(6-b 육안 전용) |
| `src/widgets/map-sheet-shell/ui/CtaBar.tsx` | 하단 고정 CTA 바 — 1/2버튼 변형을 `buttons` prop으로. **`disabled?: boolean`(TRIP-799 가산)** — 주면 `Pressable disabled` + primary 채움을 `bg-hairline-strong`(회색)으로, press가 `onPress`를 안 부른다(CTA3). 미전달=기존 활성 동작 |
| `src/widgets/map-sheet-shell/ui/DayChipOverlay.tsx` | 좌상단 back + 일차 칩 오버레이(선택 칩 `accessibilityState.selected`) |
| `src/widgets/map-sheet-shell/ui/MapSheetGlyphs.tsx` | 커넥터 이동수단(Car/Walk)+Back 글리프 **로컬 복제**(★5 — widgets→`@/features` import 금지라 `ItineraryGlyphs`를 못 가져다 씀). TRIP-790이 `FullAiGlyph`(✦)·`CheckGlyph`(✓)를 같은 이유로 추가 복제(features `ItineraryGlyphs`의 바이트 복제 — GenerationProgressCard 소비). raw-hex 스캔 제외(`*Glyphs.tsx` 관례) |

**`list?: MapSheetListSlot<T>`(TRIP-798 묶음 C 가산)** — 시트 body를 `BottomSheetScrollView` 대신 `BottomSheetFlatList`로 그리는 옵셔널 슬롯(`{data, renderItem, keyExtractor, onEndReached, onEndReachedThreshold?, ListFooterComponent?, testID?}`). `header`·`children`은 이때 `ListHeaderComponent` 한 자리에만 들어간다(이중 렌더 구조적 불가). 미전달=현행 `BottomSheetScrollView`(6 소비처 h07·h08·h11·h14·h16 무변경 후방호환). 신설 이유: `BottomSheetScrollView` 안에 무한스크롤 `FlatList`(h13 P4, `onEndReached`)를 넣으면 VirtualizedList-in-ScrollView 충돌로 페이징이 죽는다 — 위젯에 리스트 슬롯을 뚫어 리스트 자체가 시트 몸통이 되게 해서 푼다. `__mocks__/@gorhom/bottom-sheet.tsx`에 `BottomSheetFlatList`(=RN `FlatList` 재수출) 선행 신설이 전제(먼저 없으면 import 크래시). 첫 실배선 소비처는 `PlaceAddPage.tsx`(h13). 상세는 [[지도+시트 셸 — 2스냅 바텀시트 위의 전면 지도]] 참고.

지도 census 등재: `itineraryMapSurfaceStructure.test.ts`의 `LOCKED_CALLERS`에 `MapSheetShell.tsx` 등재 + S8 태그 카운트 12→13([[지도+시트 셸 — 2스냅 바텀시트 위의 전면 지도]] 참고).

## `src/widgets/itinerary-edit/` — 삭제됨 (TRIP-753, 2026-09-23)

TRIP-443 shared 신설 → TRIP-805 shared→widgets 승격 이동을 거친 이 슬라이스 전체(`ManualEditShell.tsx`·`ManualEditGlyphs.tsx`·`mergeValidationFlags.ts`·`reorderKeepingFixed.ts`·배럴)가 **TRIP-753으로 `git rm`됐다**. 유일 소비처였던 `pages/planb-manual`도 같은 사이클에서 함께 삭제됐고, i07 일정 편집은 이제 `pages/itinerary-edit`(h12)의 `ItineraryEditPage`를 `inTrip` 플래그로 재사용한다(`layer-pages.md` `itinerary-edit` 행). 대체 규칙: 재정렬은 `features/planb/model/reorderKeepingLocked.ts`(신규, 잠금 목록을 함께 보는 "이름 다른 사촌" 함수), 시각 시트는 공용 `widgets/time-sheet/ui/TimeSheet.tsx`. `mergeValidationFlags`(US-PLANB-11 방어 머지, 프로덕션 호출자 0이었음)는 git 이력에서만 복원 가능 — 복구 트리거 배선 시 이 사이클(`38b4042b`) 직전을 참조. 참조하면 깨진다.

## `src/widgets/time-sheet/` — 공용 시각 조정 시트 (TRIP-805 신규, 쌍둥이 통일)

h24 `SlotTimeSheet`·i15/i22 `ManualTimeSheet`는 props 계약이 완전 동일한 쌍둥이(testID 접두·한글 라벨·제목만 달랐다)라 하나로 접었다. 소비처는 `testIDPrefix`·`labels`·`title`만 주입한다.

| 파일 | 역할 |
|---|---|
| `src/widgets/time-sheet/ui/TimeSheet.tsx` | 공용 시각 시트. props `{startAt, endAt, onApply({startAt,endAt,endsNextDay}), onCancel, testIDPrefix, labels:{start,end}, title?, mode?:'h04', placeSummary?:TimeSheetPlaceSummary}`(뒤 둘은 TRIP-787 신규, 둘 다 옵셔널). `mode` 미전달(default) 시 시·분 값별 셀-press 피커(휠 라이브러리 부재, `ScrollView`+map 으로 전 값 트리 실재). `endsNextDay=end<=start` 기계 유도(INV-2 판정 아님, h04도 이 헬퍼를 그대로 재사용 — 재구현 금지 소스가드 `TimeSheet.h04.source.test.ts`). 분 셀 bare 숫자(INV-3, "30" — "30분" 금지). **선택 셀 `useState` 유지**(`widgetsStructure` F의 useState-0 규약 예외, D8). 소비(default): `ItineraryEditPage`(h12·i07 공용, i07은 TRIP-753으로 옛 `PlanbManualPage`의 전용 시트 문구(도착/출발·'시각 입력')를 잃고 이 접두·라벨로 흡수됨)·`PlaceAddPage`(접두 `itinerary-edit-time`, 라벨 시작/종료, 제목 기본값 '시각 조정'). ★ 실개폐·2스냅은 `@gorhom/bottom-sheet` 통과형 목이 못 봄(6-b 실기 전용) |
| ↳ **`mode='h04'` 변형**(TRIP-787, opt-in — 위 소비처는 `mode` 미전달이라 무변) | 장소 요약 행(`placeSummary`: `imageUrl`·`name`·`badgeLabel`·`region`)·시작/종료 2탭 세그(`@/shared/ui/SegmentedControl` 재사용)·3열 12시간 휠(`@/shared/ui/WheelPicker` 3벌 재사용, `decompose12`/`compose24`로 24h 상태와 표시만 변환)·단일 '적용' CTA(취소 없음)를 그린다. 프리뷰 키 `h04-time-adjust-sheet`(구 `itinerary-edit-time-sheet`)만 소비 — **프로덕션 배선 없음**(프리뷰 전용, region 데이터 출처는 슬롯 계약에 없어 프리뷰 픽스처로만 무해, 후속 티켓 후보). 휠 중앙 텍스트 15px 분홍(WheelPicker 기본) vs Figma 22px 검정은 재사용이 부르는 수용된 드리프트(6-b 육안 대상, 별 티켓 후보) |

## `src/widgets/generation-done-bar/` — 완료 도킹 배너 (TRIP-788 신규)

BottomTab 위에 뜨는 "여행 일정이 완성됐어요" 흰 카드. Figma 원본 이름 "알림 바 · 성공 (v2 이식)" — 재사용 가능한 공용 알림바(Toast·Snackbar류)처럼 보이나 리포에 그런 이름의 컴포넌트가 없어(`shared/ui`·`widgets` 전수 grep 0건) 신설.

| 파일 | 역할 |
|---|---|
| `src/widgets/generation-done-bar/ui/GenerationDoneBar.tsx` | `GenerationDoneBarProps = {tripName: string, onPressView: () => void}` — 체크 글리프(`generation-done-bar-check`) + `{tripName} 일정이 완성됐어요`(`generation-done-bar-text`, 완전일치) + `보기` Pressable(`generation-done-bar-view`, press→`onPressView` 1회). border만(#ededed)·**그림자 없음**(Figma 실측 — 티켓 "그림자"는 어긋남, Figma 우선). presentation-only(useState 0, `widgetsStructure` F 규약 그대로 통과). **표시 조건(어떤 여행이 "갓 완성"인가 = last-seen 영속 로직)은 이번 범위 밖** — prop-driven+프리뷰 픽스처(`h05-my-trips-done-bar`)로만 격리, 실배선은 후속 티켓. |
| `src/widgets/generation-done-bar/ui/GenerationDoneBarGlyphs.tsx` | `DoneCheckGlyph`(체크, success `#0E9384`, 원 없음) — widgets→features import 금지라 `ItineraryGlyphs`의 체크를 못 써 로컬 복제(`ManualEditGlyphs.tsx` 선례와 동형 raw-hex 격리 관례). |
| 배럴 없음 | `preview.tsx`가 deep import로 직접 소비(가장 최근 widget 슬라이스 2개의 선례를 따름 — 소비처가 늘면 배럴 추가는 trivial, ponytail lite 대안·03 §트레이드오프). |

## `src/widgets/copick-stepper/` — 공용 3단 스텝퍼 (TRIP-794 신규, h09·h10 공유 계약)

h09(같이 고르기 컨셉 화면)·h10(TRIP-795, 미착수) 공유 3단 위저드 스텝퍼. **prop 계약이 h10을 구속한다**(개념 [[공용 위젯 prop 계약]]).

| 파일 | 역할 |
|---|---|
| `src/widgets/copick-stepper/ui/CoPickStepper.tsx` | `CoPickStepperProps = {prev?, current, next?}`(각 `CoPickStep = {title, status, iconKey?, done?}`, current만 필수) — 이전·현재·다음 3열, 현재만 `text-primary`. presentation-only(useState 0, `widgetsStructure` F 규약 통과). **`iconKey`는 인터페이스에 있으나 미배선**(모든 슬롯이 상태 무관 `StepperSunGlyph` 고정 — 795가 실제로 쓸 때 채워질 죽은 필드, 03b 참고-1). **INV-3 유일 그물이 이 파일의 렌더 단언(T5)뿐**(위젯 층은 소스 스캔 모집단 밖 — 개념 [[가드의 사정거리]] 실측 17) |
| `src/widgets/copick-stepper/ui/CoPickStepperGlyphs.tsx` | `StepperSunGlyph`·`StepperCheckBadge` 로컬 복제(widgets→features import 금지, `MapSheetGlyphs`·`ManualEditGlyphs`·`GenerationDoneBarGlyphs` 선례와 동형 — 개념 [[FSD 층 경계]] "글리프 재작도" 절). raw-hex 스캔 제외(`*Glyphs.tsx` 관례) |
| 배럴 없음 | 소비처(`pages/itinerary-copick/ui/SlotFillPage.tsx`)가 deep import(기존 widget 슬라이스 선례 계승). `features/itinerary/ui/ConceptPickerScreen.tsx`(features→widgets 상향 참조 금지)는 이 위젯을 모른다 — `stepperSlot?: ReactNode` 슬롯으로 완성된 노드만 받는다. |
