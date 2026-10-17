import { useQueryClient } from '@tanstack/react-query';

import {
  getGetMeNotificationsQueryKey,
  postMeNotificationsNotificationIdRead,
  postMeNotificationsReadAll,
  useGetMeNotifications,
} from '@/shared/api/index.hooks';
import type { Notification } from '@/shared/api/index.schemas';

/**
 * TRIP-576 · l01 — `useGetMeNotifications` 를 얇게 감싸는 도메인 훅(catch-up 뷰).
 * 그룹핑·VM 조립은 페이지가 한다(groupByDay·notificationKind·notificationAction·formatRelativeTime).
 */

export interface UseNotificationInboxResult {
  items: Notification[];
  isLoading: boolean;
  isError: boolean;
  /** 미읽음 전부 읽음 처리(`POST /me/notifications/read-all` 1회). 실패하면 false. */
  markAllRead: () => Promise<boolean>;
  /** 알림 1건 읽음(`POST /me/notifications/{id}/read`). 응답이 끝나면 성공·실패 무관 재조회. */
  markRead: (notificationId: string) => Promise<void>;
}

export function useNotificationInbox(): UseNotificationInboxResult {
  const query = useGetMeNotifications();
  const queryClient = useQueryClient();
  const items = query.data?.items ?? [];

  async function markAllRead(): Promise<boolean> {
    // 계정 전체 미읽음을 한 문장으로 처리한다(부분 성공 없음·204 본문 없음·받아 온 목록 밖까지).
    let ok = true;
    try {
      await postMeNotificationsReadAll();
    } catch {
      ok = false;
    }
    // 성공·실패와 무관하게 응답이 끝난 뒤 서버 정본으로 다시 받는다 — 서버가 무엇을 읽음 처리했는지
    // 본문이 없어 모르고, 타임아웃 뒤 커밋 같은 모호함도 재조회만 해소한다.
    // 접두 키라 params 붙은 변형까지 함께 낡음 처리된다.
    await queryClient.invalidateQueries({
      queryKey: getGetMeNotificationsQueryKey(),
    });
    return ok;
  }

  async function markRead(notificationId: string): Promise<void> {
    // 실패는 안내 없이 삼킨다 — 재조회한 서버 정본이 점을 그대로 남겨 정직하게 드러낸다(INV-4).
    // 컴포넌트 콜백(onSettled)이 아니라 이 함수가 끝까지 기다려 무효화하므로, 이동으로 알림함이
    // 내려가도 앱 공용 queryClient 캐시는 낡음 처리된다.
    try {
      await postMeNotificationsNotificationIdRead(notificationId);
    } catch {
      // 의도적으로 비움.
    }
    await queryClient.invalidateQueries({
      queryKey: getGetMeNotificationsQueryKey(),
    });
  }

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    markAllRead,
    markRead,
  };
}
