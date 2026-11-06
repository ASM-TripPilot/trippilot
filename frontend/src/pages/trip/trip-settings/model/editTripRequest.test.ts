import fc from 'fast-check';

import type {
  CompanionType,
  EditTripRequest,
  Trip,
} from '@/shared/api/index.schemas';
import { makeTrip } from '@/test-support/mustVisitFixtures';

import { toEditTripRequest } from './editTripRequest';

/**
 * TRIP-1787 · `toEditTripRequest(trip, edits)` — `GET /trips/{id}` 로 받은 여행(`trip`)과 사용자가 바꾼 칸(`edits`)으로
 * `PATCH /trips/{id}` 본문(`EditTripRequest`)을 만드는 순수 함수의 잠금.
 *
 * 새 개념 한 줄 — **PATCH 통째 교체**: 서버는 "바뀐 칸만"이 아니라 "받은 본문 전체"로 여행을 덮어쓴다. 본문에서 빠진 칸은
 * 지워지거나 기본값이 된다(예산은 null, 인원은 1, 일과는 09:00). 그래서 안 바꾼 칸도 지금 값을 그대로 다시 실어야 한다.
 *
 * 무엇을 보장하나(계약, 01b D2):
 *  - 안 바꾼 칸은 GET 값 그대로 echo — budgetTotal · destinations(regionCode·nights 포함) · startDate · endDate · party ·
 *    companionType · 일과 3칸(서버가 `HH:mm:ss` 로 줘도 원문 그대로).
 *  - `preferenceSnapshot` 키는 본문에 없다(EditTripRequest 에 칸이 없고 서버가 기존 값을 유지한다).
 *  - `title` 은 항상 실린다 — 빠지면 서버가 `{첫 목적지} 여행` 으로 되돌린다. 본문 title 은 입력 원문 그대로다(트림 없음 —
 *    서버도 트림하지 않고 길이는 원문 코드포인트 기준).
 *  - 일과를 시트로 바꿨으면(`edits.dayWindow` 가 있으면) 시트 결과(`HH:mm`)를 따르고, **정한 값만 키가 있다**(위저드
 *    생성 요청과 같은 규약 — 기본으로 돌아간 칸은 키가 없다). 시트를 안 열었으면 3칸 모두 GET 원문 그대로.
 *  - 기간(startDate·endDate)은 `edits.period` 를 안 주면 바뀌지 않는다(TRIP-1788 이 1787 의 "어떤 edits 로도 불변"을 이 한 칸만 뒤집었다).
 *  - (TRIP-1788) `edits.period` 를 주면 날짜가 그 값이고 `destinations` 박수 합이 새 박수 이하로 맞춰진다. `coverKey` 는
 *    `edits.coverKey === undefined ? trip.coverKey : edits.coverKey` 이고 결과가 undefined 면 키가 없다(null 은 null). `discardItinerary`
 *    는 `edits.discardItinerary` 가 있을 때만 `true` 로 실리고 평소엔 키가 없다.
 *
 * 3동작: 준비(GET 여행 + edits) → 실행(toEditTripRequest) → 단언(본문).
 */

const FULL_GET: Trip = makeTrip({
  tripId: 'trip-1787',
  title: '내 맘대로 이름',
  startDate: '2099-06-10',
  endDate: '2099-06-13',
  party: 3,
  companionType: '친구',
  budgetTotal: 1500000,
  preferenceSnapshot: { styles: ['자연'] } as Trip['preferenceSnapshot'],
  destinations: [
    { seq: 1, region: '중구', nights: 2, regionCode: '26110' },
    { seq: 2, region: '제주', nights: 1, regionCode: null },
  ],
  status: 'ACTIVE',
  dayStartAt: '09:30:00',
  firstDayStartAt: '12:00:00',
  lastDayEndAt: '18:00:00',
});

/** 안 바꿨을 때 기대하는 본문 — GET 값 그대로(일과는 `HH:mm:ss` 원문). */
const ECHO: EditTripRequest = {
  title: '내 맘대로 이름',
  startDate: '2099-06-10',
  endDate: '2099-06-13',
  party: 3,
  companionType: '친구',
  budgetTotal: 1500000,
  destinations: [
    { seq: 1, region: '중구', nights: 2, regionCode: '26110' },
    { seq: 2, region: '제주', nights: 1, regionCode: null },
  ],
  dayStartAt: '09:30:00',
  firstDayStartAt: '12:00:00',
  lastDayEndAt: '18:00:00',
};

