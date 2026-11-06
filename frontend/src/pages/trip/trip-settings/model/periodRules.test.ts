import { AxiosError, type AxiosResponse } from 'axios';
import fc from 'fast-check';

import type { TripDestination } from '@/shared/api/index.schemas';

import {
  fitDestinationNights,
  isTripChildKey,
  periodConflictCode,
  periodHint,
  periodLock,
  pickLengthRange,
  shiftedEndDate,
} from './periodRules';

/**
 * TRIP-1788 · 여행 설정 기간 편집 규칙 — 화면이 부르는 순수 함수 7개의 잠금(시계·네트워크를 모른다).
 *
 * 새 개념 두 줄 —
 *  - **PBT(속성 기반 테스트, fast-check)**: 예시를 손으로 늘어놓는 대신 "어떤 입력에도 성립해야 하는 성질"을 적고
 *    무작위 입력 수백 개로 반례를 찾는다. 날짜 계산의 정답은 구현과 **다른 방법**(UTC 자정 에포크 일수)으로 따로 계산한다.
 *  - **에포크 일수**: 1970-01-01 부터 센 날짜 번호. 월·연 경계를 신경 쓰지 않고 날짜끼리 빼고 더할 수 있다.
 *
 * 무엇을 보장하나(AC-2·3·4·5·1·D9·D10):
 *  - `shiftedEndDate`: 시작을 옮겨도 끝−시작 일수가 그대로(월·연·윤년 경계, 박수 합과 무관 — 날짜만 받는다).
 *  - `pickLengthRange`: 끝일 모드 — 탭 ≥ 시작이면 끝 변경, 탭 < 시작이면 시작 변경·끝 유지, 어느 쪽이든 끝 ≥ 시작·30박 이하.
 *  - `periodLock`/`periodHint`: 끝남 > 시작됨(오늘 포함) > 생성 중 > 열림 우선순위와 문구.
 *  - `periodConflictCode`: 409 응답의 `error.code` 만 꺼낸다.
 *  - `isTripChildKey`: `/trips/{id}/…` 자식 키만 참(단건·다른 여행·접두가 같은 다른 id 는 거짓).
 *  - `fitDestinationNights`: 새 박수에 박수 합을 맞춘다(늘리면 마지막만, 줄이면 마지막부터).
 */

const DAY_MS = 86_400_000;
const epochDay = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const fromEpochDay = (day: number): string =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);

/** 2000-01-01 ~ 2100-12-31 사이 날짜 번호. */
const dayArb = fc.integer({
  min: epochDay('2000-01-01'),
  max: epochDay('2100-12-31'),
});

describe('shiftedEndDate — 같은 일수로 끝이 따라온다', () => {
  it.each([
    ['월말을 넘는다', '2099-02-27', '2099-03-01', '2099-12-30', '2100-01-01'],
    [
      '윤년 2월을 지난다',
      '2096-02-28',
      '2096-03-01',
      '2097-02-27',
      '2097-03-01',
    ],
    ['연말을 넘는다', '2099-06-10', '2099-06-13', '2100-12-30', '2101-01-02'],
    [
      '당일치기는 당일치기로',
      '2099-06-10',
      '2099-06-10',
      '2099-07-01',
      '2099-07-01',
    ],
  ])('%s', (_label, startDate, endDate, newStart, expected) => {
    expect(shiftedEndDate({ startDate, endDate }, newStart)).toBe(expected);
  });

  it('PBT — 어떤 날짜 조합에도 끝−시작 일수가 같고 형식은 YYYY-MM-DD', () => {
    fc.assert(
      fc.property(
        dayArb,
        fc.integer({ min: 0, max: 60 }),
        dayArb,
        (start, nights, newStart) => {
          const period = {
            startDate: fromEpochDay(start),
            endDate: fromEpochDay(start + nights),
          };
          const result = shiftedEndDate(period, fromEpochDay(newStart));

          expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(epochDay(result) - newStart).toBe(nights);
        }
      )
    );
  });
});

