import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BackChevronGlyph } from './MapSheetGlyphs';

/**
 * TRIP-783 · 좌상단 오버레이(widgets · presentation-only) — 원형 back 버튼 + 일차 칩. 선택 칩은 primary
 * 채움, 나머지는 흰 배경 + hairline-strong 테두리 pill. 선택은 `accessibilityState.selected` 로 노출해
 * `toBeSelected()` 가 읽는다. 셸이 지도 위 절대 오버레이로 얹는다.
 */

// 원형 back 버튼 그림자. `#000000` 은 브랜드 팔레트(raw-hex 가드 목록) 밖이라 그림자 색으로 정당하다.
const overlayShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.12,
  shadowRadius: 8,
  elevation: 3,
} as const;

export interface DayChip {
  label: string;
}

export interface DayChipOverlayProps {
  days: DayChip[];
  selectedIndex: number;
  onSelectDay: (index: number) => void;
  onBack: () => void;
}

export function DayChipOverlay({
  days,
  selectedIndex,
  onSelectDay,
  onBack,
}: DayChipOverlayProps): ReactElement {
  return (
    <View testID="sheet-daychip-root" className="flex-row items-center gap-sm">
      <Pressable
        testID="sheet-daychip-back"
        onPress={onBack}
        style={overlayShadow}
        className="h-[36px] w-[36px] items-center justify-center rounded-pill bg-canvas"
      >
        <BackChevronGlyph size={20} />
      </Pressable>
      {days.map((day, index) => {
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={day.label}
            testID={`sheet-daychip-${index}`}
            onPress={() => onSelectDay(index)}
            accessibilityState={{ selected }}
            className={`rounded-pill px-md py-[6px] ${selected ? 'bg-primary' : 'border border-hairline-strong bg-canvas'}`}
          >
            <Text
              className={`font-noto-bold text-caption font-bold ${selected ? 'text-on-primary' : 'text-ink'}`}
            >
              {day.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
