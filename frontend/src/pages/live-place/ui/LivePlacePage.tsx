import { router } from 'expo-router';
import { Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  buildPlaceDetailView,
  buildPlaceShareMessage,
} from '@/features/execution/model/placeDetailView';
import { usePlaceDetail } from '@/features/execution/model/usePlaceDetail';
import { PlaceDetailScreen } from '@/features/execution/ui/PlaceDetailScreen';
import { isNotFound } from '@/shared/api/isNotFound';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-398 · live-place 페이지(i05) — 조회·조립·렌더 배선의 단일 출처. `LiveItineraryPage` 선례.
 *
 * usePlaceDetail(tripId) 조회 → 오늘 슬롯에서 poiId 를 찾아 buildPlaceDetailView 로 뷰 1회 조립 →
 * PlaceDetailScreen. 시각·순서는 솔버 검증값이라 재계산하지 않는다(INV-2).
 *
 * TRIP-755(i10): 원형 뒤로는 히스토리가 있으면 back, 없으면(콜드 딥링크 — 앱 안 push 경로 0건)
 * 여행 중 허브로 replace 해 갇히지 않는다(d06 handleBack 선례). 공유는 OS 공유 시트에 장소명
 * (+주소)만 나른다(계약에 딥링크 URL 없음). 하트는 화면이 스스로 "준비 중"만 띄운다 — 배선 없음.
 *
 * ★ 로딩 가드 선행(★8): isPending 이면 -loading 중립 뷰를 **먼저** 반환한다. 안 그러면 data 미도착
 * 중 slots=[] → buildPlaceDetailView(...) = null → notFound 가 로딩을 "장소 없음"으로 오표시한다.
 *
 * TRIP-952: 판정 순서 로딩 → 404(장소 없음) → 그 밖의 조회 실패(오류 얼굴 + 다시 시도) → 데이터
 * (형제 `resolveLiveState` 순서). 5xx·끊김은 "없다"가 아니라 "모른다"라 장소 없음으로 접지 않는다(INV-4).
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

  const notFound = isNotFound(query.error);

  if (query.isError && !notFound) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-canvas px-lg">
          <StateNotice
            testID="execution-place-error"
            illustration={NEUTRAL_BADGE}
            title="일정을 불러오지 못했어요"
            description="네트워크를 확인하고 다시 시도해주세요"
            actions={[
              {
                testID: 'execution-place-retry',
                label: '다시 시도',
                variant: 'filled',
                onPress: () => void query.refetch(),
              },
            ]}
          />
        </View>
      </SafeAreaView>
    );
  }

  // poiId 가 속한 일자의 슬롯을 넘긴다(여유 계산이 사라져 일자 한정은 결과에 영향 없음 — 단순 탐색 범위). 없으면 [] → null(notFound).
  const days = query.data?.days ?? [];
  const slots =
    days.find((day) => day.slots.some((slot) => slot.poiId === poiId))?.slots ??
    [];
  const view = notFound ? null : buildPlaceDetailView(slots, poiId);

  if (view === null) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-canvas px-lg">
          <StateNotice
            testID="execution-place-notfound"
            illustration={NEUTRAL_BADGE}
            title="장소를 찾을 수 없어요"
            description="이 장소는 일정에 없어요"
            actions={[]}
          />
        </View>
      </SafeAreaView>
    );
  }

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/trips/${tripId}/live`);
    }
  }

  return (
    <PlaceDetailScreen
      view={view}
      onPressBack={handleBack}
      onPressShare={() =>
        void Share.share({ message: buildPlaceShareMessage(view) })
      }
    />
  );
}
