/**
 * 하단 5탭 셸 — 순수 뷰(TRIP-170 · Q4 전면 커스텀 · Figma BottomTab/1236:1177 정합).
 * 네비게이션을 전혀 모른다 — activeKey·onPressTab prop만으로 동작한다. 실 라우팅 상태→
 * activeKey 매핑과 press→navigate 배선은 `app/(tabs)/_layout.tsx` 어댑터의 책임이다(경계는
 * 그 파일에 둔다 — 이 컴포넌트가 shared/ui에 있는 이유는 탭바가 특정 도메인 feature가
 * 아니라서다).
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type ShellTabKey = 'home' | 'explore' | 'itinerary' | 'records' | 'my';

export interface BottomTabBarProps {
  activeKey: ShellTabKey;
  onPressTab: (key: ShellTabKey) => void;
}

// 탭바 전용 아이콘 색 — screens/ 스코프 밖(shared/ui)이라 raw hex가 D-3 가드 대상이 아니다.
const PRIMARY = '#FF385C';
const MUTED = '#6A6A6A';

type TabIconProps = { size?: number };

function HomeIconActive({ size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3L3 11H5V20C5 20.55 5.45 21 6 21H10V15C10 13.9 10.9 13 12 13C13.1 13 14 13.9 14 15V21H18C18.55 21 19 20.55 19 20V11H21L12 3Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}
function HomeIconInactive({ size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 11L12 4L20 11"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6 10V19C6 19.55 6.45 20 7 20H10V15C10 14.45 10.45 14 11 14H13C13.55 14 14 14.45 14 15V20H17C17.55 20 18 19.55 18 19V10"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ExploreIconActive({ size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} fill={PRIMARY} />
      <Path d="M15.5 8.5L13 13L8.5 15.5L11 11L15.5 8.5Z" fill="#ffffff" />
    </Svg>
  );
}
function ExploreIconInactive({ size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={MUTED} strokeWidth={1.8} />
      <Path
        d="M15 9L13 13L9 15L11 11L15 9Z"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ItineraryIconActive({ size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={4.5} width={16} height={16} rx={2.5} fill={PRIMARY} />
      <Rect x={4} y={8.5} width={16} height={1.6} fill="#ffffff" />
      <Rect x={7.5} y={2.7} width={1.6} height={3} rx={0.8} fill={PRIMARY} />
      <Rect x={14.9} y={2.7} width={1.6} height={3} rx={0.8} fill={PRIMARY} />
    </Svg>
  );
}
function ItineraryIconInactive({ size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={4}
        y={4.5}
        width={16}
        height={16}
        rx={2.5}
        stroke={MUTED}
        strokeWidth={1.8}
      />
      <Path d="M4 9.5H20" stroke={MUTED} strokeWidth={1.8} />
      <Path d="M8 3V7" stroke={MUTED} strokeWidth={1.8} strokeLinecap="round" />
      <Path
        d="M16 3V7"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function RecordsIconActive({ size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 4H18V21L12 17L6 21V4Z" fill={PRIMARY} />
    </Svg>
  );
}
function RecordsIconInactive({ size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 4H18V21L12 17L6 21V4Z"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function MyIconActive({ size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} fill={PRIMARY} />
      <Path
        d="M12 13C8.3 13 5.3 15.1 4.5 18.5C4.3 19.3 4.9 20 5.7 20H18.3C19.1 20 19.7 19.3 19.5 18.5C18.7 15.1 15.7 13 12 13Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}
function MyIconInactive({ size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} stroke={MUTED} strokeWidth={1.8} />
      <Path
        d="M4.5 20C5.3 16.6 8.3 14.5 12 14.5C15.7 14.5 18.7 16.6 19.5 20"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 5탭 구성(키↔라벨↔글리프 쌍) — Figma 고정이라 prop 자유도를 주지 않는다(브리프 §4-D).
const TAB_CONFIG: {
  key: ShellTabKey;
  label: string;
  ActiveIcon: (props: TabIconProps) => ReactElement;
  InactiveIcon: (props: TabIconProps) => ReactElement;
}[] = [
  {
    key: 'home',
    label: '홈',
    ActiveIcon: HomeIconActive,
    InactiveIcon: HomeIconInactive,
  },
  {
    key: 'explore',
    label: '탐색',
    ActiveIcon: ExploreIconActive,
    InactiveIcon: ExploreIconInactive,
  },
  {
    key: 'itinerary',
    label: '일정',
    ActiveIcon: ItineraryIconActive,
    InactiveIcon: ItineraryIconInactive,
  },
  {
    key: 'records',
    label: '기록',
    ActiveIcon: RecordsIconActive,
    InactiveIcon: RecordsIconInactive,
  },
  {
    key: 'my',
    label: '마이',
    ActiveIcon: MyIconActive,
    InactiveIcon: MyIconInactive,
  },
];

export function BottomTabBar({
  activeKey,
  onPressTab,
}: BottomTabBarProps): ReactElement {
  return (
    <View
      testID="shell-tabbar-root"
      className="h-[74px] w-full flex-row border-t border-hairline bg-canvas pb-md pt-sm"
    >
      {TAB_CONFIG.map(({ key, label, ActiveIcon, InactiveIcon }) => {
        const selected = key === activeKey;
        return (
          <Pressable
            key={key}
            testID={`shell-tabbar-tab-${key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onPressTab(key)}
            className="flex-1 items-center gap-[4px] pt-[4px]"
          >
            {selected ? (
              <View testID={`shell-tabbar-icon-${key}-active`}>
                <ActiveIcon size={24} />
              </View>
            ) : (
              <View testID={`shell-tabbar-icon-${key}-inactive`}>
                <InactiveIcon size={24} />
              </View>
            )}
            <Text
              className={
                selected
                  ? 'font-noto-bold text-[11px] font-bold text-primary'
                  : 'font-noto text-[11px] text-muted'
              }
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
