import type { ReactElement } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

/**
 * 값-컬럼 휠(스크롤-스냅) 피커 primitive — TRIP-599 신설.
 *
 * shared/ui 라 도메인(라벨·testID 접두)을 모른다 — 소비처가 `renderLabel`·`testIDForValue`
 * 로 주입한다(가장 얕은 형태의 의존성 주입). h07 시작 시각 시트가 첫 소비처다.
 *
 * 값 하나를 세로로 돌려 고르는 컬럼이다: 셀이 셀 높이 간격으로 스냅하고, 가운데 밴드가
 * 지금 걸린 자리를 표시한다. **선택은 두 길로 확정한다** — 셀을 누르거나, 스크롤이 멈추면
 * (`onMomentumScrollEnd`) 가운데 걸린 값으로(TRIP-990 D21 — 굴린 값이 말없이 버려지던 #049).
 * 스냅·중앙정렬·관성, 관성 없이 손을 뗄 때 정지 이벤트가 오는지는 jest 사각이라 6-b 실기로만 확인한다.
 */

// 셀 높이·표시 행 수는 순수 시각값이다(6-b 실기에서 조정하는 눈금). 5행 표시·가운데 1행 강조.
// 셀 높이는 스크롤 위치 → 칸 번호 환산에도 쓰여 export 한다(테스트가 정지 위치를 이 값으로 만든다).
export const WHEEL_CELL_HEIGHT = 44;
const CELL_HEIGHT = WHEEL_CELL_HEIGHT;
const VISIBLE_ROWS = 5;
const PAD_ROWS = (VISIBLE_ROWS - 1) / 2;
const COLUMN_HEIGHT = CELL_HEIGHT * VISIBLE_ROWS;
const PAD = CELL_HEIGHT * PAD_ROWS;

export interface WheelPickerProps {
  /** 표시할 값들(h07: `startTimeOptions()`, 48개 HH:mm). */
  values: string[];
  /** 현재 선택값(h07: `form.fixedStart`). null 이면 선택 셀 없음. */
  selected: string | null;
  /** 셀 press 또는 스크롤 정지 시 가운데 값(h07: `onPickStart`). */
  onSelect: (value: string) => void;
  /** 값 → 표시 문자열. 없으면 값 그대로(h07: `startTimeLabel`). */
  renderLabel?: (value: string) => string;
  /** 값 → 셀 testID. 없으면 testID 없음(h07: `itinerary-mustvisit-time-start-option-${v}`). */
  testIDForValue?: (value: string) => string;
  /** 휠 ScrollView 의 testID(스크롤 정지 이벤트를 쏠 손잡이). */
  testID?: string;
}

export function WheelPicker({
  values,
  selected,
  onSelect,
  renderLabel,
  testIDForValue,
  testID,
}: WheelPickerProps): ReactElement {
  // 선택값을 가운데로 — 위 패딩이 PAD 라 인덱스*셀높이만큼 밀면 그 셀이 가운데 밴드에 온다(없으면
  // 맨 위). contentOffset 은 처음 한 번만이 아니라 **값이 바뀔 때마다** 네이티브가 그 위치로 옮긴다
  // (RN 0.81 iOS Fabric·Android 모두). 그래서 selected 가 바뀌면 휠도 따라 움직인다. 관성은 6-b.
  const selectedIndex = selected === null ? -1 : values.indexOf(selected);
  const selectedOffset = selectedIndex < 0 ? 0 : selectedIndex * CELL_HEIGHT;

  // 멈춘 위치 y 는 selectedOffset 과 같은 좌표계라 y / 셀높이 를 반올림하면 가운데 칸이다. 양 끝을
  // 넘은 값(바운스)은 첫/마지막 값으로 자른다. contentOffset 만 쓴다(다른 측정값은 jest 에 없다).
  const handleSettle = (
    event: NativeSyntheticEvent<NativeScrollEvent>
  ): void => {
    const raw = Math.round(event.nativeEvent.contentOffset.y / CELL_HEIGHT);
    const index = Math.min(Math.max(raw, 0), values.length - 1);
    const value = values[index];
    if (value !== undefined) onSelect(value);
  };

  return (
    <View className="w-full items-center">
      <View className="relative w-full" style={{ height: COLUMN_HEIGHT }}>
        <ScrollView
          testID={testID}
          onMomentumScrollEnd={handleSettle}
          showsVerticalScrollIndicator={false}
          snapToInterval={CELL_HEIGHT}
          decelerationRate="fast"
          contentOffset={{ x: 0, y: selectedOffset }}
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
