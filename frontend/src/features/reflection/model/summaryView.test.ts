import fc from 'fast-check';

import type {
  DayHighlight,
  TripSummary,
  TripSummaryEnvelope,
  TripSummaryStats,
} from '@/shared/api/generated/schemas';

import {
  daySubtitle,
  distanceSourceLabel,
  resolveSummaryView,
  shareEnabled,
  toOrderedVisitList,
} from './summaryView';

/**
 * TRIP-572 · j04 여행 요약 — 화면 분기·공유 게이트·방문 평탄화의 **판정 단일 출처**.
 * 화면이 자체 폴백/분기를 만들지 못하게 순수 함수로 뽑아 진리표·속성으로 잠근다(571 선례 계승).
 *
 * 무엇을 보장하나:
 *  - AC-5(BR-U5-48): `shareEnabled` 는 오직 `ready` 로만 판정한다 — `summary` 유무가 흔들 수 없다.
 *  - AC-2(BR-U5-39): 지도↔목록 분기는 `hasLocationData` 하나에만 걸린다.
 *  - toOrderedVisitList: places 를 일자 넘어 전역 번호 1..N 으로 평탄화하되 입력 순서를 보존한다.
 *  - AC-3(BR-U5-43): distanceSource 라벨(근사/경로)은 고정 매핑이다(1차는 늘 VISIT_LINE="근사").
 *  - daySubtitle: places 만으로 파생한다 — Figma 테마 문구("바다와 골목")를 발명하지 않는다(BR-U5-31).
 *
 * (개념) **PBT**: 예제 대신 "어떤 입력에도 성립할 성질"을 적으면 fast-check 가 임의 입력 수백 개로
 *   반례를 찾는다. `fc.assert(fc.property(...))` = 반례가 있으면 throw(CI 차단, 571 reflectionFallback 동형).
 *   3동작: 준비=임의/특정 입력 → 실행=순수 함수 호출 → 단언=불변식/진리값.
 */

function stats(over: Partial<TripSummaryStats> = {}): TripSummaryStats {
  return {
    totalVisits: 12,
    totalDistanceKm: 38,
    distanceSource: 'VISIT_LINE',
    totalPhotos: 24,
    hasLocationData: true,
    ...over,
  };
}

function summary(over: Partial<TripSummary> = {}): TripSummary {
  return {
    narrative: '3일간의 부산 여행이었어요.',
    highlights: [],
    stats: stats(),
    source: 'RULE',
    generatedAt: '2026-06-13T09:00:00Z',
    ...over,
  };
}

const day = (
  dayOrder: number,
  places: string[],
  visitCount = places.length
): DayHighlight => ({
  date: `2026-06-1${dayOrder}`,
  dayOrder,
  visitCount,
  places,
});

describe('AC-5 · shareEnabled — 오직 ready 로만 판정한다 (BR-U5-48)', () => {
  it('ready:true 면 활성(summary 유무 무관)', () => {
    expect(shareEnabled({ ready: true, summary: summary() })).toBe(true);
    // summary:null 이어도 ready 만 본다 — summary 로 재판정하지 않는다.
    expect(shareEnabled({ ready: true, summary: null })).toBe(true);
  });

  it('ready:false 면 비활성(summary 가 있어도)', () => {
    expect(shareEnabled({ ready: false })).toBe(false);
    expect(shareEnabled({ ready: false, summary: null })).toBe(false);
    // ★교차 — summary 가 있어도 ready:false 면 false(summary 가 판정을 흔들지 못한다).
    expect(
      shareEnabled({ ready: false, summary: summary() } as TripSummaryEnvelope)
    ).toBe(false);
  });
});

describe('AC-2 · resolveSummaryView — hasLocationData 가 유일 신호 (BR-U5-39)', () => {
  it('hasLocationData:true → MAP', () => {
    expect(resolveSummaryView(stats({ hasLocationData: true }))).toBe('MAP');
  });

  it('hasLocationData:false → VISIT_LIST', () => {
    expect(resolveSummaryView(stats({ hasLocationData: false }))).toBe(
      'VISIT_LIST'
    );
  });
});

describe('toOrderedVisitList — 일자 넘어 전역 번호로 평탄화', () => {
  it('error 프레임 실측: Day 경계를 넘어 ①②③④ 로 이어진다', () => {
    const highlights = [
      day(1, ['광안리 해변', '감천문화마을']),
      day(2, ['해운대 해변']),
      day(3, ['전포 카페거리']),
    ];

    expect(toOrderedVisitList(highlights)).toEqual([
      { order: 1, dayLabel: 'Day1', place: '광안리 해변' },
      { order: 2, dayLabel: 'Day1', place: '감천문화마을' },
      { order: 3, dayLabel: 'Day2', place: '해운대 해변' },
      { order: 4, dayLabel: 'Day3', place: '전포 카페거리' },
    ]);
  });

  it('탐지기 자가검사 — 빈 입력은 빈 배열(단언이 공허하지 않다)', () => {
    expect(toOrderedVisitList([])).toEqual([]);
  });

  it('PBT: 어떤 하이라이트 배열에도 place 순서가 보존되고 번호가 1..N 연속이다', () => {
    const dayArb = fc.record({
      dayOrder: fc.integer({ min: 1, max: 9 }),
      visitCount: fc.nat({ max: 9 }),
      date: fc.constant('2026-06-11'),
      places: fc.array(fc.string({ minLength: 1 }), { maxLength: 5 }),
    });

    fc.assert(
      fc.property(fc.array(dayArb, { maxLength: 6 }), (highlights) => {
        const out = toOrderedVisitList(highlights as DayHighlight[]);

        // ① 입력 순서 보존 — 일자 순서대로, 일자 안에서도 places 순서 그대로 평탄화.
        const flatPlaces = highlights.flatMap((h) => h.places);
        expect(out.map((v) => v.place)).toEqual(flatPlaces);

        // ② 번호 1..N 연속(빠짐·중복·역전 없음).
        expect(out.map((v) => v.order)).toEqual(
          flatPlaces.map((_, i) => i + 1)
        );
      })
    );
  });
});

describe('AC-3 · distanceSourceLabel — 근사/경로 고정 매핑 (BR-U5-43)', () => {
  it.each([
    ['VISIT_LINE', '근사'],
    ['ROUTE', '경로'],
  ] as const)('%s → %s', (source, label) => {
    expect(distanceSourceLabel(source)).toBe(label);
  });
});

describe('daySubtitle — places 만으로 파생(테마 발명 금지)', () => {
  it('2곳 이상이면 첫→마지막 이름을 잇는다', () => {
    expect(daySubtitle(['광안리 해변', '감천문화마을', '전포 카페거리'])).toBe(
      '광안리 해변→전포 카페거리'
    );
  });

  it('1곳이면 그 이름만', () => {
    expect(daySubtitle(['해운대 해변'])).toBe('해운대 해변');
  });

  it('0곳이면 빈 문자열(발명하지 않는다)', () => {
    expect(daySubtitle([])).toBe('');
  });
});
