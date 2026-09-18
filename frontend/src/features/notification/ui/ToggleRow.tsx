import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { NotificationToggleKind } from '@/shared/api/generated/schemas';

/**
 * l02 알림 설정 — 종류 한 행(라벨 + 푸시·인앱 두 토글). 카드 안에서 6번 반복된다.
 *
 * 토글 스위치는 `LocationConsentScreen`(606)의 pill 패턴을 인라인으로 복제한다 — features 간
 * import 금지라 직접 재사용은 못 하고, 소비자가 이 화면 하나뿐이라 shared 승격도 안 한다(repo-traps).
 * 접근성: `accessibilityRole="switch"` + `accessibilityState{checked,disabled}` + **real `disabled`**
 * (jest `toBeChecked`/`toBeDisabled` 매처가 이 둘을 읽는다).
 *
 * 푸시 열은 `pushColumnAvailable`(OS 권한) 로 게이트한다 — 거부면 checked=false·real disabled·회색.
 * 인앱 열은 권한과 무관하게 항상 조작 가능하다(DENIED 에서도 켜고 끌 수 있다).
 */

interface SwitchProps {
  testID: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
}

function Switch({
  testID,
  checked,
  disabled,
  onPress,
}: SwitchProps): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-[30px] w-[52px] justify-center rounded-pill px-[3px] ${
        checked ? 'items-end bg-primary' : 'items-start bg-hairline-strong'
      }`}
    >
      <View className="h-6 w-6 rounded-pill bg-canvas" />
    </Pressable>
  );
}

export interface ToggleRowProps {
  kind: NotificationToggleKind;
  label: string;
  value: { pushEnabled: boolean; inAppEnabled: boolean };
  /** false(OS 권한 거부) 면 푸시 스위치가 real disabled + 회색(thumb 좌측). */
  pushColumnAvailable: boolean;
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
  onToggle,
  showDivider,
}: ToggleRowProps): ReactElement {
  return (
    <View
      className={`flex-row items-center py-lg ${
        showDivider ? 'border-t border-hairline' : ''
      }`}
    >
      <Text className="flex-1 pr-md font-noto-bold text-card-title text-ink">
        {label}
      </Text>
      <View className="flex-row gap-md">
        <View className="w-[52px] items-center">
          <Switch
            testID={`notification-settings-toggle-push-${kind}`}
            checked={pushColumnAvailable && value.pushEnabled}
            disabled={!pushColumnAvailable}
            onPress={() => onToggle(kind, 'push', !value.pushEnabled)}
          />
        </View>
        <View className="w-[52px] items-center">
          <Switch
            testID={`notification-settings-toggle-inapp-${kind}`}
            checked={value.inAppEnabled}
            disabled={false}
            onPress={() => onToggle(kind, 'inapp', !value.inAppEnabled)}
          />
        </View>
      </View>
    </View>
  );
}
