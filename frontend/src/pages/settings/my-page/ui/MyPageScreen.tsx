import { Fragment, type ReactElement, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { TripBucket } from '../model/tripBuckets';
import { ProfileCard, type ProfileCardCounts } from './ProfileCard';
import { CARD_SHADOW } from '@/features/settings/ui/cardShadow';
import {
  BarChartGlyph,
  ChevronRightGlyph,
  EyeOffGlyph,
  GearGlyph,
  ListGlyph,
  MenuBedGlyph,
  MUTED_SOFT,
  ShareNodesGlyph,
} from '@/features/settings/ui/SettingsGlyphs';

/**
 * TRIP-604 · l03 마이페이지 화면 — 순수 프레젠테이션(props + 콜백만). 셸 교체의 실화면.
 *
 * 조회·분류·정렬·조립은 페이지(`pages/settings/my-page/MyPage`)가 진다 — 이 화면은 완성된
 * 프로필 값·숫자·카드 노드를 받아 레이아웃만 그린다(h37 `MyTripsListScreen` 규율).
 *
 * TRIP-1123(Figma 4755:2930): 일정 탭과 겹치던 세그먼트·여행 카드·빈 문구·[새 여행 만들기]를 걷었다.
 * 여행 목록 입구는 프로필 카드의 숫자 3칸(`onPressCount` → 탭 이동)이다.
 *
 * "지난 여행"(종료) 섹션은 `showPast` 로 켠다 — 언제 켤지(예정 0건, TRIP-775 §F-3 A안)는 페이지가
 * 판정한다. 종료 여행이 0건이면 "아직 종료된 여행이 없습니다"만 뜨고 회고 진입
 * 어포던스는 하나도 없다(AC-5).
 *
 * TRIP-939(심사 2.1): 목적지가 없어 눌러도 반응 없던 것은 그리지 않는다 — `ready:false` 행은 숨기고
 * "캘린더 ›"·회고 하트 floating 은 뺐다. TRIP-775(Figma 1602:2388, Seed Q1=A·Q2=a): 목적지가 선
 * 메뉴 2행(등록 숙소 → /my/stays · 스타일 분석 → /records/style)과 헤더 톱니(→ /settings)를 되살렸다.
 * 커뮤니티 3행은 U7 전이라 여전히 숨김. 헤더는 스크롤 밖 고정 + 하단 가로선(막대 View).
 *
 * TRIP-776(Figma 1603:2414, Seed Q1=A): "캘린더 ›"(→ /records)를 되살렸다 — `onPressCalendar` 가 들어올 때만
 * 그린다(누를 곳 없는 링크 0). 캘린더는 회고 진입이 아니라 종료 0건이어도 섹션과 함께 남는다(BR-U6-23).
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

export interface MyPageScreenProps {
  nickname: string | null;
  email: string | null;
  /** null = 모름(일정 조회 대기·실패) → 숫자 자리 `–`. */
  counts: ProfileCardCounts | null;
  /** 숫자 칸 누름 — 페이지가 탭 이동으로 주입(TRIP-1123). */
  onPressCount?: (bucket: TripBucket) => void;
  /** 스타일 요약 카드(l03) — 페이지가 조회·조립해 내린다. 프로필 바로 아래 놓인다. */
  styleCard?: ReactNode;
  /** 지난 여행(종료) 섹션 노출 여부 — 판정은 페이지(예정 0건). */
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
  /** 지난 여행 "캘린더 ›" 진입(페이지가 /records 로 주입). 미주입이면 링크를 그리지 않는다. */
  onPressCalendar?: () => void;
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
  onPressCount,
  styleCard,
  showPast,
  pastCards,
  pastEmpty,
  onPressEdit,
  onPressSettings,
  onPressStays,
  onPressStyleAnalysis,
  tags,
  onPressCalendar,
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
            onPressCount={onPressCount}
            onPressEdit={onPressEdit}
            tags={tags}
          />

          {styleCard}

          {/* 지난 여행(종료) 섹션 — 페이지가 켤 때만(예정 0건). */}
          {showPast ? (
            <View className="gap-md">
              <View className="flex-row items-center justify-between">
                <Text className="font-noto-bold text-[16px] font-bold text-ink">
                  지난 여행
                </Text>
                {onPressCalendar ? (
                  <Pressable
                    testID="my-past-calendar"
                    accessibilityRole="button"
                    onPress={onPressCalendar}
                    hitSlop={10}
                  >
                    <Text className="font-noto text-label text-primary">
                      캘린더 ›
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {pastEmpty ? (
                <Text className="py-md font-noto text-label text-muted">
                  아직 종료된 여행이 없습니다
                </Text>
              ) : (
                <View className="gap-[10px]">{pastCards}</View>
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
