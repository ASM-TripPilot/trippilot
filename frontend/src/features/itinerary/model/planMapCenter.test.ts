import fc from 'fast-check';

import { resolvePlanMapCenter } from './planMapCenter';

/**
 * TRIP-1275 — h14·h16 일정 지도 중심을 고르는 순수 함수(01b Q1~Q4).
 *
 * 무엇을 보장하나 — 사다리 첫 칸이 이긴다:
 *  ① 선택한 날의 첫 좌표 장소(지금의 `pins[0]` 과 같다 — 무회귀)
 *  ② 없으면 다른 날 중 날짜 순으로 처음 나오는 좌표 장소
 *  ③ 그것도 없으면 거점 숙소 좌표(조회 대기·실패 = `undefined` = 건너뜀)
 *  ④ 아무 재료도 없으면 서울시청 — {0,0}(기니만 바다)은 어떤 입력에도 안 나온다
 * "좌표 있음" = lat·lng 둘 다 number(`buildDraftPins` 와 같은 판정).
 *
 * 3동작 뼈대: 준비=일정 날들·선택 날짜·거점·숙소 → 실행=resolvePlanMapCenter → 단언=고른 좌표.
 */

const SEOUL = { lat: 37.5665, lng: 126.978 };
const A = { lat: 35.1587, lng: 129.1604 };
const B = { lat: 35.1532, lng: 129.1187 };
const C = { lat: 35.8347, lng: 129.219 };
const S = { lat: 35.16, lng: 129.16 };

const D1 = '2026-06-10';
const D2 = '2026-06-11';
const D3 = '2026-06-12';

type Slot = { lat?: number | null; lng?: number | null };

function day(date: string, slots: Slot[]) {
  return { date, slots };
}

function base(savedStayId: string) {
  return { savedStayId, dateFrom: D1, dateTo: D3 };
}

function stay(savedStayId: string, lat: number | null, lng: number | null) {
  return { savedStayId, lat, lng };
}

const NO_COORD: Slot = { lat: null, lng: null };

