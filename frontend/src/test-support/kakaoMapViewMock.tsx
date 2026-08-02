import { Text } from 'react-native';

/**
 * `@/shared/map`의 테스트용 목(관찰 마커) — 등록 화면·배선 테스트 전용.
 *
 * 왜 필요한가: 실제 `KakaoMapView`는 `EXPO_PUBLIC_KAKAO_MAP_JS_KEY`가 없으면 무조건
 * `map-failure` 표면으로 떨어지므로(그 컴포넌트 48행), jest 환경에서는 **center prop이
 * 어디로도 흐르지 않는다.** e05가 보장해야 하는 것은 "고른 후보의 좌표가 지도로 전달된다"
 * (01b Seed §3-3)라서, 그 값을 밖에서 읽을 수 있는 자리가 필요하다.
 *
 * 왜 별도 모듈인가: `expoRouterTabsMock.tsx`와 같은 이유다 — jest.mock의 인라인 팩토리
 * 안에서 엘리먼트를 만들면 NativeWind babel이 주입하는 모듈 스코프 변수
 * (`_ReactNativeCSSInterop`)를 팩토리가 참조하게 되어 jest 호이스트 규칙(out-of-scope 변수
 * 금지)을 위반한다. **TRIP-198 사이클에서 인라인 팩토리로 먼저 시도해 실제로 그 오류를
 * 재현했다**(02a ★5). 그래서 모듈 스코프 파일로 분리하고, 테스트는
 * `jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'))`로 쓴다.
 *
 * 좌표를 텍스트로 노출한다 — `toHaveTextContent('35.1587,129.1604')`로 읽는다.
 *
 * TRIP-199에서 남은 props를 호스트 엘리먼트로 통과시킨다 — WebView 안 롱프레스는 jest가
 * 실행하지 못하므로(`__mocks__/react-native-webview.tsx`가 통과 `<View>`다), 테스트는
 * `getByTestId('map-root').props.onMapMessage(...)`로 그 메시지를 직접 발화시킨다
 * (`KakaoMapView.test.tsx`가 WebView 목에 쓰는 것과 같은 형태).
 */

export interface MapCenter {
  lat: number;
  lng: number;
}

export function KakaoMapView({
  center,
  ...rest
}: {
  center: MapCenter;
} & Record<string, unknown>) {
  return (
    <Text testID="map-root" {...rest}>{`${center.lat},${center.lng}`}</Text>
  );
}
