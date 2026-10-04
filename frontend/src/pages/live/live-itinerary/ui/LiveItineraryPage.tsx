import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { resolveLiveState } from '../model/liveState';
import {
  openNextNav,
  resolveSlotDests,
  useLiveItinerary,
} from '@/features/execution';
import { projectSlotProgress } from '@/entities/itinerary-slot';
import { useVisitCheck } from '../model/useVisitCheck';
import { photoAttach } from '@/features/attach-visit-media';
import { pickPhotoForVisit } from '@/features/attach-visit-media';
import { useVisitMemo } from '@/features/attach-visit-media';
import { MemoSheet } from './MemoSheet';
import { deriveVisitProgress } from '@/entities/itinerary-slot';
import { TriggerChip } from './TriggerChip';
import { buildSlotKey } from '@/entities/itinerary-slot';
import { foldScope } from '../model/foldScope';
import { riskAffectedRow } from '../model/riskAffectedRow';
import { triggerLabel } from '@/features/planb';
import { triggerPillCopy } from '@/features/planb';
import { triggerWatchlist } from '../model/triggerWatchlist';
import { visitedLabelByPoiId } from '../model/visitedLabels';
import {
  appliedSummaryBadges,
  appliedSummaryInputFromDiff,
  useActiveTriggers,
} from '@/features/planb';
import { ReplanAppliedSheet } from './ReplanAppliedSheet';
import { RiskDetailSheet } from './RiskDetailSheet';
import type { ReplanDiff, Trigger } from '@/shared/api/index.schemas';
import {
  getGetTripsTripIdReplanSessionsSessionIdDiffQueryKey,
  postTripsTripIdVisitsVisitCheckIdPhotos,
  useGetTripsTripId,
  useGetTripsTripIdVisitsDaysDay,
} from '@/shared/api/index.hooks';
import { isNotFound } from '@/shared/api';
import { seoulDate } from '@/shared/lib/seoulDate';
import { StateNotice } from '@/shared/ui/StateNotice';
import { ArriveRequestSource } from '@/shared/api/index.schemas';

import { LiveHubView } from './LiveHubView';

/**
 * TRIP-395 · live-itinerary 페이지 — 조회·판정·조립의 단일 출처.
 *
 * useLiveItinerary(tripId) + 오늘 날짜 → resolveLiveState 판정 1회 → 상태별 렌더. 시각·순서는
 * 솔버 검증값이라 재계산하지 않는다(INV-2). trip 은 헤더 제목(trip.title)만을 위해 따로 조회하고
 * 판정에는 넣지 않는다 — trip 로딩이 일정 얼굴을 막지 않는다. active 얼굴은 i01 허브 순수 뷰
 * (`LiveHubView`, TRIP-746)가 그린다. 사진·후기는 조회 계약이 없어 넘기지 않는다(G6 — 칸 생략).
 *
 * `today` 는 테스트 주입 seam 이다(기본 = 오늘 KST). 순수 판정 함수 resolveLiveState 에 날짜를
 * 넘겨 주는 자리라 여기 `new Date()` 가 있고, features/execution 안에는 없다.
 */

export interface LiveItineraryPageProps {
  tripId: string;
  /** 'YYYY-MM-DD' — 테스트 주입용. 기본 = 오늘(KST). */
  today?: string;
  /** TRIP-754 — i06 적용 성공 신호(`?applied=sessionId`). 있으면 i08 반영 시트를 허브 위에 띄운다. */
  appliedSessionId?: string;
  /**
   * TRIP-1195 — 처음 열 날짜 'YYYY-MM-DD'(`?day=`). 오늘이 아닌 날을 확정하고 돌아올 때만 온다 — 그 날 일차로 연다.
   * 일정에 없는 값·형식이 틀린 값은 무시하고 종전 기본(오늘)로 연다(보는 위치일 뿐 쓰기·거짓 표기가 없어 INV-4 대상 아님).
   * 사용자가 일차 칩을 고르면 그 선택이 이긴다.
   */
  initialDate?: string;
}

const NEUTRAL_BADGE = (
  <View className="h-[72px] w-[72px] rounded-pill bg-surface-strong" />
);

/** 허브 [사진] 저장 실패 안내(INV-4) — 허브엔 사진 칸이 없어 실패 셀 대신 카드 아래 한 줄로. */
const PHOTO_SAVE_FAILED = '사진을 기록하지 못했어요. 다시 시도해 주세요';

/** 허브 메모 저장 실패 안내(INV-4) — j01 `VisitRecordCardContainer` 와 같은 문장(TRIP-1117). */
const MEMO_SAVE_FAILED = '메모를 저장하지 못했어요. 다시 시도해 주세요.';

