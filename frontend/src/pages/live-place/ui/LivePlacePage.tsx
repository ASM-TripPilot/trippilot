import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildPlaceDetailView } from '@/features/execution/model/placeDetailView';
import { usePlaceDetail } from '@/features/execution/model/usePlaceDetail';
import { PlaceDetailScreen } from '@/features/execution/ui/PlaceDetailScreen';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-398 · live-place 페이지(i05) — 조회·조립·렌더 배선의 단일 출처. `LiveItineraryPage` 선례.
 *
 * usePlaceDetail(tripId) 조회 → 오늘 슬롯에서 poiId 를 찾아 buildPlaceDetailView 로 뷰 1회 조립 →
 * PlaceDetailScreen. [일정에서 보기]는 정적 `router.back()` 으로 라이브 일정으로 돌아간다(D7,
 * LiveItineraryPage 정적 싱글턴 선례). 시각·순서는 솔버 검증값이라 재계산하지 않는다(INV-2).
 *
 * ★ 로딩 가드 선행(★8): isPending 이면 -loading 중립 뷰를 **먼저** 반환한다. 안 그러면 data 미도착
 * 중 slots=[] → buildPlaceDetailView(...) = null → notFound 가 로딩을 "장소 없음"으로 오표시한다.
 */

export interface LivePlacePageProps {
  tripId: string;
  poiId: string;
}

const NEUTRAL_BADGE = (
  <View className="h-[72px] w-[72px] rounded-pill bg-surface-strong" />
);

export function LivePlacePage({ tripId, poiId }: LivePlacePageProps) {
  const query = usePlaceDetail(tripId);

  if (query.isPending) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View
          testID="execution-place-loading"
          className="flex-1 bg-canvas-alt"
        />
      </SafeAreaView>
    );
  }

  // poiId 가 속한 **그 일자**의 슬롯만 넘긴다 — 전체 평탄화는 next-fixed 탐색이 익일 슬롯을 골라
  // slack 부호가 뒤집힌다(5-b 경고-1). 어느 일자에도 없으면 [] → buildPlaceDetailView = null(notFound).
  const days = query.data?.days ?? [];
  const slots =
    days.find((day) => day.slots.some((slot) => slot.poiId === poiId))?.slots ??
    [];
  const view = buildPlaceDetailView(slots, poiId);

  if (view === null) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-canvas px-lg">
          <StateNotice
            testID="execution-place-notfound"
            illustration={NEUTRAL_BADGE}
            title="장소를 찾을 수 없어요"
            description="이 장소는 오늘 일정에 없어요"
            actions={[]}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <PlaceDetailScreen view={view} onPressItinerary={() => router.back()} />
  );
}
