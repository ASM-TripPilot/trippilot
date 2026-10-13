import { act, renderHook } from '@testing-library/react-native';

import { useDeadlineFlag } from './useDeadlineFlag';

/** `useDeadlineFlag` — 시각이 지나면 true, null 이면 안 잰다, 이미 지난 시각이면 바로 true, 정리하면 타이머가 남지 않는다. */

const NOW = Date.parse('2026-10-13T00:00:00Z');

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('useDeadlineFlag', () => {
  it('시각 직전엔 false, 시각이 되면 true', () => {
    const { result } = renderHook(() => useDeadlineFlag(NOW + 1000));
    expect(result.current).toBe(false);
    advance(999);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
  });

  it('null 이면 재지 않는다 — 타이머 0, 계속 false', () => {
    const { result } = renderHook(() => useDeadlineFlag(null));
    expect(jest.getTimerCount()).toBe(0);
    advance(10_000_000);
    expect(result.current).toBe(false);
  });

  it('이미 지난 시각이면 바로 true 이고 타이머를 남기지 않는다', () => {
    const { result } = renderHook(() => useDeadlineFlag(NOW - 1));
    expect(result.current).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('null 로 꺼지면 즉시 false 로 돌아가고, 언마운트하면 타이머가 지워진다', () => {
    const { result, rerender, unmount } = renderHook(
      ({ d }: { d: number | null }) => useDeadlineFlag(d),
      { initialProps: { d: NOW + 1000 } as { d: number | null } }
    );
    advance(1000);
    expect(result.current).toBe(true);
    rerender({ d: null });
    expect(result.current).toBe(false);
    rerender({ d: NOW + 5000 });
    expect(jest.getTimerCount()).toBe(1);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
