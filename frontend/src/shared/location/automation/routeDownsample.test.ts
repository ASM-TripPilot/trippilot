import fc from 'fast-check';

import { AUTOMATION_CONFIG } from './config';
import { decodePolyline, encodePolyline } from './polyline';
import {
  haversineM,
  pathLengthM,
  routeDistanceM,
  splitSegments,
  type RawSample,
} from './routeDistance';
import {
  downsampleRoute,
  pointToSegmentM,
  projector,
  runRoutePipeline,
} from './routeDownsample';

/**
 * TRIP-1336 · PBT-U10-F5 (BR-U10-34·36·37·38·40 · NFR P-PRIV-U10-1 ①~⑩).
 *
 * 3동작 뼈대: 준비=하루치 원시 표본(랜덤 워크 — 체류·튐·공백·점프 포함) → 실행=파이프라인 → 단언=성질.
 */

const cfg = AUTOMATION_CONFIG;
const MIN = 60_000;
const T0 = Date.UTC(2026, 7, 20, 0, 0, 0);
const M_PER_DEG_LAT = 110_540;

// 원점에서 (북 m, 동 m) 만큼 떨어진 점
function offset(northM: number, eastM: number) {
  const lat = 37.5 + northM / M_PER_DEG_LAT;
  const lng = 127 + eastM / (111_320 * Math.cos((37.5 * Math.PI) / 180));
  return { lat, lng };
}

/** 랜덤 워크 생성기 — 걷기·체류(제자리 튐)·공백(>10분)·점프(>1km)·나쁜 정확도를 섞는다. */
const arbDay: fc.Arbitrary<RawSample[]> = fc
  .array(
    fc.record({
      mode: fc.constantFrom('walk', 'walk', 'walk', 'stay', 'gap', 'jump'),
      heading: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
      stepM: fc.integer({ min: 5, max: 120 }),
      dtS: fc.integer({ min: 5, max: 240 }),
      acc: fc.integer({ min: 3, max: 180 }),
    }),
    { minLength: 0, maxLength: 160 }
  )
  .map((steps) => {
    let n = 0;
    let e = 0;
    let t = T0;
    const out: RawSample[] = [];
    for (const s of steps) {
      if (s.mode === 'gap') t += 11 * MIN;
      else t += s.dtS * 1000;
      if (s.mode === 'jump') {
        n += 1500 * Math.cos(s.heading);
        e += 1500 * Math.sin(s.heading);
      } else if (s.mode === 'stay') {
        n += 10 * Math.cos(s.heading); // 제자리 GPS 튐
        e += 10 * Math.sin(s.heading);
        t += 2 * MIN;
      } else {
        n += s.stepM * Math.cos(s.heading);
        e += s.stepM * Math.sin(s.heading);
      }
      out.push({ t, ...offset(n, e), acc: s.acc });
    }
    return out;
  });

/** 실제 이동에 가까운 생성기 — 방향이 이어지는 걷기(굽이 포함), 가끔 체류·공백. 배제 뒤에도 점이 남는다. */
const arbWalk: fc.Arbitrary<RawSample[]> = fc
  .array(
    fc.record({
      turn: fc.double({ min: -0.9, max: 0.9, noNaN: true }),
      stepM: fc.integer({ min: 15, max: 90 }),
      dtS: fc.integer({ min: 10, max: 60 }),
      acc: fc.integer({ min: 3, max: 120 }),
      event: fc.constantFrom(
        'none',
        'none',
        'none',
        'none',
        'none',
        'none',
        'stay',
        'gap'
      ),
    }),
    { minLength: 20, maxLength: 300 }
  )
  .map((steps) => {
    let n = 0;
    let e = 0;
    let h = 0;
    let t = T0;
    const out: RawSample[] = [];
    for (const s of steps) {
      h += s.turn;
      t +=
        s.dtS * 1000 +
        (s.event === 'gap' ? 11 * MIN : 0) +
        (s.event === 'stay' ? 5 * MIN : 0);
      n += s.stepM * Math.cos(h);
      e += s.stepM * Math.sin(h);
      out.push({ t, ...offset(n, e), acc: s.acc });
    }
    return out;
  });

const arbAny = fc.oneof(arbDay, arbWalk, arbWalk);

describe('routeDistance', () => {
  it('RD1 공백(10분 초과)·점프(1km 초과)에서 세그먼트를 끊고, 공백 직선 거리는 합산하지 않는다', () => {
    const a = [0, 100, 200].map((m, i) => ({
      t: T0 + i * MIN,
      ...offset(0, m),
      acc: 10,
    }));
    const b = [0, 100].map((m, i) => ({
      t: T0 + 20 * MIN + i * MIN, // 공백 17분
      ...offset(500, m),
      acc: 10,
    }));
    const segs = splitSegments([...a, ...b], cfg);
    expect(segs).toHaveLength(2);
    const d = routeDistanceM(segs);
    expect(d).toBeCloseTo(300, 0);
  });

  it('RD2 정확도 100m 초과 표본은 버린다', () => {
    const segs = splitSegments(
      [
        { t: T0, ...offset(0, 0), acc: 10 },
        { t: T0 + MIN, ...offset(0, 50), acc: 101 },
      ],
      cfg
    );
    expect(segs.flat()).toHaveLength(1);
  });

  it('RD3 걸음 수·속도 함수를 내보내지 않는다(INV-3)', () => {
    const mod = jest.requireActual('./routeDistance');
    expect(Object.keys(mod).join(' ')).not.toMatch(/step|speed|pace|duration/i);
  });
});

