import type { Trip } from '@/shared/api/generated/schemas';

import {
  buildPastTripCards,
  formatTripDateRange,
  markedDaysOfMonth,
  nightsLabel,
} from './recordsCalendar';

/**
 * TRIP-575 · features/record/model/recordsCalendar — j07 캘린더 도메인 순수 함수.
 *
 * *(개념)* `useGetTrips()`가 준 `Trip[]`을 화면 재료로 접는 계산 3종:
 *  1) 그 달에 마킹할 날 집합(복수 여행 모두, BR-U5-49),
 *  2) 지난 여행 목록(status ENDED 또는 endDate<오늘, 최신순, US-REC-14),
 *  3) 카드 라벨(날짜범위 + 박수).
 * 시계·네트워크·화면을 안 건드린다 — 오늘 날짜는 문자열로 주입받는다.
 *
 * ★[[반쪽 방어]](571~574·570 계보): trips=null·원소 null·startDate/endDate null·빈 배열에도
 * 던지지 않는다. 결측은 마킹에서 배제, 라벨은 null로 정직 degrade(가짜값 금지).
 *
 * 3동작 뼈대: 준비=Trip 픽스처 → 실행=순수 함수 → 단언=정확 값.
 */

/** required 10필드를 다 채운 최소 Trip 팩토리 — 테스트가 보는 축(dates·status·title)만 덮어쓴다. */
function trip(
  overrides: Pick<Trip, 'tripId' | 'title' | 'startDate' | 'endDate' | 'status'>
): Trip {
  return {
    party: 2,
    destinations: [],
    preferenceSnapshot: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as unknown as Trip;
}

describe('markedDaysOfMonth — 그 달에서 여행 기간에 걸친 날(복수 여행 모두)', () => {
  it('한 달 안 여러 여행의 날을 모두 마킹한다(AC-2)', () => {
    // 준비: 6월에 두 여행(10~12, 20~21).
    const trips = [
      trip({
        tripId: 'a',
        title: '부산',
        startDate: '2026-06-10',
        endDate: '2026-06-12',
        status: 'ENDED',
      }),
      trip({
        tripId: 'b',
        title: '제주',
        startDate: '2026-06-20',
        endDate: '2026-06-21',
        status: 'PLANNED',
      }),
    ];

    // 실행/단언: 두 여행의 날이 모두, 정렬·유일하게 나온다.
    expect(markedDaysOfMonth(trips, '2026-06')).toEqual([
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-20',
      '2026-06-21',
    ]);
  });

  it('월 경계를 넘는 여행은 그 달에 걸친 부분만 마킹한다', () => {
    const trips = [
      trip({
        tripId: 'c',
        title: '경계',
        startDate: '2026-05-30',
        endDate: '2026-06-02',
        status: 'ENDED',
      }),
    ];
    // 6월 그리드엔 6/1·6/2만, 5월 그리드엔 5/30·5/31만.
    expect(markedDaysOfMonth(trips, '2026-06')).toEqual([
      '2026-06-01',
      '2026-06-02',
    ]);
    expect(markedDaysOfMonth(trips, '2026-05')).toEqual([
      '2026-05-30',
      '2026-05-31',
    ]);
  });

  it('겹치는 여행은 같은 날을 중복 없이 한 번만 마킹한다', () => {
    const trips = [
      trip({
        tripId: 'a',
        title: 'A',
        startDate: '2026-06-10',
        endDate: '2026-06-12',
        status: 'ENDED',
      }),
      trip({
        tripId: 'b',
        title: 'B',
        startDate: '2026-06-11',
        endDate: '2026-06-13',
        status: 'ENDED',
      }),
    ];
    expect(markedDaysOfMonth(trips, '2026-06')).toEqual([
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
    ]);
  });

  it('★반쪽 방어: null·결측 원소·결측 dates에도 안 던지고 정상분만 반영한다', () => {
    // 준비: null 배열 · 정상 여행에 섞인 null 원소와 dates 결측 원소.
    const dirty = [
      null,
      trip({
        tripId: 'ok',
        title: '정상',
        startDate: '2026-06-05',
        endDate: '2026-06-05',
        status: 'ENDED',
      }),
      {
        tripId: 'x',
        title: 'x',
        startDate: null,
        endDate: null,
        status: 'ENDED',
      },
    ] as unknown as Trip[];

    // 실행/단언: 안 던지고, 결측은 배제, 정상 여행의 하루만 나온다.
    expect(markedDaysOfMonth(null as unknown as Trip[], '2026-06')).toEqual([]);
    expect(markedDaysOfMonth([], '2026-06')).toEqual([]);
    expect(markedDaysOfMonth(dirty, '2026-06')).toEqual(['2026-06-05']);
  });
});

describe('buildPastTripCards — 지난 여행만(ENDED 또는 endDate<오늘), 최신순', () => {
  it('미래 여행을 빼고 endDate 내림차순으로 카드를 만든다(AC-3)', () => {
    const today = '2026-09-01';
    const trips = [
      trip({
        tripId: 'A',
        title: 'A',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        status: 'PLANNED',
      }), // endDate<오늘 → 과거
      trip({
        tripId: 'B',
        title: 'B',
        startDate: '2026-08-18',
        endDate: '2026-08-20',
        status: 'ENDED',
      }), // ENDED → 과거
      trip({
        tripId: 'C',
        title: 'C',
        startDate: '2026-12-08',
        endDate: '2026-12-10',
        status: 'PLANNED',
      }), // 미래 → 제외
      trip({
        tripId: 'D',
        title: 'D',
        startDate: '2026-09-29',
        endDate: '2026-10-01',
        status: 'ENDED',
      }), // ENDED(endDate>오늘이어도 status로 과거)
    ];

    const cards = buildPastTripCards(trips, today);

    // C는 빠지고, endDate 최신순 [D, B, A].
    expect(cards.map((c) => c.tripId)).toEqual(['D', 'B', 'A']);
    expect(cards[0]).toMatchObject({ tripId: 'D', title: 'D' });
  });

  it('★반쪽 방어: null·원소 null·ENDED+결측 dates에도 안 던지고 라벨을 null로 접는다', () => {
    const today = '2026-09-01';
    const dirty = [
      null,
      {
        tripId: 'z',
        title: '기록만',
        startDate: null,
        endDate: null,
        status: 'ENDED',
      },
    ] as unknown as Trip[];

    expect(buildPastTripCards(null as unknown as Trip[], today)).toEqual([]);

    const cards = buildPastTripCards(dirty, today);
    // ENDED라 포함되지만, dates가 없어 라벨은 정직하게 null.
    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual({
      tripId: 'z',
      title: '기록만',
      dateRangeLabel: null,
      nightsLabel: null,
    });
  });
});

describe('formatTripDateRange — 카드 날짜범위 라벨', () => {
  it('같은 달/같은 해/다른 해를 각각 접고, 못 만들면 null이다', () => {
    // 같은 달: 뒤쪽 연·월 생략.
    expect(formatTripDateRange('2026-05-01', '2026-05-03')).toBe(
      '2026.5.1–5.3'
    );
    // 같은 해 다른 달: 뒤쪽 연만 생략.
    expect(formatTripDateRange('2026-05-30', '2026-06-02')).toBe(
      '2026.5.30–6.2'
    );
    // 다른 해: 양쪽 다 표기.
    expect(formatTripDateRange('2026-12-30', '2027-01-02')).toBe(
      '2026.12.30–2027.1.2'
    );
    // 반쪽: null이면 null.
    expect(formatTripDateRange(null, '2026-05-03')).toBeNull();
    expect(formatTripDateRange('2026-05-01', null)).toBeNull();
  });
});

describe('nightsLabel — 박수 라벨(가짜 0 금지)', () => {
  it('양수 박수만 라벨을 만들고, 같은날·역전·null은 null이다', () => {
    expect(nightsLabel('2026-05-01', '2026-05-03')).toBe('2박 3일');
    expect(nightsLabel('2026-05-01', '2026-05-02')).toBe('1박 2일');
    // 같은날(0박)·역전은 가짜 "0박"을 만들지 않고 null.
    expect(nightsLabel('2026-05-01', '2026-05-01')).toBeNull();
    expect(nightsLabel('2026-05-03', '2026-05-01')).toBeNull();
    expect(nightsLabel(null, '2026-05-03')).toBeNull();
  });
});
