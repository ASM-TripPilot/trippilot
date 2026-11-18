import { QueryObserver, type QueryClient } from '@tanstack/react-query';

import { getGetTripsQueryOptions } from '@/shared/api/index.hooks';
import type { Itinerary, Trip } from '@/shared/api/index.schemas';

/**
 * TRIP-1677 · `GET /trips` 목록이 각 여행에 싣는 일정 상태 네 칸의 테스트 도우미.
 *
 * 서버(`TripDtos.kt`)가 일정 조회 응답에서 이렇게 옮겨 담는다 — 테스트 픽스처도 같은 규칙으로 만들어야 "목록 칸 = 일정 조회 값" 이
 * 거짓으로 어긋나지 않는다: `status`→`itineraryStatus` · `generationState`→`itineraryGenerationState` ·
 * `generationMode`→`itineraryGenerationMode` · `generationSessionId != null`→`itineraryGenerating`. 일정이 없으면 null/false.
 */
export type ItineraryCols = Pick<
  Trip,
  | 'itineraryStatus'
  | 'itineraryGenerationState'
  | 'itineraryGenerationMode'
  | 'itineraryGenerating'
>;

/** 일정이 없는 여행(첫 생성 전·404 와 같은 뜻). */
export const NO_ITINERARY: ItineraryCols = {
  itineraryStatus: null,
  itineraryGenerationState: null,
  itineraryGenerationMode: null,
  itineraryGenerating: false,
};

/** 일정 조회 응답(또는 같은 모양의 픽스처) 하나를 목록 네 칸으로 옮긴다 — 서버와 같은 규칙. */
export function itineraryCols(
  itinerary: Pick<
    Itinerary,
    'status' | 'generationState' | 'generationMode' | 'generationSessionId'
  >
): ItineraryCols {
  return {
    itineraryStatus: itinerary.status,
    itineraryGenerationState: itinerary.generationState,
    itineraryGenerationMode: itinerary.generationMode,
    itineraryGenerating: itinerary.generationSessionId != null,
  };
}

/**
 * `GET /trips` 쿼리에 관찰자를 하나 붙인다(React 없이) — 무효화가 "다시 받기"로 이어지는지 요청 수로 보려면 그 쿼리가 *활성*이어야 한다
 * (화면 밖 훅 테스트·mutation 테스트는 목록 관찰자가 없다). 돌려주는 함수가 관찰자를 뗀다.
 */
export function watchTripsList(client: QueryClient): () => void {
  const observer = new QueryObserver(client, getGetTripsQueryOptions());
  return observer.subscribe(() => {});
}

/**
 * 요청 로그(`createRequestLog(server).all()` 의 `METHOD /경로` 문자열들)에서 세는 도우미.
 * ⚠️ `log.hitsFor('GET', '/trips')` 는 부분 문자열이라 `/trips/x/itinerary` 까지 센다 — 목록 요청은 정확 일치로 센다.
 */
const TRIPS_LIST_HIT = 'GET /api/v1/trips';
/** `GET /trips` 목록 요청 수. */
export function listHits(all: readonly string[]): number {
  return all.filter((hit) => hit === TRIPS_LIST_HIT).length;
}
/** `GET /trips/{id}/itinerary` 일정 단건 요청 수(여행 id 무관). */
export function itineraryHits(all: readonly string[]): number {
  return all.filter((hit) =>
    /^GET \/api\/v1\/trips\/[^/]+\/itinerary$/.test(hit)
  ).length;
}
