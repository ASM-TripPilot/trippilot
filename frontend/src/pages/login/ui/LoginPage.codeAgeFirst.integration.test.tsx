import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import type { SocialProvider } from '@/shared/api';
import { server } from '@/mocks/server';
import { resetScenario, setScenario } from '@/mocks/scenarios';
import { LoginPage } from './LoginPage';

/**
 * TRIP-1035 AC-1 · AC-4 · AC-5 — code 갈래의 "인가 전 연령 시트"를 화면에서 본다.
 *
 * 무엇을 보장하나: 구글(code 갈래) 버튼을 누르면
 *  (AC-1) 브라우저 인가·서버 요청보다 **먼저** 연령 시트가 뜨고,
 *  (AC-4) 시트에서 취소하면 인가도 요청도 없이 로그인 화면(idle)으로 돌아오며 다시 누르면 다시 묻고,
 *  (AC-5) 확인했는데 서버가 만 14세 미만(422)이라 하면 연령 제한 시트가 뜬다.
 *
 * 버킷 — MSW 를 쓰므로 `*.integration.test.tsx`. 이 버킷은 fake 인가(EXPO_PUBLIC_AUTH_FAKE=1)로
 * 돌아 **모든 버튼이 code 갈래**다. token 갈래 무회귀는 LoginPage.ageGate(목)·LoginPage.apple(실
 * makeAuthorize) 두 파일이 본다.
 *
 * 3동작: 준비(시나리오) → 실행(버튼·시트 press) → 단언(화면 · 인가 호출 · 요청 경로).
 */

jest.mock('@gorhom/bottom-sheet');

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-router', () => {
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ replace, push: jest.fn(), back: jest.fn() }),
    router: { replace, push: jest.fn(), back: jest.fn() },
  };
});

/**
 * ★ 인가 호출을 세는 통과형 래퍼. fake 인가에는 스파이가 없어서 "인가 0회"를 볼 수 없고, 요청 0회만으로는
 * "인가는 불렀는데 결과를 버렸다"를 못 가른다. 실 makeAuthorize 를 그대로 부르고 호출만 기록한다.
 * 갈래 표지 flow 는 실함수 값을 **명시적으로** 옮긴다(속성 전체 복사는 비열거 속성을 놓친다).
 * jest.mock 팩토리 안의 바깥 변수는 이름이 `mock` 으로 시작해야 허용된다.
 */
const mockAuthorizeCalls: string[] = [];
jest.mock('@/features/auth/lib/makeAuthorize', () => {
  const actual = jest.requireActual<
    typeof import('@/features/auth/lib/makeAuthorize')
  >('@/features/auth/lib/makeAuthorize');
  return {
    makeAuthorize: (provider: SocialProvider) => {
      const real = actual.makeAuthorize(provider);
      return Object.assign(
        async () => {
          mockAuthorizeCalls.push(provider);
          return real();
        },
        { flow: real.flow }
      );
    },
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
  mockAuthorizeCalls.length = 0;
  mockReplace.mockClear();
  delete process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME;
});

afterEach(() => {
  server.resetHandlers();
  resetScenario();
});

afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});

describe('TRIP-1035 AC-1 · 구글을 누르면 인가 전에 연령 시트가 뜬다', () => {
  it('시트가 뜨고, 그 시점까지 인가 0회 · 서버 요청 0회 · 실패 배너 없음', async () => {
    // 준비 — 신규 가입자(선언 없이 보내면 서버가 400 을 주는 시나리오).
    setScenario('login-success-new');
    render(<LoginPage />);

    // 실행
    fireEvent.press(screen.getByTestId('auth-login-google'));

    // 단언 — 긍정 앵커(시트)를 먼저 세운 뒤 부정을 본다.
    expect(await screen.findByTestId('auth-age-sheet')).toBeOnTheScreen();
    expect(mockAuthorizeCalls).toEqual([]);
    expect(socialRequests).toEqual([]);
    expect(screen.queryByTestId('auth-login-error-banner')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('TRIP-1035 AC-4 · 시트에서 취소하면 아무것도 나가지 않는다', () => {
  it('취소 → 시트가 닫히고 idle(버튼만, 배너·취소 안내 없음), 인가·요청 0회. 다시 누르면 다시 묻는다', async () => {
    // 준비
    setScenario('login-success-new');
    render(<LoginPage />);
    fireEvent.press(screen.getByTestId('auth-login-google'));
    fireEvent.press(await screen.findByTestId('auth-age-sheet-cancel'));

    // 단언 1 — idle 로 돌아왔다(BR-U0-06: 계정 미생성·안내 후 로그인 화면).
    await waitFor(() =>
      expect(screen.queryByTestId('auth-age-sheet')).toBeNull()
    );
    expect(screen.getByTestId('auth-login-google')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-login-error-banner')).toBeNull();
    expect(screen.queryByTestId('auth-login-cancel-notice')).toBeNull();
    expect(mockAuthorizeCalls).toEqual([]);
    expect(socialRequests).toEqual([]);

    // 실행 2 — 같은 버튼을 다시 누른다.
    fireEvent.press(screen.getByTestId('auth-login-google'));

    // 단언 2 — 방금 취소한 판단도, 이전 선언도 재사용하지 않고 다시 묻는다(결정 A).
    expect(await screen.findByTestId('auth-age-sheet')).toBeOnTheScreen();
    expect(mockAuthorizeCalls).toEqual([]);
    expect(socialRequests).toEqual([]);
  });
});

describe('TRIP-1035 AC-5 · 확인했는데 만 14세 미만이면 연령 제한 시트', () => {
  it('확인 → 첫 요청이 422 AGE_NOT_MET → auth-age-restriction 이 뜨고 게이트로 가지 않는다', async () => {
    // 준비 — 이 시나리오는 선언이 실린 요청에만 422 를 준다(실서버는 SELF_DECLARED 에 422 를
    // 내지 않으므로 목으로만 관측되는 경로다 — 6-b 실기 해당 없음).
    setScenario('login-age-restricted');
    render(<LoginPage />);
    fireEvent.press(screen.getByTestId('auth-login-google'));

    // 실행
    fireEvent.press(await screen.findByTestId('auth-age-sheet-confirm'));

    // 단언
    expect(await screen.findByTestId('auth-age-restriction')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(socialRequests).toEqual(['/api/v1/auth/social/google']);
    expect(mockAuthorizeCalls).toEqual(['google']);
  });
});
