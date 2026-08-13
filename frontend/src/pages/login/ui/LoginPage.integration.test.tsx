import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';

import { server } from '@/mocks/server';
import { resetScenario, setScenario } from '@/mocks/scenarios';
import { LoginPage } from './LoginPage';

/**
 * AC-W-07·09·10·16 · LoginPage — 소셜 로그인 배선 통합테스트.
 *
 * 무엇을 보장하나: `(auth)/login` 이 렌더하는 컨테이너가 실 `useSocialLogin` 을 구독하고,
 *  버튼 탭 → makeAuthorize(fake) 주입 → 실 postSocialLogin → axios → **MSW** 응답까지
 *  실제 경로를 태워서
 *  (07) 훅 상태가 화면으로 흐르고,
 *  (09) success/needs-age/error/conflict/cancel 전이가 실제 화면 변화로 관찰되며,
 *  (10) 성공 시 부트스트랩 재평가로 게이트('/')로 복귀하고(D3),
 *  (16) 409 conflict 는 provider "코드"(kakao)를 노출하고 onConflictContinue 가 그 코드로 재로그인한다.
 *
 * 이 스위트는 flag(--experimental-vm-modules) 없이 도는 `.integration.test` 버킷이다(MSW 는 ESM 이라
 * flag 아래서 못 뜬다 — 02 §테스트 인프라 참조). 실 axios→MSW 경로가 핵심이므로 @/shared/api 는
 * 목킹하지 않는다(기존 57 유닛테스트의 jest.mock 과 무관 — 회귀 0).
 *
 * 3동작: 준비(시나리오 set) → 실행(소셜 버튼 press) → 단언(화면 전이 / 라우팅 / 요청 경로).
 */

// @gorhom/bottom-sheet 은 통과 컴포넌트로 목킹(수동 목: __mocks__/@gorhom/bottom-sheet.tsx).
jest.mock('@gorhom/bottom-sheet');

// 토큰 저장은 native secure-store 라 목킹 — 배선 관심사는 axios→MSW 경로지 저장 계층이 아니다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
}));

// expo-router 는 라우터 컨텍스트 없이 replace 만 관찰하면 되므로 목킹.
// useRouter().replace 와 router.replace 가 같은 fn 을 공유 → 컨테이너가 무엇을 쓰든 관찰된다.
jest.mock('expo-router', () => {
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ replace, push: jest.fn(), back: jest.fn() }),
    router: { replace, push: jest.fn(), back: jest.fn() },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockReplace = require('expo-router').router.replace as jest.Mock;

const socialRequests: string[] = [];

beforeAll(() => {
  process.env.EXPO_PUBLIC_AUTH_FAKE = '1';
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (pathname.includes('/auth/social/')) {
      socialRequests.push(pathname);
    }
  });
});

beforeEach(() => {
  socialRequests.length = 0;
  mockReplace.mockClear();
  // 가짜 인가 결과의 출처는 env 다(게이트①-2 계약 — makeAuthorize 는 @/mocks 를 참조하지 않는다).
  // 미지정 = success 이므로 매 테스트 전에 지워 기본값으로 되돌린다.
  delete process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME;
});

afterEach(() => {
  server.resetHandlers();
  resetScenario();
  delete process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME;
});

afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});

describe('LoginPage — 상태↔화면 배선 (AC-W-07)', () => {
  it('컨테이너가 SocialLoginScreen 을 렌더하고 초기(idle) 상태로 브랜드·소셜 4버튼을 노출한다', () => {
    setScenario('login-success-existing');

    render(<LoginPage />);

    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-google')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-apple')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-kakao')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-naver')).toBeOnTheScreen();
  });

  it('어떤 요소도 소요시간(duration)을 표시하지 않는다 (INV-3 · AC-W-14)', () => {
    setScenario('login-success-existing');
    render(<LoginPage />);
    expect(screen.queryByText(/소요\s*시간|duration/i)).toBeNull();
  });
});

