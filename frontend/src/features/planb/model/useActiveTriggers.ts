import { useGetTripsTripIdTriggers } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-561 · useActiveTriggers — 발화 중 트리거 조회(GET /trips/{tripId}/triggers).
 *
 * 얇은 래퍼다(`useLiveItinerary.ts` 동형, 로직 0줄): 생성 훅을 그대로 넘긴다. 서버는 "발화
 * 중인 것만" 돌려주므로 목록이 비어 있으면 표시 표면(칩·배너)이 없다(INV-U4-01). MANUAL 필터·
 * 문구 조립·표시 판정은 페이지(`pages/live-itinerary`)가 맡는다.
 *
 * `enabled` 를 받아 active 얼굴에서만 조회하도록 게이팅한다(visits 쿼리 선례) — non-active
 * 얼굴(로딩·오류·오늘 밖)에서 GET /triggers 를 안 쏴 불필요한 요청을 줄인다.
 */
export function useActiveTriggers(
  tripId: string,
  options?: { enabled?: boolean }
) {
  return useGetTripsTripIdTriggers(tripId, {
    query: { enabled: options?.enabled ?? true },
  });
}