const ALLOWED_KEYS = [
  'title',
  'startDate',
  'endDate',
  'party',
  'companionType',
  'budgetTotal',
  'destinations',
  'dayStartAt',
  'firstDayStartAt',
  'lastDayEndAt',
  'coverKey',
  'discardItinerary',
];

describe('toEditTripRequest — 예시', () => {
  it('아무것도 안 바꾸면 GET 값 전체를 그대로 싣는다(일과는 HH:mm:ss 원문, 취향 스냅샷 키는 없다)', () => {
    const body = toEditTripRequest(FULL_GET, {});

    expect(body).toEqual(ECHO);
    expect('preferenceSnapshot' in body).toBe(false);
    expect(Object.keys(body).every((key) => ALLOWED_KEYS.includes(key))).toBe(
      true
    );
  });

  it('이름만 바꾸면 title 만 새 값이고 나머지는 GET 그대로(예산·regionCode·박수·일과 포함)', () => {
    const body = toEditTripRequest(FULL_GET, { title: '새 이름' });

    expect(body).toEqual({ ...ECHO, title: '새 이름' });
  });

  it('한 곳짜리 여행도 기존 이름을 그대로 싣는다 — 위저드처럼 title 을 빼서 서버 기본 제목("부산 여행")으로 돌아가지 않는다', () => {
    const single = makeTrip({
      title: '엄마랑 바다',
      destinations: [{ seq: 1, region: '부산', nights: 2, regionCode: '26' }],
    });

    expect(toEditTripRequest(single, {}).title).toBe('엄마랑 바다');
    expect(toEditTripRequest(single, { title: '  앞뒤 공백  ' }).title).toBe(
      '  앞뒤 공백  '
    );
  });

  it('동행을 바꾸면 party·companionType 이 새 값, 나머지는 그대로', () => {
    const body = toEditTripRequest(FULL_GET, {
      party: 2,
      companionType: '연인',
    });

    expect(body).toEqual({ ...ECHO, party: 2, companionType: '연인' });
  });

  it('일과를 시트로 바꾸면 시트 결과(HH:mm)를 따른다 — 정한 값만 키가 있고, GET 에 있던 첫날 값도 시트에서 지웠으면 키가 없다', () => {
    const body = toEditTripRequest(FULL_GET, {
      dayWindow: { dayStartAt: '10:00', lastDayEndAt: '18:00' },
    });

    expect(body).toEqual({
      ...ECHO,
      dayStartAt: '10:00',
      lastDayEndAt: '18:00',
      firstDayStartAt: undefined, // toEqual 은 undefined 키를 없는 키와 같게 본다 — 아래 한 줄이 "없다"를 못박는다
    });
    expect('firstDayStartAt' in body).toBe(false);
  });

  it('시트를 열어 전부 기본으로 돌려 적용하면(빈 일과) 일과 3칸 키가 모두 없다', () => {
    const body = toEditTripRequest(FULL_GET, { dayWindow: {} });

    expect('dayStartAt' in body).toBe(false);
    expect('firstDayStartAt' in body).toBe(false);
    expect('lastDayEndAt' in body).toBe(false);
    // 일과 말고는 그대로
    expect(body.title).toBe(ECHO.title);
    expect(body.destinations).toEqual(ECHO.destinations);
  });

  it('GET 이 null 로 준 칸은 null 로 되돌려 보낸다(예산·동행·일과) — 키를 빼면 다른 뜻이 될 수 있다', () => {
    const body = toEditTripRequest(
      makeTrip({
        companionType: null,
        budgetTotal: null,
        dayStartAt: null,
        firstDayStartAt: null,
        lastDayEndAt: null,
      }),
      {}
    );

    expect(body.companionType).toBeNull();
    expect(body.budgetTotal).toBeNull();
    expect(body.dayStartAt).toBeNull();
    expect(body.firstDayStartAt).toBeNull();
    expect(body.lastDayEndAt).toBeNull();
  });

  it('범위 밖인 옛 동행 조합(혼자 + 3명)도 건드리지 않으면 그대로 실린다 — 클램프하지 않는다(D9)', () => {
    const body = toEditTripRequest(
      makeTrip({ party: 3, companionType: '혼자' }),
      {}
    );

    expect(body.party).toBe(3);
    expect(body.companionType).toBe('혼자');
  });

  it('입력(trip)을 바꾸지 않는다 — 깊이 얼린 객체를 줘도 던지지 않고 같은 본문을 돌려준다', () => {
    const frozen = structuredClone(FULL_GET);
    Object.freeze(frozen);
    Object.freeze(frozen.destinations);
    frozen.destinations.forEach((one) => Object.freeze(one));

    expect(toEditTripRequest(frozen, { title: 'x' })).toEqual({
      ...ECHO,
      title: 'x',
    });
  });
});

