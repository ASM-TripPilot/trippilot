import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';

import { fetchBootstrap } from '@/shared/api';
import { hasStoredToken } from '@/shared/storage';
import { BOOTSTRAP_TIMEOUT_MS, useBootstrapGate } from './useBootstrapGate';

jest.mock('@/shared/api', () => ({ fetchBootstrap: jest.fn() }));
jest.mock('@/shared/storage', () => ({ hasStoredToken: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()) },
}));

const mockFetchBootstrap = fetchBootstrap as jest.MockedFunction<
  typeof fetchBootstrap
>;
const mockHasStoredToken = hasStoredToken as jest.MockedFunction<
  typeof hasStoredToken
>;
const mockAddEventListener = NetInfo.addEventListener as jest.Mock;

const NEVER = () => new Promise<never>(() => {});

function bootstrap(
  session: 'AUTHENTICATED' | 'GUEST' | 'ONBOARDING_INCOMPLETE'
) {
  return {
    appUpdate: { status: 'NONE', minSupportedVersion: '1.0.0' },
    reconsent: { required: false, termsTypes: [] },
    session: {
      state: session,
      onboardingCompleted: session === 'AUTHENTICATED',
    },
  };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetchBootstrap.mockReset();
  mockHasStoredToken.mockReset();
  mockAddEventListener.mockReset().mockReturnValue(jest.fn());
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useBootstrapGate — 타임아웃 상수', () => {
  it('BOOTSTRAP_TIMEOUT_MS 는 3000ms 다 (AC-SHELL-01-8 임계값, §10 결정)', () => {
    expect(BOOTSTRAP_TIMEOUT_MS).toBe(3000);
  });
});

describe('useBootstrapGate — 부트스트랩 응답/폴백/재검증', () => {
  it('bootstrap 응답 도착 전 타임아웃 이내에는 loading 을 유지하고 분기하지 않는다 (AC-SHELL-01-7)', async () => {
    mockFetchBootstrap.mockImplementation(NEVER);
    mockHasStoredToken.mockResolvedValue(true);

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS - 1);
    });

    expect(result.current.phase).toBe('loading');
    expect(result.current.destination).toBeNull();
  });

  it('응답이 타임아웃 이내 도착하면 서버 세션대로 분기한다 (AUTHENTICATED → HOME)', async () => {
    mockFetchBootstrap.mockResolvedValue(bootstrap('AUTHENTICATED'));
    mockHasStoredToken.mockResolvedValue(true);

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });

    expect(result.current.phase).toBe('resolved');
    expect(result.current.destination).toBe('HOME');
    expect(result.current.isProvisional).toBe(false);
  });

  it('타임아웃 + 로컬 토큰 있음 → 잠정 HOME 으로 분기한다 (무한 스플래시 금지, AC-SHELL-01-8)', async () => {
    mockFetchBootstrap.mockImplementation(NEVER);
    mockHasStoredToken.mockResolvedValue(true);

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS);
    });

    expect(result.current.phase).toBe('resolved');
    expect(result.current.destination).toBe('HOME');
    expect(result.current.isProvisional).toBe(true);
  });

  it('타임아웃 + 로컬 토큰 없음 → 잠정 LOGIN 으로 분기한다 (AC-SHELL-01-8)', async () => {
    mockFetchBootstrap.mockImplementation(NEVER);
    mockHasStoredToken.mockResolvedValue(false);

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS);
    });

    expect(result.current.phase).toBe('resolved');
    expect(result.current.destination).toBe('LOGIN');
    expect(result.current.isProvisional).toBe(true);
  });

  it('타임아웃 잠정 분기 후 온라인 복구 시 bootstrap 을 재호출해 재검증·재분기한다 (AC-SHELL-01-9)', async () => {
    mockFetchBootstrap.mockReturnValueOnce(NEVER());
    mockFetchBootstrap.mockResolvedValue(bootstrap('GUEST'));
    mockHasStoredToken.mockResolvedValue(true);

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS);
    });

    expect(result.current.destination).toBe('HOME');
    expect(result.current.isProvisional).toBe(true);

    const onlineCallback = mockAddEventListener.mock.calls[0][0] as (state: {
      isConnected: boolean;
    }) => void;

    await act(async () => {
      onlineCallback({ isConnected: true });
      await jest.advanceTimersByTimeAsync(10);
    });

    expect(mockFetchBootstrap.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.destination).toBe('LOGIN');
    expect(result.current.isProvisional).toBe(false);
  });
});
