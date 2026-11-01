/**
 * 모델 반례 재현 — 실제 GeneratingPage·DraftPage·MustVisitListPage 를 MSW 가짜 서버 위에서 단계별로 돌린다.
 * 가짜 서버는 backend itinerary-generation 규칙(A1~A5)만 흉내 낸다. 리포 jest 에 섞이지 않게 `.check.tsx` 로 두고
 * scripts/run.sh 가 리포 밖 임시 폴더에 `.test.tsx` 로 복사해 돌린다.
 *
 * 각 R 은 **지금 코드의 동작**을 단언한다. R1~R5 는 TRIP-1690 에서 고쳐져 「고친 동작」을 단언하고(결함이 돌아오면
 * 「어긋남」), R6 은 아직 남은 웹 잔여(FV-POLL-05)의 지금 동작을 단언한다 — 고쳐지면 「어긋남」 → SKILL.md 「결과 읽기」 3.
 */
import { delay, http, HttpResponse } from 'msw';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { QueryClient } from '@tanstack/react-query';

import { server } from '@/mocks/server';
import type { Itinerary, MustVisit } from '@/shared/api/index.schemas';
import { getGetTripsTripIdItineraryQueryKey, useGetTripsTripIdItinerary } from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { DRAFT_POLL_INTERVAL_MS, DRAFT_POLL_MAX_COUNT } from '@/features/itinerary/model/draftView';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';
import { itinerary, trip, TRIP_ID } from '@/test-support/itineraryFixtures';
import { resetToast } from '@/test-support/toastHarness';
import { GeneratingPage } from '@/pages/itinerary/itinerary-generating/ui/GeneratingPage';
import { DraftPage } from '@/pages/itinerary/itinerary-draft/ui/DraftPage';
import { MustVisitListPage } from '@/pages/itinerary/itinerary-mustvisit/ui/MustVisitListPage';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));
jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSetParams = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    dismissTo: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    setParams: mockSetParams,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({}),
}));

const BASE = 'http://localhost:8080/api/v1';
const KEY = getGetTripsTripIdItineraryQueryKey(TRIP_ID);
const OLD: Itinerary = itinerary({ itineraryId: 'itin-old', generationState: 'COMPLETE', generationSessionId: null });
const partial = (session: string | null): Itinerary =>
  itinerary({ itineraryId: 'itin-new', generationState: 'PARTIAL', generationSessionId: session });

// ── 가짜 서버 ────────────────────────────────────────────────────────────────
let row: Itinerary | null; // 서버 일정 행(A2: 1차 동안엔 그대로)
let running: string | null; // 돌고 있는 세션 id(A1)
let gets: number;
let posts: number;
/** GET 응답을 늦출 ms(요청 번호 → ms). 서버는 받는 순간 읽고, 응답만 늦게 보낸다. */
let getDelay: (n: number) => number;
/** POST 를 어떻게 끝낼지 — 기본: 1일차를 저장하고 201 PARTIAL. */
let postReply: (n: number) => Promise<Response>;

function serve(): void {
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
      gets += 1;
      const n = gets;
      // 읽는 순간의 값(A2·A5)을 잡아 두고 응답만 늦게 보낸다.
      const snap = row === null ? null : { ...row, generationSessionId: running };
      await delay(getDelay(n));
      return snap === null ? HttpResponse.json({}, { status: 404 }) : HttpResponse.json(snap);
    }),
    http.post(`${BASE}/trips/:tripId/itinerary`, async () => {
      posts += 1;
      running = `sess-${posts}`; // A1: 이전 세션을 닫고 새로 연다
      return postReply(posts);
    })
  );
}

async function commitDay1(n: number): Promise<Response> {
  await delay(50);
  row = partial(`sess-${n}`); // A2: 1일차 저장
  return HttpResponse.json(row, { status: 201 });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  row = OLD;
  running = null;
  gets = 0;
  posts = 0;
  getDelay = () => 0;
  postReply = commitDay1;
  mockPush.mockClear();
  mockReplace.mockClear();
  mockSetParams.mockClear();
  resetPressGuard();
  setAccessToken('valid-access');
  serve();
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetToast();
  act(() => clearAccessToken());
});
afterAll(() => server.close());

const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const appClient = (): QueryClient => newTestQueryClient({ staleTime: 30_000 }); // 운영 staleTime 과 같다
/** 홈 탭(생성 화면 밑에 깔린다)의 일정 관찰자 — 포커스 복귀 재조회를 테스트가 직접 일으킨다. */
const homeRefetch: { current: (() => Promise<unknown>) | null } = { current: null };
function HomeProbe(): null {
  const q = useGetTripsTripIdItinerary(TRIP_ID);
  homeRefetch.current = q.refetch;
  return null;
}
const renderIn = (client: QueryClient, ui: React.ReactElement) => render(ui, { wrapper: createWrapper(client) });

