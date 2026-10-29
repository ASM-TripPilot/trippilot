import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { seoulDate } from '@/shared/lib/seoulDate';

import { overrideEngineDeps } from './deps';
import {
  evaluate,
  handleGeofence,
  handleLocations,
  setContext,
  type EngineDeps,
} from './engine';
import type { NativeAdapters } from './native';
import type { PermissionSnapshot } from './permission';
import { createFakeAutomationSink } from './sink';
import { createAutomationStore, createMemoryFs } from './store';
import {
  useLocationAutomation,
  type LocationAutomationInput,
} from './useLocationAutomation';
import { newTestQueryClient } from '@/test-support/queryRender';

/**
 * TRIP-1338 · 포그라운드 훅 — 플래그 OFF 효과 0 · [켜기] 거절은 오류가 아니다 · 포그라운드 복귀 강등.
 * 3동작 뼈대: 준비=플래그·권한 목 + 가짜 엔진 의존 → 실행=renderHook·enable·AppState → 단언=상태·호출.
 */

let mockFlag = true;
let mockSnapshot: PermissionSnapshot;
const mockRequest = jest.fn();
const mockRead = jest.fn(async () => mockSnapshot);

jest.mock('./flag', () => ({ isLocationAutomationEnabled: () => mockFlag }));
jest.mock('./permission', () => ({
  readPermissionSnapshot: () => mockRead(),
  requestAlwaysPermission: () => mockRequest(),
}));

const T0 = Date.UTC(2026, 7, 20, 1, 0, 0);
const TODAY = seoulDate(new Date(T0));

function makeDeps() {
  const nativeCalls: string[] = [];
  const native: NativeAdapters = {
    armGeofences: async () => {
      nativeCalls.push('arm');
      return { armed: true };
    },
    disarmGeofences: async () => {
      nativeCalls.push('disarm');
    },
    startRouteRecording: async () => {
      nativeCalls.push('route-start');
      return { recording: true };
    },
    stopRouteRecording: async () => {
      nativeCalls.push('route-stop');
    },
  };
  const sink = createFakeAutomationSink();
  let id = 0;
  const deps: EngineDeps = {
    store: createAutomationStore(createMemoryFs()),
    sink,
    native,
    now: () => T0,
    newId: () => `id-${(id += 1)}`,
  };
  return { deps, sink, nativeCalls };
}

const input: LocationAutomationInput = {
  tripId: 'trip-1',
  startDate: '2026-08-19',
  endDate: '2026-08-22',
  date: TODAY,
  slots: [{ slotKey: `${TODAY}#a`, poiId: 'a', lat: 37.5, lng: 127 }],
  visits: [],
  consentOn: true,
  onHub: true,
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={newTestQueryClient()}>
    {children}
  </QueryClientProvider>
);

const WIU: PermissionSnapshot = {
  foreground: 'granted',
  background: 'undetermined',
  backgroundCanAskAgain: true,
  precise: true,
};

let appStateListener: ((s: AppStateStatus) => void) | null = null;
beforeEach(() => {
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, fn) => {
    appStateListener = fn as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
  mockRequest.mockReset();
  mockRead.mockClear();
});
afterEach(() => {
  overrideEngineDeps(null);
  jest.restoreAllMocks();
});

