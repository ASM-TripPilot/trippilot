import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { resolveLiveState } from '@/features/execution/model/liveState';
import { useLiveItinerary } from '@/features/execution/model/useLiveItinerary';
import { projectSlotProgress } from '@/features/execution/model/slotProgress';
import { useVisitCheck } from '@/features/execution/model/useVisitCheck';
import { deriveVisitProgress } from '@/features/execution/model/visitProgress';
import { TriggerChip } from '@/features/execution/ui/TriggerChip';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { foldScope } from '@/features/planb/model/foldScope';
import { riskAffectedRow } from '@/features/planb/model/riskAffectedRow';
import { triggerLabel } from '@/features/planb/model/triggerLabel';
import { triggerPillCopy } from '@/features/planb/model/triggerPillCopy';
import { triggerWatchlist } from '@/features/planb/model/triggerWatchlist';
import { useActiveTriggers } from '@/features/planb/model/useActiveTriggers';
import { ReplanAppliedSheet } from '@/features/planb/ui/ReplanAppliedSheet';
import { RiskDetailSheet } from '@/features/planb/ui/RiskDetailSheet';
import type { Trigger } from '@/shared/api/generated/schemas';
import {
  useGetTripsTripId,
  useGetTripsTripIdVisitsDaysDay,
} from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { StateNotice } from '@/shared/ui/StateNotice';

import { LiveHubView } from './LiveHubView';

/**
 * TRIP-395 · live-itinerary 페이지 — 조회·판정·조립의 단일 출처.
 *
 * useLiveItinerary(tripId) + 오늘 날짜 → resolveLiveState 판정 1회 → 상태별 렌더. 시각·순서는
 * 솔버 검증값이라 재계산하지 않는다(INV-2). trip 은 헤더 제목(trip.title)만을 위해 따로 조회하고
 * 판정에는 넣지 않는다 — trip 로딩이 일정 얼굴을 막지 않는다. active 얼굴은 i01 허브 순수 뷰
 * (`LiveHubView`, TRIP-746)가 그린다. 사진·후기는 조회 계약이 없어 넘기지 않는다(G6 — 칸 생략).
 *
 * `today` 는 테스트 주입 seam 이다(기본 = 오늘 UTC). 순수 판정 함수 resolveLiveState 에 날짜를
 * 넘겨 주는 자리라 여기 `new Date()` 가 있고, features/execution 안에는 없다.
 */

export interface LiveItineraryPageProps {
  tripId: string;
  /** 'YYYY-MM-DD' — 테스트 주입용. 기본 = 오늘(UTC). */
  today?: string;
  /** TRIP-754 — i06 적용 성공 신호(`?applied=sessionId`). 있으면 i08 반영 시트를 허브 위에 띄운다. */
  appliedSessionId?: string;
}

const NEUTRAL_BADGE = (
  <View className="h-[72px] w-[72px] rounded-pill bg-surface-strong" />
);

/** 뒤로 갈 히스토리가 없을 때(딥링크·푸시 직행)의 폴백 — ItineraryPlanPage 관례(INV-4 침묵 금지). */
const HOME_FALLBACK = '/(tabs)';

