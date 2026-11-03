/**
 * @jest-environment node
 */

/**
 * TRIP-1717 · 콜드스타트 측정 스크립트(`scripts/startup-bench.cjs`)의 순수 함수 계약.
 *
 * 무엇을 보장하나: 앱이 파일에 남긴 원자료(점마다 perfNow·epoch)와 호스트가 잰 실행 시각에서
 *  - 6구간을 한 가지 방법으로 계산한다(S1 = 호스트 시계 차 · S2~S6 = 앱 perfNow 차이만),
 *  - 못 믿을 회를 0 으로 조용히 접지 않고 incomplete(점 누락·음수·NaN) / invalid(HOME 아님·잠정 분기)로 가른다,
 *  - 백분위는 최근접 순위, 집계는 첫 회(예열)를 빼고, dev/release 가 섞이면 거부하며 ok 0 회면 던진다.
 * 실제 simctl 실행·파일 회수·표 문구는 jest 대상이 아니다(02 — 6-b 측정).
 *
 * 테스트가 `.ts` 인 이유: jest testMatch 가 `.cjs` 를 줍지 않아서다(bundleReport.test.ts 와 같다). 스크립트는 `jest.requireActual` 로 읽는다.
 * 3동작 뼈대: 준비=입력 픽스처 → 실행=함수 호출 → 단언=반환값.
 */
import fc from 'fast-check';

type SegmentName = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
type Segments = Record<SegmentName, number>;
type Mark = {
  perfNow: number;
  epoch: number;
  detail?: Record<string, unknown>;
};
type StartupRecord = {
  buildKind: 'dev' | 'release';
  marks: Record<string, Mark>;
  rnStartupTiming: null;
};
type Verdict =
  | { status: 'ok'; segments: Segments }
  | { status: 'incomplete' | 'invalid'; reason: string };
type Run = { launchEpoch: number; record: StartupRecord | null };
type Stat = { p50: number; p90: number; min: number; max: number };
type Summary = {
  buildKind: 'dev' | 'release';
  counts: {
    warmupExcluded: number;
    ok: number;
    incomplete: number;
    invalid: number;
  };
  segments: Record<SegmentName, Stat>;
  extras: { homeTrips?: Stat };
};
type Lib = {
  segmentsOf: (record: StartupRecord | null, launchEpoch: number) => Verdict;
  percentile: (values: number[], p: number) => number;
  summarize: (runs: Run[]) => Summary;
};

const lib = jest.requireActual<Lib>('./startup-bench.cjs');

