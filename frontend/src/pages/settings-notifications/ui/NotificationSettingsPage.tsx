import { type ReactElement, useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import {
  type PushPermission,
  resolvePushColumn,
} from '@/features/notification/model/channelAvailability';
import { useToggles } from '@/features/notification/model/useToggles';
import {
  NotificationSettingsScreen,
  type ToggleValueMap,
} from '@/features/notification/ui/NotificationSettingsScreen';
import { getPushPermission } from '@/shared/push';

/**
 * l02 알림 설정 배선(pages 층) — 서버 토글(`useToggles`)과 로컬 OS 권한(`getPushPermission`)을 잇는다.
 *
 * 권한은 서버 미러가 없어(NotificationToggle 계약에 필드 없음) 이 페이지가 로컬로 읽어 순수
 * `resolvePushColumn` 에 주입한다(PBT-U6-F2 가 그 순수 함수의 반환을 기계 강제) — 화면엔 판정 결과
 * `available` 만 내려간다. 토글 실패의 롤백·outcome 은 `useToggles` 가 이행한다(INV-4).
 */
export function NotificationSettingsPage(): ReactElement {
  const router = useRouter();
  const { items, toggle } = useToggles();
  const [permission, setPermission] = useState<PushPermission>('UNDETERMINED');

  useEffect(() => {
    let active = true;
    void getPushPermission().then((next) => {
      if (active) setPermission(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const values: ToggleValueMap = {};
  for (const item of items) {
    values[item.kind] = {
      pushEnabled: item.pushEnabled,
      inAppEnabled: item.inAppEnabled,
    };
  }

  // 열 가용성 판정은 순수 함수에만 산다(PBT 대상). cellsOn 은 화면이 checked 를 직접 파생하므로
  // 페이지는 available 만 읽는다 — 함수는 그대로 두어 불변식(권한 없으면 활성 미반환)을 잠근다.
  const { available } = resolvePushColumn(permission, items);

  return (
    <NotificationSettingsScreen
      values={values}
      pushColumnAvailable={available}
      onToggle={(kind, channel, next) => {
        void toggle(kind, channel, next);
      }}
      onOpenSettings={() => {
        void Linking.openSettings();
      }}
      onPressBack={() => router.back()}
    />
  );
}
