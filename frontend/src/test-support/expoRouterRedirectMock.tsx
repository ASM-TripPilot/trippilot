import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

/**
 * expo-router `Redirect`/`Stack` 의 테스트용 목(관찰 마커) — T2 진입 가드 검증용.
 *
 * 왜 별도 모듈인가: 이 목은 react-native 엘리먼트를 만든다. jest.mock 인라인 팩토리 안에서
 * 엘리먼트를 만들면 NativeWind babel 이 주입하는 모듈 스코프 변수를 팩토리가 참조하게 되어
 * jest 호이스트 규칙(out-of-scope 변수 금지)을 위반한다. (expoRouterStackMock 과 같은 패턴.)
 *
 * Redirect: 실물은 즉시 href 로 이동시킨다 — 라우터 컨텍스트 없이 "어디로 보내려 했는가"만
 *   testID 'redirect-href' + 텍스트(href 문자열)로 노출해 관찰한다.
 * Stack: 가드가 리다이렉트 대신 자식(온보딩 화면)을 그대로 렌더할 때의 마커.
 */

export function Redirect({ href }: { href: string }) {
  return <Text testID="redirect-href">{String(href)}</Text>;
}

export function Stack({ children }: { children?: ReactNode }) {
  return <View testID="onboarding-stack">{children}</View>;
}
