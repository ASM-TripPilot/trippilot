import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import {
  buildPlanDayTabs,
  resolvePlanState,
} from '@/features/itinerary/model/planState';
import {
  AlertCircleGlyph,
  InfoCircleGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';
import { ItineraryEditScreen } from '@/features/itinerary/ui/ItineraryEditScreen';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * h24 일정 편집 배선(TRIP-302 슬라이스1) — GET 조회를 **편집 드래프트 스토어에 1회 시드**하고,
 * 삭제·재정렬 콜백을 스토어 액션에 얹는다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **조회는 시드 소스일 뿐, 진실은 편집 스토어다** — 화면은 스토어의 편집 드래프트를 그리므로
 *     삭제·재정렬이 로컬로 즉시 반영된다. 조회 캐시는 건드리지 않는다(엣지5 mutation 0).
 *  2. **시드는 데이터가 처음 도착할 때 1회** — 이후 리렌더(편집으로 인한)에도 조회 데이터 참조가
 *     그대로라 재시드하지 않는다. 그래서 편집이 되돌려지지 않는다.
 *  3. **PUT 저장은 배선하지 않는다(슬라이스2)** — 저장하기·시각칩·다른후보·장소추가는 화면이 콜백
 *     없이 그리는 자리다.
 *  4. **404 는 별도 얼굴** — "편집할 일정이 아직 없다"(`isNotFound`)를 `resolvePlanState` 우선순위로
 *     갈라 침묵 실패를 피한다(INV-4).
 */

function EditFace({
  testID,
  icon,
  title,
  description,
}: {
  testID: string;
  icon: ReactElement;
  title: string;
  description: string;
}): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 items-center justify-center bg-canvas px-lg">
        <StateNotice
          testID={testID}
          icon={icon}
          title={title}
          description={description}
          actions={[]}
        />
      </View>
    </SafeAreaView>
  );
}

export function ItineraryEditPage({
  tripId,
}: {
  tripId: string;
}): ReactElement {
  const router = useRouter();
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  const itinerary = useGetTripsTripIdItinerary(tripId);

  const seed = useItineraryEditStore((s) => s.seed);
  const deleteSlot = useItineraryEditStore((s) => s.deleteSlot);
  const reorderSlots = useItineraryEditStore((s) => s.reorderSlots);
  const days = useItineraryEditStore((s) => s.days);

  useEffect(() => {
    const loaded = itinerary.data?.days;
    if (loaded !== undefined) seed(loaded);
  }, [itinerary.data, seed]);

  const state = resolvePlanState({
    loading: itinerary.isPending,
    notFound: isNotFound(itinerary.error),
    failed: itinerary.isError,
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
      <EditFace
        testID="itinerary-edit-notfound"
        icon={<InfoCircleGlyph size={32} tone="primaryText" />}
        title="아직 편집할 일정이 없어요"
        description="일정을 만들면 여기에서 수정할 수 있어요"
      />
    );
  }

  if (state.kind === 'failed') {
    return (
      <EditFace
        testID="itinerary-edit-failed"
        icon={<AlertCircleGlyph size={32} tone="primaryText" />}
        title="일정을 불러오지 못했어요"
        description="네트워크를 확인하고 다시 시도해주세요"
      />
    );
  }

  const activeDate = state.days[activeDayIndex]?.date ?? '';

  return (
    <ItineraryEditScreen
      days={buildPlanDayTabs(state.days)}
      slots={state.days[activeDayIndex]?.slots ?? []}
      activeDayIndex={activeDayIndex}
      onSelectDay={setActiveDayIndex}
      onBack={() => router.back()}
      onDeleteSlot={(poiId) => deleteSlot(activeDate, poiId)}
      onReorder={(data) => reorderSlots(activeDate, data)}
    />
  );
}
