import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { resetScenario, setScenario } from '@/mocks/scenarios';
import { LoginPage } from './LoginPage';

/**
 * TRIP-248 AC-3 · 신규 가입이 화면까지 도달하는가 (카카오 · token 갈래).
 *
 * 무엇을 보장하나: 서버가 "연령확인이 아직 없다"(400 VALIDATION_ERROR + fields[ageConfirmation])
 * 라고 답할 때, 사용자가 보는 것이 **실패 배너가 아니라 연령확인 바텀시트**라는 것. 지금 앱은
 * 여기서 "로그인에 실패했어요" 배너를 띄우고, 그래서 소셜 신규 가입이 0건이다 — 이 케이스가
 * 티켓이 서술한 실제 증상의 유일한 직접 심판이다(INV-4: 실패를 원인 그대로 표면화한다).
 *
 * 왜 별도 파일인가: 아래 makeAuthorize 목이 **파일 전체**에 걸리기 때문이다. 기존
 * LoginPage.integration.test.tsx 는 code 갈래(구글) 흐름을 검증하므로 같은 파일에 둘 수 없다.
 *
 * 버킷 — MSW 를 쓰므로 파일명이 반드시 `*.integration.test.tsx` 여야 한다(MSW 는 ESM 이라
 * --experimental-vm-modules 로 도는 유닛 버킷에서 못 뜬다).
 *
 * 3동작: 준비(갈래 강제 + 시나리오 set) → 실행(카카오 버튼 press) → 단언(화면 전이 + 요청 경로).
 */

// @gorhom/bottom-sheet 은 통과 컴포넌트로 목킹(수동 목: __mocks__/@gorhom/bottom-sheet.tsx).
// 이게 없으면 시트 안의 testID 가 화면에 안 잡힌다.
jest.mock('@gorhom/bottom-sheet');

// 토큰 저장은 native secure-store 라 목킹 — 관심사는 axios→MSW 경로지 저장 계층이 아니다.
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
 * ★ 갈래 강제 — 이 파일이 성립하려면 반드시 필요한 장치다.
 *
 * dev fake 인가 경로(makeAuthorize.ts:48-59)는 provider 와 무관하게 **항상 `success-code`**
 * (상수 'fake-code')를 돌려준다. 통합 버킷은 그 fake 로 돌기 때문에, 그대로 두면 카카오 버튼을
 * 눌러도 code 갈래로 나가고 → D3 에 따라 error 로 떨어져 → 이 파일이 검증하려는 token 갈래
 * 흐름에 **영원히 닿지 못한다**. "카카오 한정"(D0)과 "code 는 error"(D3)가 개별로는 옳은데
 * fake 인가와 조합되면 서로를 지운다.
 *
 * 그래서 OAuth 어댑터 **하나만** 갈아끼워 SDK 토큰 갈래를 강제한다. 훅·axios·MSW 는 그대로
 * 실제 경로를 탄다 — 이 환경에서 어댑터는 어차피 가짜였으므로 잃는 관측이 없다.
 */
jest.mock('@/features/auth/lib/makeAuthorize', () => ({
  makeAuthorize: () => async () => ({
    type: 'success-token',
    accessToken: 'kakao-sdk-access-token',
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockReplace = require('expo-router').router.replace as jest.Mock;

const socialRequests: string[] = [];

beforeAll(() => {
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
});

afterEach(() => {
  server.resetHandlers();
  resetScenario();
});

afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});

describe('LoginPage — 신규 가입 연령확인 도달 (TRIP-248 AC-3)', () => {
  it('카카오 신규 판정(400 · 연령확인 누락) → 연령확인 바텀시트가 뜨고 실패 배너는 뜨지 않는다', async () => {
    // 준비 — 목이 신규 시나리오에서 실서버와 같은 400 을 낸다.
    setScenario('login-success-new');
    render(<LoginPage />);

    // 실행
    fireEvent.press(screen.getByTestId('auth-login-kakao'));

    // 단언 ① 긍정 앵커 — 시트가 실제로 화면에 있다. 이걸 먼저 세워야 아래 부정 단언이
    // "화면이 아예 안 그려져서 통과"하는 공허한 통과가 되지 않는다.
    await waitFor(() =>
      expect(screen.getByTestId('auth-age-sheet')).toBeOnTheScreen()
    );

    // 단언 ② 부정 — 원인을 "그냥 실패"로 뭉갠 배너가 없다(INV-4).
    expect(screen.queryByTestId('auth-login-error-banner')).toBeNull();

    // 단언 ③ 실제로 SDK 토큰 경로로 나갔다. 핸들러가 두 개(:provider 는 경로 세그먼트 하나만
    // 매치)라, 목 변경이 token 핸들러에도 닿았다는 증거가 따로 필요하다.
    expect(socialRequests).toContain('/api/v1/auth/social/kakao/token');

    // 단언 ④ 연령확인 전에는 게이트('/')로 보내지 않는다 — 계정이 아직 확정되지 않았다.
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
