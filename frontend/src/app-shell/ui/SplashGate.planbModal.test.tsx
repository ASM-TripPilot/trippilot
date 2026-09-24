import type { ReactTestInstance } from 'react-test-renderer';
import { act, render, screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';

import { useBootstrapGate } from '@/features/auth/model/useBootstrapGate';
import { SplashGate, SPLASH_MIN_VISIBLE_MS } from './SplashGate';

/**
 * TRIP-750 · AC-9 · D1 · Q7 — 루트 Stack 이 i04 재계획 요청 라우트를 `transparentModal` 로 선언한다.
 *
 * 무엇을 보장하나: `trips/[tripId]/planb/index` 선언이 목적지와 무관하게 하나 있고(`Stack.Protected` 밖),
 * `options.presentation` 이 `transparentModal` 이다 — 허브 위에 겹쳐 뜨는 라우트 단위 속성.
 *
 * jest 가 잠그는 것은 **선언까지**다(02a ★15). 스택 목은 options 를 그리지 않으므로 목 컴포넌트가 받은
 * props 를 읽는다. 실제로 허브가 비쳐 보이는지·모달 안 제스처는 AC-V2 실기(6-b).
 */

jest.mock('@/features/auth/model/useBootstrapGate', () => ({
  __esModule: true,
  BOOTSTRAP_TIMEOUT_MS: 3000,
  useBootstrapGate: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-router', () => require('@/test-support/expoRouterStackMock'));

const mockUseBootstrapGate = useBootstrapGate as jest.MockedFunction<
  typeof useBootstrapGate
>;

const PLANB_ROUTE = 'trips/[tripId]/planb/index';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  mockUseBootstrapGate.mockReset();
  jest.useRealTimers();
});

function insideProtected(node: ReactTestInstance): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === Stack.Protected) return true;
    current = current.parent;
  }
  return false;
}

describe('🔴 P1 · planb 요청 라우트 transparentModal 선언 (AC-9)', () => {
  it.each(['HOME', 'LOGIN'] as const)(
    '목적지 %s 에서도 가드 밖에 transparentModal 선언이 하나 있다',
    (destination) => {
      mockUseBootstrapGate.mockReturnValue({
        phase: 'resolved',
        destination,
        isProvisional: false,
      });

      render(<SplashGate />);
      act(() => {
        jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
      });

      const declared = screen
        .UNSAFE_getAllByType(Stack.Screen)
        .filter((node) => node.props.name === PLANB_ROUTE);
      expect(declared).toHaveLength(1);
      expect(declared[0].props.options?.presentation).toBe('transparentModal');
      expect(insideProtected(declared[0])).toBe(false);
    }
  );
});
