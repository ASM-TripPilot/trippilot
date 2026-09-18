import { usePostTripsTripIdItinerarySlotCandidates } from '@/shared/api/generated/trips/trips';

/**
 * TRIP-440 · i14 슬롯 후보 조회 POST — `usePostTripsTripIdItinerarySlotCandidates` 얇은 passthrough.
 *
 * U3 `proposeSlotCandidates`를 그대로 호출하는 신규 경계 0 래퍼(DEC-U4-1) — 무효화할 로컬 목록이
 * 없어 onSuccess 무효화를 두지 않는다(`useStartReplan` 선례 동형). **이번 사이클 소비처 0** —
 * SlotCandidateSheet 은 표시 전용이고 이를 배선할 컨테이너/페이지는 draft 계약 갭으로 막혔다.
 * 소비-경유 테스트는 컨테이너가 착수될 후속 몫(§테스트 없는 산출물 근거).
 */
export function useSlotCandidates(): ReturnType<
  typeof usePostTripsTripIdItinerarySlotCandidates
> {
  return usePostTripsTripIdItinerarySlotCandidates();
}
