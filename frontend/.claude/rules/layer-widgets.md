---
paths:
  - "src/widgets/**"
---
# `src/widgets/` — FSD widgets 층 (TRIP-804 규칙 신설 → TRIP-805 첫 입주)

여러 화면이 쓰는 **화면 조각**(지도+시트 셸 같은 조립 단위)을 두는 층. **TRIP-805가 첫 입주** — `itinerary-edit`(shared→widgets 승격 이동)·`time-sheet`(쌍둥이 시각 시트 통일 신규) 두 슬라이스. 담은 곳 FAB 스택(a01·d01·d03 3벌)은 **이번에 넣지 않았다** — 소비처가 전부 features 층 화면이라 features→widgets 상향 참조가 되어 층 린트와 충돌(실측 `eslint-disable` 3곳으로만 통과). page/route 층에서 형제로 렌더하는 배치로 후속 티켓(정합 티켓 TRIP-695·703·708·725와 함께).

## import 방향
- widgets → features · entities · shared 만 참조한다.
- pages · app · app-shell 은 참조하지 못한다(하위 층은 상위 층을 모른다).
- `eslint.config.js`의 층 zone이 강제하고, `src/__tests__/importBoundaryLayers.test.ts`가 widgets→pages 차단·pages→widgets 허용을 실측한다.
- ⚠️ **features→widgets 는 상향 참조라 금지**다(`importBoundaryLayers`가 실대상으로 실측). 위젯을 쓰는 자리는 **pages/app** — features 화면 안에서 위젯을 직접 렌더하려는 순간 이 경계에 걸린다(TRIP-805에서 담은 곳 FAB 추출이 이 이유로 빠짐).

## 세그먼트
- `ui` / `model` / `lib` / `config` 넷만(옛 칸 `screens·containers·hooks·store` 부활 금지). `api` 세그먼트는 두지 않는다 — 서버 통신은 `shared/api` 단일 계층.

## 셸·커넥터·시트 헤더 — 예정
- 전면 지도+2스냅 바텀시트 **셸**·시트 헤더·슬롯 거리 **커넥터**는 리포에 아직 없다(2스냅 조합 0건). **TRIP-783 착수 시** 그 부품들을 이 `widgets/` 층에 둔다(소비 화면 h 결과 6종·i 허브가 함께 착수돼야 완료 조건 "소비 화면 전부 import"가 채워진다). 이번 사이클은 스캐폴딩하지 않는다(소비자 0 + 2스냅 거동이 jest 사각이라 투기적, YAGNI).

## `src/widgets/itinerary-edit/` — 공용 일정 편집 셸 (TRIP-443 shared 신설 → TRIP-805로 shared→widgets 승격 이동)

`features/itinerary`(U3)에 편집 기계(스톱카드·드래그·잠금·위반 배지·저장 조립)가 통째로 있으나 **features 간 직접 import 금지**라 `features/planb`가 그대로 못 쓴다. 그래서 편집 셸·순수 로직만 승격해 신설했고(원래 `shared/itinerary-edit`), TRIP-803 "shared 에 도메인 컴포넌트 0" 원칙에 따라 **TRIP-805가 `widgets/itinerary-edit`로 옮겼다**(배럴 유지, 소비는 `pages/planb-manual`이 진다 — page→widgets 는 허용 방향). `ManualTimeSheet`은 TRIP-805로 공용 `widgets/time-sheet/ui/TimeSheet.tsx`에 흡수·삭제됐다.

| 파일 | 역할 |
|---|---|
| `src/widgets/itinerary-edit/model/mergeValidationFlags.ts` | 순수 방어 머지 `mergeValidationFlags(localDays, serverDays)` — `(date,poiId)` Map 룩업으로 서버 재검증의 `hasViolation`/`violationReason`**만** 취하고 편집 본문은 로컬 유지(BR-U4-45). 현재 프로덕션 호출자 0(복구 트리거 배선은 후속, Q4 정본 공백) |
| `src/widgets/itinerary-edit/model/reorderKeepingFixed.ts` | 순수 재정렬 `reorderKeepingFixed(original, reordered)` — 비고정만 `reordered` 순서로 채우고 고정 슬롯은 원래 절대 인덱스에 재고정. `PlanbManualPage.handleReorder`가 소비(TRIP-577). ⚠️ 재고정 판정이 `slot.isFixed`만 봐 `lockedSlotKeys`만 잠긴 슬롯은 밀릴 수 있다(맹점, 후속) |
| `src/widgets/itinerary-edit/ui/ManualEditShell.tsx` | 공용 편집 셸 — `mode: 'normal'\|'fallback'` 단일 스위치가 4축(누락 배너·상단 안내줄+이력·지도 문구·시각 직접입력)을 함께 켜/끈다(i15·i22 4변형이 하나로 접힘). 잠금 = `slot.isFixed \|\| lockedSlotKeys.includes(slotKey)`. 드래그 재정렬 실배선(`NestableDraggableFlatList`, testID `planb-manual-list`, TRIP-577). `cardShadow.shadowColor='#000000'`은 raw hex(className 이 못 받는 관례적 예외 — TOKENIZED_HEX 밖이라 `widgetsStructure` F 미검출). props-only(useState 0) |
| `src/widgets/itinerary-edit/ui/ManualEditGlyphs.tsx` | 셸 전용 인라인 SVG 글리프(raw hex 격리 `*Glyphs.tsx` 관례). 뒤로·되돌리기·경고삼각형·자물쇠·휴지통·플러스·드래그 손잡이(`MUTED_SOFT='#9AA1AB'`) |
| `src/widgets/itinerary-edit/index.ts` | 배럴 — `ManualEditShell`·`ManualEditShellProps`·`ManualEditMode`·`mergeValidationFlags`·`reorderKeepingFixed` 재수출(TRIP-805로 `ManualTimeSheet` 재수출 제거 — 삭제). 실공개 API 배럴(README §62 정당) |

## `src/widgets/time-sheet/` — 공용 시각 조정 시트 (TRIP-805 신규, 쌍둥이 통일)

h24 `SlotTimeSheet`·i15/i22 `ManualTimeSheet`는 props 계약이 완전 동일한 쌍둥이(testID 접두·한글 라벨·제목만 달랐다)라 하나로 접었다. 소비처는 `testIDPrefix`·`labels`·`title`만 주입한다.

| 파일 | 역할 |
|---|---|
| `src/widgets/time-sheet/ui/TimeSheet.tsx` | 공용 시각 시트. props `{startAt, endAt, onApply({startAt,endAt,endsNextDay}), onCancel, testIDPrefix, labels:{start,end}, title?}`. 시·분 값별 셀-press 피커(휠 라이브러리 부재, `ScrollView`+map 으로 전 값 트리 실재). `endsNextDay=end<=start` 기계 유도(INV-2 판정 아님). 분 셀 bare 숫자(INV-3, "30" — "30분" 금지). **선택 셀 `useState` 유지**(`widgetsStructure` F의 useState-0 규약 예외, D8). 소비: `ItineraryEditPage`·`PlaceAddPage`(접두 `itinerary-edit-time`, 라벨 시작/종료, 제목 기본값 '시각 조정') · `PlanbManualPage`(접두 `planb-manual-time`, 라벨 도착/출발, 제목 '시각 입력'). ★ 실개폐·2스냅은 `@gorhom/bottom-sheet` 통과형 목이 못 봄(6-b 실기 전용) |
