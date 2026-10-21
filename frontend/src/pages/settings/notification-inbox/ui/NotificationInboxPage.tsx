import { useState, type ReactElement } from 'react';
import { router } from 'expo-router';
import type { Href } from 'expo-router';

import { groupByDay } from '../model/groupByDay';
import { notificationAction } from '../model/notificationAction';
import { notificationKind } from '../model/notificationKind';
import { useNotificationInbox } from '../model/useNotificationInbox';
import {
  NotificationInboxScreen,
  type NotificationRowVM,
  type NotificationSection,
} from './NotificationInboxScreen';
import { formatRelativeTime } from '@/shared/lib/formatRelativeTime';
import type { Notification } from '@/shared/api/index.schemas';

/**
 * TRIP-576 · l01 알림함 페이지(d02 배선 층) — 조회 → groupByDay·VM 조립 → 화면 → router.push.
 *
 * 이 층이 유일하게 정직한 것: 화면은 route 를 콜백으로만 넘기고, 그 콜백을 실제 `router.push` 에 무는
 * 것은 여기다(★2). 판정(notificationKind·notificationAction·formatRelativeTime·groupByDay)은 전부
 * 여기서 한 번 돌려 VM 으로 접어 내리고, 화면·행은 재판정하지 않는다("조합·판정은 한 곳").
 *
 * 스코프: 조회 결과만 렌더(FE 밖 계약은 서버). 조회 실패는 TRIP-1501 로 오류 얼굴 + 다시 시도가 생겼다
 * (판정은 훅 `loadFailed`). 로딩 전용 얼굴은 아직 없다 — 첫 조회 중엔 빈 얼굴이 먼저 보이는 사각(후속 티켓 후보).
 */

/** PLAN_B 인라인 링크 문구(Figma l01). 라우팅 가능할 때만 붙인다(데이터없음이면 null). */
const PLAN_B_ACTION_LABEL = '대안 일정 보기 ›';

/** '모두 읽음' 한 건 이상 실패 안내(INV-4). 전부 실패도 같은 문구(TRIP-773 D2). */
const MARK_ALL_FAILURE = '일부 알림을 읽음 처리하지 못했어요';

function toRowVM(item: Notification, now: Date): NotificationRowVM {
  const { icon, label } = notificationKind(item.kind);
  const route = notificationAction(item.actionType, item.actionPayload);
  return {
    id: item.notificationId,
    icon,
    title: item.title,
    body: item.body,
    meta: `${label} · ${formatRelativeTime(item.occurredAt, now)}`,
    unread: item.readAt == null,
    route,
    inlineActionLabel:
      item.actionType === 'PLANB_REPLAN' && route != null
        ? PLAN_B_ACTION_LABEL
        : null,
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
  const { items, loadFailed, isFetching, refetch, markAllRead, markRead } =
    useNotificationInbox();
  const [markAllPending, setMarkAllPending] = useState(false);
  const [markAllError, setMarkAllError] = useState<string | null>(null);
  const now = new Date();

  function handleNavigate(route: string, notificationId: string): void {
    // 이동이 먼저 — 읽음 응답을 기다리지 않는다. 미읽음 판정은 서버 원본(readAt)으로 여기서 한 번.
    router.push(route as Href);
    const item = items.find((it) => it.notificationId === notificationId);
    if (item != null && item.readAt == null) void markRead(notificationId);
  }

  async function handleMarkAllRead(): Promise<void> {
    setMarkAllError(null);
    setMarkAllPending(true);
    const ok = await markAllRead();
    setMarkAllPending(false);
    if (!ok) setMarkAllError(MARK_ALL_FAILURE);
  }

  return (
    <NotificationInboxScreen
      sections={buildSections(items, now)}
      isEmpty={items.length === 0}
      onNavigate={handleNavigate}
      onPressBack={() => router.back()}
      onMarkAllRead={() => void handleMarkAllRead()}
      markAllPending={markAllPending}
      markAllError={markAllError}
      loadFailed={loadFailed}
      onRetry={() => void refetch()}
      retrying={isFetching}
    />
  );
}
