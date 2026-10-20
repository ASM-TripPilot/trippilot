import type { ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { BASE } from '@/test-support/apiBase';
import { itinerary } from '@/test-support/itineraryFixtures';
import { createRequestLog } from '@/test-support/mswItinerary';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import type { Revision } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryHistoryPage } from './ItineraryHistoryPage';

/**
 * TRIP-1513 · h36 변경 이력 — **실 orval 훅 + MSW** 통합 테스트. 리비전 = "그 시점의 일정 전체를 저장해 둔
 * 되돌리기 지점", BASELINE = "AI가 처음 짠 최초 상태(항상 보존)". 서버 계약은 모킹 기준(openapi
 * `GET /trips/{id}/itinerary/revisions` · `POST …/{revisionId}/restore`).
 *
 * 무엇을 보장하나: 목록은 limit=500 으로 1번 받아 서버 순서 그대로 그린다 · [되돌리기] 는 확인 다이얼로그에서
 * 확정할 때만 POST 1회(취소 0회, 연타해도 1회) · 성공하면 같은 여행 일정 쿼리를 무효화하고 안내 뒤 일정 화면으로
 * 간다 · 409/404/그 외 실패는 침묵하지 않고 안내하며 이동·무효화는 하지 않는다 · 삭제 컨트롤이 없다.
 *
 * 3동작: 준비=MSW 핸들러(+캐시 심기) → 실행=렌더·press → 단언=나간 요청 횟수·보이는 것·이동·캐시 상태.
 * ⚠️ MSW `onUnhandledRequest:'error'` 는 테스트를 실패시키지 않는다 — "안 나갔다/1번 나갔다" 는 요청 로거로 센다.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외.
// ★ canGoBack·navigate 까지 전부 기록한다(없는 메서드를 부르면 react-query 가 TypeError 를 삼켜 조용히 green).
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: mockPush,
    replace: mockReplace,
    navigate: mockNavigate,
    canGoBack: () => true,
  }),
}));

const TRIP = '11111111-1111-1111-1111-111111111111';
const OTHER_TRIP = '99999999-9999-9999-9999-999999999999';
const REV_NEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REV_MID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REV_BASE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REVISIONS_PATH = `/api/v1/trips/${TRIP}/itinerary/revisions`;

const CONFLICT_COPY =
  '지금은 되돌릴 수 없어요. 확정된 일정이거나 일정을 만드는 중이에요.';
const LOAD_FAIL_COPY = '이력을 불러오지 못했어요';

function revision(over: Partial<Revision> & { revisionId: string }): Revision {
  return {
    seq: 1,
    actor: 'USER',
    kind: 'EDIT',
    summary: '숙소를 바꿨어요',
    detail: null,
    // 18분 5초 전 — 상대 시각이 분 경계에 걸리지 않게(가짜 타이머는 MSW 비동기와 충돌해 쓰지 않는다)
    createdAt: new Date(Date.now() - 18 * 60_000 - 5000).toISOString(),
    ...over,
  };
}

/** 최신순(서버 순서) — 맨 아래가 BASELINE. */
const LIST: Revision[] = [
  revision({ revisionId: REV_NEW, seq: 3, summary: '2일차 순서를 바꿨어요' }),
  revision({
    revisionId: REV_MID,
    seq: 2,
    actor: 'AI',
    kind: 'GENERATE',
    summary: '일정을 새로 짰어요',
    detail: '3일 · 12곳',
  }),
  revision({
    revisionId: REV_BASE,
    seq: 1,
    actor: 'AI',
    kind: 'BASELINE',
    summary: '처음 일정',
  }),
];

const log = createRequestLog(server);
let client: QueryClient;
let lastRevisionsUrl: URL | null = null;

function renderPage() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <WithToastHost>{children}</WithToastHost>
      </QueryClientProvider>
    );
  }
  render(<ItineraryHistoryPage tripId={TRIP} />, { wrapper: Wrapper });
}

