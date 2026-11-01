import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import {
  expoWebBrowserModule,
  resetExpoAuthSessionMock,
} from '@/test-support/expoAuthSessionMock';
import { routerSpies } from '@/test-support/expoRouterMock';

import { OAuthRedirectPage } from '..';

/**
 * TRIP-1650 · AC-W4-SEC-1·SEC-3 — 소셜 로그인 팝업이 돌아오는 `/oauth/naver` 의 보안.
 *
 * (개념) 네이버 implicit 은 토큰이 주소의 `#access_token=…`(fragment)로 돌아온다. fragment 는 서버로 안 가지만 **주소창·방문 기록에 그대로 남는다**.
 *   그래서 결과를 원 창에 넘긴 즉시 `history.replaceState` 로 주소에서 지운다 — 새 히스토리 항목 없이 현재 항목의 주소만 바꾸는 브라우저 API.
 *
 * 무엇을 보장하나:
 *  - 웹: 원 창에 결과를 넘기는 `maybeCompleteAuthSession` 이 **토큰이 아직 주소에 있는 상태로** 읽은 뒤에, 주소의 `#…` 만 지워진다
 *    (먼저 지우면 원 창이 토큰을 못 받아 로그인이 영영 안 된다). 진행 중인 로그인이 없어 `failed` 로 홈에 보내는 경우도,
 *    결과 전달이 던지는 경우도 fragment 는 남지 않는다.
 *  - 네이티브(iOS): history 를 건드리지 않는다.
 *  - 이 페이지의 렌더 트리는 외부 URL·이미지·웹뷰를 쓰지 않는다 (리퍼러·서드파티로 fragment 가 새는 길을 렌더 쪽에서 막는다).
 *
 * 커버하지 않는 것: 실제 팝업↔원 창 postMessage·팝업 닫힘, HTML 껍데기의 `<script>`·`<link>`·폰트 로더·Sentry 비콘 같은 외부 요청
 *   (jest 가 못 본다 — [검증] 헤드리스 네트워크 실측), expo-router 가 마운트 중 해시를 먼저 지우는지.
 *
 * (개념) 아래 가짜 브라우저 = `globalThis.location`·`history` 를 이 테스트 동안만 끼운 것. jest 에는 둘 다 없다.
 *   `replaceState` 만 주소를 바꾸고, `location.hash=…`·`location.replace` 는 일부러 없다 — 그렇게 지우는 구현은 실브라우저에서 `#` 가 남거나 재탐색이라 TypeError 로 잡는다.
 * 3동작: 준비(가짜 브라우저·웹본/네이티브본 선택·maybeComplete 응답) → 실행(렌더) → 단언(주소·호출 순서·router.replace).
 */

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['replace'],
    router: ['replace'],
    params: () => ({ provider: 'naver' }),
  })
);
jest.mock(
  'expo-web-browser',
  () => require('@/test-support/expoAuthSessionMock').expoWebBrowserModule,
  { virtual: true }
);

// `mock` 접두사 변수만 팩토리에서 참조할 수 있다(jest 규칙). 호출 시점에 읽으므로 케이스마다 바꿔도 된다.
// jest-expo 는 iOS 기준이라 `.web.ts` 를 자동으로 고르지 않는다 — 케이스마다 웹본/네이티브본에 위임해 두 파일을 실제로 태운다.
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

// 테스트용 가짜 값 — 실제 토큰 아님.
const TOKEN = 'SECRET-TOKEN-7Q2X';
const CALLBACK_URL = `https://app.example/oauth/naver#access_token=${TOKEN}&state=abc123&token_type=bearer&expires_in=3600`;

interface FakeBrowser {
  location: {
    readonly href: string;
    readonly origin: string;
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
  };
  history: { replaceState: jest.Mock; pushState: jest.Mock };
}

/** 주소 한 줄을 들고 `replaceState`/`pushState` 로만 바뀌는 가짜 브라우저를 심는다. URL 클래스는 안 쓴다(RN 폴리필이 불완전). */
function installFakeBrowser(initialHref: string): FakeBrowser {
  let href = initialHref;
  const parts = () => {
    const match = /^(https?:\/\/[^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(href);
    return {
      origin: match?.[1] ?? '',
      pathname: match?.[2] ?? '',
      search: match?.[3] ?? '',
      hash: match?.[4] ?? '',
    };
  };
  /** 브라우저가 상대 주소를 푸는 방식 흉내 — 빈 문자열은 현재 주소에서 fragment 를 뗀 것. */
  const resolve = (url: string): string => {
    const { origin, pathname, search } = parts();
    if (/^https?:\/\//.test(url)) return url;
    if (url.startsWith('/')) return origin + url;
    if (url.startsWith('?')) return origin + pathname + url;
    if (url.startsWith('#')) return origin + pathname + search + url;
    return origin + pathname + search;
  };
  const change = (_state: unknown, _title: string, url?: string | null) => {
    if (url !== undefined && url !== null) href = resolve(url);
  };
  const location = {
    get href() {
      return href;
    },
    get origin() {
      return parts().origin;
    },
    get pathname() {
      return parts().pathname;
    },
    get search() {
      return parts().search;
    },
    get hash() {
      return parts().hash;
    },
  };
  const history = {
    replaceState: jest.fn(change),
    pushState: jest.fn(change),
  };
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: location,
  });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: history,
  });
  return { location, history };
}