describe('pickLengthRange — 끝일 모드의 달력 탭', () => {
  const range = { start: '2099-06-10', end: '2099-06-13' };

  it.each([
    [
      '탭 ≥ 시작: 끝이 바뀐다',
      '2099-06-20',
      { start: '2099-06-10', end: '2099-06-20' },
    ],
    [
      '탭 = 시작: 당일치기',
      '2099-06-10',
      { start: '2099-06-10', end: '2099-06-10' },
    ],
    [
      '탭 < 시작: 시작이 바뀌고 끝은 그대로',
      '2099-06-05',
      { start: '2099-06-05', end: '2099-06-13' },
    ],
    [
      '탭이 시작+30일 딱: 안 자른다',
      '2099-07-10',
      { start: '2099-06-10', end: '2099-07-10' },
    ],
    [
      '탭이 시작+30일 초과: 시작+30일로 자른다',
      '2099-08-01',
      { start: '2099-06-10', end: '2099-07-10' },
    ],
    [
      '탭 < 시작이고 끝까지 30일 초과: 끝을 새 시작+30일로 자른다',
      '2099-04-01',
      { start: '2099-04-01', end: '2099-05-01' },
    ],
  ])('%s', (_label, tapped, expected) => {
    expect(pickLengthRange(range, tapped)).toEqual(expected);
  });

  it('PBT — 끝 ≥ 시작·30박 이하, 탭 ≥ 시작이면 시작 유지(끝 = min(탭, 시작+30)), 탭 < 시작이면 시작 = 탭', () => {
    fc.assert(
      fc.property(
        dayArb,
        fc.integer({ min: 0, max: 30 }),
        dayArb,
        (start, nights, tap) => {
          const input = {
            start: fromEpochDay(start),
            end: fromEpochDay(start + nights),
          };
          const result = pickLengthRange(input, fromEpochDay(tap));
          const s = epochDay(result.start);
          const e = epochDay(result.end);

          expect(e).toBeGreaterThanOrEqual(s);
          expect(e - s).toBeLessThanOrEqual(30);
          if (tap >= start) {
            expect(s).toBe(start);
            expect(e).toBe(Math.min(tap, start + 30));
          } else {
            expect(s).toBe(tap);
            expect(e).toBe(Math.min(start + nights, tap + 30));
          }
        }
      )
    );
  });
});

describe('periodLock · periodHint — 기간을 못 바꾸는 이유', () => {
  const trip = (over: Partial<Parameters<typeof periodLock>[0]> = {}) => ({
    status: 'PLANNED' as const,
    startDate: '2099-06-10',
    itineraryGenerating: false,
    ...over,
  });
  const TODAY = '2099-05-20';

  it('시작 전·생성 중 아님·안 끝남이면 열려 있다(null)', () => {
    expect(periodLock(trip(), TODAY)).toBeNull();
  });

  it('시작일 = 오늘은 잠금(여행 중) / 시작일 = 오늘+1 은 열림 — 경계 짝', () => {
    expect(periodLock(trip({ startDate: TODAY }), TODAY)).toBe('started');
    expect(periodLock(trip({ startDate: '2099-05-21' }), TODAY)).toBeNull();
    expect(periodLock(trip({ startDate: '2099-05-19' }), TODAY)).toBe(
      'started'
    );
  });

  it('끝남 > 시작됨 > 생성 중 우선순위', () => {
    expect(periodLock(trip({ status: 'ENDED' }), TODAY)).toBe('ended');
    expect(
      periodLock(
        trip({ status: 'ENDED', startDate: TODAY, itineraryGenerating: true }),
        TODAY
      )
    ).toBe('ended');
    expect(
      periodLock(trip({ startDate: TODAY, itineraryGenerating: true }), TODAY)
    ).toBe('started');
    expect(periodLock(trip({ itineraryGenerating: true }), TODAY)).toBe(
      'generating'
    );
  });

  it('보조문은 이유마다 정확히 그 글자', () => {
    expect(periodHint(null)).toBe(
      '일정은 그대로 두고 날짜만 옮겨요 · 일수는 바꿀 수 없어요'
    );
    expect(periodHint('started')).toBe('여행이 시작돼 기간은 바꿀 수 없어요');
    expect(periodHint('generating')).toBe(
      '일정을 만드는 중이에요. 끝난 뒤 바꿀 수 있어요'
    );
    expect(periodHint('ended')).toBe('끝난 여행은 바꿀 수 없어요');
  });
});

