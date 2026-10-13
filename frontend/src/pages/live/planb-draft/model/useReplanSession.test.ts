import { renderHook } from '@testing-library/react-native';

import { useReplanSession } from './useReplanSession';

/**
 * TRIP-1363 — 재계획 세션 폴링이 공용 곡선(pollIntervalMs)을 탄다. 훅이 넘긴 refetchInterval 함수를
 * 직접 불러 간격·정지 조건을 본다(실제 타이머는 jest 사각 — 파일 머리 주석).
 */
const captured: { options?: { query?: { refetchInterval?: unknown } } } = {};
jest.mock('@/shared/api/index.hooks', () => ({
  useGetTripsTripIdReplanSessionsSessionId: (
    _t: string,
    _s: string,
    options: typeof captured.options
  ) => {
    captured.options = options;
    return {};
  },
}));

type Interval = (q: {
  state: { data?: { status: string }; dataUpdateCount: number };
}) => number | false;

function interval(): Interval {
  renderHook(() => useReplanSession('t', 's'));
  return captured.options!.query!.refetchInterval as Interval;
}

describe('TRIP-1363 · useReplanSession 폴링 간격', () => {
  it('R1 · SOLVING 은 처음 2초, 15회 뒤 5초', () => {
    const f = interval();
    expect(
      f({ state: { data: { status: 'SOLVING' }, dataUpdateCount: 3 } })
    ).toBe(2000);
    expect(
      f({ state: { data: { status: 'SOLVING' }, dataUpdateCount: 15 } })
    ).toBe(5000);
  });

  it('R2 · COLLECTING 도 같은 곡선이고, 종착 상태·미응답은 멈춘다', () => {
    const f = interval();
    expect(
      f({ state: { data: { status: 'COLLECTING' }, dataUpdateCount: 0 } })
    ).toBe(2000);
    for (const status of [
      'DRAFT',
      'APPLIED',
      'CANCELED',
      'FAILED',
      'NO_SOLUTION',
    ]) {
      expect(f({ state: { data: { status }, dataUpdateCount: 1 } })).toBe(
        false
      );
    }
    expect(f({ state: { dataUpdateCount: 0 } })).toBe(false);
  });
});
