import { useGetTripsTripIdReplanSessionsSessionId } from '@/shared/api/index.hooks';

/**
 * TRIP-440 · i12 재계획 세션 조회 폴링 — `useGetTripsTripIdReplanSessionsSessionId` 얇은 래퍼.
 *
 * SOLVING(·직전 COLLECTING) 동안만 `refetchInterval`로 되묻는다 — 판정 결과가 solving 계열이면
 * 다시, 그 밖(DRAFT·APPLIED·CANCELED·FAILED·NO_SOLUTION)이면 멈춘다(`false`). 판정은
 * `resolveReplanState`, 조립은 페이지가 맡는다 — 여기 로직을 얹지 않는다(`useLiveItinerary` 선례).
 * 폴링이 "실제로 도는가"는 실타이머가 필요해 jest 사각(페이지 테스트가 이 seam 을 목한다).
 */

const POLL_INTERVAL_MS = 2000;
/** 일시 오류는 한 번 더 묻는다(TRIP-1348) — 그래도 실패하면 오류로 서고 폴링이 멈춘다. */
const RETRY_COUNT = 1;
const RETRY_DELAY_MS = 1000;

export function useReplanSession(tripId: string, sessionId: string) {
  return useGetTripsTripIdReplanSessionsSessionId(tripId, sessionId, {
    query: {
      // 폴링 한 번이 실패하면 한 번만 더 요청한다 — 전역 기본(재시도 여러 번)을 덮는다. 둘 다 실패해야 error.
      retry: RETRY_COUNT,
      retryDelay: RETRY_DELAY_MS,
      refetchInterval: (query) => {
        // 재시도까지 실패해 오류로 떨어지면 서 버린다(INV-4, TRIP-1348) — 오류 뒤에도 옛 data 가 남아
        // (SOLVING) 그대로 두면 서버가 죽어 있는 동안 영구 폴링한다. 오류 표면은 페이지가 그린다.
        if (query.state.status === 'error') return false;
        const status = query.state.data?.status;
        return status === 'COLLECTING' || status === 'SOLVING'
          ? POLL_INTERVAL_MS
          : false;
      },
    },
  });
}
