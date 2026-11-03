import { createElement, type ComponentType } from 'react';
import { View } from 'react-native';

/**
 * `@sentry/react-native` 대역(테스트 인프라 — 프로덕션 코드 아님). 쓰는 법:
 *   jest.mock('@sentry/react-native', () => require('@/test-support/sentryReactNativeMock'));
 *
 * 실물 SDK 는 init 하는 순간 네이티브 모듈을 부르고 통합 생성도 부작용이 있어 jest 가 못 돌린다. 여기서는 initSentry·SentryRoot 가
 * 부르는 면(init · reactNavigationIntegration · reactNativeTracingIntegration · wrap)만 호출 기록용 jest.fn 으로 둔다.
 * 오류 보고 면(addBreadcrumb · captureException · withScope, TRIP-1744)은 파일 끝에 따로 있다.
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

/**
 * 오류 보고 면(TRIP-1744) — `addBreadcrumb` · `captureException` · `withScope`. init/wrap 대역과 달리 **호출 기록만이 아니라 "무엇이 실려 나갔나"를 되읽는다**:
 * - `withScope(cb)` 는 호출마다 새 가짜 scope 를 `cb` 에 주고, scope 의 `setFingerprint`·`setTag(s)`·`setLevel`·`setExtra(s)`·`setContext` 가 값을 쌓는다.
 * - `captureException(error, hint?)` 는 그 시점의 scope 값(+ hint 의 fingerprint·tags)을 `capturedEvents()` 에 한 건으로 남긴다. scope 밖(전역)에서 부르면
 *   fingerprint·tags 가 비어 남는다 — 전역 scope 를 더럽히는 구현은 지문 단언에서 red 가 된다.
 * - `resetSentryReportMock()` 은 위 세 함수의 호출 기록·구현·쌓인 이벤트를 처음 상태로 되돌린다(`init`·`wrap` 은 건드리지 않는다 — 부팅 배선 단언이 쓴다).
 *   던지게 바꾼 구현(`mockImplementation(() => { throw … })`)도 여기서 원복되므로 파일 최상위 `afterEach` 에 건다.
 */
export interface CapturedEvent {
  error: unknown;
  fingerprint: string[] | undefined;
  tags: Record<string, unknown>;
  level: unknown;
  extras: Record<string, unknown>;
}

const capturedList: CapturedEvent[] = [];
let activeScope: CapturedEvent | null = null;

function newFakeScope(state: CapturedEvent) {
  const scope = {
    setFingerprint: (fingerprint: string[]) => {
      state.fingerprint = fingerprint;
      return scope;
    },
    setTag: (key: string, value: unknown) => {
      state.tags[key] = value;
      return scope;
    },
    setTags: (tags: Record<string, unknown>) => {
      Object.assign(state.tags, tags);
      return scope;
    },
    setLevel: (level: unknown) => {
      state.level = level;
      return scope;
    },
    setExtra: (key: string, value: unknown) => {
      state.extras[key] = value;
      return scope;
    },
    setExtras: (extras: Record<string, unknown>) => {
      Object.assign(state.extras, extras);
      return scope;
    },
    setContext: (key: string, value: unknown) => {
      state.extras[`context:${key}`] = value;
      return scope;
    },
  };
  return scope;
}

const addBreadcrumbDefault = (_breadcrumb?: unknown) => undefined;
const withScopeDefault = (callback: (scope: unknown) => unknown) => {
  const state: CapturedEvent = {
    error: undefined,
    fingerprint: undefined,
    tags: {},
    level: undefined,
    extras: {},
  };
  const previous = activeScope;
  activeScope = state;
  try {
    return callback(newFakeScope(state));
  } finally {
    activeScope = previous;
  }
};
const captureExceptionDefault = (
  error: unknown,
  hint?: { fingerprint?: string[]; tags?: Record<string, unknown> }
) => {
  capturedList.push({
    error,
    fingerprint: activeScope?.fingerprint ?? hint?.fingerprint,
    tags: { ...activeScope?.tags, ...hint?.tags },
    level: activeScope?.level,
    extras: { ...activeScope?.extras },
  });
  return 'mock-event-id';
};

export const addBreadcrumb = jest.fn(addBreadcrumbDefault);
export const withScope = jest.fn(withScopeDefault);
export const captureException = jest.fn(captureExceptionDefault);

/** `captureException` 으로 실려 나간 이벤트들(호출 순서). */
export function capturedEvents(): CapturedEvent[] {
  return [...capturedList];
}

export function resetSentryReportMock(): void {
  capturedList.length = 0;
  activeScope = null;
  addBreadcrumb.mockReset().mockImplementation(addBreadcrumbDefault);
  withScope.mockReset().mockImplementation(withScopeDefault);
  captureException.mockReset().mockImplementation(captureExceptionDefault);
}
