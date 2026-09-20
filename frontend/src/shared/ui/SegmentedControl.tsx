import type { ReactElement } from 'react';
import type { ViewStyle } from 'react-native';
import { Pressable, Text, View } from 'react-native';

/**
 * 연결형 세그먼트 컨트롤 — 도메인 무관 공용 부품(shared/ui). 하나의 컨테이너 안에 N개의 셀을
 * 두고 선택 셀만 떠오르는 iOS 식 세그먼트(3개 개별 버튼이 아니다).
 *
 * 컨테이너는 연회색(`bg-hairline`) 알약이고, 선택 셀만 흰 알약(`bg-canvas`)으로 떠오른다(그림자는
 * className 으로 못 주므로 style prop). 미선택 셀은 muted 텍스트다. 선택 여부는 색이 아니라
 * `accessibilityState.selected` 로 관찰 가능하게 둔다 — jest 는 흰 알약·그림자 같은 픽셀을 못 보고
 * (repo-traps 「stay 등록」 세그 절) accessibilityState 만 본다. disabled 셀은 눌러도 onChange 가
 * 불리지 않는다(RN Pressable 계약).
 */
export interface SegmentedOption {
  key: string;
  label: string;
  disabled?: boolean;
  /** 셀 testID. 미지정 시 `segmented-${key}`. 소비처가 자기 스킴을 주입할 수 있다. */
  testID?: string;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  /** 선택된 셀의 key. */
  value: string;
  onChange: (key: string) => void;
  testID?: string;
}

/** 선택 셀 흰 알약의 은은한 그림자 — 색은 토큰이 아닌 순수 그림자라 style prop 으로만 준다. */
const SELECTED_CELL_SHADOW: ViewStyle = {
  shadowColor: '#000',
  shadowOpacity: 0.08,
  shadowRadius: 3,
  shadowOffset: { width: 0, height: 1 },
  elevation: 2,
};

export function SegmentedControl({
  options,
  value,
  onChange,
  testID,
}: SegmentedControlProps): ReactElement {
  return (
    <View
      testID={testID}
      className="w-full flex-row rounded-button bg-hairline p-1"
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            testID={option.testID ?? `segmented-${option.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            disabled={option.disabled}
            onPress={() => onChange(option.key)}
            style={selected ? SELECTED_CELL_SHADOW : undefined}
            className={`h-9 flex-1 items-center justify-center rounded-[9px] ${
              selected ? 'bg-canvas' : ''
            }`}
          >
            <Text
              numberOfLines={1}
              className={`text-label ${
                selected
                  ? 'font-noto-bold font-bold text-ink'
                  : 'font-noto text-muted'
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
