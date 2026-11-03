import { createElement, type ComponentType } from 'react';
import { View } from 'react-native';

/**
 * `@sentry/react-native` 대역(테스트 인프라 — 프로덕션 코드 아님). 쓰는 법:
 *   jest.mock('@sentry/react-native', () => require('@/test-support/sentryReactNativeMock'));
 *
 * 실물 SDK 는 init 하는 순간 네이티브 모듈을 부르고 통합 생성도 부작용이 있어 jest 가 못 돌린다. 여기서는 initSentry·SentryRoot 가
 * 부르는 면(init · reactNavigationIntegration · reactNativeTracingIntegration · wrap)만 호출 기록용 jest.fn 으로 둔다.
 * - 통합 객체는 부를 때마다 새로 만든다 — `registerNavigationContainer` 호출 기록이 그 통합에 붙는다.
 * - `wrap(Component)` 는 `Component` 를 testID `sentry-wrap` View 로 감싼 컴포넌트를 돌려준다("루트가 감싸졌다"를 트리에서 본다).
 * 별도 파일인 이유는 `queryClientProbe.tsx` 와 같다(jest.mock 팩토리 안 RN 엘리먼트 금지).
 */
export const init = jest.fn();

export const reactNavigationIntegration = jest.fn(() => ({
  name: 'ReactNavigation',
  registerNavigationContainer: jest.fn(),
}));

export const reactNativeTracingIntegration = jest.fn(() => ({
  name: 'ReactNativeTracing',
}));

export const wrap = jest.fn(
  (Component: ComponentType<Record<string, unknown>>) =>
    function SentryWrapped(props: Record<string, unknown>) {
      return createElement(
        View,
        { testID: 'sentry-wrap' },
        createElement(Component, props)
      );
    }
);