describe('toEditTripRequest — 속성(PBT)', () => {
  const COMPANIONS: (CompanionType | null)[] = [
    null,
    '혼자',
    '친구',
    '연인',
    '가족',
  ];
  const clock = fc
    .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
    .map(
      ([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    );
  const serverClock = fc.oneof(
    clock,
    clock.map((hhmm) => `${hhmm}:00`)
  );
  const nullableClock = fc.oneof(fc.constant(null), serverClock);

  const tripArb: fc.Arbitrary<Trip> = fc
    .record({
      title: fc.string({ minLength: 1, maxLength: 40 }),
      party: fc.integer({ min: 1, max: 12 }),
      companionType: fc.constantFrom(...COMPANIONS),
      budgetTotal: fc.oneof(fc.constant(null), fc.nat({ max: 50_000_000 })),
      destinations: fc.array(
        fc.record({
          seq: fc.integer({ min: 1, max: 5 }),
          region: fc.string({ minLength: 1, maxLength: 10 }),
          nights: fc.nat({ max: 5 }),
          regionCode: fc.oneof(
            fc.constant(null),
            fc.string({ minLength: 2, maxLength: 5 })
          ),
        }),
        { minLength: 1, maxLength: 3 }
      ),
      dayStartAt: nullableClock,
      firstDayStartAt: nullableClock,
      lastDayEndAt: nullableClock,
      span: fc.constantFrom(
        ['2099-06-10', '2099-06-13'],
        ['2099-07-01', '2099-07-01'],
        ['2020-01-05', '2020-01-09']
      ),
    })
    .map(({ span, ...rest }) =>
      makeTrip({
        ...rest,
        startDate: span[0],
        endDate: span[1],
        preferenceSnapshot: { styles: ['자연'] } as Trip['preferenceSnapshot'],
      })
    );

  const editsArb = fc.record(
    {
      title: fc.string({ maxLength: 30 }),
      party: fc.integer({ min: 1, max: 12 }),
      companionType: fc.constantFrom<CompanionType>(
        '혼자',
        '친구',
        '연인',
        '가족'
      ),
      dayWindow: fc.record(
        {
          dayStartAt: clock,
          firstDayStartAt: clock,
          lastDayEndAt: clock,
        },
        { requiredKeys: [] }
      ),
    },
    { requiredKeys: [] }
  );

  it('edits 가 비면 본문의 모든 칸이 GET 값과 같다(title 포함, 일과는 원문) — 취향 스냅샷 키는 없다', () => {
    fc.assert(
      fc.property(tripArb, (trip) => {
        const body = toEditTripRequest(trip, {});

        expect(body).toEqual({
          title: trip.title,
          startDate: trip.startDate,
          endDate: trip.endDate,
          party: trip.party,
          companionType: trip.companionType,
          budgetTotal: trip.budgetTotal,
          destinations: trip.destinations,
          dayStartAt: trip.dayStartAt,
          firstDayStartAt: trip.firstDayStartAt,
          lastDayEndAt: trip.lastDayEndAt,
        });
        expect('preferenceSnapshot' in body).toBe(false);
      })
    );
  });

  it('period 를 안 준 edits 는 기간·예산·목적지(regionCode·박수)를 GET 값 그대로 두고, 본문 키는 EditTripRequest 칸뿐이다', () => {
    fc.assert(
      fc.property(tripArb, editsArb, (trip, edits) => {
        const body = toEditTripRequest(trip, edits);

        expect(body.startDate).toBe(trip.startDate);
        expect(body.endDate).toBe(trip.endDate);
        expect(body.budgetTotal).toEqual(trip.budgetTotal);
        expect(body.destinations).toEqual(trip.destinations);
        expect('preferenceSnapshot' in body).toBe(false);
        expect(
          Object.keys(body).every((key) => ALLOWED_KEYS.includes(key))
        ).toBe(true);
      })
    );
  });

  it('edits 에 준 칸만 바뀐다 — title·party·companionType 은 준 값, 안 준 칸은 GET 값', () => {
    fc.assert(
      fc.property(tripArb, editsArb, (trip, edits) => {
        const body = toEditTripRequest(trip, edits);

        expect(body.title).toBe(edits.title ?? trip.title);
        expect(body.party).toBe(edits.party ?? trip.party);
        expect(body.companionType).toEqual(
          edits.companionType ?? trip.companionType
        );
      })
    );
  });

  it('일과 시트를 안 열었으면(dayWindow 없음) 일과 3칸은 GET 원문 그대로, 열었으면 시트가 준 값만 키가 있다', () => {
    fc.assert(
      fc.property(tripArb, editsArb, (trip, edits) => {
        const body = toEditTripRequest(trip, edits);

        if (edits.dayWindow === undefined) {
          expect(body.dayStartAt).toEqual(trip.dayStartAt);
          expect(body.firstDayStartAt).toEqual(trip.firstDayStartAt);
          expect(body.lastDayEndAt).toEqual(trip.lastDayEndAt);
        } else {
          for (const key of [
            'dayStartAt',
            'firstDayStartAt',
            'lastDayEndAt',
          ] as const) {
            const given = edits.dayWindow[key];
            if (given === undefined) expect(key in body).toBe(false);
            else expect(body[key]).toBe(given);
          }
        }
      })
    );
  });
});

describe('toEditTripRequest — 기간 이동·일수 변경·커버 (TRIP-1788)', () => {
  /** 기간 3박 4일 · 박수 합 3. */
  const BASE: Trip = makeTrip({
    startDate: '2099-06-10',
    endDate: '2099-06-13',
    destinations: [
      { seq: 1, region: '제주시', nights: 2, regionCode: '50110' },
      { seq: 2, region: '서귀포시', nights: 1, regionCode: '50130' },
    ],
    dayStartAt: null,
    firstDayStartAt: null,
    lastDayEndAt: null,
  });
  const sum = (body: EditTripRequest) =>
    body.destinations.reduce((acc, one) => acc + one.nights, 0);

  it('일수가 같은 기간 이동은 날짜만 바뀌고 목적지는 그대로이며 discardItinerary 키가 없다', () => {
    const body = toEditTripRequest(BASE, {
      period: { startDate: '2099-06-20', endDate: '2099-06-23' },
    });

    expect(body.startDate).toBe('2099-06-20');
    expect(body.endDate).toBe('2099-06-23');
    expect(body.destinations).toEqual(BASE.destinations);
    expect('discardItinerary' in body).toBe(false);
  });

  it('일수를 줄이는 확정은 박수 합이 새 박수 이하로 맞춰지고 discardItinerary: true 가 실린다', () => {
    const body = toEditTripRequest(BASE, {
      period: { startDate: '2099-06-10', endDate: '2099-06-11' },
      discardItinerary: true,
    });

    expect(body.discardItinerary).toBe(true);
    expect(sum(body)).toBeLessThanOrEqual(1);
    expect(body.destinations.map((one) => one.nights)).toEqual([1, 0]);
    expect(body.destinations.map((one) => one.seq)).toEqual([1, 2]);
    expect(body.destinations[1]).toMatchObject({
      region: '서귀포시',
      regionCode: '50130',
    });
  });

  it('일수를 늘리는 확정은 마지막 여행지만 늘어난다', () => {
    const body = toEditTripRequest(BASE, {
      period: { startDate: '2099-06-10', endDate: '2099-06-20' },
      discardItinerary: true,
    });

    expect(body.destinations.map((one) => one.nights)).toEqual([2, 8]);
    expect(body.discardItinerary).toBe(true);
  });

  it('discardItinerary 는 edits 에 줄 때만 키가 있다 — 아무것도 안 주면 키가 없다', () => {
    expect('discardItinerary' in toEditTripRequest(BASE, {})).toBe(false);
    expect(
      'discardItinerary' in toEditTripRequest(BASE, { title: '바꿈' })
    ).toBe(false);
  });

  it.each<
    [
      string,
      string | null | undefined,
      string | null | undefined,
      string | null | undefined,
    ]
  >([
    [
      '안 건드림 + GET 에 키 있음 → 현재 키 그대로(없으면 지워지니까)',
      '26350',
      undefined,
      '26350',
    ],
    ['안 건드림 + 앱이 모르는 키 → 원문 그대로', 'zz9', undefined, 'zz9'],
    ['고름 → 고른 키', '26350', '11110', '11110'],
    ['첫 칸(자동)을 고름 → null', '26350', null, null],
    ['GET 이 null + 안 건드림 → null 을 되돌려 보낸다', null, undefined, null],
  ])('coverKey — %s', (_label, got, picked, expected) => {
    const trip = makeTrip({ coverKey: got });
    const body = toEditTripRequest(
      trip,
      picked === undefined ? {} : { coverKey: picked }
    );

    expect(body.coverKey).toBe(expected);
    expect('coverKey' in body).toBe(true);
  });

  it('옛 서버(GET 에 coverKey 칸 자체가 없음)면 안 건드렸을 때 본문에도 키가 없다 — 고르면 그 키가 실린다', () => {
    const old = makeTrip();

    expect('coverKey' in old).toBe(false);
    expect('coverKey' in toEditTripRequest(old, {})).toBe(false);
    expect('coverKey' in toEditTripRequest(old, { title: '이름' })).toBe(false);
    expect(toEditTripRequest(old, { coverKey: '26350' }).coverKey).toBe(
      '26350'
    );
  });

  it('PBT — 기간을 주면 박수 합이 새 박수 이하이고 seq·순서가 그대로다, coverKey 규칙이 어떤 조합에도 성립한다', () => {
    const nightsArb = fc.integer({ min: 0, max: 30 });
    const coverArb = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.constantFrom('11', '26350', 'zz9')
    );
    const destinationsArb = fc
      .array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 4 })
      .map((nights) =>
        nights.map((n, i) => ({
          seq: i + 1,
          region: `지역${i}`,
          nights: n,
          regionCode: null,
        }))
      );
    fc.assert(
      fc.property(
        destinationsArb,
        fc.integer({ min: 0, max: 6 }),
        nightsArb,
        coverArb,
        coverArb,
        (destinations, slack, newNights, gotKey, pickedKey) => {
          const oldNights =
            destinations.reduce((acc, one) => acc + one.nights, 0) + slack;
          const trip = makeTrip({
            startDate: '2099-06-10',
            endDate: new Date(Date.UTC(2099, 5, 10) + oldNights * 86_400_000)
              .toISOString()
              .slice(0, 10),
            destinations,
            ...(gotKey === undefined ? {} : { coverKey: gotKey }),
          });
          const end = new Date(Date.UTC(2099, 5, 10) + newNights * 86_400_000)
            .toISOString()
            .slice(0, 10);
          const body = toEditTripRequest(trip, {
            period: { startDate: '2099-06-10', endDate: end },
            discardItinerary: true,
            ...(pickedKey === undefined ? {} : { coverKey: pickedKey }),
          });

          expect(sum(body)).toBeLessThanOrEqual(newNights);
          expect(body.destinations.map((one) => one.seq)).toEqual(
            destinations.map((one) => one.seq)
          );
          expect(body.destinations.every((one) => one.nights >= 0)).toBe(true);
          const expected = pickedKey === undefined ? gotKey : pickedKey;
          if (expected === undefined) expect('coverKey' in body).toBe(false);
          else expect(body.coverKey).toBe(expected);
          expect(body.discardItinerary).toBe(true);
        }
      )
    );
  });
});