export function LiveItineraryPage({
  tripId,
  today = new Date().toISOString().slice(0, 10),
  appliedSessionId,
}: LiveItineraryPageProps) {
  const query = useLiveItinerary(tripId);
  const trip = useGetTripsTripId(tripId);
  // 사용자가 고른 날(없으면 오늘). 훅 규칙상 조기 반환보다 위에서 무조건 선언한다.
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  // i03 위험 상세 시트 열림 = 그 트리거 id(TRIP-749). 재조회로 트리거가 사라지면 시트도 사라진다.
  const [riskTriggerId, setRiskTriggerId] = useState<string | null>(null);
  // i08 [되돌리기] 안내(E2 — 서버 호출 없이 안내만). 허브 초기 스냅은 마운트 때 한 번만 정한다 —
  // 닫으며 applied 가 지워져도 펼친 허브를 도로 접지 않는다(Q5).
  const [revertNotice, setRevertNotice] = useState(false);
  const [initialSnapIndex] = useState(appliedSessionId ? 2 : undefined);

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
  // 걸러 이 티켓의 3변형 필터엔 못 쓴다). 알약 숨김은 허브 로컬 상태라 서버 억제 호출이 없다(D3).
  const triggers = useActiveTriggers(tripId, {
    enabled: state.kind === 'active',
  });

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

  const { itinerary } = state;
  const activeDayIndex = liveDayIndex;
  const activeDate = itinerary.days[activeDayIndex]?.date ?? '';
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

  // MANUAL 은 표시 표면에서 숨긴다(알약·배지는 WEATHER·DELAY·CLOSURE 3변형만). triggerLabel 은
  // 4종 매핑을 갖되(구조 완전성), 화면 표시 필터는 여기서 — 서로 다른 축이다(★8, BR-U4-01).
  const displayTriggers = (triggers.data?.triggers ?? []).filter(
    (trigger) => trigger.kind !== 'MANUAL'
  );
  // 알약은 발화 중이면 지도 위 상주(전체-날짜 케이스 대행) — 첫 트리거를 대표로 싣는다.
  const chipTrigger = displayTriggers[0];

  const openReplan = (trigger: Trigger) => {
    // 세션 열기까지만(자동 변경 없음, BR-U4-09). 직접 import 아니라 라우팅으로만 planb 로 이동.
    router.push(
      `/trips/${tripId}/planb?scope=${foldScope(trigger.scope)}&triggerId=${trigger.triggerId}`
    );
  };

  // 알약 카피의 대상 = 이 날 슬롯 중 트리거 slotKey 와 같은 것(없으면 라벨만, D2 폴백).
  const pillSlot = chipTrigger
    ? activeSlots.find(
        (slot) => buildSlotKey(activeDate, slot.poiId) === chipTrigger.slotKey
      )
    : undefined;
  const triggerChip = chipTrigger ? (
    <TriggerChip
      label={triggerPillCopy(chipTrigger.kind, pillSlot)}
      onPressAlternative={() => setRiskTriggerId(chipTrigger.triggerId)}
    />
  ) : undefined;

  // 영향 배지 = slotKey 가 맞는 트리거의 라벨(서버 reason 은 허브에 안 흘린다).
  const slotBadgeLabel = (slotKey: string): string | null => {
    const match = displayTriggers.find(
      (trigger) => trigger.slotKey === slotKey
    );
    return match ? triggerLabel(match.kind).label : null;
  };

  // 시트는 허브의 형제로 조건부 마운트한다 — 딤이 FAB·알약까지 전면을 덮고, 닫힘 = 트리에서 사라짐.
  const riskTrigger = displayTriggers.find(
    (trigger) => trigger.triggerId === riskTriggerId
  );
  const riskSheet =
    riskTrigger && riskTrigger.kind !== 'MANUAL' ? (
      <RiskDetailSheet
        kind={riskTrigger.kind}
        title={riskTrigger.reason}
        affected={riskAffectedRow(itinerary.days, riskTrigger.slotKey)}
        watchRows={triggerWatchlist(displayTriggers).rows}
        onPressAlternative={() => {
          // i04 는 허브 위에 겹쳐 뜬다(D1) — 시트를 닫고 가야 뒤에 비치지 않는다.
          setRiskTriggerId(null);
          openReplan(riskTrigger);
        }}
        onClose={() => setRiskTriggerId(null)}
      />
    ) : null;

  return (
    <>
      <LiveHubView
        tripTitle={trip.data?.title ?? ''}
        days={itinerary.days}
        activeDayIndex={activeDayIndex}
        slots={projected}
        onSelectDay={setSelectedDay}
        onBack={() => {
          if (router.canGoBack()) router.back();
          else router.replace(HOME_FALLBACK);
        }}
        // 수동 재계획 세션 진입(BR-U4-10) — 라우팅으로만(execution→planb 직접 import 없이).
        onPressAiReplan={() => router.push(`/trips/${tripId}/planb`)}
        onPressManualEdit={() => router.push(`/trips/${tripId}/planb/manual`)}
        onPressComplete={
          activeVisitCheckId !== null
            ? () => {
                void visitCheck.complete(activeVisitCheckId);
              }
            : undefined
        }
        triggerChip={triggerChip}
        triggerPillKey={chipTrigger?.triggerId}
        slotBadgeLabel={slotBadgeLabel}
        initialSnapIndex={initialSnapIndex}
      />
      {riskSheet}
      {appliedSessionId ? (
        // i08 — 반영 직후 한 번 뜨는 알림. 닫기 = applied 쿼리 제거(값을 undefined 로 줘야 지워진다 —
        // setParams 는 병합이라 `{}` 는 무동작). 부제·배지·내역은 데이터 계약이 없어 안 넘긴다(E4).
        <ReplanAppliedSheet
          showRevertNotice={revertNotice}
          onConfirm={() => router.setParams({ applied: undefined })}
          onRevert={() => setRevertNotice(true)}
        />
      ) : null}
    </>
  );
}
