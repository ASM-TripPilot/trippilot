import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import { isConfirmLocked } from '@/features/itinerary/model/planState';
import { parseSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
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
 * TRIP-793 · h08 슬롯 교체 배선(초안 아래·h08 셸 둘 다 마운트하는 컨테이너, 이름 유지). 세 조각을
 * 잇는다 — 프레젠테이션이 인라인 패널→바텀시트로, 확정이 즉시확정 1단계→라디오 2단계로 바뀌었어도
 * 배선 로직은 재사용이다(조회·치환·PUT·firedRef·콜드캐시):
 *  1. **조회** — 마운트 시 `slot-candidates` POST 1회(`slotKey` 만, 제외목록 없음 · BR-U3-24).
 *  2. **선택** — 후보 행 press → `selectedPoiId` controlled 상태만 바꾼다(PUT 안 나감).
 *  3. **확정** — "교체하기" press → GET 캐시의 현 `days` 에서 `swapSlotPoi` 로 대상 슬롯 poiId 만 갈고
 *     `buildEditItineraryRequest` 로 조립해 전체 교체 PUT. 성공 → 조회 무효화 재조회 + `onClose`.
 *     실패 → 이동/닫힘 없이 `resolveSlotSwapError` 문구를 인라인으로 세운다(INV-4).
 *
 * ★ PARTIAL 게이트가 `handleConfirm` 으로 이전됐다(TRIP-793) — 라디오 2단계라 확정이 여기로 옮겨왔고,
 *   가드를 함께 옮겨야 2차 생성 중 day1-only 전체교체 PUT 이 뒷날을 덮어쓰지 않는다(traps-itinerary
 *   TRIP-467/483 잔여). 콜드캐시(GET 미도착)·PARTIAL·중복발사(firedRef) 셋을 handleConfirm 이 진다.
 *
 * 헤더 시각범위·컨셉(현 슬롯 startAt/endAt/category)도 여기서 관통시킨다 — 시트는 문자열만 받는다
 * (옛 timeBand 대체 · D5). degraded 는 시트에 안 넘긴다(강등 전용 표면 제거 · AC-6).
 */

export interface SlotCandidatePanelContainerProps {
  tripId: string;
  slotKey: string;
  onClose: () => void;
}

export function SlotCandidatePanelContainer({
  tripId,
  slotKey,
  onClose,
}: SlotCandidatePanelContainerProps): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const { mutate: fetchCandidates, data: candidatesData } =
    usePostTripsTripIdItinerarySlotCandidates();
  const { mutate: putItinerary, isPending } =
    usePutTripsTripIdItinerary<unknown>();

  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // useState 잠금은 같은 틱의 둘째 탭이 옛 값을 읽어 못 막는다 — useRef 는 즉시 읽혀 펜딩 전파 전
  // 이중발사를 막는다(리포 함정 h09 firedRef · TripNewStep1 submitLockedRef 선례).
  const firedRef = useRef(false);

  // 마운트(=시트 열림)에 후보 조회 POST 를 딱 1회. `mutate` 는 referentially stable 이라 deps 가
  // 안정적이면 한 번만 돈다. 요청 바디는 `slotKey` 하나뿐이다(radiusM·concept·제외목록 없음).
  useEffect(() => {
    fetchCandidates({ tripId, data: { slotKey } });
  }, [fetchCandidates, tripId, slotKey]);

  const parsed = parseSlotKey(slotKey);

  function handleConfirm(): void {
    // itinerary GET 미도착(data undefined)이면 조기 반환 — swapSlotPoi([]) 로 빈 days 전체교체 PUT
    // 이 나가 일정이 소실되는 것을 막는다(candidates POST 와 GET 은 순서 보장이 없다).
    // generationState==='PARTIAL'(2단계 생성 중)이면 확정을 잠근다 — day1-only 전체교체 PUT 이 뒷날을
    // 덮어쓰기 전에 막는다(서버 409 의 클라 사본 · handleConfirm 으로 이전된 가드).
    if (
      firedRef.current ||
      selectedPoiId === null ||
      parsed.kind !== 'ok' ||
      itinerary.data === undefined ||
      isConfirmLocked(itinerary.data.generationState)
    )
      return;
    firedRef.current = true;
    setErrorMessage(null);
    const nextDays = swapSlotPoi(
      itinerary.data.days,
      { date: parsed.date, poiId: parsed.poiId },
      selectedPoiId
    );
    putItinerary(
      { tripId, data: buildEditItineraryRequest(nextDays) },
      {
        onSuccess: () => {
          // 성공만 닫는다 — 조회 무효화로 갱신 재조회(GET 1→2)하고 시트를 닫는다.
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

  // 현 슬롯 실이름·시각·컨셉은 후보와 달리 이미 손에 있다 — GET 캐시 슬롯의 nameKo·startAt·endAt·
  // category 를 내려 헤더 제목·부제를 세운다(후보 이름·사진·태그는 여전히 BE 후속이라 undefined).
  const currentSlot =
    parsed.kind === 'ok'
      ? itinerary.data?.days
          .find((day) => day.date === parsed.date)
          ?.slots.find((slot) => slot.poiId === parsed.poiId)
      : undefined;

  return (
    <SlotCandidateSheet
      current={{
        poiId: parsed.kind === 'ok' ? parsed.poiId : '',
        nameKo: currentSlot?.nameKo,
        tags: currentSlot?.tags,
        distanceRange: currentSlot?.distanceRange,
      }}
      candidates={(candidatesData?.candidates ?? []).map((candidate) => ({
        poiId: candidate.poiId,
        distanceRange: candidate.distanceRange,
      }))}
      startAt={currentSlot?.startAt}
      endAt={currentSlot?.endAt}
      category={currentSlot?.category ?? undefined}
      selectedPoiId={selectedPoiId}
      onSelectRadio={setSelectedPoiId}
      onConfirm={handleConfirm}
      isPending={isPending}
      errorMessage={errorMessage}
      onPressPlaceSearch={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/manual/add',
          params: { tripId },
        })
      }
      onClose={onClose}
    />
  );
}