describe('periodConflictCode — 409 의 error.code', () => {
  const axiosError = (status: number, data: unknown): AxiosError =>
    new AxiosError('x', undefined, undefined, undefined, {
      status,
      data,
    } as AxiosResponse);

  it('409 이고 error.code 가 문자열이면 그 코드', () => {
    expect(
      periodConflictCode(
        axiosError(409, { error: { code: 'TRIP_PERIOD_STARTED' } })
      )
    ).toBe('TRIP_PERIOD_STARTED');
    expect(
      periodConflictCode(axiosError(409, { error: { code: 'CONFLICT' } }))
    ).toBe('CONFLICT');
  });

  it.each([
    [
      '409 가 아니면(같은 코드여도)',
      axiosError(500, { error: { code: 'TRIP_PERIOD_STARTED' } }),
    ],
    ['최상위 code(옛 모양)', axiosError(409, { code: 'CONFLICT' })],
    ['본문이 없으면', axiosError(409, undefined)],
    ['코드가 문자열이 아니면', axiosError(409, { error: { code: 7 } })],
    ['axios 오류가 아니면', new Error('boom')],
    ['오류가 아닌 값이면', undefined],
  ])('%s null', (_label, error) => {
    expect(periodConflictCode(error)).toBeNull();
  });
});

describe('isTripChildKey — 그 여행의 자식 조회 키만', () => {
  it.each([
    ['/trips/abc/itinerary', true],
    ['/trips/abc/bases', true],
    ['/trips/abc/must-visits', true],
    ['/trips/abc', false],
    ['/trips/abcd/itinerary', false],
    ['/trips/abcd', false],
    ['/trips', false],
    ['/me/trips/abc/itinerary', false],
  ])('%s → %s', (key, expected) => {
    expect(isTripChildKey('abc', [key])).toBe(expected);
  });

  it('키 첫 원소가 문자열이 아니거나 배열이 비면 거짓, 뒤 원소(파라미터)는 상관없다', () => {
    expect(isTripChildKey('abc', [])).toBe(false);
    expect(isTripChildKey('abc', [42])).toBe(false);
    expect(isTripChildKey('abc', ['/trips/abc/records', { limit: 10 }])).toBe(
      true
    );
  });

  it('PBT — `/trips/{id}/{뒤}` 는 참, 단건 `/trips/{id}` 와 접두가 같은 다른 id 는 거짓', () => {
    const id = fc.stringMatching(/^[a-z0-9-]{1,12}$/);
    const tail = fc.stringMatching(/^[a-z-]{1,10}$/);
    fc.assert(
      fc.property(id, tail, (tripId, suffix) => {
        expect(isTripChildKey(tripId, [`/trips/${tripId}/${suffix}`])).toBe(
          true
        );
        expect(isTripChildKey(tripId, [`/trips/${tripId}`])).toBe(false);
        expect(isTripChildKey(tripId, [`/trips/${tripId}x/${suffix}`])).toBe(
          false
        );
      })
    );
  });
});

