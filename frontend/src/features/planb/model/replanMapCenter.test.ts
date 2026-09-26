import fc from 'fast-check';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import {
  deriveReplanMapAnchor,
  REPLAN_MAP_FALLBACK_CENTER,
} from './replanMapCenter';

/**
 * TRIP-979 B · AC-B1 · Seed Q5 — 재계획 지도 중심을 "이 여행"에서 고르는 순수 함수.
 *
 * 무엇을 보장하나(초심자용): 부산 상수 대신 아래 순서로 지도 중심을 고른다.
 *   ① 세션 출발 좌표(위도·경도 **둘 다** 있을 때) → ② 기준 날짜의 첫 좌표 슬롯
 *   → ③ 일정 전체(날짜 배열 순서)의 첫 좌표 슬롯 → ④ 서울시청 상수(LiveHubView 선례 값).
 * 좌표가 null 인 슬롯은 건너뛴다. 슬롯에서 골랐으면 그 슬롯 이름(`placeName`)을 함께 돌려줘
 * 위치 입력 화면이 `{이름} 인근` 라벨을 만든다. 세션 좌표·상수 폴백이면 이름은 null 이다.
 *
 * 3동작: 준비(일정 픽스처) → 실행(deriveReplanMapAnchor) → 단언(center·placeName).
 *
 * PBT(fast-check): `fc.assert(fc.property(생성기, 검사))` 는 생성기가 만든 입력 수십~수백 개로
 * 검사 함수를 돌려, 하나라도 false/throw 면 가장 작은 반례를 찾아 보여 준다.
 */

const base: Omit<
  ItineraryDaysItemSlotsItem,
  'poiId' | 'nameKo' | 'lat' | 'lng'
> = {
  startAt: '10:00:00',
  endAt: '11:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  tags: [],
};

function slot(
  poiId: string,
  nameKo: string | null,
  coords: { lat: number | null; lng: number | null }
): ItineraryDaysItemSlotsItem {
  return { ...base, poiId, nameKo, lat: coords.lat, lng: coords.lng };
}

const NONE = { lat: null, lng: null };
const NAMSAN = { lat: 37.5512, lng: 126.9882 };
const GYEONGBOK = { lat: 37.5796, lng: 126.977 };
const GWANGJANG = { lat: 37.57, lng: 126.9996 };

// 서울 3일 일정 — 6/11 첫 슬롯은 좌표가 없다(건너뛰어야 경복궁이 나온다).
const SEOUL_DAYS: ItineraryDaysItem[] = [
  { date: '2026-06-10', slots: [slot('p0', '남산서울타워', NAMSAN)] },
  {
    date: '2026-06-11',
    slots: [
      slot('p1', '좌표 없는 곳', NONE),
      slot('p2', '경복궁', GYEONGBOK),
      slot('p3', '광장시장', GWANGJANG),
    ],
  },
  { date: '2026-06-12', slots: [slot('p9', '좌표 없는 곳2', NONE)] },
];

describe('🔴 AC-B1 · 우선순위 예시', () => {
  it('서울시청 상수는 37.5665/126.978 이다(부산 좌표가 아니다)', () => {
    expect(REPLAN_MAP_FALLBACK_CENTER).toEqual({ lat: 37.5665, lng: 126.978 });
  });

  it('① 세션 좌표가 둘 다 있으면 일정보다 먼저 쓰고, 이름은 null', () => {
    const anchor = deriveReplanMapAnchor({
      days: SEOUL_DAYS,
      preferredDate: '2026-06-11',
      origin: { lat: 37.4979, lng: 127.0276 },
    });

    expect(anchor).toEqual({
      center: { lat: 37.4979, lng: 127.0276 },
      placeName: null,
    });
  });

  it('② 기준 날짜의 첫 **좌표** 슬롯 — 좌표 없는 앞 슬롯은 건너뛴다', () => {
    const anchor = deriveReplanMapAnchor({
      days: SEOUL_DAYS,
      preferredDate: '2026-06-11',
      origin: { lat: null, lng: null },
    });

    expect(anchor).toEqual({ center: GYEONGBOK, placeName: '경복궁' });
  });

  it('세션 좌표가 반쪽(위도만)이면 없는 것으로 보고 ②로 내려간다', () => {
    const anchor = deriveReplanMapAnchor({
      days: SEOUL_DAYS,
      preferredDate: '2026-06-11',
      origin: { lat: 37.4979, lng: null },
    });

    expect(anchor.center).toEqual(GYEONGBOK);
  });

  it('③ 기준 날짜가 일정에 없으면 일정 전체의 첫 좌표 슬롯', () => {
    const anchor = deriveReplanMapAnchor({
      days: SEOUL_DAYS,
      preferredDate: '2026-06-20',
    });

    expect(anchor).toEqual({ center: NAMSAN, placeName: '남산서울타워' });
  });

  it('③ 기준 날짜에 좌표 슬롯이 하나도 없으면 일정 전체의 첫 좌표 슬롯', () => {
    const anchor = deriveReplanMapAnchor({
      days: SEOUL_DAYS,
      preferredDate: '2026-06-12',
    });

    expect(anchor).toEqual({ center: NAMSAN, placeName: '남산서울타워' });
  });

  it('기준 날짜를 안 주면 일정 전체의 첫 좌표 슬롯', () => {
    expect(deriveReplanMapAnchor({ days: SEOUL_DAYS }).center).toEqual(NAMSAN);
  });

  it('이름이 없는 좌표 슬롯이면 좌표는 쓰고 이름은 null', () => {
    const anchor = deriveReplanMapAnchor({
      days: [{ date: '2026-06-10', slots: [slot('p0', null, NAMSAN)] }],
      preferredDate: '2026-06-10',
    });

    expect(anchor).toEqual({ center: NAMSAN, placeName: null });
  });

  it.each([
    ['일정 미도착(undefined)', undefined],
    ['빈 일정', []],
    ['좌표 슬롯 0개', [{ date: '2026-06-10', slots: [slot('p', 'x', NONE)] }]],
  ])('④ %s 이면 서울시청 상수, 이름 null', (_label, days) => {
    const anchor = deriveReplanMapAnchor({
      days,
      preferredDate: '2026-06-10',
    });

    expect(anchor).toEqual({
      center: REPLAN_MAP_FALLBACK_CENTER,
      placeName: null,
    });
  });
});

