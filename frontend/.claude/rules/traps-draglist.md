---
paths:
  - "src/pages/itinerary-edit/**"
  - "src/widgets/map-sheet-shell/**"
  - "src/features/planb/model/reorderKeepingLocked.ts"
  - "__mocks__/react-native-draggable-flatlist.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 드래그 리스트 (`react-native-draggable-flatlist`)

- **TRIP-753으로 `src/pages/planb-manual/**`·`src/widgets/itinerary-edit/**`(옛 `ManualEditShell`의 `NestableDraggableFlatList` 실배선·`ManualEditScreen.test.tsx`)가 슬라이스째 삭제됐다.** i07 일정 편집은 h12 편집대 `EditorView`를 재사용한다 — **`EditorView`는 TRIP-921로 `widgets/map-sheet-shell/ui/`로 옮겨졌고 `DraggableFlatList`가 실배선됐다**(롱프레스 → `drag` → `onDragEnd`에서 판정: 리스트 끝 **센티널**(드롭존 칸, `SlotDropZone`) 뒤에 놓이면 `onDeleteViaDrag`, 아니면 센티널을 뺀 새 순서로 `onReorder`). 소비처는 `pages/itinerary-edit`(`ItineraryEditPage`, h12·i07)과 `pages/itinerary-manual`(`ManualPlanPage`, 직접 짜기).
- 재정렬 **규칙 자체**(`features/planb/model/reorderKeepingLocked.ts`)는 `ItineraryEditPage`가 `onReorder` 뒤에서 부른다(고정·완료 재고정은 페이지 사슬 몫, 뷰는 판정만).
- **목의 사각(프로덕션 소비처가 다시 생겨 되살아남)**: (1) `__mocks__/react-native-draggable-flatlist.tsx`는 node_modules 수동 목이라 `jest.mock` 호출 없이 **자동 적용**된다(옛 헤더 주석의 "명시 호출 필요"는 실측과 반대였다 — 주석은 정정됨). (2) 목의 `drag`는 `onDragBegin(index)`를 동기로 부르고 `__dragLog`에 index를 쌓을 뿐, **실제 손가락 이동·놓을 자리 계산은 없고 `isActive`는 항상 false**다 — 끄는 중 얼굴(떠 있는 카드·드롭존 활성)·실제 놓을 자리·`onDragEnd` 미수신 시 고착은 jest가 원리적으로 못 본다(지도 `viewOnly`·바텀시트 실제 열림과 동형 — 통과형 목 계열). 테스트는 `onDragEnd`를 호스트 View prop으로 직접 발화한다. 이 축은 6-b 실기 전용이다.