describe('TRIP-1275 · resolvePlanMapCenter — 예시', () => {
  it('U1 (AC-4) 선택한 날에 좌표 장소가 있으면 그날 첫 좌표 장소다 — 다른 날·거점보다 앞선다', () => {
    const center = resolvePlanMapCenter({
      days: [day(D1, [NO_COORD, A, B]), day(D2, [C])],
      selectedDate: D1,
      bases: [base('s-1')],
      stays: [stay('s-1', S.lat, S.lng)],
    });

    expect(center).toEqual(A);
  });

  it('U2 (AC-1 · Q3) 선택한 날이 비면 다른 날 중 날짜 순으로 처음 나오는 좌표 장소다', () => {
    const center = resolvePlanMapCenter({
      days: [day(D1, [B, A]), day(D2, []), day(D3, [C])],
      selectedDate: D2,
      bases: [],
      stays: [],
    });

    expect(center).toEqual(B);
  });

  it('U3 (AC-1) 선택 날짜가 일정 응답에 아예 없어도 다른 날 첫 좌표 장소다', () => {
    // 일차 칩은 여행 기간에서 나와서, 응답 days 에 없는 날짜도 고를 수 있다.
    const center = resolvePlanMapCenter({
      days: [day(D2, [C])],
      selectedDate: D1,
      bases: undefined,
      stays: undefined,
    });

    expect(center).toEqual(C);
  });

  it('U4 (AC-6) 선택한 날 슬롯의 좌표가 전부 없거나 반쪽이면 빈 날과 같다', () => {
    const center = resolvePlanMapCenter({
      days: [
        day(D1, [NO_COORD, { lat: 35.1, lng: null }, { lng: 129.1 }]),
        day(D2, [A]),
      ],
      selectedDate: D1,
      bases: [],
      stays: [],
    });

    expect(center).toEqual(A);
  });

  it('U5 (AC-1 · Q1 순서) 다른 날 좌표 장소가 거점 숙소보다 앞선다', () => {
    const center = resolvePlanMapCenter({
      days: [day(D1, []), day(D2, [C])],
      selectedDate: D1,
      bases: [base('s-1')],
      stays: [stay('s-1', S.lat, S.lng)],
    });

    expect(center).toEqual(C);
  });

  it('U6 (AC-2) 모든 날에 좌표 장소가 없으면 거점 숙소 좌표다', () => {
    const center = resolvePlanMapCenter({
      days: [day(D1, [NO_COORD]), day(D2, [])],
      selectedDate: D2,
      bases: [base('s-1')],
      stays: [stay('s-1', S.lat, S.lng)],
    });

    expect(center).toEqual(S);
  });

  it('U7 (AC-2) 좌표 없는 숙소·목록에 없는 숙소의 거점은 건너뛰고 좌표 있는 거점 숙소를 쓴다', () => {
    const center = resolvePlanMapCenter({
      days: [day(D1, [])],
      selectedDate: D1,
      bases: [base('s-null'), base('s-missing'), base('s-1')],
      stays: [stay('s-null', null, null), stay('s-1', S.lat, S.lng)],
    });

    expect(center).toEqual(S);
  });

  it.each<{
    label: string;
    bases: ReturnType<typeof base>[] | undefined;
    stays: ReturnType<typeof stay>[] | undefined;
  }>([
    {
      label: '거점 대기·실패',
      bases: undefined,
      stays: [stay('s-1', S.lat, S.lng)],
    },
    { label: '숙소 대기·실패', bases: [base('s-1')], stays: undefined },
    { label: '둘 다 대기·실패', bases: undefined, stays: undefined },
  ])(
    'U8 (AC-3 · Q1) 좌표 장소가 없고 $label 이면 서울시청이다',
    ({ bases, stays }) => {
      const center = resolvePlanMapCenter({
        days: [day(D1, [NO_COORD])],
        selectedDate: D1,
        bases,
        stays,
      });

      expect(center).toEqual(SEOUL);
    }
  );

  it('U9 (AC-3 · Q2) 아무 재료도 없으면 서울시청이고 0,0 이 아니다', () => {
    const center = resolvePlanMapCenter({
      days: [],
      selectedDate: D1,
      bases: [],
      stays: [],
    });

    expect(center).toEqual(SEOUL);
    expect(center).not.toEqual({ lat: 0, lng: 0 });
  });
  // 5-b 경고-2 — 좌표 있는 거점이 여럿일 때 고르는 규칙. 첫·마지막·가장 이른 거점이 서로 다르게 짜서
  // "아무 거점이나"를 고르는 구현과 구별한다.
  const D4 = '2026-06-13';
  const BUSAN = { lat: 35.1796, lng: 129.0756 };
  const GYEONGJU = { lat: 35.8562, lng: 129.2247 };
  const ULSAN = { lat: 35.5384, lng: 129.3114 };
  const MULTI_STAYS = [
    stay('s-bs', BUSAN.lat, BUSAN.lng),
    stay('s-gj', GYEONGJU.lat, GYEONGJU.lng),
    stay('s-us', ULSAN.lat, ULSAN.lng),
  ];
  const NO_PLACE_DAYS = [day(D1, []), day(D2, []), day(D3, []), day(D4, [])];

  it('U10 (AC-2 · 5-b 경고-2) 거점이 여럿이면 그날을 덮는 거점 숙소다(체크아웃 날은 안 덮는다)', () => {
    // 준비 — 부산 D1~D2 · 경주 D2~D3 · 울산 D3~D4. D2 를 덮는 건 경주뿐(부산은 D2 가 체크아웃 날).
    const center = resolvePlanMapCenter({
      days: NO_PLACE_DAYS,
      selectedDate: D2,
      bases: [
        { savedStayId: 's-bs', dateFrom: D1, dateTo: D2 },
        { savedStayId: 's-gj', dateFrom: D2, dateTo: D3 },
        { savedStayId: 's-us', dateFrom: D3, dateTo: D4 },
      ],
      stays: MULTI_STAYS,
    });

    expect(center).toEqual(GYEONGJU);
  });

  it('U11 (AC-2 · 5-b 경고-2) 그날을 덮는 거점이 없으면 시작일이 가장 이른 거점 숙소다', () => {
    // 준비 — D4 는 마지막 날(체크아웃)이라 아무 거점도 안 덮는다. 배열 순서 = 경주·부산·울산, 가장 이른 건 부산.
    const center = resolvePlanMapCenter({
      days: NO_PLACE_DAYS,
      selectedDate: D4,
      bases: [
        { savedStayId: 's-gj', dateFrom: D2, dateTo: D3 },
        { savedStayId: 's-bs', dateFrom: D1, dateTo: D2 },
        { savedStayId: 's-us', dateFrom: D3, dateTo: D4 },
      ],
      stays: MULTI_STAYS,
    });

    expect(center).toEqual(BUSAN);
  });
});

// ── 성질(PBT) ──────────────────────────────────────────────────────────────
// fast-check: `fc.assert(fc.property(생성기..., 검사))` 는 생성기가 만든 무작위 입력 수백 개로
// 검사를 돌리고, 하나라도 거짓이면 가장 작은 반례로 줄여 보고한다.

const DATES = [D1, D2, D3, '2026-06-13'];
const ABSENT_DATE = '2026-06-20';
const STAY_IDS = ['s-1', 's-2', 's-3'];

