import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';

import type { SocialProvider } from '@/shared/api';
import { server } from '@/mocks/server';
import { resetScenario, setScenario } from '@/mocks/scenarios';
import { LoginPage } from './LoginPage';

/**
 * LoginPage — 소셜 로그인 배선 통합테스트(page 통합 1).
 *
 * 무엇을 보장하나: `(auth)/login` 이 렌더하는 컨테이너가 실 `useSocialLogin` 을 구독하고,
 *  버튼 탭 → makeAuthorize 주입 → 실 postSocialLogin → axios → **MSW** 응답까지 실제 경로를 태운다.
 *  관점은 갈래별 describe 세 개다.
 *   - `code 갈래 — 배선`: 훅 상태가 화면으로 흐르고(AC-W-07), 성공·에러·충돌·취소 전이가 화면 변화로
 *     보이며(AC-W-09), 성공 시 게이트('/')로 복귀하고(AC-W-10 · D3), 409 는 코드로 재로그인한다(AC-W-16).
 *   - `code 갈래 — 인가 전 연령 시트`: 인가·요청보다 먼저 시트가 뜨고, 취소하면 아무것도 안 나가며,
 *     확인 뒤 422 면 연령 제한 시트가 뜬다(TRIP-1035 AC-1·4·5).
 *   - `token 갈래 — 연령확인 도달`: 서버가 "연령확인 없음"(400)이라 하면 실패 배너가 아니라 연령확인
 *     시트가 뜬다(TRIP-248 AC-3 · INV-4).
 *
 * 이 스위트는 flag(--experimental-vm-modules) 없이 도는 `.integration.test` 버킷이다(MSW 는 ESM 이라
 * flag 아래서 못 뜬다). 실 axios→MSW 경로가 핵심이므로 @/shared/api 는 목킹하지 않는다.
 * 이 버킷은 fake 인가(EXPO_PUBLIC_AUTH_FAKE=1)라 **모든 버튼이 code 갈래**다 — token 갈래는 아래
 * makeAuthorize 목의 스위치로만 연다. 애플(실 makeAuthorize·lazy import)은 LoginPage.apple.test.tsx(node).
 *
 * 3동작: 준비(시나리오 set · 갈래) → 실행(소셜 버튼 press → 시트) → 단언(화면 전이 / 라우팅 / 인가·요청).
 */

// @gorhom/bottom-sheet 은 통과 컴포넌트로 목킹(수동 목: __mocks__/@gorhom/bottom-sheet.tsx).
// 이게 없으면 시트 안의 testID 가 화면에 안 잡힌다.
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

/**
 * ★ makeAuthorize 목은 파일 전체에 걸린다(jest.mock 은 맨 위로 끌어올려진다) — 그래서 갈래를 describe
 * 마다 다르게 쓰려면 목 **하나** 안에 스위치를 둔다. 값은 목 함수가 **불릴 때** 읽는다(버튼 press 시점).
 *
 * - 기본(`mockForceTokenFlow = false`): 실 makeAuthorize 를 그대로 부르고 호출만 기록하는 통과형 래퍼.
 *   fake 인가에는 스파이가 없어서 "인가 0회"를 볼 수 없고, 요청 0회만으로는 "인가는 불렀는데 결과를
 *   버렸다"를 못 가른다. 갈래 표지 flow 는 실함수 값을 **명시적으로** 옮긴다(속성 전체 복사는 비열거
 *   속성을 놓친다).
 * - token 갈래 강제(`true`): dev fake 인가(makeAuthorize.ts 'fake' 갈래)는 provider 와 무관하게 **항상
 *   success-code** 라, 그대로 두면 카카오 버튼도 code 갈래로 나가 token 갈래 흐름에 **영원히 닿지
 *   못한다**. 어댑터 하나만 SDK 토큰 결과로 갈아끼운다(flow 표지 없음 = token 취급). 훅·axios·MSW 는
 *   그대로 실제 경로다.
 *
 * jest.mock 팩토리 안의 바깥 변수는 이름이 `mock` 으로 시작해야 허용된다.
 */
