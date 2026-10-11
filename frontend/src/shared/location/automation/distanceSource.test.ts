import { distanceSourceByDate } from './distanceSource';
import type { RouteDay } from './sink';

/**
 * TRIP-1343 · BR-U10-39 — 거리 출처는 날짜 단위. 경로가 있는 날 ROUTE, 없는 날 VISIT_LINE.
 * 여행 요약 전체는 모든 날이 ROUTE 일 때만 ROUTE.
 */
const route = (date: string, segments = ['abc']): RouteDay => ({
  date,
  segments,
  distanceM: 1000,
  distanceClamped: false,
  updatedAt: '2026-08-21T00:00:00Z',
});

describe('distanceSourceByDate', () => {
  it('DS1 3일 중 2일만 경로 → 날짜별 ROUTE/VISIT_LINE, 전체 VISIT_LINE', () => {
    const out = distanceSourceByDate(
      ['2026-08-19', '2026-08-20', '2026-08-21'],
      [route('2026-08-19'), route('2026-08-21')]
    );
    expect(out.byDate).toEqual({
      '2026-08-19': 'ROUTE',
      '2026-08-20': 'VISIT_LINE',
      '2026-08-21': 'ROUTE',
    });
    expect(out.overall).toBe('VISIT_LINE');
  });

  it('DS2 모든 날 경로 → 전체 ROUTE · 세그먼트 0개 날은 경로 없음으로 본다', () => {
    expect(
      distanceSourceByDate(['a', 'b'], [route('a'), route('b')]).overall
    ).toBe('ROUTE');
    expect(distanceSourceByDate(['a'], [route('a', [])]).overall).toBe(
      'VISIT_LINE'
    );
  });

  it('DS3 날짜가 없으면 전체 VISIT_LINE(근사)', () => {
    expect(distanceSourceByDate([], []).overall).toBe('VISIT_LINE');
  });
});
