import fc from 'fast-check';

import {
  comparePlaceAdd,
  placeAddToastMessage,
  type PlaceAddShift,
  type PlaceAddSlotLike,
} from './placeAddNotice';

/**
 * TRIP-1424 · AC-10~14 · AC-20 — 장소 추가 뒤 "서버가 시각을 밀었나"를 **요청과 응답을 견줘** 알아낸다.
 *
 * 왜 비교인가: 서버 응답엔 "밀었다"는 필드가 없다(openapi 에 `timeAdjusted`·`requestedStartAt` 0건). 대신 정본
 * (BR-U3-13·14 §3 개정)이 "repair 결과는 장소·순서를 편집 그대로 유지할 때만 쓴다"를 보장해, 응답 그날 슬롯의
 * **같은 자리(index)** 가 요청의 같은 슬롯이다. 그래서 추가한 슬롯은 (날짜, poiId)로 찾지 않고 자리로 집는다 —
 * 같은 날 같은 장소가 둘이면 poiId 검색은 먼저 있던 것을 잡는다(표 7).
 *
 * 비교 단위는 `HH:mm`(앞 5글자)다 — 시트는 초를 다루지 않는다. 시각 값은 **응답값 그대로** 말한다(INV-2).
 *
 * 3동작 뼈대: 준비 = 그날 요청 슬롯 · 응답 슬롯 · 추가한 자리 → 실행 = 비교 / 문구 → 단언 = 결과 · 완전 일치 문구.
 */

/** `[poiId, "HH:mm"]` 쌍으로 슬롯 배열을 만든다(초는 :00). */
function slots(...pairs: [string, string][]): PlaceAddSlotLike[] {
  return pairs.map(([poiId, hhmm]) => ({ poiId, startAt: `${hhmm}:00` }));
}

const SAVED = '추가했어요 · 일정에 바로 저장됐어요';

describe('comparePlaceAdd — 표', () => {
  it.each<
    [
      string,
      PlaceAddSlotLike[],
      PlaceAddSlotLike[] | undefined,
      number,
      PlaceAddShift | null,
    ]
  >([
    [
      '1 · 요청 그대로 저장 → 바뀐 것 없음',
      slots(['a', '16:00'], ['p', '17:14']),
      slots(['a', '16:00'], ['p', '17:14']),
      1,
      { addedStartAt: null, laterShiftedCount: 0 },
    ],
    [
      '2 · 추가한 곳이 17:40 으로 밀림 → 그 시각(응답값)',
      slots(['a', '16:00'], ['p', '17:14']),
      slots(['a', '16:00'], ['p', '17:40']),
      1,
      { addedStartAt: '17:40', laterShiftedCount: 0 },
    ],
    [
      '3 · 초만 다르면 같은 시각이다(HH:mm 비교)',
      slots(['a', '16:00'], ['p', '17:14']),
      [
        { poiId: 'a', startAt: '16:00:00' },
        { poiId: 'p', startAt: '17:14:30' },
      ],
      1,
      { addedStartAt: null, laterShiftedCount: 0 },
    ],
    [
      '4 · 추가한 곳 + 뒤 1곳 밀림(뒤 하나는 그대로)',
      slots(['a', '16:00'], ['p', '17:14'], ['b', '18:00'], ['c', '20:00']),
      slots(['a', '16:00'], ['p', '17:40'], ['b', '18:30'], ['c', '20:00']),
      1,
      { addedStartAt: '17:40', laterShiftedCount: 1 },
    ],
    [
      '5 · 추가한 곳은 그대로, 뒤 2곳만 밀림',
      slots(['a', '16:00'], ['p', '17:14'], ['b', '18:00'], ['c', '20:00']),
      slots(['a', '16:00'], ['p', '17:14'], ['b', '18:30'], ['c', '20:10']),
      1,
      { addedStartAt: null, laterShiftedCount: 2 },
    ],
    [
      '6 · 앞 슬롯이 바뀐 건 세지 않는다',
      slots(['a', '16:00'], ['p', '17:14'], ['b', '18:00']),
      slots(['a', '16:10'], ['p', '17:14'], ['b', '18:00']),
      1,
      { addedStartAt: null, laterShiftedCount: 0 },
    ],
    [
      '7 · 같은 날 같은 장소가 둘이면 추가한 자리(뒤의 p)로 말한다',
      slots(['a', '09:00'], ['p', '12:00'], ['b', '16:00'], ['p', '17:14']),
      slots(['a', '09:00'], ['p', '12:00'], ['b', '16:00'], ['p', '17:40']),
      3,
      { addedStartAt: '17:40', laterShiftedCount: 0 },
    ],
    [
      '8 · 응답 그날 슬롯이 비면 특정 못 함',
      slots(['a', '16:00'], ['p', '17:14']),
      [],
      1,
      null,
    ],
    [
      '9 · 같은 자리의 장소가 다르면 특정 못 함',
      slots(['a', '16:00'], ['p', '17:14']),
      slots(['a', '16:00'], ['x', '17:40']),
      1,
      null,
    ],
    [
      '10 · 응답에 그날이 없으면 특정 못 함',
      slots(['a', '16:00'], ['p', '17:14']),
      undefined,
      1,
      null,
    ],
  ])('%s', (_name, requestSlots, responseSlots, addedIndex, expected) => {
    expect(
      comparePlaceAdd({ requestSlots, responseSlots, addedIndex })
    ).toEqual(expected);
  });
});

