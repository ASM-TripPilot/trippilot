import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import {
  buildPlanDayTabs,
  formatNightsLabel,
  resolvePlanState,
} from '@/features/itinerary/model/planState';
import {
  AlertCircleGlyph,
  InfoCircleGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';
import {
  TimelineScreen,
  type ViewSegmentValue,
} from '@/features/itinerary/ui/TimelineScreen';
import {
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * h25 완성 일정 배선(TRIP-299) — 두 조회를 잇고, 뷰 세그먼트를 **페이지 로컬 UI 상태**로 든다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **헤더는 두 조회의 조립이다** — 제목·기간은 `GET /trips`, 곳 수는 `GET /itinerary` 슬롯 합계.
 *  2. **404 는 전면 실패가 아니라 별도 얼굴이다** — "일정이 아직 없다"(`isNotFound`)를 `notFound`
 *     로 갈라 `resolvePlanState` 의 우선순위가 실패 겹침을 정리한다(INV-4).
 *  3. **세그먼트 전환은 재조회를 유발하지 않는다** — 뷰는 `useState` 라 쿼리 키가 그대로고, 캐시된
 *     쿼리는 리렌더에 다시 나가지 않는다(AC6). Zustand 는 pages 층 금지라 로컬 상태로 든다.
 */

function PlanFace({
  testID,
  icon,
  title,
  description,
}: {
  testID: string;
  icon: ReactNode;
  title: string;
  description: string;
}): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 items-center justify-center bg-canvas px-lg">
        <StateNotice
          testID={testID}
          icon={icon as ReactElement}
          title={title}
          description={description}
          actions={[]}
        />
      </View>
    </SafeAreaView>
  );
}

export function ItineraryPlanPage({
  tripId,
}: {
  tripId: string;
}): ReactElement {
  const router = useRouter();
  const [segment, setSegment] = useState<ViewSegmentValue>('timeline');
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  const trip = useGetTripsTripId(tripId);
  const itinerary = useGetTripsTripIdItinerary(tripId);

  const days = itinerary.data?.days ?? [];
  const state = resolvePlanState({
    loading: trip.isPending || itinerary.isPending,
    notFound: isNotFound(itinerary.error),
    failed: trip.isError || itinerary.isError,
    days,
  });

  if (state.kind === 'loading') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas" />
      </SafeAreaView>
    );
  }

  if (state.kind === 'notFound') {
    return (
      <PlanFace
        testID="itinerary-view-notfound"
        icon={<InfoCircleGlyph size={32} tone="primaryText" />}
        title="아직 완성된 일정이 없어요"
        description="일정을 만들면 여기에서 볼 수 있어요"
      />
    );
  }

  if (state.kind === 'failed') {
    return (
      <PlanFace
        testID="itinerary-view-failed"
        icon={<AlertCircleGlyph size={32} tone="primaryText" />}
        title="일정을 불러오지 못했어요"
        description="네트워크를 확인하고 다시 시도해주세요"
      />
    );
  }

  const totalPlaces = state.days.reduce(
    (sum, day) => sum + day.slots.length,
    0
  );
  const header = {
    title: trip.data?.title ?? '',
    nightsLabel: formatNightsLabel(
      trip.data?.startDate ?? '',
      trip.data?.endDate ?? ''
    ),
    totalPlaces,
  };

  return (
    <TimelineScreen
      header={header}
      days={buildPlanDayTabs(state.days)}
      slots={state.days[activeDayIndex]?.slots ?? []}
      activeDayIndex={activeDayIndex}
      segment={segment}
      onSelectDay={setActiveDayIndex}
      onSegmentChange={setSegment}
      onBack={() => router.back()}
    />
  );
}
