import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react-native';

/**
 * AC E1 · E3 — SafeAreaProvider 전역 도입 (D4 결정).
 *
 * 무엇을 보장하나:
 *  (E1) 루트 레이아웃에 SafeAreaProvider 가 있고, D4 가 정한 대로 GestureHandlerRootView **안쪽**에 있다,
 *  (E3) 그것을 넣은 뒤에도 **첫 렌더에 곧바로 SplashGate 가 그려진다**.
 *
 * ⚠️ E3 는 형식적인 회귀 문구가 아니라 **실측된 함정**이다. 이 사이클의 [테스트 작성] 단계에서
 *    SafeAreaProvider 를 실제로 넣고 전체 스위트를 돌려 본 결과, 기존 `rootLayout.test.tsx` 의
 *    "첫 렌더에 SplashGate" 테스트가 깨졌다:
 *
 *      Unable to find an element with testID: splash-gate
 *      <View><RNCSafeAreaProvider /></View>
 *
 *    SafeAreaProvider 는 네이티브 레이아웃에서 인셋 값을 받기 전까지 **자식을 렌더하지 않는다.**
 *    jest 에는 레이아웃 패스가 없어 그 값이 영영 오지 않으므로 자식이 사라진다.
 *    `initialMetrics` 를 주면 첫 렌더부터 자식을 그린다 — 다만 `initialWindowMetrics` 는 jest 에서
 *    null 이라(네이티브 모듈 부재) null 대비 기본값까지 함께 줘야 통과한다. 실측으로 확인했다.
 *
 * 이 파일은 그 함정을 테스트로 고정해, 구현자가 SafeAreaProvider 를 "그냥 감싸기"만 하고
 * 지나가지 못하게 만든다.
 */

process.env.EXPO_PUBLIC_API_MOCK = '1';

// react-native-gesture-handler 는 네이티브 모듈을 요구하므로 공식 jest 목 설정을 먼저 건다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('react-native-gesture-handler/jestSetup');

// global.css 는 jest 의 transform 대상이 아니라 그대로 require 하면 SyntaxError 가 난다.
jest.mock('../../global.css', () => ({}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

// 실물 SplashGate 는 렌더 즉시 부트스트랩 요청을 발사하므로 관찰용 마커로 대체한다.
jest.mock('@/app-shell/ui/SplashGate', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/splashGateMock')
);

// jestSetup 이 먼저 돌아야 하므로 import 문(호이스팅) 대신 require 로 순서를 고정한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GestureHandlerRootView } = require('react-native-gesture-handler');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SafeAreaProvider } = require('react-native-safe-area-context');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RootLayout = require('@/app/_layout').default as ComponentType;

describe('루트 레이아웃 — SafeAreaProvider 전역 도입 (AC E1)', () => {
  it('SafeAreaProvider 가 GestureHandlerRootView 안쪽에 존재한다 (D4)', () => {
    render(<RootLayout />);

    const gestureRoot = screen.UNSAFE_getByType(GestureHandlerRootView);
    // 바깥/안쪽 순서가 뒤바뀌면 제스처 루트가 인셋 컨텍스트 밖으로 나가 바텀시트 계산이 어긋난다.
    expect(within(gestureRoot).UNSAFE_getByType(SafeAreaProvider)).toBeTruthy();
  });
});

describe('루트 레이아웃 — 전역 변경의 기존 동작 비영향 (AC E3)', () => {
  // 두 단언을 **한 it 안에** 둔다. "SplashGate 가 그려진다"만 따로 두면 SafeAreaProvider 가
  // 아직 없는 지금도 통과해 버려(가짜 통과), 정작 막으려던 함정을 못 막는다.
  // 둘을 묶어야 "인셋을 도입했고, 그런데도 화면이 살아 있다"를 검사하게 된다.
  it('SafeAreaProvider 가 존재하면서도 첫 렌더에 곧바로 SplashGate 를 그린다', () => {
    render(<RootLayout />);

    expect(screen.UNSAFE_getByType(SafeAreaProvider)).toBeTruthy();
    // initialMetrics 없이 감싸기만 하면 자식이 통째로 사라져 이 줄이 빨개진다(실측 확인).
    expect(screen.getByTestId('splash-gate')).toBeOnTheScreen();
  });
});