describe('polyline', () => {
  it('PL1 (PBT ⑩) 인코딩 왕복 오차 ≤ 0.5e-5°', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lat: fc.double({ min: 33, max: 39, noNaN: true }),
            lng: fc.double({ min: 124, max: 132, noNaN: true }),
          }),
          { maxLength: 50 }
        ),
        (pts) => {
          const back = decodePolyline(encodePolyline(pts));
          expect(back).toHaveLength(pts.length);
          back.forEach((p, i) => {
            expect(Math.abs(p.lat - pts[i].lat)).toBeLessThanOrEqual(
              0.5e-5 + 1e-9
            );
            expect(Math.abs(p.lng - pts[i].lng)).toBeLessThanOrEqual(
              0.5e-5 + 1e-9
            );
          });
        }
      ),
      { numRuns: 300 }
    );
  });

  it('PL2 디코더는 점 상한에서 멈춘다(SEC-U10-07)', () => {
    const enc = encodePolyline([offset(0, 0), offset(0, 10), offset(0, 20)]);
    expect(decodePolyline(enc, 2)).toHaveLength(2);
  });
});

describe('routeDownsample (PBT-U10-F5)', () => {
  it('F5 ①점 상한 · ⑦출력 ⊆ 원시 · 공백 경계 보존 · ⑥닻 R_priv 안 꼭짓점 0 · 거리 ≥ 출력 길이', () => {
    fc.assert(
      fc.property(arbAny, (samples) => {
        const p = runRoutePipeline(samples, cfg);
        const total = p.simplified.reduce((n, s) => n + s.length, 0);
        expect(total).toBeLessThanOrEqual(cfg.route.maxPoints); // ①
        expect(p.simplified.length).toBeLessThanOrEqual(cfg.route.maxSegments);

        // 원시 점 → 원시 세그먼트 번호
        const segOf = new Map<string, number>();
        p.rawSegments.forEach((seg, i) =>
          seg.forEach((s) => segOf.set(`${s.lat},${s.lng}`, i))
        );
        for (const seg of p.simplified) {
          expect(seg.length).toBeGreaterThanOrEqual(2);
          const ids = seg.map((v) => segOf.get(`${v.lat},${v.lng}`));
          ids.forEach((id) => expect(id).toBeDefined()); // ⑦
          expect(new Set(ids).size).toBe(1); // ⑧ 공백 앞뒤를 잇는 변 0
          for (const v of seg) {
            for (const a of p.anchors) {
              expect(haversineM(a, v)).toBeGreaterThan(
                cfg.route.privacyRadiusM
              ); // ⑥
            }
          }
        }
        expect(p.distanceM + 1e-6).toBeGreaterThanOrEqual(
          p.simplified.reduce((n, s) => n + pathLengthM(s), 0)
        );
      }),
      { numRuns: 300 }
    );
  });

  it('F5 ② 상한에 안 걸리면 배제 후 모든 점이 출력 폴리라인에서 ε 안', () => {
    fc.assert(
      fc.property(arbAny, (samples) => {
        const p = runRoutePipeline(samples, cfg);
        if (p.epsilonM !== cfg.route.toleranceM) return; // 상한에 걸린 경우는 성질 밖
        p.kept.forEach((kept, si) => {
          const out = p.simplified[si];
          const project = projector(kept[0]);
          const xy = out.map(project);
          for (const pt of kept) {
            const q = project(pt);
            let best = Infinity;
            for (let k = 1; k < xy.length; k += 1) {
              best = Math.min(best, pointToSegmentM(q, xy[k - 1], xy[k]));
            }
            expect(best).toBeLessThanOrEqual(cfg.route.toleranceM + 1e-6);
          }
        });
      }),
      { numRuns: 300 }
    );
  });

  it('F5 ⑤ 업로드 본문에 시간·속도·걸음 수 필드가 없다 · ⑨ 결정론', () => {
    fc.assert(
      fc.property(arbAny, (samples) => {
        const body = downsampleRoute(samples, cfg);
        expect(Object.keys(body).sort()).toEqual(
          ['distanceM', 'rawPointCount', 'segments', 'storedPointCount'].sort()
        );
        expect(downsampleRoute(samples, cfg)).toEqual(body);
        expect(body.distanceM).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(body.distanceM)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('DS1 체류 지점(숙소) 주변 R_priv 안 점은 출력에 없다', () => {
    // 숙소에서 20분 머문 뒤 동쪽으로 1km 걷기
    const stay = Array.from({ length: 10 }, (_, i) => ({
      t: T0 + i * 2 * MIN,
      ...offset((i % 2) * 8, 0),
      acc: 10,
    }));
    const walk = Array.from({ length: 20 }, (_, i) => ({
      t: T0 + 20 * MIN + i * 30_000,
      ...offset(0, (i + 1) * 50),
      acc: 10,
    }));
    const p = runRoutePipeline([...stay, ...walk], cfg);
    const home = offset(4, 0);
    for (const v of p.simplified.flat()) {
      expect(haversineM(home, v)).toBeGreaterThan(cfg.route.privacyRadiusM);
    }
  });

  it('DS2 20,000점 지그재그도 상한 안으로 줄이고 끝난다(회귀 감시)', () => {
    const samples: RawSample[] = Array.from({ length: 20_000 }, (_, i) => ({
      t: T0 + i * 5_000,
      ...offset((i % 2) * 40, i * 3),
      acc: 10,
    }));
    const started = Date.now();
    const body = downsampleRoute(samples, cfg);
    expect(body.storedPointCount).toBeLessThanOrEqual(cfg.route.maxPoints);
    expect(body.rawPointCount).toBe(20_000);
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
