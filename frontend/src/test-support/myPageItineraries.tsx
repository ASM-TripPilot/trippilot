import type { Trip } from '@/shared/api/index.schemas';
import {
  NO_ITINERARY,
  itineraryCols,
  type ItineraryCols,
} from '@/test-support/tripItineraryCols';

/**
 * TRIP-1123 · l03 마이페이지·j07 기록 캘린더 테스트 공용 — 여행 한 건(`Trip`) 만들기.
 *
 * TRIP-1677 부터 일정 상태는 여행 목록(`GET /trips`)의 네 칸(`itinerary*`)에 실려 오므로, 예전의 "여행별 일정 조회 대본"
 * (`itin`·`ItinScript`·`scriptItineraryOptions`)은 걷었다. 여행이 어떤 일정 상태인지는 `myPageTrip(...)` 의 `over` 에
 * `CONFIRMED_COLS`/`PLANNED_COLS` 를 펼쳐 넣어 정한다. 기본값은 일정 없음(`NO_ITINERARY` — 옛 404).
 *
 * `renderWithQueryClient`·`settle`·`newTestQueryClient` 는 `@/test-support/queryRender` 에 있다(TRIP-1350).
 *
 * 시계는 흉내 내지 않는다: 기간 안 = 2020~2099, 과거 = 2026-06, 미래 = 2099-06(실제 오늘이 그 사이인 한 결정론).
 */

export const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' };
export const PAST = { startDate: '2026-06-10', endDate: '2026-06-13' };
export const FUTURE = { startDate: '2099-06-10', endDate: '2099-06-13' };

const BASE_ITINERARY = {
  generationState: 'COMPLETE',
  generationMode: 'FULLY_AI',
  generationSessionId: null,
} as const;

/** 확정 일정이 있는 여행의 네 칸(`CONFIRMED` · 완료 · 세션 없음). */
export const CONFIRMED_COLS: ItineraryCols = itineraryCols({
  ...BASE_ITINERARY,
  status: 'CONFIRMED',
});
/** 확정 전 초안 일정이 있는 여행의 네 칸(`PLANNED` · 완료 · 세션 없음). */
export const PLANNED_COLS: ItineraryCols = itineraryCols({
  ...BASE_ITINERARY,
  status: 'PLANNED',
});

/** 최소 Trip — 서버 `status` 는 일부러 받아 둔다: 판정이 그 값을 쓰면 테스트가 잡도록. 일정 네 칸 기본 = 일정 없음. */
export function myPageTrip(
  tripId: string,
  period: { startDate: string; endDate: string },
  over: Partial<Trip> = {}
): Trip {
  return {
    tripId,
    title: `${tripId} 여행`,
    ...period,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...NO_ITINERARY,
    ...over,
  };
}
