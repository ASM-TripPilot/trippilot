import type {
  NotificationActionPayload,
  NotificationActionType,
  NotificationKind,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-576 · l01 — 알림 1건을 딥링크 경로 문자열 또는 null(액션 없음)로 접는 순수 사영.
 * 우선순위: ① actionType 알려진 값 ② kind 폴백 ③ 필요한 payload 키 없으면 null.
 * 계약 드리프트(actionType=[TRIP_ITINERARY] 1개뿐·payload 키 자유형)로 현재는 kind 폴백이
 * 실경로다 — PLAN_B→`/trips/{tripId}/planb`, REFLECTION→`/trips/{tripId}/records/reflection/{date}`.
 * 화면·행은 이 결과를 받기만 하고 재판정하지 않는다("조합·판정은 한 곳"). */

export function notificationAction(
  kind: NotificationKind,
  _actionType: NotificationActionType | undefined,
  actionPayload: NotificationActionPayload | undefined
): string | null {
  // actionType 은 아직 매핑 라우트가 없어(계약엔 TRIP_ITINERARY 뿐) 무시하고 kind+payload 로만 결정.
  // payload 는 자유형({[k]:string}|null) — 필요한 키를 방어적으로 읽고, 없으면 null(액션 없음).
  const tripId = actionPayload?.tripId;
  if (kind === 'PLAN_B') {
    return tripId ? `/trips/${tripId}/planb` : null;
  }
  if (kind === 'REFLECTION') {
    const date = actionPayload?.date;
    return tripId && date
      ? `/trips/${tripId}/records/reflection/${date}`
      : null;
  }
  return null;
}
