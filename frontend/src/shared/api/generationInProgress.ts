import { isAxiosError } from 'axios';

import {
  getTripsTripIdItinerary,
  postTripsTripIdGenerationSessionsSessionIdCancel,
} from './generated/trips/trips';
import { isNotFound } from './isNotFound';

/**
 * TRIP-1032 · TRIP-403 — 생성 POST 의 409 `GENERATION_IN_PROGRESS`(계정당 동시 생성 1개)를 다른 실패와
 * 가르고, 지금 생성 중인 여행(`error.activeTripId`)을 꺼낸다. 그 밖은 전부 null(일반 실패로 접는다).
 *
 * ⚠️ codegen 은 생성 오류 타입을 `void | ErrorResponse` 로 적지만 런타임엔 AxiosError 가 그대로 온다 —
 * 서버 본문은 `error.response.data` 안에 있다(`visitConflict.ts` 와 같은 읽기).
 */
export function resolveGenerationInProgress(
  error: unknown
): { activeTripId: string } | null {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  const data = error.response.data as
    { error?: { code?: string; activeTripId?: unknown } } | undefined;
  const activeTripId = data?.error?.activeTripId;
  return data?.error?.code === 'GENERATION_IN_PROGRESS' &&
    typeof activeTripId === 'string'
    ? { activeTripId }
    : null;
}

/**
 * 생성 POST 의 409 중 `GENERATION_IN_PROGRESS` 가 **아닌** 것 = 서버 규칙이 이 재생성을 거절했다(여행 중·끝난
 * 여행 — BE `GenerateItineraryService.guardTripPeriod`). 다시 보내도 같은 답이라 [다시 시도] 대신 서버 사유를
 * 그대로 보여 줄 문구를 꺼낸다. 그 밖(다른 상태·문구 없음)은 null — 일반 실패로 접는다.
 */
export function resolveGenerationRefused(
  error: unknown
): { message: string } | null {
  if (!isAxiosError(error) || error.response?.status !== 409) return null;
  const data = error.response.data as
    { error?: { code?: string; message?: unknown } } | undefined;
  const message = data?.error?.message;
  return data?.error?.code !== 'GENERATION_IN_PROGRESS' &&
    typeof message === 'string' &&
    message !== ''
    ? { message }
    : null;
}

/**
 * 다른 여행(`activeTripId`)의 진행 중 생성을 취소한다. 반환값 = 취소할 세션을 찾았나.
 *
 * - 세션 id 는 그 여행 일정 GET 의 `generationSessionId` 로만 얻는다. 404(첫날 생성 중이라 일정이 아직
 *   없음)·null(진행 중 아님)이면 취소할 것이 없다 → false.
 * - cancel 409 는 "이미 끝났다"라 제한도 풀렸다 → 성공과 같이 본다(code 로 가르지 않는다 — openapi 가
 *   cancel 409 의 code 를 문서화하지 않았다).
 * - 그 밖의 실패(500·네트워크)는 던진다 — 호출부가 정한다.
 */
export async function cancelActiveGeneration(
  activeTripId: string
): Promise<boolean> {
  let sessionId: string | null | undefined;
  try {
    sessionId = (await getTripsTripIdItinerary(activeTripId))
      .generationSessionId;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  if (sessionId == null) return false;
  try {
    await postTripsTripIdGenerationSessionsSessionIdCancel(
      activeTripId,
      sessionId
    );
  } catch (error) {
    if (!isAxiosError(error) || error.response?.status !== 409) throw error;
  }
  return true;
}
