import { isGenerationRunning } from '@/features/itinerary';
import type { Itinerary, Trip } from '@/shared/api/index.schemas';
import { isDateInRange } from '@/shared/lib/monthGrid';

/** 셸 [다시 짜기]의 갈 길. handleRetry 의 이동과 확인 얼굴 문구가 이 한 판정을 함께 쓴다(TRIP-1424 AC-4). */
export type RegenerateRoute = 'replan' | 'generate' | 'inProgress' | 'stop';

export interface RegenerateRouteInput {
  itinerary: Pick<
    Itinerary,
    'status' | 'generationMode' | 'generationState' | 'generationSessionId'
  >;
  /** 여행 조회 결과. 없으면(조회 전·실패) 기간을 모른다 → 재계획으로 보내지 않는다. */
  trip: Pick<Trip, 'startDate' | 'endDate'> | undefined;
  /** 오늘(KST) `YYYY-MM-DD` — 호출처가 `seoulDate(new Date())` 로 준다. */
  today: string;
}

/**
 * 판정 순서는 `DraftPage.handleRetry`(조회가 끝난 뒤 분기)를 그대로 옮겼다 — 새 규칙이 아니라 이름을 붙였다.
 * ① 여행 중(기간 양 끝 포함)이면 확정·초안 구분 없이 재계획 — 단 MANUAL·생성 실패(FAILED)·생성 중은 빼고.
 * ② 확정·MANUAL 은 생성 POST 로 보내지 않는다. ③ 생성 중이면 "진행 중" 확인. ④ 그 밖은 생성.
 */
export function resolveRegenerateRoute({
  itinerary,
  trip,
  today,
}: RegenerateRouteInput): RegenerateRoute {
  const running = isGenerationRunning(itinerary);
  if (
    !running &&
    itinerary.generationMode !== 'MANUAL' &&
    itinerary.generationState !== 'FAILED' &&
    trip !== undefined &&
    isDateInRange(today, trip.startDate, trip.endDate)
  ) {
    return 'replan';
  }
  if (
    itinerary.status === 'CONFIRMED' ||
    itinerary.generationMode === 'MANUAL'
  ) {
    return 'stop';
  }
  return running ? 'inProgress' : 'generate';
}
