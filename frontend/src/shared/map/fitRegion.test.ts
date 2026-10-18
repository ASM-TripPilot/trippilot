import fc from 'fast-check';

import { buildFitRegion, type FitBand } from './fitRegion';

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
  fc.array(pointArb, { minLength: 1, maxLength: 8 }),
  fc
    .tuple(pointArb, fc.integer({ min: 2, max: 5 }))
    .map(([point, n]) => Array.from({ length: n }, () => ({ ...point })))
);

describe('TRIP-1022 · buildFitRegion — 예시', () => {
  it('R1 점이 0개면 영역이 없다(null) — center 카메라 사다리가 맡는다', () => {
    expect(buildFitRegion([])).toBeNull();
  });

  it('R1b 점이 1개여도 최소 폭 영역이 나오고 그 점이 가운데다(TRIP-1363 — 2핀↔1핀 전환에서 region 이 null 로 떨어지지 않는다)', () => {
    const region = buildFitRegion([{ lat: 37.57, lng: 126.98 }]);

    expect(region).not.toBeNull();
    if (region === null) return;
    expect(region.latitudeDelta).toBeCloseTo(0.01, 10);
    expect(region.longitudeDelta).toBeCloseTo(0.01, 10);
    expect(region.latitude + region.latitudeDelta / 2).toBeCloseTo(37.57, 10);
    expect(region.longitude + region.longitudeDelta / 2).toBeCloseTo(
      126.98,
      10
    );
  });
});

