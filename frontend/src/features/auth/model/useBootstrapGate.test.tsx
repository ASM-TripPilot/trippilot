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
// 실물 로드(딥 경로) — @/shared/api 목과 다른 모듈 specifier 라 목킹되지 않는다(케이스 3~8 이
// tokenManager 실물 위에 선 것과 같은 사실). 신호를 실제로 발화해 훅의 구독을 관통 검증한다.
import { notifyBootstrapReeval } from '@/shared/bootstrap/bootstrapReeval';
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

describe('useBootstrapGate — 온보딩 완료 재평가 신호 (AC-A1 · AC-A3 · 결함 A · TRIP-353)', () => {
  it('온보딩 완료 신호가 재조회를 일으켜 destination 이 HOME 으로 갱신된다 (AC-A1)', async () => {
    // 준비 — 콜드스타트는 무토큰(GUEST). 로그인 뒤 서버는 AUTHENTICATED+미완료(→ONBOARDING),
    // 온보딩 완료 신호 뒤 재조회에서는 AUTHENTICATED+완료(→HOME)를 준다.
    mockGetTokens.mockResolvedValue(null);
    mockHasStoredToken.mockResolvedValue(false);
    mockFetchBootstrap
      .mockResolvedValueOnce(bootstrap('GUEST'))
      .mockResolvedValueOnce(bootstrap('AUTHENTICATED', false))
      .mockResolvedValue(bootstrap('AUTHENTICATED', true));

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    // 실행 ① — 콜드스타트 → LOGIN.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(result.current.destination).toBe('LOGIN');

    // 실행 ② — 로그인 성공(토큰 변경)이 재조회를 일으켜 ONBOARDING 까지 간다(기존 경로 유지).
    await act(async () => {
      setAccessToken('new-access');
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(result.current.destination).toBe('ONBOARDING');

    // 실행 ③ — 온보딩 완료 신호를 발화한다(라우터를 관통하지 않는 pub/sub).
    await act(async () => {
      notifyBootstrapReeval();
      await jest.advanceTimersByTimeAsync(10);
    });

    // 단언 — 신호가 세 번째 재조회를 일으켰고(총 3회) destination 이 HOME 으로 확정됐다.
    expect(mockFetchBootstrap).toHaveBeenCalledTimes(3);
    expect(result.current.destination).toBe('HOME');
    expect(result.current.isProvisional).toBe(false);
  });

  it('완료 신호가 와도 서버가 여전히 미완료면 ONBOARDING 을 유지한다 (AC-A3 회귀)', async () => {
    // 준비 — 재조회 응답도 AUTHENTICATED+미완료. 신호가 재조회는 일으키되 판정은 ONBOARDING 이어야 한다.
    mockGetTokens.mockResolvedValue(null);
    mockHasStoredToken.mockResolvedValue(false);
    mockFetchBootstrap
      .mockResolvedValueOnce(bootstrap('GUEST'))
      .mockResolvedValue(bootstrap('AUTHENTICATED', false));

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      setAccessToken('new-access');
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(result.current.destination).toBe('ONBOARDING');

    // 실행 — 완료 신호 발화.
    await act(async () => {
      notifyBootstrapReeval();
      await jest.advanceTimersByTimeAsync(10);
    });

    // 단언 — 재조회는 실제로 일어났지만(3회) 미완료자는 홈으로 새지 않는다.
    expect(mockFetchBootstrap).toHaveBeenCalledTimes(3);
    expect(result.current.destination).toBe('ONBOARDING');
    expect(result.current.destination).not.toBe('HOME');
  });
});

describe('useBootstrapGate — 첫 왕복 인증 실패/네트워크 실패 판별 (AC-B · 결함 B · TRIP-353)', () => {
  it('첫 부트스트랩이 인증 실패(홀더 비워짐)로 끝나면 LOGIN 을 확정하고 홀더가 빈다 (AC-B1 · AC-B2)', async () => {
    // 준비 — 저장소에 토큰이 있어 부팅 시 hydrate 되지만, 그 토큰이 무효라 첫 왕복에서
    // 인터셉터가 홀더를 비운 뒤(onSessionExpired 흉내) reject 된다.
    mockGetTokens.mockResolvedValue({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
    });
    mockHasStoredToken.mockResolvedValue(true);
    mockFetchBootstrap.mockImplementation(async () => {
      // 실서버 흐름의 충실한 축약: 401 → refresh 실패 → onSessionExpired → clearAccessToken → reject.
      // onSessionExpired 는 @/shared/api 목이라 실행되지 않으므로, 홀더 비움을 목 안에서 직접 재현한다.
      clearAccessToken();
      throw new Error('401 Unauthorized');
    });

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });

    // 단언 — LOGIN 으로 확정(잠정 아님·해결됨) + 홀더가 비어 있다(BR-U0-09 메모리 측면이자 판별 신호).
    expect(result.current.destination).toBe('LOGIN');
    expect(result.current.isProvisional).toBe(false);
    expect(result.current.phase).toBe('resolved');
    expect(getAccessToken()).toBeNull();
  });

  it('첫 부트스트랩이 네트워크 실패(홀더 유지)면 토큰을 지키고 LOGIN 을 확정하지 않는다 → 타임아웃 잠정 분기 (AC-B3)', async () => {
    // 준비 — 저장 토큰 hydrate. 첫 왕복은 응답 없이 reject 하되 홀더는 건드리지 않는다
    // (= onSessionExpired 미발화 = 네트워크 실패). 이 케이스가 인증실패/네트워크실패 판별의 핵심 심판이다.
    mockGetTokens.mockResolvedValue({
      accessToken: 'stored-access',
      refreshToken: 'stored-refresh',
    });
    mockHasStoredToken.mockResolvedValue(true);
    mockFetchBootstrap.mockImplementation(async () => {
      throw new Error('Network Error'); // 홀더를 비우지 않는다
    });

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    // 실행 ① — 첫 왕복 실패 직후: 아직 확정하지 않고 loading 을 유지한다(토큰도 보존).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(result.current.phase).toBe('loading');
    expect(result.current.destination).toBeNull();
    expect(getAccessToken()).toBe('stored-access');

    // 실행 ② — 3초 타임아웃을 흘려보낸다.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS);
    });

    // 단언 — 기존 타임아웃 경로로 잠정 분기(로컬 토큰 있음 → 잠정 HOME) + 토큰은 3초 뒤에도 보존.
    expect(result.current.destination).toBe('HOME');
    expect(result.current.isProvisional).toBe(true);
    expect(getAccessToken()).toBe('stored-access');
  });

  it('게스트 콜드스타트에서 첫 왕복이 실패해도(홀더 null·저장 토큰 없음) LOGIN 을 즉시 확정하지 않는다 (AC-B3 판별 — hadStoredToken 절반 강제)', async () => {
    // 준비 — 저장 토큰이 없어 hydrate 자체가 없다(홀더 null). 첫 왕복은 reject.
    // 홀더가 null 이라도 "부팅 시 저장 토큰이 있었나"가 거짓이라 인증 실패가 아니다
    // — 이 케이스가 판별을 "홀더 null 단독"이 아니라 "hadStoredToken AND 홀더 null"로 강제한다.
    mockGetTokens.mockResolvedValue(null);
    mockHasStoredToken.mockResolvedValue(false);
    mockFetchBootstrap.mockImplementation(async () => {
      throw new Error('Network Error');
    });

    const { result } = renderHook(() => useBootstrapGate(), {
      wrapper: createWrapper(),
    });

    // 실행 ① — 첫 왕복 실패 직후: 홀더가 null 이어도 즉시 확정하지 않는다.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(result.current.phase).toBe('loading');
    expect(result.current.destination).toBeNull();

    // 실행 ② — 타임아웃을 흘려보낸다.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS);
    });

    // 단언 — 기존 경로로 잠정 LOGIN(로컬 토큰 없음), 확정(isProvisional:false)이 아니다.
    expect(result.current.destination).toBe('LOGIN');
    expect(result.current.isProvisional).toBe(true);
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
