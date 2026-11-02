import type { ComponentType } from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { QueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import * as Notifications from 'expo-notifications';

import {
  getObservedQueryClient,
  resetObservedQueryClient,
} from '@/test-support/queryClientProbe';

/**
 * 루트 레이아웃(`app/_layout.tsx` = `AppProviders` > `SplashGate`) 부팅 골격 — 옛 `rootLayout`·
 * `rootLayoutSafeArea`·`rootLayoutQueryProvider`·`rootLayoutToastHost` 네 파일을 한 파일로 합쳤다(TRIP-1350).
 * 관점은 describe 로 남는다. `SplashGate` 자리에는 `queryClientProbe`(QueryClient 를 손에 쥐고 마커를 그린다)를 꽂는다.
 *
 * ── 부팅 골격 ─────────────────────────────────────────────────────────
 *  (1) **첫 렌더에 곧바로** SplashGate 가 그려진다(부팅을 붙잡는 비동기 게이트가 없다 — 폰트는 expo-font 플러그인이
 *      네이티브 번들에 넣어 JS 가 기다리지 않는다, TRIP-1361),
 *  (2) 그 시점에 네이티브 스플래시가 내려간다(무한 정지 화면 금지).
 *  GestureHandlerRootView·SafeAreaProvider 감싸는 순서와 테마 배경색은 생김새·트리라 jest 가 아니라 실화면 QA 가 본다
 *  (기능 지도 app-launch `launch-safe-area` · 바텀시트는 빠지면 실화면에서 바로 죽는다).
 *
 * ── SafeAreaProvider (D4) ────────────────────────────────────────────
 * ⚠️ "SafeAreaProvider 가 있으면서도 첫 렌더에 자식이 그려진다"는 형식적 회귀 문구가 아니라 **실측된 함정**이다.
 *    SafeAreaProvider 는 네이티브 레이아웃에서 인셋 값을 받기 전까지 **자식을 렌더하지 않는다** — jest 에는
 *    레이아웃 패스가 없어 그 값이 영영 오지 않으므로 `initialMetrics` 를 줘야 자식이 그려진다. 그 짝은 위 (1) 이 지킨다.
 *
 * ── QueryClientProvider (TRIP-179 AC-3 · D4) ─────────────────────────
 * Provider 가 `SplashGate` 바깥에 있어야 프로브가 진짜 QueryClient 를 쥔다. 잠그는 것은 "값의 위치"가 아니라
 * "관찰 가능성"(동작)이라 `AppProviders` 추출 같은 리팩토링에도 살아남는다.
 * TRIP-986: 앱 전역 retry 기본값은 "404 만 다시 묻지 않는다" — 요청을 시작한 관찰자의 규칙만 적용되므로 전역이어야 한다.
 * 문자열로 소스를 훑지 않고 부팅된 앱이 실제로 쥔 클라이언트의 기본값을 불러 본다.
 *
 * ── 토스트 호스트 (TRIP-990 · D19) ───────────────────────────────────
 * 저장한 뒤 화면을 떠나도 토스트는 남아야 하므로 호스트는 Stack(SplashGate) **바깥**에 한 번 둔다. SplashGate 를
 * 마커로 갈아끼웠으므로 호스트를 그 안에 두면 red 다. 실제 네비게이션 뒤 가시성·transparentModal 위 가림은 6-b.
 *
 * 왜 라우트 폴더(app/)가 아니라 src/app 인가: expo-router 의 require.context 정규식은 `.test.tsx` 를 제외하지 않는다 →
 * app/ 아래에 테스트 파일을 두면 실제 라우트로 등록된다.
 */

process.env.EXPO_PUBLIC_API_MOCK = '1';

// react-native-gesture-handler 는 네이티브 모듈을 요구하므로 공식 jest 목 설정을 먼저 건다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('react-native-gesture-handler/jestSetup');

// global.css 는 jest 의 transform 대상이 아니라 그대로 require 하면 SyntaxError 가 난다.
jest.mock('@/app/styles/global.css', () => ({}));

const mockHideAsync = jest.fn();
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: mockHideAsync,
}));

// 네비게이션 라이브러리는 ESM 배포라 node 버킷 jest 가 못 읽는다 — 대역으로 바꾼다(TRIP-1434).
jest.mock('@react-navigation/native', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/navigationThemeMock')
);

