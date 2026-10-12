import { http, HttpResponse } from 'msw';

import type { Itinerary, Trip, VisitCheck } from '@/shared/api/index.schemas';

/**
 * i01 허브(`LiveItineraryPage`) 응답 픽스처 — `LiveItineraryPage.integration` 의 관점(describe)마다 복사돼 있던
 * 일정 봉투·슬롯·여행·방문 빌더를 한 곳에. 모양은 스키마 필수 최소값이고, 관점마다 다른 값은 `over` 로 덮는다.
 *
 * 기본값의 출처: 허브 통합 테스트의 가장 흔한 값(여행 `trip-1` · 오늘 `2026-08-20` · 3박 중 2박).
 * 시각 문자열의 `Z` 유무가 곧 "기기 시간대로 읽히는가"이므로 빌더는 인자를 가공하지 않는다.
 */

export const LIVE_TRIP_ID = 'trip-1';
export const LIVE_TODAY = '2026-08-20';

/** 일정 한 칸 — 기본은 시작=끝 시각. 끝 시각·카테고리·영업시간 등은 `over` 로 얹는다. */
export function liveSlot(
  poiId: string,
  nameKo: string,
  startAt: string,
  over: Record<string, unknown> = {}
) {
  return {
    poiId,
    startAt,
    endAt: startAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo,
    distanceRange: null,
    openingHours: null,
    tags: [] as string[],
    ...over,
  };
}

/** `GET /trips/{id}/itinerary` 봉투 — 진행 중(PLANNED) 일정. `days` 만 관점이 정한다. */
export function liveItinerary(
  days: { date: string; slots: unknown[] }[],
  tripId = LIVE_TRIP_ID
): Itinerary {
  return {
    itineraryId: 'it1',
    tripId,
    status: 'PLANNED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days,
  } as unknown as Itinerary;
}

/** `GET /trips/{id}` — 기본 3일(오늘~+2) · 부산 2박. 기간이 다른 관점은 `over` 로. */
export function liveTrip(over: Record<string, unknown> = {}) {
  return {
    tripId: LIVE_TRIP_ID,
    title: '부산 여행',
    startDate: LIVE_TODAY,
    endDate: '2026-08-22',
    party: 2,
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  } as unknown as Trip;
}

/** 방문 기록 — 세 시각 null(미방문)에서 시작해 `over` 로 상태를 만든다. */
export function liveVisit(
  over: Partial<VisitCheck> & { poiId: string }
): VisitCheck {
  return {
    visitCheckId: `v-${over.poiId}`,
    slotKey: `${LIVE_TODAY}#${over.poiId}`,
    arrivedAt: null,
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: '2026-08-20T05:00:05Z',
    ...over,
  };
}

const BASE = 'http://localhost:8080/api/v1';

/**
 * 허브가 마운트에 쏘는 GET 4종(여행·일정·그날 방문·트리거) — `onUnhandledRequest: 'error'` 라 하나라도 빠지면 크래시한다.
 * `visits` 는 함수로 주면 요청 시점에 평가된다(테스트 도중 서버 상태가 바뀌는 관점용).
 */
export function liveHubHandlers({
  itinerary,
  trip = liveTrip(),
  visits = [],
  triggers = { triggers: [] },
}: {
  itinerary: Itinerary;
  trip?: Trip;
  visits?: VisitCheck[] | (() => VisitCheck[]);
  triggers?: Record<string, unknown>;
}) {
  return [
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip)),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary)
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({
        visits: typeof visits === 'function' ? visits() : visits,
      })
    ),
    http.get(`${BASE}/trips/:tripId/triggers`, () =>
      HttpResponse.json(triggers)
    ),
  ];
}
