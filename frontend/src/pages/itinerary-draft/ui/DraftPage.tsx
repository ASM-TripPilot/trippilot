import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import {
  buildDraftDayTabs,
  buildDraftPins,
  DRAFT_POLL_INTERVAL_MS,
  formatDraftDayHeader,
  resolveDraftView,
  resolveFallbackNotice,
  shouldKeepPollingDraft,
} from '@/features/itinerary/model/draftView';
import { DraftScreen } from '@/features/itinerary/ui/DraftScreen';
import { ZeroCandidateScreen } from '@/features/itinerary/ui/ZeroCandidateScreen';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';

import { SlotCandidatePanelContainer } from './SlotCandidatePanelContainer';

/**
 * h11 배선(TRIP-297) — 두 조회를 잇고, 2단계 생성을 폴링으로 잇고, 재생성을 보낸다.
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
  // 어느 슬롯의 교체 패널이 펼쳐졌나(=그 슬롯 slotKey). null 이면 닫힘. 패널은 그 카드 **바로 아래**
  // 스크롤 흐름에 인라인으로 뜨고(바텀시트 아님 · TRIP-483), 화면이 이 값과 일치하는 카드 자리에서만
  // `renderSlotPanel(slotKey)` 을 불러 컨테이너를 마운트한다 — 닫힘 = 값이 null 이라 안 그려짐.
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);

  const itineraryQueryKey = getGetTripsTripIdItineraryQueryKey(tripId);

  /**
   * 재생성 직전의 폴링 횟수. 상한은 "이번 생성에 대해 몇 번 물었나" 라서 절대값이 아니라
   * **기준선과의 차이**로 잰다.
   *
   * 왜 이렇게까지 하나: 카운터를 0으로 되감는 가장 쉬운 길(`resetQueries`)은 카운터와 함께
   * **마지막 성공 응답의 사본까지 버린다.** 그러면 재생성 뒤 재조회가 실패했을 때 이미 받아
   * 둔 목록이 통째로 사라지고 전면 실패 얼굴이 뜬다 — 이 사이클이 막으려던 바로 그 사고다
   * (AC-9 · AC-10 · INV-4). 기준선을 기억해 두면 캐시를 건드리지 않고도 다시 셀 수 있다.
   *
   * `useRef` 는 **다시 그리지 않고 값만 들고 있는 상자**다 — 이 값은 화면에 안 보이고
   * 판정에만 쓰이므로 바뀌었다고 다시 그릴 이유가 없다.
   */
  const pollBaseline = useRef(0);

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
  const regenerate = usePostTripsTripIdItinerary();

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

  const baseView = resolveDraftView({
    days,
    loading: trip.isPending || itinerary.isPending,
    // 재생성 실패도 여기로 온다 — 실패하면 목록은 그대로인데 화면이 아무 말도 안 하게 된다
    // (BR-U1-55 침묵 실패 금지).
    failed:
      trip.isError ||
      itinerary.isError ||
      regenerate.isError ||
      itinerary.data?.generationState === 'FAILED' ||
      pollExhausted,
    candidatesSummary: summary,
  });

  // h10 "만드는 중" 얼굴은 목록(listed) 위에 **얹히는 축**이다(01b D1) — PARTIAL 이면 generating 을
  // 실어 화면이 게이지·스켈레톤·제목을 h10 으로 바꾼다(탭·카드는 그대로 공존). `DraftScreenProps`
  // 를 안 늘리려 새 프롭 대신 view 에 실어 나른다(프롭 수 동결 심판 · itineraryMapSurfaceStructure S3).
  const view =
    baseView.kind === 'listed'
      ? {
          ...baseView,
          generating: itinerary.data?.generationState === 'PARTIAL',
        }
      : baseView;

  /**
   * 재생성 — **확정 일정에는 어떤 경로로도 보내지 않는다.**
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
    const settled =
      itinerary.data !== undefined
        ? itinerary
        : await itinerary.refetch({ cancelRefetch: false });
    const status = settled.data?.status;

    if (status === undefined) {
      if (!isNotFound(settled.error)) return;
    } else if (status === 'CONFIRMED') {
      return;
    }

    regenerate.mutate(
      { tripId },
      {
        onSuccess: () => {
          // POST 응답은 day1 만 담긴 PARTIAL 이다 — 나머지는 GET 폴링이 받아 온다.
          // ⚠️ 여기서 하는 일은 **카운터 되감기뿐이고 데이터는 건드리지 않는다.**
          // 폴링 횟수는 Query 인스턴스의 상태라 `invalidateQueries` 로는 안 줄어드는데
          // (실측: 4 → 5 로 이어진다), 줄이겠다고 `resetQueries` 를 쓰면 카운터와 함께
          // **마지막 성공 응답 사본까지 버려서** 뒤이은 재조회 실패가 목록 전멸이 된다
          // (실측: 카드 3장 → 0장 + 전면 실패 얼굴). 기준선을 옮겨 두고 무효화만 한다.
          // 자체 타이머는 여전히 쓰지 않는다.
          pollBaseline.current =
            queryClient.getQueryState(itineraryQueryKey)?.dataUpdateCount ?? 0;
          void queryClient.invalidateQueries({ queryKey: itineraryQueryKey });
        },
      }
    );
  }

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

  /**
   * 후보 0건은 **다른 화면**이다(h35) — 목록 화면 안의 빈 상태가 아니라, 조건을 밝히고
   * 다음 행동을 주는 별도 얼굴이다. 그래서 `DraftScreen` 을 아예 그리지 않는다.
   *
   * 완화 제안 목적지는 **실재하는 라우트 하나뿐**이다(01b D7). 반경·예산 완화는 보낼
   * 파라미터도 갈 화면도 없어서 그리지 않았다 — 갈 수 없는 곳으로 안내하지 않는다.
   */
  if (view.kind === 'zero') {
    return (
      <ZeroCandidateScreen
        shortfallCategories={view.shortfallCategories}
        onBack={handleBack}
        onReduceMustVisits={() =>
          router.push({
            pathname: '/trips/[tripId]/itinerary/must-visits',
            params: { tripId },
          })
        }
      />
    );
  }

  return (
    <DraftScreen
      view={view}
      tabs={tabs}
      selectedDate={selectedDate}
      pins={buildDraftPins(
        days.find((day) => day.date === selectedDate)?.slots ?? []
      )}
      dayHeader={formatDraftDayHeader(selectedDate)}
      canRetry={itinerary.data?.status !== 'CONFIRMED'}
      fallbackNotice={resolveFallbackNotice({
        solveMode: itinerary.data?.solveMode,
        isFallback: itinerary.data?.isFallback,
        candidatesSummary: summary,
      })}
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
      expandedSlotKey={editingSlotKey}
      // 패널 내용(후보 POST→선택→PUT→재조회)은 컨테이너가 소유한다 — 화면은 이 함수를 펼친 카드
      // 아래 자리에만 불러 컨테이너를 마운트한다(TRIP-335→483 로직 재사용, 프레젠테이션만 인라인).
      renderSlotPanel={(slotKey) => (
        <SlotCandidatePanelContainer
          tripId={tripId}
          slotKey={slotKey}
          onClose={() => setEditingSlotKey(null)}
        />
      )}
      // 「처음부터 직접」·「직접 고르기」 공통 목적지 — 수동 짜기 라우트(h19). 접미 있는 라우트라
      // 객체형 push 로 `[tripId]` 를 해소한다(onComplete 선례 · TRIP-483 AC-4).
      onManualPlan={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/manual',
          params: { tripId },
        })
      }
    />
  );
}