describe('useLocationAutomation', () => {
  it('H1 플래그 OFF → MANUAL·flag-off, 권한 조회·네이티브·싱크 호출 0(BR-U10-07)', async () => {
    mockFlag = false;
    const t = makeDeps();
    overrideEngineDeps(t.deps);
    const { result } = renderHook(() => useLocationAutomation(input), {
      wrapper,
    });
    await act(async () => {});
    expect(result.current).toMatchObject({
      state: 'MANUAL',
      reason: 'flag-off',
      enabled: false,
    });
    expect(mockRead).not.toHaveBeenCalled();
    expect(t.sink.calls).toEqual([]);
    expect(t.nativeCalls).toEqual([]);
    expect(appStateListener).toBeNull();
    mockFlag = true;
  });

  it('H2 허브 첫 진입 when-in-use → EXPLAINER, [켜기] 거절은 오류 없이 MANUAL·다시 묻지 않음', async () => {
    mockSnapshot = WIU;
    const t = makeDeps();
    overrideEngineDeps(t.deps);
    const { result } = renderHook(() => useLocationAutomation(input), {
      wrapper,
    });
    await waitFor(() => expect(result.current.state).toBe('EXPLAINER'));

    mockRequest.mockResolvedValueOnce('denied');
    await act(async () => {
      await result.current.enable();
    });
    expect(result.current.state).toBe('MANUAL');
    expect(result.current.reason).toBe('when-in-use');
    expect(t.nativeCalls).toEqual([]);
  });

  it('H3 [켜기] 승인 → ARMED (리전 등록·경로 시작)', async () => {
    mockSnapshot = WIU;
    const t = makeDeps();
    overrideEngineDeps(t.deps);
    const { result } = renderHook(() => useLocationAutomation(input), {
      wrapper,
    });
    await waitFor(() => expect(result.current.state).toBe('EXPLAINER'));
    mockRequest.mockImplementationOnce(async () => {
      mockSnapshot = { ...WIU, background: 'granted' };
      return 'granted';
    });
    await act(async () => {
      await result.current.enable();
    });
    expect(result.current.state).toBe('ARMED');
    expect(t.nativeCalls).toEqual(['arm', 'route-start']);
  });

  it('H4 포그라운드 복귀 시 강등 감지 → 해제 + END 보고 + 안내 1줄', async () => {
    mockSnapshot = { ...WIU, background: 'granted' };
    const t = makeDeps();
    overrideEngineDeps(t.deps);
    const { result } = renderHook(() => useLocationAutomation(input), {
      wrapper,
    });
    await waitFor(() => expect(result.current.state).toBe('ARMED'));

    mockSnapshot = {
      ...WIU,
      background: 'denied',
      backgroundCanAskAgain: false,
    };
    await act(async () => {
      appStateListener?.('active');
    });
    await waitFor(() => expect(result.current.state).toBe('MANUAL'));
    expect(result.current.notice).toEqual({
      kind: 'degraded',
      reason: 'background-blocked',
    });
    expect(t.nativeCalls).toContain('disarm');
    const ends = t.sink.calls.filter(
      (c) => c.op === 'reportInterval' && c.report.phase === 'END'
    );
    expect(ends).toHaveLength(2);

    await act(async () => {
      await result.current.dismissNotice();
    });
    expect(result.current.notice).toBeNull();
  });

  // TRIP-1511 · 네이티브 어댑터는 같은 리전이면 재등록을 건너뛴다(태스크 무한 루프 차단). OS 가 등록을 잃었을
  // 수 있는 포그라운드 복귀에서만 그 기억을 비워 한 번 다시 등록하게 한다 — 백그라운드 태스크 경로는 비우지 않는다.
  it('H5 포그라운드 복귀마다 무장 전에 등록 기억을 비운다', async () => {
    mockSnapshot = { ...WIU, background: 'granted' };
    const t = makeDeps();
    const forget = jest.fn(() => {
      t.nativeCalls.push('forget');
    });
    t.deps.native.forgetArmedRegions = forget;
    overrideEngineDeps(t.deps);
    const { result } = renderHook(() => useLocationAutomation(input), {
      wrapper,
    });
    await waitFor(() => expect(result.current.state).toBe('ARMED'));
    expect(t.nativeCalls.slice(0, 2)).toEqual(['forget', 'arm']);

    t.nativeCalls.length = 0;
    await act(async () => {
      appStateListener?.('active');
    });
    await waitFor(() => expect(t.nativeCalls).toContain('arm'));
    expect(t.nativeCalls.indexOf('forget')).toBeLessThan(
      t.nativeCalls.indexOf('arm')
    );
  });
});

/**
 * TRIP-1517 · 포그라운드 복귀 wake — 정지해 있어도 앱을 열면 3분 지난 진입이 도착으로 확정된다.
 * 3동작 뼈대: 준비=엔진으로 무장+진입(슬롯 ENTERED)을 먼저 만들어 둠 → 실행=훅 마운트·AppState active → 단언=싱크로 나간 ARRIVE.
 * 훅이 엔진의 어떤 함수를 부르는지는 보지 않는다 — "ARRIVE 가 나갔나/안 나갔나"라는 효과만 본다.
 */