const SEGMENT_NAMES: SegmentName[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
// 점 이름 순서(P1~P6). 구간 Sn(n>=2)은 앞 점 → 이 점의 perfNow 차이다.
const POINTS = [
  'jsEntry',
  'rootLayout',
  'rootMounted',
  'bootstrapResolved',
  'splashReleased',
  'firstFrame',
] as const;
const LAUNCH = 1_700_000_000_000;
const BASE: Segments = { S1: 400, S2: 100, S3: 30, S4: 300, S5: 900, S6: 20 };

type BuildOptions = {
  launchEpoch?: number;
  destination?: string;
  isProvisional?: boolean;
  buildKind?: 'dev' | 'release';
};

/**
 * 구간 값에서 앱이 남겼을 법한 record 를 거꾸로 만든다. perfNow 는 1000 에서 누적하고,
 * jsEntry.epoch 만 호스트 시계(launchEpoch + S1) — 나머지 마크의 epoch 는 일부러 무관한 값(5)이라
 * S2~S6 이 epoch 를 쓰면 틀린 값이 나온다. floorElapsed 는 구간이 아닌 보조 점이다.
 */
function build(
  segments: Partial<Segments> = {},
  {
    launchEpoch = LAUNCH,
    destination = 'HOME',
    isProvisional = false,
    buildKind = 'release',
  }: BuildOptions = {}
): StartupRecord {
  const s = { ...BASE, ...segments };
  const marks: Record<string, Mark> = {
    jsEntry: { perfNow: 1000, epoch: launchEpoch + s.S1 },
  };
  let perfNow = 1000;
  POINTS.slice(1).forEach((name, i) => {
    perfNow += s[`S${i + 2}` as SegmentName];
    marks[name] = { perfNow, epoch: 5 };
  });
  marks.bootstrapResolved.detail = { destination, isProvisional };
  marks.floorElapsed = { perfNow: 1500, epoch: 5 };
  return { buildKind, marks, rnStartupTiming: null };
}

const run = (record: StartupRecord | null): Run => ({
  launchEpoch: LAUNCH,
  record,
});

describe('segmentsOf — 6구간 계산', () => {
  it('S1 은 호스트 시계 차(jsEntry.epoch − launchEpoch), S2~S6 은 앱 perfNow 차이만이고 키는 여섯뿐이다', () => {
    // 준비 — build 가 S2~S6 의 epoch 를 무관한 값으로 둔다. floorElapsed 마크도 들어 있다.
    const record = build();

    // 실행
    const verdict = lib.segmentsOf(record, LAUNCH);

    // 단언
    expect(verdict).toEqual({ status: 'ok', segments: BASE });
  });

  it('구간이 정확히 0 이면 정상(ok)이다 — 음수만 못 믿는다', () => {
    expect(lib.segmentsOf(build({ S6: 0 }), LAUNCH)).toEqual({
      status: 'ok',
      segments: { ...BASE, S6: 0 },
    });
  });

  it.each(POINTS)(
    '점 %s 가 빠지면 0 으로 접지 않고 incomplete 다(segments 없음)',
    (name) => {
      const record = build();
      delete record.marks[name];

      const verdict = lib.segmentsOf(record, LAUNCH);

      expect(verdict.status).toBe('incomplete');
      expect(verdict).not.toHaveProperty('segments');
      expect(typeof (verdict as { reason: string }).reason).toBe('string');
    }
  );

  it('앱 기록이 없으면(파일 없음·타임아웃) incomplete 다', () => {
    const verdict = lib.segmentsOf(null, LAUNCH);

    expect(verdict.status).toBe('incomplete');
    expect(verdict).not.toHaveProperty('segments');
  });

  it.each(SEGMENT_NAMES)(
    '구간 %s 가 음수면 incomplete 다(effect 순서 함정이 조용한 음수로 섞이지 않는다)',
    (name) => {
      const verdict = lib.segmentsOf(build({ [name]: -1 }), LAUNCH);

      expect(verdict.status).toBe('incomplete');
      expect(verdict).not.toHaveProperty('segments');
    }
  );

  it('호스트 실행 시각이 NaN 이면 NaN 구간을 내지 않고 incomplete 다', () => {
    const verdict = lib.segmentsOf(build(), Number.NaN);

    expect(verdict.status).toBe('incomplete');
    expect(verdict).not.toHaveProperty('segments');
  });

  it.each([
    ['목적지가 LOGIN', { destination: 'LOGIN' }],
    ['3초 타임아웃 잠정 분기(isProvisional)', { isProvisional: true }],
  ])('%s 이면 invalid 다(HOME 첫 화면 측정이 아니다)', (_label, options) => {
    const verdict = lib.segmentsOf(build({}, options), LAUNCH);

    expect(verdict.status).toBe('invalid');
    expect(verdict).not.toHaveProperty('segments');
    expect(typeof (verdict as { reason: string }).reason).toBe('string');
  });

  it('bootstrapResolved 에 detail 이 없으면 HOME 임을 못 믿어 invalid 다', () => {
    const record = build();
    delete record.marks.bootstrapResolved.detail;

    expect(lib.segmentsOf(record, LAUNCH).status).toBe('invalid');
  });
});

describe('percentile — 최근접 순위', () => {
  const ONE_TO_TEN = [7, 3, 10, 1, 9, 2, 8, 4, 6, 5]; // 일부러 섞인 순서

  it('n=10 에서 p50 은 5번째, p90 은 9번째 값이다', () => {
    expect(lib.percentile(ONE_TO_TEN, 0.5)).toBe(5);
    expect(lib.percentile(ONE_TO_TEN, 0.9)).toBe(9);
  });

  it('n=11 에서 p90 은 10번째, n=1 은 그 값 자신이다', () => {
    expect(lib.percentile([...ONE_TO_TEN, 11], 0.9)).toBe(10);
    expect(lib.percentile([42], 0.5)).toBe(42);
    expect(lib.percentile([42], 0.9)).toBe(42);
  });

  it('입력 배열을 정렬하거나 바꾸지 않는다', () => {
    const input = [...ONE_TO_TEN];

    lib.percentile(input, 0.9);

    expect(input).toEqual(ONE_TO_TEN);
  });

  it('빈 입력은 0 이 아니라 던진다', () => {
    expect(() => lib.percentile([], 0.5)).toThrow();
  });

  const numbers = fc.array(
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    {
      minLength: 1,
      maxLength: 50,
    }
  );

  it('PBT: 결과는 입력 안의 값이고 min ≤ p50 ≤ p90 ≤ max 다', () => {
    fc.assert(
      fc.property(numbers, (values) => {
        const p50 = lib.percentile(values, 0.5);
        const p90 = lib.percentile(values, 0.9);
        expect(values).toContain(p50);
        expect(values).toContain(p90);
        expect(Math.min(...values)).toBeLessThanOrEqual(p50);
        expect(p50).toBeLessThanOrEqual(p90);
        expect(p90).toBeLessThanOrEqual(Math.max(...values));
      })
    );
  });

  it('PBT: 입력 순서를 섞어도 결과가 같다', () => {
    const shuffled = numbers.chain((values) =>
      fc
        .shuffledSubarray(values, {
          minLength: values.length,
          maxLength: values.length,
        })
        .map((order) => [values, order] as const)
    );
    fc.assert(
      fc.property(shuffled, fc.constantFrom(0.5, 0.9), ([values, order], p) => {
        expect(lib.percentile(order, p)).toBe(lib.percentile(values, p));
      })
    );
  });

  it('PBT: [1..n] 에서 p90 = ⌊(9n+9)/10⌋, p50 = ⌊(n+1)/2⌋ — 정수 연산 오라클(순위가 한 칸 어긋나는지)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), (n) => {
        const values = Array.from({ length: n }, (_, i) => i + 1);
        expect(lib.percentile(values, 0.9)).toBe(Math.floor((9 * n + 9) / 10));
        expect(lib.percentile(values, 0.5)).toBe(Math.floor((n + 1) / 2));
      })
    );
  });
});

