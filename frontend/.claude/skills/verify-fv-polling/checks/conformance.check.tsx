/**
 * 적합성 — 모델(model/GenPolling.tla)의 CODE MIRROR 식이 실제 코드와 같은 판정을 하는지 **조합 전수**로 대조한다.
 *   DraftFace·DraftPollDue  ↔ 실제 DraftPage 렌더(얼굴 testID) + 그 관찰자의 refetchInterval(query)
 *   ShellPollDue            ↔ 실제 useGenerationWatch 가 붙인 관찰자의 refetchInterval(query)
 * 입력 공간이 작아(초안 12, 셸 48) 생성 입력 대신 전부 돈다. 아래 model* 함수는 TLA 의 같은 이름 식을 글자 그대로 옮긴 것 —
 * 모델을 고치면 여기도 함께 고친다.
 */
import { act, cleanup, render, screen } from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';
import type { QueryClient } from '@tanstack/react-query';

import { server } from '@/mocks/server';
import type { Itinerary, ItineraryGenerationState } from '@/shared/api/index.schemas';
import { getGetTripsTripIdItineraryQueryKey, getGetTripsTripIdQueryKey } from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { DRAFT_POLL_MAX_COUNT } from '@/features/itinerary/model/draftView';
import { createWrapper, newTestQueryClient, settle } from '@/test-support/queryRender';
import { itinerary, trip, TRIP_ID } from '@/test-support/itineraryFixtures';
import { resetToast } from '@/test-support/toastHarness';
import { DraftPage } from '@/pages/itinerary/itinerary-draft/ui/DraftPage';
import { useGenerationWatch } from '@/app/model/useGenerationWatch';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));
let mockPathname = '/';
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true,
  }),
  router: { push: jest.fn() },
  usePathname: () => mockPathname,
}));

const BASE = 'http://localhost:8080/api/v1';
const KEY = getGetTripsTripIdItineraryQueryKey(TRIP_ID);
type St = 'Complete' | 'Partial' | 'Failed';
const CODE_STATE: Record<St, ItineraryGenerationState> = { Complete: 'COMPLETE', Partial: 'PARTIAL', Failed: 'FAILED' };

// ── CODE MIRROR (GenPolling.tla 와 같은 식) ─────────────────────────────────
// 모델의 "Old"(예전 완성본)는 코드에선 COMPLETE 다 — 같은 값이라 Complete 로 대조한다.
const modelDraftPollDue = (st: St, capped: boolean) => st === 'Partial' && !capped;
const modelDraftFace = (st: St, err: boolean) =>
  st === 'Partial' ? 'progress' : st === 'Failed' ? 'resultFailed' : err ? 'resultFailed' : 'result';
const modelShellPollDue = (scr: Scr, st: St, run: boolean, err: boolean) =>
  !['Gen', 'Obs', 'Draft'].includes(scr) && (st === 'Partial' || run) && !err;

type Scr = 'Entry' | 'Gen' | 'Obs' | 'Draft' | 'Away';
const PATH: Record<Scr, string> = {
  Entry: `/trips/${TRIP_ID}/itinerary/must-visits`,
  Gen: `/trips/${TRIP_ID}/itinerary/generating`,
  Obs: `/trips/${TRIP_ID}/itinerary/generating`,
  Draft: `/trips/${TRIP_ID}/itinerary/draft`,
  Away: '/',
};

const data = (st: St, run: boolean): Itinerary =>
  itinerary({ generationState: CODE_STATE[st], generationSessionId: run ? 'sess-1' : null });

/** 이 키에 붙은 관찰자 중 refetchInterval 이 함수인 것의 판정(없으면 false). */
function pollDue(client: QueryClient): boolean {
  const query = client.getQueryCache().find({ queryKey: KEY });
  if (!query) return false;
  return query.observers.some((o) => {
    const ri = o.options.refetchInterval;
    return typeof ri === 'function' && ri(query as never) !== false;
  });
}
function markError(client: QueryClient): void {
  act(() => {
    client.getQueryCache().find({ queryKey: KEY })!.setState({ status: 'error', error: new Error('x') });
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    // 대조 중엔 응답이 상태를 바꾸지 않게 오래 붙잡는다(판정은 요청 전 상태로 한다).
    http.get(`${BASE}/trips/:tripId/itinerary`, () => new Promise<Response>(() => undefined))
  );
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetToast();
  act(() => clearAccessToken());
});
afterAll(() => server.close());

const STS: St[] = ['Complete', 'Partial', 'Failed'];
const BOOLS = [false, true];

describe('DraftFace·DraftPollDue == DraftPage', () => {
  const cases = STS.flatMap((st) => BOOLS.flatMap((err) => BOOLS.map((capped) => ({ st, err, capped }))));
  it.each(cases)('%o', async ({ st, err, capped }) => {
    const client = newTestQueryClient({ staleTime: Infinity });
    client.setQueryData(getGetTripsTripIdQueryKey(TRIP_ID), trip());
    client.setQueryData(KEY, data(st, false));
    render(<DraftPage tripId={TRIP_ID} />, { wrapper: createWrapper(client) });
    if (capped) {
      act(() => {
        for (let i = 0; i < DRAFT_POLL_MAX_COUNT; i += 1) client.setQueryData(KEY, data(st, false));
      });
    }
    if (err) markError(client);
    await settle(); // react-query 알림은 setTimeout(0) 뒤에 온다 — 여러 틱 흘린다

    const face = screen.queryByTestId('generation-progress-card')
      ? 'progress'
      : screen.queryByTestId('sheet-cta-root')
        ? screen.queryByTestId('itinerary-draft-stale-failed') ? 'resultFailed' : 'result'
        : 'other';
    expect({ face, poll: pollDue(client) }).toEqual({ face: modelDraftFace(st, err), poll: modelDraftPollDue(st, capped) });
  });
});

describe('ShellPollDue == useGenerationWatch', () => {
  function Shell(): null {
    useGenerationWatch(true, 'HOME');
    return null;
  }
  const SCRS: Scr[] = ['Entry', 'Gen', 'Draft', 'Away'];
  const cases = SCRS.flatMap((scr) =>
    STS.flatMap((st) => BOOLS.flatMap((run) => BOOLS.map((err) => ({ scr, st, run, err }))))
  );
  it.each(cases)('%o', async ({ scr, st, run, err }) => {
    mockPathname = PATH[scr];
    const client = newTestQueryClient({ staleTime: Infinity });
    client.setQueryData(KEY, data(st, run));
    if (err) markError(client);
    render(<Shell />, { wrapper: createWrapper(client) });
    await settle(); // react-query 알림은 setTimeout(0) 뒤에 온다 — 여러 틱 흘린다
    expect(pollDue(client)).toBe(modelShellPollDue(scr, st, run, err));
  });
});
