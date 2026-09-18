import { useGetSavedStays } from '@/shared/api/generated/saved-stays/saved-stays';

/**
 * 생성 훅(`useGetSavedStays`)을 도메인 이름으로 재수출한다(`usePreferencePrefill` 선례, 몸통
 * 1줄). 여행 생성 위저드가 등록 숙소 날짜를 가져오는 용도다(US-TRIP-01).
 *
 * 새 기능이 아니라 **목킹 가능한 모듈 경로 하나**를 만드는 것이 목적이다 — node 버킷의
 * 페이지 테스트가 `QueryClientProvider` 없이 도는데, 생성 파일 경로를 목킹 대상으로 삼으면
 * 코드젠이 다시 돌 때마다 목이 흔들린다.
 *
 * `enabled`는 g02(TRIP-225 · 01b D7)가 더한 옵셔널 인자다 — `createdTripId`가 없으면 세 조회를
 * **모두** 꺼야 하는데, 이 훅만 `tripId`를 안 받아 끌 손잡이가 없었다. 안 주면 기존
 * 호출부(step1)와 같이 언제나 켜진 상태다.
 */
export function useSavedStays(options?: { enabled?: boolean }) {
  return useGetSavedStays({ query: { enabled: options?.enabled } });
}
