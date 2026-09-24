import { Fragment, type ReactElement, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { TripBucket } from '../model/tripBuckets';
import { ProfileCard, type ProfileCardCounts } from './ProfileCard';
import { CARD_SHADOW } from './cardShadow';
import {
  BarChartGlyph,
  ChevronRightGlyph,
  EyeOffGlyph,
  GearGlyph,
  ListGlyph,
  MenuBedGlyph,
  MUTED_SOFT,
  ShareNodesGlyph,
} from './SettingsGlyphs';
import { TripStatusSegment } from './TripStatusSegment';

/**
 * TRIP-604 · l03 마이페이지 화면 — 순수 프레젠테이션(props + 콜백만). 셸 교체의 실화면.
 *
 * 조회·분류·정렬·N+1 컨테이너 조립은 페이지(`pages/my-page/MyPage`)가 진다 — 이 화면은 완성된
 * 프로필 값·세그먼트 상태·카드 노드를 받아 레이아웃만 그린다(h37 `MyTripsListScreen` 규율).
 *
 * "지난 여행"(종료) 섹션은 `showPast` 로 켠다 — 언제 켤지(예정 0건 · 활성 탭이 '종료'가 아님, TRIP-775
 * §F-3 A안)는 페이지가 판정한다. 종료 여행이 0건이면 "아직 종료된 여행이 없습니다"만 뜨고 회고 진입
 * 어포던스는 하나도 없다(AC-5).
 *
 * TRIP-939(심사 2.1): 목적지가 없어 눌러도 반응 없던 것은 그리지 않는다 — `ready:false` 행은 숨기고
 * "캘린더 ›"·회고 하트 floating 은 뺐다. TRIP-775(Figma 1602:2388, Seed Q1=A·Q2=a): 목적지가 선
 * 메뉴 2행(등록 숙소 → /my/stays · 스타일 분석 → /records/style)과 헤더 톱니(→ /settings)를 되살렸다.
 * 커뮤니티 3행은 U7 전이라 여전히 숨김. 헤더는 스크롤 밖 고정 + 하단 가로선(막대 View).
 */

// `ready` = 목적지가 선 행인가. false 행은 화면에 그리지 않는다(TRIP-939 — 개통 시 true 한 줄로 되살림).
type MenuRowKey =
  'bases' | 'style' | 'share' | 'shared' | 'blocked' | 'settings';

const SETTINGS_ROWS: {
  key: MenuRowKey;
  label: string;
  icon: ReactElement;
  testID?: string;
  ready: boolean;
}[] = [
  {
    key: 'bases',
    label: '등록 숙소·예약 기록',
    icon: <MenuBedGlyph />,
    testID: 'my-stays-row',
    ready: true,
  },
  {
    key: 'style',
    label: '여행 스타일 분석',
    icon: <BarChartGlyph />,
    testID: 'my-style-analysis-row',
    ready: true,
  },
  {
    key: 'share',
    label: '내 일정 공개/공유 설정',
    icon: <ShareNodesGlyph />,
    ready: false,
  },
  {
    key: 'shared',
    label: '내가 공유한 일정',
    icon: <ListGlyph />,
    ready: false,
  },
  {
    key: 'blocked',
    label: '숨긴 사용자 관리',
    icon: <EyeOffGlyph />,
    ready: false,
  },
  {
    key: 'settings',
    label: '설정',
    icon: <GearGlyph />,
    testID: 'my-settings-row',
    ready: true,
  },
];
const VISIBLE_SETTINGS_ROWS = SETTINGS_ROWS.filter((row) => row.ready);

const EMPTY_TEXT: Record<TripBucket, string> = {
  upcoming: '예정된 여행이 없어요',
  active: '진행 중인 여행이 없어요',
  ended: '종료된 여행이 없어요',
};

export interface MyPageScreenProps {
  nickname: string | null;
  email: string | null;
  counts: ProfileCardCounts;
  active: TripBucket;
  onChangeSegment: (bucket: TripBucket) => void;
  /** 활성 버킷 카드들(페이지가 TripCardContainer 배열로 조립). */
  cards: ReactNode;
  /** 활성 버킷이 비었으면 빈 상태를 그린다. */
  activeEmpty: boolean;
  /** 스타일 요약 카드(l03) — 페이지가 조회·조립해 내린다. 프로필↔세그먼트 사이에 놓인다. */
  styleCard?: ReactNode;
  onPressCreateTrip: () => void;
  /** 지난 여행(종료) 섹션 노출 여부 — 판정은 페이지(예정 0건 · 활성 탭 '종료' 아님). */
  showPast: boolean;
  pastCards: ReactNode;
  /** 종료 0건 → "아직 종료된 여행이 없습니다"만. */
  pastEmpty: boolean;
  onPressEdit?: () => void;
  /** 헤더 톱니·하단 '설정' 행 진입(페이지가 /settings 로 주입). 미주입이면 둘 다 누를 곳이 없다. */
  onPressSettings?: () => void;
  /** '등록 숙소·예약 기록' 행 진입(페이지가 /my/stays 로 주입). */
  onPressStays?: () => void;
  /** '여행 스타일 분석' 행 진입(페이지가 /records/style 로 주입). */
  onPressStyleAnalysis?: () => void;
  /** 프로필 태그 — 페이지가 정식 분석 descriptors 만 내린다(Seed Q4=A). */
  tags?: string[];
}

/**
 * 설정 메뉴 한 행 — 아이콘 + 라벨 + chevron. `onPress` 를 받은 행만 Pressable 로 그려지고, 미주입
 * (프리뷰 등)이면 정적 View 다(Q6, 정직한 스텁). 행 사이 구분선은 카드가 막대 View 로 넣는다.
 */
function SettingsRow({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon: ReactElement;
  onPress?: () => void;
  testID?: string;
}): ReactElement {
  const className = 'flex-row items-center gap-[14px] p-lg';
  const content = (
    <>
      {icon}
      <Text className="flex-1 font-noto-bold text-[14.5px] font-bold text-ink">
        {label}
      </Text>
      <ChevronRightGlyph size={20} color={MUTED_SOFT} />
    </>
  );
  return onPress ? (
    <Pressable testID={testID} onPress={onPress} className={className}>
      {content}
    </Pressable>
  ) : (
    <View className={className}>{content}</View>
  );
}

export function MyPageScreen({
  nickname,
  email,
  counts,
  active,
  onChangeSegment,
  cards,
  activeEmpty,
  styleCard,
  onPressCreateTrip,
  showPast,
  pastCards,
  pastEmpty,
  onPressEdit,
  onPressSettings,
  onPressStays,
  onPressStyleAnalysis,
  tags,
}: MyPageScreenProps): ReactElement {
  const menuHandlers: Partial<Record<MenuRowKey, () => void>> = {
    bases: onPressStays,
    style: onPressStyleAnalysis,
    settings: onPressSettings,
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="my-page-root" className="flex-1 bg-canvas">
        {/* 헤더 — 스크롤 밖 고정. 제목 + 톱니(→ 설정, 미주입이면 그리지 않는다 — INV-4). */}
        <View className="flex-row items-center justify-between px-lg pb-[14px] pt-sm">
          <Text className="font-noto-bold text-hero font-bold text-ink">
            마이페이지
          </Text>
          {onPressSettings ? (
            <Pressable
              testID="my-header-settings"
              accessibilityRole="button"
              accessibilityLabel="설정"
              onPress={onPressSettings}
              hitSlop={10}
            >
              <GearGlyph size={24} />
            </Pressable>
          ) : null}
        </View>
        <View className="h-px bg-hairline" />

        <ScrollView contentContainerClassName="gap-[14px] px-lg pb-[110px] pt-lg">
          <ProfileCard
            nickname={nickname}
            email={email}
            counts={counts}
            onPressEdit={onPressEdit}
            tags={tags}
          />

          {styleCard}

          <TripStatusSegment active={active} onChange={onChangeSegment} />

          {/* 활성 버킷 목록 또는 빈 상태 */}
          {activeEmpty ? (
            <View className="items-center gap-md py-lg">
              <Text className="font-noto text-label text-muted">
                {EMPTY_TEXT[active]}
              </Text>
              {active === 'upcoming' ? (
                <Pressable
                  testID="my-create-trip"
                  accessibilityRole="button"
                  onPress={onPressCreateTrip}
                  className="h-12 w-full items-center justify-center rounded-button bg-primary"
                >
                  <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                    + 새 여행 만들기
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View className="gap-md">{cards}</View>
          )}

          {/* 지난 여행(종료) 섹션 — 페이지가 켤 때만(예정 0건 · 활성 탭이 종료 아님). */}
          {showPast ? (
            <View className="gap-md">
              <View className="flex-row items-center justify-between">
                <Text className="font-noto-bold text-[16px] font-bold text-ink">
                  지난 여행
                </Text>
              </View>
              {pastEmpty ? (
                <Text className="py-md font-noto text-label text-muted">
                  아직 종료된 여행이 없습니다
                </Text>
              ) : (
                <View className="gap-md">{pastCards}</View>
              )}
            </View>
          ) : null}

          {/* 설정 메뉴 */}
          <View
            testID="my-menu-card"
            style={CARD_SHADOW}
            className="rounded-[12px] border border-hairline bg-canvas"
          >
            {VISIBLE_SETTINGS_ROWS.map((row, i) => (
              <Fragment key={row.key}>
                {i > 0 ? <View className="h-px bg-hairline" /> : null}
                <SettingsRow
                  label={row.label}
                  icon={row.icon}
                  onPress={menuHandlers[row.key]}
                  testID={row.testID}
                />
              </Fragment>
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
