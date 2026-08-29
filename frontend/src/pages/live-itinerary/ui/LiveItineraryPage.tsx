import type { ReactNode } from 'react';
import { useState } from 'react';
import { router } from 'expo-router';
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
import { useVisitCheck } from '@/features/execution/model/useVisitCheck';
import { deriveVisitProgress } from '@/features/execution/model/visitProgress';
import {
  WarningTriangleGlyph,
  WeatherCloudGlyph,
} from '@/features/execution/ui/ExecutionGlyphs';
import { LiveItineraryScreen } from '@/features/execution/ui/LiveItineraryScreen';
import { TriggerBanner } from '@/features/execution/ui/TriggerBanner';
import { TriggerChip } from '@/features/execution/ui/TriggerChip';
import { foldScope } from '@/features/planb/model/foldScope';
import { triggerLabel } from '@/features/planb/model/triggerLabel';
import { useActiveTriggers } from '@/features/planb/model/useActiveTriggers';
import { useSuppressTrigger } from '@/features/planb/model/useSuppressTrigger';
import type { Trigger } from '@/shared/api/generated/schemas';
import {
  useGetTripsTripId,
  useGetTripsTripIdVisitsDaysDay,
} from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { formatKoreanDate } from '@/shared/date/formatKoreanDate';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-395 · live-itinerary 페이지 — 조회·판정·조립의 단일 출처.
 *
 * useLiveItinerary(tripId) + 오늘 날짜 → resolveLiveState 판정 1회 → 상태별 렌더. 시각·순서는
 * 솔버 검증값이라 재계산하지 않는다(INV-2). trip 은 헤더 제목(trip.title)만을 위해 따로 조회하고
 * 판정에는 넣지 않는다 — trip 로딩이 일정 얼굴을 막지 않는다. 부제 날짜는 여기(execution 밖)에서
 * formatKoreanDate 로 만들어 완성 문자열로 화면에 내린다(구조가드 경계).
 *
 * `today` 는 테스트 주입 seam 이다(기본 = 오늘 UTC). 순수 판정 함수 resolveLiveState 에 날짜를
 * 넘겨 주는 자리라 여기 `new Date()` 가 있고, features/execution 안에는 없다.
 */

export interface LiveItineraryPageProps {
  tripId: string;
  /** 'YYYY-MM-DD' — 테스트 주입용. 기본 = 오늘(UTC). */
  today?: string;
}

const NEUTRAL_BADGE = (
  <View className="h-[72px] w-[72px] rounded-pill bg-surface-strong" />
);

/** iconKey(triggerLabel) → 칩 leading 글리프. WEATHER 만 전용, 나머지는 경고삼각형 폴백(seed 미결). */
function chipIcon(iconKey: string): ReactNode {
  if (iconKey === 'weather') return <WeatherCloudGlyph size={24} />;
  return <WarningTriangleGlyph size={24} />;
}