/** 뒤로 갈 히스토리가 없을 때(딥링크·푸시 직행)의 폴백 — ItineraryPlanPage 관례(INV-4 침묵 금지). */
const HOME_FALLBACK = '/(tabs)';

export function LiveItineraryPage({
  tripId,
  today = seoulDate(new Date()),
  appliedSessionId,
  initialDate,
}: LiveItineraryPageProps) {
  const query = useLiveItinerary(tripId);
  const trip = useGetTripsTripId(tripId);
  const queryClient = useQueryClient();
  // i08 배지 — 초안 화면(i06)이 확정 직전까지 들고 있던 diff 로 만든다. 확정(APPLIED) 뒤 서버는 diff 를 비우므로
  // 다시 조회하지 않고 캐시만 읽는다. 캐시가 없거나 ready 가 아니면 배지 줄 없이 뜬다.
  // useMemo 로 붙잡는 이유: getQueryData 는 구독이 아니라 읽기 한 번이다 — 시트가 뜬 채로 캐시가 정리(gc, 기본 5분)된 뒤
  // 허브가 다시 그려지면(되돌리기 안내 등) 매 렌더 읽기는 undefined 를 얻어 배지가 사라진다.
  const appliedBadges = useMemo(() => {
    if (!appliedSessionId) return undefined;
    const cachedDiff = queryClient.getQueryData<ReplanDiff>(
      getGetTripsTripIdReplanSessionsSessionIdDiffQueryKey(
        tripId,
        appliedSessionId
      )
    );
    return cachedDiff?.ready === true
      ? appliedSummaryBadges(appliedSummaryInputFromDiff(cachedDiff))
      : undefined;
  }, [queryClient, tripId, appliedSessionId]);
  // 사용자가 고른 날(없으면 오늘). 훅 규칙상 조기 반환보다 위에서 무조건 선언한다.
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  // i03 위험 상세 시트 열림 = 그 트리거 id(TRIP-749). 재조회로 트리거가 사라지면 시트도 사라진다.
  const [riskTriggerId, setRiskTriggerId] = useState<string | null>(null);
  // i08 [되돌리기] 안내(E2 — 서버 호출 없이 안내만). 허브 초기 스냅은 마운트 때 한 번만 정한다 —
  // 닫으며 applied 가 지워져도 펼친 허브를 도로 접지 않는다(Q5).
  const [revertNotice, setRevertNotice] = useState(false);
  const [initialSnapIndex] = useState(appliedSessionId ? 2 : undefined);
  // 관람 중 카드 [사진] 안내 한 줄(TRIP-1070). 다음 [사진] 누름에 지운다.
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  // TRIP-1189 다음 예정지 [길찾기] — 외부 앱을 띄우는 동안 연타를 막는 잠금(ref: 같은 틱 두 번째 press 도 본다)과
  // 앱·웹 모두 실패했을 때의 거리 안내(INV-4).
  const directionsBusy = useRef(false);
  const [directionsNotice, setDirectionsNotice] = useState<{
    poiId: string;
    text: string;
  } | null>(null);

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
  const initialDayIndex =
    state.kind === 'active' && initialDate
      ? state.itinerary.days.findIndex((day) => day.date === initialDate)
      : -1;
  const liveDayIndex =
    selectedDay ??
    (state.kind === 'active'
      ? initialDayIndex >= 0
        ? initialDayIndex
        : state.todayIndex
      : 0);
  const liveDate =
    state.kind === 'active'
      ? (state.itinerary.days[liveDayIndex]?.date ?? '')
      : '';
  const visits = useGetTripsTripIdVisitsDaysDay(tripId, liveDate, {
    query: { enabled: state.kind === 'active' && liveDate !== '' },
  });
  const visitCheck = useVisitCheck({ tripId, day: liveDate });

  // 방문 기록 → 진행 상태 도출(★도달성 — 빈 인자면 전 슬롯 upcoming 이라 active 카드가 프로덕션에 안 뜬다).
  // 도출·판정은 여기 1회. TRIP-1117 — 메모 세션 캐시를 관람 중 방문 id 로 읽어야 해서(훅은 조기 반환 위에서만)
  // 조기 반환 아래에 있던 도출을 여기로 올렸다. active 가 아니면 슬롯이 비어 관람 중이 없다.
  const activeSlots =
    state.kind === 'active'
      ? (state.itinerary.days[liveDayIndex]?.slots ?? [])
      : [];
  const progress = deriveVisitProgress(
    visits.data ?? { visits: [] },
    liveDate,
    activeSlots.map((slot) => slot.poiId)
  );
  const activeVisitCheckId =
    progress.activePoiId !== null
      ? (progress.visitCheckIdByPoiId[progress.activePoiId] ?? null)
      : null;
  // 메모 저장만 쓴다 — useVisitAttachments 는 사진 목록 GET 을 무조건 쏘므로 부르지 않는다(F6). 캐시 키는 j01 과 한 벌.
  const visitMemo = useVisitMemo({
    tripId,
    visitCheckId: activeVisitCheckId ?? '',
  });
  // 메모 시트 열림 = "어느 방문으로 열었나"(AC-16) — 재조회로 관람 중 방문이 바뀌면 시트가 저절로 빠진다.
  const [memoSheetFor, setMemoSheetFor] = useState<string | null>(null);
  // 메모 저장 실패가 난 방문. 시트가 열려 있으면 시트 안, 닫혀 있으면 관람 중 카드 아래에 보인다(Q3).
  const [memoFailedFor, setMemoFailedFor] = useState<string | null>(null);
  // 늦게 온 옛 실패가 최신 시도를 덮지 않게 시도 번호를 센다(j01 onSubmitMemo 선례).
  const memoAttempt = useRef(0);

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
  const activeDate = liveDate;

  const projected = projectSlotProgress(activeSlots, {
    completedPoiIds: progress.completedPoiIds,
    activePoiId: progress.activePoiId,
  });
  // 결정 2 — 세션 저장본을 관람 중 카드의 메모 박스로 내린다(done 카드는 범위 밖, Q5).
  // TRIP-1220 — 완료 카드 시각은 실제 도착 시각(기록 j01 과 같은 값). 없으면 카드가 계획 시각으로 표시한다.
  const visitedLabels = visitedLabelByPoiId(
    visits.data ?? { visits: [] },
    activeDate
  );
  const hubSlots = projected.map((entry) =>
    entry.state === 'active'
      ? { ...entry, memo: visitMemo.savedMemo }
      : entry.state === 'done'
        ? { ...entry, visitedLabel: visitedLabels[entry.slot.poiId] ?? null }
        : entry
  );

  // TRIP-1189 — 예정·진행 중 슬롯마다 [길찾기]. 도착지·출발지(바로 앞 슬롯, 첫 예정지는 현재 위치)는 resolveSlotDests 가
  // 정한다. 외부 지도앱에 넘기고 우리 라우트는 건드리지 않으므로 복귀하면 같은 허브다(BR-U4-39).
  const slotDests = resolveSlotDests(projected);
  const directionsPoiIds = new Set(slotDests.keys());
  const pressDirections = async (poiId: string) => {
    const dest = slotDests.get(poiId);
    if (!dest || directionsBusy.current) return;
    directionsBusy.current = true;
    setDirectionsNotice(null);
    try {
      await openNextNav(dest, (distanceRange) =>
        setDirectionsNotice({
          poiId,
          text: distanceRange
            ? `지도를 열 수 없어요. ${distanceRange}`
            : '지도를 열 수 없어요.',
        })
      );
    } finally {
      directionsBusy.current = false;
    }
  };

  // TRIP-1070 [사진] — 관람 중 방문에 메타만 POST 한다. 사진 목록은 조회하지 않는다(허브엔 사진 칸이
  // 없다 — useVisitAttachments 는 GET 을 무조건 쏘므로 부르지 않는다, F6).
  const attachActivePhoto = async (visitCheckId: string) => {
    setPhotoNotice(null);
    const picked = await pickPhotoForVisit();
    if ('notice' in picked) {
      setPhotoNotice(picked.notice);
      return;
    }
    try {
      await postTripsTripIdVisitsVisitCheckIdPhotos(
        tripId,
        visitCheckId,
        photoAttach(picked.asset, picked.gpsConsent)
      );
    } catch {
      setPhotoNotice(PHOTO_SAVE_FAILED);
    }
  };

  // TRIP-1117 [메모] — 허브 위 메모 시트에서 저장한다(TRIP-1070 결정 1(c) 번복). 닫힘은 저장 성공 뒤(Q1).
  const memoSheetOpen =
    activeVisitCheckId !== null && memoSheetFor === activeVisitCheckId;
  const submitMemo = (visitCheckId: string, text: string) => {
    const attempt = ++memoAttempt.current;
    setMemoFailedFor(null);
    visitMemo.saveMemo(text).then(
      () => {
        if (attempt === memoAttempt.current)
          setMemoSheetFor((open) => (open === visitCheckId ? null : open));
      },
      () => {
        if (attempt === memoAttempt.current) setMemoFailedFor(visitCheckId);
      }
    );
  };
  const memoFailed =
    activeVisitCheckId !== null && memoFailedFor === activeVisitCheckId;
  const memoSheet =
    memoSheetOpen && activeVisitCheckId !== null ? (
      <MemoSheet
        placeName={
          activeSlots.find((slot) => slot.poiId === progress.activePoiId)
            ?.nameKo ?? ''
        }
        text={visitMemo.savedMemo}
        notice={memoFailed ? MEMO_SAVE_FAILED : null}
        onSubmit={(text) => submitMemo(activeVisitCheckId, text)}
        onClose={() => setMemoSheetFor(null)}
      />
    ) : null;

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
        slots={hubSlots}
        onSelectDay={setSelectedDay}
        onBack={() => {
          if (router.canGoBack()) router.back();
          else router.replace(HOME_FALLBACK);
        }}
        // 수동 재계획 세션 진입(BR-U4-10) — 라우팅으로만(execution→planb 직접 import 없이).
        // TRIP-1195 — 바라보는 날이 오늘이 아니면 그 날짜를 쿼리로 넘긴다(오늘이면 쿼리 없음 = 종전과 같은 경로).
        // 이미 지난 날은 서버가 409 로 막는 막다른 길이라 진입 자체를 숨긴다(결정 3). 여행 구간 밖이라 보는 날이
        // 없으면(activeDate '') 종전 그대로 — 서버가 기간 밖을 판정한다.
        onPressAiReplan={
          activeDate !== '' && activeDate < today
            ? undefined
            : () =>
                router.push(
                  activeDate !== '' && activeDate !== today
                    ? `/trips/${tripId}/planb?targetDate=${activeDate}`
                    : `/trips/${tripId}/planb`
                )
        }
        onPressManualEdit={() => router.push(`/trips/${tripId}/planb/manual`)}
        onPressComplete={
          activeVisitCheckId !== null
            ? () => {
                void visitCheck.complete(activeVisitCheckId);
              }
            : undefined
        }
        onPressPhoto={
          activeVisitCheckId !== null
            ? () => void attachActivePhoto(activeVisitCheckId)
            : undefined
        }
        // [메모] — 허브 위 메모 시트를 연다(TRIP-1117). 카드 아래 실패 안내는 여기서 지운다.
        onPressMemo={
          activeVisitCheckId !== null
            ? () => {
                setMemoFailedFor(null);
                setMemoSheetFor(activeVisitCheckId);
              }
            : undefined
        }
        photoNotice={photoNotice}
        memoNotice={!memoSheetOpen && memoFailed ? MEMO_SAVE_FAILED : null}
        fabHidden={memoSheetOpen}
        triggerChip={triggerChip}
        triggerPillKey={chipTrigger?.triggerId}
        slotBadgeLabel={slotBadgeLabel}
        onPressSlotName={(poiId) =>
          router.push(`/trips/${tripId}/live/place/${poiId}`)
        }
        // TRIP-1021 수동 [도착] — 보는 날짜가 실제 오늘일 때만(Q6, 날짜 문자열 비교 — todayIndex 는 여행
        // 밖이면 첫날/마지막 날로 끼운 값이라 못 쓴다). 다른 날에 열면 그날 슬롯에 오늘 도착이 찍힌다.
        // 방문 기록 데이터가 있을 때만 — 첫 로딩·첫 실패 중엔 전부 '예정'으로 보여 이미 도착한 곳에 409 가 난다.
        // isSuccess 가 아니라 data 기준: 재조회 한 번 실패로 캐시 데이터가 있는데 버튼이 전부 사라지면 안 된다(03b 재리뷰 R1).
        // 위치 권한은 보지 않는다(Q2 — 자동 도착 TRIP-1018 보류 중 유일한 도착 경로).
        // 슬롯 키가 비면 서버가 즉석 방문으로 기록하므로 반드시 싣는다. 실패는 훅이 그 레코드만 롤백한다.
        onPressArrive={
          activeDate === today && visits.data !== undefined
            ? (poiId) => {
                void visitCheck.arrive({
                  slotKey: buildSlotKey(activeDate, poiId),
                  poiId,
                  source: ArriveRequestSource.MANUAL,
                });
              }
            : undefined
        }
        directionsPoiIds={directionsPoiIds}
        onPressDirections={(poiId) => void pressDirections(poiId)}
        directionsNotice={directionsNotice}
        initialSnapIndex={initialSnapIndex}
      />
      {riskSheet}
      {memoSheet}
      {appliedSessionId ? (
        // i08 — 반영 직후 한 번 뜨는 알림. 닫기 = applied 쿼리 제거(값을 undefined 로 줘야 지워진다 —
        // setParams 는 병합이라 `{}` 는 무동작). 배지는 초안 화면이 남긴 diff 캐시에서 만든다(TRIP-1188 —
        // 서버는 확정 뒤 diff 를 비운다). 캐시에 없으면(앱 재시작 등) 배지 줄만 숨긴다. 부제·내역은 계약이 없어 안 넘긴다.
        <ReplanAppliedSheet
          summaryBadges={appliedBadges}
          showRevertNotice={revertNotice}
          onConfirm={() => router.setParams({ applied: undefined })}
          onRevert={() => setRevertNotice(true)}
        />
      ) : null}
    </>
  );
}
