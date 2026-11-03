import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';

/**
 * TRIP-1743 · 5-b W2 — DSN 이 없는 부팅(개발 빌드·PR 빌드·jest 의 기본)을 루트 레이아웃 수준에서 실제로 그린다.
 *
 * (개념) `AppProviders.test` 는 추적 배선을 보려고 파일 전체에 DSN 을 넣는다. 그러면 "DSN 없음 → `initSentry()` 가 null →
 *   `SentryRoot` 가 자식만 그대로 그린다" 경로를 앱 조립 수준에서 아무도 그리지 않게 된다(예: AppProviders 가 null 대신 `{}` 를
 *   넘기도록 바뀌면 DSN 없는 빌드는 부팅 때 죽는데 다른 테스트는 전부 green — 5-b 실측).
 * 무엇을 보장하나: DSN 이 없으면 ① 앱이 첫 렌더에 그려지고 ② Sentry 래퍼(`sentry-wrap`)가 트리에 없고 ③ init·네비게이션 통합 생성이 0회다.
 *   expo-router 를 대역으로 갈지 않는다 — 추적이 꺼진 경로가 expo-router 를 불러오면(정적 import 회귀) 이 파일이 로드·렌더 단계에서 깨진다.
 * 3동작: 준비(DSN 없이 대역만) → 실행(루트 레이아웃 render) → 단언(프로브 존재·래퍼 부재·호출 0회).
 */

process.env.EXPO_PUBLIC_API_MOCK = '1';
delete process.env.EXPO_PUBLIC_SENTRY_DSN;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('react-native-gesture-handler/jestSetup');

jest.mock('@/app/styles/global.css', () => ({}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));

jest.mock('@sentry/react-native', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/sentryReactNativeMock')
);

jest.mock('@react-navigation/native', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/navigationThemeMock')
);

jest.mock('@/app/routing/SplashGate', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/queryClientProbe')
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RootLayout = require('@routes/_layout').default as ComponentType;

describe('🔴 TRIP-1743 · DSN 없는 부팅 — Sentry 래퍼 없이 그대로 그린다', () => {
  it('앱이 첫 렌더에 그려지고, Sentry 래퍼·init·네비게이션 통합이 없다', () => {
    render(<RootLayout />);

    expect(screen.getByTestId('query-client-probe')).toBeOnTheScreen();
    expect(screen.queryByTestId('sentry-wrap')).toBeNull();
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.reactNavigationIntegration).not.toHaveBeenCalled();
    expect(Sentry.wrap).not.toHaveBeenCalled();
  });
});
