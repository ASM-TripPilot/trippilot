import { useGetSavedStays } from '@/shared/api/generated/saved-stays/saved-stays';

/**
 * 생성 훅(`useGetSavedStays`)을 도메인 이름으로 재수출한다(`usePreferencePrefill` 선례, 몸통
 * 1줄). 여행 생성 위저드가 등록 숙소 날짜를 가져오는 용도다(US-TRIP-01).
 *
 * 새 기능이 아니라 **목킹 가능한 모듈 경로 하나**를 만드는 것이 목적이다 — node 버킷의
 * 페이지 테스트가 `QueryClientProvider` 없이 도는데, 생성 파일 경로를 목킹 대상으로 삼으면
 * 코드젠이 다시 돌 때마다 목이 흔들린다.
 */
export function useSavedStays() {
  return useGetSavedStays();
}
