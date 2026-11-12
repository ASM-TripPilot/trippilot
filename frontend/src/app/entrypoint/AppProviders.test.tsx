import type { ComponentType } from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import {
  MutationObserver,
  QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { AxiosError } from 'axios';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { useNavigationContainerRef } from 'expo-router';

import {
  getObservedQueryClient,
  resetObservedQueryClient,
} from '@/test-support/queryClientProbe';
import {
  capturedEvents,
  resetSentryReportMock,
} from '@/test-support/sentryReactNativeMock';

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
// TRIP-1743 — DSN 이 있는 네이티브 부팅으로 로드한다(아래 「Sentry 추적 배선」 describe). 루트가 Sentry 대역 View 로 한 겹 더 감싸질 뿐
// 다른 describe 의 단언(testID·within)에는 영향이 없다. DSN 이 없을 때의 통과 동작은 SentryRoot.test 가 본다.
process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@example.invalid/1';

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

// TRIP-1743 — 실물 SDK 는 init·통합 생성이 네이티브를 부른다. 호출 기록용 공용 대역(wrap 은 testID `sentry-wrap` View 로 감싼다).
jest.mock('@sentry/react-native', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/sentryReactNativeMock')
);

// TRIP-1743 — 실물 expo-router 는 이 버킷에서 로드되지 않는다(@react-navigation/native 가 아래 대역이라 createNavigatorFactory 가 없다).
// 추적이 켜졌을 때 SentryRoot 가 부르는 훅 하나만 둔다 — 같은 ref 객체를 돌려준다.
jest.mock('expo-router', () => {
  const ref = { current: null };
  return { useNavigationContainerRef: jest.fn(() => ref) };
});

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
  resetSentryReportMock();
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

  // TRIP-1677 AC-8 — 429(요청 한도)는 다시 물으면 한도를 더 소진해 N+1 이 N 배가 된다. 앱 전역 기본값이 429 도 첫 실패부터 멈춘다.
  // (jest 클라이언트는 retry:false 라 실제 재시도 간격은 못 본다 — 전역 함수의 답까지만 잠그고 실동작은 6-b.)
  it('🔴 TRIP-1677 · 429 는 첫 실패부터 다시 묻지 않는다 (500 은 그대로 묻는다)', () => {
    render(<RootLayout />);
    const retryFn = getObservedQueryClient()?.getDefaultOptions().queries
      ?.retry as (failureCount: number, error: unknown) => boolean;

    expect(retryFn(0, httpError(429))).toBe(false);
    expect(retryFn(1, httpError(429))).toBe(false);
    // 짝 — 429 만 뺀 것이지 전부 끈 것이 아니다.
    expect(retryFn(0, httpError(500))).toBe(true);
  });
});

