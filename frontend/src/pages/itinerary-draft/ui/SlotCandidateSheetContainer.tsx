import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import { parseSlotKey } from '@/features/itinerary/model/slotKey';
import { resolveSlotSwapError } from '@/features/itinerary/model/slotSwapError';
import { swapSlotPoi } from '@/features/itinerary/model/swapSlotPoi';
import { SlotCandidateSheet } from '@/features/itinerary/ui/SlotCandidateSheet';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerarySlotCandidates,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';

/**
 * TRIP-335 · h12 완전 AI 슬롯 교체 배선(h12=초안 위 시트라 draft 슬라이스). 세 조각을 잇는다:
 *  1. **조회** — 마운트 시 `slot-candidates` POST 1회(`slotKey` 만, 제외목록 없음 · BR-U3-24).
 *  2. **치환** — 후보 "선택" 탭 → GET 캐시의 현 `days` 에서 `swapSlotPoi` 로 대상 슬롯 poiId 만 갈고
 *     `buildEditItineraryRequest` 로 조립(진실은 편집 스토어가 아니라 조회 캐시 — h12 는 초안 위 시트).
 *  3. **확정** — 전체 교체 PUT. 성공 → 조회 **무효화 재조회**(DraftScreen 갱신) + `onClose`.
 *     실패 → 이동/닫힘 없이 `resolveSlotSwapError` 문구를 인라인으로 세운다(AC7 · INV-4).
 *
 * 화면은 이 중 어느 것도 모른다 — 순수 시트에 완성된 값·콜백만 내린다.
 */

export interface SlotCandidateSheetContainerProps {
  tripId: string;
  slotKey: string;
  onClose: () => void;
}

export function SlotCandidateSheetContainer({
  tripId,
  slotKey,
  onClose,
}: SlotCandidateSheetContainerProps): ReactElement {
  const queryClient = useQueryClient();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const { mutate: fetchCandidates, data: candidatesData } =
    usePostTripsTripIdItinerarySlotCandidates();
  const { mutate: putItinerary, isPending } =
    usePutTripsTripIdItinerary<unknown>();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // useState 잠금은 같은 틱의 둘째 탭이 옛 값을 읽어 못 막는다 — useRef 는 즉시 읽혀 펜딩 전파 전
  // 이중발사를 막는다(리포 함정 h09 firedRef · TripNewStep1 submitLockedRef 선례 · AC4).
  const firedRef = useRef(false);

  // 마운트(=시트 열림)에 후보 조회 POST 를 딱 1회. `mutate` 는 referentially stable 이라 deps 가
  // 안정적이면 한 번만 돈다. 요청 바디는 `slotKey` 하나뿐이다(radiusM·concept·제외목록 없음).
  useEffect(() => {
    fetchCandidates({ tripId, data: { slotKey } });
  }, [fetchCandidates, tripId, slotKey]);

  const parsed = parseSlotKey(slotKey);

  function handleSelect(candidatePoiId: string): void {
    // itinerary GET 미도착(data undefined)이면 조기 반환 — swapSlotPoi([]) 로 빈 days 전체교체 PUT
    // 이 나가 일정이 소실되는 것을 막는다(candidates POST 와 GET 은 순서 보장이 없다 · 5-b 경고3).
    if (
      firedRef.current ||
      parsed.kind !== 'ok' ||
      itinerary.data === undefined
    )
      return;
    firedRef.current = true;
    setErrorMessage(null);
    const nextDays = swapSlotPoi(
      itinerary.data?.days ?? [],
      { date: parsed.date, poiId: parsed.poiId },
      candidatePoiId
    );
    putItinerary(
      { tripId, data: buildEditItineraryRequest(nextDays) },
      {
        onSuccess: () => {
          // 성공만 닫는다 — 조회 무효화로 DraftScreen 이 갱신 재조회(GET 1→2)하고 시트를 닫는다.
          void queryClient.invalidateQueries({
            queryKey: getGetTripsTripIdItineraryQueryKey(tripId),
          });
          onClose();
        },
        onError: (error) => {
          // 실패엔 안 닫는다 — 잠금을 풀어 재시도가 다시 타게 하고 인라인 오류를 세운다(INV-4).
          firedRef.current = false;
          setErrorMessage(resolveSlotSwapError(error).message);
        },
      }
    );
  }

  // 현 슬롯 실이름은 후보와 달리 이미 손에 있다 — GET 캐시 슬롯의 nameKo 를 내려 "이름 준비 중"
  // 플레이스홀더 대신 실이름을 보인다(후보 이름·사진은 여전히 BE 후속 · 5-b 경고2).
  const currentSlot =
    parsed.kind === 'ok'
      ? itinerary.data?.days
          .find((day) => day.date === parsed.date)
          ?.slots.find((slot) => slot.poiId === parsed.poiId)
      : undefined;

  return (
    <SlotCandidateSheet
      candidates={candidatesData?.candidates ?? []}
      currentPoiId={parsed.kind === 'ok' ? parsed.poiId : ''}
      currentName={currentSlot?.nameKo}
      isPending={isPending}
      errorMessage={errorMessage}
      onSelectCandidate={handleSelect}
      onClose={onClose}
    />
  );
}