export function LiveItineraryPage({
  tripId,
  today = new Date().toISOString().slice(0, 10),
}: LiveItineraryPageProps) {
  const query = useLiveItinerary(tripId);
  const trip = useGetTripsTripId(tripId);
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
    // 404(일정 미생성)를 네트워크 오류와 가른다 — 판정 재료는 호출부가 계산해 주입(순수성 유지).
    isNotFound: isNotFound(query.error),
    itinerary: query.data,
    todayDate: today,
  });

  // 발화 중 트리거 조회는 active 얼굴에서만(게이팅) — 훅 규칙상 조기 반환 위에서 무조건 선언한다.
  // 표시 게이트는 MANUAL 필터 뒤의 목록으로 아래에서 판정한다(hasActiveTrigger 는 MANUAL 을 못
  // 걸러 이 티켓의 3변형 필터엔 못 쓴다). 억제(dismiss) 뮤테이션도 여기서 선언한다.
  const triggers = useActiveTriggers(tripId, {
    enabled: state.kind === 'active',
  });
  const suppress = useSuppressTrigger(tripId);

  // 방문 기록 조회·판정은 page 1회(FSD·구조가드). 훅 규칙상 조기 반환 위에서 무조건 선언한다 —
  // active 날짜(방문 기록 조회 키)를 미리 구하되, active 가 아니면 '' 로 두어 쿼리를 끈다.
  const liveDayIndex =
    selectedDay ?? (state.kind === 'active' ? state.todayIndex : 0);
  const liveDate =
    state.kind === 'active'
      ? (state.itinerary.days[liveDayIndex]?.date ?? '')
      : '';
  const visits = useGetTripsTripIdVisitsDaysDay(tripId, liveDate, {
    query: { enabled: state.kind === 'active' && liveDate !== '' },
  });
  const visitCheck = useVisitCheck({ tripId, day: liveDate });

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

  if (state.kind === 'notFound') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-canvas px-lg">
          <StateNotice
            testID="execution-live-notfound"
            illustration={NEUTRAL_BADGE}
            title="아직 일정이 없어요"
            description="이 여행은 아직 일정을 만들지 않았어요"
            actions={[]}
          />
        </View>
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

  const { itinerary } = state;
  const activeDayIndex = liveDayIndex;
  const activeDate = liveDate;
  const activeSlots = itinerary.days[activeDayIndex]?.slots ?? [];

  // 방문 기록 → 진행 상태 도출 → projectSlotProgress 인자로 실제 주입(★도달성 — 빈 인자면
  // 전 슬롯 upcoming 이라 active 카드가 프로덕션에 안 뜬다). 도출·판정은 여기 1회.
  const progress = deriveVisitProgress(visits.data ?? { visits: [] });
  const projected = projectSlotProgress(activeSlots, {
    completedPoiIds: progress.completedPoiIds,
    activePoiId: progress.activePoiId,
  });
  const activeVisitCheckId =
    progress.activePoiId !== null
      ? (progress.visitCheckIdByPoiId[progress.activePoiId] ?? null)
      : null;

  const subtitle = activeDate
    ? `${formatKoreanDate(activeDate)} · 오늘 일정`
    : '오늘 일정';

  // MANUAL 은 표시 표면에서 숨긴다(칩·배너는 WEATHER·DELAY·CLOSURE 3변형만). triggerLabel 은
  // 4종 매핑을 갖되(구조 완전성), 화면 표시 필터는 여기서 — 서로 다른 축이다(★8, BR-U4-01).
  const displayTriggers = (triggers.data?.triggers ?? []).filter(
    (trigger) => trigger.kind !== 'MANUAL'
  );
  // 칩은 발화 중이면 상단 상주(전체-날짜 케이스 대행) — 첫 트리거를 대표로 싣는다.
  const chipTrigger = displayTriggers[0];

  const openReplan = (trigger: Trigger) => {
    // 세션 열기까지만(자동 변경 없음, BR-U4-09). 직접 import 아니라 라우팅으로만 planb 로 이동.
    router.push(
      `/trips/${tripId}/planb?scope=${foldScope(trigger.scope)}&triggerId=${trigger.triggerId}`
    );
  };

  const triggerChip = chipTrigger ? (
    <TriggerChip
      // 칩 제목은 kind 요지(정적 라벨) — 상세 사유(reason)는 슬롯 배너가 진다. 요지가 칩과
      // 배너에 둘 다 서도, 상세 reason 은 배너 한 곳에만 흘러 표면 중복이 없다(정적×동적 경계).
      title={triggerLabel(chipTrigger.kind).label}
      subtitle="탭하여 대안 보기"
      icon={chipIcon(triggerLabel(chipTrigger.kind).iconKey)}
      onPressAlternative={() => openReplan(chipTrigger)}
      onDismiss={() =>
        suppress.mutate({ tripId, triggerId: chipTrigger.triggerId })
      }
    />
  ) : undefined;

  // 배너는 slotKey 매칭 슬롯에만 — 요지(label)에 서버 reason 을 이어 완성 문구로 조립한다
  // (정적 라벨 × 동적 reason 경계). 매칭 없으면 null(칩=상시·배너=slotKey 매칭 구분, ★9).
  const renderSlotBanner = (slotKey: string): ReactNode => {
    const match = displayTriggers.find(
      (trigger) => trigger.slotKey === slotKey
    );
    if (!match) return null;
    return (
      <TriggerBanner
        text={`${triggerLabel(match.kind).label} · ${match.reason}`}
      />
    );
  };

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
      tripTitle={trip.data?.title ?? ''}
      subtitle={subtitle}
      onPressTab={(key) => router.replace(key === 'home' ? '/' : `/${key}`)}
      onPressComplete={
        activeVisitCheckId !== null
          ? () => {
              void visitCheck.complete(activeVisitCheckId);
            }
          : undefined
      }
      onManualArrive={(poiId) => {
        void visitCheck.arrive({
          slotKey: `${activeDate}#${poiId}`,
          poiId,
          source: 'MANUAL',
        });
      }}
      triggerChip={triggerChip}
      renderSlotBanner={renderSlotBanner}
      // i09 감시 목록 진입 — 라우팅으로만(execution→planb 직접 import 없이, ★6).
      onPressWatchlist={() => router.push(`/trips/${tripId}/planb/triggers`)}
    />
  );
}
