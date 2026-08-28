import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

/**
 * 값-컬럼 휠(스크롤-스냅) 피커 primitive — TRIP-599 신설.
 *
 * shared/ui 라 도메인(라벨·testID 접두)을 모른다 — 소비처가 `renderLabel`·`testIDForValue`
 * 로 주입한다(가장 얕은 형태의 의존성 주입). h07 시작 시각 시트가 첫 소비처다.
 *
 * 값 하나를 세로로 돌려 고르는 컬럼이다: 셀이 셀 높이 간격으로 스냅하고, 가운데 밴드가
 * 지금 걸린 자리를 표시한다. **선택은 셀을 눌러 확정한다** — 스크롤로 가운데 값을 자동
 * 확정하지 않는다(현행 h07 계약이 press→onSelect 라 그걸 보존). 스냅·중앙정렬·관성은 jest
 * 사각이라 6-b 실기로만 확인한다.
 */

// 셀 높이·표시 행 수는 순수 시각값이다(6-b 실기에서 조정하는 눈금). 5행 표시·가운데 1행 강조.
const CELL_HEIGHT = 44;
const VISIBLE_ROWS = 5;
const PAD_ROWS = (VISIBLE_ROWS - 1) / 2;
const COLUMN_HEIGHT = CELL_HEIGHT * VISIBLE_ROWS;
const PAD = CELL_HEIGHT * PAD_ROWS;

export interface WheelPickerProps {
  /** 표시할 값들(h07: `startTimeOptions()`, 48개 HH:mm). */
  values: string[];
  /** 현재 선택값(h07: `form.fixedStart`). null 이면 선택 셀 없음. */
  selected: string | null;
  /** 셀 선택 시(h07: `onPickStart` 후 시트 닫기). */
  onSelect: (value: string) => void;
  /** 값 → 표시 문자열. 없으면 값 그대로(h07: `startTimeLabel`). */
  renderLabel?: (value: string) => string;
  /** 값 → 셀 testID. 없으면 testID 없음(h07: `itinerary-mustvisit-time-start-option-${v}`). */
  testIDForValue?: (value: string) => string;
}

export function WheelPicker({
  values,
  selected,
  onSelect,
  renderLabel,
  testIDForValue,
}: WheelPickerProps): ReactElement {
  // 선택값을 열자마자 가운데로 — contentOffset 은 스크롤 시작 위치다. 위 패딩이 PAD 라
  // 인덱스*셀높이만큼 밀면 그 셀이 가운데 밴드에 온다(없으면 맨 위). 관성/재정렬은 6-b.
  const selectedIndex = selected === null ? -1 : values.indexOf(selected);
  const initialOffset = selectedIndex < 0 ? 0 : selectedIndex * CELL_HEIGHT;

  return (
    <View className="w-full items-center">
      <View className="relative w-full" style={{ height: COLUMN_HEIGHT }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          snapToInterval={CELL_HEIGHT}
          decelerationRate="fast"
          contentOffset={{ x: 0, y: initialOffset }}
          contentContainerStyle={{ paddingVertical: PAD }}
        >
          {values.map((value) => {
            const isSelected = value === selected;
            return (
              <Pressable
                key={value}
                testID={testIDForValue?.(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelect(value)}
                style={{ height: CELL_HEIGHT }}
                className="w-full items-center justify-center"
              >
                <Text
                  className={`text-card-title ${
                    isSelected
                      ? 'font-noto-bold font-bold text-primary'
                      : 'font-noto text-ink'
                  }`}
                >
                  {renderLabel ? renderLabel(value) : value}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* 가운데 강조 밴드 — pointerEvents none 이라 아래 셀 press 를 안 삼킨다. 테두리만 두고
            속은 비워, 가운데 걸린 셀을 위아래 선으로 감싼다. */}
        <View
          pointerEvents="none"
          className="absolute left-0 right-0 border-y border-hairline-strong"
          style={{ top: PAD, height: CELL_HEIGHT }}
        />
      </View>
    </View>
  );
}
