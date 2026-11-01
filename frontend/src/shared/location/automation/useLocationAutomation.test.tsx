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
      tripId: 'trip-1',
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
    await setContext(t.deps, { ...input, tripId: 'trip-1', consentOn: true });
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

/**
 * TRIP-1696 · 동의 조회가 끝나기 전(consentOn=null)에는 판정하지 않는다 — "모름"을 "철회"로 읽으면 무장 중인 기기가
 * 허브를 열 때마다 강등(CONSENT_REVOKED END)·원시 표본 삭제를 당한다(BR-U10-42 위반).
 * 3동작 뼈대: 준비=엔진으로 무장 + 원시 표본 1건 → 실행=consentOn null 로 마운트, 그다음 true 로 다시 렌더 → 단언=END·삭제·안내 0, 그 뒤 ARMED.
 */
describe('useLocationAutomation — 동의 조회 전 판정 보류 (TRIP-1696)', () => {
  const ARMED_SNAP: PermissionSnapshot = { ...WIU, background: 'granted' };
  const endsOf = (t: ReturnType<typeof makeDeps>) =>
    t.sink.calls.filter(
      (c) => c.op === 'reportInterval' && c.report.phase === 'END'
    );

  async function armedWithRaw() {
    const t = makeDeps();
    overrideEngineDeps(t.deps);
    await setContext(t.deps, { ...input, tripId: 'trip-1', consentOn: true });
    await evaluate(t.deps, { flagOn: true, snapshot: ARMED_SNAP, onHub: true });
    await handleLocations(t.deps, [{ t: T0, lat: 37.5, lng: 127, acc: 10 }]);
    // 전제 — 무장돼 있고 원시 표본이 있다(아래 "안 지움"이 공짜로 참이 되지 않게).
    expect(t.deps.store.readRaw(TODAY)).toHaveLength(1);
    t.nativeCalls.length = 0;
    return t;
  }

  it('HC1 consentOn=null 이면 강등·END 보고·원시 표본 삭제·안내가 일어나지 않는다', async () => {
    mockSnapshot = ARMED_SNAP;
    const t = await armedWithRaw();
    const { result } = renderHook(
      () => useLocationAutomation({ ...input, consentOn: null }),
      { wrapper }
    );
    await act(async () => {});
    await act(async () => {});

    expect(endsOf(t)).toHaveLength(0);
    expect(t.nativeCalls).not.toContain('disarm');
    expect(t.deps.store.readRaw(TODAY)).toHaveLength(1);
    expect(result.current.notice).toBeNull();
    expect(result.current.reason).not.toBe('consent-off');
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('HC2 조회가 legalConsent=true 로 끝나면 그때 판정해 consent-off 없이 ARMED 로 이어진다', async () => {
    mockSnapshot = ARMED_SNAP;
    const t = await armedWithRaw();
    const { result, rerender } = renderHook(
      (p: { consentOn: boolean | null }) =>
        useLocationAutomation({ ...input, consentOn: p.consentOn }),
      { wrapper, initialProps: { consentOn: null } }
    );
    await act(async () => {});

    rerender({ consentOn: true });

    await waitFor(() => expect(result.current.state).toBe('ARMED'));
    expect(endsOf(t)).toHaveLength(0);
    expect(t.deps.store.readRaw(TODAY)).toHaveLength(1);
  });

  it('HC3 조회가 legalConsent=false(실제 철회)로 끝나면 지금처럼 강등 안내 「consent-off」 + 원시 표본 삭제', async () => {
    mockSnapshot = ARMED_SNAP;
    const t = await armedWithRaw();
    const { result, rerender } = renderHook(
      (p: { consentOn: boolean | null }) =>
        useLocationAutomation({ ...input, consentOn: p.consentOn }),
      { wrapper, initialProps: { consentOn: null } }
    );
    await act(async () => {});

    rerender({ consentOn: false });

    await waitFor(() =>
      expect(result.current.notice).toEqual({
        kind: 'degraded',
        reason: 'consent-off',
        tripId: 'trip-1',
      })
    );
    expect(t.deps.store.readRaw(TODAY)).toEqual([]);
    endsOf(t).forEach(
      (c) =>
        c.op === 'reportInterval' &&
        expect(c.report.endReason).toBe('CONSENT_REVOKED')
    );
    expect(endsOf(t).length).toBeGreaterThan(0);
  });
});
