import type { QueryClient } from '@tanstack/react-query';

import { isNotFound } from '@/shared/api';
import { getGetTripsTripIdItineraryQueryOptions } from '@/shared/api/index.trips';

import {
  itineraryDestinationHref,
  resolveItineraryDestination,
  type ItineraryDestinationHref,
} from './planState';

/** 카드·홈 CTA 가 조회 실패 때 띄우는 토스트 — 이동하지 않고 알린다(INV-4). */
export const ITINERARY_OPEN_FAILED_MESSAGE =
  '일정을 불러오지 못했어요. 잠시 후 다시 눌러 주세요';
export const ITINERARY_OPEN_FAILED_TOAST_ID = 'itinerary-open-failed-toast';

/**
 * TRIP-1677 · 같이 짜기(copick) 생성 중인 여행을 누를 때만 일정을 한 번 받아 이동할 주소를 만든다. 목록(`GET /trips`)에는
 * 일정의 `days` 가 없어서 "첫 비고정 슬롯" 키를 주소에 넣으려면 이 조회가 필요하다(AssistantSheetPage.openItinerary 와 같은 길).
 *
 * - 누른 시점의 서버 값으로 정한다(`staleTime: 0`) — 신선한 캐시의 옛 PARTIAL 로 슬롯 채우기에 보내지 않는다.
 * - 앱 기본 재시도(3회)는 이 호출만 끈다(`retry: false`) — 실패는 호출부가 토스트로 알리고 사용자가 다시 누른다.
 * - 받은 응답으로 목적지를 **다시 판정**한다: 그사이 생성이 끝났으면 슬롯 채우기가 아니라 완성 확인/초안/허브.
 * - 404 는 "일정 없음" = 방식 선택(`method`). 그 밖의 실패(500·429·네트워크)는 던진다.
 * 라우터·토스트·연타 잠금은 호출부 몫이라 여기서 모른다(model 은 라우팅을 모른다).
 */
export async function fetchTripItineraryHref(
  queryClient: QueryClient,
  tripId: string
): Promise<ItineraryDestinationHref> {
  try {
    const data = await queryClient.fetchQuery({
      ...getGetTripsTripIdItineraryQueryOptions(tripId),
      retry: false,
      staleTime: 0,
    });
    return itineraryDestinationHref(
      tripId,
      resolveItineraryDestination({
        notFound: false,
        generationState: data.generationState,
        status: data.status,
        generationMode: data.generationMode,
      }),
      data.days
    );
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return itineraryDestinationHref(tripId, 'method', undefined);
  }
}
