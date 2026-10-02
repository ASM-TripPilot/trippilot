import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * TRIP-939 AC-10 — 개발 프리뷰(`/_dev/preview`)는 운영 빌드에서 열리지 않는다(심사 2.1).
 *
 * 무엇을 보장하나:
 *  - 🔴 운영 번들(`__DEV__ === false`)이면 프리뷰 본체(`dev-preview-root`)를 그리지 않고 홈(`/`)으로
 *    **정확히 한 번** 보낸다. 딥링크 `trippilot://_dev/preview` 로 들어와도 심사자에게 개발 화면이 안 보인다.
 *  - 짝: 개발 번들(`__DEV__ === true`, jest 기본값)이면 지금처럼 그려지고 아무 데도 안 보낸다.
 *
 * 어떻게 "운영 빌드"를 흉내내나:
 *  - (개념) `__DEV__` = React Native 가 넣어 주는 전역 참/거짓. 개발 번들은 true, 운영 번들은 false.
 *    jest 에선 `react-native/jest/setup.js` 가 **쓰기 가능한** true 로 넣으므로 테스트가 false 로 바꿀 수 있다.
 *  - ⚠️ 프리뷰가 이 값을 **렌더할 때마다** 읽어야 뒤집기가 먹는다. 모듈 맨 위에서 상수로 굳히면
 *    (`const IS_DEV = __DEV__`) 파일을 불러올 때 true 로 박혀 이 테스트가 red 로 남는다(02a ★1 · §5-A 실측).
 *  - `afterEach` 에서 원래 값으로 되돌린다 — 안 되돌리면 같은 파일의 다음 테스트가 운영 모드로 돈다(★2).
 *
 * 리다이렉트 판정(02a ★4): 목이 `<Redirect href>`·`router.replace/push`·`useRouter().replace/push` 를 전부
 *   같은 기록기(`mockNavigate`)로 받는다 → 선언형·명령형 중 무엇을 써도 되고, "목적지 목록 === ['/']"로
 *   정확히 1회를 잰다(둘을 겹쳐 두 번 보내면 red).
 *
 * ⚠️ 목 팩토리는 파일 맨 위로 끌어올려져(호이스팅) `const mockNavigate = jest.fn()` 보다 먼저 돈다 →
 *   팩토리 안에선 `mockNavigate` 를 **화살표 안에서, 호출될 때만** 읽는다(★3). 같은 이유로 프리뷰는
 *   `import` 가 아니라 목 선언 **뒤의 `require`** 로 불러온다(devPreviewDeepLink 선례).
 *
 * TRIP-1145 — 지운 프리뷰 렌더 테스트 22개를 대신하는 스모크를 이 파일에 붙였다(화면당 단위 1).
 *  - 개별 키 렌더는 하지 않는다: 키 장부 중복 0 · 딥링크 `?state=` 조준 · 없는 키/배열 값 splash 폴백만.
 *  - 지뢰 목(로드 순간 throw)은 프리뷰 정적 그래프 전체에 걸린다 — 프리뷰가 네트워크·컨테이너를 싣지 않는다.
 *  - `mockSearchParams` 는 모듈 스코프 객체라 리셋을 파일 최상위 `beforeEach` 에 건다.
 */

const mockNavigate = jest.fn();
// 딥링크 쿼리 흉내 — 목 팩토리는 호출될 때마다 이 객체를 새로 읽는다.
const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
  Redirect: ({ href }: { href: unknown }) => {
    mockNavigate('Redirect', href);
    return null;
  },
  router: {
    replace: (href: unknown) => mockNavigate('router.replace', href),
    push: (href: unknown) => mockNavigate('router.push', href),
  },
  useRouter: () => ({
    replace: (href: unknown) => mockNavigate('useRouter.replace', href),
    push: (href: unknown) => mockNavigate('useRouter.push', href),
  }),
}));

// @gorhom/bottom-sheet 은 reanimated/gesture 런타임 의존이라 통과 컴포넌트로 목킹한다(devPreview 선례).
jest.mock('@gorhom/bottom-sheet');