describe('summarize — 집계', () => {
  /** S4 만 i*100 으로 달리하는 정상 회 n 개(i=1..n). 나머지 구간은 BASE 상수. */
  const okRuns = (n: number): Run[] =>
    Array.from({ length: n }, (_, i) => run(build({ S4: (i + 1) * 100 })));
  const warmup = (): Run => run(build({ S4: 99_999, S1: 99_999 })); // 극단값 — 집계에 새면 드러난다

  it('첫 회는 예열이라 빠지고, 나머지 10회의 구간별 p50·p90·min·max 를 낸다', () => {
    // 준비 — 11회(예열 1 + 정상 10)
    const runs = [warmup(), ...okRuns(10)];

    // 실행
    const summary = lib.summarize(runs);

    // 단언
    expect(summary.buildKind).toBe('release');
    expect(summary.counts).toEqual({
      warmupExcluded: 1,
      ok: 10,
      incomplete: 0,
      invalid: 0,
    });
    expect(summary.segments.S4).toEqual({
      p50: 500,
      p90: 900,
      min: 100,
      max: 1000,
    });
    expect(summary.segments.S1).toEqual({
      p50: 400,
      p90: 400,
      min: 400,
      max: 400,
    });
    expect(Object.keys(summary.segments)).toEqual(SEGMENT_NAMES);
  });

  it('예열 회가 못 믿을 회(null)여도 incomplete 로 세지 않고 예열로만 뺀다', () => {
    const summary = lib.summarize([run(null), ...okRuns(10)]);

    expect(summary.counts).toEqual({
      warmupExcluded: 1,
      ok: 10,
      incomplete: 0,
      invalid: 0,
    });
  });

  it('incomplete·invalid 회는 백분위에서 빠지고 각각 센다', () => {
    // 준비 — 예열 + 정상 8 + 기록 없음 1 + LOGIN 1
    const runs = [
      warmup(),
      ...okRuns(8),
      run(null),
      run(build({ S4: 55_555 }, { destination: 'LOGIN' })),
    ];

    const summary = lib.summarize(runs);

    expect(summary.counts).toEqual({
      warmupExcluded: 1,
      ok: 8,
      incomplete: 1,
      invalid: 1,
    });
    // 정상 8회 S4 = 100..800 → p50 은 4번째, p90 은 8번째
    expect(summary.segments.S4).toEqual({
      p50: 400,
      p90: 800,
      min: 100,
      max: 800,
    });
  });

  it('run 마다 launchEpoch 가 달라도 각자의 값으로 S1 을 센다', () => {
    const runs: Run[] = [
      warmup(),
      { launchEpoch: 1000, record: build({ S1: 10 }, { launchEpoch: 1000 }) },
      { launchEpoch: 9000, record: build({ S1: 30 }, { launchEpoch: 9000 }) },
    ];

    const summary = lib.summarize(runs);

    expect(summary.segments.S1).toEqual({ p50: 10, p90: 30, min: 10, max: 30 });
  });

  it('dev 기록만 있으면 buildKind 를 dev 로 라벨한다(섞이지만 않으면 거부하지 않는다)', () => {
    const runs = [warmup(), ...okRuns(3)].map((r) => ({
      ...r,
      record: r.record && { ...r.record, buildKind: 'dev' as const },
    }));

    expect(lib.summarize(runs).buildKind).toBe('dev');
  });

  it.each([
    ['예열 자리', 0],
    ['중간 자리', 4],
  ])(
    'buildKind 가 섞이면(%s 가 dev) 던진다 — 한 표에 dev/release 를 못 섞는다',
    (_label, at) => {
      const runs = [warmup(), ...okRuns(10)];
      runs[at] = run(build({}, { buildKind: 'dev' }));

      expect(() => lib.summarize(runs)).toThrow(/buildKind/);
    }
  );

  it.each([
    ['빈 배열', () => []],
    ['예열 1회뿐', () => [warmup()]],
    ['전부 기록 없음', () => [warmup(), run(null), run(null)]],
    [
      '전부 invalid',
      () => [warmup(), run(build({}, { destination: 'LOGIN' }))],
    ],
  ])('집계할 ok 회가 0 이면(%s) 빈 표 대신 던진다', (_label, makeRuns) => {
    expect(() => lib.summarize(makeRuns())).toThrow();
  });

  it('PBT: 임의 표본에서 min ≤ p50 ≤ p90 ≤ max 이고, 예열 뒤 회차 순서를 섞어도 요약이 같다', () => {
    const sample = fc
      .array(fc.integer({ min: 0, max: 100_000 }), {
        minLength: 1,
        maxLength: 30,
      })
      .chain((s4s) =>
        fc
          .shuffledSubarray(s4s, {
            minLength: s4s.length,
            maxLength: s4s.length,
          })
          .map((order) => [s4s, order] as const)
      );
    fc.assert(
      fc.property(sample, ([s4s, order]) => {
        const toRuns = (values: number[]): Run[] => [
          warmup(),
          ...values.map((s4) => run(build({ S4: s4 }))),
        ];

        const summary = lib.summarize(toRuns(s4s));

        const { p50, p90, min, max } = summary.segments.S4;
        expect(min).toBeLessThanOrEqual(p50);
        expect(p50).toBeLessThanOrEqual(p90);
        expect(p90).toBeLessThanOrEqual(max);
        expect(lib.summarize(toRuns(order))).toEqual(summary);
      })
    );
  });
});

