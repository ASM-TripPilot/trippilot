import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { buildEditItineraryRequest } from '@/features/edit-itinerary';
import { isConfirmLocked } from '@/features/itinerary';
import { parseSlotKey } from '@/entities/itinerary-slot';
import { resolveSlotSwapError } from '@/features/edit-itinerary';
import { swapSlotPoi } from '@/features/edit-itinerary';
import { SlotCandidateSheet } from './SlotCandidateSheet';
import type { SlotCandidateSheetRow } from './SlotCandidateSheet';
import { useElapsedFlag } from '@/shared/lib/useElapsedFlag';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerarySlotCandidates,
  usePutTripsTripIdItinerary,
} from '@/shared/api/index.hooks';

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
 * 조회 상태(TRIP-1109)도 여기가 정한다 — 응답 전(idle 포함)=loading, 10초 넘으면 slow, 실패=error,
 * 도착=ready. 시트는 시간을 모르므로 10초 판정(`useElapsedFlag`)·[다시 시도] 잠금은 이 컨테이너가 진다. 요청은 끊지
 * 않는다(abort·시한 없음) — slow 뒤에 응답이 오면 그대로 후보로 바뀐다.
 *
 * 헤더 시각범위·컨셉(현 슬롯 startAt/endAt/category)도 여기서 관통시킨다 — 시트는 문자열만 받는다
 * (옛 timeBand 대체 · D5). degraded 는 시트에 안 넘긴다(강등 전용 표면 제거 · AC-6).
 */

