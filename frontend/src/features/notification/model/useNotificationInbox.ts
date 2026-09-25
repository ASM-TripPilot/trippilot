import { useQueryClient } from '@tanstack/react-query';

import {
  getGetMeNotificationsQueryKey,
  postMeNotificationsNotificationIdRead,
  useGetMeNotifications,
} from '@/shared/api/generated/notification/notification';
import type { Notification } from '@/shared/api/generated/schemas';

/**
 * TRIP-576 · l01 — `useGetMeNotifications` 를 얇게 감싸는 도메인 훅(catch-up 뷰).
 * 그룹핑·VM 조립은 페이지가 한다(groupByDay·notificationKind·notificationAction·formatRelativeTime).
 */

export interface UseNotificationInboxResult {
  items: Notification[];
  isLoading: boolean;
  isError: boolean;
  /** 미읽음 전부 읽음 처리. 한 건이라도 실패하면 false. */
  markAllRead: () => Promise<boolean>;
}

export function useNotificationInbox(): UseNotificationInboxResult {
  const query = useGetMeNotifications();
  const queryClient = useQueryClient();
  const items = query.data?.items ?? [];

  async function markAllRead(): Promise<boolean> {
    const unreadIds = items
      .filter((item) => item.readAt == null)
      .map((item) => item.notificationId);
    // ponytail: 건별 순회 — 백엔드 POST /me/notifications/read-all 이 있으나 생성 클라이언트에 없다.
    // codegen 재생성 때 한 호출로 바꾼다(부분 실패 자체가 사라짐).
    const results = await Promise.allSettled(
      unreadIds.map((id) => postMeNotificationsNotificationIdRead(id))
    );
    // 성공·실패와 무관하게 전부 끝난 뒤 서버 정본으로 다시 받는다 — 성공분은 반영돼야 하므로.
    // 접두 키라 params 붙은 변형까지 함께 낡음 처리된다.
    await queryClient.invalidateQueries({
      queryKey: getGetMeNotificationsQueryKey(),
    });
    return results.every((result) => result.status === 'fulfilled');
  }

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    markAllRead,
  };
}
