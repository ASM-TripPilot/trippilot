import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { AxiosError } from 'axios';

import { getObservedQueryClient } from '@/test-support/queryClientProbe';
import {
  capturedEvents,
  resetSentryReportMock,
} from '@/test-support/sentryReactNativeMock';

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

// 모듈 싱글턴(Sentry 대역의 보고 기록)은 파일 최상위에서 비운다.
afterEach(() => {
  resetSentryReportMock();
});

/**
 * TRIP-1744 · B6 — 서버 요청 실패 보고는 DSN·추적(`sentryTracing`) 상태로 게이트하지 않는다.
 * (개념) DSN 이 없으면 Sentry SDK 자체가 호출을 조용히 버린다(no-op). 그래서 보고 쪽에서 "DSN 이 없으면 부르지 않는다"로 막을 이유가 없고, 막으면
 * 나중에 DSN 을 켠 웹·개발 빌드에서 보고가 조용히 빠진다(추적이 꺼진 웹은 `initSentry()` 가 null 을 돌려주는데 오류 수집은 켜져 있다).
 * 무엇을 보장하나: DSN 없는 부팅(= 추적 null)에서도 최종 실패는 Sentry 호출까지 간다. 이 호출이 DSN 없는 실물 SDK 에서 던지지 않는 것은 보고 함수의 try/catch 가
 * 이중으로 지킨다(reportQueryFailure.test). 커버하지 않는 것: 실물 SDK 의 no-op 자체(SDK 소스 근거).
 */
describe('DSN 없는 부팅 — 서버 요청 실패 보고는 게이트되지 않는다', () => {
  it('추적이 꺼진 채 부팅해도 앱의 조회 최종 실패가 breadcrumb·이벤트로 Sentry 에 건네진다', async () => {
    render(<RootLayout />);
    const client = getObservedQueryClient()!;
    const error = new AxiosError('request failed');
    error.response = {
      status: 500,
      statusText: '',
      data: {},
      headers: {},
      config: { headers: {} },
    } as AxiosError['response'];

    await client
      .fetchQuery({
        queryKey: ['/trips/t-nodsn-1744/itinerary'],
        retryDelay: 0,
        queryFn: async () => {
          throw error;
        },
      })
      .catch(() => undefined);

    expect(Sentry.init).not.toHaveBeenCalled(); // 앵커 — 정말 DSN 없는 부팅이다
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(capturedEvents()).toHaveLength(1);
  });
});
