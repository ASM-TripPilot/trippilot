/**
 * 취향 선택 아이콘 카드 타일 shell (TRIP-610 승격) — id-agnostic 순수 프레젠테이션.
 *
 * 온보딩 `PrefStep1Screen`(스타일)·`PrefStep2Screen`(동행)의 로컬 `StyleTile`·`IconTile` 이
 * 거의 같은 shell(아이콘 원형 + 라벨 + 선택 테두리 + 체크 배지)이라 여기로 합친다.
 *
 * ★ 글리프는 승격하지 않는다 — 옵션 아이콘·체크 마크는 raw hex SVG 라 `shared/ui` 재귀 스캔
 *   (`sharedUiStructure.test.ts`)의 raw-hex·className 규칙을 깬다. 그래서 둘 다 **prop 슬롯으로 주입**
 *   받는다(shell 소스에는 글리프가 없다). 호출자가 완성된 `testID` 문자열을 준다(타일이 조립 안 함).
 */
import type { ComponentType, ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/** 주입 글리프 계약 — 온보딩 `GlyphComponent` 가 구조적으로 이 형태와 호환된다. */
export type PrefTileIcon = ComponentType<{ size?: number; selected?: boolean }>;

export interface PrefTileProps {
  /** 호출자가 완성해 주는 testID(온보딩 `onboarding-pref1-style-<slug>` 등). */
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  /** 옵션 아이콘 슬롯(주입, 미주입 허용 — 아이콘 없는 카드도 가능). */
  Icon?: PrefTileIcon;
  /** 선택 시 우상단 배지에 얹을 체크 글리프(주입). 없으면 배지를 그리지 않는다. */
  CheckIcon?: PrefTileIcon;
  /** 크기·간격 등 바깥 컨테이너 치수 오버라이드(StyleTile 104px vs IconTile py-lg 차이). */
  className?: string;
}

export function PrefTile({
  testID,
  label,
  selected,
  onPress,
  Icon,
  CheckIcon,
  className,
}: PrefTileProps): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`relative flex-1 items-center justify-center rounded-card bg-canvas px-sm ${
        selected ? 'border-[1.5px] border-primary' : 'border border-hairline'
      } ${className ?? ''}`}
    >
      {Icon ? (
        <View
          className={`h-12 w-12 items-center justify-center rounded-pill ${
            selected ? 'bg-primary-pale' : 'bg-surface-strong'
          }`}
        >
          <Icon size={24} selected={selected} />
        </View>
      ) : null}
      <Text className="font-noto-bold text-body font-bold text-ink">
        {label}
      </Text>
      {selected && CheckIcon ? (
        <View className="absolute right-[6.5px] top-[6.5px] h-5 w-5 items-center justify-center rounded-pill border-[1.5px] border-canvas bg-primary">
          <CheckIcon size={12} />
        </View>
      ) : null}
    </Pressable>
  );
}
