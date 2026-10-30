import { act, render, screen, waitFor } from '@testing-library/react-native';

import {
  expoWebBrowserModule,
  resetExpoAuthSessionMock,
} from '@/test-support/expoAuthSessionMock';
import { routerSpies } from '@/test-support/expoRouterMock';

import { OAuthRedirectPage } from '..';

/**
 * TRIP-1649 · AC-W3-8~10 — 소셜 로그인 팝업이 돌아오는 자리 `/oauth/{provider}` 의 중계 화면.
 *
 * 무엇을 보장하나:
 *  - 웹: 화면이 뜨면 expo-web-browser 의 `maybeCompleteAuthSession` 을 호출한다(원 창에 결과를 넘기고 팝업을 닫게 하는 호출).
 *  - 진행 중인 로그인이 없다고 답하면(`failed` — 주소창으로 직접 들어옴·새로고침) 홈(`/`)으로 보낸다. `success` 면 보내지 않는다
 *    (원 창이 팝업을 닫는 중이라 여기서 이동하면 방해다).
 *  - 네이티브(iOS)에서는 expo-web-browser 를 부르지 않고 곧장 `/` 로 보낸다 — iOS 앱에도 이 라우트가 생기지만 쓰이지 않는다.
 *
 * 커버하지 않는 것: 실제 팝업→원 창 postMessage·팝업 닫힘(브라우저 몫), 스플래시 지연(`SplashGate`), `maybeCompleteAuthSession` 이
 *   동기로 던지는 경우의 처리(브리프 미규정 — 구현 판단), 라우트 파일이 이 화면을 그리는지(`src/__tests__/oauthRedirectRoute.test.tsx` — pages 테스트는 라우트를 import 할 수 없다).
 *
 * (개념) 아래 `jest.mock('../lib/completeAuthSession', …)` 은 "이 모듈 자리에 다른 모듈을 끼운다". jest-expo 는 iOS 기준이라
 *   `.web.ts` 를 자동으로 고르지 않으므로, 케이스마다 웹본(`.web`)/네이티브본을 골라 위임해 두 파일을 실제로 태운다.
 *   외부 라이브러리(expo-web-browser)만 목이고 우리 코드는 진짜다.
 * 3동작: 준비(웹/네이티브 선택·라이브러리 응답) → 실행(렌더) → 단언(호출 횟수·`router.replace`).
 */

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['replace'],
    router: ['replace'],
    params: () => ({ provider: 'google' }),
  })
);
jest.mock(
  'expo-web-browser',
  () => require('@/test-support/expoAuthSessionMock').expoWebBrowserModule,
  { virtual: true }
);

// `mock` 접두사 변수만 팩토리에서 참조할 수 있다(jest 규칙). 호출 시점에 읽으므로 케이스마다 바꿔도 된다.
let mockUseWebVariant = false;
jest.mock('../lib/completeAuthSession', () => ({
  completeAuthSession: () => {
    const actual = mockUseWebVariant
      ? jest.requireActual('../lib/completeAuthSession.web')
      : jest.requireActual('../lib/completeAuthSession');
    return actual.completeAuthSession();
  },
}));

const maybeComplete = expoWebBrowserModule.maybeCompleteAuthSession;

// 모듈 싱글턴(라우터 스파이·웹브라우저 스파이·변형 스위치)은 파일 최상위에서 되돌린다.
afterEach(() => {
  mockUseWebVariant = false;
  routerSpies.replace.mockClear();
  resetExpoAuthSessionMock();
});

describe('OAuthRedirectPage — 웹 (AC-W3-8·9)', () => {
  beforeEach(() => {
    mockUseWebVariant = true;
  });

  it('화면이 뜨면 maybeCompleteAuthSession 을 한 번 호출한다', async () => {
    maybeComplete.mockReturnValueOnce({ type: 'success' });
    // "아직 없다" 앵커 — 렌더 전에는 호출도 이동도 없다.
    expect(maybeComplete).not.toHaveBeenCalled();

    render(<OAuthRedirectPage />);

    expect(screen.getByTestId('oauth-redirect-page')).toBeTruthy();
    await waitFor(() => expect(maybeComplete).toHaveBeenCalledTimes(1));
  });

  it('진행 중인 로그인이 없으면(failed) 홈 "/" 으로 보낸다', async () => {
    maybeComplete.mockReturnValueOnce({ type: 'failed' });
    expect(routerSpies.replace).not.toHaveBeenCalled();

    render(<OAuthRedirectPage />);

    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
    expect(routerSpies.replace).toHaveBeenCalledWith('/');
  });

  it('성공(success)이면 이동하지 않는다 — 원 창이 팝업을 닫는다', async () => {
    maybeComplete.mockReturnValueOnce({ type: 'success' });

    render(<OAuthRedirectPage />);

    await waitFor(() => expect(maybeComplete).toHaveBeenCalledTimes(1));
    // 비동기로 짜인 구현이 뒤늦게 이동하는 것까지 기다린 뒤에 "없다"를 본다(안 기다리면 거짓 green).
    await act(async () => {});
    expect(routerSpies.replace).not.toHaveBeenCalled();
  });
});

describe('OAuthRedirectPage — 네이티브 (AC-W3-10)', () => {
  it('expo-web-browser 를 부르지 않고 홈 "/" 으로 보낸다', async () => {
    render(<OAuthRedirectPage />);

    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
    expect(routerSpies.replace).toHaveBeenCalledWith('/');
    expect(maybeComplete).not.toHaveBeenCalled();
  });
});

describe('completeAuthSession 쌍', () => {
  it('네이티브본과 웹본이 같은 이름을 내보낸다 (번들러가 어느 쪽을 골라도 호출부가 같다)', () => {
    const native = jest.requireActual('../lib/completeAuthSession');
    const web = jest.requireActual('../lib/completeAuthSession.web');

    expect(Object.keys(native)).toEqual(['completeAuthSession']);
    expect(Object.keys(web)).toEqual(Object.keys(native));
  });
});