function serveList(revisions: Revision[] = LIST) {
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary/revisions`, ({ request }) => {
      lastRevisionsUrl = new URL(request.url);
      return HttpResponse.json({ revisions });
    })
  );
}

function serveRestore(resolver: () => Response | Promise<Response>) {
  server.use(
    http.post(
      `${BASE}/trips/:tripId/itinerary/revisions/:revisionId/restore`,
      resolver
    )
  );
}

const restoreHits = () => log.hitsFor('POST', '/restore');
const revisionListHits = () => log.hitsFor('GET', REVISIONS_PATH);
const rowIds = () =>
  screen
    .getAllByTestId(/^itinerary-history-[0-9a-f]{8}-/)
    .map((node) => node.props.testID.replace('itinerary-history-', ''));

async function openConfirm(revisionId: string) {
  fireEvent.press(
    await screen.findByTestId(`itinerary-history-restore-${revisionId}`)
  );
  await screen.findByTestId('itinerary-history-confirm');
}

beforeAll(() => {
  log.attach();
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  log.reset();
  lastRevisionsUrl = null;
  [mockBack, mockPush, mockReplace, mockNavigate].forEach((fn) =>
    fn.mockClear()
  );
  setAccessToken('valid-access');
});

afterEach(() => {
  // 넓어진 목 — 페이지는 navigate·push 를 부르지 않는다(되돌리기 성공 이동은 replace 한 번).
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  // 토스트 스토어는 모듈 싱글턴 — describe 안이 아니라 파일 최상위에서 비운다.
  resetToast();
  server.resetHandlers();
  clearAccessToken();
  client.clear();
});

afterAll(() => server.close());

describe('h36 변경 이력 — 목록 (TRIP-1513 AC-2·5·7)', () => {
  it('H1 limit=500 으로 한 번 받아 서버 순서 그대로, 첫 행은 현재 버전·맨 아래는 기준 버전', async () => {
    serveList();
    renderPage();

    await screen.findByTestId(`itinerary-history-${REV_NEW}`);

    expect(revisionListHits()).toBe(1);
    expect(lastRevisionsUrl?.pathname).toBe(REVISIONS_PATH);
    expect(lastRevisionsUrl?.searchParams.get('limit')).toBe('500');
    expect(rowIds()).toEqual([REV_NEW, REV_MID, REV_BASE]);

    expect(screen.getByText('일정 변경 이력')).toBeOnTheScreen();
    expect(
      screen.getByText('되돌려도 지금까지의 이력은 그대로 남아요')
    ).toBeOnTheScreen();

    const first = screen.getByTestId(`itinerary-history-${REV_NEW}`);
    expect(within(first).getByText('현재 버전')).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`itinerary-history-restore-${REV_NEW}`)
    ).toBeNull();
    expect(
      screen.getByTestId(`itinerary-history-restore-${REV_MID}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`itinerary-history-restore-${REV_BASE}`)
    ).toBeOnTheScreen();

    const last = screen.getByTestId(`itinerary-history-${REV_BASE}`);
    expect(within(last).getByText('기준 버전')).toBeOnTheScreen();
    expect(within(last).getByText('AI가 처음 짠 일정이에요')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('itinerary-history-baseline')).toHaveLength(
      1
    );
    expect(within(first).getByText('18분 전')).toBeOnTheScreen();
  });

  it('H2 응답을 기다리는 동안 로딩 얼굴을 보이고, 도착하면 행으로 바뀐다', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary/revisions`, async () => {
        await delay(150);
        return HttpResponse.json({ revisions: LIST });
      })
    );
    renderPage();

    expect(screen.getByTestId('itinerary-history-loading')).toBeOnTheScreen();
    await screen.findByTestId(`itinerary-history-${REV_NEW}`);
    expect(screen.queryByTestId('itinerary-history-loading')).toBeNull();
  });

  it('H3 이력이 없으면 빈 얼굴(행 0개)', async () => {
    serveList([]);
    renderPage();

    await screen.findByTestId('itinerary-history-empty');
    expect(screen.getByText('아직 변경 이력이 없어요')).toBeOnTheScreen();
    expect(
      screen.getByText('일정을 고치거나 새로 짜면 여기에 쌓여요')
    ).toBeOnTheScreen();
    expect(
      screen.queryAllByTestId(/^itinerary-history-[0-9a-f]{8}-/)
    ).toHaveLength(0);
  });

  it('H4 목록 조회가 실패하면 안내 + [다시 시도], 누르면 다시 받아 행이 뜬다', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary/revisions`, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ revisions: LIST });
      })
    );
    renderPage();

    await screen.findByTestId('itinerary-history-error');
    expect(screen.getByText(LOAD_FAIL_COPY)).toBeOnTheScreen();
    expect(revisionListHits()).toBe(1);

    fireEvent.press(screen.getByTestId('itinerary-history-retry'));

    await screen.findByTestId(`itinerary-history-${REV_NEW}`);
    expect(revisionListHits()).toBe(2);
    expect(screen.queryByTestId('itinerary-history-error')).toBeNull();
  });

  it('H11 삭제·소요시간 표기가 없고, 행마다 동작은 [이 버전으로 되돌리기] 하나뿐이다(AC-7·INV-3)', async () => {
    serveList();
    renderPage();
    await screen.findByTestId(`itinerary-history-${REV_NEW}`);

    expect(screen.queryByText(/삭제|지우기/)).toBeNull();
    expect(screen.queryByText(/소요|걸려|걸림/)).toBeNull();
    // 첫 행은 현재 버전이라 버튼이 없고 나머지 둘에만 있다
    expect(screen.queryAllByText('이 버전으로 되돌리기')).toHaveLength(2);
  });
});

