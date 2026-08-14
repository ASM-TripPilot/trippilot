/**
 * 하단 5탭 셸 — 순수 뷰(TRIP-170 · Q4 전면 커스텀 · Figma BottomTab/1236:1177 정합).
 * 네비게이션을 전혀 모른다 — activeKey·onPressTab prop만으로 동작한다. 실 라우팅 상태→
 * activeKey 매핑과 press→navigate 배선은 `app/(tabs)/_layout.tsx` 어댑터의 책임이다(경계는
 * 그 파일에 둔다 — 이 컴포넌트가 shared/ui에 있는 이유는 탭바가 특정 도메인 feature가
 * 아니라서다).
 *
 * 비주얼은 Figma 마스터 `1236:1177`(TRIP-173 3/4) 위에 TRIP-201 신 치수를 얹었다 — **투명**
 * 84px 밴드(오버레이: 이 탭바 루트가 `absolute bottom-0`이라 화면 위에 떠서 씬이 탭바 높이만큼
 * 줄지 않고 밴드는 배경을 안 진다 — react-navigation 은 커스텀 `tabBar` 렌더프롭에 `tabBarStyle`
 * 을 적용하지 않으므로 `_layout` 옵션이 아니라 탭바 자신이 오버레이를 져야 한다) 위에 옅은
 * 회색 알약(`surface-soft` 토큰, 좌우 16px
 * 여백(px-lg), 반경은 rounded-pill 토큰)이 떠 있고, 아이콘 좌표계는 27x27 이되 렌더 크기는
 * 22px 다(TRIP-201). 알약 배경은 마스터 raw CSS만 보면 반투명 흰색(68%)이지만
 * Figma 프로덕션 화면을 실제로 렌더한 값은 `#F7F7F7`(surface-soft)와 일치한다(스크린샷 대조
 * M-3 — raw 속성 하나만 보고 판단하면 틀린다). 테두리 알파값과 그림자는 토큰이 아니라 raw로
 * 둔다(Q3 — 그림자를 어차피 style 프로퍼티로 넘겨야 해서 추가 비용이 0이다. RN엔 CSS
 * box-shadow가 없다 — HomeScreen.tsx 그림자 관례와 동일). 하단 SafeArea 인셋은 이번엔
 * 합산하지 않는다(Q1 — 별도 게이트가 필요한 계약 변경이라 이연).
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export type ShellTabKey = 'home' | 'explore' | 'itinerary' | 'records' | 'my';

export interface BottomTabBarProps {
  activeKey: ShellTabKey;
  onPressTab: (key: ShellTabKey) => void;
}

// 탭바 전용 아이콘 색 — screens/ 스코프 밖(shared/ui)이라 raw hex가 D-3 가드 대상이 아니다.
const PRIMARY = '#FF385C';
const MUTED = '#6A6A6A';

// 알약 표면 — 배경은 className의 bg-surface-soft 토큰(M-3, 아래 참고)이 맡고, 여기는 테두리
// 50% 반투명 흰색 + 부드러운 그림자만 담당한다(Figma 실측, Q3: 알파값은 토큰이 아니라 raw).
// shadow-* 스타일 프로퍼티로 넘기는 것은 HomeScreen.tsx의 heroCardShadow/softCardShadow와
// 같은 이 리포의 확립된 패턴이다.
const PILL_SURFACE_STYLE = {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.5)',
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.1,
  shadowRadius: 14,
  elevation: 4,
} as const;

type TabIconProps = { size?: number };

function HomeIconActive({ size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 27 27" fill="none">
      <Path
        d="M3.375 11.9249L13.5 3.59995L23.625 11.9249V22.7249C23.625 22.9935 23.5183 23.251 23.3284 23.4409C23.1386 23.6308 22.881 23.7374 22.6125 23.7374H17.4375V16.6499H11.8125V23.7374H4.3875C4.11897 23.7374 3.86143 23.6308 3.67155 23.4409C3.48167 23.251 3.375 22.9935 3.375 22.7249V11.9249Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}
function HomeIconInactive({ size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 27 27" fill="none">
      <Path
        d="M3.375 11.9249L13.5 3.59995L23.625 11.9249V22.4999C23.625 22.7983 23.5065 23.0845 23.2955 23.2954C23.0845 23.5064 22.7984 23.6249 22.5 23.6249H4.5C4.20163 23.6249 3.91548 23.5064 3.7045 23.2954C3.49353 23.0845 3.375 22.7983 3.375 22.4999V11.9249Z"
        stroke={MUTED}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10.35 23.6251V16.6501H16.65V23.6251"
        stroke={MUTED}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ExploreIconActive({ size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 27 27" fill="none">
      <Path
        d="M13.5 23.625C19.0919 23.625 23.625 19.0919 23.625 13.5C23.625 7.90812 19.0919 3.375 13.5 3.375C7.90812 3.375 3.375 7.90812 3.375 13.5C3.375 19.0919 7.90812 23.625 13.5 23.625Z"
        fill={PRIMARY}
      />
      <Path
        d="M17.1 9.90005L14.625 14.6251L9.89999 17.1001L12.375 12.3751L17.1 9.90005Z"
        fill="#ffffff"
      />
    </Svg>
  );
}
function ExploreIconInactive({ size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 27 27" fill="none">
      <Path
        d="M13.5 23.625C19.0919 23.625 23.625 19.0919 23.625 13.5C23.625 7.90812 19.0919 3.375 13.5 3.375C7.90812 3.375 3.375 7.90812 3.375 13.5C3.375 19.0919 7.90812 23.625 13.5 23.625Z"
        stroke={MUTED}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17.1 9.90005L14.625 14.6251L9.89999 17.1001L12.375 12.3751L17.1 9.90005Z"
        stroke={MUTED}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ItineraryIconActive({ size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 27 27" fill="none">
      <Path
        d="M20.475 5.17511H6.52501C4.90958 5.17511 3.60001 6.48468 3.60001 8.10011V20.2501C3.60001 21.8655 4.90958 23.1751 6.52501 23.1751H20.475C22.0904 23.1751 23.4 21.8655 23.4 20.2501V8.10011C23.4 6.48468 22.0904 5.17511 20.475 5.17511Z"
        fill={PRIMARY}
      />
      <Path d="M3.60001 10.5749H23.4" stroke="#ffffff" strokeWidth={1.8} />
    </Svg>
  );
}
function ItineraryIconInactive({ size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 27 27" fill="none">
      <Path
        d="M20.475 5.17511H6.52501C4.90958 5.17511 3.60001 6.48468 3.60001 8.10011V20.2501C3.60001 21.8655 4.90958 23.1751 6.52501 23.1751H20.475C22.0904 23.1751 23.4 21.8655 23.4 20.2501V8.10011C23.4 6.48468 22.0904 5.17511 20.475 5.17511Z"
        stroke={MUTED}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.60001 10.5749H23.4"
        stroke={MUTED}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 2.92511V6.75011"
        stroke={MUTED}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M18 2.92511V6.75011"
        stroke={MUTED}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function RecordsIconActive({ size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 27 27" fill="none">
      <Path
        d="M6.75 3.59995H20.25C20.5484 3.59995 20.8345 3.71847 21.0455 3.92945C21.2565 4.14043 21.375 4.42658 21.375 4.72494V23.3999L13.5 19.1249L5.625 23.3999V4.72494C5.625 4.42658 5.74353 4.14043 5.95451 3.92945C6.16548 3.71847 6.45163 3.59995 6.75 3.59995Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}
function RecordsIconInactive({ size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 27 27" fill="none">
      <Path
        d="M6.75 3.59995H20.25C20.5484 3.59995 20.8345 3.71847 21.0455 3.92945C21.2565 4.14043 21.375 4.42658 21.375 4.72494V23.3999L13.5 19.1249L5.625 23.3999V4.72494C5.625 4.42658 5.74353 4.14043 5.95451 3.92945C6.16548 3.71847 6.45163 3.59995 6.75 3.59995Z"
        stroke={MUTED}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function MyIconActive({ size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 27 27" fill="none">
      <Path
        d="M13.5 13.2749C15.861 13.2749 17.775 11.361 17.775 8.99995C17.775 6.63893 15.861 4.72495 13.5 4.72495C11.139 4.72495 9.22501 6.63893 9.22501 8.99995C9.22501 11.361 11.139 13.2749 13.5 13.2749Z"
        fill={PRIMARY}
      />
      <Path
        d="M5.39999 23.1749C5.39999 18.5624 8.99999 15.6374 13.5 15.6374C18 15.6374 21.6 18.5624 21.6 23.1749H5.39999Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}
function MyIconInactive({ size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 27 27" fill="none">
      <Path
        d="M13.5 13.0499C15.7368 13.0499 17.55 11.2366 17.55 8.99989C17.55 6.76314 15.7368 4.94989 13.5 4.94989C11.2633 4.94989 9.45003 6.76314 9.45003 8.99989C9.45003 11.2366 11.2633 13.0499 13.5 13.0499Z"
        stroke={MUTED}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.39999 22.9499C5.39999 18.4499 8.99999 15.4124 13.5 15.4124C18 15.4124 21.6 18.4499 21.6 22.9499"
        stroke={MUTED}
        strokeWidth={2.25}
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
      // 밴드는 투명 오버레이라 콘텐츠 위 84px를 덮는다. box-none으로 밴드 자신은 터치를
      // 삼키지 않고(투명 여백 아래 스크롤·탭이 그대로 통과) 자식(알약)만 터치를 받는다
      // (code-critic N1 — RN 순수 View는 투명해도 터치를 흡수한다).
      pointerEvents="box-none"
      className="absolute inset-x-0 bottom-0 h-[84px] px-lg pb-md pt-[26px]"
    >
      <View
        className="h-[46px] flex-row rounded-pill bg-surface-soft px-[10px] py-[2px]"
        style={PILL_SURFACE_STYLE}
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
              className="w-[67.6px] items-center gap-xs pt-xs pb-[2px]"
            >
              {selected ? (
                <View testID={`shell-tabbar-icon-${key}-active`}>
                  <ActiveIcon size={22} />
                </View>
              ) : (
                <View testID={`shell-tabbar-icon-${key}-inactive`}>
                  <InactiveIcon size={22} />
                </View>
              )}
              <Text
                className={
                  selected
                    ? 'font-noto-bold text-micro leading-[13px] font-bold text-primary'
                    : 'font-noto text-micro leading-[13px] text-muted'
                }
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
