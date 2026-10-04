import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { useSavedPlaces } from '@/features/save-place';
import {
  buildDraftDayTabs,
  buildDraftPins,
  buildGenerationGauge,
  DRAFT_POLL_INTERVAL_MS,
  foldGenerationGauge,
  formatDraftDayHeader,
  resolveDraftView,
  resolveFallbackNotice,
  resolveShortfallNotice,
  shouldKeepPollingDraft,
} from '@/features/itinerary';
import type { GenerationDayState } from '@/features/itinerary';
import { legDistance } from '@/entities/place';
import { resolveUnplacedNames } from '@/features/itinerary';
import { isGenerationRunning } from '@/features/itinerary';
import { DraftScreen } from './DraftScreen';
import { GenerationFallbackScreen } from './GenerationFallbackScreen';
import { AlertCircleGlyph } from '@/features/itinerary';
import { UnplacedMustVisitNotice } from '@/features/itinerary';
import { buildSlotKey } from '@/entities/itinerary-slot';
import { violationNotice } from '@/entities/itinerary-slot';
import { SlotStopCard } from '@/entities/itinerary-slot';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import { isNotFound } from '@/shared/api';
import { getAccessToken } from '@/shared/api';
import { StateNotice } from '@/shared/ui/StateNotice';
import { DistanceConnector } from '@/widgets/map-sheet-shell';
import { GenerationProgressCard } from '@/widgets/map-sheet-shell';
import type { GenerationProgressCell } from '@/widgets/map-sheet-shell';
import { MapSheetShell } from '@/widgets/map-sheet-shell';
import { SheetHeader } from '@/widgets/map-sheet-shell';

import { DraftFallbackBanner } from './DraftFallbackBanner';
import { SlotCandidatePanelContainer } from './SlotCandidatePanelContainer';

/** 진행 게이지 셀 라벨의 상태부 — `{n}일차 {완성|생성 중|대기}`(한글 · AC-6). 위젯은 features 를
 *  못 물어 이 매핑을 못 하므로(D4) DraftPage 가 도출해 완성된 라벨을 주입한다. */
const GENERATION_STATUS_LABEL: Record<GenerationDayState, string> = {
  done: '완성',
  active: '생성 중',
  waiting: '대기',
};

/** 진행 카드 칸 상한 — 5일 이상 여행은 `…` 접기 칸 포함 4칸으로 접는다(TRIP-1040 결정 1). */
const GAUGE_MAX_CELLS = 4;

/**
 * h11 배선(TRIP-297) — 두 조회를 잇고, 2단계 생성을 폴링으로 잇고, 재생성은 생성 화면으로 보낸다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **탭의 출처는 여행 기간이다.** 서버는 첫날만 담긴 `PARTIAL` 을 먼저 주므로
 *     `days.length` 로 탭을 세면 폴링 도중 탭 개수가 흔들린다(01b D7).
 *  2. **폴링을 자체 타이머 없이 돌린다.** `refetchInterval` 의 함수형이 `Query` 인스턴스를
 *     받고, 지금까지 몇 번 받았는지는 그 안의 `state.dataUpdateCount` 에 이미 있다 —
 *     `useQuery` **반환값에는 없는 값**이라 이걸 못 찾으면 카운터 상태와 타이머를 새로 만들게
 *     된다(그 길이 `src/pages/**` 타이머 금지 심판에 걸린다).
 *  3. **2차 실패는 얼굴을 갈아 끼우지 않는다** — 도착한 1일차는 유효하므로 `staleFailed` 로
 *     곁에 붙는다(openapi: `FAILED` = 2차 실패, 1차분은 유효 · INV-4).
 *  4. **선택 날짜는 여기서 정한다.** 사용자가 고른 날짜가 아직 탭에 없으면(폴링 도중 여행
 *     기간이 늦게 도착) 데이터가 있는 첫 날로 되돌아간다 — 없는 날을 가리킨 채로 두면 화면이
 *     빈 목록을 그린다.
 */
