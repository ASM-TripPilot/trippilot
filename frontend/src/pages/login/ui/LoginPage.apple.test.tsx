import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from '@testing-library/react-native';
import { AppleAuthenticationScope } from 'expo-apple-authentication';
import { Path } from 'react-native-svg';

import { postSocialLogin, postSocialTokenLogin } from '@/shared/api';
import {
  appleIsAvailableAsyncSpy,
  appleSignInAsyncSpy,
  resetExpoAppleAuthenticationMock,
} from '@/test-support/expoAppleAuthenticationMock';
import { LoginPage } from './LoginPage';

/**
 * TRIP-932 AC-9·AC-12·AC-13 + TRIP-1124 AC-Q3′ — LoginPage 애플 배선(컨테이너 → lazy 애플 모듈 → 화면 → 훅).
 *
 * 무엇을 보장하나: `(auth)/login` 컨테이너가
 *  (13) `isAvailableAsync()` 결과대로 애플 버튼을 넣거나 빼고(true=4버튼, false=3버튼),
 *  (12) 판정 전·판정 실패에는 숨기며(Q2 fail-closed),
 *  (Q3′) 애플 자리에 HIG 커스텀 버튼(로고 24 + "Apple로 계속하기", 검정, 이웃과 같은 표면)을
 *        그리고 — TRIP-1124 가 TRIP-932 의 "SDK 공식 버튼" 계약을 뒤집었다,
 *  (13·6) 그 버튼(제목 글자)을 누르면 실 makeAuthorize → 실 useSocialLogin 을 거쳐 `/token` 으로
 *        identityToken·authorizationCode 를 보내고 게이트('/')로 복귀하며,
 *  (9) 애플 취소는 취소 안내(배너 없음), 애플 실패는 에러 배너로 드러난다.
 *
 * ⚠️ 이 파일은 `.integration` 이 아니라 node 버킷이다(02a ★2). 애플 모듈은 `await import` 로만
 * 닿는데, integration 버킷(--experimental-vm-modules 없음)에서는 `import()` 가 호출 자리에서 동기
 * TypeError 로 터진다. 그래서 MSW 대신 `@/shared/api` 를 목킹해 서버 경계를 관찰한다.
 *
 * 목으로 바꾸는 것은 SDK 모듈·서버 함수·저장소·라우터뿐이다. makeAuthorize·useSocialLogin·
 * SocialLoginScreen·애플 어댑터는 진짜를 돌린다.
 *
 * 3동작: 준비(가용성·SDK 응답·서버 응답 주입) → 실행(render / 버튼 press) → 단언(화면·호출 인자).
 */

jest.mock(
  'expo-apple-authentication',
  () =>
    require('@/test-support/expoAppleAuthenticationMock')
      .expoAppleAuthenticationModule
);
jest.mock('@gorhom/bottom-sheet');
jest.mock('@/shared/api', () => ({
  postSocialLogin: jest.fn(),
  postSocialTokenLogin: jest.fn(),
}));
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockReplace = require('expo-router').router.replace as jest.Mock;
const mockPostSocialLogin = postSocialLogin as jest.MockedFunction<
  typeof postSocialLogin
>;
const mockPostSocialTokenLogin = postSocialTokenLogin as jest.MockedFunction<
  typeof postSocialTokenLogin
>;

const ENV_KEYS = ['EXPO_PUBLIC_AUTH_FAKE', 'EXPO_PUBLIC_AUTH_FAKE_OUTCOME'];
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
}

beforeEach(() => {
  // fake 토글을 끈다 — 켜져 있으면 apple 이 dev 전용 success-code 로 빠져 SDK 를 타지 않는다.
  process.env.EXPO_PUBLIC_AUTH_FAKE = '';
  mockReplace.mockClear();
  mockPostSocialLogin.mockReset();
  mockPostSocialTokenLogin.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
  resetExpoAppleAuthenticationMock();
});

/** 보이는 소셜 버튼 testID 를 화면 순서대로(02a ★9). */
function socialButtonOrder(): string[] {
  return screen
    .getAllByTestId(/^auth-login-(google|apple|kakao|naver)$/)
    .map((node) => node.props.testID as string);
}

/**
 * 가용성 판정의 비동기 체인(lazy import → isAvailableAsync → setState)을 끝까지 흘려보낸다.
 * false 를 받은 **뒤에** 잘못 버튼을 띄우는 구현을 잡으려면 이게 있어야 한다(02a ★13).
 */
