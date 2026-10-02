import type { Notification } from '@/shared/api/generated/schemas';

/**
 * TRIP-576 · l01 — 알림 1건을 딥링크 경로 문자열 또는 null(액션 없음)로 접는 순수 사영.
 * TRIP-946: 목적지는 서버가 말한 `actionType` 으로만 정한다(kind 폴백 폐지). STAY_DETAIL 은
 * 등록 숙소 상세 정의 전이라 액션 없음으로 접는다. 필수 필드가 없거나 빈 문자열이면 null(INV-4).
 * 화면·행은 이 결과를 받기만 하고 재판정하지 않는다("조합·판정은 한 곳").
 */

/** payload 의 한 필드를 경로 조각으로 — 비어 있지 않은 문자열이면 인코딩, 아니면 null. */
function segment(
  payload: Notification['actionPayload'],
  key: string
): string | null {
  // 판별자 없는 유니온 + 와이어 실물은 Map<String,String> → 갈래와 무관하게 런타임에 읽는다.
  const value = (payload as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' && value.length > 0
    ? encodeURIComponent(value)
    : null;
}

export function notificationAction(
  actionType: Notification['actionType'],
  actionPayload: Notification['actionPayload']
): string | null {
  const tripId = segment(actionPayload, 'tripId');
  if (tripId == null) return null;
  switch (actionType) {
    case 'TRIP_ITINERARY':
      return `/trips/${tripId}/itinerary`;
    case 'TRIP_SUMMARY':
      return `/trips/${tripId}/records/summary`;
    case 'PLANB_REPLAN': {
      const triggerId = segment(actionPayload, 'triggerId');
      return triggerId ? `/trips/${tripId}/planb?triggerId=${triggerId}` : null;
    }
    case 'REFLECTION_DAILY': {
      const dayDate = segment(actionPayload, 'dayDate');
      return dayDate ? `/trips/${tripId}/records/reflection/${dayDate}` : null;
    }
    default:
      return null;
  }
}