describe('P1 ResultOnlyAfterComplete — 생성 결과는 서버가 완료를 알린 뒤에만 보인다', () => {
  it('R1 고쳐짐 — 늦은 GET 이 POST 결과(1일차)를 덮지 못하고(취소), 초안은 진행 카드로 묻기를 잇는다', async () => {
    const client = appClient();
    client.setQueryData(KEY, OLD); // 재생성 — 홈이 예전 완성본을 들고 있다
    getDelay = (n) => (n === 1 ? 400 : 0); // 첫 GET 은 POST 보다 먼저 읽고 늦게 도착한다

    // 1. 홈(밑에 깔린 탭)이 일정을 다시 묻는다 — 포커스 복귀 등. 서버는 예전 행을 읽는다.
    renderIn(client, <HomeProbe />);
    void act(() => void homeRefetch.current?.());
    await waitFor(() => expect(gets).toBe(1));
    // 2. 생성 화면이 POST → 1일차 PARTIAL 201 → setQueryData + 초안으로 replace.
    const gen = renderIn(client, <GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/trips/[tripId]/itinerary/draft' })));
    expect(client.getQueryData<Itinerary>(KEY)?.generationState).toBe('PARTIAL');
    gen.unmount();
    // 3. 늦은 GET 응답은 취소돼 캐시를 되돌리지 못한다(훅 옵션 onSuccess 의 cancelQueries).
    await sleep(500);
    expect(client.getQueryData<Itinerary>(KEY)?.itineraryId).toBe('itin-new');

    // 4. 초안 화면: 진행 카드로 묻기를 잇는다 — 서버는 새 생성 중이다.
    renderIn(client, <DraftPage tripId={TRIP_ID} />);
    await screen.findByTestId('generation-progress-card');
    expect(screen.queryByTestId('sheet-cta-root')).toBeNull();
    const before = gets;
    await sleep(DRAFT_POLL_INTERVAL_MS * 2);
    expect(gets).toBeGreaterThan(before);
    expect(posts).toBe(1);
  }, 20000);

  it('R1b 고쳐짐 — 생성 화면을 떠난 뒤 POST 가 네트워크로 끊기면(서버는 받았다) 일정을 다시 물어 진행 카드로 넘어간다', async () => {
    const client = appClient();
    client.setQueryData(KEY, OLD);
    let finishPost!: () => void;
    postReply = async () => {
      await new Promise<void>((r) => (finishPost = r));
      row = partial(running); // 서버는 1일차를 저장했다
      return HttpResponse.error(); // 응답은 클라이언트에 못 닿는다
    };
    // 1. 생성 화면이 POST 를 쏘고, 사용자는 ‹ 로 홈에 나간다.
    const gen = renderIn(client, <GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    await waitFor(() => expect(posts).toBe(1));
    gen.unmount();
    // 2. 홈 카드로 초안을 연다(캐시의 예전 완성본).
    renderIn(client, <DraftPage tripId={TRIP_ID} />);
    await screen.findByTestId('sheet-cta-root');
    // 3. POST 가 끊긴다.
    await act(async () => finishPost());
    await screen.findByTestId('generation-progress-card'); // 훅 옵션 onError 의 무효화 → 초안이 다시 묻는다
    expect(screen.queryByTestId('sheet-cta-root')).toBeNull();
    expect(gets).toBeGreaterThanOrEqual(1);
    expect(row?.itineraryId).toBe('itin-new'); // 서버는 새 생성 1일차
  }, 20000);
});

describe('P2 NoStuckProgress — 실패하면 생성 중 화면에 갇히지 않는다', () => {
  it('R2 고쳐짐 — 폴링 상한(30회) 뒤 PARTIAL 이면 실패 안내 + [다시 시도]가 서고, 누르면 서버가 닫은 실패를 본다', async () => {
    row = partial('sess-1');
    running = 'sess-1';
    const client = appClient();
    renderIn(client, <DraftPage tripId={TRIP_ID} />);
    await screen.findByTestId('generation-progress-card');
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(1));
    // 이번 마운트 뒤 30회를 받은 것으로 만든다(105초를 기다리지 않으려고 — DraftPage C2 와 같은 방법).
    act(() => {
      for (let i = 0; i < DRAFT_POLL_MAX_COUNT; i += 1) client.setQueryData(KEY, partial('sess-1'));
    });
    await sleep(50);
    const atCap = gets;
    expect(client.getQueryState(KEY)?.dataUpdateCount).toBeGreaterThan(DRAFT_POLL_MAX_COUNT); // 준비 자가검사
    // 서버가 2차를 실패로 닫는다(A4 스위퍼).
    row = { ...partial(null), generationState: 'FAILED' };
    running = null;
    await sleep(DRAFT_POLL_INTERVAL_MS * 2);
    expect(gets).toBe(atCap); // 상한은 그대로 — 스스로는 다시 묻지 않는다
    expect(screen.getByTestId('itinerary-draft-stale-failed')).toBeOnTheScreen(); // 대신 실패를 말한다
    fireEvent.press(screen.getByTestId('itinerary-draft-partial-retry'));
    await screen.findByTestId('sheet-cta-root'); // 서버의 FAILED → h08 셸 + 안내
    expect(screen.queryByTestId('generation-progress-card')).toBeNull();
    expect(screen.getByTestId('itinerary-draft-stale-failed')).toBeOnTheScreen();
  }, 20000);
});

describe('P3 OnePostPerPress — 한 번 누른 생성은 한 번만 요청된다', () => {
  it('R3 고쳐짐 — [다시 시도]를 화면이 다시 그려지기 전에 두 번 쳐도 POST 는 한 건만 더 나간다', async () => {
    postReply = async (n) => (n === 1 ? HttpResponse.json({}, { status: 500 }) : commitDay1(n));
    const client = appClient();
    renderIn(client, <GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    const retry = await screen.findByTestId('itinerary-generating-retry');
    act(() => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });
    await waitFor(() => expect(posts).toBe(2)); // 첫 POST + 누름 1번에 1건
    await sleep(100);
    expect(posts).toBe(2);
  }, 20000);

  it('R4 고쳐짐 — 생성을 쏜 뒤 주소에서 mode 를 지워, 웹 새로고침은 관찰 모드로 뜨고 생성을 또 요청하지 않는다', async () => {
    postReply = () => new Promise<Response>(() => undefined); // 1차가 길다(응답 없음)
    const first = renderIn(appClient(), <GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    await waitFor(() => expect(posts).toBe(1));
    expect(mockSetParams).toHaveBeenCalledWith({ mode: undefined });
    first.unmount();
    // 새로고침 = 새 JS 실행(빈 캐시) + mode 가 지워진 주소의 props.
    renderIn(appClient(), <GeneratingPage tripId={TRIP_ID} />);
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(1)); // 관찰 모드 — GET 만
    await sleep(100);
    expect(posts).toBe(1);
    expect(running).toBe('sess-1');
  }, 20000);

  it('R5 고쳐짐 — 꼭 갈 곳 「다음」을 화면이 바뀌기 전에 두 번 쳐도 생성 화면은 한 번만 열린다', async () => {
    const mv: MustVisit = { mustVisitId: 'mv-a', poiSnapshotId: 'snap-a', type: 'ANYTIME', sourcePoiId: 'poi-a' };
    server.use(
      http.get(`${BASE}/trips/:tripId/must-visits`, () => HttpResponse.json([mv])),
      http.get(`${BASE}/saved-places`, () => HttpResponse.json([]))
    );
    renderIn(newTestQueryClient({ gcTime: 0 }), <MustVisitListPage tripId={TRIP_ID} />);
    const next = await screen.findByTestId('itinerary-mustvisit-screen-proceed');
    await waitFor(() => expect(next).toBeEnabled());
    act(() => {
      fireEvent.press(next);
      fireEvent.press(next);
    });
    const toGenerating = mockPush.mock.calls.filter(
      ([to]) => (to as { pathname?: string }).pathname === '/trips/[tripId]/itinerary/generating'
    );
    expect(toGenerating).toHaveLength(1);
  }, 20000);
});

describe('남은 반례 — 웹 새로고침 중 버린 POST (FV-POLL-05, 새 티켓 후보)', () => {
  it('R6 남음 — 새로고침 전 보낸 POST 가 새 페이지의 첫 GET 뒤에 서버에 닿으면, 초안은 예전 일정을 완성본으로 그린 채 묻지 않는다', async () => {
    // 서버가 POST 를 늦게 받는다 — 받는 순간 세션을 연다(A1). 응답은 버린 페이지로 가므로 상관없다.
    let receive!: () => void;
    server.use(
      http.post(`${BASE}/trips/:tripId/itinerary`, async () => {
        await new Promise<void>((r) => (receive = r));
        posts += 1;
        running = `sess-${posts}`;
        row = partial(running);
        return HttpResponse.json(row, { status: 201 });
      })
    );
    // 1. 재생성 시작 → 새로고침(JS 실행 버림).
    const first = renderIn(appClient(), <GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    await waitFor(() => expect(typeof receive).toBe('function'));
    first.unmount();
    // 2. 새 페이지: 관찰 모드가 일정을 묻는다 — 서버는 아직 POST 를 못 받아 예전 완성본(세션 없음)을 준다.
    const client = appClient();
    renderIn(client, <GeneratingPage tripId={TRIP_ID} />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/trips/[tripId]/itinerary/draft' })));
    renderIn(client, <DraftPage tripId={TRIP_ID} />);
    await screen.findByTestId('sheet-cta-root');
    // 3. 버린 POST 가 이제 서버에 닿는다 — 서버는 새 생성을 돌린다.
    await act(async () => receive());
    const before = gets;
    await sleep(DRAFT_POLL_INTERVAL_MS * 2);
    expect(gets).toBe(before); // 아무도 다시 묻지 않는다
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen(); // 예전 일정이 완성본 얼굴
    expect(running).toBe('sess-1');
  }, 20000);
});