/** 이 시간이 지나도 후보 응답이 없으면 로딩 얼굴 안에 지연 안내 + [다시 시도](결정 2 — 끊지 않음). */
const SLOW_AFTER_MS = 10_000;

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
  const {
    mutate: fetchCandidates,
    data: candidatesData,
    isSuccess: candidatesArrived,
    isError: candidatesFailed,
    error: candidatesError,
  } = usePostTripsTripIdItinerarySlotCandidates();
  const { mutate: putItinerary, isPending } =
    usePutTripsTripIdItinerary<unknown>();

  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // useState 잠금은 같은 틱의 둘째 탭이 옛 값을 읽어 못 막는다 — useRef 는 즉시 읽혀 펜딩 전파 전
  // 이중발사를 막는다(리포 함정 h09 firedRef · TripNewStep1 submitLockedRef 선례).
  const firedRef = useRef(false);
  // [다시 시도] 한 틱 연타 잠금 — 같은 이유로 ref. isPending 으로 막으면 slow(=pending 중) 재시도가
  // 죽는다. 잠금은 [다시 시도]가 다시 보일 때(error 재등장·slow 재등장) 푼다 — 응답(settle) 때만 풀면
  // 두 번째 요청이 또 10초를 넘겨 뜬 버튼이 눌러도 아무 일 없는 침묵 실패가 된다.
  const retryLockRef = useRef(false);
  // attempt 는 [다시 시도]마다 바뀌어 10초를 새 요청 기준으로 다시 재게 한다.
  const [attempt, setAttempt] = useState(0);

  // 마운트(=시트 열림)에 후보 조회 POST 를 딱 1회. `mutate` 는 referentially stable 이라 deps 가
  // 안정적이면 한 번만 돈다. 요청 바디는 `slotKey` 하나뿐이다(radiusM·concept·제외목록 없음).
  useEffect(() => {
    fetchCandidates({ tripId, data: { slotKey } });
  }, [fetchCandidates, tripId, slotKey]);

  // idle(마운트 직후 mutate 전 한 렌더)도 "아직 응답 없음"이다 — 여기서 0건 얼굴이 새지 않게 한다.
  const waiting = !candidatesArrived && !candidatesFailed;
  const isSlow = useElapsedFlag(waiting, SLOW_AFTER_MS, attempt);
  const fetchState = candidatesFailed
    ? 'error'
    : candidatesArrived
      ? 'ready'
      : isSlow
        ? 'slow'
        : 'loading';

  useEffect(() => {
    if (fetchState === 'error' || fetchState === 'slow')
      retryLockRef.current = false;
  }, [fetchState]);

  function handleRetryFetch(): void {
    if (retryLockRef.current) return;
    retryLockRef.current = true;
    setAttempt((count) => count + 1);
    fetchCandidates({ tripId, data: { slotKey } });
  }

  const parsed = parseSlotKey(slotKey);

  // 현 슬롯 실이름·시각·컨셉은 후보와 달리 이미 손에 있다 — GET 캐시 슬롯의 nameKo·startAt·endAt·
  // category·imageUrl 을 내려 헤더 제목·부제·현재 행 사진을 세운다.
  const currentSlot =
    parsed.kind === 'ok'
      ? itinerary.data?.days
          .find((day) => day.date === parsed.date)
          ?.slots.find((slot) => slot.poiId === parsed.poiId)
      : undefined;

  // TRIP-1245 선표시 — 응답 전(loading·slow)엔 생성 때 받은 차선책(GET 슬롯 `alternatives`)을 같은 행
  // 모양으로 먼저 보이고, 응답이 오면 그 목록으로 통째로 바꾼다(합치지 않는다). 실패 얼굴엔 행을 두지
  // 않는다 — 선표시로 조회 실패를 덮지 않는다(INV-4). GET 미도착·차선책 0건이면 지금처럼 스켈레톤.
  const rows: SlotCandidateSheetRow[] =
    fetchState === 'ready'
      ? (candidatesData?.candidates ?? [])
      : fetchState === 'error'
        ? []
        : (currentSlot?.alternatives ?? []);
  // 선택은 "누른 기록"(selectedPoiId)과 "지금 보이는 행"에서 매 렌더 도출한다 — 선표시 중 고른 행이
  // 응답 목록에 없으면 해제(null)된다. effect 로 지우지 않아 목록이 바뀌는 순간에도 어긋남이 없다.
  const selected = rows.some((row) => row.poiId === selectedPoiId)
    ? selectedPoiId
    : null;

  function handleConfirm(): void {
    // itinerary GET 미도착(data undefined)이면 조기 반환 — swapSlotPoi([]) 로 빈 days 전체교체 PUT
    // 이 나가 일정이 소실되는 것을 막는다(candidates POST 와 GET 은 순서 보장이 없다).
    // generationState==='PARTIAL'(2단계 생성 중)이면 확정을 잠근다 — day1-only 전체교체 PUT 이 뒷날을
    // 덮어쓰기 전에 막는다(서버 409 의 클라 사본 · handleConfirm 으로 이전된 가드).
    // 응답 전(선표시 행)엔 확정하지 않는다 — 일정 겹침은 서버가 POST 때만 다시 거른다(TRIP-1245).
    if (
      firedRef.current ||
      fetchState !== 'ready' ||
      selected === null ||
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
      selected
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

  return (
    <SlotCandidateSheet
      current={{
        poiId: parsed.kind === 'ok' ? parsed.poiId : '',
        nameKo: currentSlot?.nameKo,
        tags: currentSlot?.tags,
        imageUrl: currentSlot?.imageUrl,
        distanceRange: currentSlot?.distanceRange,
      }}
      // 후보(또는 선표시)의 이름·태그·사진을 그대로 내린다(TRIP-1024, QA #053 "이름 준비 중"·회색 사진).
      candidates={rows}
      startAt={currentSlot?.startAt}
      endAt={currentSlot?.endAt}
      category={currentSlot?.category ?? undefined}
      selectedPoiId={selected}
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
      fetchState={fetchState}
      fetchErrorMessage={
        candidatesFailed ? resolveSlotSwapError(candidatesError).message : null
      }
      onRetryFetch={handleRetryFetch}
      emptyReason={candidatesData?.emptyReason}
    />
  );
}