async function settle(): Promise<void> {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

/** 가용성 판정이 실제로 시작될 때까지 기다린다(판정을 isAvailableAsync 로 한다는 seed 결정). */
async function waitForAvailabilityCheck(): Promise<void> {
  await waitFor(() => expect(appleIsAvailableAsyncSpy).toHaveBeenCalled());
}

function appleCredential() {
  return {
    user: 'apple-user-001',
    identityToken: 'id-tok',
    authorizationCode: 'auth-code',
    email: 'x@privaterelay.appleid.com',
    fullName: null,
    realUserStatus: 1,
    state: null,
  };
}

function tokenPair() {
  return {
    accessToken: 'server-access-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshToken: 'server-refresh-token',
    refreshExpiresIn: 7776000,
    isNewUser: false,
    account: {
      accountId: '00000000-0000-0000-0000-000000000001',
      status: 'ACTIVE',
      email: null,
      socialProviders: ['APPLE'],
      onboardingCompleted: true,
    },
  };
}

function codedError(code: string): Error {
  return Object.assign(new Error('apple sign-in error'), { code });
}

/** iOS 모양으로 렌더하고 애플 버튼 제목이 나타날 때까지 기다린다. */
async function renderIosAndWaitForApple() {
  appleIsAvailableAsyncSpy.mockResolvedValue(true);
  render(<LoginPage />);
  await screen.findByTestId('auth-login-apple-label');
}

/**
 * 애플 버튼 안의 한 곳(기본: 제목 글자)을 손가락처럼 누른다.
 *
 * fireEvent.press 를 쓰지 않는 이유(02a ★3·부록 B): fireEvent 는 누른 노드에서 위로 올라가다
 * `onPress` 라는 prop 을 처음 만나면 부르는데, 그 사슬에 **컴포넌트**도 끼어 있다. 그래서
 * Pressable 에 onPress 를 안 달아도 바깥의 AppleSignInButton 이 받은 prop 을 곧장 불러 green 이
 * 된다(배선이 끊겨도 통과). userEvent.press 는 **화면에 그려지는 호스트 노드만** 타고 올라가
 * 터치 응답(responder) 순서 — 누름 시작 → 최소 130ms → 뗌 — 를 흉내 내므로 Pressable 배선을
 * 실제로 탄다. 실타이머라 130ms 를 진짜로 기다린다(이 파일은 가짜 타이머를 안 쓴다).
 */
async function pressApple(
  target:
    | 'auth-login-apple-label'
    | 'auth-login-apple-icon' = 'auth-login-apple-label'
): Promise<void> {
  await userEvent.setup().press(screen.getByTestId(target));
}

/**
 * Figma 로고 벡터 1285:1092 의 path — 보관본 `_workspace/20260929-figma-c02/apple-logo-1285-1091.svg`
 * (viewBox 0 0 20 20)의 d 를 바이트 그대로 옮겼다. 보관본은 리포 밖이라 CI 가 못 읽으므로 상수로 둔다.
 * Apple Design Resources 원본으로 바꾸면(브리프 맹점 ③) 이 값도 함께 바꾼다.
 */
const FIGMA_APPLE_LOGO_D =
  'M13.6333 10.7834C13.6167 9.0751 15.0333 8.25843 15.0917 8.21676C14.3 7.05843 13.0667 6.9001 12.625 6.88343C11.575 6.7751 10.575 7.5001 10.0417 7.5001C9.50835 7.5001 8.69168 6.9001 7.81668 6.91676C6.67501 6.93343 5.61668 7.58343 5.02501 8.60843C3.83335 10.6751 4.71668 13.7334 5.87501 15.4084C6.44168 16.2251 7.11668 17.1418 8.00002 17.1084C8.85002 17.0751 9.17501 16.5584 10.2083 16.5584C11.2333 16.5584 11.525 17.1084 12.425 17.0918C13.3417 17.0751 13.9167 16.2584 14.475 15.4334C15.125 14.4834 15.3917 13.5668 15.4083 13.5168C15.3917 13.5084 13.6167 12.8251 13.6 10.7834H13.6333ZM12.0833 5.7501C12.55 5.18343 12.8667 4.39176 12.775 3.6001C12.1 3.6251 11.2833 4.0501 10.8 4.61676C10.3667 5.11676 9.98335 5.91676 10.0833 6.68343C10.8333 6.74176 11.6083 6.3001 12.0833 5.7501Z';

// ── 렌더 트리(toJSON) 읽기 도구 — 노드 자체를 expect 에 넣지 않고 원시값만 꺼낸다(02a ★2) ──

type JsonNode = {
  props?: { testID?: unknown; className?: unknown };
  children?: (JsonNode | string)[] | null;
};

/** className 을 공백으로 쪼갠 토큰 배열. 부분 문자열 오탐을 막으려고 원소 일치로만 비교한다(★5). */
function classTokens(node: { props?: { className?: unknown } }): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.trim().split(/\s+/).filter(Boolean) : [];
}

