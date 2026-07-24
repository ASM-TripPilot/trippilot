import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';

import { fetchBootstrap } from '@/shared/api';
import { hasStoredToken, getTokens } from '@/shared/storage';
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from '@/shared/api/tokenManager';
import { BOOTSTRAP_TIMEOUT_MS, useBootstrapGate } from './useBootstrapGate';

jest.mock('@/shared/api', () => ({ fetchBootstrap: jest.fn() }));
// getTokens 추가 필수 — 빠뜨리면 훅이 getTokens is not a function 으로 죽는다(TypeError는
// red 가 아니라 사고다). @/shared/api/tokenManager 는 다른 모듈 경로라 여기서 목킹하지 않아도
// 실물이 그대로 로드된다 — 이 파일의 케이스 3~8 설계 전체가 그 사실 위에 서 있다.
jest.mock('@/shared/storage', () => ({
  hasStoredToken: jest.fn(),
  getTokens: jest.fn(),
}));
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
const mockGetTokens = getTokens as jest.MockedFunction<typeof getTokens>;
const mockAddEventListener = NetInfo.addEventListener as jest.Mock;

const NEVER = () => new Promise<never>(() => {});

function bootstrap(
  session: 'AUTHENTICATED' | 'GUEST' | 'ONBOARDING_INCOMPLETE',
  onboardingCompleted: boolean = session === 'AUTHENTICATED'
) {
  return {
    appUpdate: { status: 'NONE', minSupportedVersion: '1.0.0' },
    reconsent: { required: false, termsTypes: [] },
    session: {
      state: session,
      onboardingCompleted,
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
  mockGetTokens.mockReset();
  mockAddEventListener.mockReset().mockReturnValue(jest.fn());
  // tokenManager 는 모듈 스코프 단일 상태다 — 비우지 않으면 앞 테스트의 토큰이 샌다(7-16).
  clearAccessToken();
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

describe('useBootstrapGate — 부팅 시 토큰 복원 순서 (AC-S3 · 결함 D)', () => {
  it('부팅 시 저장 토큰이 첫 부트스트랩보다 먼저 메모리에 실린다 (케이스 3)', async () => {
    // 준비 — 저장소에 access/refresh 가 있다(콜드 재시작 상황).
    mockGetTokens.mockResolvedValue({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
    });
    mockHasStoredToken.mockResolvedValue(true);
    // 관측 장치 — 목을 더 걸지 않고, fetchBootstrap 이 "불린 그 순간의" 실 홀더 값을 찍는다.
    let seenToken: string | null | undefined;
    mockFetchBootstrap.mockImplementation(async () => {
      seenToken = getAccessToken();
      return bootstrap('AUTHENTICATED');
    });

    // 실행
    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });

    // 단언 — 지금은 hydrate 호출부가 없어 seenToken 이 null 이라 실패한다.
    expect(seenToken).toBe('stored-access');
    // 복원이 별도 재조회를 일으켜 두 번 나가는 것을 막는다.
    expect(mockFetchBootstrap).toHaveBeenCalledTimes(1);
    expect(result.current.destination).toBe('HOME');
  });

  it('저장소가 비면 홀더는 null 이다 (케이스 3의 대조 — 케이스 4)', async () => {
    // 준비 — 케이스 3과 동일하되 저장소가 비어 있다.
    mockGetTokens.mockResolvedValue(null);
    mockHasStoredToken.mockResolvedValue(true);
    let seenToken: string | null | undefined;
    mockFetchBootstrap.mockImplementation(async () => {
      seenToken = getAccessToken();
      return bootstrap('AUTHENTICATED');
    });

    // 실행
    renderHook(() => useBootstrapGate(), { wrapper: createWrapper() });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });

    // 단언 — null 이어야 한다. 빈 문자열('')로는 통과하면 안 된다(쓰레기 값 혼입 방지).
    expect(seenToken).toBeNull();
    expect(seenToken).not.toBe('');
  });
});