// 모듈 싱글턴(가짜 브라우저·Platform·변형 스위치·스파이)은 파일 최상위 afterEach 에서 되돌린다.
let restorePlatform: (() => void) | null = null;
afterEach(() => {
  restorePlatform?.();
  restorePlatform = null;
  delete (globalThis as { location?: unknown }).location;
  delete (globalThis as { history?: unknown }).history;
  mockUseWebVariant = false;
  routerSpies.replace.mockClear();
  resetExpoAuthSessionMock();
});

/** 웹으로 바꾼다 — 웹본 completeAuthSession 을 고르고 Platform 도 web 으로(구현이 어느 쪽에서 지워도 이 환경이 웹이다). */
function asWeb(): void {
  mockUseWebVariant = true;
  const replaced = jest.replaceProperty(Platform, 'OS', 'web');
  restorePlatform = () => replaced.restore();
}

describe('OAuthRedirectPage — 웹: 결과를 넘긴 뒤 주소에서 토큰 fragment 를 지운다 (AC-W4-SEC-1)', () => {
  it('성공: 원 창에 넘길 때는 토큰이 주소에 있었고, 그 뒤에 주소가 fragment 없이 바뀐다', async () => {
    asWeb();
    const browser = installFakeBrowser(CALLBACK_URL);
    let hrefSeenByLibrary = '';
    maybeComplete.mockImplementationOnce(() => {
      // 실 라이브러리가 하는 일: 이 순간의 location.href 를 읽어 원 창에 넘긴다.
      hrefSeenByLibrary = browser.location.href;
      return { type: 'success' };
    });
    // "아직 없다" 앵커 — 렌더 전에는 주소에 토큰이 그대로 있고 history 는 손대지 않았다.
    expect(browser.location.hash).toContain('access_token');
    expect(browser.history.replaceState).not.toHaveBeenCalled();

    render(<OAuthRedirectPage />);

    await waitFor(() => expect(maybeComplete).toHaveBeenCalledTimes(1));
    // 비동기로 짜인 구현이 뒤늦게 지우는 것까지 기다린 뒤에 본다.
    await act(async () => {});
    // ① 넘기는 시점엔 아직 있었다(먼저 지우면 로그인이 안 된다)
    expect(hrefSeenByLibrary).toContain(`access_token=${TOKEN}`);
    // ② 그 뒤에 지워졌다 — 토큰·state 만 아니라 `#` 자체도 없다
    expect(browser.location.href).toBe('https://app.example/oauth/naver');
    expect(browser.location.hash).toBe('');
    // ③ 순서: replaceState 는 maybeComplete 호출보다 뒤
    expect(browser.history.replaceState).toHaveBeenCalledTimes(1);
    expect(
      browser.history.replaceState.mock.invocationCallOrder[0]
    ).toBeGreaterThan(maybeComplete.mock.invocationCallOrder[0]);
    // ④ 새 히스토리 항목을 만들지 않고, 넘긴 주소에도 토큰·`#` 가 없다
    expect(browser.history.pushState).not.toHaveBeenCalled();
    const urlArg = browser.history.replaceState.mock.calls[0][2];
    expect(String(urlArg)).not.toContain('#');
    expect(String(urlArg)).not.toContain(TOKEN);
    // ⑤ 성공이면 이동하지 않는다(원 창이 팝업을 닫는 중)
    expect(routerSpies.replace).not.toHaveBeenCalled();
  });

  it('진행 중인 로그인이 없어도(failed — 주소창 직접 접근) fragment 는 지우고 홈으로 보낸다', async () => {
    asWeb();
    const browser = installFakeBrowser(CALLBACK_URL);
    maybeComplete.mockReturnValueOnce({ type: 'failed' });

    render(<OAuthRedirectPage />);

    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
    expect(routerSpies.replace).toHaveBeenCalledWith('/');
    expect(browser.location.href).toBe('https://app.example/oauth/naver');
    expect(browser.history.replaceState).toHaveBeenCalled();
  });

  it('결과 전달이 던져도(원 창을 잃음) fragment 는 주소에 남지 않는다', async () => {
    asWeb();
    const browser = installFakeBrowser(CALLBACK_URL);
    maybeComplete.mockImplementationOnce(() => {
      throw new Error('opener lost');
    });
    // 던진 에러는 React 가 console.error 로 보고한다 — 이 케이스 안에서만 막아 소음 예산을 지킨다.
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      render(<OAuthRedirectPage />);
    } catch {
      // 구현이 다시 던지든 삼키든 상관없다 — 본 것은 주소다.
    } finally {
      consoleError.mockRestore();
    }

    expect(browser.location.hash).toBe('');
    expect(browser.location.href).toBe('https://app.example/oauth/naver');
  });
});

describe('OAuthRedirectPage — 네이티브 대조 (AC-W4-SEC-1)', () => {
  it('iOS: history 를 건드리지 않는다 (네이티브엔 주소창이 없다)', async () => {
    const browser = installFakeBrowser(CALLBACK_URL);

    render(<OAuthRedirectPage />);

    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));
    expect(browser.history.replaceState).not.toHaveBeenCalled();
    expect(browser.history.pushState).not.toHaveBeenCalled();
  });
});

describe('OAuthRedirectPage — 외부 리소스를 렌더하지 않는다 (AC-W4-SEC-3, 렌더 가능분)', () => {
  it('렌더 트리에 http(s) 주소·Image·WebView 가 없다', async () => {
    render(<OAuthRedirectPage />);
    await waitFor(() => expect(routerSpies.replace).toHaveBeenCalledTimes(1));

    // 앵커 — 빈 트리로 헛 통과하지 않는다.
    expect(screen.getByText('로그인 확인 중…')).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).not.toMatch(/https?:\/\//);
    expect(tree).not.toMatch(/"type":"(Image|ImageBackground|WebView)"/);
  });
});
