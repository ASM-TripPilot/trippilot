import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { GlassSurface } from '@/shared/ui/GlassSurface';
import { BackChevronGlyph } from '@/shared/ui/glyphs';

import {
  NAV_BAR_CAPSULE_PADDING_X,
  NAV_BAR_CELL_HEIGHT,
  NAV_BAR_GAP,
  NAV_BAR_HEIGHT,
} from '../config/navBarLayout';

/**
 * TRIP-1557 · 하단 내비 바(widgets · presentation-only) — 왼쪽 둥근 뒤로 + 캡슐 안 N칸, 둘 다 유리 표면.
 * 여행 중 허브(`LiveBottomBar`, 변신 모션을 얹는다)와 j01 방문 기록이 같은 조각을 쓴다.
 *
 * controlled — 어느 칸이 활성(`selected`)인지·비활성(`disabled`)인지는 부모가 준 값이고 바는 상태를 쥐지 않는다.
 * 비활성 칸은 낭독 상태만이 아니라 `Pressable` 의 `disabled` 로 눌림 자체를 막는다. 위치(화면 아래 띄우기)는 부모 몫이다.
 */

export interface NavBarCellSpec {
  key: string;
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
  onPress: () => void;
}

export interface BottomNavBarProps {
  /** 바 루트(뒤로 원 + 캡슐을 담는 행). */
  testID: string;
  backTestID: string;
  onBack: () => void;
  cells: NavBarCellSpec[];
}

// 칸 슬롯 — 같은 캡슐 안 칸들이 폭을 똑같이 나눠 갖는다(3칸이든 4칸이든).
const CELL_SLOT = { flexGrow: 1, flexBasis: 0 } as const;

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
        <BackChevronGlyph size={27} />
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
      contentClassName="flex-1 flex-row items-center py-[2px]"
      contentStyle={{ paddingHorizontal: NAV_BAR_CAPSULE_PADDING_X }}
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
}: Omit<NavBarCellSpec, 'key'> & { dot?: boolean }): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, expanded, disabled }}
      accessibilityValue={value === undefined ? undefined : { text: value }}
      disabled={disabled}
      onPress={onPress}
      style={{ height: NAV_BAR_CELL_HEIGHT }}
      className={`items-center justify-center gap-[3px] ${
        disabled ? 'opacity-40' : ''
      }`}
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
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        className={
          selected
            ? 'font-noto-bold text-micro font-bold text-primary'
            : 'font-noto text-micro text-muted'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function BottomNavBar({
  testID,
  backTestID,
  onBack,
  cells,
}: BottomNavBarProps): ReactElement {
  return (
    <View
      testID={testID}
      pointerEvents="box-none"
      style={{ flexDirection: 'row', alignItems: 'center' }}
    >
      <NavBarBackButton testID={backTestID} onPress={onBack} />
      {/* 뒤로–캡슐 간격은 이 숫자 한 곳에서만 난다(className gap 을 또 두면 겹친다). */}
      <View style={{ flex: 1, marginLeft: NAV_BAR_GAP }}>
        <NavBarCapsule>
          {cells.map(({ key, ...cell }) => (
            <View key={key} style={CELL_SLOT}>
              <NavBarCell {...cell} />
            </View>
          ))}
        </NavBarCapsule>
      </View>
    </View>
  );
}