describe('LoginPage — fake×MSW 결합 전이 (AC-W-09)', () => {
  it('성공(기존) → 부트스트랩 재평가로 게이트("/")로 복귀한다 (AC-W-10 · D3)', async () => {
    setScenario('login-success-existing');
    render(<LoginPage />);

    fireEvent.press(screen.getByTestId('auth-login-google'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(socialRequests).toContain('/api/v1/auth/social/google');
  });

  /**
   * TRIP-248 D3 · AC-13 의 화면 관측. 이전 판은 여기서 구글 버튼으로 연령확인 시트를 기대했는데,
   * 그건 목이 신규 첫 요청에 200 을 주던 시절의 흐름이다. 실서버는 400 으로 거절하고, code
   * 갈래(구글)는 인가코드가 이미 소진돼 재전송할 수 없으므로 이 칸에서는 error 로 남긴다(D0·D3).
   *
   * ⚠️ code 갈래 재인가를 붙이는 칸에서는 이 기대가 뒤집힌다(배너 → 시트). 영구 규칙이 아니다.
   * 카카오(token 갈래)가 시트까지 가는 것은 LoginPage.ageGate.integration.test.tsx 가 본다.
   */
  it('신규 판정이라도 code 갈래(구글)는 시트가 아니라 에러 배너를 띄운다', async () => {
    setScenario('login-success-new');
    render(<LoginPage />);

    fireEvent.press(screen.getByTestId('auth-login-google'));

    await waitFor(() =>
      expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen()
    );
    // 완결 불가능한 흐름(확인 후 반드시 401)으로 사용자를 끌고 가지 않는다.
    expect(screen.queryByTestId('auth-age-sheet')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('401 인증 실패 → 에러 배너(auth-login-error-banner)를 보여준다', async () => {
    setScenario('login-error-auth');
    render(<LoginPage />);

    fireEvent.press(screen.getByTestId('auth-login-google'));

    await waitFor(() =>
      expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen()
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('사용자 취소(cancel) → 취소 안내를 보여주고 서버를 호출하지 않는다', async () => {
    // 인가 결과(cancel)는 env 로, 서버 거동은 시나리오로 — 출처가 분리됐다(게이트①-2 계약).
    process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME = 'cancel';
    setScenario('login-success-existing');
    render(<LoginPage />);

    fireEvent.press(screen.getByTestId('auth-login-google'));

    await waitFor(() =>
      expect(screen.getByTestId('auth-login-cancel-notice')).toBeOnTheScreen()
    );
    expect(socialRequests).toHaveLength(0);
  });
});

describe('LoginPage — 409 이메일 충돌·재로그인 (AC-W-09 · AC-W-16)', () => {
  it('409 는 충돌 바텀시트를 띄우고 기존 provider 를 한글 표시명(카카오)으로 노출한다', async () => {
    setScenario('login-email-conflict');
    render(<LoginPage />);

    fireEvent.press(screen.getByTestId('auth-login-google'));

    await waitFor(() =>
      expect(screen.getByTestId('auth-login-conflict-sheet')).toBeOnTheScreen()
    );
    // TRIP-352 정본 정합: conflictProvider 는 서버 코드(kakao)로 흘러 들어오지만, 화면은
    // 코드 원문을 감추고 한글 표시명("카카오")으로 옮겨 보여준다(AC-C2 · BR-U0-04). 코드→
    // 엔드포인트 라우팅은 코드 그대로라는 계약은 아래 onConflictContinue 테스트가 따로 잠근다.
    expect(screen.getByTestId('auth-login-conflict-message')).toHaveTextContent(
      /카카오/
    );
    expect(screen.queryByText(/kakao/)).toBeNull();
  });

  it('onConflictContinue 는 conflictProvider 코드(kakao)로 재로그인을 트리거한다', async () => {
    setScenario('login-email-conflict');
    render(<LoginPage />);

    fireEvent.press(screen.getByTestId('auth-login-google'));
    await waitFor(() =>
      expect(
        screen.getByTestId('auth-login-conflict-continue')
      ).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('auth-login-conflict-continue'));

    // 재로그인 요청이 표시명이 아니라 코드 엔드포인트(/auth/social/kakao)로 나간다.
    await waitFor(() =>
      expect(socialRequests).toContain('/api/v1/auth/social/kakao')
    );
  });
});

describe('LoginPage — 네트워크 실패(백엔드 미기동) 관통 (AC-S6 · 결함 F · 케이스 33)', () => {
  it('응답 자체가 없으면(HttpResponse.error()) 화면에 실패 배너가 뜨고 게이트로 보내지 않는다', async () => {
    // 준비 — 인가는 fake success 로 통과시키고, 소셜 로그인 엔드포인트만 "응답 자체 없음"으로
    // 덮어쓴다. HttpResponse.error() 는 네트워크 실패를 흉내낸다(상태코드 500과 다르다 — axios
    // 의 error.response 가 undefined 가 되어 normalizeSocialError 가 NETWORK_ERROR 로 정규화한다).
    // 이 덮어쓰기는 afterEach 의 server.resetHandlers() 가 자동으로 되돌린다.
    setScenario('login-success-existing');
    server.use(
      http.post('http://localhost:8080/api/v1/auth/social/:provider', () =>
        HttpResponse.error()
      )
    );
    render(<LoginPage />);

    // 실행
    fireEvent.press(screen.getByTestId('auth-login-google'));

    // 단언 — 지금은 NETWORK_ERROR 가 SocialLoginScreen 의 어느 분기에도 안 걸려 화면이
    // 침묵한다. waitFor 가 타임아웃으로 실패한다(도커 미기동 상황의 실제 재현).
    await waitFor(() =>
      expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('auth-login-error-banner')).toHaveTextContent(
      '로그인에 실패했어요. 잠시 후 다시 시도해 주세요'
    );
    // 실패했는데 게이트('/')로 보내면 안 된다.
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
