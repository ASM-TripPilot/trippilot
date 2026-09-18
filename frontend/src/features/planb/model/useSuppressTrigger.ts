import { useQueryClient } from '@tanstack/react-query';

import {
  getGetTripsTripIdTriggersQueryKey,
  usePostTripsTripIdTriggersTriggerIdDismiss,
} from '@/shared/api/generated/trips/trips';

/**
 * TRIP-561 · useSuppressTrigger — 칩 [끄기](×)의 억제 배선(BR-U4-15).
 *
 * `POST /trips/{tripId}/triggers/{triggerId}/dismiss` 를 감싸고, 성공하면 GET /triggers 를
 * 무효화해 다시 받는다 — 억제는 **단순 감춤이 아니라 서버 억제 레코드**이므로, 무효화로 다시
 * 받아 서버가 지운 트리거가 목록에서 실제로 빠지게 한다("억제됐다는 거짓말" 함정 회피).
 *
 * mutate 변수는 생성 훅 계약대로 `{ tripId, triggerId }`.
 */
export function useSuppressTrigger(tripId: string) {
  const queryClient = useQueryClient();
  return usePostTripsTripIdTriggersTriggerIdDismiss({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetTripsTripIdTriggersQueryKey(tripId),
        });
      },
    },
  });
}
