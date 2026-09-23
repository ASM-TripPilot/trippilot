---
paths:
  - "src/shared/map/**"
  - "__mocks__/@mj-studio/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.
(지도 전 소비처가 밟는 재빌드·Client ID·오버레이 흡수 항목은 코어 `repo-traps.md` 「지도」 절에 남아 무조건 로드된다.)

## 지도 구현 (`shared/map`)

- **`viewOnly` 4토글은 이제 jest 가 심판하지만(prop 전달까지), 실제 제스처 차단은 여전히 실기 전용** → `MapView` 가 `viewOnly` 를 `isScrollGesturesEnabled`·`isZoomGesturesEnabled`·`isRotateGesturesEnabled`·`isTiltGesturesEnabled` 4개로 펼치고 prop-기록형 목이 그 값을 노출해 `MapView.test.tsx` AC2 가 4토글 개별로 잠근다(카카오 시절 "자동 심판 없음"은 해소). 단 **네이티브가 그 prop 으로 실제로 제스처를 막는지**는 jest 가 못 본다 — 시뮬레이터에서 손으로 확인.
- **네이버 커스텀 뷰 마커는 `collapsable={false}` 없으면 New Architecture(iOS)에서 기본 마커로 보인다** → `NaverMapMarkerOverlay`의 children(마커 자리에 얹는 커스텀 React 뷰)은 최상위 자식에 `collapsable={false}`(RN에게 "레이아웃에만 쓰는 뷰라도 지우지 마라"고 알리는 prop — 없으면 view flattening 최적화로 네이티브 트리에서 사라진다)가 없으면 네이티브가 자식을 못 찾아 기본 초록 심볼/흰 실루엣이 뜬다(TRIP-876 6-b 실측, 라이브러리 소스 "Custom React View" 항 대조). 생김새가 바뀌는 자식은 `key`도 함께 준다.
- **마커 번호·글자를 RN `<Text>`로 그리면 iOS 마커 스냅샷에 안 잡힌다** → 네이버 SDK는 커스텀 마커 뷰를 `UIImage`(정지 이미지)로 한 번 찍어(스냅샷) 지도 위에 얹는데, 그 시점엔 배경 `View`(레이어 속성)는 찍히지만 `<Text>` 글리프는 아직 안 그려진 상태다(TRIP-876 6-b 실측 — 분홍 원은 뜨는데 번호만 빔). `react-native-svg`의 `Text`(SVG 문자열을 벡터로 그려 한 레이어로 동기 렌더)로 바꿔야 찍힌다. jest 쪽도 갈라진다 — RNTL `toHaveTextContent`는 이 SVG 문자열을 못 읽고, 목이 문자열을 `RNSVGTSpan.props.content`에 넣으므로 `within().UNSAFE_queryAllByProps({content})`로 검증해야 한다.
