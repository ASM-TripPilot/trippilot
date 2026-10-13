import fc from 'fast-check';

import { resolveEditorMapCenter } from './editorMapCenter';

/**
 * TRIP-1022 #075 · 결정 1 — 빈 편집기 지도 중심을 고르는 순수 함수.
 *
 * 무엇을 보장하나(01 AC-A4~A7 · 01b Q1):
 *  ① 활성 날짜에 핀이 있으면 첫 핀
 *  ② 없으면 그 날짜를 덮는 거점(`dateFrom ≤ date < dateTo`, 체크아웃 날은 안 덮음)의 숙소 좌표
 *  ③ 덮는 거점이 없으면 좌표가 온전한 거점 중 `dateFrom` 이 가장 이른 숙소
 *  ④ 그것도 없으면 서울시청(기니만 (0,0) 아님)
 * "좌표가 온전하다" = lat·lng 둘 다 유한수(null·undefined·NaN 탈락). 숙소 목록에 없는 id 도 탈락.
 *
 * 3동작 뼈대: 준비=핀·거점·숙소·날짜 → 실행=resolveEditorMapCenter → 단언=고른 좌표.
 */

const SEOUL = { lat: 37.5665, lng: 126.978 };
const GANGNEUNG = { lat: 37.7519, lng: 128.8761 };
const SOKCHO = { lat: 38.207, lng: 128.5918 };

function stay(savedStayId: string, lat: number | null, lng: number | null) {
  return { savedStayId, lat, lng };
}

function base(savedStayId: string, dateFrom: string, dateTo: string) {
  return { savedStayId, dateFrom, dateTo };
}