describe('placeAddToastMessage — 문구 행렬(01b Q6)', () => {
  it.each<[PlaceAddShift | null, string]>([
    [
      { addedStartAt: '17:40', laterShiftedCount: 3 },
      '추가했어요 · 이동 시간을 반영해 17:40으로 맞췄어요 · 뒤 3곳도 시간이 밀렸어요',
    ],
    [
      { addedStartAt: '17:40', laterShiftedCount: 0 },
      '추가했어요 · 이동 시간을 반영해 17:40으로 맞췄어요',
    ],
    [
      { addedStartAt: null, laterShiftedCount: 2 },
      '추가했어요 · 뒤 2곳의 시간이 밀렸어요',
    ],
    [{ addedStartAt: null, laterShiftedCount: 0 }, SAVED],
    [null, SAVED],
  ])('%j → %s', (shift, expected) => {
    expect(placeAddToastMessage(shift)).toBe(expected);
  });
});

describe('comparePlaceAdd — 속성', () => {
  /** "HH:mm" — 00:00 ~ 23:59. */
  const hhmm = fc
    .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
    .map(
      ([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    );
  /** 그날 요청 슬롯 1~6곳 + 추가한 자리. poiId 는 겹칠 수 있다(같은 장소 두 번). */
  const day = fc
    .array(fc.tuple(fc.constantFrom('a', 'b', 'c', 'p'), hhmm), {
      minLength: 1,
      maxLength: 6,
    })
    .chain((pairs) =>
      fc.record({
        request: fc.constant(slots(...pairs)),
        addedIndex: fc.integer({ min: 0, max: pairs.length - 1 }),
      })
    );
  /** 다른 분으로 바꾼다(같은 HH:mm 이 되지 않게 1분 뒤로, 23:59 는 00:00). */
  function bump(startAt: string): string {
    const total =
      (Number(startAt.slice(0, 2)) * 60 + Number(startAt.slice(3, 5)) + 1) %
      (24 * 60);
    const h = String(Math.floor(total / 60)).padStart(2, '0');
    const m = String(total % 60).padStart(2, '0');
    return `${h}:${m}:00`;
  }

  it('① 응답이 요청과 같으면 바뀐 것이 없다', () => {
    fc.assert(
      fc.property(day, ({ request, addedIndex }) => {
        expect(
          comparePlaceAdd({
            requestSlots: request,
            responseSlots: request.map((s) => ({ ...s })),
            addedIndex,
          })
        ).toEqual({ addedStartAt: null, laterShiftedCount: 0 });
      })
    );
  });

  it('② 추가한 자리 앞 슬롯만 바뀌면 결과는 ①과 같다(앞은 안 센다)', () => {
    fc.assert(
      fc.property(day, ({ request, addedIndex }) => {
        const response = request.map((s, i) =>
          i < addedIndex ? { ...s, startAt: bump(s.startAt) } : { ...s }
        );
        expect(
          comparePlaceAdd({
            requestSlots: request,
            responseSlots: response,
            addedIndex,
          })
        ).toEqual({ addedStartAt: null, laterShiftedCount: 0 });
      }),
      {
        // 앞이 없는 자리(0)와 앞이 가득한 자리(끝)를 반드시 지난다.
        examples: [
          [{ request: slots(['p', '10:00'], ['a', '11:00']), addedIndex: 0 }],
          [
            {
              request: slots(['a', '10:00'], ['b', '11:00'], ['p', '12:00']),
              addedIndex: 2,
            },
          ],
        ],
      }
    );
  });

  it('③ 뒤 슬롯 중 고른 곳만 바꾸면 그 개수가 laterShiftedCount 다', () => {
    fc.assert(
      fc.property(
        day.chain(({ request, addedIndex }) =>
          fc.record({
            request: fc.constant(request),
            addedIndex: fc.constant(addedIndex),
            // 뒤 자리마다 바꿀지 말지.
            flips: fc.array(fc.boolean(), {
              minLength: request.length,
              maxLength: request.length,
            }),
          })
        ),
        ({ request, addedIndex, flips }) => {
          const response = request.map((s, i) =>
            i > addedIndex && flips[i]
              ? { ...s, startAt: bump(s.startAt) }
              : { ...s }
          );
          const expected = flips.filter((f, i) => i > addedIndex && f).length;
          expect(
            comparePlaceAdd({
              requestSlots: request,
              responseSlots: response,
              addedIndex,
            })?.laterShiftedCount
          ).toBe(expected);
        }
      ),
      {
        // 뒤 0곳 바뀜 · 뒤 전부 바뀜.
        examples: [
          [
            {
              request: slots(['a', '10:00'], ['p', '11:00'], ['b', '12:00']),
              addedIndex: 1,
              flips: [false, false, false],
            },
          ],
          [
            {
              request: slots(
                ['a', '10:00'],
                ['p', '11:00'],
                ['b', '12:00'],
                ['c', '13:00']
              ),
              addedIndex: 1,
              flips: [true, true, true, true],
            },
          ],
        ],
      }
    );
  });

  it('④ 응답 그날 순서에서 장소 하나라도 다르면 특정 못 한다(null)', () => {
    fc.assert(
      fc.property(
        day.chain(({ request, addedIndex }) =>
          fc.record({
            request: fc.constant(request),
            addedIndex: fc.constant(addedIndex),
            at: fc.integer({ min: 0, max: request.length - 1 }),
          })
        ),
        ({ request, addedIndex, at }) => {
          const response = request.map((s, i) =>
            i === at ? { ...s, poiId: `${s.poiId}-other` } : { ...s }
          );
          expect(
            comparePlaceAdd({
              requestSlots: request,
              responseSlots: response,
              addedIndex,
            })
          ).toBeNull();
        }
      )
    );
  });
});

describe('placeAddToastMessage — 속성', () => {
  it('⑤ 어느 결과든 문구는 "추가했어요"로 시작하고 소요시간 꼴(숫자+분·초·시간·소요)이 없다 (INV-3)', () => {
    const shift = fc.option(
      fc.record({
        addedStartAt: fc.option(
          fc
            .tuple(
              fc.integer({ min: 0, max: 23 }),
              fc.integer({ min: 0, max: 59 })
            )
            .map(
              ([h, m]) =>
                `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
            ),
          { nil: null }
        ),
        laterShiftedCount: fc.integer({ min: 0, max: 20 }),
      }),
      { nil: null }
    );
    fc.assert(
      fc.property(shift, (value) => {
        const message = placeAddToastMessage(value);
        expect(message.startsWith('추가했어요')).toBe(true);
        expect(message).not.toMatch(/\d+\s*(분|초|시간)|소요/);
      }),
      {
        examples: [
          [{ addedStartAt: '17:40', laterShiftedCount: 3 }],
          [{ addedStartAt: null, laterShiftedCount: 1 }],
          [null],
        ],
      }
    );
  });
});
