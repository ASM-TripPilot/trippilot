import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

import { PlusGlyph } from './RecordGlyphs';

/**
 * TRIP-565 · j01 즉석 방문 추가 버튼(순수 프레젠테이션). 점선 테두리 + ＋ 아이콘 + 라벨.
 *
 * press → onPress(). 즉석 방문의 실제 적재(slotKey=null·MANUAL·다건 append)는 훅 레벨
 * (`useVisitCheck.arrive`)이 지고, 이 버튼은 그 진입점만 낸다.
 */

export interface SpontaneousVisitButtonProps {
  onPress?: () => void;
}

export function SpontaneousVisitButton({
  onPress,
}: SpontaneousVisitButtonProps): ReactElement {
  return (
    <Pressable
      testID="record-trip-spontaneous-add"
      onPress={onPress}
      className="w-full flex-row items-center justify-center gap-sm rounded-button border-[1.4px] border-hairline-strong bg-canvas py-[14px]"
    >
      <PlusGlyph size={18} />
      <Text className="font-noto-bold text-body text-ink">즉석 방문 추가</Text>
    </Pressable>
  );
}
