import type { ReactElement } from 'react';
import { router } from 'expo-router';
import type { Href } from 'expo-router';

import { groupByDay } from '@/features/notification/model/groupByDay';
import { notificationAction } from '@/features/notification/model/notificationAction';
import { notificationKind } from '@/features/notification/model/notificationKind';
import { useNotificationInbox } from '@/features/notification/model/useNotificationInbox';
import {
  NotificationInboxScreen,
  type NotificationRowVM,
  type NotificationSection,
} from '@/features/notification/ui/NotificationInboxScreen';
import { formatRelativeTime } from '@/shared/date/formatRelativeTime';
import type { Notification } from '@/shared/api/generated/schemas';

/**
 * TRIP-576 · l01 알림함 페이지(d02 배선 층) — 조회 → groupByDay·VM 조립 → 화면 → router.push.
 *
 * 이 층이 유일하게 정직한 것: 화면은 route 를 콜백으로만 넘기고, 그 콜백을 실제 `router.push` 에 무는
 * 것은 여기다(★2). 판정(notificationKind·notificationAction·formatRelativeTime·groupByDay)은 전부
 * 여기서 한 번 돌려 VM 으로 접어 내리고, 화면·행은 재판정하지 않는다("조합·판정은 한 곳").
 *
 * 스코프: 조회 결과만 렌더(FE 밖 계약은 서버). 로딩·오류 전용 얼굴은 이번 AC·testID 밖 → 후속(현재
 * 오류는 items 없음으로 접혀 empty 얼굴로 정직히 degrade하지 않는 사각 — 03 참고, 후속 티켓 후보).
 */

/** PLAN_B 인라인 링크 문구(Figma l01). 라우팅 가능할 때만 붙인다(데이터없음이면 null). */
const PLAN_B_ACTION_LABEL = '대안 일정 보기 ›';

function toRowVM(item: Notification, now: Date): NotificationRowVM {
  const { icon, label } = notificationKind(item.kind);
  const route = notificationAction(
    item.kind,
    item.actionType,
    item.actionPayload
  );
  return {
    id: item.notificationId,
    icon,
    title: item.title,
    body: item.body,
    meta: `${label} · ${formatRelativeTime(item.occurredAt, now)}`,
    unread: item.readAt == null,
    route,
    inlineActionLabel:
      item.kind === 'PLAN_B' && route != null ? PLAN_B_ACTION_LABEL : null,
  };
}

function buildSections(
  items: Notification[],
  now: Date
): NotificationSection[] {
  const { today, earlier } = groupByDay(items, now);
  const sections: NotificationSection[] = [];
  if (today.length > 0) {
    sections.push({
      key: 'today',
      label: '오늘',
      rows: today.map((item) => toRowVM(item, now)),
    });
  }
  if (earlier.length > 0) {
    sections.push({
      key: 'earlier',
      label: '이전',
      rows: earlier.map((item) => toRowVM(item, now)),
    });
  }
  return sections;
}

export function NotificationInboxPage(): ReactElement {
  const { items } = useNotificationInbox();
  const now = new Date();

  return (
    <NotificationInboxScreen
      sections={buildSections(items, now)}
      isEmpty={items.length === 0}
      onNavigate={(route) => router.push(route as Href)}
      onPressBack={() => router.back()}
    />
  );
}
