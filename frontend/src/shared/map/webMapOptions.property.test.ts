import * as fc from 'fast-check';

import { buildFitRegion } from './fitRegion';
import { regionToCorners } from './webMapOptions';

/**
 * TRIP-1651 (W5) AC-6 — Region→모서리 변환의 성질(PBT, 차단 게이트).
 * 초심자용 — 예시 몇 개가 아니라 "임의의 입력에서 늘 성립해야 하는 규칙"을 무작위로 수천 번 확인한다.
 */

const latitude = fc.double({ min: -85, max: 85, noNaN: true });
const longitude = fc.double({ min: -180, max: 180, noNaN: true });
const delta = fc.double({ min: 0, max: 10, noNaN: true });

describe('regionToCorners 성질', () => {
  it('남서는 입력 그대로이고, 북동 − 남서 = 폭이며 북동은 남서보다 작지 않다', () => {
    fc.assert(
      fc.property(
        latitude,
        longitude,
        delta,
        delta,
        (lat, lng, latitudeDelta, longitudeDelta) => {
          const { sw, ne } = regionToCorners({
            latitude: lat,
            longitude: lng,
            latitudeDelta,
            longitudeDelta,
          });

          // toBeCloseTo: 무작위가 만든 -0 과 0 을 같게 본다(toEqual 은 구분한다).
          expect(sw.lat).toBeCloseTo(lat, 9);
          expect(sw.lng).toBeCloseTo(lng, 9);
          expect(ne.lat).toBeGreaterThanOrEqual(sw.lat);
          expect(ne.lng).toBeGreaterThanOrEqual(sw.lng);
          expect(Math.abs(ne.lat - sw.lat - latitudeDelta)).toBeLessThan(1e-9);
          expect(Math.abs(ne.lng - sw.lng - longitudeDelta)).toBeLessThan(1e-9);
        }
      )
    );
  });

  it('핀 맞춤 영역(밴드 포함)을 모서리로 바꾼 상자는 모든 핀을 품는다', () => {
    const pin = fc.record({
      lat: fc.double({ min: -80, max: 80, noNaN: true }),
      lng: fc.double({ min: -180, max: 180, noNaN: true }),
    });
    const band = fc.option(
      fc.record({
        top: fc.double({ min: 0, max: 0.4, noNaN: true }),
        bottom: fc.double({ min: 0, max: 0.4, noNaN: true }),
        aspect: fc.option(fc.double({ min: 0.5, max: 3, noNaN: true }), {
          nil: undefined,
        }),
      }),
      { nil: undefined }
    );

    fc.assert(
      fc.property(
        fc.array(pin, { minLength: 1, maxLength: 12 }),
        band,
        (pins, b) => {
          const region = buildFitRegion(pins, b);
          expect(region).not.toBeNull();
          const { sw, ne } = regionToCorners(region!);

          for (const p of pins) {
            expect(p.lat).toBeGreaterThanOrEqual(sw.lat);
            expect(p.lat).toBeLessThanOrEqual(ne.lat);
            expect(p.lng).toBeGreaterThanOrEqual(sw.lng);
            expect(p.lng).toBeLessThanOrEqual(ne.lng);
          }
        }
      )
    );
  });
});
