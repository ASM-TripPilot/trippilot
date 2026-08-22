import type { ReactElement, ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateNotice } from '@/shared/ui/StateNotice';

import { ChevronDownGlyph, InfoCircleGlyph } from './ItineraryGlyphs';

/**
 * TRIP-468 · h37 "내 여행" 목록 화면 — 순수 프레젠테이션(3얼굴: list·empty·loading).
 *
 * 판정(조회·정렬·empty/loading 가름)은 페이지(`MyTripsListPage`)가 진다 — 이 화면은 `mode` 와
 * 완성된 카드(`cards`)를 받아 앱바 "내 여행" + "최신순" 라벨 + 얼굴만 그린다.
 *
 * empty 는 공용 `StateNotice`(현행 탭 empty 가 이미 쓰던 계약)를 재사용해 testID
 * `itinerary-tab-empty`·`itinerary-tab-create-trip` 를 계승한다 — 아이콘도 기존 `InfoCircleGlyph`.
 */

const APPBAR_TITLE = '내 여행';
const SORT_LABEL = '최신순';
const EMPTY_TITLE = '아직 만든 여행이 없어요';
const EMPTY_DESCRIPTION =
  '여행을 만들면 완성·작성중 상태를 여기서 한눈에 볼 수 있어요';
const EMPTY_CTA_LABEL = '여행 만들기';

export type MyTripsListMode = 'list' | 'empty' | 'loading';

export interface MyTripsListScreenProps {
  mode: MyTripsListMode;
  /** list 모드에서 그릴 카드들(페이지가 TripCardContainer 배열로 조립해 내린다). */
  cards?: ReactNode;
  onPressCreateTrip: () => void;
}

/** 정렬 라벨 한 줄(우측 정렬) — 옵션 1개라 메뉴 없이 표시 라벨만(01b Q1). */
function SortRow(): ReactElement {
  return (
    <View className="w-full flex-row items-center justify-end gap-[2px] px-lg pt-md">
      <Text className="font-noto text-label text-muted">{SORT_LABEL}</Text>
      <ChevronDownGlyph size={15} />
    </View>
  );
}

/** 로딩 스켈레톤 카드 — 사진 블록 h178 + 정보 자리 바 2개. */
function SkeletonCard({ index }: { index: number }): ReactElement {
  return (
    <View
      testID={`my-trip-skeleton-${index}`}
      className="w-full overflow-hidden rounded-card border border-hairline bg-canvas"
    >
      <View className="h-[178px] w-full bg-surface-soft" />
      <View className="gap-sm px-[14px] pb-[14px] pt-[13px]">
        <View className="h-[15px] w-2/3 rounded-input bg-surface-soft" />
        <View className="h-[13px] w-1/2 rounded-input bg-surface-soft" />
      </View>
    </View>
  );
}

export function MyTripsListScreen({
  mode,
  cards,
  onPressCreateTrip,
}: MyTripsListScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="itinerary-tab-root" className="flex-1 bg-canvas">
        <View className="w-full bg-canvas px-lg pb-sm pt-md">
          <Text className="font-noto-bold text-[24px] font-bold text-ink">
            {APPBAR_TITLE}
          </Text>
        </View>

        {mode === 'empty' ? (
          <View className="flex-1 items-center justify-center px-lg">
            <StateNotice
              testID="itinerary-tab-empty"
              icon={<InfoCircleGlyph size={30} />}
              title={EMPTY_TITLE}
              description={EMPTY_DESCRIPTION}
              actions={[
                {
                  testID: 'itinerary-tab-create-trip',
                  label: EMPTY_CTA_LABEL,
                  variant: 'filled',
                  onPress: onPressCreateTrip,
                },
              ]}
            />
          </View>
        ) : mode === 'loading' ? (
          <ScrollView contentContainerClassName="gap-lg px-lg pb-2xl pt-md">
            <SkeletonCard index={1} />
            <SkeletonCard index={2} />
          </ScrollView>
        ) : (
          <>
            <SortRow />
            <ScrollView contentContainerClassName="gap-lg px-lg pb-2xl pt-sm">
              {cards}
            </ScrollView>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
