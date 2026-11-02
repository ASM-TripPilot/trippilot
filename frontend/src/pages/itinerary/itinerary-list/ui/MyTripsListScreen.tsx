import type { ReactElement, ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WarningTriangleGlyph } from '@/shared/ui/glyphs';
import { StateNotice } from '@/shared/ui/StateNotice';
import { Skeleton } from '@/shared/ui/Skeleton';

import type { MyTripsSortKey } from '../model/myTripsOrder';

import {
  CalendarGlyph,
  ChevronDownGlyph,
} from '@/features/itinerary/index.view';

/**
 * TRIP-468 · h37 "내 여행" 목록 화면 — 순수 프레젠테이션(4얼굴: list·empty·loading·error).
 *
 * 판정(조회·정렬·empty/loading/error 가름)은 페이지(`MyTripsListPage`)가 진다 — 이 화면은 `mode` 와
 * 완성된 카드(`cards`)를 받아 앱바 "내 여행" + 정렬 줄 + 얼굴만 그린다. TRIP-1122 · 정렬 줄은 현재 기준
 * (`sortKey`) 라벨을 띄운 누름 대상이고, 누르면 `onPressSort` — 시트는 페이지가 연다.
 *
 * empty 는 공용 `StateNotice`(현행 탭 empty 가 이미 쓰던 계약)를 재사용해 testID
 * `itinerary-tab-empty`·`itinerary-tab-create-trip` 를 계승한다. TRIP-788 로 아이콘 슬롯을 `icon`
 * (하드코딩 핑크 원)에서 `illustration`(회색 원+캘린더) 슬롯으로 옮겨 StateNotice 무수정으로 핑크 원을
 * 우회한다(stay·explore 소비처 회귀 방지). 부제는 `\n` 으로 2줄을 강제한다.
 *
 * TRIP-1615 · error 는 조회 실패(INV-4) — empty 와 같은 `StateNotice` 틀에 알림함·저장 숙소와 같은 연핑크 원
 * 경고 아이콘 + [다시 시도] 하나. Figma 에 h06 오류 프레임이 없어 코드 선례를 따랐다. 재시도 중 얼굴은
 * 페이지가 정한다(데이터 없는 refetch 는 pending 으로 돌아가 loading 이 대신한다) — 이 화면엔 재시도 중 상태가 없다.
 *
 * TRIP-1638 · offline 은 오프라인으로 처음 켜 받아 둔 목록이 없을 때(요청이 보류됨) — 스켈레톤이 끝나지 않는 걸 막는다(INV-4).
 * error 와 같은 틀이되 **버튼이 없다**: 보류 요청에 다시 시도는 무동작이라 눌러도 아무 일 없는 새 침묵 실패가 된다.
 * 연결이 돌아오면 쿼리가 스스로 재개해 목록으로 바뀐다. Figma 프레임 없음 — error 얼굴 코드 선례.
 */

const APPBAR_TITLE = '내 여행';
const SORT_LABELS: Record<MyTripsSortKey, string> = {
  recent: '최신순',
  start: '출발일순',
  title: '이름순',
};
const EMPTY_TITLE = '아직 만든 여행이 없어요';
const EMPTY_DESCRIPTION =
  '여행을 만들면 확정·작성중 상태를\n여기서 한눈에 볼 수 있어요';
const EMPTY_CTA_LABEL = '여행 만들기';
const ERROR_TITLE = '여행을 불러올 수 없어요';
const ERROR_DESCRIPTION = '잠시 후 다시 시도해 주세요';
const ERROR_RETRY_LABEL = '다시 시도';
const OFFLINE_TITLE = '인터넷에 연결되어 있지 않아요';
const OFFLINE_DESCRIPTION = '연결되면 자동으로 불러올게요';

export type MyTripsListMode =
  'list' | 'empty' | 'loading' | 'error' | 'offline';

export interface MyTripsListScreenProps {
  mode: MyTripsListMode;
  /** list 모드에서 그릴 카드들(페이지가 TripCardContainer 배열로 조립해 내린다). */
  cards?: ReactNode;
  onPressCreateTrip: () => void;
  /** error 모드의 [다시 시도]. */
  onRetry?: () => void;
  /** 현재 정렬 기준(라벨). 기본 최신순. */
  sortKey?: MyTripsSortKey;
  onPressSort?: () => void;
  /** TRIP-1297 — list 모드 목록 스크롤의 첫 자식(카드 앞)에 그릴 것. 없으면 현행과 같다. */
  listHeader?: ReactNode;
}

/** 정렬 줄(우측 정렬) — 누르면 정렬 시트(TRIP-1122 가 TRIP-468 01b Q1 "옵션 1개라 표시 라벨만"을 뒤집음). */
function SortRow({
  sortKey,
  onPress,
}: {
  sortKey: MyTripsSortKey;
  onPress?: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-row justify-end px-lg pt-md">
      <Pressable
        testID="my-trips-sort"
        accessibilityRole="button"
        onPress={onPress}
        className="flex-row items-center gap-[2px]"
      >
        <Text className="font-noto text-label text-muted">
          {SORT_LABELS[sortKey]}
        </Text>
        <ChevronDownGlyph size={15} />
      </Pressable>
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
      {/* 펄스 루프는 카드 하나에 하나(TRIP-1363) — 테두리·배경은 정지. */}
      <Skeleton>
        <View className="h-[178px] w-full bg-surface-soft" />
        <View className="gap-sm px-[14px] pb-[14px] pt-[13px]">
          <View className="h-[15px] w-2/3 rounded-input bg-surface-soft" />
          <View className="h-[13px] w-1/2 rounded-input bg-surface-soft" />
        </View>
      </Skeleton>
    </View>
  );
}

export function MyTripsListScreen({
  mode,
  cards,
  onPressCreateTrip,
  onRetry,
  sortKey = 'recent',
  onPressSort,
  listHeader,
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
              illustration={
                <View
                  testID="itinerary-tab-empty-illustration"
                  className="h-[72px] w-[72px] items-center justify-center rounded-pill bg-surface-soft"
                >
                  <CalendarGlyph
                    size={30}
                    testID="itinerary-tab-empty-calendar"
                  />
                </View>
              }
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
        ) : mode === 'error' ? (
          <View className="flex-1 items-center justify-center px-lg">
            <StateNotice
              testID="itinerary-tab-error"
              icon={<WarningTriangleGlyph size={32} color="primary" />}
              title={ERROR_TITLE}
              description={ERROR_DESCRIPTION}
              actions={[
                {
                  testID: 'itinerary-tab-retry',
                  label: ERROR_RETRY_LABEL,
                  variant: 'filled',
                  onPress: onRetry,
                },
              ]}
            />
          </View>
        ) : mode === 'offline' ? (
          <View className="flex-1 items-center justify-center px-lg">
            <StateNotice
              testID="itinerary-tab-offline"
              icon={<WarningTriangleGlyph size={32} color="primary" />}
              title={OFFLINE_TITLE}
              description={OFFLINE_DESCRIPTION}
              actions={[]}
            />
          </View>
        ) : mode === 'loading' ? (
          <ScrollView contentContainerClassName="gap-lg px-lg pb-2xl pt-md">
            <SkeletonCard index={1} />
            <SkeletonCard index={2} />
          </ScrollView>
        ) : (
          <>
            <SortRow sortKey={sortKey} onPress={onPressSort} />
            <ScrollView contentContainerClassName="gap-lg px-lg pb-2xl pt-sm">
              {listHeader}
              {cards}
            </ScrollView>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
