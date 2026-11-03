import type { QueryState } from '@tanstack/react-query';

import { tripItinerarySummary } from '@/entities/trip';
import {
  DRAFT_POLL_SLOW_INTERVAL_MS,
  pollIntervalMs,
} from '@/features/itinerary/index.view';
import type {
  ItineraryGenerationState,
  Trip,
} from '@/shared/api/index.schemas';

/**
 * 앱 셸 "생성 완료 감지"(`useGenerationWatch`)의 순수 판정 — React·라우터·네트워크를 모른다(TRIP-1618).
 * 문구에 소요시간을 쓰지 않는다(INV-3).
 */

export const GENERATION_COMPLETE_MESSAGE = '일정이 완성됐어요';
export const GENERATION_FAILED_MESSAGE = '일정을 만들지 못했어요';
export const GENERATION_COMPLETE_TOAST_ID = 'generation-complete-toast';
export const GENERATION_FAILED_TOAST_ID = 'generation-failed-toast';

/**
 * 셸이 거는 `GET /trips` 폴링의 `refetchInterval` — **모듈 상수**다(렌더마다 새 함수를 만들면 TanStack 이 타이머를 다시 세운다).
 * 목록에 생성 중 여행(세션이 돌거나 PARTIAL)이 없으면 `false`(요청 0). 있으면 간격 곡선(`pollIntervalMs`)을 따르되, 직전 조회가
 * 실패했으면 멈추지 않고 느린 간격으로 계속 묻는다(INV-4 — 한 번의 오류가 「만드는 중」 고착이 되지 않게; 직전 data 가 남아도
 * `status` 를 먼저 본다). 이 옵션은 셸 관찰자에만 준다 — 다른 `useGetTrips` 에 주면 화면마다 타이머가 생겨 간격당 요청이 늘어난다.
 */
export function tripsRefetchInterval(query: {
  state: Pick<QueryState<Trip[]>, 'status' | 'data' | 'dataUpdateCount'>;
}): number | false {
  const { status, data, dataUpdateCount } = query.state;
  if (!data?.some((trip) => tripItinerarySummary(trip).inFlight)) return false;
  return status === 'error'
    ? DRAFT_POLL_SLOW_INTERVAL_MS
    : pollIntervalMs(dataUpdateCount);
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
 * 그 여행의 생성 진행 화면(생성 중·초안·같이 짜기 슬롯 채우기)인가. 이 화면들은 자체 폴링으로 완료를 먼저 보고 떠나므로 셸은 토스트를 생략한다(폴링은 양보하지 않는다 — 목록 한 건이라 중복 비용이 작고, 진행 화면이 먼저 보고 떠나도 목록 칸이 갱신돼야 한다).
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