export function DraftPage({ tripId }: { tripId: string }): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  // 어느 슬롯의 교체 시트가 열렸나(=그 슬롯 slotKey). null 이면 닫힘. 컨테이너가 이제 바텀시트
  // (`SlotCandidateSheet`, TRIP-793 이 인라인 패널에서 되돌림)를 그린다. h08 셸 얼굴·DraftScreen
  // 얼굴 두 갈래 모두 화면의 **형제(뒤)** 로 조건부 마운트한다 — 스크롤 안에 두면 뒤 카드·하단
  // 버튼이 시트 위에 그려진다(TRIP-983). 닫힘 = 값이 null 이라 안 그려짐.
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);
  // 폴백 인터스티셜을 "기본 일정 보기"로 넘겼나(01b D3) — 로컬 dismiss 다(route push 아님).
  // true 면 폴백 신호가 있어도 인터스티셜을 감추고 같은 데이터의 초안 얼굴을 그린다.
  const [fallbackDismissed, setFallbackDismissed] = useState(false);
  // TRIP-1032 B — 이 여행이 생성 중일 때 재생성 전 확인이 떠 있나.
  const [confirmingInProgress, setConfirmingInProgress] = useState(false);
  // TRIP-1038 C — 셸 폴백 안내 「처음부터 직접 짜기」의 비우기 확인이 떠 있나.
  const [confirmingReset, setConfirmingReset] = useState(false);
  // MANUAL 빈 일정 → 편집기 replace 를 한 번만(라우터 객체가 렌더마다 새로 와도 다시 부르지 않는다).
  const manualRedirectedRef = useRef(false);
  // TRIP-1037 — 재생성으로 생성 화면에 떠나는 중인가. `useState` 가 아니라 ref 인 이유: 같은 틱의 두 번째
  // 탭은 다음 렌더 전에 들어와 상태로는 못 본다. 400ms `guardPress` 도 조회 await(수 초)를 못 덮는다.
  // 이동 없이 끝나는 경로(모름·확정·MANUAL·확인 열기)에서는 풀어 다시 누를 수 있게 한다(AC-6).
  const leavingRef = useRef(false);
  // 조회를 기다리는 동안 사용자가 떠났나(5-b 경고-1). 홈·카드가 같은 일정 키를 들고 있으면 조회가 abort 되지
  // 않고 도착하므로, 떠난 화면이 전역 라우터로 생성 화면을 불러 사용자를 끌고 가지 않게 await 뒤에 본다.
  // 초기값 false + effect 에서 켜는 형태 — StrictMode 의 정리·재실행에도 값이 맞는다(PlanbRequestPage 선례).
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const itineraryQueryKey = getGetTripsTripIdItineraryQueryKey(tripId);

  /**
   * 마운트 순간의 폴링 횟수. 상한은 "이번 생성에 대해 몇 번 물었나" 라서 절대값이 아니라
   * **기준선과의 차이**로 잰다.
   *
   * 왜 이렇게까지 하나: 카운터를 0으로 되감는 가장 쉬운 길(`resetQueries`)은 카운터와 함께
   * **마지막 성공 응답의 사본까지 버린다.** 그러면 재생성 뒤 재조회가 실패했을 때 이미 받아
   * 둔 목록이 통째로 사라지고 전면 실패 얼굴이 뜬다 — 이 사이클이 막으려던 바로 그 사고다
   * (AC-9 · AC-10 · INV-4). 기준선을 기억해 두면 캐시를 건드리지 않고도 다시 셀 수 있다.
   * (재생성은 이제 생성 화면을 거쳐 이 화면을 **새로 마운트**하므로 그 마운트가 기준선을 다시 잡는다 — TRIP-1037.)
   *
   * `useRef` 는 **다시 그리지 않고 값만 들고 있는 상자**다 — 이 값은 화면에 안 보이고
   * 판정에만 쓰이므로 바뀌었다고 다시 그릴 이유가 없다.
   *
   * 처음 값은 0이 아니라 **마운트 순간의 캐시 카운터**다(TRIP-1006 #084). 카운터는 이 화면 것이
   * 아니라 캐시 속 쿼리 하나의 것이라, 같은 일정을 보는 다른 화면(같이 짜기의 PARTIAL 폴링 등)이
   * 이미 30 넘게 올려 둘 수 있다. 0부터 세면 열자마자 "상한 도달"로 판정해 폴링을 시작조차 안 한다.
   * (`useRef` 의 인자는 첫 렌더에서만 쓰인다 — 이후 렌더에서 다시 계산돼도 버려진다.)
   */
  const pollBaseline = useRef(
    queryClient.getQueryState(itineraryQueryKey)?.dataUpdateCount ?? 0
  );

  /** 캐시가 새로 만들어져 카운터가 되감기면 음수가 될 수 있어 0으로 바닥을 둔다. */
  function pollsSinceBaseline(dataUpdateCount: number): number {
    return Math.max(0, dataUpdateCount - pollBaseline.current);
  }

  const trip = useGetTripsTripId(tripId);
  const itinerary = useGetTripsTripIdItinerary(tripId, {
    query: {
      // 상한 도달을 화면이 보려면 **마지막 응답 뒤에 한 번 더 그려져야** 한다. 기본값에서는
      // 실제로 쓰는 값(`data`)이 바뀔 때만 다시 그리는데, 2차 생성이 멈춘 동안 서버는 똑같은
      // PARTIAL 을 계속 돌려주므로 구조적 공유로 `data` 참조가 그대로다 → 리렌더가 아예 안
      // 일어난다. 실측(프로브): 이 줄이 없으면 폴링은 정확히 30회에서 멈추는데 배너가 영영
      // 안 뜬다. `'all'` 은 응답마다(=`dataUpdatedAt` 이 바뀔 때마다) 다시 그리게 한다.
      notifyOnChangeProps: 'all',
      refetchInterval: (query) =>
        shouldKeepPollingDraft({
          generationState: query.state.data?.generationState,
          dataUpdateCount: pollsSinceBaseline(query.state.dataUpdateCount),
        })
          ? DRAFT_POLL_INTERVAL_MS
          : false,
    },
  });

  const days = itinerary.data?.days ?? [];
  const periodTabs = buildDraftDayTabs({
    startDate: trip.data?.startDate ?? '',
    endDate: trip.data?.endDate ?? '',
    days,
  });
  // 여행 조회가 실패하면 기간을 모른다. 그때 탭을 비운 채로 두면 **일정 조회가 성공해 손에
  // 든 일자까지 화면에서 사라진다** — 선택 날짜가 어느 탭에도 없어 슬롯을 못 찾기 때문이다.
  // 탭의 정본이 여행 기간이라는 결정(01b D7)은 그대로 두고, 그 정보가 없을 때만 도착한
  // 일자로 대신 세운다(일자는 빠짐없이 연속이다 — INV-U3-01).
  //
  // ⚠️ **"실패했다"와 "아직 안 끝났다"를 가른다.** 조회가 도는 중에도 `periodTabs` 는 비어
  // 있는데, 그때까지 폴백을 태우면 일정이 여행보다 먼저 도착한 몇백 ms 동안 **도착한 일자
  // 수만큼만 탭이 보인다**(3일 여행이 잠깐 1일 여행으로 보인다) — D7이 막으려던 바로 그
  // 증상이다. 조회가 아직 안 끝났으면 아무 탭도 그리지 않는 편이 옳다(틀린 정보 < 무정보).
  const tabs =
    periodTabs.length > 0 || trip.isPending
      ? periodTabs
      : buildDraftDayTabs({
          startDate: days[0]?.date ?? '',
          endDate: days[days.length - 1]?.date ?? '',
          days,
        });
  // 고른 날짜는 **데이터가 있을 때만** 지킨다. 존재만 보면(`tabs.some(date === picked)`)
  // 탭은 여행 기간에서 나오므로 3일 여행의 세 날짜가 항상 들어 있어, 재생성으로 그날 데이터가
  // 사라져도 선택이 그대로 남는다 → 카드 0장·`0곳`·지도 없음인 빈 화면에 갇힌다.
  // 되돌림이 발동하는 조건은 하나뿐이다: **고른 날짜에 데이터가 없을 때.** 그 날짜에 데이터가
  // 다시 도착하면 선택은 그리로 돌아온다 — 사용자의 선택을 버리지 않는다.
  const selectedDate =
    pickedDate !== null &&
    tabs.some((tab) => tab.date === pickedDate && tab.hasData)
      ? pickedDate
      : (tabs.find((tab) => tab.hasData)?.date ?? tabs[0]?.date ?? '');

  // 상한(30회 ≒ 60초)에 걸려 폴링이 멈췄는데 아직 `PARTIAL` 이면 2차 생성이 영영 안 온
  // 것이다. 이 항이 없으면 폴링만 조용히 멈추고 화면은 **완전히 정상으로 보인다**(AC-9
  // 후반절 · INV-4). 횟수는 `useQuery` 반환값에 없고 캐시의 `QueryState` 에만 있다.
  const pollCount = pollsSinceBaseline(
    queryClient.getQueryState(itineraryQueryKey)?.dataUpdateCount ?? 0
  );
  const pollExhausted =
    itinerary.data?.generationState === 'PARTIAL' &&
    !shouldKeepPollingDraft({
      generationState: itinerary.data.generationState,
      dataUpdateCount: pollCount,
    });

  // 후보 요약은 **판정 함수에만** 넘긴다 — 화면 층은 이 값을 보지도, 그 어휘(`LOW` 따위)를
  // 알지도 못한다(frontend-components.md §2·§6). 판정이 두 층에 흩어지면 같은 규칙이 서로
  // 다르게 진화한다.
  const summary = itinerary.data?.candidatesSummary;

  const view = resolveDraftView({
    days,
    loading: trip.isPending || itinerary.isPending,
    failed:
      trip.isError ||
      itinerary.isError ||
      itinerary.data?.generationState === 'FAILED' ||
      pollExhausted,
  });

  // 2단계 생성 중(PARTIAL)이면 h07 부분 결과 얼굴 — 완성 얼굴(DraftScreen) 대신 공용 지도+시트
  // 셸을 그린다(01b D1 · TRIP-790). features→widgets 상향 참조 금지라 이 조립은 pages(여기)에서만
  // 할 수 있다. 아래 shell 분기가 `view.kind==='listed' && isPartial` 에서 이 값을 쓴다.
  const isPartial = itinerary.data?.generationState === 'PARTIAL';
  // TRIP-1038 A — 직접 짠 일정은 「AI 추천안」이 아니다. AI 생성 POST 로 가는 버튼을 주지 않는다(BR-U3-18).
  const isManual = itinerary.data?.generationMode === 'MANUAL';
  // MANUAL 인데 장소가 0곳이면 DraftScreen 빈 얼굴(「다시 만들기」=AI 생성)을 그리지 않고 편집기로 보낸다(01 Q1).
  const redirectToManual = isManual && view.kind === 'empty';

  // TRIP-1094 — 넣지 못한 꼭 갈 곳의 이름은 담은 장소에서 찾는다. 조회는 미배치가 있고 로그인일 때만
  // (AC-13). 조회 대기·실패·게스트면 담은 장소가 빈 배열이라 서버 문구만 먼저 보인다(Q4 · INV-4).
  const unplaced = itinerary.data?.unplacedMustVisits;
  const { savedPlaces } = useSavedPlaces({
    isAuthed: getAccessToken() !== null && (unplaced?.length ?? 0) > 0,
  });
  const unplacedRows = resolveUnplacedNames({ unplaced, savedPlaces });

  // 안내 신호를 한 번만 접는다 — h08 라우팅 조건(깨끗한 COMPLETE 판별)과 DraftScreen
  // 프롭이 같은 값을 써야 갈라지지 않는다(같은 규칙이 두 층에서 다르게 진화하는 것 방지).
  // 두 축은 따로 접는다(TRIP-1174): 폴백 축(AI 가 쉬었다)만 인터스티셜·「기본 일정」을 정하고,
  // 후보 축(LOW — AI 는 돌았고 후보가 모자랐다)은 시트 안 한 줄 안내만 띄운다.
  const signals = {
    solveMode: itinerary.data?.solveMode,
    isFallback: itinerary.data?.isFallback,
    candidatesSummary: summary,
  };
  const fallbackNotice = resolveFallbackNotice(signals);
  const shortfallNotice = resolveShortfallNotice(signals);

  /**
   * 재생성 — 생성 화면(POST 는 그 화면이 마운트 때 1회)으로 보낸다. **확정 일정은 어떤 경로로도 보내지 않는다.**
   *
   * ⚠️ 조회가 끝나기 전에는 `status` 를 모른다(`data` 가 `undefined`). 그 상태로 보내면
   * 확정 일정에도 POST 가 나가 확정이 풀리고 동결됐던 poi_snapshot 참조가 사라진다 —
   * 되돌리는 API 가 없다. 그래서 **모를 때는 먼저 기다렸다가** 안전이 확인된 뒤에만 보낸다.
   * `cancelRefetch: false` 라 이미 날아가 있는 조회를 취소하지 않고 그 결과에 올라탄다.
   *
   * 조회로도 상태를 못 얻으면 **404 일 때만** 보낸다. 404 는 "일정이 아직 없다" 는 답이라
   * 만들어도 안전하고(빈 화면에서 생성을 시작하는 길을 막으면 사용자가 나갈 곳이 없다),
   * 그 밖의 실패(5xx · 네트워크 끊김)는 "모른다" 라서 확정 일정일 수도 있다.
   */
  async function handleRetry(): Promise<void> {
    // 잠금은 await **앞**에서 — 조회를 기다리는 동안 들어온 누름도 막는다.
    if (leavingRef.current) return;
    leavingRef.current = true;

    const settled =
      itinerary.data !== undefined
        ? itinerary
        : await itinerary.refetch({ cancelRefetch: false });
    if (!mountedRef.current) return;
    const status = settled.data?.status;

    const stop =
      (status === undefined && !isNotFound(settled.error)) ||
      status === 'CONFIRMED' ||
      // TRIP-1038 — 직접 짠 일정을 AI 생성으로 덮지 않는다(방어 한 줄 — 셸·빈 얼굴은 이미 이 길을 안 준다).
      settled.data?.generationMode === 'MANUAL';
    if (stop) {
      leavingRef.current = false;
      return;
    }

    // TRIP-1032 B — 이 여행이 생성 중이면 확인부터. 확인 뒤엔 cancel 을 따로 부르지 않는다 — 같은 여행
    // POST 가 서버에서 이전 세션을 닫는다(01b Q4).
    if (isGenerationRunning(settled.data)) {
      leavingRef.current = false;
      setConfirmingInProgress(true);
      return;
    }

    goGenerating();
  }

  /** 생성 화면으로 replace 1회 — 409 안내·실패·재시도는 그 화면이 진다(TRIP-1037 결정 A). */
  function goGenerating(): void {
    leavingRef.current = true;
    router.replace({
      pathname: '/trips/[tripId]/itinerary/generating',
      params: { tripId, mode: 'FULLY_AI' },
    });
  }

  // 수동 짜기 라우트(h19, fresh 없음 = 기존 일정 이어 편집). 인터스티셜·DraftScreen·MANUAL 셸 「편집하기」가
  // 쓴다 — 셸 폴백 안내 링크는 비우기 확인을 거쳐 fresh 를 싣는다(TRIP-1038 C). 접미 있는 라우트라 객체형 push 로 `[tripId]` 를 해소한다(TRIP-483 AC-4).
  function goManualPlan(): void {
    router.push({
      pathname: '/trips/[tripId]/itinerary/manual',
      params: { tripId },
    });
  }

  useEffect(() => {
    if (!redirectToManual || manualRedirectedRef.current) return;
    manualRedirectedRef.current = true;
    router.replace({
      pathname: '/trips/[tripId]/itinerary/manual',
      params: { tripId },
    });
  }, [redirectToManual, router, tripId]);

  // 두 뒤로가기(h35 후보 0건 · h11 초안) 공통. 딥링크로 콜드 오픈돼 히스토리가 없으면
  // (`canGoBack()===false`) 침묵 no-op 이 아니라 홈으로 replace 한다(INV-4). `/(tabs)/itinerary`
  // 는 trips[0] 리다이렉트 함정이라 접미 없는 `/(tabs)` 로 간다. `ItineraryPlanPage.handleBack`
  // 을 이 페이지에 지역 복제한 것이다(shared 승격 아님 — pages 간 import 금지 · YAGNI).
  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }

  // TRIP-1032 B — 이 여행이 생성 중일 때 재생성 확인(새 오버레이 없이 인라인 얼굴 — jest 로 심판된다).
  if (confirmingInProgress) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 justify-center bg-canvas px-lg">
          <StateNotice
            testID="itinerary-draft-inprogress-confirm"
            icon={<AlertCircleGlyph />}
            title="지금 만들고 있는 일정이 있어요"
            description="새로 만들면 진행 중인 생성을 멈추고 새 초안으로 바꿔요. 계속할까요?"
            actions={[
              {
                testID: 'itinerary-draft-inprogress-confirm-continue',
                label: '계속',
                variant: 'filled',
                onPress: () => {
                  if (leavingRef.current) return;
                  setConfirmingInProgress(false);
                  goGenerating();
                },
              },
              {
                testID: 'itinerary-draft-inprogress-confirm-cancel',
                label: '취소',
                variant: 'outline',
                onPress: () => setConfirmingInProgress(false),
              },
            ]}
          />
        </View>
      </SafeAreaView>
    );
  }

  // TRIP-1038 C — 비우기 확인(진행 중 확인과 같은 얼굴 교체형 — 셸이 트리에서 빠진다). 취소하면
  // `fallbackDismissed` 가 그대로라 인터스티셜이 아니라 셸로 돌아간다. 복원 화면이 없어 되돌릴 수 있다고 쓰지 않는다.
  if (confirmingReset) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 justify-center bg-canvas px-lg">
          <StateNotice
            testID="itinerary-draft-manual-reset-confirm"
            icon={<AlertCircleGlyph />}
            title="지금 일정을 비우고 새로 짤까요?"
            description="담아 둔 장소가 모두 빠지고 빈 일정에서 시작해요"
            actions={[
              {
                testID: 'itinerary-draft-manual-reset-confirm-continue',
                label: '비우고 시작',
                variant: 'filled',
                onPress: () => {
                  setConfirmingReset(false);
                  router.push({
                    pathname: '/trips/[tripId]/itinerary/manual',
                    params: { tripId, fresh: '1' },
                  });
                },
              },
              {
                testID: 'itinerary-draft-manual-reset-confirm-cancel',
                label: '취소',
                variant: 'outline',
                onPress: () => setConfirmingReset(false),
              },
            ]}
          />
        </View>
      </SafeAreaView>
    );
  }

  // 편집기로 replace 하는 중 — DraftScreen 빈 얼굴의 AI 문구를 한 프레임도 그리지 않는다.
  if (redirectToManual) {
    return <View className="flex-1 bg-canvas" />;
  }

  /**
   * h07 부분 결과(PARTIAL) — 2단계 생성이 진행 중이면 완성 얼굴 대신 **공용 지도+시트 셸**을 그린다
   * (01b D1). 진행 카드가 day-chip 자리를 대체하고(overlay), 하단 peek 시트에 이미 도착한 1일차
   * 슬롯을 결과로 얹는다. CTA 는 안 준다 — 생성 중이라 확정할 완성본이 없다(D9).
   */
  if (view.kind === 'listed' && isPartial) {
    const partialSlots =
      days.find((day) => day.date === selectedDate)?.slots ?? [];
    const partialPins = buildDraftPins(partialSlots);
    // 게이지 셀은 여기서 tabs 에서 도출해 `{status,label}` 로 매핑 주입한다 — 위젯은 features
    // (`buildGenerationGauge`)를 못 물어 상태를 못 도출한다(D4). 3셀의 출처는 `days.length` 가
    // 아니라 **여행 기간**(tabs)이라, day1 만 도착해도 셀은 여행 일수만큼 선다(01b D7 급소).
    // 5일 이상이면 칸 상한(4) 안으로 접는다 — 지금 만드는 일차는 항상 남는다(TRIP-1040).
    const cells: GenerationProgressCell[] = foldGenerationGauge(
      buildGenerationGauge(tabs),
      GAUGE_MAX_CELLS
    ).map((cell) =>
      'kind' in cell
        ? { status: 'more' }
        : {
            status: cell.state,
            label: `${cell.dayNumber}일차 ${GENERATION_STATUS_LABEL[cell.state]}`,
          }
    );
    const selectedDayNumber =
      tabs.find((tab) => tab.date === selectedDate)?.dayNumber ?? 1;
    // 헤더 meta = "N곳 · X.Xkm". `legDistance` 는 "이동 3.5km" 를 주지만 헤더는 **km 부만** 쓴다
    // (D8 · INV-3 — "이동" 접두·소요 어휘 금지). 합 대상은 커넥터가 그리는 구간(`slice(1)`)뿐이고,
    // 그중 하나라도 거리를 모르면 "N곳"만(TRIP-1110 · INV-4).
    const legLabel = legDistance(
      partialSlots.slice(1).map((slot) => slot.distanceRange)
    );
    const kmPart = legLabel === null ? null : legLabel.replace('이동 ', '');
    const meta =
      kmPart === null
        ? `${partialSlots.length}곳`
        : `${partialSlots.length}곳 · ${kmPart}`;
    // 지도 center — 첫 핀(좌표 없으면 안전 폴백; 실서비스 PARTIAL day1 은 좌표 있는 POI 라 도달 X).
    const center =
      partialPins.length > 0
        ? { lat: partialPins[0].lat, lng: partialPins[0].lng }
        : { lat: 0, lng: 0 };

    return (
      <MapSheetShell
        center={center}
        pins={partialPins}
        fitPins
        overlay={<GenerationProgressCard cells={cells} onBack={handleBack} />}
        header={
          // 제목에 날짜를 **합쳐** 한 leaf 로 넣는다(dayLabel/dateLabel 빈 값). 진행 카드 게이지의
          // done 셀 라벨과 이 제목이 둘 다 "N일차 완성" 이면 `getByText` 가 둘을 잡아 실패하므로
          // (A8-1b 는 게이지 라벨을 exact 로, A8-1e 는 헤더 제목을 regex 로 잡는다 — 헤더가 더 긴
          // 문자열이어야 한다), 헤더 제목은 "N일차 완성 · 날짜" 로 게이지 라벨과 겹치지 않게 한다.
          <SheetHeader
            title={`${selectedDayNumber}일차 완성 · ${formatDraftDayHeader(
              selectedDate
            )}`}
            dayLabel=""
            dateLabel=""
            meta={meta}
          />
        }
      >
        <View className="gap-md px-lg pb-2xl pt-xs">
          {partialSlots.flatMap((slot, index) => {
            const items: ReactElement[] = [
              <SlotStopCard
                key={`card-${slot.poiId}`}
                slot={slot}
                date={selectedDate}
                index={index}
                // 도착 일차 전 슬롯 시각 칩(isFixed 무관 · AC-2 · D6). 구분자는 en-dash U+2013.
                timeLabel={`${slot.startAt.slice(0, 5)}–${slot.endAt.slice(
                  0,
                  5
                )}`}
                // "다른 후보 ›" 는 PARTIAL 에선 넘기지 않는다(= 안 그려진다, TRIP-939) — day1-only PUT 이
                // 생성 중 day2·3 을 덮어쓰는 사고 방지(traps-itinerary TRIP-467/483 잔여). 정식
                // 게이팅은 후속 티켓.
              />,
            ];
            if (index < partialSlots.length - 1) {
              const nextSlot = partialSlots[index + 1];
              items.push(
                <DistanceConnector
                  key={`conn-${slot.poiId}`}
                  slotKey={buildSlotKey(selectedDate, slot.poiId)}
                  distanceRange={nextSlot.distanceRange}
                />
              );
            }
            return items;
          })}
        </View>
      </MapSheetShell>
    );
  }

  /**
   * 폴백 인터스티셜(TRIP-791) — 생성이 끝났는데 취향 반영이 실패(폴백)면, 초안 목록 앞을
   * 가로막는 전용 화면을 그린다(01b D1·D2·⑦). 판정은 재발명하지 않고 `resolveFallbackNotice` 를
   * 그대로 재사용해 F-7(MANUAL 방어)까지 물려받는다 — MANUAL(MINIMAL·isFallback=false)은
   * fallbackNotice=null 이라 여기로 안 온다. "기본 일정 보기"는 로컬 dismiss(D3)라 route push 없이
   * 같은 데이터의 초안 얼굴로 넘어간다. `mustVisitCount` 는 고정 슬롯(꼭 갈 곳 앵커) 수에서 파생하고
   * 0 이면 미표시한다(0곳 오표기보다 미표기가 정직 · D4). 하드실패(POST 오류) 라우팅은 이번 무심판
   * (화면 `failed` 변형 배선은 재량 · 02a §3) — 이 배선은 폴백 신호만 인터스티셜로 보낸다.
   */
  if (fallbackNotice !== null && !fallbackDismissed) {
    const fixedCount = days.reduce(
      (sum, day) => sum + day.slots.filter((slot) => slot.isFixed).length,
      0
    );
    return (
      <GenerationFallbackScreen
        mustVisitCount={fixedCount > 0 ? fixedCount : undefined}
        pins={buildDraftPins(
          days.find((day) => day.date === selectedDate)?.slots ?? []
        )}
        onViewPlan={() => setFallbackDismissed(true)}
        onManualPlan={goManualPlan}
        onRetry={() => void handleRetry()}
        onBack={handleBack}
      />
    );
  }

  // 슬롯 교체 시트 — 셸·DraftScreen 두 갈래가 같은 JSX 를 공유해 각자 화면의 뒤 형제로 둔다.
  const candidateSheet =
    editingSlotKey !== null ? (
      <SlotCandidatePanelContainer
        tripId={tripId}
        slotKey={editingSlotKey}
        onClose={() => setEditingSlotKey(null)}
      />
    ) : null;

  /**
   * h08 초안 셸 — 2단계 생성이 끝난(!isPartial) 목록이면 **공용 지도+시트 셸**로 그린다(TRIP-792).
   * TRIP-1039 부터 폴백·staleFailed 목록도 여기로 온다(후보 부족 LOW 도 — TRIP-1174) — 그 사실은 시트 맨 위
   * `DraftFallbackBanner` 가 계속 말한다(BR-U3-11 · INV-4). 폴백이면 제목이 「기본 일정」이고 안내 안에
   * 「처음부터 직접 짜기」 링크가 붙는다(D2). h07 셸과 달리 day-chip 오버레이(overlay 미전달=기본 렌더)와
   * 하단 CTA 두 갈래(다시 짜기·확정하기)를 얹는다.
   */
  if (view.kind === 'listed' && !isPartial) {
    const listedSlots =
      days.find((day) => day.date === selectedDate)?.slots ?? [];
    const listedPins = buildDraftPins(listedSlots);
    // 일차 칩은 **데이터가 도착한 날만** 그린다(TRIP-1039 · 03b 경고-1). 셸 칩(`DayChip`)엔 disabled 가
    // 없어 빈 날 칩을 두면 눌러도 `selectedDate` 가 되돌아가 무반응이 된다(staleFailed 로 2·3일차가 안 온 목록).
    // 칩 번호는 이 줄인 목록 기준이라 index ↔ 날짜도 같은 배열로 찾는다. 라벨은 여행 기간의 일차 번호 그대로.
    const chipTabs = tabs.filter((tab) => tab.hasData);
    const dayChips = chipTabs.map((tab) => ({
      label: `${tab.dayNumber}일차`,
    }));
    const selectedDayIndex = chipTabs.findIndex(
      (tab) => tab.date === selectedDate
    );
    const selectedDayNumber =
      tabs.find((tab) => tab.date === selectedDate)?.dayNumber ?? 1;
    // 헤더 meta = "N곳 · X.Xkm". `legDistance` 의 "이동 " 접두는 떼고 km 부만(D8 · INV-3).
    // 합 대상은 커넥터 구간(`slice(1)`)뿐, 하나라도 모르면 "N곳"만(TRIP-1110 · INV-4).
    const legLabel = legDistance(
      listedSlots.slice(1).map((slot) => slot.distanceRange)
    );
    const kmPart = legLabel === null ? null : legLabel.replace('이동 ', '');
    const meta =
      kmPart === null
        ? `${listedSlots.length}곳`
        : `${listedSlots.length}곳 · ${kmPart}`;
    const center =
      listedPins.length > 0
        ? { lat: listedPins[0].lat, lng: listedPins[0].lng }
        : { lat: 0, lng: 0 };

    return (
      <>
        <MapSheetShell
          center={center}
          pins={listedPins}
          fitPins
          // TRIP-1204 — 시트가 열린 채로도 손가락 확대·이동(셸 기본은 열림=잠금). 6-b 실기 전용.
          mapViewOnly={false}
          days={dayChips}
          selectedDayIndex={selectedDayIndex < 0 ? 0 : selectedDayIndex}
          onSelectDay={(index) => setPickedDate(chipTabs[index]?.date ?? null)}
          onBack={handleBack}
          header={
            <SheetHeader
              title={
                isManual
                  ? '내 일정'
                  : fallbackNotice !== null
                    ? '기본 일정'
                    : 'AI 추천안'
              }
              dayLabel={`${selectedDayNumber}일차`}
              dateLabel={formatDraftDayHeader(selectedDate)}
              meta={meta}
            />
          }
          cta={[
            // MANUAL 은 편집기로 이어 편집(fresh 없음 — TRIP-601 가드 a 가 기존 일정을 지킨다 · POST 0).
            isManual
              ? {
                  label: '편집하기',
                  variant: 'outline',
                  onPress: goManualPlan,
                }
              : {
                  label: '다시 짜기',
                  variant: 'outline',
                  onPress: () => void handleRetry(),
                },
            {
              label: '확정하기',
              variant: 'primary',
              onPress: () =>
                router.push({
                  pathname: '/trips/[tripId]/itinerary',
                  params: { tripId },
                }),
            },
          ]}
        >
          <View className="gap-md px-lg pb-2xl pt-xs">
            <DraftFallbackBanner
              fallback={fallbackNotice !== null}
              shortfall={shortfallNotice}
              staleFailed={view.staleFailed}
              // 확정 일정은 비우지 않는다(확정 해제 API 없음) — 확인 없이 현행 이동만.
              onManualPlan={
                itinerary.data?.status === 'CONFIRMED'
                  ? goManualPlan
                  : () => setConfirmingReset(true)
              }
            />
            <UnplacedMustVisitNotice rows={unplacedRows} />
            {listedSlots.flatMap((slot, index) => {
              const items: ReactElement[] = [
                <SlotStopCard
                  key={`card-${slot.poiId}`}
                  slot={slot}
                  date={selectedDate}
                  index={index}
                  // 전 슬롯 시각 칩(isFixed 무관 · AC-3 · D8). 구분자는 en-dash U+2013.
                  timeLabel={`${slot.startAt.slice(0, 5)}–${slot.endAt.slice(
                    0,
                    5
                  )}`}
                  // "다른 후보 ›" 는 비고정 슬롯에만 표시(고정=미주입→링크 부재 · AC-7). TRIP-793 이
                  // 이 트리거를 처음 실배선한다 — 시트는 셸의 형제로 조건부 마운트한다(planb
                  // StaySelectSheet 선례 · `candidateSheet`).
                  onPressAlt={
                    slot.isFixed
                      ? undefined
                      : () =>
                          setEditingSlotKey(
                            buildSlotKey(selectedDate, slot.poiId)
                          )
                  }
                  violation={violationNotice(slot)}
                />,
              ];
              if (index < listedSlots.length - 1) {
                const nextSlot = listedSlots[index + 1];
                items.push(
                  <DistanceConnector
                    key={`conn-${slot.poiId}`}
                    slotKey={buildSlotKey(selectedDate, slot.poiId)}
                    distanceRange={nextSlot.distanceRange}
                  />
                );
              }
              return items;
            })}
          </View>
        </MapSheetShell>
        {candidateSheet}
      </>
    );
  }

  return (
    <>
      <DraftScreen
        view={view}
        tabs={tabs}
        selectedDate={selectedDate}
        pins={buildDraftPins(
          days.find((day) => day.date === selectedDate)?.slots ?? []
        )}
        dayHeader={formatDraftDayHeader(selectedDate)}
        canRetry={itinerary.data?.status !== 'CONFIRMED'}
        // 폴백 판정은 위에서 접은 값 그대로(재발명 금지 → F-7 승계). 인터스티셜을 넘긴 목록이 폴백임을
        // 제목·배지로 계속 말한다(BR-U3-11 · TRIP-1008).
        fallback={fallbackNotice !== null}
        shortfall={shortfallNotice}
        onSelectDay={setPickedDate}
        onRetry={() => void handleRetry()}
        onBack={handleBack}
        // h25(완성 일정) — 접미 없는 index 라우트다(draft·generating 과 달리). 객체형 push 라야
        // `[tripId]` 가 params 로 해소된다(문자열 형태는 미해결로 깨진다 · TRIP-454 AC-5).
        onComplete={() =>
          router.push({
            pathname: '/trips/[tripId]/itinerary',
            params: { tripId },
          })
        }
        // 비고정 슬롯 "다른 후보 ›" press → 그 슬롯 slotKey 를 **토글**한다(같은 슬롯 재press 는 닫힘 ·
        // 한 번에 한 슬롯 · TRIP-483 ★C). 재대입 `setEditingSlotKey(k)` 은 같은 값이라 안 닫힌다.
        onPressSlot={(slotKey) =>
          setEditingSlotKey((prev) => (prev === slotKey ? null : slotKey))
        }
        onManualPlan={goManualPlan}
      />
      {/* 스크롤 밖 뒤 형제라야 카드·하단 버튼 위에 그려진다(TRIP-983). */}
      {candidateSheet}
    </>
  );
}
