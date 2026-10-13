import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

import type { PrefTileIcon } from './PrefTile';

/**
 * 아이콘 + 라벨 한 줄 옵션 타일(72px) — 온보딩 취향 1/2 의 「여행 페이스」와 2/2 의 「이동」이 같은 모양이라
 * 합쳤다(TRIP-1360). 호출자가 완성된 `testID` 를 준다. 이동 타일만 좌우 6 패딩이 더 있어 `className` 으로 넘긴다.
 */
export function PrefOptionTile({
  testID,
  label,
  Icon,
  selected,
  onPress,
  className,
}: {
  testID: string;
  label: string;
  Icon: PrefTileIcon;
  selected: boolean;
  onPress: () => void;
  className?: string;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`h-[72px] flex-1 items-center justify-center gap-[6px] rounded-button bg-canvas py-[14px] ${
        className ?? ''
      } ${
        selected ? 'border-[1.5px] border-primary' : 'border border-hairline'
      }`}
    >
      <Icon size={24} selected={selected} />
      <Text
        className={
          selected
            ? 'font-noto-bold text-label font-bold text-primary-text'
            : 'font-noto text-label text-body'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