// TRIP-1714 — 앱이 쓰는 클라이언트의 "복귀(포그라운드) 때 낡은 쿼리를 다시 받을까" 기본값. 키마다 다르게 답해야 하므로 함수다.
// 거부 목록 키(카탈로그·본인 편집이 직접 무효화하는 키)는 false, 그 밖 전부는 기본 true. 기대값은 경로 문자열을 손으로 적는다 —
// 구현의 상수를 import 하면 구현이 틀려도 같이 틀려 항상 green 이 된다. 판정은 키 이름이 정확히 같을 때만이다
// (`/places` 를 끈다고 `/places/p1`·`/me` 를 끈다고 `/me/settings` 까지 꺼지면 안 된다 — 접두 일치 오답 차단).
describe('🔴 TRIP-1714 · 앱 전역 QueryClient 복귀 재조회 정책 (AC2 · AC6)', () => {
  /** 부팅된 앱의 기본값으로 "이 키가 복귀 때 다시 받아지나"를 묻는다. 기본값을 안 건드렸으면(undefined) 라이브러리 기본 true. */
  function refetchesOnFocus(queryKey: QueryKey): boolean | 'always' {
    render(<RootLayout />);
    const client = getObservedQueryClient();
    const option = client?.getDefaultOptions().queries?.refetchOnWindowFocus;
    if (client === null || client === undefined) {
      throw new Error('프로브가 QueryClient 를 못 받았다');
    }
    if (option === undefined) return true;
    if (typeof option !== 'function') return option;
    // 실제 Query 객체를 캐시에서 만들어 함수에 넘긴다(가짜 모양 객체가 아니라 라이브러리가 쓰는 그것).
    return option(client.getQueryCache().build(client, { queryKey }));
  }

  it.each<[string, QueryKey]>([
    ['/me', ['/me']],
    ['/me/profile', ['/me/profile']],
    ['/me/style', ['/me/style']],
    ['/me/records', ['/me/records']],
    ['/saved-places', ['/saved-places']],
    ['/saved-stays', ['/saved-stays']],
    ['/stays/search (파라미터 있어도)', ['/stays/search', { q: '해운대' }]],
    ['/regions', ['/regions']],
    ['/places (객체 파라미터 키)', ['/places', { region: '부산', limit: 200 }]],
    [
      '/places/multi (지역 배열 키)',
      ['/places/multi', ['서울', '부산', '제주'], null, '', null],
    ],
  ])('복귀 때 다시 받지 않는다 — %s', (_name, queryKey) => {
    expect(refetchesOnFocus(queryKey)).toBe(false);
  });

  it('staleTime 30초 · gcTime 10분 · 재연결 재조회는 건드리지 않았다 (선제 green)', () => {
    render(<RootLayout />);
    const queries = getObservedQueryClient()?.getDefaultOptions().queries;

    expect(queries?.staleTime).toBe(30_000);
    expect(queries?.gcTime).toBe(10 * 60_000);
    // 라이브러리 기본(true)을 쓰려면 지정하지 않는다 — 이 칸은 reconnect 를 바꾸지 않는다(관측만).
    expect(queries?.refetchOnReconnect).toBeUndefined();
  });

  it.each<[string, QueryKey]>([
    ['/trips (여행 목록)', ['/trips']],
    [
      '일정 /trips/{id}/itinerary (생성 감시·진행 중 여행)',
      ['/trips/t1/itinerary'],
    ],
    ['/trips/{id} (탭 위 스택 화면 — 범위 밖 무변경)', ['/trips/t1']],
    ['/places/{id} (d06 단건 — /places 접두 오답 차단)', ['/places/p1']],
    ['/saved-stays/{id} (/saved-stays 접두 오답 차단)', ['/saved-stays/s1']],
    ['/me/settings (/me 접두 오답 차단)', ['/me/settings']],
    ['목록에 없는 임의 키', ['/unlisted-probe']],
  ])('복귀 때 기본대로 다시 받는다 (선제 green) — %s', (_name, queryKey) => {
    expect(refetchesOnFocus(queryKey)).toBe(true);
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

/**
 * TRIP-1743 · B5 — AppProviders 가 `initSentry()` 를 번들 로드 때 한 번 부르고, 그 결과로 앱 전체(가장 바깥)를 `SentryRoot` 로 감싼다.
 * 무엇을 보장하나: ① Sentry init 은 로드 때 1번(렌더마다 다시 부르지 않는다) ② 렌더된 트리의 최상위가 `Sentry.wrap` 결과이고 앱 트리가 그 안에 있다
 * ③ 네비게이션 통합에 expo-router ref 가 등록된다(마운트마다 1번). 이 셋 중 하나라도 빠지면 SentryRoot·initSentry 단위 테스트가 전부 green 인 채로
 * 추적이 조용히 꺼진다 — 그 연결고리를 여기서 잠근다. 커버하지 않는 것: 실제 트랜잭션이 나가는지(6-b).
 * 3동작: 준비(파일 머리의 DSN·대역) → 실행(render) → 단언(트리 최상위·대역 호출 기록).
 */
describe('🔴 TRIP-1743 · 루트 레이아웃 — Sentry 추적 배선', () => {
  const navigationIntegration = () =>
    (Sentry.reactNavigationIntegration as jest.Mock).mock.results[0]?.value as {
      registerNavigationContainer: jest.Mock;
    };

  beforeEach(() => {
    navigationIntegration()?.registerNavigationContainer.mockClear();
  });

  it('번들을 불러온 시점에 Sentry 를 정확히 한 번 init 하고, 렌더로 다시 부르지 않는다', () => {
    // 실행은 파일 머리의 require('@routes/_layout') 다 — 앞선 describe 들의 렌더 여러 번과 무관하게 1회여야 모듈 최상위 호출이다.
    const { rerender } = render(<RootLayout />);
    rerender(<RootLayout />);

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(Sentry.reactNavigationIntegration).toHaveBeenCalledTimes(1);
  });

  it('렌더된 트리의 최상위가 Sentry.wrap 결과이고, 앱 트리(SplashGate 자리·테마)가 그 안에 있다', () => {
    render(<RootLayout />);

    // toJSON 의 최상위 호스트 = 가장 바깥. SentryRoot 가 제스처 루트 안쪽에 있거나 없으면 여기서 red.
    expect(screen.toJSON()).toMatchObject({ props: { testID: 'sentry-wrap' } });
    const wrapped = screen.getByTestId('sentry-wrap');
    expect(within(wrapped).getByTestId('query-client-probe')).toBeOnTheScreen();
    expect(
      within(wrapped).getByTestId('mock-theme-provider')
    ).toBeOnTheScreen();
  });

  it('네비게이션 통합에 expo-router ref 를 마운트마다 한 번 등록한다 (다시 그려도 늘지 않는다)', () => {
    const { rerender } = render(<RootLayout />);
    rerender(<RootLayout />);

    const register = navigationIntegration().registerNavigationContainer;
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0][0]).toBe(
      (useNavigationContainerRef as jest.Mock)()
    );
  });
});

/**
 * TRIP-1744 — 앱이 쥔 QueryClient 에 조회·변경 요청의 최종 실패 보고가 꽂혀 있다.
 * 무엇을 보장하나: AppProviders 가 `createAppQueryClient` 에 보고 함수를 넘기는 한 줄이 빠지거나 한쪽(조회/변경)만 넘기면 보고 단위 테스트가
 * 전부 green 인 채로 운영에서는 아무것도 안 올라간다 — 그 연결고리를 부팅된 앱의 클라이언트로 잠근다. 추적(sentryTracing) 상태와 무관하게
 * 보고된다는 것(DSN·웹 게이트 없음)은 `AppProviders.noDsn.test` 가 본다. 커버하지 않는 것: 보고 내용(reportQueryFailure.test)·실제 Sentry 수신(6-b).
 * 이벤트 창(5분)은 앱 모듈 전체가 공유하므로 이 describe 의 두 케이스는 서로 다른 지문(다른 API)을 쓴다.
 */
describe('루트 레이아웃 — 서버 요청 실패 보고 배선', () => {
  it('앱의 조회가 재시도 끝에 실패하면 breadcrumb 과 이벤트가 Sentry 로 간다', async () => {
    render(<RootLayout />);
    const client = getObservedQueryClient()!;
    let calls = 0;

    await client
      .fetchQuery({
        queryKey: ['/trips/t-wiring-1744/itinerary'],
        retryDelay: 0,
        queryFn: async () => {
          calls += 1;
          throw httpError(500);
        },
      })
      .catch(() => undefined);

    expect(calls).toBe(4);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(
      (Sentry.addBreadcrumb as jest.Mock).mock.calls[0][0].data
    ).toMatchObject({
      kind: 'query',
      key: '/trips/:id/itinerary',
      status: 500,
    });
    expect(capturedEvents()).toHaveLength(1);
  });

  it('앱의 변경 요청이 실패해도 보고된다 (조회와 따로 배선됐는지)', async () => {
    render(<RootLayout />);
    const client = getObservedQueryClient()!;

    await new MutationObserver(client, {
      mutationKey: ['putMePreferences'],
      mutationFn: async (_variables: { any: string }) => {
        throw httpError(500);
      },
    })
      .mutate({ any: 'thing' })
      .catch(() => undefined);

    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(
      (Sentry.addBreadcrumb as jest.Mock).mock.calls[0][0].data
    ).toMatchObject({ kind: 'mutation', key: 'putMePreferences', status: 500 });
    expect(capturedEvents()).toHaveLength(1);
  });
});
