import { useQueryClient } from '@tanstack/react-query';

import {
  getGetTripsTripIdItineraryQueryKey,
  usePostTripsTripIdItineraryConfirm,
} from '@/shared/api/index.hooks';
import { isAlreadyRegistered } from '@/shared/api';
import { markDoneBarSeen } from '@/entities/trip';

/**
 * 일정 확정 POST 의 공통 부수효과(`ManualPlanPage.runConfirm` ≡ `ItineraryPlanPage.handleConfirm`).
 * - 성공: 응답이 곧 최신 Itinerary(CONFIRMED)라 조회 캐시에 직접 쓴다(재조회 0 · resetQueries 는 data 까지 버려 금지).
 *   그 뒤 `onConfirmed` 를 부른다 — 위저드 비우기처럼 확정 직후 해야 하는 일을 페이지가 넘긴다
 *   (위저드 스토어는 형제 feature 라 이 훅이 직접 import 하지 않는다).
 * - 실패: **409 에서만** 재조회한다(서버 진실이 이미 확정일 수 있다 · 무효화만, data 보존). 404·500·네트워크는
 *   재조회하지 않는다 — 넓게 죽은 outage 에서 재조회마저 실패하면 타임라인이 통째로 사라진다(TRIP-355).
 * 캐시 쓰기·완료 배너 seen 기록(TRIP-1428)을 훅 옵션에 두므로 확정 대기 중 화면을 떠나도 불린다(traps-itinerary GeneratingPage).
 * 이동·토스트·press 가드 창·인라인 오류 안내는 호출별 콜백(페이지)이 쥔다 — 두 페이지가 서로 다르다.
 */
export function useConfirmItinerary(tripId: string, onConfirmed?: () => void) {
  const queryClient = useQueryClient();
  return usePostTripsTripIdItineraryConfirm<unknown>({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(
          getGetTripsTripIdItineraryQueryKey(tripId),
          data
        );
        // TRIP-1428 — 확정 토스트가 이미 알렸으니 일정 탭 완료 배너로 또 알리지 않는다(기다리지 않음 · 실패 삼킴).
        void markDoneBarSeen(tripId);
        onConfirmed?.();
      },
      onError: (error) => {
        if (isAlreadyRegistered(error)) {
          void queryClient.invalidateQueries({
            queryKey: getGetTripsTripIdItineraryQueryKey(tripId),
          });
        }
      },
    },
  });
}