describe('TRIP-1022 · buildFitRegion — 성질 (AC-B4 · PBT)', () => {
  it('R2 점이 1개 이상이면 모든 점이 영역 안에 있고 두 폭이 유한한 양수다', () => {
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

/* ──── TRIP-1416 · 보이는 띠 맞춤 (시트·칩 줄이 가리지 않은 부분에 핀을 담는다) ────
 * 지도+시트 화면은 지도가 화면 전체에 깔리고 시트가 아래를 덮는다. 핀 묶음 가운데를 상자 가운데에 두면
 * 아래쪽 핀이 시트 뒤로 숨는다(QA Q-070·079·088). 띠 인자(`FitBand`)를 주면 상자를 아래·위로 늘려
 * 핀을 보이는 띠 안에 넣는다.
 *
 * 무엇을 보장하나(01 AC-1·AC-2 — PBT 는 차단 게이트):
 *  - R5 모든 핀 위도가 띠 `[south + bottom·Δlat, south + (1−top)·Δlat]` 안이다.
 *  - R6 `aspect`(화면 세로/가로)를 주면 상자가 세로로 꽉 찬다 — 그래야 "상자 위쪽 x%" = "화면 위쪽 x%".
 *    bottom 범위가 0.5 를 넘어야(허브 0.55) 비율 누락이 여기서 걸린다(브리프 맹점 4).
 *  - R7 상자가 터무니없이 크지 않다(R3 상한을 띠 비율만큼 늘린 것).
 *  - R8 띠가 없거나 0 이면 **지금 결과 그대로**(셸 밖 카드 지도 무회귀) — 지금 본문 사본과 비교한다.
 * ⚠️ 실제 화면 맞춤(onLayout 재맞춤·SDK fitBounds)은 jest 사각 — 6-b(AC-11).
 *
 * 3동작 뼈대: 준비=임의 핀 + 임의 띠 → 실행=buildFitRegion(핀, 띠) → 단언=띠 안·세로 꽉 참·상한·같음.
 */

/** 지금(TRIP-1416 전) `buildFitRegion` 본문 사본 — "띠 없으면 지금과 같다"를 재는 기준(02a ★1). */
function legacyFitRegion(points: readonly { lat: number; lng: number }[]) {
  if (points.length < 1) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latitudeDelta = Math.max((maxLat - minLat) * 1.4, 0.01);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.4, 0.01);
  return {
    latitude: (minLat + maxLat) / 2 - latitudeDelta / 2,
    longitude: (minLng + maxLng) / 2 - longitudeDelta / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

// 식 순서가 바뀌면 마지막 자리(≈7e-15)가 달라질 수 있다 — 그만큼만 봐준다.
const SAME_EPS = 1e-12;

/** 위쪽 가림 0~0.19 · 아래쪽 가림 0~0.7(합 < 0.9) · 화면 세로/가로 1~2.5. */
const bandArb = fc.record({
  top: fc.double({ min: 0, max: 0.19, noNaN: true }),
  bottom: fc.double({ min: 0, max: 0.7, noNaN: true }),
  aspect: fc.double({ min: 1, max: 2.5, noNaN: true }),
});
/** 같은 범위인데 aspect 가 빠질 수도 있다(`requiredKeys` 밖 키는 생략될 수 있다). */
const bandMaybeAspectArb = fc.record(
  {
    top: fc.double({ min: 0, max: 0.19, noNaN: true }),
    bottom: fc.double({ min: 0, max: 0.7, noNaN: true }),
    aspect: fc.double({ min: 1, max: 2.5, noNaN: true }),
  },
  { requiredKeys: ['top', 'bottom'] }
);

/** 핀 묶음 가운데 위도의 cos — 가로세로 판정의 기준 모델(02a ★2). */
function cosOfPinMid(points: readonly { lat: number }[]): number {
  const lats = points.map((p) => p.lat);
  const mid = (Math.min(...lats) + Math.max(...lats)) / 2;
  return Math.cos((mid * Math.PI) / 180);
}

describe('buildFitRegion — 보이는 띠 (예시)', () => {
  // TRIP-1416
  it('R4 해운대·광안리 2핀을 아래 45%·위 5% 가 가린 화면에 맞추면 두 핀이 띠 안에 있고 상자가 세로로 꽉 찬다', () => {
    // 준비 — 동서로 긴 하루 동선(가로가 줌을 정하는 모양).
    const pins = [
      { lat: 35.1587, lng: 129.1604 },
      { lat: 35.1532, lng: 129.1186 },
    ];
    const band: FitBand = { top: 0.05, bottom: 0.45, aspect: 1334 / 750 };

    // 실행
    const region = buildFitRegion(pins, band);

    // 단언
    expect(region).not.toBeNull();
    if (region === null) return;
    pins.forEach(({ lat }) => {
      expect(lat).toBeGreaterThanOrEqual(
        region.latitude + 0.45 * region.latitudeDelta
      );
      expect(lat).toBeLessThanOrEqual(
        region.latitude + 0.95 * region.latitudeDelta
      );
    });
    expect(
      region.latitudeDelta / (region.longitudeDelta * cosOfPinMid(pins))
    ).toBeGreaterThanOrEqual(band.aspect ?? 0);
  });
});

describe('buildFitRegion — 보이는 띠 성질 (PBT)', () => {
  // TRIP-1416 · AC-1
  it('R5 띠를 주면 모든 핀 위도가 [south + bottom·Δlat, south + (1−top)·Δlat] 안이고 경도는 상자 안, 두 폭은 유한한 양수다', () => {
    fc.assert(
      fc.property(pointsArb, bandMaybeAspectArb, (points, band) => {
        const region = buildFitRegion(points, band);

        expect(region).not.toBeNull();
        if (region === null) return;
        expect(Number.isFinite(region.latitudeDelta)).toBe(true);
        expect(Number.isFinite(region.longitudeDelta)).toBe(true);
        expect(region.latitudeDelta).toBeGreaterThan(0);
        expect(region.longitudeDelta).toBeGreaterThan(0);

        const lowest = region.latitude + band.bottom * region.latitudeDelta;
        const highest = region.latitude + (1 - band.top) * region.latitudeDelta;
        points.forEach(({ lat, lng }) => {
          expect(lat).toBeGreaterThanOrEqual(lowest - EPS);
          expect(lat).toBeLessThanOrEqual(highest + EPS);
          expect(lng).toBeGreaterThanOrEqual(region.longitude - EPS);
          expect(lng).toBeLessThanOrEqual(
            region.longitude + region.longitudeDelta + EPS
          );
        });
      }),
      { numRuns: 300 }
    );
  });

  // TRIP-1416 · AC-1 ② · 브리프 맹점 4
  it('R6 aspect(화면 세로/가로)를 주면 상자가 세로로 꽉 찬다 — Δlat / (Δlng·cos(핀 가운데 위도)) ≥ aspect', () => {
    fc.assert(
      fc.property(pointsArb, bandArb, (points, band) => {
        const region = buildFitRegion(points, band);

        expect(region).not.toBeNull();
        if (region === null) return;
        const ratio =
          region.latitudeDelta / (region.longitudeDelta * cosOfPinMid(points));
        expect(ratio).toBeGreaterThanOrEqual(band.aspect * (1 - 1e-9));
      }),
      { numRuns: 300 }
    );
  });

  // TRIP-1416 · AC-1 ③ — "지구 전체" 가짜는 R5·R6 을 공짜로 통과한다
  it('R7 띠를 줘도 상자가 과하게 크지 않다 — Δlng ≤ 2·경도폭+0.1°, Δlat ≤ max((2·위도폭+0.1°)/(1−top−bottom), aspect·cos·Δlng)', () => {
    fc.assert(
      fc.property(pointsArb, bandMaybeAspectArb, (points, band) => {
        const region = buildFitRegion(points, band);

        expect(region).not.toBeNull();
        if (region === null) return;
        const lats = points.map((p) => p.lat);
        const lngs = points.map((p) => p.lng);
        const latSpan = Math.max(...lats) - Math.min(...lats);
        const lngSpan = Math.max(...lngs) - Math.min(...lngs);

        expect(region.longitudeDelta).toBeLessThanOrEqual(
          2 * lngSpan + SLACK_DEG
        );
        const bandBound =
          (2 * latSpan + SLACK_DEG) / (1 - band.top - band.bottom);
        const aspectBound =
          band.aspect === undefined
            ? 0
            : band.aspect * cosOfPinMid(points) * region.longitudeDelta;
        expect(region.latitudeDelta).toBeLessThanOrEqual(
          Math.max(bandBound, aspectBound) * (1 + 1e-9)
        );
      }),
      { numRuns: 300 }
    );
  });

  // TRIP-1416 · AC-2 · "f=0 이면 지금 결과와 같다"
  it('R8 띠를 안 주거나 {top:0, bottom:0}(aspect 없음)이면 지금 buildFitRegion 결과와 같다', () => {
    fc.assert(
      fc.property(pointsArb, (points) => {
        const expected = legacyFitRegion(points);
        expect(expected).not.toBeNull();
        if (expected === null) return;

        [buildFitRegion(points), buildFitRegion(points, { top: 0, bottom: 0 })]
          .map((region) => {
            expect(region).not.toBeNull();
            return region;
          })
          .forEach((region) => {
            if (region === null) return;
            expect(
              Math.abs(region.latitude - expected.latitude)
            ).toBeLessThanOrEqual(SAME_EPS);
            expect(
              Math.abs(region.longitude - expected.longitude)
            ).toBeLessThanOrEqual(SAME_EPS);
            expect(
              Math.abs(region.latitudeDelta - expected.latitudeDelta)
            ).toBeLessThanOrEqual(SAME_EPS);
            expect(
              Math.abs(region.longitudeDelta - expected.longitudeDelta)
            ).toBeLessThanOrEqual(SAME_EPS);
          });
      }),
      { numRuns: 300 }
    );
  });
});
