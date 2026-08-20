import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { resolveActualRoute } from '@/features/execution/model/actualDistance';
import { resolveLiveState } from '@/features/execution/model/liveState';
import { useLiveItinerary } from '@/features/execution/model/useLiveItinerary';
import {
  useLiveViewStore,
  type LivePlanToggle,
  type LiveSegment,
} from '@/features/execution/model/liveViewStore';
import { projectSlotProgress } from '@/features/execution/model/slotProgress';
import { useActualRoute } from '@/features/execution/model/useActualRoute';
import { LiveItineraryScreen } from '@/features/execution/ui/LiveItineraryScreen';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-395 · live-itinerary 페이지 — 조회·판정·조립의 단일 출처.
 *
 * useLiveItinerary(tripId) + 오늘 날짜 → resolveLiveState 판정 1회 → 상태별 렌더. 판정을 화면이
 * 아니라 여기서 하는 이유는 다른 pages 층 규율과 같다(단일 출처). 시각·순서는 솔버 검증값이라
 * 재계산하지 않는다(INV-2) — 진행 상태도 시계가 아니라 slotProgress 가 사영한다(기록 없으면 예정).
 *
 * `today` 는 테스트 주입 seam 이다(기본 = 오늘 UTC). 순수 판정 함수 resolveLiveState 에 날짜를
 * 넘겨 주는 자리라 여기 `new Date()` 가 있고, features/execution 안에는 없다(구조가드 경계).
 */

export interface LiveItineraryPageProps {
  tripId: string;
  /** 'YYYY-MM-DD' — 테스트 주입용. 기본 = 오늘(UTC). */
  today?: string;
}

const NEUTRAL_BADGE = (
  <View className="h-[72px] w-[72px] rounded-pill bg-surface-strong" />
);

export function LiveItineraryPage({
  tripId,
  today = new Date().toISOString().slice(0, 10),
}: LiveItineraryPageProps) {
  const query = useLiveItinerary(tripId);
  const segment = useLiveViewStore((store) => store.segment);
  const setSegment = useLiveViewStore((store) => store.setSegment);
  const toggle = useLiveViewStore((store) => store.toggle);
  const setToggle = useLiveViewStore((store) => store.setToggle);
  // 실제 경로 점열·위치 동의 → 레이어 판정(동의 없으면 비활성·거리 0, PBT-U4-F3).
  const actualRoute = resolveActualRoute(useActualRoute());
  // 사용자가 고른 날(없으면 오늘). 훅 규칙상 조기 반환보다 위에서 무조건 선언한다.
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const state = resolveLiveState({
    isLoading: query.isPending,
    isError: query.isError,
    itinerary: query.data,
    todayDate: today,
    // 활성 트리거(i01 배너)는 후속 칸 — 지금은 없음으로 판정한다.
    activeTriggers: [],
  });

  if (state.kind === 'loading') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View
          testID="execution-live-loading"
          className="flex-1 bg-canvas-alt"
        />
      </SafeAreaView>
    );
  }

  if (state.kind === 'error') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-canvas px-lg">
          <StateNotice
            testID="execution-live-error"
            illustration={NEUTRAL_BADGE}
            title="일정을 불러오지 못했어요"
            description="네트워크를 확인하고 다시 시도해주세요"
            actions={[]}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'outsideToday') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-canvas px-lg">
          <StateNotice
            testID="execution-live-outside"
            illustration={NEUTRAL_BADGE}
            title="오늘은 여행 중이 아니에요"
            description="여행 기간에 들어오면 오늘 일정을 보여드려요"
            actions={[]}
          />
        </View>
      </SafeAreaView>
    );
  }

  const { itinerary, todayIndex } = state;
  const activeDayIndex = selectedDay ?? todayIndex;
  const activeSlots = itinerary.days[activeDayIndex]?.slots ?? [];
  const projected = projectSlotProgress(activeSlots);

  return (
    <LiveItineraryScreen
      days={itinerary.days}
      activeDayIndex={activeDayIndex}
      slots={projected}
      segment={segment}
      onSelectDay={setSelectedDay}
      onSelectSegment={(next: LiveSegment) => setSegment(next)}
      toggle={toggle}
      onToggle={(next: LivePlanToggle) => setToggle(next)}
      actualRoute={actualRoute}
    />
  );
}
