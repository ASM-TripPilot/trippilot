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
 */

const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

// jest 전역 `__DEV__` 손잡이 — RN 타입엔 읽기 전용 선언만 있어 쓰기용으로 좁혀 쓴다.
const runtime = globalThis as unknown as { __DEV__: boolean };

let previousDev: boolean;

beforeEach(() => {
  previousDev = runtime.__DEV__;
  mockNavigate.mockClear();
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
