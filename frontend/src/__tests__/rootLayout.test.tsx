import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * 루트 레이아웃 축소 회귀 테스트 — 목 배선을 걷어낸 뒤에도 부팅 골격이 그대로인지 잠근다.
 *
 * 무엇을 보장하나:
 *  (1) 폰트가 결판나기 전에는 아무것도 그리지 않는다(시스템 폰트로 잠깐 보였다 바뀌는 깜빡임 방지),
 *  (2) 결판난 뒤에는 **첫 렌더에 곧바로** SplashGate 가 그려진다(부팅을 붙잡는 비동기 게이트가 없다),
 *  (3) 그 시점에 네이티브 스플래시가 내려간다(무한 정지 화면 금지),
 *  (4) GestureHandlerRootView 래핑이 남아 있다(로그인 바텀시트 동작의 전제).
 *
 * 왜 EXPO_PUBLIC_API_MOCK 을 '1' 로 세워 두는가: 제거 후 이 토글을 읽는 코드는 0개여야 한다.
 * 토글을 켠 채로 위 넷을 요구하는 것 자체가 단언이다 — 목 게이트가 되살아나면 첫 렌더가
 * 다시 null 로 돌아가 (2)(3)(4)가 함께 빨개진다. "파일이 없어졌는가"가 아니라
 * "제거 후에도 부팅이 되는가"를 묻는 형태라, 대상이 사라져도 공허하게 통과하지 않는다.
 *
 * 왜 src/app 이 아니라 src/__tests__ 인가: expo-router 의 require.context 정규식은
 * `.test.tsx` 를 제외하지 않는다 → src/app/ 아래에 테스트 파일을 두면 실제 라우트로 등록된다.
 */

process.env.EXPO_PUBLIC_API_MOCK = '1';

// react-native-gesture-handler 는 네이티브 모듈을 요구하므로 공식 jest 목 설정을 먼저 건다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('react-native-gesture-handler/jestSetup');

// global.css 는 jest 의 transform 대상이 아니라 그대로 require 하면 SyntaxError 가 난다.
jest.mock('../../global.css', () => ({}));

const mockHideAsync = jest.fn();
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: mockHideAsync,
}));

// 폰트 로드 결과를 테스트마다 갈아끼우기 위해 모듈 스코프 변수로 뺀다.
// (jest 는 팩토리가 참조하는 외부 변수를 `mock` 접두사일 때만 허용한다.)
let mockFontsLoaded = true;
jest.mock('expo-font', () => ({ useFonts: () => [mockFontsLoaded, null] }));

// 실물 SplashGate 는 렌더 즉시 부트스트랩 요청을 발사하므로,
// "그려졌는가"만 testID 로 관찰하는 마커로 대체한다.
jest.mock('@/app-shell/ui/SplashGate', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/splashGateMock')
);

// jestSetup 이 먼저 돌아야 하므로 import 문(호이스팅) 대신 require 로 순서를 고정한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GestureHandlerRootView } = require('react-native-gesture-handler');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RootLayout = require('@/app/_layout').default as ComponentType;

beforeEach(() => {
  mockFontsLoaded = true;
  mockHideAsync.mockClear();
});

describe('루트 레이아웃 — 부팅 골격', () => {
  it('폰트가 결판나기 전에는 아무 화면도 그리지 않고 네이티브 스플래시를 붙잡아 둔다', () => {
    mockFontsLoaded = false;

    render(<RootLayout />);

    expect(screen.toJSON()).toBeNull();
    expect(mockHideAsync).not.toHaveBeenCalled();
  });

  it('폰트가 결판나면 첫 렌더에 곧바로 SplashGate 를 그린다', () => {
    render(<RootLayout />);

    expect(screen.getByTestId('splash-gate')).toBeOnTheScreen();
  });

  it('폰트가 결판나면 네이티브 스플래시를 내린다', () => {
    render(<RootLayout />);

    expect(mockHideAsync).toHaveBeenCalled();
  });

  it('GestureHandlerRootView 로 감싸 그린다(바텀시트 동작의 전제)', () => {
    render(<RootLayout />);

    expect(screen.UNSAFE_getByType(GestureHandlerRootView)).toBeTruthy();
  });
});