const coordArb = fc.record({
  lat: fc.double({ min: 33, max: 39, noNaN: true }),
  lng: fc.double({ min: 124, max: 132, noNaN: true }),
});

/** 슬롯 좌표 — 온전함 · 둘 다 null · 필드 없음 · 반쪽(위도만/경도만). */
const slotArb: fc.Arbitrary<Slot> = fc.oneof(
  coordArb,
  fc.constant({ lat: null, lng: null }),
  fc.constant({}),
  coordArb.map(({ lat }) => ({ lat, lng: null })),
  coordArb.map(({ lng }) => ({ lng }))
);

/** 0~4일, 날짜는 오름차순. */
const daysArb = fc
  .array(fc.array(slotArb, { maxLength: 4 }), { maxLength: 4 })
  .map((perDay) => perDay.map((slots, i) => day(DATES[i], slots)));

const selectedDateArb = fc.constantFrom(...DATES, ABSENT_DATE);

const basesArb = fc.option(
  fc.array(
    fc.record({
      savedStayId: fc.constantFrom(...STAY_IDS),
      dateFrom: fc.constantFrom(...DATES),
      dateTo: fc.constantFrom(...DATES),
    }),
    { maxLength: 3 }
  ),
  { nil: undefined }
);

const staysArb = fc.option(
  fc.array(
    fc.record({
      savedStayId: fc.constantFrom(...STAY_IDS),
      lat: fc.option(fc.double({ min: 33, max: 39, noNaN: true })),
      lng: fc.option(fc.double({ min: 124, max: 132, noNaN: true })),
    }),
    { maxLength: 3 }
  ),
  { nil: undefined }
);

type Coord = { lat: number; lng: number };

function fullCoord(point: Slot): Coord | null {
  return typeof point.lat === 'number' && typeof point.lng === 'number'
    ? { lat: point.lat, lng: point.lng }
    : null;
}

function firstFull(slots: readonly Slot[]): Coord | undefined {
  for (const slot of slots) {
    const coord = fullCoord(slot);
    if (coord) return coord;
  }
  return undefined;
}

describe('TRIP-1275 · resolvePlanMapCenter — 성질', () => {
  it('P1 (AC-6 · AC-3) 결과는 입력에 있던 좌표(장소·거점 숙소) 중 하나이거나 서울시청이다 — 0,0 을 지어내지 않는다', () => {
    fc.assert(
      fc.property(
        daysArb,
        selectedDateArb,
        basesArb,
        staysArb,
        (days, selectedDate, bases, stays) => {
          // 준비 — 결과가 될 수 있는 좌표 후보 = 장소 좌표 ∪ 거점이 가리키는 숙소 좌표 ∪ 서울시청.
          const baseIds = new Set((bases ?? []).map((b) => b.savedStayId));
          const candidates: Coord[] = [
            ...days.flatMap((d) => d.slots.flatMap((s) => fullCoord(s) ?? [])),
            ...(stays ?? [])
              .filter((s) => baseIds.has(s.savedStayId))
              .flatMap((s) => fullCoord(s) ?? []),
            SEOUL,
          ];

          // 실행
          const center = resolvePlanMapCenter({
            days,
            selectedDate,
            bases,
            stays,
          });

          // 단언
          expect(
            candidates.some((c) => c.lat === center.lat && c.lng === center.lng)
          ).toBe(true);
          expect(center).not.toEqual({ lat: 0, lng: 0 });
        }
      )
    );
  });

  it('P2 (AC-4) 선택한 날에 좌표 장소가 하나라도 있으면 결과는 그날 첫 좌표 장소다', () => {
    fc.assert(
      fc.property(
        daysArb,
        selectedDateArb,
        basesArb,
        staysArb,
        (days, selectedDate, bases, stays) => {
          const selected = days.find((d) => d.date === selectedDate);
          const expected = selected && firstFull(selected.slots);
          fc.pre(expected !== undefined);

          const center = resolvePlanMapCenter({
            days,
            selectedDate,
            bases,
            stays,
          });

          expect(center).toEqual(expected);
        }
      )
    );
  });

  it('P3 (AC-1) 선택한 날에 좌표 장소가 없고 다른 날에 있으면 결과는 날짜 순 첫 좌표 장소다', () => {
    fc.assert(
      fc.property(
        daysArb,
        selectedDateArb,
        basesArb,
        staysArb,
        (days, selectedDate, bases, stays) => {
          const selected = days.find((d) => d.date === selectedDate);
          fc.pre(!selected || firstFull(selected.slots) === undefined);
          const expected = firstFull(days.flatMap((d) => d.slots));
          fc.pre(expected !== undefined);

          const center = resolvePlanMapCenter({
            days,
            selectedDate,
            bases,
            stays,
          });

          expect(center).toEqual(expected);
        }
      )
    );
  });
});
