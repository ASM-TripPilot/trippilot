import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  Trip,
} from '@/shared/api/index.schemas';

/**
 * 일정(itinerary) 통합 테스트 공용 픽스처(TRIP-1351) — 여행·슬롯·일자·일정 빌더. DraftPage·ItineraryPlanPage 통합 파일의
 * describe 마다 `trip()`/`slot()`/`itinerary()` 를 150~250줄씩 다시 선언하던 자리를 대신한다.
 *
 * **명시 오버라이드 규약(결정 G)**: 빌더는 `Partial` 오버라이드만 받고, 기본값은 아래에 전부 적혀 있다. 케이스가 기본과 다른 점은
 * 호출부가 오버라이드로 적는다 — 암묵 파생(예: `dayCount` 로 일자를 만드는 식)을 빌더에 넣지 않는다. 픽스처 조합으로 라우팅을
 * 우회하던 자리(`isFallback`·`solveMode`·`generationState` 같은 분기 신호)는 그 조합을 오버라이드로 그대로 적어 보존한다
 * (traps-itinerary — 라우팅은 픽스처가 정한다).
 *
 * 모듈 스코프 파일 — `jest.mock` 팩토리 안에서 쓸 필요가 없는 순수 데이터라 JSX 도 없다.
 */

export const TRIP_ID = '11111111-1111-1111-1111-111111111111';
export const DAY1 = '2026-06-10';
export const DAY2 = '2026-06-11';
export const DAY3 = '2026-06-12';

/** 기본 여행 — 제주 3일(DAY1~DAY3), PLANNED. 탭·게이지 칸 개수의 출처는 `days.length` 가 아니라 이 두 날짜다(01b D7). */
export function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 3일',
    startDate: DAY1,
    endDate: DAY3,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
  };
}

/** 기본 슬롯 — 09:30~11:00 비고정·위반 없음, 이름 `장소-{poiId}`, 제주 좌표(지도 center 계산용). */
export function slot(
  poiId: string,
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    nameKo: `장소-${poiId}`,
    lat: 33.458,
    lng: 126.942,
    ...over,
  };
}

export function day(
  date: string,
  slots: ItineraryDaysItemSlotsItem[]
): ItineraryDaysItem {
  return { date, slots };
}

/** 기본 일정 — COMPLETE·FULL_AI·FULLY_AI·PLANNED, 1일차 슬롯 둘(poi-a 09:30, poi-b 13:00~14:00), 폴백 아님. */
export function itinerary(over: Partial<Itinerary> = {}): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    scoringMode: null,
    degradations: [],
    days: [
      day(DAY1, [
        slot('poi-a'),
        slot('poi-b', { startAt: '13:00:00', endAt: '14:00:00' }),
      ]),
    ],
    ...over,
  };
}

/** `dates` 각 날짜에 `slotsFor(date)` 를 채운 일자 목록. */
export function daysOf(
  dates: string[],
  slotsFor: (date: string) => ItineraryDaysItemSlotsItem[]
): ItineraryDaysItem[] {
  return dates.map((date) => day(date, slotsFor(date)));
}

/**
 * 하루치 3슬롯 — 시각 칩·거리 합·고정 슬롯 케이스를 한 픽스처로 잰다(h07 부분 결과·h08 완성 초안 공용).
 *  - poi-b 는 **isFixed=true**(고정)인데도 시각 칩이 떠야 한다(BR-U3-07 개정).
 *  - 첫 슬롯 distanceRange 는 **null**(거점 없는 날)이다. 헤더 합은 커넥터 구간(`slice(1)`)만 더하므로 3.5km(2.1+1.4)다.
 *  - lat/lng 를 실어 셸 지도(map-root)가 마운트되고 DraftPage 가 center 를 계산하게 한다.
 */
export function threeStopSlots(date: string): ItineraryDaysItemSlotsItem[] {
  return [
    slot('poi-a', {
      tags: ['바다', '산책'],
      nameKo: '광안리 해변',
      category: '자연',
      imageUrl: null,
      distanceRange: null,
    }),
    slot('poi-b', {
      startAt: '13:00:00',
      endAt: '14:30:00',
      isFixed: true,
      tags: ['호텔'],
      nameKo: `${date} 숙소`,
      category: '숙소',
      imageUrl: null,
      distanceRange: '2.1km',
      lat: 33.512,
      lng: 126.522,
    }),
    slot('poi-c', {
      startAt: '15:00:00',
      endAt: '16:00:00',
      tags: ['카페'],
      nameKo: '흰여울 마을',
      category: '자연',
      imageUrl: null,
      distanceRange: '1.4km',
      lat: 33.245,
      lng: 126.412,
    }),
  ];
}

