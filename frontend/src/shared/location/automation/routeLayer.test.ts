import fc from 'fast-check';

import { AUTOMATION_CONFIG } from './config';
import { encodePolyline } from './polyline';
import { routeDayForDate, routeDayToSegments } from './routeLayer';
import type { RouteDay } from './sink';

/**
 * TRIP-1342 · 서버 RouteDay(인코딩 세그먼트) → 지도 세그먼트. 공백 경계 보존(세그먼트 수 그대로)·점 상한 디코드.
 * 3동작 뼈대: 준비=RouteDay → 실행=디코드 → 단언=세그먼트 모양.
 */
const day = (segments: string[], date = '2026-08-20'): RouteDay => ({
  date,
  segments,
  distanceM: 3200,
  distanceClamped: false,
  updatedAt: '2026-08-21T00:00:00Z',
});

describe('routeLayer', () => {
  it('RL1 세그먼트 수를 그대로 둔다(공백을 잇지 않는다)', () => {
    const a = encodePolyline([
      { lat: 37.5, lng: 127 },
      { lat: 37.501, lng: 127.001 },
    ]);
    const b = encodePolyline([
      { lat: 37.51, lng: 127.01 },
      { lat: 37.511, lng: 127.011 },
    ]);
    const segs = routeDayToSegments(day([a, b]));
    expect(segs).toHaveLength(2);
    expect(segs[1][0]).toEqual({ lat: 37.51, lng: 127.01 });
  });

  it('RL2 점 2개 미만으로 디코드된 세그먼트는 버린다', () => {
    const one = encodePolyline([{ lat: 37.5, lng: 127 }]);
    expect(routeDayToSegments(day([one, '']))).toEqual([]);
  });

  it('RL3 (PBT) 하루 총 점은 상한을 넘지 않는다(SEC-U10-07)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 2, max: 900 }), { maxLength: 6 }),
        (sizes) => {
          const segs = sizes.map((n) =>
            encodePolyline(
              Array.from({ length: n }, (_, i) => ({
                lat: 37 + i * 1e-4,
                lng: 127,
              }))
            )
          );
          const out = routeDayToSegments(day(segs));
          const total = out.reduce((s, x) => s + x.length, 0);
          expect(total).toBeLessThanOrEqual(AUTOMATION_CONFIG.route.maxPoints);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('RL4 날짜로 고른다 — 없으면 null', () => {
    const list = [day([], '2026-08-19'), day([], '2026-08-20')];
    expect(routeDayForDate(list, '2026-08-20')?.date).toBe('2026-08-20');
    expect(routeDayForDate(list, '2026-08-21')).toBeNull();
  });
});