describe('summarize — 보조 지표 homeTrips (TRIP-1719)', () => {
  /** 정상 회 n 개 — 홈 여행 데이터 점을 부트스트랩 확정 뒤 i*10 ms 에 둔다(i=1..n). */
  const withHomeTrips = (n: number): Run[] =>
    Array.from({ length: n }, (_, i) => {
      const r = build();
      r.marks.homeTrips = {
        perfNow: r.marks.bootstrapResolved.perfNow + (i + 1) * 10,
        epoch: 5,
      };
      return run(r);
    });

  it('유효 회 전부에 homeTrips 가 있으면 "부트스트랩 확정 → 홈 여행 데이터" 분포를 낸다', () => {
    // 준비 — 예열 1(극단값) + 정상 10
    const warm = withHomeTrips(1)[0];
    warm.record!.marks.homeTrips.perfNow += 99_999;
    const runs = [warm, ...withHomeTrips(10)];

    // 실행
    const summary = lib.summarize(runs);

    // 단언 — 10..100 → p50 5번째(50) · p90 9번째(90), 예열은 안 섞인다
    expect(summary.extras.homeTrips).toEqual({
      p50: 50,
      p90: 90,
      min: 10,
      max: 100,
    });
  });

  it('유효 회 중 하나라도 homeTrips 가 없으면 보조 지표를 내지 않는다(일부만 모인 숫자 금지)', () => {
    // 준비 — 정상 10 중 마지막 회만 점이 없다
    const runs = [run(build()), ...withHomeTrips(9), run(build())];

    // 실행
    const summary = lib.summarize(runs);

    // 단언 — 6구간은 그대로 나오고(앵커) 보조 지표만 없다
    expect(summary.counts.ok).toBe(10);
    expect(summary.extras.homeTrips).toBeUndefined();
  });
});
