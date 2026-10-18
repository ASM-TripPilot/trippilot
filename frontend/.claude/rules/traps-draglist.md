---
paths:
  - "src/pages/itinerary/itinerary-edit/**"
  - "src/widgets/map-sheet-shell/**"
  - "__mocks__/react-native-draggable-flatlist.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 드래그 리스트 (`react-native-draggable-flatlist`)

- **드래그 편집대는 `widgets/map-sheet-shell/ui/EditorView.tsx` 하나다** → `DraggableFlatList`가 실배선돼 있다(롱프레스 → `drag` → `onDragEnd`에서 판정: 놓을 때 끌던 카드가 **리스트 밖 시트 하단 삭제 영역**(`SlotDropZone`, `dragDelete.ts` 순수 판정 + `useDeleteZoneHover`) 위였으면 `onDeleteViaDrag`, 아니면 `onReorder` — 센티널 칸은 TRIP-1246에서 폐기, 리스트 data는 활성 일자 슬롯뿐). 소비처는 `pages/itinerary/itinerary-edit`(`ItineraryEditPage`, h12·i07)과 `pages/itinerary/itinerary-manual`(`ManualPlanPage`, 직접 짜기).
- 재정렬 **규칙 자체**(`pages/itinerary/itinerary-edit/model/reorderKeepingLocked.ts`)는 `ItineraryEditPage`가 `onReorder` 뒤에서 부른다(고정·완료 재고정은 페이지 사슬 몫, 뷰는 판정만).
- **목의 사각**: (1) `__mocks__/react-native-draggable-flatlist.tsx`는 node_modules 수동 목이라 `jest.mock` 호출 없이 **자동 적용**된다. (2) 목의 `drag`는 `onDragBegin(index)`를 동기로 부르고 `__dragLog`에 index를 쌓을 뿐, **실제 손가락 이동·놓을 자리 계산은 없고 `isActive`는 항상 false**다 — 끄는 중 얼굴(떠 있는 카드·드롭존 활성)·실제 놓을 자리·`onDragEnd` 미수신 시 고착은 jest가 원리적으로 못 본다(지도 `viewOnly`·바텀시트 실제 열림과 같은 통과형 목 계열). 테스트는 `onDragEnd`를 호스트 View prop으로 직접 발화한다. 이 축은 6-b 실기 전용이다.

- **알려진 라이브러리 경고: `measureLayout`** → `react-native-draggable-flatlist`의 `CellRendererComponent`·`NestableDraggableFlatList`가 `measureLayout`을 쓴다(신 아키텍처 dev 경고 후보). TRIP-1431에서 코드는 건드리지 않았고(계약상 무변경), 카드가 화면보다 많은 날 위·아래 끝 끌기 때 자동 스크롤이 치우치는지(헤더 높이 약 50px 추정)는 6-b 실기 전용 — jest 목은 끌기 이동이 없어 못 본다.
