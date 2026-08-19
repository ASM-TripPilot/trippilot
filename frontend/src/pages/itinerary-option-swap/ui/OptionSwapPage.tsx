import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';

import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import { parseSlotKey } from '@/features/itinerary/model/slotKey';
import { resolveSlotSwapError } from '@/features/itinerary/model/slotSwapError';
import { swapSlotPoi } from '@/features/itinerary/model/swapSlotPoi';
import { OptionSwapScreen } from '@/features/itinerary/ui/OptionSwapScreen';
import {
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerarySlotCandidates,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';

/**
 * TRIP-335 · h18 같이 고르기 옵션 교체 배선 — h12 시트와 **같은 오퍼레이션**(POST 후보 → 치환 →
 * PUT 전체 교체)이지만 확정 UX 가 2단계다: 라디오 단일선택(로컬 상태) 후 CTA 를 눌러야 확정하고,
 * 성공 시 `router.back()` 으로 진입 지점으로 pop 한다(실패는 이동 없이 인라인 오류). 선택은
 * controlled — 이 배선이 소유하고 화면엔 값·콜백만 내린다.
 *
 * 라우트 파일은 이 슬라이스에서 잠그지 않는다(브리프 §8 Q4 공백 — 슬라이스2 위저드와 공유 결정
 * 필요). 그래서 컨테이너 컴포넌트만 두고 배선을 완결한다.
 */

export interface OptionSwapPageProps {
  tripId: string;
  slotKey: string;
}

export function OptionSwapPage({
  tripId,
  slotKey,
}: OptionSwapPageProps): ReactElement {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const { mutate: fetchCandidates, data: candidatesData } =
    usePostTripsTripIdItinerarySlotCandidates();
  const { mutate: putItinerary, isPending } =
    usePutTripsTripIdItinerary<unknown>();

  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 같은 틱 연타의 이중발사 방지 — useState 잠금은 둘째 탭이 옛 값을 읽어 못 막는다(h09 firedRef).
  const firedRef = useRef(false);

  useEffect(() => {
    fetchCandidates({ tripId, data: { slotKey } });
  }, [fetchCandidates, tripId, slotKey]);

  const parsed = parseSlotKey(slotKey);

  function handleConfirm(): void {
    // itinerary GET 미도착(data undefined)이면 조기 반환 — 콜드 캐시에서 swapSlotPoi([]) 로 빈 days
    // 전체교체 PUT 이 나가 일정이 소실되는 것을 막는다(h18 은 단독 라우트라 이 창이 실재 · 5-b 경고3).
    if (
      firedRef.current ||
      selectedPoiId === null ||
      parsed.kind !== 'ok' ||
      itinerary.data === undefined
    ) {
      return;
    }
    firedRef.current = true;
    setErrorMessage(null);
    const nextDays = swapSlotPoi(
      itinerary.data?.days ?? [],
      { date: parsed.date, poiId: parsed.poiId },
      selectedPoiId
    );
    putItinerary(
      { tripId, data: buildEditItineraryRequest(nextDays) },
      {
        onSuccess: () => router.back(),
        onError: (error) => {
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
    <OptionSwapScreen
      candidates={candidatesData?.candidates ?? []}
      currentPoiId={parsed.kind === 'ok' ? parsed.poiId : ''}
      currentName={currentSlot?.nameKo}
      selectedPoiId={selectedPoiId}
      onSelectRadio={setSelectedPoiId}
      onConfirm={handleConfirm}
      isPending={isPending}
      errorMessage={errorMessage}
      onBack={() => router.back()}
    />
  );
}
