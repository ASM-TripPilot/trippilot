---
paths:
  - "src/shared/map/**"
  - "__mocks__/@mj-studio/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.
(지도 전 소비처가 밟는 재빌드·Client ID·오버레이 흡수 항목은 코어 `repo-traps.md` 「지도」 절에 남아 무조건 로드된다.)

## 지도 구현 (`shared/map`)

- **`viewOnly` 4토글은 jest가 prop 전달까지 심판하지만, 실제 제스처 차단은 실기 전용** → `MapView`가 `viewOnly`를 `isScrollGesturesEnabled`·`isZoomGesturesEnabled`·`isRotateGesturesEnabled`·`isTiltGesturesEnabled` 4개로 펼치고 prop-기록형 목이 그 값을 노출해 `MapView.test.tsx` AC2가 4토글 개별로 잠근다. **네이티브가 그 prop으로 실제로 제스처를 막는지**는 jest가 못 본다 — 시뮬레이터에서 손으로 확인.
- **네이버 커스텀 뷰 마커는 `collapsable={false}` 없으면 New Architecture(iOS)에서 기본 마커로 보인다** → `NaverMapMarkerOverlay`의 children(마커 자리에 얹는 커스텀 React 뷰)은 최상위 자식에 `collapsable={false}`(RN에게 "레이아웃에만 쓰는 뷰라도 지우지 마라"고 알리는 prop — 없으면 view flattening 최적화로 네이티브 트리에서 사라진다)가 없으면 네이티브가 자식을 못 찾아 기본 초록 심볼/흰 실루엣이 뜬다(6-b 실측, 라이브러리 소스 "Custom React View" 항 대조). 생김새가 바뀌는 자식은 `key`도 함께 준다.
- **마커 번호·글자를 RN `<Text>`로 그리면 iOS 마커 스냅샷에 안 잡힌다** → 네이버 SDK는 커스텀 마커 뷰를 `UIImage`(정지 이미지)로 한 번 찍어 지도 위에 얹는데, 그 시점엔 배경 `View`(레이어 속성)는 찍히지만 `<Text>` 글리프는 아직 안 그려진 상태다(6-b 실측 — 원은 뜨는데 번호만 빔). `react-native-svg`의 `Text`(벡터로 한 레이어에 동기 렌더)로 바꿔야 찍힌다. jest 쪽도 갈라진다 — RNTL `toHaveTextContent`는 이 SVG 문자열을 못 읽고, 목이 문자열을 `RNSVGTSpan.props.content`에 넣으므로 `within().UNSAFE_queryAllByProps({content})`로 검증한다.
- **`camera`와 `region`을 같이 넘기면 SDK가 `region`을 버린다 — 한쪽만 간다** → 네이버 SDK 구현이 `region={!camera && !initialCamera ? region : undefined}`라, `camera`(또는 `initialCamera`)가 있으면 `region`은 무조건 무시된다. `fitPins`(핀 전체를 담는 영역 맞춤)처럼 `region`으로 카메라를 옮기려면 `camera` 자체를 스프레드에서 빼야 한다(`{...(region !== null ? { region } : { camera })}` 형태로 택일).
- **영역 맞춤(fit-to-bounds) 결과가 실제로 화면에 다 들어오는지는 jest 원리적 사각** → `MapView.test.tsx`류 목은 `region`·`camera` prop 값만 기록하고, 네이버 SDK가 그 `region`으로 실제 카메라를 움직여 모든 핀을 뷰포트 안에 넣는지는 재현하지 않는다. 순수 함수(`buildFitRegion`)의 여백 비율(예 1.4배)이 물방울 핀처럼 anchor가 중심이 아닌 마커(머리가 좌표 위로 솟음)의 실제 잘림을 막는지는 실기 확인 전용(6-b) — jest는 전부 green이어도 카드 위쪽에서 핀 머리가 잘릴 수 있다.
- **region은 레이아웃 전 임시 프레임으로 맞춰진다 — `onLayout` 재맞춤이 없으면 카드가 작을수록 잘린다**(TRIP-1043 실측). 네이버 SDK(`RNCNaverMapViewImpl.mm` `setRegion`)는 `region` prop을 받는 **즉시** `fitBounds`로 줌을 정하는데, 그 순간 뷰는 아직 RN 레이아웃이 끝나기 전(카드 실제 크기가 아닌 임시 프레임)이라 한 축(가로 또는 세로)으로만 맞고 반대 축은 잘린다. SDK는 같은 값의 `region`이 다시 오면 무시하므로(`isRegionEqual`) 재전달로는 못 고친다 — `onLayout`(레이아웃 확정 콜백)에서 `ref.animateRegionTo`(easing: 'None' = 순간이동)로 같은 영역을 한 번 더 맞춰야 한다. **jest 가짜 지도는 `onLayout`을 호출하지 않는다** — 이 재맞춤 코드를 통째로 지워도 jest 전부 green이라 실기 캡처만 그물이다. `radiusCircle`을 새로 받는 화면·`fitPins`를 쓰는 기존 화면 전부(`MapView.tsx`가 공용이라 h02·h10·h15 등) 이 축을 공유한다.