/** 노드와 그 자손을 전위 순회하며 방문한다. */
function walk(
  node: JsonNode | string | null | undefined,
  visit: (n: JsonNode) => void
): void {
  if (!node || typeof node === 'string') return;
  visit(node);
  (node.children ?? []).forEach((child) => walk(child, visit));
}

/** 호스트 렌더 결과에서 testID 가 id 인 노드의 서브트리(첫 매치). 없으면 null. */
function jsonSubtree(id: string): JsonNode | null {
  let found: JsonNode | null = null;
  const root = screen.toJSON() as unknown as JsonNode | JsonNode[] | null;
  const roots = Array.isArray(root) ? root : [root];
  roots.forEach((r) =>
    walk(r, (n) => {
      if (!found && n.props?.testID === id) found = n;
    })
  );
  return found;
}

describe('AC-13 · 가용성 판정대로 애플 버튼을 넣고 뺀다', () => {
  it('isAvailableAsync 가 true 면(iOS) 구글·애플·카카오·네이버 4버튼이 이 순서로 보인다', async () => {
    // 준비
    appleIsAvailableAsyncSpy.mockResolvedValue(true);

    // 실행
    render(<LoginPage />);

    // 단언 — 래퍼 안에 애플 버튼 제목이 들어온 뒤의 순서. 래퍼만 보면 빈 래퍼도 통과한다.
    const apple = await screen.findByTestId('auth-login-apple');
    await waitFor(() =>
      expect(
        within(apple).getByTestId('auth-login-apple-label')
      ).toBeOnTheScreen()
    );
    expect(socialButtonOrder()).toEqual([
      'auth-login-google',
      'auth-login-apple',
      'auth-login-kakao',
      'auth-login-naver',
    ]);
  });

  it('isAvailableAsync 가 false 면(Android) 판정이 끝난 뒤에도 애플 없이 3버튼이다', async () => {
    // 준비
    appleIsAvailableAsyncSpy.mockResolvedValue(false);

    // 실행
    render(<LoginPage />);
    await waitForAvailabilityCheck();
    await settle();

    // 단언
    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    expect(socialButtonOrder()).toEqual([
      'auth-login-google',
      'auth-login-kakao',
      'auth-login-naver',
    ]);
    expect(screen.queryByTestId('auth-login-apple')).toBeNull();
  });
});

describe('AC-12 · 판정 전·판정 실패에는 숨긴다 (Q2 fail-closed)', () => {
  it('판정이 끝나지 않은 동안에는 애플 버튼이 없다', async () => {
    // 준비 — 영원히 끝나지 않는 판정.
    appleIsAvailableAsyncSpy.mockReturnValue(new Promise<boolean>(() => {}));

    // 실행
    render(<LoginPage />);
    await waitForAvailabilityCheck();

    // 단언
    expect(socialButtonOrder()).toEqual([
      'auth-login-google',
      'auth-login-kakao',
      'auth-login-naver',
    ]);
    expect(screen.queryByTestId('auth-login-apple')).toBeNull();
  });

  it('판정이 reject 되어도 화면은 죽지 않고 애플 없이 3버튼으로 남는다', async () => {
    // 준비
    appleIsAvailableAsyncSpy.mockRejectedValue(new Error('availability boom'));

    // 실행
    render(<LoginPage />);
    await waitForAvailabilityCheck();
    await settle();

    // 단언
    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    expect(socialButtonOrder()).toEqual([
      'auth-login-google',
      'auth-login-kakao',
      'auth-login-naver',
    ]);
    expect(screen.queryByTestId('auth-login-apple')).toBeNull();
  });
});

