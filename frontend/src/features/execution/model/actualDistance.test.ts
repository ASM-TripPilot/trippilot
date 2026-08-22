import fc from 'fast-check';

import { accumulateDistanceKm, resolveActualRoute } from './actualDistance';

/**
 * TRIP-397 · 실제 경로 누적 거리 + 위치 동의 게이트.
 *
 * `accumulateDistanceKm` = GPS 점열을 이어 잰 누적 이동 거리(km). 걸음 수는 산출하지 않는다
 * (BR-U4-41). `resolveActualRoute` = 위치 동의가 없으면 실제 경로 레이어를 **항상 비활성**으로
 * 두고 사유를 동반하며 거리를 산출하지 않는다(BR-U4-42 · PBT-U4-F3).
 *
 * 3동작 뼈대: 준비=점열·동의 → 실행=함수 → 단언=거리·활성·사유.
 */

// 광안리(대략) 두 점 — 위경도 0.01도 차이는 약 1km 남짓.
const P1 = { lat: 35.153, lng: 129.118 };
const P2 = { lat: 35.163, lng: 129.118 };

const pointArb = fc.record({
  lat: fc.double({ min: -89, max: 89, noNaN: true }),
  lng: fc.double({ min: -179, max: 179, noNaN: true }),
});

describe('accumulateDistanceKm', () => {
  it('D1 점이 0·1개면 거리는 0이다', () => {
    expect(accumulateDistanceKm([])).toBe(0);
    expect(accumulateDistanceKm([P1])).toBe(0);
  });

  it('D2 두 점 사이 거리는 대략 1km(> 0)다', () => {
    const km = accumulateDistanceKm([P1, P2]);
    expect(km).toBeGreaterThan(0.5);
    expect(km).toBeLessThan(2);
  });

  it('D3 같은 점을 반복하면 누적 거리는 0이다', () => {
    expect(accumulateDistanceKm([P1, P1, P1])).toBeCloseTo(0, 5);
  });
});

describe('resolveActualRoute', () => {
  it('D4 위치 동의가 있으면 레이어 활성 + 사유 없음 + 누적 거리 산출', () => {
    const r = resolveActualRoute({ locationConsent: true, points: [P1, P2] });
    expect(r.enabled).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.distanceKm).toBeGreaterThan(0);
  });

  it('D5 위치 동의가 없으면 비활성 + 사유 동반 + 거리 0 (BR-U4-42)', () => {
    const r = resolveActualRoute({ locationConsent: false, points: [P1, P2] });
    expect(r.enabled).toBe(false);
    expect(r.reason).not.toBeNull();
    expect(r.distanceKm).toBe(0);
  });

  it('PBT-U4-F3 위치 동의 false인 임의 점열에서 레이어는 항상 비활성·거리 0·사유 동반', () => {
    // 리포 CI 차단 게이트. 100% 통과 못 하면 머지 불가.
    fc.assert(
      fc.property(fc.array(pointArb), (points) => {
        const r = resolveActualRoute({ locationConsent: false, points });
        expect(r.enabled).toBe(false);
        expect(r.distanceKm).toBe(0);
        expect(r.reason).not.toBeNull();
      })
    );
  });
});
