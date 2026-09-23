---
paths:
  - "src/pages/planb-manual/**"
  - "src/pages/itinerary-edit/**"
  - "src/widgets/itinerary-edit/**"
  - "__mocks__/react-native-draggable-flatlist.tsx"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 드래그 리스트 (`react-native-draggable-flatlist`)

- **목이 두 사각을 함께 가진다** → (1) `__mocks__/react-native-draggable-flatlist.tsx`의 헤더 주석이 "`jest.mock('react-native-draggable-flatlist')`로 명시 호출해야 활성화된다"고 적었으나 실측은 반대다 — node_modules 수동 목이라 명시 호출 없이 **자동 적용**되고, `ManualEditScreen.test.tsx`(6/6)는 `jest.mock` 호출 0회로도 green이다(TRIP-577 `03b_code-critic_findings` 참고-1). 이 주석을 믿고 "어느 테스트가 이 목으로 보호되는지"를 판단하면 오판한다. (2) 목의 `drag`는 no-op이라 손잡이를 실제로 롱프레스해 끌리는지·순서가 실제로 바뀌는지는 jest가 원리적으로 못 본다(지도 `viewOnly`·바텀시트 실제 열림과 동형 — 통과형 목 계열). `onDragEnd` 직접 발화(테스트가 `list.props.onDragEnd({data})` 호출)로 배선은 잠기지만, 실제 제스처는 6-b 실기(`planb-manual-normal`/`-fallback` 프리뷰, 롱프레스→끌기)로만 확인된다.