describe('AC-Q3′ · 애플 자리는 HIG 커스텀 버튼이다 (TRIP-1124 — TRIP-932 공식 버튼 계약을 뒤집음)', () => {
  // 시스템 버튼(AppleAuthenticationButton)의 부재는 여기서 따로 묻지 않는다. SDK 목에서 그 대역을
  // 걷어냈으므로 구현이 시스템 버튼을 계속 쓰면 렌더가 undefined 엘리먼트로 터진다(02a ★1).

  it('래퍼 auth-login-apple 은 하나뿐이고, 그 안에 로고 → 제목 순서로 들어 있다 (testID 중복 금지 · R4)', async () => {
    // 준비 + 실행
    await renderIosAndWaitForApple();

    // 단언 — 버튼 표면에 같은 testID 를 또 달면 2가 된다. 노드 배열이 아니라 숫자로 비교한다(★2).
    expect(screen.getAllByTestId('auth-login-apple').length).toBe(1);

    // 단언 — 래퍼 서브트리에 나오는 애플 testID 의 순서(로고가 제목 왼쪽, Figma 4777:2975).
    const ids: string[] = [];
    walk(jsonSubtree('auth-login-apple'), (n) => {
      const id = n.props?.testID;
      if (id === 'auth-login-apple-icon' || id === 'auth-login-apple-label') {
        ids.push(id);
      }
    });
    expect(ids).toEqual(['auth-login-apple-icon', 'auth-login-apple-label']);
  });

  it('제목 문구가 정확히 "Apple로 계속하기"이고, 음차 "애플로 계속하기"는 화면 어디에도 없다 (HIG 제목 · 결정 1)', async () => {
    // 준비 + 실행
    await renderIosAndWaitForApple();
    const apple = screen.getByTestId('auth-login-apple');

    // 단언 — getByText(문자열)은 완전 일치다(02a ★8). 찾은 글자가 제목 노드인지 testID 로 확인한다.
    expect(within(apple).getByText('Apple로 계속하기').props.testID).toBe(
      'auth-login-apple-label'
    );

    // 단언 — 부정(짝).
    expect(screen.queryByText('애플로 계속하기')).toBeNull();
  });

  it('제목이 4버튼 공통 Noto Bold 22(text-hero)이고 글자색은 검정(text-black)이다 — ink·scrim·옛 15 는 없다 (HIG 흑백 · R3)', async () => {
    // 준비 + 실행
    await renderIosAndWaitForApple();
    const tokens = classTokens(screen.getByTestId('auth-login-apple-label'));

    // 단언 — 여러 키를 한 객체로 묶어 어느 값이 틀렸는지 한 번에 본다.
    expect({
      family: tokens.includes('font-noto-bold'),
      weight: tokens.includes('font-bold'),
      size: tokens.includes('text-hero'),
      black: tokens.includes('text-black'),
      oldSize: tokens.includes('text-card-title'),
      ink: tokens.includes('text-ink'),
      scrim: tokens.includes('text-scrim'),
    }).toEqual({
      family: true,
      weight: true,
      size: true,
      black: true,
      oldSize: false,
      ink: false,
      scrim: false,
    });
  });

  it('로고는 24×24 이고, 로고 벡터의 색은 검정(#000000) 한 가지뿐이다 (HIG 흑백 · R1 · R5)', async () => {
    // 준비 + 실행
    await renderIosAndWaitForApple();
    const icon = screen.getByTestId('auth-login-apple-icon');

    // 실행 — 로고 안 Path 들의 fill·stroke 값을 대문자로 모아 중복을 뺀다(★6).
    const paths = icon.findAllByType(Path);
    const colors = [
      ...new Set(
        paths
          .flatMap((p) => [p.props.fill, p.props.stroke])
          .filter((c): c is string => typeof c === 'string')
          .map((c) => c.toUpperCase())
      ),
    ];

    // 단언
    expect({
      width: icon.props.width,
      height: icon.props.height,
      hasPath: paths.length > 0,
      colors,
    }).toEqual({ width: 24, height: 24, hasPath: true, colors: ['#000000'] });
  });

  it('로고 모양(Path d)이 Figma 보관본 벡터와 한 글자도 다르지 않다 — 커스텀 로고 금지 (HIG · W2)', async () => {
    // 준비 + 실행
    await renderIosAndWaitForApple();
    const paths = screen
      .getByTestId('auth-login-apple-icon')
      .findAllByType(Path);

    // 단언 — Path 는 하나이고 그 d 가 보관본과 같다. 문자열만 expect 에 넣는다(★2).
    expect(paths.map((p) => p.props.d as unknown)).toEqual([
      FIGMA_APPLE_LOGO_D,
    ]);
  });

  it('버튼 표면이 구글 버튼과 같은 클래스(높이 52 · 전체폭 · 반경 · ink 테두리 · 흰 배경 · 가운데 정렬 · 간격 10)를 입는다 (HIG "다른 버튼보다 작지 않게")', async () => {
    // 준비 + 실행
    await renderIosAndWaitForApple();
    const googleTokens = classTokens(screen.getByTestId('auth-login-google'));

    // 실행 — 버튼 표면은 testID 가 없으니 래퍼 서브트리에서 h-[52px] 토큰을 가진 노드로 찾는다(★4).
    const surfaces: string[][] = [];
    walk(jsonSubtree('auth-login-apple'), (n) => {
      const tokens = classTokens(n);
      if (tokens.includes('h-[52px]')) surfaces.push(tokens);
    });

    // 단언 — 앵커: 비교 기준(구글)이 비어 있으면 '둘 다 빈 배열'로 공허하게 같아진다.
    expect({
      height: googleTokens.includes('h-[52px]'),
      border: googleTokens.includes('border-ink'),
      canvas: googleTokens.includes('bg-canvas'),
      radius: googleTokens.includes('rounded-button'),
    }).toEqual({ height: true, border: true, canvas: true, radius: true });

    // 단언 — 표면은 정확히 하나이고, 토큰 집합이 구글과 같다(순서는 계약이 아니라 정렬해 비교).
    expect(surfaces.length).toBe(1);
    expect([...(surfaces[0] ?? [])].sort()).toEqual([...googleTokens].sort());
  });
});

