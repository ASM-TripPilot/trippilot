import { useGetMeNotifications } from '@/shared/api/generated/notification/notification';
import type { Notification } from '@/shared/api/generated/schemas';

/**
 * TRIP-576 · l01 — `useGetMeNotifications` 를 얇게 감싸는 도메인 훅(catch-up 뷰).
 * 그룹핑·VM 조립은 페이지가 한다(groupByDay·notificationKind·notificationAction·formatRelativeTime).
 */

export interface UseNotificationInboxResult {
  items: Notification[];
  isLoading: boolean;
  isError: boolean;
}

export function useNotificationInbox(): UseNotificationInboxResult {
  const query = useGetMeNotifications();
  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
