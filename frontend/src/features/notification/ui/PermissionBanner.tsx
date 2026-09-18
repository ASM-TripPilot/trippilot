import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { NotifWarningGlyph } from './NotificationGlyphs';

/**
 * l02 permission-denied 상단 대시 배너 — "기기 설정에서 알림 권한을 허용하세요" + [설정 이동] pill.
 *
 * 배너 전체가 Pressable(`notification-settings-permission-banner`) 이라 어디를 눌러도 `onOpenSettings`
 * 가 나간다(안쪽 pill 은 시각 요소, 실제 열기는 `Linking.openSettings` 를 페이지가 배선). 대시 테두리·
 * pill 은 `LocationConsentScreen` 의 denied 배너와 같은 비주얼 언어(border-dashed·rounded-pill).
 */
export function PermissionBanner({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}): ReactElement {
  return (
    <Pressable
      testID="notification-settings-permission-banner"
      accessibilityRole="button"
      onPress={onOpenSettings}
      className="flex-row items-center gap-sm rounded-[20px] border border-dashed border-hairline-strong px-lg py-md"
    >
      <NotifWarningGlyph size={18} />
      <Text className="flex-1 font-noto text-body text-body">
        기기 설정에서 알림 권한을 허용하세요
      </Text>
      <View className="rounded-pill border border-hairline-strong px-md py-xs">
        <Text className="font-noto-bold text-label text-ink">설정 이동</Text>
      </View>
    </Pressable>
  );
}