/** DAY1~DAY3 중 앞 `count` 일, 각 날 `threeStopSlots`. */
export function threeStopDays(count: number): ItineraryDaysItem[] {
  return daysOf([DAY1, DAY2, DAY3].slice(0, count), threeStopSlots);
}

/** 하루 슬롯 하나(`poi-a` 광안리 해변) — 일차 수만 보는 케이스(생성 중 확인·연타 잠금)용. */
export function oneStopDay(date: string): ItineraryDaysItem {
  return day(date, [
    slot('poi-a', {
      nameKo: '광안리 해변',
      category: '자연',
      imageUrl: null,
      distanceRange: null,
    }),
  ]);
}

/** 제주 여행(3박 4일: DAY1 → 06-13) — ItineraryPlanPage 통합 describe 공용. 헤더 "N박M일" 의 출처가 이 두 날짜다. */
export function planTrip(over: Partial<Trip> = {}): Trip {
  return trip({
    title: '제주 여행',
    endDate: '2026-06-13',
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    ...over,
  });
}

/** 2일·3슬롯 일정(DAY1: poi-a 09:30·poi-b 13:00, DAY2: poi-c 10:00) — status 만 갈아 쓰는 describe 가 많다(기본 PLANNED). */
export function twoDayItinerary(over: Partial<Itinerary> = {}): Itinerary {
  return itinerary({
    days: [
      day(DAY1, [
        slot('poi-a'),
        slot('poi-b', { startAt: '13:00:00', endAt: '14:00:00' }),
      ]),
      day(DAY2, [slot('poi-c', { startAt: '10:00:00', endAt: '11:00:00' })]),
    ],
    ...over,
  });
}

/**
 * 부산 여행 하루 슬롯 빌더(ItineraryPlanPage h14 완성·h16 확정 셸 공용) — 비고정 슬롯. 사진 없는 슬롯(imageUrl null)이라
 * 플레이스홀더 회귀도 겸한다. `openingHoursKnown` 은 케이스가 주입한다(휴관 경고 트리거).
 */
export function busanPoi(
  poiId: string,
  startAt: string,
  endAt: string,
  distanceRange: string | null,
  nameKo: string,
  tags: string[],
  openingHoursKnown?: boolean | null
): ItineraryDaysItemSlotsItem {
  return slot(poiId, {
    startAt,
    endAt,
    tags,
    nameKo,
    category: '자연',
    imageUrl: null,
    distanceRange,
    lat: 35.15,
    lng: 129.11,
    openingHoursKnown,
  });
}

/** 고정 숙소 슬롯 — 단일 시각 21:00(startAt=endAt) + 고정 배지. */
export function busanHotel(
  distanceRange: string | null
): ItineraryDaysItemSlotsItem {
  return slot('poi-hotel', {
    startAt: '21:00:00',
    endAt: '21:00:00',
    isFixed: true,
    nameKo: '해운대 그랜드 호텔',
    category: '숙소',
    imageUrl: null,
    distanceRange,
    lat: 35.16,
    lng: 129.16,
  });
}

/**
 * 비고정 4장 — 광안리 해변(a)·황령산 전망대(b)·부산시립미술관(c)·웨이브온 카페(d). 커넥터 합은 `slice(1)` 이라 첫 슬롯
 * 거리는 안 쓴다. `aTags` 로 첫 슬롯 태그를, `openingHoursKnownC` 로 c 의 휴관 신호를 케이스가 정한다.
 */
export function busanFourPois(
  distances: (string | null)[],
  {
    aTags = ['바다', '산책'],
    openingHoursKnownC,
  }: { aTags?: string[]; openingHoursKnownC?: boolean | null } = {}
): ItineraryDaysItemSlotsItem[] {
  return [
    busanPoi(
      'poi-a',
      '10:00:00',
      '11:00:00',
      distances[0],
      '광안리 해변',
      aTags
    ),
    busanPoi('poi-b', '11:30:00', '12:10:00', distances[1], '황령산 전망대', [
      '전망',
    ]),
    busanPoi(
      'poi-c',
      '13:00:00',
      '14:30:00',
      distances[2],
      '부산시립미술관',
      ['미술'],
      openingHoursKnownC
    ),
    busanPoi('poi-d', '14:30:00', '15:15:00', distances[3], '웨이브온 카페', [
      '감성',
    ]),
  ];
}

/** 부산 4박 여행(DAY1 → 06-13). */
export function busanTrip(over: Partial<Trip> = {}): Trip {
  return trip({
    title: '부산 여행',
    endDate: '2026-06-13',
    destinations: [{ seq: 1, region: '부산', nights: 3 }],
    ...over,
  });
}
