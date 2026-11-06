import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

/**
 * 그림 위 작은 이름 알약(TRIP-1806). 이름이 없으면 아무것도 안 그려 표면이 분기 없이 한 줄로 쓴다.
 * 위치는 소비처 className. `/60` 은 번들 107장 전부에서 흰 글자 대비 4.5 이상이 되는 값이다(`/50` 은 밝은 그림에서 모자란다).
 */
export function CoverLabel({
  label,
  testID,
  className = '',
}: {
  label?: string | null;
  testID: string;
  className?: string;
}): ReactElement | null {
  if (!label) return null;
  return (
    <View
      testID={testID}
      pointerEvents="none"
      className={`rounded-pill bg-scrim/60 px-sm py-[3px] ${className}`}
    >
      <Text numberOfLines={1} className="font-noto text-micro text-on-primary">
        {label}
      </Text>
    </View>
  );
}