describe('TRIP-1022 · resolveEditorMapCenter — 예시', () => {
  it('U1 (AC-A6) 핀이 있으면 거점이 있어도 첫 핀이 중심이다', () => {
    const center = resolveEditorMapCenter({
      pins: [
        { lat: 37.5796, lng: 126.977 },
        { lat: 37.5794, lng: 126.991 },
      ],
      date: '2026-10-20',
      bases: [base('s-gn', '2026-10-20', '2026-10-21')],
      stays: [stay('s-gn', GANGNEUNG.lat, GANGNEUNG.lng)],
    });

    expect(center).toEqual({ lat: 37.5796, lng: 126.977 });
  });

  it('U2 (AC-A4) 핀이 없고 그 날짜를 덮는 거점이 있으면 그 숙소 좌표다', () => {
    const center = resolveEditorMapCenter({
      pins: [],
      date: '2026-10-20',
      bases: [base('s-gn', '2026-10-20', '2026-10-21')],
      stays: [stay('s-gn', GANGNEUNG.lat, GANGNEUNG.lng)],
    });

    expect(center).toEqual(GANGNEUNG);
  });

  it('U3 (Q1②) 체크아웃 날(dateTo)은 덮이지 않지만, 가장 이른 거점 숙소를 비춘다', () => {
    // 1박 2일의 2일차 — 반열린 구간 [10-20, 10-21) 이라 10-21 은 어느 거점도 안 덮는다.
    const center = resolveEditorMapCenter({
      pins: [],
      date: '2026-10-21',
      bases: [base('s-gn', '2026-10-20', '2026-10-21')],
      stays: [stay('s-gn', GANGNEUNG.lat, GANGNEUNG.lng)],
    });

    expect(center).toEqual(GANGNEUNG);
  });

  it('U4 (Q1 ①>②) 날짜를 덮는 거점이 가장 이른 거점보다 우선한다', () => {
    // 준비 — 이른 거점(강릉 10-20~10-21)과 날짜를 덮는 거점(속초 10-21~10-23). 날짜는 10-22.
    const center = resolveEditorMapCenter({
      pins: [],
      date: '2026-10-22',
      bases: [
        base('s-gn', '2026-10-20', '2026-10-21'),
        base('s-sc', '2026-10-21', '2026-10-23'),
      ],
      stays: [
        stay('s-gn', GANGNEUNG.lat, GANGNEUNG.lng),
        stay('s-sc', SOKCHO.lat, SOKCHO.lng),
      ],
    });

    // 단언 — 가장 이른 강릉이 아니라 그날을 덮는 속초다.
    expect(center).toEqual(SOKCHO);
  });

  it('U5 (Q1 좌표 온전) 날짜를 덮는 거점의 숙소 좌표가 비었으면 좌표가 온전한 다른 거점으로 간다', () => {
    const center = resolveEditorMapCenter({
      pins: [],
      date: '2026-10-22',
      bases: [
        base('s-sc', '2026-10-21', '2026-10-23'),
        base('s-gn', '2026-10-23', '2026-10-24'),
      ],
      stays: [
        stay('s-sc', null, SOKCHO.lng),
        stay('s-gn', GANGNEUNG.lat, GANGNEUNG.lng),
      ],
    });

    expect(center).toEqual(GANGNEUNG);
  });

  it.each([
    ['거점 조회 전(undefined)', undefined, [stay('s-gn', 37.75, 128.87)]],
    ['거점 0개', [], [stay('s-gn', 37.75, 128.87)]],
    [
      '숙소 목록에 없는 id',
      [base('s-missing', '2026-10-20', '2026-10-21')],
      [stay('s-gn', 37.75, 128.87)],
    ],
    [
      '반쪽 좌표(lng null)',
      [base('s-gn', '2026-10-20', '2026-10-21')],
      [stay('s-gn', 37.75, null)],
    ],
    [
      'NaN 좌표',
      [base('s-gn', '2026-10-20', '2026-10-21')],
      [stay('s-gn', Number.NaN, 128.87)],
    ],
    [
      '숙소 조회 전(undefined)',
      [base('s-gn', '2026-10-20', '2026-10-21')],
      undefined,
    ],
  ])('U6 (AC-A5) %s 이면 서울시청이다', (_label, bases, stays) => {
    const center = resolveEditorMapCenter({
      pins: [],
      date: '2026-10-20',
      bases,
      stays,
    });

    expect(center).toEqual(SEOUL);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * PBT (AC-A7) — 임의 입력에서 사다리 ①~④ 를 독립 오라클로 다시 계산해 대조한다.
 * ──────────────────────────────────────────────────────────────────────────── */

const DAY0 = Date.UTC(2026, 9, 18);
const DAY_MS = 24 * 60 * 60 * 1000;

/** 날짜 오프셋(일) → 'YYYY-MM-DD'. */
function isoDay(offset: number): string {
  return new Date(DAY0 + offset * DAY_MS).toISOString().slice(0, 10);
}

const STAY_IDS = ['s0', 's1', 's2', 's3'] as const;

// 한국 범위 좌표 — (0,0)·음수가 입력에 없으므로 결과가 (0,0) 이면 함수가 지어낸 값이다.
const latArb = fc.double({ min: 33, max: 39, noNaN: true });
const lngArb = fc.double({ min: 124, max: 132, noNaN: true });
const maybeCoordArb = (arb: fc.Arbitrary<number>) =>
  fc.oneof(
    { weight: 4, arbitrary: arb },
    { weight: 1, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: fc.constant(undefined) },
    { weight: 1, arbitrary: fc.constant(Number.NaN) }
  );

const stayArb = fc.record({
  savedStayId: fc.constantFrom(...STAY_IDS),
  lat: maybeCoordArb(latArb),
  lng: maybeCoordArb(lngArb),
});

const baseArb = fc
  .record({
    // 's9' 는 숙소 목록에 절대 없는 id — 목록에 없는 거점도 섞는다.
    savedStayId: fc.constantFrom(...STAY_IDS, 's9'),
    from: fc.integer({ min: 0, max: 8 }),
    nights: fc.integer({ min: 1, max: 3 }),
  })
  .map(({ savedStayId, from, nights }) => ({
    savedStayId,
    dateFrom: isoDay(from),
    dateTo: isoDay(from + nights),
  }));

const pinArb = fc.record({ lat: latArb, lng: lngArb });

const inputArb = fc.record({
  pins: fc.array(pinArb, { maxLength: 3 }),
  date: fc.integer({ min: 0, max: 12 }).map(isoDay),
  bases: fc.option(fc.array(baseArb, { maxLength: 4 }), { nil: undefined }),
  stays: fc.option(
    // 같은 id 가 두 번 나오면 "어느 숙소인가" 가 모호해진다 — id 로 유일화한다.
    fc.uniqueArray(stayArb, { selector: (s) => s.savedStayId, maxLength: 4 }),
    { nil: undefined }
  ),
});

type Coord = { lat: number; lng: number };
type Input = typeof inputArb extends fc.Arbitrary<infer T> ? T : never;

function validCoordOf(
  savedStayId: string,
  stays: ReadonlyArray<{
    savedStayId: string;
    lat?: number | null;
    lng?: number | null;
  }> = []
): Coord | null {
  const found = stays.find((s) => s.savedStayId === savedStayId);
  if (found === undefined) return null;
  const { lat, lng } = found;
  return typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

/** 사다리 오라클 — 답이 될 수 있는 좌표 **집합**(동률이면 여럿)을 돌려준다. */
function allowedCenters(input: Input): Coord[] {
  if (input.pins.length > 0) return [input.pins[0]];

  const valid = (input.bases ?? [])
    .map((b) => ({ b, coord: validCoordOf(b.savedStayId, input.stays) }))
    .filter(
      (entry): entry is { b: (typeof entry)['b']; coord: Coord } =>
        entry.coord !== null
    );

  const covering = valid.filter(
    ({ b }) => b.dateFrom <= input.date && input.date < b.dateTo
  );
  if (covering.length > 0) return covering.map(({ coord }) => coord);

  if (valid.length > 0) {
    const earliest = valid.reduce(
      (min, { b }) => (b.dateFrom < min ? b.dateFrom : min),
      valid[0].b.dateFrom
    );
    return valid
      .filter(({ b }) => b.dateFrom === earliest)
      .map(({ coord }) => coord);
  }

  return [SEOUL];
}

describe('TRIP-1022 · resolveEditorMapCenter — 성질 (AC-A7 · PBT)', () => {
  it('P1 결과는 언제나 유한한 좌표이고 (0,0) 이 아니며, 첫 핀·거점 숙소·서울시청 중 하나다', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const center = resolveEditorMapCenter(input);

        expect(Number.isFinite(center.lat)).toBe(true);
        expect(Number.isFinite(center.lng)).toBe(true);
        expect(center.lat === 0 && center.lng === 0).toBe(false);

        const universe: Coord[] = [
          ...input.pins.slice(0, 1),
          ...(input.bases ?? [])
            .map((b) => validCoordOf(b.savedStayId, input.stays))
            .filter((c): c is Coord => c !== null),
          SEOUL,
        ];
        expect(
          universe.some((c) => c.lat === center.lat && c.lng === center.lng)
        ).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('P2 결과는 사다리(첫 핀 → 날짜를 덮는 거점 → 가장 이른 거점 → 서울시청)가 고른 후보 안에 있다', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const center = resolveEditorMapCenter(input);
        const allowed = allowedCenters(input);

        expect(
          allowed.some((c) => c.lat === center.lat && c.lng === center.lng)
        ).toBe(true);
      }),
      { numRuns: 300 }
    );
  });
});
