import type { ComponentType } from 'react';
import { act, render, screen } from '@testing-library/react-native';

/**
 * TRIP-990 · T4 — 루트 레이아웃이 토스트 호스트를 **Stack 바깥**에 한 번 둔다.
 *
 * 왜 루트인가(D19): 저장한 뒤 화면을 떠나도(#036 숙소 등록·#030 취향) 토스트는 남아야 한다. 호스트가
 * 떠나는 화면 안에 있으면 화면과 함께 사라진다. 루트(폰트 로드가 끝난 분기)에 두면 어떤 화면이 떠도
 * 호스트는 그대로다.
 *
 * 무엇을 보장하나:
 *  - 폰트가 결판난 뒤 루트를 그리면, showToast 가 루트 트리에 토스트를 올린다 — 그리고 SplashGate 도
 *    그대로 그려진다(같은 it). SplashGate 를 마커로 갈아끼웠으므로 호스트를 SplashGate(=Stack) 안에
 *    두면 여기서 red 다 — "Stack 바깥" 배치를 간접적으로 강제한다.
 *  - 폰트 결판 전 빈 렌더(`toJSON()===null`)는 토스트 요청이 있어도 유지된다.
 *
 * 커버하지 않는 것: 실제 네비게이션 뒤에 보이는지, transparentModal 위에서 가려지는지는 6-b.
 * 목 배선은 `rootLayout.test.tsx` 와 같다(그 파일은 건드리지 않는다).
 */

process.env.EXPO_PUBLIC_API_MOCK = '1';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('react-native-gesture-handler/jestSetup');

jest.mock('../../global.css', () => ({}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));

let mockFontsLoaded = true;
jest.mock('expo-font', () => ({ useFonts: () => [mockFontsLoaded, null] }));

jest.mock('@/app-shell/ui/SplashGate', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/splashGateMock')
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RootLayout = require('@/app/_layout').default as ComponentType;
type ToastModule = typeof import('@/shared/ui/Toast');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Toast = require('@/shared/ui/Toast') as ToastModule;

beforeEach(() => {
  mockFontsLoaded = true;
});

afterEach(() => {
  act(() => Toast.hideToast());
});

describe('🔴 T4 · 루트 레이아웃 — 토스트 호스트 배선 (D19)', () => {
  it('폰트가 결판나면 루트 트리에 토스트가 뜨고, SplashGate 도 그대로 그려진다', () => {
    render(<RootLayout />);

    act(() =>
      Toast.showToast({ message: '루트 확인', testID: 'root-probe-toast' })
    );

    expect(screen.getByTestId('root-probe-toast')).toBeOnTheScreen();
    expect(screen.getByTestId('splash-gate')).toBeOnTheScreen();
  });

  it('폰트 결판 전에는 토스트 요청이 있어도 아무것도 그리지 않는다', () => {
    mockFontsLoaded = false;
    act(() =>
      Toast.showToast({ message: '루트 확인', testID: 'root-probe-toast' })
    );

    render(<RootLayout />);

    expect(screen.toJSON()).toBeNull();
  });
});
