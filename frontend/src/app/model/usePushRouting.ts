import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';

import type { BootstrapDestination } from '@/features/auth/index.view';
import { notificationAction } from '@/pages/settings/notification-inbox';
import {
  getGetMeNotificationsQueryKey,
  getGetTripsTripIdTriggersQueryKey,
} from '@/shared/api/index.hooks';
import type { Notification } from '@/shared/api/index.schemas';
import {
  onPushReceived,
  onPushTapped,
  takeLaunchPushTap,
  type PushEvent,
} from '@/shared/push';

/**
 * 상황 감지 FE-A(frontend-components §2.2) — 푸시를 누르면 알림함 행과 **같은 곳**으로 간다.
 *
 * - 목적지는 알림함과 같은 함수 `notificationAction(data.actionType, data)` 다 — 서버가 탭 data 에 알림함 행의
 *   `{actionType, ...actionPayload}` 를 펼쳐 싣기 때문에 둘이 다른 곳으로 갈 수 없다. 목적지가 없으면(모르는 종류·
 *   필수 필드 없음) 이동하지 않는다(INV-4).
 * - 이동은 스택이 그려진(`drawn`) HOME 에서만 한다. 로그인 전·부팅 중·콜드 스타트 탭은 하나만 보류했다가(마지막 탭)
 *   HOME 이 그려진 커밋 뒤에 한 번 간다 — 스플래시 중(스택 미마운트)엔 라우터 액션이 먹는다는 보장이 없다.
 * - 같은 알림 식별자는 한 번만 — 콜드 스타트 탭은 꺼내기와 탭 리스너 두 길로 올 수 있다.
 * - 수신·탭 때 알림함과 그 여행의 트리거 캐시를 낡게 한다(새 알림 행·새 트리거를 다시 받게).
 *
 * 루트 셸(SplashGate)은 실제 앱에서 언마운트되지 않으므로 구독은 앱 수명 동안 하나다. 실제 탭·이동 시점은 6-b 실기.
 */
export function usePushRouting(
  drawn: boolean,
  destination: BootstrapDestination | null
): void {
  const queryClient = useQueryClient();
  const ready = drawn && destination === 'HOME';
  const readyRef = useRef(ready);
  const pendingRoute = useRef<string | null>(null);

  // 그려진 HOME 이 되면(커밋 뒤) 보류한 탭으로 한 번 간다.
  useEffect(() => {
    readyRef.current = ready;
    const route = pendingRoute.current;
    if (!ready || route == null) return;
    pendingRoute.current = null;
    router.push(route as Href);
  }, [ready]);

  useEffect(() => {
    const handled = new Set<string>();
    let active = true;

    function invalidate({ data }: PushEvent): void {
      void queryClient.invalidateQueries({
        queryKey: getGetMeNotificationsQueryKey(),
      });
      if (typeof data.tripId === 'string' && data.tripId.length > 0) {
        void queryClient.invalidateQueries({
          queryKey: getGetTripsTripIdTriggersQueryKey(data.tripId),
        });
      }
    }

    function handleTap(event: PushEvent | null): void {
      if (!active || event == null || handled.has(event.id)) return;
      handled.add(event.id);
      invalidate(event);
      // data 는 와이어 실물(Map<String,String>) 그대로다 — notificationAction 도 갈래와 무관하게 필드를 런타임에 읽고,
      // 모르는 종류·빠진 필드는 null 로 접는다. 그래서 타입은 단언만 하고 거르지 않는다.
      const route = notificationAction(
        event.data.actionType as Notification['actionType'],
        event.data as unknown as Notification['actionPayload']
      );
      if (route == null) return;
      if (readyRef.current) router.push(route as Href);
      else pendingRoute.current = route;
    }

    const offReceived = onPushReceived(invalidate);
    const offTapped = onPushTapped(handleTap);
    void takeLaunchPushTap().then(handleTap);
    return () => {
      active = false;
      offReceived();
      offTapped();
    };
  }, [queryClient]);
}
