import React from 'react';
import { View } from 'react-native';

// @mj-studio/react-native-naver-map 수동 목(jest 규약: <rootDir>/__mocks__/<module> —
// jest.mock() 호출 없이 모든 버킷·모든 테스트에 자동 적용된다).
// 네이버 지도는 네이티브 모듈이라 jest 환경에서는 로드조차 못 하므로, 지도 자리에
// 관측 가능한 <View>를 세운다.
//
// ⚠️ prop-기록형 목이다(통과형 아님). props 를 host <View> 로 그대로 스프레드해
// 테스트가 getByTestId('map-native').props.isScrollGesturesEnabled 등을 직접 관측한다 —
// prop 을 삼키면 viewOnly 4토글 심판이 공허 통과한다(카카오 시절 자동 심판 부재 함정 해소).
//
// 인라인 jest.mock 팩토리로 두면 NativeWind babel 이 주입하는 `_ReactNativeCSSInterop`
// 참조가 out-of-scope 로 걸리므로(함정), 모듈 스코프 파일로 분리한다
// (__mocks__/react-native-webview.tsx·__mocks__/@gorhom/bottom-sheet.tsx 와 동형).

// prop 타입은 `{ children? }` 만 선언한다(webview 목 동형). isScrollGesturesEnabled 등
// 실제 prop 은 MapView.tsx 가 **네이버 SDK 실타입**으로 검사받고(목 타입은 목 파일 안에서만
// 쓰인다), 런타임엔 `{...props}` 로 그대로 host View 에 실려 테스트가 관측한다. 여기에
// `& Record<string, unknown>` 을 더하면 인덱스 시그니처가 children 을 unknown 으로 오염시킨다.
const NaverMapView = React.forwardRef<unknown, { children?: React.ReactNode }>(
  ({ children, ...props }, ref) => {
    React.useImperativeHandle(ref, () => ({
      // 타입상 Promise 를 반환하는 두 메서드는 resolve 로, 나머지는 빈 함수 no-op.
      screenToCoordinate: () =>
        Promise.resolve({ isValid: false, latitude: 0, longitude: 0 }),
      coordinateToScreen: () =>
        Promise.resolve({ isValid: false, screenX: 0, screenY: 0 }),
      animateCameraWithTwoCoords: () => {},
      animateCameraTo: () => {},
      cancelAnimation: () => {},
      setLocationTrackingMode: () => {},
      showInfoWindow: () => {},
      hideInfoWindow: () => {},
    }));
    return (
      <View testID="map-native" {...props}>
        {children}
      </View>
    );
  }
);
NaverMapView.displayName = 'MockNaverMapView';

function NaverMapMarkerOverlay({
  children,
  ...props
}: {
  children?: React.ReactNode;
}) {
  return (
    <View testID="map-marker" {...props}>
      {children}
    </View>
  );
}

function NaverMapPathOverlay(props: Record<string, unknown>) {
  return <View testID="map-path" {...props} />;
}

// TRIP-795 — 반경 점선 원 오버레이(additive). NaverMapPathOverlay 와 동형 통과형 목:
// props(latitude·longitude·radius·color 등)를 host View 로 그대로 노출해 MapView.test 가
// getByTestId('map-circle').props.radius 로 반경 전달을 관측한다. 점선 실렌더는 6-b.
function NaverMapCircleOverlay(props: Record<string, unknown>) {
  return <View testID="map-circle" {...props} />;
}

export {
  NaverMapView,
  NaverMapMarkerOverlay,
  NaverMapPathOverlay,
  NaverMapCircleOverlay,
};
