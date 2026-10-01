import { isAxiosError } from 'axios';
import { useRouter } from 'expo-router';
import { useRef, useState, type ReactElement } from 'react';

import { useLiveItinerary } from '@/features/execution/model/useLiveItinerary';
import { useReplanFormStore } from '@/features/planb/model/replanFormStore';
import { deriveReplanMapAnchor } from '@/features/planb/model/replanMapCenter';
import { buildManualOrigin } from '@/features/planb/model/replanOrigin';
import { buildStartReplanRequest } from '@/features/planb/model/replanRequest';
import { useStartReplan } from '@/features/planb/model/useStartReplan';
import { seoulDate } from '@/shared/date/seoulDate';
import type { MapCenter } from '@/shared/map';

import { LiveLocationView } from './LiveLocationView';

export type { LiveLocationState } from './LiveLocationView';

/**
 * TRIP-979 B · AC-B2·B5 — i20·i21 위치 입력 배선판. 일정 조회 → 지도 중심 유도 → 뷰 →
 * '이 위치로 계속' → MANUAL origin 재계획 요청 → solving.
 *
 *  - 지도 중심 = 오늘(KST)의 첫 좌표 슬롯 → 일정 전체 첫 좌표 슬롯 → 서울시청(`deriveReplanMapAnchor`).
 *    일정 조회 중엔 center 를 null 로 내려 지도를 띄우지 않는다(picker 첫 좌표 포획). 조회가 실패하면
 *    상수로 띄운다 — 무한 로딩 금지(INV-4).
 *  - 확정 → 누르는 순간의 폼 스토어 값 + 지도 중심 MANUAL origin + triggerId null 로 POST 1회.
 *    폼을 reset 하지 않는다(요청 시트에서 고른 값을 그대로 싣는다). 성공 → solving 으로 replace
 *    (PlanbRequestPage 선례), 실패 → 같은 화면에 요청 시트와 같은 문구.
 */

export interface LiveLocationPageProps {
  tripId: string;
  /** URL `?state=` 원문 — 얼굴 선택은 뷰가 정규화한다(AC-A7). */
  state?: string | string[];
  /** "오늘"(KST 'YYYY-MM-DD') 주입 seam — 테스트용. 생략하면 지금 시각의 KST 날짜. */
  today?: string;
}

export function LiveLocationPage({
  tripId,
  state,
  today,
}: LiveLocationPageProps): ReactElement {
  const router = useRouter();
  const itinerary = useLiveItinerary(tripId);
  const startReplan = useStartReplan();
  const [errorText, setErrorText] = useState<string | null>(null);
  // 요청이 끝나기(settle) 전 재누름은 무시한다. 실패하면 풀어 재시도를 막지 않는다.
  const submittingRef = useRef(false);

  const anchor = itinerary.isPending
    ? null
    : deriveReplanMapAnchor({
        days: itinerary.data?.days,
        preferredDate: today ?? seoulDate(new Date()),
      });

  function handleConfirm(center: MapCenter): void {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setErrorText(null);
    // 이벤트 시점의 최신값을 스토어에서 직접 읽는다(렌더 클로저 stale 회피).
    const form = useReplanFormStore.getState();
    const data = buildStartReplanRequest(
      {
        scope: form.scope,
        reasons: form.reasons,
        directives: form.directives,
        freeText: form.freeText,
        triggerId: null,
      },
      buildManualOrigin(center)
    );
    startReplan.mutate(
      { tripId, data },
      {
        onSuccess: (session) =>
          router.replace({
            pathname: '/trips/[tripId]/planb/solving',
            params: { tripId, sessionId: session.sessionId },
          }),
        onError: (error) =>
          setErrorText(
            isAxiosError(error) && error.response?.status === 409
              ? '여행 기간에만 AI에게 맡길 수 있어요'
              : '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요'
          ),
        onSettled: () => {
          submittingRef.current = false;
        },
      }
    );
  }

  return (
    <LiveLocationView
      state={state}
      center={anchor?.center ?? null}
      placeName={anchor?.placeName ?? null}
      onConfirm={handleConfirm}
      errorText={errorText}
    />
  );
}
