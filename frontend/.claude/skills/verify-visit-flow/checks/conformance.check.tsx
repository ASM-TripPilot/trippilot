/**
 * verify-visit-flow 적합성 검사 — TLA+ 모델(VisitFlow.tla 「CODE MIRROR」)이 실제 코드와 같은 판정을 하는지
 * fast-check 생성 입력으로 대조한다. 손으로 쓴 함수 모형이 아니라 **실제 코드**를 돌린다:
 *   deriveVisitProgress · deriveSkippedPoiIds · projectSlotProgress (페이지가 부르는 그대로) → LiveHubView 렌더 →
 *   [도착]·[방문 완료] testID 를 읽는다. 그리고 buildStartReplanRequest 의 excludedPoiIds.
 *
 * 이 파일이 red 면 "코드가 모델과 달라졌다"는 뜻이다 — 앱 결함이 아니다. 모델의 CODE MIRROR 와 아래 model*
 * 함수를 코드에 맞게 고친 뒤 TLC 를 다시 돌려야 속성 결과가 다시 유효하다.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, cleanup, renderHook } from '@testing-library/react-native';
import fc from 'fast-check';

import {
  deriveSkippedPoiIds,
  deriveVisitProgress,
  projectSlotProgress,
  type ItineraryDaysItemSlotsItem,
} from '@/entities/itinerary-slot';
import { buildStartReplanRequest } from '@/features/request-replan';
import type { VisitCheck } from '@/shared/api/index.schemas';
import { LiveHubView } from '@/pages/live/live-itinerary/ui/LiveHubView';
import { useVisitCheck } from '@/features/check-visit';
import {
  getGetTripsTripIdVisitsDaysDayQueryKey,
  postTripsTripIdVisits,
  postTripsTripIdVisitsVisitCheckIdComplete,
} from '@/shared/api/index.hooks';

// 생성 클라이언트의 HTTP 함수만 갈아 끼운다(useVisitCheck 가 부르는 그대로) — 나머지는 실물.
jest.mock('@/shared/api/index.hooks', () => ({
  ...jest.requireActual('@/shared/api/index.hooks'),
  postTripsTripIdVisits: jest.fn(),
  postTripsTripIdVisitsVisitCheckIdComplete: jest.fn(),
}));

type Rec = 'none' | 'open' | 'done' | 'skipped';
const POIS = ['a', 'b', 'c', 'd'] as const;
const DATE = '2026-06-11';
const T = `${DATE}T01:00:00Z`;
const T2 = `${DATE}T02:00:00Z`;

// ── 모델 식(VisitFlow.tla CODE MIRROR 의 TS 옮김 — 둘은 같이 고친다) ─────────────────────
function modelArriveTargets(plan: string[], cache: Record<string, Rec>, opt: Set<string>): string[] {
  const completed = (p: string) => cache[p] === 'done';
  const candidate = (p: string) => (cache[p] === 'open' || opt.has(p)) && !completed(p);
  const active = plan.findIndex(candidate); // ActiveIdx (0-기반, 없으면 -1)
  const state = (i: number) => (completed(plan[i]) ? 'done' : i === active ? 'active' : 'upcoming');
  const skipped = new Set(plan.filter((p) => cache[p] === 'skipped'));
  return plan.filter(
    (p, i) => state(i) === 'upcoming' && !skipped.has(p) && (active < 0 || i > active)
  );
}
function modelShowComplete(plan: string[], cache: Record<string, Rec>, opt: Set<string>, armed: boolean): boolean {
  const candidate = (p: string) => (cache[p] === 'open' || opt.has(p)) && cache[p] !== 'done';
  const active = plan.findIndex(candidate);
  if (active < 0) return false; // [방문 완료]는 진행 중 카드에만
  const arriveAfterActive = modelArriveTargets(plan, cache, opt).length > 0;
  return armed || !arriveAfterActive;
}
const modelExcludedSent: string[] = []; // ExcludedSent == {}

// ── 입력 생성 ────────────────────────────────────────────────────────────────
const slot = (poiId: string): ItineraryDaysItemSlotsItem => ({
  poiId,
  startAt: '10:00:00',
  endAt: '11:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  alternatives: [],
  nameKo: `장소 ${poiId}`,
  distanceRange: '약 1km',
  openingHours: null,
  lat: 35.1,
  lng: 129.1,
  tags: [],
});

function visitsOf(cache: Record<string, Rec>, opt: Set<string>): VisitCheck[] {
  const out: VisitCheck[] = [];
  for (const p of POIS) {
    const r = cache[p];
    if (r !== 'none') {
      out.push({
        visitCheckId: `v-${p}`,
        slotKey: `${DATE}#${p}`,
        poiId: p,
        arrivedAt: T,
        completedAt: r === 'done' ? T2 : null,
        skippedAt: r === 'skipped' ? T2 : null,
        source: 'MANUAL',
        spontaneous: false,
        updatedAt: T2,
      } as VisitCheck);
    }
    if (opt.has(p)) {
      // useVisitCheck.arrive 의 낙관 레코드 모양 그대로
      out.push({
        visitCheckId: `optimistic:${p}`,
        slotKey: `${DATE}#${p}`,
        poiId: p,
        arrivedAt: `${DATE}T00:00:00`,
        completedAt: null,
        skippedAt: null,
        source: 'MANUAL',
        spontaneous: false,
        updatedAt: `${DATE}T00:00:00`,
      } as VisitCheck);
    }
  }
  return out;
}

const arbCase = fc
  .record({
    plan: fc.shuffledSubarray([...POIS], { minLength: 1, maxLength: 4 }),
    recs: fc.tuple(...POIS.map(() => fc.constantFrom<Rec>('none', 'open', 'done', 'skipped'))),
    optPick: fc.tuple(...POIS.map(() => fc.boolean())),
    armed: fc.boolean(),
  })
  .map(({ plan, recs, optPick, armed }) => {
    const cache = Object.fromEntries(POIS.map((p, i) => [p, recs[i]])) as Record<string, Rec>;
    // 낙관 도착은 '예정' 카드(기록 없음·건너뜀)에만 생긴다(useVisitCheck.arrive 는 [도착]에서만 불린다).
    const opt = new Set(POIS.filter((p, i) => optPick[i] && (cache[p] === 'none' || cache[p] === 'skipped')));
    return { plan, cache, opt, armed };
  });

const ARRIVE = /^execution-live-slot-arrive-/;

afterEach(cleanup);

describe('verify-visit-flow 적합성 — 모델 CODE MIRROR == 실제 코드', () => {
  it('[도착]이 서는 카드와 [방문 완료] 노출이 모델 식과 같다 (실제 파생 함수 + LiveHubView)', () => {
    fc.assert(
      fc.property(arbCase, ({ plan, cache, opt, armed }) => {
        const list = { visits: visitsOf(cache, opt) };
        // LiveItineraryPage.tsx 가 하는 그대로(250~258·484~487행)
        const progress = deriveVisitProgress(list, DATE, plan);
        const skippedPoiIds = new Set(deriveSkippedPoiIds(list, DATE));
        const projected = projectSlotProgress(plan.map(slot), {
          completedPoiIds: progress.completedPoiIds,
          activePoiId: progress.activePoiId,
        });
        const view = render(
          <LiveHubView
            tripTitle="여행"
            days={[{ date: DATE }]}
            activeDayIndex={0}
            slots={projected}
            initialSnapIndex={1}
            onBack={() => {}}
            onSelectDay={() => {}}
            onPressAiReplan={() => {}}
            onPressManualEdit={() => {}}
            onPressChatbot={() => {}}
            onPressComplete={() => {}}
            onPressArrive={() => {}}
            skippedPoiIds={skippedPoiIds}
            automationArmed={armed}
          />
        );
        const shown = view
          .queryAllByTestId(ARRIVE)
          .map((n) => String(n.props.testID).split('#')[1])
          .sort();
        const complete = view.queryByTestId('execution-arrive-complete') !== null;
        view.unmount();
        expect({ arrive: shown, complete }).toEqual({
          arrive: modelArriveTargets(plan, cache, opt).sort(),
          complete: modelShowComplete(plan, cache, opt, armed),
        });
      }),
      { numRuns: 150 }
    );
  });

  it('수동 재계획 요청의 excludedPoiIds 가 모델(ExcludedSent)과 같다', () => {
    // PlanbRequestPage 는 수동 진입에서 entrySeed 가 없어 excludedPoiIds 로 undefined 를 넘긴다.
    const body = buildStartReplanRequest({
      scope: 'PARTIAL_SLOTS',
      reasons: [],
      directives: [],
      freeText: '',
      triggerId: null,
      excludedPoiIds: undefined,
    });
    expect(body.excludedPoiIds).toEqual(modelExcludedSent);
  });

  // VisitFlow.tla ChainCompleteOk / ChainCompleteNetFail — 사슬은 앞 완료가 성공했을 때만 도착을 보낸다.
  describe('사슬 [도착] (useVisitCheck.completeThenArrive)', () => {
    const DAY = DATE;
    const key = getGetTripsTripIdVisitsDaysDayQueryKey('trip-1', DAY);
    const openA = {
      visitCheckId: 'v-a', slotKey: `${DAY}#a`, poiId: 'a', arrivedAt: T, completedAt: null, skippedAt: null,
      source: 'MANUAL', spontaneous: false, updatedAt: T,
    } as VisitCheck;
    function setup() {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(key, { visits: [openA] });
      const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
      const { result } = renderHook(() => useVisitCheck({ tripId: 'trip-1', day: DAY }), { wrapper });
      return { client, result };
    }
    const chain = { completeVisitCheckId: 'v-a', arrive: { slotKey: `${DAY}#b`, poiId: 'b', source: 'MANUAL' as const } };
    beforeEach(() => jest.mocked(postTripsTripIdVisits).mockReset());

    it('ChainCompleteNetFail — 완료가 네트워크로 실패하면 도착 요청 0, 앞 장소는 진행 중으로 되돌아간다', async () => {
      jest.mocked(postTripsTripIdVisitsVisitCheckIdComplete).mockRejectedValue(new Error('network'));
      const { client, result } = setup();
      let out: unknown;
      await act(async () => { out = await result.current.completeThenArrive(chain); });
      expect(out).toMatchObject({ kind: 'failed', step: 'complete' });
      expect(postTripsTripIdVisits).not.toHaveBeenCalled();
      expect(client.getQueryData<{ visits: VisitCheck[] }>(key)?.visits).toEqual([openA]);
    });

    it('ChainCompleteOk — 완료가 성공한 뒤에만 도착을 보낸다', async () => {
      jest.mocked(postTripsTripIdVisitsVisitCheckIdComplete).mockResolvedValue({ ...openA, completedAt: T2 } as never);
      jest.mocked(postTripsTripIdVisits).mockResolvedValue({ ...openA, visitCheckId: 'v-b', slotKey: `${DAY}#b`, poiId: 'b' } as never);
      const { result } = setup();
      let out: unknown;
      await act(async () => { out = await result.current.completeThenArrive(chain); });
      expect(out).toEqual({ kind: 'arrived' });
      expect(jest.mocked(postTripsTripIdVisitsVisitCheckIdComplete).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(postTripsTripIdVisits).mock.invocationCallOrder[0]
      );
    });
  });
});
