import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useSeoulToday } from './useSeoulToday';

/**
 * `useSeoulToday` — KST 오늘 'YYYY-MM-DD'. 마운트 시점에 굳지 않고 자정(KST)을 넘기면 바뀐다(TRIP-1364).
 * 렌더 중 `seoulDate(new Date())` 는 React Compiler 가 deps 없는 순수 식으로 보고 한 번만 계산해 영영 고정한다.
 */

// 2026-10-13 14:59:00Z = KST 23:59:00 (10-13)
const BEFORE_MIDNIGHT = Date.parse('2026-10-13T14:59:00Z');

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(BEFORE_MIDNIGHT);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useSeoulToday', () => {
  it('마운트 순간의 KST 날짜를 준다', () => {
    const { result } = renderHook(() => useSeoulToday());
    expect(result.current).toBe('2026-10-13');
  });

  it('자정(KST)을 넘기면 마운트 상태 그대로 다음 날로 바뀐다', () => {
    const { result } = renderHook(() => useSeoulToday());
    act(() => {
      jest.advanceTimersByTime(59_000);
    });
    expect(result.current).toBe('2026-10-13');
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe('2026-10-14');
  });

  it('그다음 자정도 이어서 잡는다', () => {
    const { result } = renderHook(() => useSeoulToday());
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe('2026-10-14');
    act(() => {
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(result.current).toBe('2026-10-15');
  });

  it('백그라운드에서 돌아오면(timer 가 멈춰 있던 동안 자정을 넘김) 바로 다시 계산한다', () => {
    let onChange: (state: string) => void = () => {};
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, handler) => {
        onChange = handler as (state: string) => void;
        return { remove: jest.fn() };
      });
    const { result } = renderHook(() => useSeoulToday());
    expect(result.current).toBe('2026-10-13');
    jest.setSystemTime(Date.parse('2026-10-14T01:00:00Z'));
    act(() => {
      onChange('active');
    });
    expect(result.current).toBe('2026-10-14');
    spy.mockRestore();
  });

  it('같은 날 안에서 시간이 흐르면 다시 그리지 않는다 (TRIP-1639 AC2)', () => {
    // 렌더 횟수를 센다 — 같은 날이면 상태가 같은 문자열이라 React 가 다시 그리지 않아야 한다.
    let renders = 0;
    jest.setSystemTime(Date.parse('2026-10-13T03:00:00Z')); // KST 12:00 — 자정까지 12시간
    const { result } = renderHook(() => {
      renders += 1;
      return useSeoulToday();
    });
    const afterMount = renders;
    act(() => {
      jest.advanceTimersByTime(11 * 60 * 60 * 1000); // KST 23:00 — 아직 같은 날
    });
    expect(result.current).toBe('2026-10-13');
    expect(renders).toBe(afterMount);
  });

  it('언마운트하면 타이머가 남지 않는다', () => {
    const { unmount } = renderHook(() => useSeoulToday());
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
