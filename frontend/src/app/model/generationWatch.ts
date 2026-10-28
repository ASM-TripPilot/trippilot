import type { ItineraryGenerationState } from '@/shared/api/index.schemas';

/**
 * 앱 셸 "생성 완료 감지"(`useGenerationWatch`)의 순수 판정 — React·라우터·네트워크를 모른다(TRIP-1618).
 * 문구에 소요시간을 쓰지 않는다(INV-3).
 */

export const GENERATION_COMPLETE_MESSAGE = '일정이 완성됐어요';
export const GENERATION_FAILED_MESSAGE = '일정을 만들지 못했어요';
export const GENERATION_COMPLETE_TOAST_ID = 'generation-complete-toast';
export const GENERATION_FAILED_TOAST_ID = 'generation-failed-toast';

// 코드젠 `getGetTripsTripIdItineraryQueryKey` 의 모양(`['/trips/{id}/itinerary']`)을 되읽는다. 코드젠이 모양을 바꾸면
// 셸이 조용히 0건을 감시하므로 generationWatch.test W2 가 실제 키 함수 출력으로 짝을 잠근다.
const ITINERARY_KEY = /^\/trips\/([^/]+)\/itinerary$/;

/** 일정 캐시 칸의 키면 tripId, 아니면 null. */
export function tripIdFromItineraryKey(
  queryKey: readonly unknown[]
): string | null {
  const [key] = queryKey;
  if (queryKey.length !== 1 || typeof key !== 'string') return null;
  return ITINERARY_KEY.exec(key)?.[1] ?? null;
}

/** 알리는 전이는 `PARTIAL → COMPLETE|FAILED` 둘뿐 — 처음 본 값·같은 값 반복·재생성 시작은 null. */
export function detectGenerationTransition(
  prev: ItineraryGenerationState | undefined,
  next: ItineraryGenerationState | undefined
): 'COMPLETE' | 'FAILED' | null {
  if (prev !== 'PARTIAL') return null;
  return next === 'COMPLETE' || next === 'FAILED' ? next : null;
}

/**
 * 그 여행의 생성 진행 화면(생성 중·초안·같이 짜기 슬롯 채우기)인가. 이 화면들은 자체 폴링을 하므로 셸이 양보하고 토스트도 생략한다.
 * 같이 짜기 완성 확인(`copick/complete`)은 진행 화면이 아니다. 일정 탭(`/itinerary`)은 여행 단위가 아니라 목록이라 여기에 안 든다.
 */
export function isGenerationScreenOf(
  pathname: string | null | undefined,
  tripId: string
): boolean {
  const prefix = `/trips/${tripId}/itinerary/`;
  if (!pathname?.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length);
  if (rest === 'generating' || rest === 'draft') return true;
  return (
    rest.startsWith('copick/') &&
    rest !== 'copick/complete' &&
    rest.length > 'copick/'.length
  );
}

/** 토스트를 생략할 자리 — 그 여행의 진행 화면, 또는 일정 탭(어느 여행이든: 카드가 이미 바뀐 채로 보인다). */
export function shouldSkipToast(
  pathname: string | null | undefined,
  tripId: string
): boolean {
  return pathname === '/itinerary' || isGenerationScreenOf(pathname, tripId);
}
