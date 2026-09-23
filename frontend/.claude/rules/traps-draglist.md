---
paths:
  - "src/pages/itinerary-edit/**"
  - "src/features/planb/model/reorderKeepingLocked.ts"
  - "__mocks__/react-native-draggable-flatlist.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 드래그 리스트 (`react-native-draggable-flatlist`)

- **TRIP-753으로 `src/pages/planb-manual/**`·`src/widgets/itinerary-edit/**`(옛 `ManualEditShell`의 `NestableDraggableFlatList` 실배선·`ManualEditScreen.test.tsx`)가 슬라이스째 삭제됐다.** i07 일정 편집은 이제 `pages/itinerary-edit`(h12 `EditorView`)를 재사용하는데, **`EditorView`는 `onReorder`·`onDeleteViaDrag` prop을 구조분해조차 하지 않고 `src` 비테스트 코드 어디에도 `DraggableFlatList`가 없다**(그래서 아래 목 함정도 지금은 프로덕션 사각이 아니라 **완전 미배선** — h12·i07 공통, 03b 참고-4·새 티켓 후보). 안내문("길게 눌러 순서를 바꾸거나 아래로 끌어 삭제해요")은 지금 없는 제스처를 약속한다.
- 재정렬 **규칙 자체**(`features/planb/model/reorderKeepingLocked.ts`)는 살아 있고 단위 테스트로 잠겨 있다 — 다만 그 규칙을 부르는 프로덕션 드래그 표면이 없어 **테스트에서만 실행된다**(통합 테스트 P3가 `UNSAFE_getByType(EditorView).props.onReorder`를 직접 호출해 배선을 확인하는 것이지, 실제 손가락 제스처가 그 콜백에 닿는 경로가 있다는 뜻이 아니다).
- **옛 목의 두 사각 서술(역사적 참고, 대상 소멸)**: (1) `__mocks__/react-native-draggable-flatlist.tsx`의 헤더 주석이 "`jest.mock('react-native-draggable-flatlist')`로 명시 호출해야 활성화된다"고 적었으나 실측은 반대였다 — node_modules 수동 목이라 명시 호출 없이 자동 적용되고, 옛 `ManualEditScreen.test.tsx`(6/6, 삭제됨)는 `jest.mock` 호출 0회로도 green이었다(TRIP-577 `03b_code-critic_findings` 참고-1). (2) 목의 `drag`는 no-op이라 손잡이를 실제로 롱프레스해 끌리는지는 jest가 원리적으로 못 본다(지도 `viewOnly`·바텀시트 실제 열림과 동형 — 통과형 목 계열). 이 목을 실제로 쓰는 프로덕션 소비처가 지금 0이라 실기 확인 대상도 없다 — 드래그 실배선(새 티켓)이 열리면 이 항목을 되살린다.