// 지뢰 목 — 프리뷰가 이 모듈을 값으로 로드하는 순간 스위트가 터진다(순수 뷰만 그린다는 계약).
jest.mock('@/shared/api', () => {
  throw new Error('프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다');
});
jest.mock('@/shared/api/generated/trips/trips', () => {
  throw new Error(
    '프리뷰가 trips 생성 클라이언트(네트워크)를 런타임에 로드했다'
  );
});
jest.mock('@/pages/login/ui/LoginPage', () => {
  throw new Error('프리뷰가 LoginPage(페이지)를 런타임에 로드했다');
});
jest.mock('@/pages/login/model/useSocialLogin', () => {
  throw new Error('프리뷰가 useSocialLogin(훅)을 런타임에 로드했다');
});
jest.mock('@/app-shell/ui/SplashGate', () => {
  throw new Error('프리뷰가 SplashGate(컨테이너)를 런타임에 로드했다');
});
jest.mock('@/shared/push/register', () => {
  throw new Error('프리뷰가 푸시 권한 루틴(register)을 런타임에 로드했다');
});
jest.mock('@/shared/push/request', () => {
  throw new Error('프리뷰가 푸시 권한 요청(request)을 런타임에 로드했다');
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const previewModule = require('@/app/_dev/preview') as {
  default: ComponentType;
  PREVIEW_STATES: { key: string }[];
};
const DevPreview = previewModule.default;

// jest 전역 `__DEV__` 손잡이 — RN 타입엔 읽기 전용 선언만 있어 쓰기용으로 좁혀 쓴다.
const runtime = globalThis as unknown as { __DEV__: boolean };

let previousDev: boolean;

beforeEach(() => {
  previousDev = runtime.__DEV__;
  mockNavigate.mockClear();
  delete mockSearchParams.state;
});

afterEach(() => {
  runtime.__DEV__ = previousDev;
});

describe('🔴 TRIP-939 AC-10 · 운영 빌드에서 프리뷰 차단', () => {
  it('P1 · __DEV__=false → 프리뷰 본체를 그리지 않고 홈(/)으로 정확히 1회 보낸다', () => {
    // 준비: 운영 번들을 흉내낸다.
    runtime.__DEV__ = false;

    // 실행
    render(<DevPreview />);

    // 단언: 개발 화면 부재 + 목적지 목록이 정확히 ['/'](채널 무관).
    expect(screen.queryByTestId('dev-preview-root')).toBeNull();
    expect(mockNavigate.mock.calls.map((call) => call[1])).toEqual(['/']);
  });

  it('P2 · __DEV__=true(개발 번들) → 지금처럼 그리고 아무 데도 안 보낸다(짝)', () => {
    // 준비: jest 기본값(true) 그대로.
    expect(runtime.__DEV__).toBe(true);

    // 실행
    render(<DevPreview />);

    // 단언
    expect(screen.getByTestId('dev-preview-root')).toBeOnTheScreen();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// TRIP-1145 · D-5 스모크
describe('프리뷰 스모크 — 화면이 뜨고, 키 장부와 딥링크 폴백이 결정론적이다', () => {
  it('키 장부에 이름 중복이 없고, 폴백 키 splash 가 들어 있다', () => {
    // 준비: 장부의 키 목록.
    const keys = previewModule.PREVIEW_STATES.map((state) => state.key);

    // 실행: 앞에서 이미 나온 키를 모은다(겹친 키가 실패 메시지에 그대로 뜬다).
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);

    // 단언
    expect(keys).toContain('splash');
    expect(duplicates).toEqual([]);
  });

  it('?state=<장부에 있는 키> 로 열면 그 화면이 처음부터 그려진다(폴백이 아니다)', () => {
    // 준비
    mockSearchParams.state = 'login-idle';

    // 실행
    render(<DevPreview />);

    // 단언: 프리뷰 본체 + 조준한 화면, splash 는 없다.
    expect(screen.getByTestId('dev-preview-root')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('shell-splash-root')).toBeNull();
  });

  it.each([
    ['장부에 없는 키', 'no-such-state'],
    // 첫 원소를 유효 키로 둔다 — "배열이면 첫 원소" 고장이 나면 login 화면이 떠서 구분된다.
    ['배열 값(중복 쿼리)', ['login-idle', 'splash']],
    ['파라미터 없음', undefined],
  ])('?state 가 %s 이면 에러 없이 splash 로 떨어진다', (_label, value) => {
    // 준비
    if (value !== undefined) {
      mockSearchParams.state = value;
    }

    // 실행
    render(<DevPreview />);

    // 단언
    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-login-root')).toBeNull();
  });
});
