import { View } from 'react-native';

/**
 * `SplashGate` 의 테스트용 목(관찰 마커).
 *
 * 왜 별도 모듈인가: 이 목은 react-native `View` 를 만든다. jest.mock 의 인라인 팩토리 안에서
 * 엘리먼트를 만들면 NativeWind babel 이 주입하는 모듈 스코프 변수를 팩토리가 참조하게 되어
 * jest 호이스트 규칙(out-of-scope 변수 금지)을 위반한다. (expoRouterStackMock 과 같은 패턴.)
 *
 * 실물 `SplashGate` 는 렌더 즉시 부트스트랩 요청을 발사한다 — 이 목은 요청 없이
 * "렌더됐는가"만 testID 로 관찰 가능하게 만든다.
 */
export function SplashGate() {
  return <View testID="splash-gate" />;
}
