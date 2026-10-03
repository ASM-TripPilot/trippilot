import { useRef, useState } from 'react';

import type { Itinerary } from '@/shared/api/index.schemas';
import {
  cancelActiveGeneration,
  resolveGenerationInProgress,
} from '@/shared/api/index.hooks';

/**
 * TRIP-1032 B — "이 여행이 생성 중" = 세션 id 가 있다. 서버는 이 id 를 지금 도는 세션에서만 채운다
 * (`runningIdOf`) — `generationState` 는 일정 행에 저장된 값이라 재생성 1차 동안엔 옛 COMPLETE 로 보이므로
 * 판정 축이 될 수 없다(5-b 경고-3). 세션 없는 PARTIAL(이미 취소·멈춘 생성)은 생성 중이 아니다. `!= null` 이라 필드가 없는(undefined)
 * 응답도 "생성 중 아님"이다.
 */
export function isGenerationRunning(
  itinerary:
    Pick<Itinerary, 'generationState' | 'generationSessionId'> | undefined
): boolean {
  return itinerary?.generationSessionId != null;
}

export interface GenerationBusy {
  /** false = 취소할 세션을 못 얻었는데 재시도도 409 — [취소하고 새로 만들기]를 빼고 [기다리기]만. */
  cancelable: boolean;
  /** 다른 여행 생성 취소(찾을 수 있으면) → `resend` 로 원래 요청을 1회 다시. */
  onCancelAndRetry: () => void;
}

/**
 * TRIP-1032 A — 생성 POST 오류가 409 `GENERATION_IN_PROGRESS` 면 안내 상태를, 아니면 null 을 준다.
 *
 * 상태를 따로 들지 않고 **뮤테이션 오류에서 매 렌더 도출**한다 — 재시도(`resend` = 원래 mutate)가 나가는
 * 순간 오류가 비워져 안내가 저절로 걷히고, 또 409 면 저절로 다시 뜬다. 그래서 재409 에 자동으로 다시
 * 취소하는 경로가 없다(누를 때마다 cancel 최대 1회, AC-4).
 *
 * react-query 훅을 쓰지 않는다 — 생성 화면 형제 테스트가 QueryClient 없이 렌더한다(02a §2-5).
 * T2 조회·cancel 은 버튼을 누른 순간 순수 fetcher 로 한 번씩.
 */
export function useGenerationBusy(
  error: unknown,
  resend: () => void
): GenerationBusy | null {
  const [cancelable, setCancelable] = useState(true);
  // 연타 가드 — 조회·cancel 왕복 동안 안내가 그대로 떠 있어 두 번째 press 가 cancel 을 한 번 더 쏜다.
  const workingRef = useRef(false);
  const hit = resolveGenerationInProgress(error);
  if (hit === null) return null;

  return {
    cancelable,
    onCancelAndRetry: () => {
      if (workingRef.current) return;
      workingRef.current = true;
      void cancelActiveGeneration(hit.activeTripId)
        // 조회·cancel 이 500·네트워크로 실패하면 "모른다" — 취소 불가로 단정하지 않고 재시도한다.
        // 또 409 면 안내가 다시 뜨고, 네트워크면 일반 실패 얼굴이 말한다(INV-4).
        .catch(() => true)
        .then((found) => {
          workingRef.current = false;
          setCancelable(found);
          resend();
        });
    },
  };
}
