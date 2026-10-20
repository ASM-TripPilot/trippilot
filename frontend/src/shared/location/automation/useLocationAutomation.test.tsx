import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { seoulDate } from '@/shared/lib/seoulDate';

import { overrideEngineDeps } from './deps';
import { setContext, setTripPaused, type EngineDeps } from './engine';
import type { NativeAdapters } from './native';
import type { PermissionSnapshot } from './permission';
import { createFakeAutomationSink } from './sink';
import { createAutomationStore, createMemoryFs } from './store';
import { useAutomationStatus } from './useAutomationStatus';
import {
  useLocationAutomation,
  type LocationAutomationInput,
} from './useLocationAutomation';

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
  <QueryClientProvider client={new QueryClient()}>
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
 * TRIP-1486 · 여행별 일시 중지 — 훅 쪽 계약(`paused`·`setPaused`) + l06 가 읽는 `useAutomationStatus` 의 paused 얼굴.
 * 판정·END/START 보고의 세부는 engine.test 가 잠그고, 여기서는 "화면이 쥔 훅이 그것을 어떻게 부르고 무엇을 돌려주나"만 본다.
 * 3동작 뼈대: 준비=무장된 훅 + 가짜 엔진 의존 → 실행=setPaused(act) → 단언=반환 상태·보고·권한 요청 0.
 */
describe('useLocationAutomation — 여행별 일시 중지 (TRIP-1486)', () => {
  const ARMED_SNAP: PermissionSnapshot = { ...WIU, background: 'granted' };
  const reportsOf = (t: ReturnType<typeof makeDeps>) =>
    t.sink.calls.flatMap((c) => (c.op === 'reportInterval' ? [c.report] : []));
  const endsOf = (t: ReturnType<typeof makeDeps>) =>
    reportsOf(t).filter((r) => r.phase === 'END');
  const startsOf = (t: ReturnType<typeof makeDeps>) =>
    reportsOf(t).filter((r) => r.phase === 'START');

  async function mountArmed() {
    mockSnapshot = ARMED_SNAP;
    const t = makeDeps();
    overrideEngineDeps(t.deps);
    const hook = renderHook(() => useLocationAutomation(input), { wrapper });
    await waitFor(() => expect(hook.result.current.state).toBe('ARMED'));
    return { t, ...hook };
  }

  // 응답을 붙잡아 둔 테스트가 중간에 실패해도 붙잡힌 요청을 풀어 준다 — 저장소 대기열(withStore)은 모듈 싱글턴이라
  // 안 풀면 뒤 테스트가 전부 같이 멈춘다.
  let releaseGate: (() => void) | null = null;
  afterEach(() => {
    mockFlag = true;
    releaseGate?.();
    releaseGate = null;
  });

  it('HP1 플래그 OFF 면 setPaused 는 효과 0 — 저장·네이티브·싱크·권한 조회 모두 0(BR-U10-07)', async () => {
    mockFlag = false;
    const t = makeDeps();
    overrideEngineDeps(t.deps);
    const { result } = renderHook(() => useLocationAutomation(input), {
      wrapper,
    });
    await act(async () => {
      await result.current.setPaused(true);
    });
    expect(result.current.paused).toBe(false);
    expect(t.deps.store.load().state.pausedTrips).toEqual([]);
    expect(t.nativeCalls).toEqual([]);
    expect(t.sink.calls).toEqual([]);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('HP2 setPaused(true) → paused·MANUAL, 해제 + END 2건(USER_PAUSE), 안내 띠 없음 — 포그라운드 복귀 재평가에도 그대로', async () => {
    const { t, result } = await mountArmed();
    expect(result.current.paused).toBe(false);

    await act(async () => {
      await result.current.setPaused(true);
    });

    expect(result.current).toMatchObject({
      state: 'MANUAL',
      reason: 'paused',
      paused: true,
      notice: null,
    });
    expect(t.nativeCalls).toContain('disarm');
    expect(endsOf(t).map((r) => r.endReason)).toEqual([
      'USER_PAUSE',
      'USER_PAUSE',
    ]);

    // 권한은 그대로(always)인 채 앱으로 돌아와 재평가해도 일시 중지가 유지된다.
    const reads = mockRead.mock.calls.length;
    await act(async () => {
      appStateListener?.('active');
    });
    await waitFor(() =>
      expect(mockRead.mock.calls.length).toBeGreaterThan(reads)
    );
    expect(result.current).toMatchObject({ state: 'MANUAL', paused: true });
    expect(startsOf(t)).toHaveLength(2);
  });

  it('HP3 setPaused(false) → 설명·OS 권한 요청 없이 새 START 2건, 다시 ARMED', async () => {
    const { t, result } = await mountArmed();
    await act(async () => {
      await result.current.setPaused(true);
    });
    mockRequest.mockClear();

    await act(async () => {
      await result.current.setPaused(false);
    });

    expect(result.current).toMatchObject({
      state: 'ARMED',
      reason: 'armed',
      paused: false,
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(startsOf(t)).toHaveLength(4);
    expect(t.deps.store.load().state.pausedTrips).toEqual([]);
  });

  it('HP4 일시 중지는 앱을 다시 켜도 남는다 — 마운트 직후부터 paused 이고 등록·START 를 하지 않는다', async () => {
    mockSnapshot = ARMED_SNAP;
    const t = makeDeps();
    overrideEngineDeps(t.deps);
    await setContext(t.deps, {
      tripId: 'trip-1',
      startDate: input.startDate,
      endDate: input.endDate,
      date: TODAY,
      consentOn: true,
      slots: input.slots,
      visits: [],
    });
    await setTripPaused(t.deps, 'trip-1', true);

    const { result } = renderHook(() => useLocationAutomation(input), {
      wrapper,
    });
    await waitFor(() => expect(result.current.reason).toBe('paused'));

    expect(result.current.paused).toBe(true);
    expect(t.nativeCalls).toEqual([]);
    expect(t.sink.calls).toEqual([]);
  });

  it('HP5 처리 중 연타는 잠긴다 — 끄기 직후 같은 틱의 켜기는 무시되고, 끝나면 다시 눌린다', async () => {
    const { t, result } = await mountArmed();

    await act(async () => {
      await Promise.all([
        result.current.setPaused(true),
        result.current.setPaused(false),
      ]);
    });

    expect(result.current.paused).toBe(true);
    expect(endsOf(t)).toHaveLength(2);
    expect(startsOf(t)).toHaveLength(2);

    await act(async () => {
      await result.current.setPaused(false);
    });
    expect(result.current.paused).toBe(false);
    expect(startsOf(t)).toHaveLength(4);
  });

  it('HP6 스위치 모양은 로컬 저장 직후 바뀐다 — END 응답(네트워크)을 기다리지 않는다', async () => {
    const { t, result } = await mountArmed();
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const send = t.sink.reportInterval.bind(t.sink);
    t.sink.reportInterval = async (tripId, report) => {
      await gate;
      return send(tripId, report);
    };
    const before = reportsOf(t).length;

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.setPaused(true);
    });
    await waitFor(() => expect(result.current.paused).toBe(true));
    expect(reportsOf(t).length).toBe(before); // END 는 아직 서버에 닿지 않았다

    await act(async () => {
      releaseGate?.();
      await pending;
    });
    expect(endsOf(t)).toHaveLength(2);
    expect(result.current).toMatchObject({ state: 'MANUAL', paused: true });
  });

  it('HP7 켜기도 마찬가지 — START 응답을 기다리지 않고 스위치가 켜짐으로 돌아온다', async () => {
    const { t, result } = await mountArmed();
    await act(async () => {
      await result.current.setPaused(true);
    });
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const send = t.sink.reportInterval.bind(t.sink);
    t.sink.reportInterval = async (tripId, report) => {
      await gate;
      return send(tripId, report);
    };
    const before = reportsOf(t).length;

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.setPaused(false);
    });
    await waitFor(() => expect(result.current.paused).toBe(false));
    expect(result.current.state).toBe('ARMED');
    expect(reportsOf(t).length).toBe(before);

    await act(async () => {
      releaseGate?.();
      await pending;
    });
    expect(startsOf(t)).toHaveLength(4);
    expect(result.current).toMatchObject({ state: 'ARMED', paused: false });
  });
});

