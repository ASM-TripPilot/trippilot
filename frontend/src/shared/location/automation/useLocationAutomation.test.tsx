import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { seoulDate } from '@/shared/lib/seoulDate';

import { overrideEngineDeps } from './deps';
import type { EngineDeps } from './engine';
import type { NativeAdapters } from './native';
import type { PermissionSnapshot } from './permission';
import { createFakeAutomationSink } from './sink';
import { createAutomationStore, createMemoryFs } from './store';
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
});