// 실물 SplashGate 는 렌더 즉시 부트스트랩 요청을 발사하므로 QueryClient 관찰 프로브로 대체한다.
// 배럴(@/app)이 ./routing/SplashGate 를 재수출하므로 깊은 경로를 목으로 갈면 배럴을 타고 내려온다.
jest.mock('@/app/routing/SplashGate', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/queryClientProbe')
);

// jestSetup 이 먼저 돌아야 하므로 import 문(호이스팅) 대신 require 로 순서를 고정한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RootLayout = require('@routes/_layout').default as ComponentType;
type ToastModule = typeof import('@/shared/ui/Toast');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Toast = require('@/shared/ui/Toast') as ToastModule;

beforeEach(() => {
  mockHideAsync.mockClear();
  resetObservedQueryClient();
});

afterEach(() => {
  act(() => Toast.hideToast());
});

function httpError(status: number): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}

describe('루트 레이아웃 — 부팅 골격', () => {
  it('첫 렌더에 곧바로 SplashGate 를 그리고 네이티브 스플래시를 내린다', () => {
    render(<RootLayout />);

    expect(screen.getByTestId('query-client-probe')).toBeOnTheScreen();
    expect(mockHideAsync).toHaveBeenCalled();
  });
});

describe('AC-3 · 루트 레이아웃 — QueryClientProvider 관찰 가능성 (C-1)', () => {
  it('셸 안쪽에서 useQueryClient()를 부를 수 있고, 프로브가 진짜 QueryClient 인스턴스를 받는다', () => {
    // 실행을 함수로 감싼다 — 렌더를 먼저 실행해 놓고 나중에 단언하면 예외가 그대로 튀어나가 assertion diff 가 사라진다.
    const renderRoot = () => render(<RootLayout />);

    expect(renderRoot).not.toThrow();
    expect(screen.getByTestId('query-client-probe')).toBeOnTheScreen();
    // 가짜 통과 방지 짝 — 프로브가 useQueryClient()를 부르지 않는 멍청한 마커로 퇴화해도 초록이 되지 않게
    // 진짜 클라이언트 인스턴스를 손에 쥐었는지까지 본다.
    expect(getObservedQueryClient()).toBeInstanceOf(QueryClient);
  });
});

describe('🔴 TRIP-986 · 앱 전역 QueryClient 재시도 기본값 = 404 무재시도 (03b 경고-1)', () => {
  it('부팅된 앱의 기본 retry 는 404 를 다시 묻지 않고, 500 은 기본처럼 3회까지 묻는다', () => {
    render(<RootLayout />);
    const retry = getObservedQueryClient()?.getDefaultOptions().queries?.retry;

    // 함수여야 한다. 기본값을 안 건드리면 undefined(라이브러리 기본 3회)라 여기서 red.
    expect(typeof retry).toBe('function');
    const retryFn = retry as (failureCount: number, error: unknown) => boolean;

    // 404 는 첫 실패부터 멈춘다.
    expect(retryFn(0, httpError(404))).toBe(false);
    // 짝: 500 은 여전히 묻는다(전부 끄는 `retry:false`·`() => false` 오답 차단) + 3회차에 멈춘다.
    expect(retryFn(0, httpError(500))).toBe(true);
    expect(retryFn(2, httpError(500))).toBe(true);
    expect(retryFn(3, httpError(500))).toBe(false);
  });
});

describe('🔴 T4 · 루트 레이아웃 — 토스트 호스트 배선 (D19)', () => {
  it('루트 트리에 토스트가 뜨고, SplashGate 도 그대로 그려진다', () => {
    render(<RootLayout />);

    act(() =>
      Toast.showToast({ message: '루트 확인', testID: 'root-probe-toast' })
    );

    expect(screen.getByTestId('root-probe-toast')).toBeOnTheScreen();
    expect(screen.getByTestId('query-client-probe')).toBeOnTheScreen();
  });
});

describe('🔴 상황 감지 FE-A · 루트 레이아웃 — 포그라운드 푸시 표시 정책 배선', () => {
  it('번들을 불러온 시점에 표시 정책을 정확히 한 번 설치한다(렌더를 기다리지 않는다)', () => {
    // 실행은 파일 머리의 require('@routes/_layout') 다 — 이 describe 앞의 렌더 여러 번과 무관하게 1회여야 모듈 최상위 설치다.
    // 정책 내용(배너·목록 표시)은 shared/push/receive.test 가 본다. 실제 배너는 6-b 실기(T-RD-2).
    expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
  });
});
