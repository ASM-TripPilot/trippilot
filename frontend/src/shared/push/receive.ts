import * as Notifications from 'expo-notifications';

/**
 * 상황 감지 FE-A · shared/push — 푸시 **수신·탭의 입구**(권한·토큰은 permissions·request·register 소관).
 *
 * expo-notifications 의 포그라운드 수신·탭·콜드 스타트 탭을 앱이 읽는 모양 `PushEvent` 하나로 접는다.
 * 어디로 갈지·무슨 캐시를 낡게 할지는 모른다 — 그 판정은 앱 층 `usePushRouting` 이 알림함과 같은 함수로 한다.
 * 실제 OS 수신·배너 표시는 jest 사각이다(6-b 실기 — T-RD-1·2).
 */

/** 푸시 한 건 — 앱이 읽는 것은 식별자와 data 뿐이다. */
export interface PushEvent {
  /** 알림 식별자. 같은 탭이 두 길(콜드 스타트 조회·탭 리스너)로 와도 한 번만 처리하는 열쇠다. */
  id: string;
  /** 서버가 `{actionType, ...actionPayload}` 를 펼쳐 싣는다 — 알림함 행과 같은 재료(PushDispatchService). */
  data: Record<string, unknown>;
}

function toPushEvent(notification: Notifications.Notification): PushEvent {
  const { identifier, content } = notification.request;
  // 타입은 data 를 늘 객체라 하지만, 서버가 data 없이 보낸 알림은 비어 올 수 있다 — 읽다 죽지 않게 빈 객체로.
  return { id: identifier, data: content.data ?? {} };
}

/**
 * 앱이 켜져 있어도 푸시가 배너·알림 목록에 보이게 한다(설치 전 기본값은 "보이지 않음").
 * 앱 진입 모듈 최상위에서 한 번 부른다(`AppProviders`).
 */
export function installForegroundPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      // 안드로이드는 false 면 알림을 무음으로 만들어 배너가 내려오지 않는다 — 소리는 알림·채널 설정을 그대로 따른다.
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** 앱이 켜진 채 받은 푸시를 구독한다. 돌려준 함수로 해제한다. */
export function onPushReceived(
  listener: (event: PushEvent) => void
): () => void {
  const subscription = Notifications.addNotificationReceivedListener(
    (notification) => listener(toPushEvent(notification))
  );
  return () => subscription.remove();
}

/**
 * 사용자가 누른 푸시를 구독한다(앱이 켜져 있거나 백그라운드일 때). 돌려준 함수로 해제한다.
 * 넘긴 탭은 OS 의 "마지막 응답" 칸에서도 지운다 — 실물은 켜진 앱의 탭도 그 칸에 남겨서, 두면 루트가 다시 마운트될 때
 * (안드로이드 Activity 재생성 — JS 런타임은 그대로) `takeLaunchPushTap` 이 이미 처리한 탭을 또 꺼낸다. 지우기 실패는 삼킨다.
 */
export function onPushTapped(listener: (event: PushEvent) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
      listener(toPushEvent(response.notification));
    }
  );
  return () => subscription.remove();
}

/**
 * 앱을 켠 탭(콜드 스타트)을 꺼낸 뒤 지운다 — 같은 탭을 다음에 또 처리하지 않게. 없거나 실패하면 null(던지지 않는다).
 */
export async function takeLaunchPushTap(): Promise<PushEvent | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (response == null) return null;
    await Notifications.clearLastNotificationResponseAsync();
    return toPushEvent(response.notification);
  } catch {
    return null;
  }
}