describe('h36 변경 이력 — 되돌리기 (TRIP-1513 AC-3·4)', () => {
  it('H5 확인 다이얼로그에서 [취소] 하면 POST 는 한 번도 나가지 않는다', async () => {
    serveList();
    serveRestore(() => HttpResponse.json(itinerary()));
    renderPage();

    await openConfirm(REV_MID);
    expect(screen.getByText('이 버전으로 되돌릴까요?')).toBeOnTheScreen();
    expect(
      screen.getByText(
        '지금 일정이 이 버전으로 바뀌어요. 이력은 지워지지 않아서 다시 되돌릴 수도 있어요.'
      )
    ).toBeOnTheScreen();
    expect(restoreHits()).toBe(0);

    fireEvent.press(screen.getByTestId('itinerary-history-confirm-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('itinerary-history-confirm')).toBeNull()
    );
    expect(restoreHits()).toBe(0);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('H6 확정하면 POST 1회 → 같은 여행 일정 쿼리 무효화 + 안내 + 일정 화면으로 이동', async () => {
    serveList();
    serveRestore(() => HttpResponse.json(itinerary()));
    renderPage();
    const itineraryKey = [`/trips/${TRIP}/itinerary`];
    const otherKey = [`/trips/${OTHER_TRIP}/itinerary`];
    client.setQueryData(itineraryKey, itinerary());
    client.setQueryData(otherKey, itinerary());
    // 실행 전 "아직 없다" 앵커 — 토스트·무효화·이동이 확정 전엔 없다
    expect(screen.queryByTestId('itinerary-history-restored')).toBeNull();

    await openConfirm(REV_MID);
    expect(client.getQueryState(itineraryKey)?.isInvalidated).toBe(false);
    fireEvent.press(screen.getByTestId('itinerary-history-confirm-ok'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP}/itinerary`);
    expect(restoreHits()).toBe(1);
    expect(log.all()).toContain(
      `POST /api/v1/trips/${TRIP}/itinerary/revisions/${REV_MID}/restore`
    );
    expect(client.getQueryState(itineraryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
    // 열려 있는 이력 목록(같은 prefix)은 새 값으로 다시 받는다
    await waitFor(() => expect(revisionListHits()).toBe(2));
    expect(
      await screen.findByTestId('itinerary-history-restored')
    ).toBeOnTheScreen();
    expect(screen.getByText('일정을 되돌렸어요')).toBeOnTheScreen();
  });

  it('H7 확정 버튼을 연타해도 POST 는 1회', async () => {
    serveList();
    serveRestore(async () => {
      await delay(100);
      return HttpResponse.json(itinerary());
    });
    renderPage();

    await openConfirm(REV_MID);
    const ok = screen.getByTestId('itinerary-history-confirm-ok');
    // 한 act 안에서 연타 — 사이에 렌더가 끼지 않아 세 번 다 같은 (낡은) 핸들러를 탄다
    act(() => {
      fireEvent.press(ok);
      fireEvent.press(ok);
      fireEvent.press(ok);
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(restoreHits()).toBe(1);
  });

  it('H8 409 면 "되돌릴 수 없어요" 안내 — 이동·토스트·무효화 없음', async () => {
    serveList();
    serveRestore(() => new HttpResponse(null, { status: 409 }));
    renderPage();
    const itineraryKey = [`/trips/${TRIP}/itinerary`];
    client.setQueryData(itineraryKey, itinerary());

    await openConfirm(REV_MID);
    fireEvent.press(screen.getByTestId('itinerary-history-confirm-ok'));

    const banner = await screen.findByTestId('itinerary-history-restore-error');
    expect(within(banner).getByText(CONFLICT_COPY)).toBeOnTheScreen();
    expect(restoreHits()).toBe(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('itinerary-history-restored')).toBeNull();
    expect(client.getQueryState(itineraryKey)?.isInvalidated).toBe(false);
  });

  it('H9 404 면 "이 버전을 찾을 수 없어요" 안내 — 이동·무효화 없음', async () => {
    serveList();
    serveRestore(() => new HttpResponse(null, { status: 404 }));
    renderPage();
    const itineraryKey = [`/trips/${TRIP}/itinerary`];
    client.setQueryData(itineraryKey, itinerary());

    await openConfirm(REV_MID);
    fireEvent.press(screen.getByTestId('itinerary-history-confirm-ok'));

    const banner = await screen.findByTestId('itinerary-history-restore-error');
    expect(
      within(banner).getByText('이 버전을 찾을 수 없어요')
    ).toBeOnTheScreen();
    expect(screen.queryByText(CONFLICT_COPY)).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(client.getQueryState(itineraryKey)?.isInvalidated).toBe(false);
  });

  it('H10 그 외 실패(500)도 침묵하지 않고 [다시 시도] 얼굴 — 이동·토스트·무효화 없음', async () => {
    serveList();
    serveRestore(() => new HttpResponse(null, { status: 500 }));
    renderPage();
    const itineraryKey = [`/trips/${TRIP}/itinerary`];
    client.setQueryData(itineraryKey, itinerary());

    await openConfirm(REV_MID);
    fireEvent.press(screen.getByTestId('itinerary-history-confirm-ok'));

    expect(await screen.findByText(LOAD_FAIL_COPY)).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-history-retry')).toBeOnTheScreen();
    expect(screen.queryByText(CONFLICT_COPY)).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('itinerary-history-restored')).toBeNull();
    expect(client.getQueryState(itineraryKey)?.isInvalidated).toBe(false);
  });
});

// TRIP-1513 · 03b W1 — 실패 뒤 연타 잠금이 풀려야 다른 행을 다시 확정할 수 있다(안 풀리면 조용한 실패, INV-4).
describe('h36 변경 이력 — 실패 뒤 재시도 (TRIP-1513 W1)', () => {
  it('H12 409 로 실패한 뒤 다른 행을 확정하면 POST 가 다시 나간다', async () => {
    serveList();
    let calls = 0;
    serveRestore(() => {
      calls += 1;
      return calls === 1
        ? new HttpResponse(null, { status: 409 })
        : HttpResponse.json(itinerary());
    });
    renderPage();

    await openConfirm(REV_MID);
    fireEvent.press(screen.getByTestId('itinerary-history-confirm-ok'));
    await screen.findByTestId('itinerary-history-restore-error');
    expect(restoreHits()).toBe(1);

    await openConfirm(REV_BASE);
    fireEvent.press(screen.getByTestId('itinerary-history-confirm-ok'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(restoreHits()).toBe(2);
    expect(log.all()).toContain(
      `POST /api/v1/trips/${TRIP}/itinerary/revisions/${REV_BASE}/restore`
    );
  });
});
