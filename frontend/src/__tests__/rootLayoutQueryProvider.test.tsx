import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';
import { QueryClient } from '@tanstack/react-query';

import {
  getObservedQueryClient,
  resetObservedQueryClient,
} from '@/test-support/queryClientProbe';

/**
 * TRIP-179 AC-3 — 앱 셸이 `QueryClientProvider`를 실제로 씌우는지 관찰한다.
 *
 * 무엇을 보장하나: 앱을 부팅하면 셸 안쪽에서 `useQueryClient()`(따라서 `useQuery`도)를
 * 부를 수 있는 상태가 된다. 이번 칸에는 그것을 소비하는 화면이 없으므로 프로브 컴포넌트로
 * 관찰한다. 목 배선은 `rootLayout.test.tsx`(부팅 골격 축소 회귀)와 동일하되, `SplashGate`
 * 자리에 마커 대신 QueryClient 관찰 프로브(`@/test-support/queryClientProbe`)를 꽂는다 —
 * 그 파일은 건드리지 않고 새 파일로 관심사를 가른다.
 *
 * 이 배선이 성립하려면 Provider가 `SplashGate` 바깥에 있어야 한다(D4). 구현이 이를 어기고
 * `SplashGate` 안에 Provider를 두면 프로브가 그 자리를 대체해 버려 아래 단언이 red로 남는다
 * — 즉 이 파일이 Provider 배치를 문자열로 잠그지 않고도 D4를 간접적으로 강제한다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 잠그는 것은 "값의 위치"가 아니라 "관찰 가능성"(동작)이라,
 * Provider를 `app-shell/ui/AppProviders.tsx`로 추출하는 정당한 리팩토링에도 살아남는다.
 */

process.env.EXPO_PUBLIC_API_MOCK = '1';

// react-native-gesture-handler 는 네이티브 모듈을 요구하므로 공식 jest 목 설정을 먼저 건다.
// jestSetup 이 먼저 돌아야 하므로 아래 _layout require 보다 앞서야 한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('react-native-gesture-handler/jestSetup');

// global.css 는 jest 의 transform 대상이 아니라 그대로 require 하면 SyntaxError 가 난다.
jest.mock('../../global.css', () => ({}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));

// 폰트는 항상 결판난 상태로 둔다 — 이 파일의 관심사는 부팅 타이밍이 아니라 QueryClient
// 관찰 가능성이다.
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));

// 실물 SplashGate 는 렌더 즉시 부트스트랩 요청을 발사하므로, QueryClient 를 손에 쥐었는지만
// 관찰하는 프로브로 대체한다. 배럴(@/app-shell)이 ./ui/SplashGate 를 재수출하므로 깊은
// 경로를 목으로 갈면 배럴을 타고 내려온다(rootLayout.test.tsx 가 이미 그렇게 돈다).
jest.mock('@/app-shell/ui/SplashGate', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/queryClientProbe')
);

// jestSetup 이 먼저 돌아야 하므로 import 문(호이스팅) 대신 require 로 순서를 고정한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RootLayout = require('@/app/_layout').default as ComponentType;

describe('AC-3 · 루트 레이아웃 — QueryClientProvider 관찰 가능성 (C-1)', () => {
  beforeEach(() => {
    resetObservedQueryClient();
  });

  it('셸 안쪽에서 useQueryClient()를 부를 수 있고, 프로브가 진짜 QueryClient 인스턴스를 받는다', () => {
    // 실행을 함수로 감싼다 — 렌더를 먼저 실행해 놓고 나중에 단언하면 예외가 그대로 튀어나가
    // assertion diff가 사라진다.
    const renderRoot = () => render(<RootLayout />);

    // 순서 중요 — red 상태에서는 여기가 "No QueryClient set, use QueryClientProvider to
    // set one"을 담은 읽히는 실패로 끝난다.
    expect(renderRoot).not.toThrow();

    expect(screen.getByTestId('query-client-probe')).toBeOnTheScreen();

    // 가짜 통과 방지 짝 — 위 두 단언만 두면 프로브가 useQueryClient()를 부르지 않는
    // 멍청한 마커로 퇴화해도 초록이다. 진짜 클라이언트 인스턴스를 손에 쥐었는지까지 본다.
    expect(getObservedQueryClient()).toBeInstanceOf(QueryClient);
  });
});