describe('useBootstrapGate — 로그인 성공 후 재조회 (AC-S1 · 결함 A-1 · US-ONB-01·02)', () => {
  it('토큰 변경이 부트스트랩 재조회를 일으키고, 신규 가입자(온보딩 미완료)는 ONBOARDING 으로 간다 (케이스 5)', async () => {
    // 준비 — 콜드스타트는 무토큰(GUEST)이고, 로그인 성공 후 서버는 AUTHENTICATED+미완료를 준다.
    mockGetTokens.mockResolvedValue(null);
    mockHasStoredToken.mockResolvedValue(false);
    mockFetchBootstrap
      .mockResolvedValueOnce(bootstrap('GUEST'))
      .mockResolvedValue(bootstrap('AUTHENTICATED', false));

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    // 출발점 고정 — 로그인 전에는 LOGIN 이어야 한다.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(result.current.destination).toBe('LOGIN');

    // 실행 — 로그인 성공이 토큰 홀더를 바꾼 상황을 흉내낸다.
    await act(async () => {
      setAccessToken('new-access');
      await jest.advanceTimersByTimeAsync(10);
    });

    // 단언 — 재조회가 일어났고(2회), 로그인 화면(LOGIN)에 머무르지 않는다(결함 A 정면).
    expect(mockFetchBootstrap).toHaveBeenCalledTimes(2);
    expect(result.current.destination).toBe('ONBOARDING');
    expect(result.current.destination).not.toBe('LOGIN');
    expect(result.current.isProvisional).toBe(false);
  });

  it('온보딩 완료자는 HOME 으로 간다 (케이스 6)', async () => {
    // 준비 — 케이스 5와 같되 재조회 응답의 onboardingCompleted 만 true.
    mockGetTokens.mockResolvedValue(null);
    mockHasStoredToken.mockResolvedValue(false);
    mockFetchBootstrap
      .mockResolvedValueOnce(bootstrap('GUEST'))
      .mockResolvedValue(bootstrap('AUTHENTICATED', true));

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(result.current.destination).toBe('LOGIN');

    await act(async () => {
      setAccessToken('new-access');
      await jest.advanceTimersByTimeAsync(10);
    });

    expect(result.current.destination).toBe('HOME');
    expect(result.current.destination).not.toBe('LOGIN');
  });
});

describe('useBootstrapGate — 재조회 무응답은 잠정 분기를 쓰지 않는다 (AC-S2 · Seed §2)', () => {
  it('로그인 직후 재조회가 무응답이어도 잠정 HOME 으로 새지 않고 토큰을 지키지 않는다 (케이스 7)', async () => {
    // 준비 — 1번째 응답은 GUEST, 그 다음(재조회)은 영원히 pending.
    // hasStoredToken=true 로 "함정"을 파둔다 — 잠정 분기가 되살아나면 HOME 이 나온다.
    mockGetTokens.mockResolvedValue(null);
    mockHasStoredToken.mockResolvedValue(true);
    mockFetchBootstrap
      .mockResolvedValueOnce(bootstrap('GUEST'))
      .mockImplementation(NEVER);

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    // 출발점 고정.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(result.current.destination).toBe('LOGIN');

    // 실행 — 재조회를 발동시키고, 3초 타임아웃을 완전히 흘려보낸다.
    // 재조회가 "effect 재실행"으로 구현되면 여기서 새 타이머가 무장돼 잠정 HOME 으로 튄다(7-11).
    await act(async () => {
      setAccessToken('new-access');
      await jest.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS + 100);
    });

    // 단언 — 잠정 분기로 새지 않고(LOGIN 유지), 토큰도 지우지 않는다(무응답은 미확정 · 401만 확정).
    expect(result.current.destination).toBe('LOGIN');
    expect(result.current.isProvisional).toBe(false);
    expect(getAccessToken()).toBe('new-access');
  });
});

describe('useBootstrapGate — 언마운트 시 구독 해제 (누수 가드)', () => {
  it('언마운트 후에는 토큰이 바뀌어도 더 이상 부트스트랩을 다시 부르지 않는다 (케이스 8)', async () => {
    // 준비
    mockGetTokens.mockResolvedValue(null);
    mockHasStoredToken.mockResolvedValue(false);
    mockFetchBootstrap.mockResolvedValue(bootstrap('GUEST'));

    const { unmount } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });

    // 실행 — 화면을 떠난 뒤 토큰을 바꾼다.
    unmount();
    await act(async () => {
      setAccessToken('after-unmount');
      await jest.advanceTimersByTimeAsync(10);
    });

    // 단언 — 언마운트 이후로는 호출 횟수가 늘지 않는다(구독이 끊겼다).
    expect(mockFetchBootstrap).toHaveBeenCalledTimes(1);
  });
});
