import fc from 'fast-check';

import { buildFitRegion } from './fitRegion';

/**
 * TRIP-1022 #040 — 핀 집합을 한 화면에 담는 영역(네이버 SDK `Region`) 계산.
 *
 * `Region` 은 남서 모서리(`latitude`·`longitude`) + 북동까지의 양수 폭(`latitudeDelta`·
 * `longitudeDelta`)이다(SDK `src/types/Region.ts`). SDK 는 이 영역이 **완전히 보이는** 좌표·최대
 * 줌으로 카메라를 옮긴다.
 *
 * 무엇을 보장하나(01 AC-B4 — PBT 는 차단 게이트):
 *  - 점이 2개 미만이면 영역이 없다(null) — 한 점은 기존 center 카메라가 맡는다(AC-B3).
 *  - 점 ≥2 이면 모든 점이 영역 안에 있고 두 폭은 0 보다 크다(한 점에 전부 겹친 퇴화 입력 포함).
 *  - 영역이 터무니없이 크지 않다(지구 전체를 주는 가짜는 "다 담긴다" 를 공짜로 통과한다).
 *
 * 3동작 뼈대: 준비=임의 핀 → 실행=buildFitRegion → 단언=담김·양수 폭·상한.
 */

// 부동소수 반올림(min + (max − min) 이 max 보다 1ulp 작을 수 있다)만 흡수한다 — 1e-9° 는 서브밀리미터.
const EPS = 1e-9;
// 상한 여유 — 패딩은 구현 재량이라 넉넉히: 폭의 2배 + 0.1°(≈11km, 퇴화 입력의 최소 폭 포함).
const SLACK_DEG = 0.1;

const pointArb = fc.record({
  lat: fc.double({ min: 33, max: 39, noNaN: true }),
  lng: fc.double({ min: 124, max: 132, noNaN: true }),
});

// 일반 입력 + 한 점이 n 번 겹친 퇴화 입력을 섞는다.
const pointsArb = fc.oneof(
  fc.array(pointArb, { minLength: 2, maxLength: 8 }),
  fc
    .tuple(pointArb, fc.integer({ min: 2, max: 5 }))
    .map(([point, n]) => Array.from({ length: n }, () => ({ ...point })))
);

describe('TRIP-1022 · buildFitRegion — 예시', () => {
  it('R1 점이 0개·1개면 영역이 없다(null)', () => {
    expect(buildFitRegion([])).toBeNull();
    expect(buildFitRegion([{ lat: 37.57, lng: 126.98 }])).toBeNull();
  });
});

describe('TRIP-1022 · buildFitRegion — 성질 (AC-B4 · PBT)', () => {
  it('R2 점이 2개 이상이면 모든 점이 영역 안에 있고 두 폭이 유한한 양수다', () => {
    fc.assert(
      fc.property(pointsArb, (points) => {
        const region = buildFitRegion(points);

        expect(region).not.toBeNull();
        if (region === null) return;

        expect(Number.isFinite(region.latitudeDelta)).toBe(true);
        expect(Number.isFinite(region.longitudeDelta)).toBe(true);
        expect(region.latitudeDelta).toBeGreaterThan(0);
        expect(region.longitudeDelta).toBeGreaterThan(0);

        points.forEach(({ lat, lng }) => {
          expect(lat).toBeGreaterThanOrEqual(region.latitude - EPS);
          expect(lat).toBeLessThanOrEqual(
            region.latitude + region.latitudeDelta + EPS
          );
          expect(lng).toBeGreaterThanOrEqual(region.longitude - EPS);
          expect(lng).toBeLessThanOrEqual(
            region.longitude + region.longitudeDelta + EPS
          );
        });
      }),
      { numRuns: 300 }
    );
  });

  it('R3 영역이 핀 폭에 비해 과하게 크지 않다(폭의 2배 + 0.1° 이하 — 지구 전체 가짜 차단)', () => {
    fc.assert(
      fc.property(pointsArb, (points) => {
        const region = buildFitRegion(points);

        expect(region).not.toBeNull();
        if (region === null) return;

        const lats = points.map((p) => p.lat);
        const lngs = points.map((p) => p.lng);
        const latSpan = Math.max(...lats) - Math.min(...lats);
        const lngSpan = Math.max(...lngs) - Math.min(...lngs);

        expect(region.latitudeDelta).toBeLessThanOrEqual(
          2 * latSpan + SLACK_DEG
        );
        expect(region.longitudeDelta).toBeLessThanOrEqual(
          2 * lngSpan + SLACK_DEG
        );
      }),
      { numRuns: 300 }
    );
  });
});
