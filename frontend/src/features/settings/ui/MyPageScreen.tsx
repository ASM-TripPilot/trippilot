import type { ReactElement, ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { TripBucket } from '../model/tripBuckets';
import { ProfileCard, type ProfileCardCounts } from './ProfileCard';
import {
  BarChartGlyph,
  BookmarkGlyph,
  ChevronRightGlyph,
  EyeOffGlyph,
  GearGlyph,
  HeartGlyph,
  ListGlyph,
  SettingsSunGlyph,
  ShareNodesGlyph,
} from './SettingsGlyphs';
import { TripStatusSegment } from './TripStatusSegment';

/**
 * TRIP-604 · l03 마이페이지 화면 — 순수 프레젠테이션(props + 콜백만). 셸 교체의 실화면.
 *
 * 조회·분류·정렬·N+1 컨테이너 조립은 페이지(`pages/my-page/MyPage`)가 진다 — 이 화면은 완성된
 * 프로필 값·세그먼트 상태·카드 노드를 받아 레이아웃만 그린다(h37 `MyTripsListScreen` 규율).
 *
 * "지난 여행"(종료) 섹션은 **세그먼트와 독립으로 상시 노출**된다(활성 탭이 '종료'가 아닐 때) —
 * 종료 여행이 0건이면 "아직 종료된 여행이 없습니다"만 뜨고 회고 진입 어포던스는 하나도 없다
 * (AC-5, empty Figma 의 상시 '지난 여행' 영역 근거).
 *
 * 하단 '설정' 행은 /settings 로 배선(TRIP-618, onPressSettings). 헤더 sun 아이콘·회고 하트는
 * 목적지 라우트가 아직 없어 onPress 미배선(Q6, 정직한 스텁).
 */

const SETTINGS_ROWS: { key: string; label: string; icon: ReactElement }[] = [
  { key: 'bases', label: '등록 숙소·예약 기록', icon: <BookmarkGlyph /> },
  { key: 'style', label: '여행 스타일 분석', icon: <BarChartGlyph /> },
  { key: 'share', label: '내 일정 공개/공유 설정', icon: <ShareNodesGlyph /> },
  { key: 'shared', label: '내가 공유한 일정', icon: <ListGlyph /> },
  { key: 'blocked', label: '숨긴 사용자 관리', icon: <EyeOffGlyph /> },
  { key: 'settings', label: '설정', icon: <GearGlyph /> },
];

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
  /** 지난 여행(종료) 섹션 노출 여부(활성 탭이 '종료'면 top 목록이 대신 진다). */
  showPast: boolean;
  pastCards: ReactNode;
  /** 종료 0건 → "아직 종료된 여행이 없습니다"만. */
  pastEmpty: boolean;
  onPressEdit?: () => void;
  /** 하단 '설정' 행 진입(페이지가 /settings 로 주입). preview 무파손 위해 optional. */
  onPressSettings?: () => void;
}

/**
 * 설정 메뉴 한 행 — 아이콘 + 라벨 + chevron. 목적지 라우트가 선 행(설정)만 `onPress`·`testID` 를
 * 받아 Pressable 로 그려지고, 나머지는 아직 미배선이라 정적 View 다(Q6, 정직한 스텁).
 */
function SettingsRow({
  label,
  icon,
  last,
  onPress,
  testID,
}: {
  label: string;
  icon: ReactElement;
  last: boolean;
  onPress?: () => void;
  testID?: string;
}): ReactElement {
  const className = `flex-row items-center gap-md py-[14px] ${
    last ? '' : 'border-b border-hairline'
  }`;
  const content = (
    <>
      {icon}
      <Text className="flex-1 font-noto text-label text-body">{label}</Text>
      <ChevronRightGlyph size={18} />
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
}: MyPageScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="my-page-root" className="flex-1 bg-canvas">
        <ScrollView contentContainerClassName="gap-lg px-lg pb-[110px] pt-md">
          {/* 헤더 */}
          <View className="flex-row items-center justify-between">
            <Text className="font-noto-bold text-[24px] font-bold text-ink">
              마이페이지
            </Text>
            <Pressable
              testID="my-header-settings"
              accessibilityRole="button"
              className="h-8 w-8 items-center justify-center"
            >
              <SettingsSunGlyph size={22} />
            </Pressable>
          </View>

          <ProfileCard
            nickname={nickname}
            email={email}
            counts={counts}
            onPressEdit={onPressEdit}
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

          {/* 지난 여행(종료) 섹션 — 상시 노출(활성 탭이 종료가 아닐 때). */}
          {showPast ? (
            <View className="gap-md">
              <View className="flex-row items-center justify-between">
                <Text className="font-noto-bold text-[16px] font-bold text-ink">
                  지난 여행
                </Text>
                <Text className="font-noto text-label text-primary">
                  캘린더 ›
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
          <View className="rounded-card border border-hairline bg-canvas px-lg">
            {SETTINGS_ROWS.map((row, i) => (
              <SettingsRow
                key={row.key}
                label={row.label}
                icon={row.icon}
                last={i === SETTINGS_ROWS.length - 1}
                onPress={row.key === 'settings' ? onPressSettings : undefined}
                testID={row.key === 'settings' ? 'my-settings-row' : undefined}
              />
            ))}
          </View>
        </ScrollView>

        {/* 회고 하트(floating) — 목적지 미배선(Q6, 장식). */}
        <View className="absolute bottom-[100px] right-lg h-[52px] w-[52px] items-center justify-center rounded-pill bg-canvas shadow-md">
          <HeartGlyph size={24} />
        </View>
      </View>
    </SafeAreaView>
  );
}
