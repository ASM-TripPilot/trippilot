import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * expo-router `Stack` 계열의 테스트용 목(관찰 마커).
 *
 * 왜 별도 모듈인가: 이 목은 react-native `View` 를 만든다. jest.mock 의 인라인 팩토리 안에서
 * 엘리먼트를 만들면 NativeWind babel 이 주입하는 `_ReactNativeCSSInterop`(모듈 스코프 변수)을
 * 팩토리가 참조하게 되어 jest 호이스트 규칙(out-of-scope 변수 금지)을 위반한다.
 * 그래서 모듈 스코프 파일로 분리하고, 테스트는 `jest.mock('expo-router', () => require(...))` 로 쓴다.
 * (직전 사이클의 @gorhom/bottom-sheet 수동 목과 같은 패턴.)
 *
 * Stack.Protected: guard 가 참일 때만 children 렌더(선언형 가드).
 * Stack.Screen: name 을 testID(gate-route-<name>)로 노출 → 어떤 라우트가 마운트됐는지 관찰.
 */
export function Stack({ children }: { children?: ReactNode }) {
  return <View testID="gate-stack">{children}</View>;
}

Stack.Protected = function Protected({
  guard,
  children,
}: {
  guard: boolean;
  children?: ReactNode;
}) {
  return guard ? <View testID="gate-guard-on">{children}</View> : null;
};

Stack.Screen = function Screen({ name }: { name: string }) {
  return <View testID={`gate-route-${name}`} />;
};
