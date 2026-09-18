import type { ReactElement } from 'react';

import { NotificationInboxPage } from '@/pages/notification-inbox';

/**
 * TRIP-576 · l01 알림함 라우트 `/notifications` — d02 얇은 위임(→ NotificationInboxPage).
 * 조회·조합·router 는 페이지가 진다(라우트는 위임만 — G3 3층 책임).
 */
export default function NotificationsRoute(): ReactElement {
  return <NotificationInboxPage />;
}
