import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * expo-router `Tabs` 계열의 테스트용 목(관찰 마커) — `tabsShell.test.tsx` 전용.
 *
 * 왜 별도 모듈인가: `expoRouterStackMock.tsx`와 같은 이유다 — 이 목은 react-native `View`를
 * 만드는데, jest.mock의 인라인 팩토리 안에서 엘리먼트를 만들면 NativeWind babel이 주입하는
 * 모듈 스코프 변수(`_ReactNativeCSSInterop`)를 팩토리가 참조하게 되어 jest 호이스트 규칙
 * (out-of-scope 변수 금지)을 위반한다. 그래서 모듈 스코프 파일로 분리하고, 테스트는
 * `jest.mock('expo-router', () => require('@/test-support/expoRouterTabsMock'))`로 쓴다.
 *
 * `Tabs`: `(tabs)/_layout.tsx`가 넘기는 props(특히 `tabBar` 렌더프롭)를 `capturedTabsProps`에
 * 담아 테스트가 꺼내 쓸 수 있게 한다. `children`(`Tabs.Screen` 목록)은 그대로 렌더한다.
 * `Tabs.Screen`: `name`을 testID(`tabs-route-<name>`)로 노출 — 어떤 라우트가 등록됐는지,
 * 순서가 무엇인지 관찰한다. 이 testID는 목 전용이며 프로덕션 코드에는 나타나지 않는다.
 */

// 가장 최근 `Tabs` 렌더에서 받은 props(children 제외) 전체를 담는 모듈 스코프 홀더.
// 테스트는 `render(<TabsLayout />)` 직후 이 값을 꺼내 `tabBar` 렌더프롭 함수를 얻는다.
export const capturedTabsProps: { current: Record<string, unknown> | null } = {
  current: null,
};

export function Tabs({
  children,
  ...rest
}: {
  children?: ReactNode;
  [key: string]: unknown;
}) {
  capturedTabsProps.current = rest;
  return <View testID="tabs-navigator">{children}</View>;
}

Tabs.Screen = function Screen({ name }: { name: string }) {
  return <View testID={`tabs-route-${name}`} />;
};

// `(tabs)/index.tsx`가 CTA 라우팅을 위해 `useRouter()`를 물면서(TRIP-370) tabsShell 이
// IndexRoute 를 렌더할 때 이 목이 `useRouter`를 내놓지 않으면 크래시한다. tabsShell 은 라우팅을
// 단언하지 않으므로(루트 렌더만 확인) push 는 무해한 no-op 으로 둔다 — 목적지 왕복 심판은
// tabsHomeRoute.test.tsx 가 자체 `useRouter` 목으로 따로 진다.
export function useRouter() {
  return { push: () => {} };
}