describe('fitDestinationNights — 새 박수에 박수 합을 맞춘다', () => {
  const place = (seq: number, nights: number): TripDestination => ({
    seq,
    region: `지역${seq}`,
    nights,
    regionCode: `${seq}0000`,
  });
  const sum = (list: readonly TripDestination[]) =>
    list.reduce((acc, one) => acc + one.nights, 0);

  it('늘리면 마지막(seq 최대) 여행지에만 차이를 더한다', () => {
    const result = fitDestinationNights([place(1, 2), place(2, 1)], 3, 10);

    expect(result.map((one) => one.nights)).toEqual([2, 8]);
    expect(result[0]).toEqual(place(1, 2));
  });

  it('줄이면 마지막부터 0 까지 깎고 앞으로 간다(0박 여행지가 남을 수 있다)', () => {
    expect(
      fitDestinationNights([place(1, 2), place(2, 1)], 3, 2).map(
        (o) => o.nights
      )
    ).toEqual([2, 0]);
    expect(
      fitDestinationNights([place(1, 2), place(2, 1)], 3, 1).map(
        (o) => o.nights
      )
    ).toEqual([1, 0]);
    expect(
      fitDestinationNights([place(1, 2), place(2, 1)], 3, 0).map(
        (o) => o.nights
      )
    ).toEqual([0, 0]);
  });

  it('그대로면 손대지 않고, 박수 합이 이미 새 박수 이하면 줄여도 안 깎는다(Σ < 옛 박수인 여행)', () => {
    expect(fitDestinationNights([place(1, 2), place(2, 1)], 3, 3)).toEqual([
      place(1, 2),
      place(2, 1),
    ]);
    expect(fitDestinationNights([place(1, 1)], 4, 2)).toEqual([place(1, 1)]);
  });

  it('배열 순서와 seq 가 달라도 "마지막"은 seq 최대이고 순서는 그대로다', () => {
    const result = fitDestinationNights([place(2, 1), place(1, 2)], 3, 5);

    expect(result.map((one) => one.seq)).toEqual([2, 1]);
    expect(result.map((one) => one.nights)).toEqual([3, 2]);
  });

  it('빈 배열은 빈 배열, 입력은 바뀌지 않는다', () => {
    expect(fitDestinationNights([], 3, 1)).toEqual([]);
    const input = Object.freeze([
      Object.freeze(place(1, 2)),
      Object.freeze(place(2, 1)),
    ]);

    expect(() => fitDestinationNights(input, 3, 1)).not.toThrow();
  });

  it('PBT — 박수 합이 새 박수 이하·음수 없음·seq/순서/다른 칸 보존·늘릴 때 마지막만 변함', () => {
    const destinationsArb = fc
      .uniqueArray(fc.integer({ min: 1, max: 9 }), {
        minLength: 1,
        maxLength: 5,
      })
      .chain((seqs) =>
        fc
          .array(fc.integer({ min: 0, max: 6 }), {
            minLength: seqs.length,
            maxLength: seqs.length,
          })
          .map((nights) => seqs.map((seq, i) => place(seq, nights[i])))
      );
    fc.assert(
      fc.property(
        destinationsArb,
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 30 }),
        (destinations, slack, newNights) => {
          // 옛 박수 = 박수 합 이상(INV-U1-14 가 Σ ≤ 기간을 보장한다)
          const oldNights = sum(destinations) + slack;
          const result = fitDestinationNights(
            destinations,
            oldNights,
            newNights
          );

          expect(result).toHaveLength(destinations.length);
          expect(sum(result)).toBeLessThanOrEqual(newNights);
          expect(result.every((one) => one.nights >= 0)).toBe(true);
          result.forEach((one, i) => {
            expect(one.seq).toBe(destinations[i].seq);
            expect(one.region).toBe(destinations[i].region);
            expect(one.regionCode).toBe(destinations[i].regionCode);
          });
          if (newNights > oldNights) {
            const lastSeq = Math.max(...destinations.map((one) => one.seq));
            result.forEach((one, i) => {
              if (one.seq === lastSeq)
                expect(one.nights).toBe(
                  destinations[i].nights + (newNights - oldNights)
                );
              else expect(one.nights).toBe(destinations[i].nights);
            });
          }
        }
      )
    );
  });
});