const mockAuthorizeCalls: string[] = [];
let mockForceTokenFlow = false;
jest.mock('@/features/auth/lib/makeAuthorize', () => {
  const actual = jest.requireActual<
    typeof import('@/features/auth/lib/makeAuthorize')
  >('@/features/auth/lib/makeAuthorize');
  return {
    makeAuthorize: (provider: SocialProvider) => {
      if (mockForceTokenFlow) {
        return async () => ({
          type: 'success-token',
          accessToken: 'kakao-sdk-access-token',
        });
      }
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
// 요청 body — 리스너가 받은 요청은 본문을 한 번만 읽을 수 있어 clone() 으로 떠서 읽는다(비동기).
const socialBodies: unknown[] = [];

beforeAll(() => {
  process.env.EXPO_PUBLIC_AUTH_FAKE = '1';
  server.listen({ onUnhandledRequest: 'error' });
  // 관찰자는 파일에 하나만 건다 — 둘을 걸면 요청 하나가 두 번 기록돼 `toEqual([...])` 횟수 단언이 틀어진다.
  server.events.on('request:start', ({ request }) => {
    const pathname = new URL(request.url).pathname;
    if (pathname.includes('/auth/social/')) {
      socialRequests.push(pathname);
      void request
        .clone()
        .json()
        .then((body) => socialBodies.push(body));
    }
  });
});

/** 소셜 버튼을 누르고, 인가 전에 뜨는 연령 시트에서 "네, 확인했어요"를 누른다. */
async function pressAndConfirmAge(buttonTestId: string) {
  fireEvent.press(screen.getByTestId(buttonTestId));
  fireEvent.press(await screen.findByTestId('auth-age-sheet-confirm'));
}

beforeEach(() => {
  socialRequests.length = 0;
  socialBodies.length = 0;
  mockAuthorizeCalls.length = 0;
  mockReplace.mockClear();
  // 가짜 인가 결과의 출처는 env 다(게이트①-2 계약 — makeAuthorize 는 @/mocks 를 참조하지 않는다).
  // 미지정 = success 이므로 매 테스트 전에 지워 기본값으로 되돌린다.
  delete process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME;
});

// 모듈 상태(갈래 스위치·env)는 최상위에서 되돌린다 — describe 안에만 두면 token 관점이 뒤 관점으로 샌다.
afterEach(() => {
  server.resetHandlers();
  resetScenario();
  delete process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME;
  mockForceTokenFlow = false;
});

afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});

// AC-W-07·09·10·16 · TRIP-1035 AC-2·3·12 · 결함 F(케이스 33)
describe('code 갈래 — 배선', () => {
  describe('LoginPage — 상태↔화면 배선 (AC-W-07)', () => {
    // TRIP-932 — 애플 버튼은 isAvailableAsync 판정대로 붙는다(iOS 4버튼 / Android 3버튼). 이 스위트는
    // 애플 SDK 목이 없어 판정이 falsy 로 떨어지므로(jest-expo 자동 목) 가용성과 무관한 3버튼만 본다.
    // 애플 유무는 LoginPage.apple.test.tsx(node 버킷)가 맡는다 — integration 버킷은 lazy import 를
    // 못 태운다(02a ★2).
    it('컨테이너가 SocialLoginScreen 을 렌더하고 초기(idle) 상태로 브랜드·가용성과 무관한 소셜 3버튼(구글·카카오·네이버)을 노출한다', () => {
      setScenario('login-success-existing');

      render(<LoginPage />);

      expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
      expect(screen.getByTestId('auth-login-google')).toBeOnTheScreen();
      expect(screen.getByTestId('auth-login-kakao')).toBeOnTheScreen();
      expect(screen.getByTestId('auth-login-naver')).toBeOnTheScreen();
    });
  });

  describe('LoginPage — fake×MSW 결합 전이 (AC-W-09)', () => {
    it('성공(기존) → 부트스트랩 재평가로 게이트("/")로 복귀한다 (AC-W-10 · D3 · TRIP-1035 AC-3)', async () => {
      setScenario('login-success-existing');
      render(<LoginPage />);

      // 기존 가입자도 code 갈래면 같은 시트를 거친다 — 서버는 기존 계정이면 선언을 읽지 않는다.
      await pressAndConfirmAge('auth-login-google');

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
      expect(socialRequests).toContain('/api/v1/auth/social/google');
    });

    /**
     * TRIP-1035 AC-2 — TRIP-248 D3·AC-13 의 화면 심판을 **뒤집은** 자리. 이전 판은 "신규 구글은 시트가
     * 아니라 배너"였다: 인가코드가 첫 요청에서 소진돼, 400 뒤에 확인을 받아도 재전송할 수 없었기 때문이다.
     * 이제는 인가 **전에** 묻고 첫 요청에 선언을 실으므로, 신규 구글 가입이 요청 한 번으로 끝난다.
     * (선언 없이 보낸 code 요청의 400 이 error 라는 성질은 useSocialLogin.tokenPath.test.tsx 에 남는다.)
     */
    it('신규 구글 → 인가 전 시트에서 확인 → 선언을 실은 첫 요청 1회로 가입이 끝나 게이트로 간다', async () => {
      // 준비 — 선언 없는 첫 요청이면 서버(목)가 400 을 주는 시나리오.
      setScenario('login-success-new');
      render(<LoginPage />);

      // 실행
      await pressAndConfirmAge('auth-login-google');

      // 단언 — 요청이 **정확히 한 번**이다(400 뒤 재시도로 성공한 것이 아니다).
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
      expect(socialRequests).toEqual(['/api/v1/auth/social/google']);
      await waitFor(() =>
        expect(socialBodies[0]).toMatchObject({
          ageConfirmation: { method: 'SELF_DECLARED' },
        })
      );
      expect(screen.queryByTestId('auth-login-error-banner')).toBeNull();
    });

    it('401 인증 실패 → 에러 배너(auth-login-error-banner)를 보여준다', async () => {
      setScenario('login-error-auth');
      render(<LoginPage />);

      await pressAndConfirmAge('auth-login-google');

      await waitFor(() =>
        expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen()
      );
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('시트 확인 뒤 브라우저에서 취소(cancel) → 취소 안내를 보여주고 서버를 호출하지 않는다 (TRIP-1035 AC-12)', async () => {
      // 인가 결과(cancel)는 env 로, 서버 거동은 시나리오로 — 출처가 분리됐다(게이트①-2 계약).
      process.env.EXPO_PUBLIC_AUTH_FAKE_OUTCOME = 'cancel';
      setScenario('login-success-existing');
      render(<LoginPage />);

      await pressAndConfirmAge('auth-login-google');

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

      await pressAndConfirmAge('auth-login-google');

      await waitFor(() =>
        expect(
          screen.getByTestId('auth-login-conflict-sheet')
        ).toBeOnTheScreen()
      );
      // TRIP-352 정본 정합: conflictProvider 는 서버 코드(kakao)로 흘러 들어오지만, 화면은
      // 코드 원문을 감추고 한글 표시명("카카오")으로 옮겨 보여준다(AC-C2 · BR-U0-04). 코드→
      // 엔드포인트 라우팅은 코드 그대로라는 계약은 아래 onConflictContinue 테스트가 따로 잠근다.
      expect(
        screen.getByTestId('auth-login-conflict-message')
      ).toHaveTextContent(/카카오/);
      expect(screen.queryByText(/kakao/)).toBeNull();
    });

    it('onConflictContinue 는 conflictProvider 코드(kakao)로 재로그인을 트리거한다', async () => {
      setScenario('login-email-conflict');
      render(<LoginPage />);

      await pressAndConfirmAge('auth-login-google');
      await waitFor(() =>
        expect(
          screen.getByTestId('auth-login-conflict-continue')
        ).toBeOnTheScreen()
      );

      fireEvent.press(screen.getByTestId('auth-login-conflict-continue'));

      // TRIP-1035 Q1 — 재로그인도 code 갈래(이 버킷의 fake)면 연령 시트를 **다시** 띄운다. 방금 구글에서
      // 한 선언을 다른 제공자 계정으로 옮겨 싣지 않는다(결정 A). 확인 전에는 카카오 요청이 없다.
      const confirmAgain = await screen.findByTestId('auth-age-sheet-confirm');
      expect(socialRequests).toEqual(['/api/v1/auth/social/google']);
      fireEvent.press(confirmAgain);

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
      await pressAndConfirmAge('auth-login-google');

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
});

// TRIP-1035 AC-1 · AC-4 · AC-5 — code 갈래의 "인가 전 연령 시트"를 화면에서 본다.
describe('code 갈래 — 인가 전 연령 시트', () => {
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
      expect(
        await screen.findByTestId('auth-age-restriction')
      ).toBeOnTheScreen();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(socialRequests).toEqual(['/api/v1/auth/social/google']);
      expect(mockAuthorizeCalls).toEqual(['google']);
    });
  });
});

/**
 * TRIP-248 AC-3 · 신규 가입이 화면까지 도달하는가 (카카오 · token 갈래).
 *
 * 서버가 "연령확인이 아직 없다"(400 VALIDATION_ERROR + fields[ageConfirmation])라고 답할 때, 사용자가
 * 보는 것이 **실패 배너가 아니라 연령확인 바텀시트**라는 것 — 소셜 신규 가입 0건 증상의 유일한 직접
 * 심판이다(INV-4: 실패를 원인 그대로 표면화한다).
 */
describe('token 갈래 — 연령확인 도달', () => {
  // ★ 갈래 강제 — 이게 없으면 카카오도 code 갈래(fake)로 나가 아래 단언 ③(…/kakao/token)이 red 다.
  beforeEach(() => {
    mockForceTokenFlow = true;
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
});