describe('AC-13·AC-6 · 애플 버튼을 누르면 /token 으로 identityToken·authorizationCode 를 보내고 게이트로 간다', () => {
  it('signInAsync(EMAIL) → postSocialTokenLogin("apple", { accessToken, authorizationCode }) → router.replace("/")', async () => {
    // 준비
    appleSignInAsyncSpy.mockResolvedValue(appleCredential());
    mockPostSocialTokenLogin.mockResolvedValue(tokenPair());
    await renderIosAndWaitForApple();

    // 실행
    await pressApple();

    // 단언
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(appleSignInAsyncSpy.mock.calls[0][0].requestedScopes).toEqual([
      AppleAuthenticationScope.EMAIL,
    ]);
    expect(mockPostSocialTokenLogin.mock.calls[0]).toStrictEqual([
      'apple',
      { accessToken: 'id-tok', authorizationCode: 'auth-code' },
    ]);
    expect(mockPostSocialLogin).not.toHaveBeenCalled();
  });
});

describe('AC-13·AC-6 · 버튼 표면 어디를 눌러도 반응한다 (W1 — 제목 글자만 누를 수 있으면 안 된다)', () => {
  it('로고를 눌러도 signInAsync 가 한 번 불린다', async () => {
    // 준비 — 취소로 끝나게 해 서버·라우터 부작용 없이 "눌렸다"만 본다.
    appleSignInAsyncSpy.mockRejectedValue(codedError('ERR_REQUEST_CANCELED'));
    await renderIosAndWaitForApple();

    // 실행 — 제목이 아니라 로고를 누른다. onPress 가 제목(Text)에만 달려 있으면 여기선 0회다.
    await pressApple('auth-login-apple-icon');

    // 단언
    await waitFor(() =>
      expect(screen.getByTestId('auth-login-cancel-notice')).toBeOnTheScreen()
    );
    expect(appleSignInAsyncSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AC-9 · 애플 취소·실패의 화면 표면', () => {
  it('ERR_REQUEST_CANCELED 는 취소 안내만 띄우고 에러 배너도 서버 호출도 없다', async () => {
    // 준비
    appleSignInAsyncSpy.mockRejectedValue(codedError('ERR_REQUEST_CANCELED'));
    await renderIosAndWaitForApple();

    // 실행
    await pressApple();

    // 단언 — 짝: 안내는 있고 배너는 없다(★17).
    await waitFor(() =>
      expect(screen.getByTestId('auth-login-cancel-notice')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('auth-login-error-banner')).toBeNull();
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    expect(appleSignInAsyncSpy).toHaveBeenCalledTimes(1);
  });

  it('ERR_REQUEST_FAILED 는 에러 배너로 드러나고 서버 호출은 없다 (INV-4)', async () => {
    // 준비
    appleSignInAsyncSpy.mockRejectedValue(codedError('ERR_REQUEST_FAILED'));
    await renderIosAndWaitForApple();

    // 실행
    await pressApple();

    // 단언
    await waitFor(() =>
      expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen()
    );
    expect(mockPostSocialTokenLogin).not.toHaveBeenCalled();
    expect(appleSignInAsyncSpy).toHaveBeenCalledTimes(1);
  });
});