describe('useLocationAutomation — 포그라운드 복귀 wake (TRIP-1517)', () => {
  const MIN = 60_000;
  const A = `${TODAY}#a`;
  const ARMED_SNAP: PermissionSnapshot = { ...WIU, background: 'granted' };
  const sendsOf = (t: ReturnType<typeof makeDeps>) =>
    t.sink.calls.flatMap((c) => (c.op === 'sendAutoEvents' ? [c.batch] : []));
  const phaseOfA = (t: ReturnType<typeof makeDeps>) =>
    t.deps.store.load().state.judge?.state.slots[A]?.phase;

  // 슬롯 a 가 T0 에 진입해 ENTERED(근거 표본은 진입 3초 전)인 채 앱이 닫힌 상태. 시계는 가변.
  async function armedWithEntered() {
    const t = makeDeps();
    let clock = T0;
    t.deps.now = () => clock;
    overrideEngineDeps(t.deps);
    await setContext(t.deps, { ...input, tripId: 'trip-1' });
    await evaluate(t.deps, { flagOn: true, snapshot: ARMED_SNAP, onHub: true });
    // 결함 순서 그대로: 라우트 표본이 먼저 처리되고(슬롯 IDLE), 그다음 진입.
    await handleLocations(t.deps, [
      { t: T0 - 3_000, lat: 37.5, lng: 127, acc: 15 },
    ]);
    await handleGeofence(t.deps, { slotKey: A, type: 'enter' });
    return {
      t,
      setClock: (ms: number) => {
        clock = ms;
      },
    };
  }

  it('HW1 active 가 오면 3분 지난 ENTERED 슬롯이 도착으로 한 번 나간다(마운트 땐 3분 전이라 안 나간다)', async () => {
    mockSnapshot = ARMED_SNAP;
    const { t, setClock } = await armedWithEntered();
    setClock(T0 + MIN);
    const { result } = renderHook(() => useLocationAutomation(input), {
      wrapper,
    });
    await waitFor(() => expect(result.current.state).toBe('ARMED'));
    expect(sendsOf(t)).toHaveLength(0);

    setClock(T0 + 4 * MIN);
    await act(async () => {
      appStateListener?.('active');
    });

    await waitFor(() => expect(sendsOf(t)).toHaveLength(1));
    expect(sendsOf(t)[0].events).toEqual([
      expect.objectContaining({
        kind: 'ARRIVE',
        slotKey: A,
        occurredAt: new Date(T0).toISOString(),
      }),
    ]);
  });

  it('HW2 무장이 아니면(권한 강등) active 가 와도 도착을 내지 않는다', async () => {
    mockSnapshot = {
      ...WIU,
      background: 'denied',
      backgroundCanAskAgain: false,
    };
    const { t, setClock } = await armedWithEntered();
    setClock(T0 + 4 * MIN);
    const { result } = renderHook(() => useLocationAutomation(input), {
      wrapper,
    });
    // 처음 MANUAL('no-context')과 구분: 강등 판정이 끝나야 이 사유가 된다.
    await waitFor(() =>
      expect(result.current.reason).toBe('background-blocked')
    );

    await act(async () => {
      appStateListener?.('active');
    });
    await act(async () => {});

    expect(sendsOf(t)).toHaveLength(0);
    expect(phaseOfA(t)).toBe('ENTERED');
  });

  it('HW3 포그라운드가 아닌 refresh([켜기] 등)는 wake 를 넣지 않고, 다음 active 에서만 도착한다', async () => {
    mockSnapshot = WIU; // when-in-use(이미 설명을 본 여행) — 마운트 때 강등으로 해제된다
    const { t, setClock } = await armedWithEntered();
    setClock(T0 + 4 * MIN);
    const { result } = renderHook(() => useLocationAutomation(input), {
      wrapper,
    });
    await waitFor(() => expect(result.current.reason).toBe('when-in-use'));

    mockSnapshot = ARMED_SNAP;
    await act(async () => {
      await result.current.enable();
    });
    expect(result.current.state).toBe('ARMED');
    expect(sendsOf(t)).toHaveLength(0);

    await act(async () => {
      appStateListener?.('active');
    });
    await waitFor(() => expect(sendsOf(t)).toHaveLength(1));
  });
});
