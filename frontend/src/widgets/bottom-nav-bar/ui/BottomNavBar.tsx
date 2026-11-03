import type { ReactElement, ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { NavBarLabel } from '@/shared/ui/BottomTabBar';
import { GlassSurface } from '@/shared/ui/GlassSurface';
import { BackChevronGlyph } from '@/shared/ui/glyphs';
import {
  NAV_BAR_CAPSULE_PADDING_X,
  NAV_BAR_CAPSULE_PADDING_Y,
  NAV_BAR_CELL_GAP,
  NAV_BAR_CELL_HEIGHT,
  NAV_BAR_HEIGHT,
  NAV_BAR_ICON_SIZE,
} from '@/shared/ui/navBarLayout';

/**
 * TRIP-1557 · 하단 내비 바 조각(widgets · presentation-only) — 둥근 뒤로·캡슐·칸, 뒤로와 캡슐은 유리 표면.
 * 조립(뒤로 + 캡슐 + 칸 배치)은 `MorphNavBar` 가 하고, 허브(`LiveBottomBar`)와 기록 3종(`RecordNavBar`)이 그걸 쓴다.
 *
 * controlled — 어느 칸이 활성(`selected`)인지·비활성(`disabled`)인지는 부모가 준 값이고 바는 상태를 쥐지 않는다.
 * 비활성 칸은 낭독 상태만이 아니라 `Pressable` 의 `disabled` 로 눌림 자체를 막는다. 위치(화면 아래 띄우기)는 부모 몫이다.
 */

interface NavBarCellProps {
  testID: string;
  label: string;
  icon: ReactNode;
  selected: boolean;
  /** 안 주면 낭독 상태에 "펼침"이 없다(true/false 는 준 그대로 읽힌다). */
  expanded?: boolean;
  /** 눌림 자체를 막고 흐리게 그린다. */
  disabled?: boolean;
  /** 낭독 값(`accessibilityValue.text`) — 비활성 사유·"추천 있음" 같은 보조 설명. 시각 문구는 아니다. */
  value?: string;
  /** 허브 행사 칸 전용 장식 점(낭독에서 뺀다). */
  dot?: boolean;
  onPress: () => void;
}

/** 둥근 뒤로(유리 원). 허브는 이 조각을 모션 래퍼 안에 넣는다. */
export function NavBarBackButton({
  testID,
  onPress,
}: {
  testID: string;
  onPress: () => void;
}): ReactElement {
  return (
    <GlassSurface style={{ height: NAV_BAR_HEIGHT, width: NAV_BAR_HEIGHT }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel="뒤로"
        onPress={onPress}
        style={{ height: NAV_BAR_HEIGHT, width: NAV_BAR_HEIGHT }}
        className="items-center justify-center"
      >
        <BackChevronGlyph size={NAV_BAR_ICON_SIZE} />
      </Pressable>
    </GlassSurface>
  );
}

/** 칸을 담는 유리 캡슐. */
export function NavBarCapsule({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <GlassSurface
      style={{ height: NAV_BAR_HEIGHT }}
      contentClassName="flex-1 flex-row items-center"
      contentStyle={{
        paddingHorizontal: NAV_BAR_CAPSULE_PADDING_X,
        paddingVertical: NAV_BAR_CAPSULE_PADDING_Y,
      }}
    >
      {children}
    </GlassSurface>
  );
}

/** 한 칸 — 아이콘 + 라벨. `dot` 은 허브 행사 칸 전용 장식(낭독에서 뺀다). */
export function NavBarCell({
  testID,
  label,
  icon,
  selected,
  expanded,
  disabled = false,
  value,
  dot = false,
  onPress,
}: NavBarCellProps): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, expanded, disabled }}
      accessibilityValue={value === undefined ? undefined : { text: value }}
      disabled={disabled}
      onPress={onPress}
      style={{ height: NAV_BAR_CELL_HEIGHT, gap: NAV_BAR_CELL_GAP }}
      className={`items-center justify-center ${disabled ? 'opacity-40' : ''}`}
    >
      <View>
        {icon}
        {dot ? (
          <View
            testID="execution-live-bar-event-dot"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="absolute -right-xs top-0 h-sm w-sm rounded-pill bg-primary"
          />
        ) : null}
      </View>
      <NavBarLabel label={label} selected={selected} />
    </Pressable>
  );
}