/**
 * TRIP-1486 · l06 자동 기록 상태 행이 읽는 훅. l06 은 여행 화면이 아니라 여행 id 를 모르므로 "마지막 문맥"을 쓴다 —
 * 끝난 여행에 남은 옛 일시 중지 플래그가 지금도 「일시 중지」로 보이면 거짓이라, 문맥 여행의 기간 안일 때만 paused 다.
 * 오늘(KST)은 엔진과 같은 시계(`deps.now`)로 읽는다.
 */
describe('useAutomationStatus — l06 일시 중지 얼굴 (TRIP-1486)', () => {
  async function mountStatus(opts: {
    ctx?: { tripId?: string; startDate?: string; endDate?: string };
    pausedTrips: string[];
  }) {
    mockSnapshot = { ...WIU, background: 'granted' };
    const t = makeDeps();
    overrideEngineDeps(t.deps);
    await setContext(t.deps, {
      tripId: opts.ctx?.tripId ?? 'trip-1',
      startDate: opts.ctx?.startDate ?? '2026-08-19',
      endDate: opts.ctx?.endDate ?? '2026-08-22',
      date: TODAY,
      consentOn: true,
      slots: [],
      visits: [],
    });
    for (const id of opts.pausedTrips) await setTripPaused(t.deps, id, true);
    const hook = renderHook(() => useAutomationStatus(true));
    await waitFor(() => expect(hook.result.current.view).not.toBeNull());
    return hook;
  }

  it('SS1 문맥 여행이 기간 안이고 일시 중지면 paused · 사유 줄 · 행동 없음', async () => {
    const { result } = await mountStatus({ pausedTrips: ['trip-1'] });
    expect(result.current.view).toEqual({
      status: 'paused',
      reason: '이 여행은 일시 중지했어요',
      action: null,
    });
  });

  it('SS2 끝난 여행에 남은 옛 플래그는 일시 중지로 보이지 않는다(꺼짐 · 여행 날짜에만)', async () => {
    const { result } = await mountStatus({
      ctx: { startDate: '2026-08-01', endDate: '2026-08-10' },
      pausedTrips: ['trip-1'],
    });
    expect(result.current.view).toMatchObject({
      status: 'off',
      reason: '여행 날짜에만 켜져요',
    });
  });

  it('SS3 다른 여행만 일시 중지면 이 여행은 일시 중지가 아니다', async () => {
    const { result } = await mountStatus({ pausedTrips: ['trip-9'] });
    expect(result.current.view).toMatchObject({
      status: 'off',
      reason: '여행 날짜에만 켜져요',
    });
  });
});