// ── PBT ────────────────────────────────────────────────────────────────────────

const coordArb = fc.record({
  lat: fc.double({ min: 33, max: 39, noNaN: true }),
  lng: fc.double({ min: 124, max: 132, noNaN: true }),
});
const maybeCoordArb = fc.oneof(
  coordArb,
  fc.constant(NONE),
  // 반쪽 좌표도 "좌표 없음"이다.
  coordArb.map((c) => ({ lat: c.lat, lng: null })),
  coordArb.map((c) => ({ lat: null, lng: c.lng }))
);
const slotArb = fc
  .record({
    poiId: fc.string({ minLength: 1, maxLength: 4 }),
    nameKo: fc.option(fc.string({ minLength: 1, maxLength: 6 }), {
      nil: null,
    }),
    coords: maybeCoordArb,
  })
  .map(({ poiId, nameKo, coords }) => slot(poiId, nameKo, coords));
const DATES = ['2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13'];
const daysArb = fc
  .array(fc.array(slotArb, { maxLength: 4 }), { maxLength: 4 })
  .map((perDay) =>
    perDay.map((slots, i) => ({ date: DATES[i], slots }) as ItineraryDaysItem)
  );

const hasCoords = (s: ItineraryDaysItemSlotsItem) =>
  s.lat !== null &&
  s.lat !== undefined &&
  s.lng !== null &&
  s.lng !== undefined;

describe('🔴 AC-B1 · 성질(PBT)', () => {
  it('세션 좌표가 없고 좌표 슬롯이 하나라도 있으면, 결과는 반드시 그 좌표 슬롯들 중 하나의 좌표·이름이다', () => {
    fc.assert(
      fc.property(daysArb, fc.constantFrom(...DATES), (days, preferredDate) => {
        const coordSlots = days.flatMap((d) => d.slots).filter(hasCoords);
        fc.pre(coordSlots.length > 0);

        const anchor = deriveReplanMapAnchor({ days, preferredDate });

        return coordSlots.some(
          (s) =>
            s.lat === anchor.center.lat &&
            s.lng === anchor.center.lng &&
            (s.nameKo ?? null) === anchor.placeName
        );
      })
    );
  });

  it('기준 날짜에 좌표 슬롯이 있으면, 결과는 그날의 **첫** 좌표 슬롯이다', () => {
    fc.assert(
      fc.property(daysArb, fc.constantFrom(...DATES), (days, preferredDate) => {
        const first = days
          .find((d) => d.date === preferredDate)
          ?.slots.find(hasCoords);
        fc.pre(first !== undefined);

        const anchor = deriveReplanMapAnchor({ days, preferredDate });

        expect(anchor.center).toEqual({ lat: first?.lat, lng: first?.lng });
      })
    );
  });

  it('세션 좌표가 둘 다 있으면 일정과 무관하게 그 좌표다', () => {
    fc.assert(
      fc.property(daysArb, coordArb, (days, origin) => {
        const anchor = deriveReplanMapAnchor({
          days,
          preferredDate: DATES[1],
          origin,
        });

        expect(anchor).toEqual({ center: origin, placeName: null });
      })
    );
  });

  it('좌표 슬롯이 하나도 없고 세션 좌표도 없으면 언제나 서울시청 상수다', () => {
    fc.assert(
      fc.property(daysArb, fc.constantFrom(...DATES), (days, preferredDate) => {
        fc.pre(!days.some((d) => d.slots.some(hasCoords)));

        const anchor = deriveReplanMapAnchor({ days, preferredDate });

        expect(anchor).toEqual({
          center: REPLAN_MAP_FALLBACK_CENTER,
          placeName: null,
        });
      })
    );
  });
});
