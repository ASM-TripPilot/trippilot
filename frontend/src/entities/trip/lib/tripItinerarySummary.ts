import type {
  ItineraryGenerationMode,
  ItineraryGenerationState,
  ItineraryStatus,
  Trip,
} from '@/shared/api/index.schemas';

/**
 * TRIP-1677 · 목록(`GET /trips`)의 일정 상태 네 칸 → 화면 판정 함수들이 받는 모양. 일정이 없으면 서버가 null 을 싣는데
 * 판정 함수들은 undefined 로 받으므로 그 변환(null→undefined)이 여기 한 곳에만 있다.
 * `itineraryStatus == null`(null 이든 필드 부재든)은 "일정 없음" = 일정 조회 404 와 같은 뜻이다.
 * `inFlight` = 생성 세션이 도는 중이거나 생성 상태가 PARTIAL(세션 없는 멈춘 생성 포함) — 셸 폴링 대상.
 * 소요시간 필드는 어디에도 두지 않는다(INV-3).
 */
export interface TripItinerarySummary {
  notFound: boolean;
  status: ItineraryStatus | undefined;
  generationState: ItineraryGenerationState | undefined;
  generationMode: ItineraryGenerationMode | undefined;
  inFlight: boolean;
}

export function tripItinerarySummary(
  trip: Pick<
    Trip,
    | 'itineraryStatus'
    | 'itineraryGenerationState'
    | 'itineraryGenerationMode'
    | 'itineraryGenerating'
  >
): TripItinerarySummary {
  return {
    notFound: trip.itineraryStatus == null,
    status: trip.itineraryStatus ?? undefined,
    generationState: trip.itineraryGenerationState ?? undefined,
    generationMode: trip.itineraryGenerationMode ?? undefined,
    inFlight:
      trip.itineraryGenerating === true ||
      trip.itineraryGenerationState === 'PARTIAL',
  };
}
