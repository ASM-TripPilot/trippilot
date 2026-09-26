import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { NotificationToggleKind } from '@/shared/api/generated/schemas';
import { Toggle } from '@/shared/ui/Toggle';

/**
 * l02 알림 설정 — 종류 한 행(라벨 + 푸시·인앱 두 토글). 카드 안에서 6번 반복된다.
 *
 * 토글 스위치는 공유 `shared/ui/Toggle`(TRIP-780 승격 — l06·개인화와 같은 부품)이다. 접근성·real
 * `disabled` 계약은 그 부품이 진다(jest `toBeChecked`/`toBeDisabled` 매처가 읽는다).
 *
 * 푸시 열은 `pushColumnAvailable`(OS 권한) 로 게이트한다 — 거부면 checked=false·real disabled·회색.
 * 인앱 열은 권한과 무관하게 항상 조작 가능하다(DENIED 에서도 켜고 끌 수 있다).
 * `showPushColumn` 이 false 면 푸시 열을 통째로 그리지 않는다(TRIP-939 — 푸시 수신 미배선 동안 숨김).
 */

export interface ToggleRowProps {
  kind: NotificationToggleKind;
  label: string;
  value: { pushEnabled: boolean; inAppEnabled: boolean };
  /** false(OS 권한 거부) 면 푸시 스위치가 real disabled + 회색(thumb 좌측). */
  pushColumnAvailable: boolean;
  /** 푸시 열을 그릴지(화면의 개통 플래그). false 면 인앱 열만 남는다. */
  showPushColumn: boolean;
  onToggle: (
    kind: NotificationToggleKind,
    channel: 'push' | 'inapp',
    next: boolean
  ) => void;
  /** 카드 안 두 번째 행부터 상단 구분선을 그린다(첫 행은 없음). */
  showDivider: boolean;
}

export function ToggleRow({
  kind,
  label,
  value,
  pushColumnAvailable,
  showPushColumn,
  onToggle,
  showDivider,
}: ToggleRowProps): ReactElement {
  return (
    <>
      {/* 구분선을 border 로 그리지 않는다 — `border-hairline` 은 색만이 아니라 NativeWind 프리셋의
          borderWidth `hairline` 과 이름이 겹쳐 네 변 모두에 선을 깔고, 마지막 행 아래 변이 카드의
          둥근 모서리 밖으로 각지게 비친다(TRIP-774 04b). */}
      {showDivider ? <View className="h-px bg-hairline" /> : null}
      <View className="flex-row items-center px-lg py-[15px]">
        <Text className="flex-1 pr-md text-[14.5px] font-noto-bold text-ink">
          {label}
        </Text>
        <View className="flex-row gap-lg">
          {showPushColumn ? (
            <View className="w-[46px] items-center">
              <Toggle
                testID={`notification-settings-toggle-push-${kind}`}
                accessibilityLabel={`${label} 푸시`}
                checked={pushColumnAvailable && value.pushEnabled}
                disabled={!pushColumnAvailable}
                onPress={() => onToggle(kind, 'push', !value.pushEnabled)}
              />
            </View>
          ) : null}
          <View className="w-[46px] items-center">
            <Toggle
              testID={`notification-settings-toggle-inapp-${kind}`}
              accessibilityLabel={`${label} 인앱`}
              checked={value.inAppEnabled}
              onPress={() => onToggle(kind, 'inapp', !value.inAppEnabled)}
            />
          </View>
        </View>
      </View>
    </>
  );
}
