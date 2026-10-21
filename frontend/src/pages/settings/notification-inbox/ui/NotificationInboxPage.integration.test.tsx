import { http, HttpResponse } from 'msw';
import type { QueryClient } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { router } from 'expo-router';

import { BASE } from '@/test-support/apiBase';
import {
  createGcZeroWrapper,
  createWrapper,
  newTestQueryClient,
} from '@/test-support/queryRender';
import { server } from '@/mocks/server';
import { getGetMeNotificationsQueryKey } from '@/shared/api/index.hooks';
import type { Notification } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { NotificationInboxPage } from './NotificationInboxPage';

/**
 * l01 읽음 배선 — 실제 페이지 + msw + 실 QueryClient 로 "실제로 나간 요청"을 잰다.
 * TRIP-773 신설(건별 POST), TRIP-946 에서 '모두 읽음'을 `POST /me/notifications/read-all` 1회로 계약 교체,
 * TRIP-1420 에서 행·인라인 액션 press 의 개별 읽음(`POST /me/notifications/{id}/read`)을 더했다.
 *
 * 개별 읽음이 보장하는 것(아래 "개별 읽음" 묶음):
 *  - 미읽음 행(또는 PLAN_B 인라인 액션)을 누르면 그 id 로 읽음 요청 정확히 1회 + 이동 1회. 이동은 응답을 안 기다린다.
 *  - 응답이 끝난 **뒤** 목록을 다시 받아, 성공이면 그 행만 점이 사라지고 실패(500·네트워크·404)면 점이 남는다(INV-4).
 *  - 읽음 행·route 없는 행은 읽음 요청 0.
 *
 * 무엇을 보장하나:
 *  - AC-12 1회 요청: 미읽음 2 + 읽음 1 에서 누르면 read-all 이 정확히 1회, 건별 `/{id}/read` 는 0회.
 *  - AC-13 응답 뒤 재조회: read-all 204 를 받은 **뒤** 목록 GET 이 한 번 더 나가고, 그 결과(전부 읽음)로
 *    버튼·미읽음 dot 이 사라진다. 응답 전(문이 닫힌 동안)엔 재조회가 없다.
 *  - AC-14 실패: read-all 이 500·네트워크 오류여도 재조회하고, 안내 "일부 알림을 읽음 처리하지 못했어요"를
 *    보인다(문구는 Q3 로 유지). 다음 press 때 안내가 걷힌다.
 *  - AC-15 진행 중 비활성: 응답 전엔 버튼이 disabled 이고, 다시 눌러도 read-all 은 1회에 머문다.
 *
 * 장치:
 *  - 상태 기억 GET — read-all 이 204 로 끝나면 이후 GET 은 전 행의 readAt 을 채워 돌려준다. 고정 응답이면
 *    재조회 뒤에도 미읽음이 그대로라 "버튼이 사라진다"를 관측할 수 없다.
 *  - 문(gate) — 테스트가 열 때까지 응답하지 않는 read-all. "응답 전"을 시간이 아니라 신호로 만든다.
 *    `refetchGate` 는 같은 문을 재조회 GET 에 건다 — 비활성이 재조회 **완료**까지 이어지는지 본다.
 *  - TRIP-1501 조회 실패: 첫 조회가 실패하면 "알림 없음"이 아니라 오류 얼굴 + [다시 시도]. 재조회만 실패하면(옛 data 가 남아 있으면)
 *    목록을 지키고, 서버가 준 빈 목록은 빈 얼굴 그대로다. 읽음 응답이 알림함을 나간 **뒤** 와도 목록 캐시는 낡음 처리된다.
 *    (후자는 `gcTime: 0` 래퍼로는 원리적으로 못 본다 — 클라이언트를 직접 쥐는 `createWrapper(client)` 로 잰다.)
 *  - `listReplies` — 목록 GET 응답 큐(성공·500·네트워크, 문 뒤 보류 가능). 비면 옛 응답 그대로라 기존 `it` 무영향.
 *  - 건별 POST 핸들러는 진짜 서버처럼 답한다(응답 큐·문·204 면 그 id 를 기억) — GET 은 기억한 id 의 행만 readAt 을
 *    채운다. 호출 수(`perIdPosts`)도 세서 '모두 읽음'이 건별을 안 부르는지(AC-12)를 계속 본다.
 */

// 생성 클라이언트의 인증 계층(authedClient)이 @/shared/storage 를 정적으로 문다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));

// 테스트 상한을 `waitFor` 상한(5초, integrationSetup)보다 길게 — 같으면 red 가 단언 내용 대신
// "Exceeded timeout" 으로만 보인다. green 은 나타나는 즉시 끝나 느려지지 않는다.
jest.setTimeout(15000);

const LIST_PATH = '/api/v1/me/notifications';
const MARK_ALL = 'notification-inbox-mark-all';
const MARK_ALL_ERROR = 'notification-inbox-mark-all-error';
const UNREAD_DOT = 'notification-inbox-unread-dot';
const FAILURE = '일부 알림을 읽음 처리하지 못했어요';

// 계약상 notificationId 는 uuid.
const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const R1 = '00000000-0000-4000-8000-000000000003';

const minutesAgo = (m: number): string =>
  new Date(Date.now() - m * 60000).toISOString();

const BASE_ITEMS: Notification[] = [
  {
    notificationId: U1,
    kind: 'SYSTEM',
    title: '미읽음 하나',
    body: '',
    actionType: null,
    actionPayload: null,
    occurredAt: minutesAgo(5),
    readAt: null,
  },
  {
    notificationId: U2,
    kind: 'SYSTEM',
    title: '미읽음 둘',
    body: '',
    actionType: null,
    actionPayload: null,
    occurredAt: minutesAgo(6),
    readAt: null,
  },
  {
    notificationId: R1,
    kind: 'SYSTEM',
    title: '이미 읽음',
    body: '',
    actionType: null,
    actionPayload: null,
    occurredAt: minutesAgo(7),
    readAt: minutesAgo(1),
  },
];

/** 테스트가 열어 줄 때까지 응답하지 않는 문. */
function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

/** 읽음 요청 한 번을 어떻게 답할지 — 204(성공) / 500 / 404 / 네트워크 오류, 필요하면 문 뒤에서. */
type Reply = {
  status: 204 | 500 | 404 | 'network';
  gate?: ReturnType<typeof createGate>;
};

/** 목록 GET 한 번을 어떻게 답할지 — 200(정상)·500·네트워크 오류, 필요하면 문 뒤에서. 큐 순서 = GET 순서. */
type ListReply = {
  status: 200 | 500 | 'network';
  gate?: ReturnType<typeof createGate>;
};

/** GET 이 돌려줄 원본 목록. 최상위 beforeEach 가 BASE_ITEMS 로 되돌린다. */
let items: Notification[];
let allRead: boolean;
/** 건별 읽음이 204 로 끝난 id — 이후 GET 은 이 행만 읽음으로 돌려준다. */
let readIds: Set<string>;
let readAllPosts: number;
let perIdPosts: string[];
/** request:start(GET) 와 읽음 요청 완료를 한 줄에 섞어 순서를 본다. */
let timeline: string[];
/** read-all 호출 순서대로 꺼내 쓰는 응답 큐. 비면 204. */
let readAllReplies: Reply[];
/** 건별 읽음 호출 순서대로 꺼내 쓰는 응답 큐. 비면 204. */
let readOneReplies: Reply[];
/** 목록 GET 호출 순서대로 꺼내 쓰는 응답 큐. 비면 상태 기억 정상 응답. */
let listReplies: ListReply[];
/** 있으면 read-all 성공 뒤의 목록 GET(재조회)을 이 문 뒤에 붙잡는다. 첫 GET 은 안 막는다. */
let refetchGate: ReturnType<typeof createGate> | undefined;

const listGets = () => timeline.filter((e) => e === `GET ${LIST_PATH}`).length;
const pushMock = router.push as jest.Mock;
const backMock = router.back as jest.Mock;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'GET') {
      timeline.push(`GET ${new URL(request.url).pathname}`);
    }
  });
});

beforeEach(() => {
  items = BASE_ITEMS;
  allRead = false;
  readIds = new Set();
  readAllPosts = 0;
  perIdPosts = [];
  timeline = [];
  readAllReplies = [];
  readOneReplies = [];
  refetchGate = undefined;
  listReplies = [];
  pushMock.mockClear();
  backMock.mockClear();
  setAccessToken('a');
  server.use(
    // 상태 기억 GET — read-all 이 성공한 뒤로는 전 행이, 건별 읽음이 성공한 행은 그 행만 읽음으로 나간다.
    http.get(`${BASE}/me/notifications`, async () => {
      const reply = listReplies.shift();
      if (reply?.gate) await reply.gate.opened;
      if (reply?.status === 'network') return HttpResponse.error();
      if (reply?.status === 500) return new HttpResponse(null, { status: 500 });
      if (allRead && refetchGate) await refetchGate.opened;
      return HttpResponse.json({
        items: items.map((item) =>
          allRead || readIds.has(item.notificationId)
            ? { ...item, readAt: item.readAt ?? minutesAgo(0) }
            : item
        ),
      });
    }),
    http.post(`${BASE}/me/notifications/read-all`, async () => {
      readAllPosts += 1;
      const reply = readAllReplies.shift() ?? { status: 204 };
      if (reply.gate) await reply.gate.opened;
      timeline.push('POST-done read-all');
      if (reply.status === 'network') return HttpResponse.error();
      if (reply.status === 500) {
        return new HttpResponse(null, { status: 500 });
      }
      allRead = true;
      return new HttpResponse(null, { status: 204 });
    }),
    // 건별 읽음 — 호출을 세고, 응답 큐대로 답하고, 204 면 그 id 를 기억한다.
    http.post(
      `${BASE}/me/notifications/:notificationId/read`,
      async ({ params }) => {
        const id = String(params.notificationId);
        perIdPosts.push(id);
        const reply = readOneReplies.shift() ?? { status: 204 };
        if (reply.gate) await reply.gate.opened;
        timeline.push(`POST-done read ${id}`);
        if (reply.status === 'network') return HttpResponse.error();
        if (reply.status !== 204) {
          return new HttpResponse(null, { status: reply.status });
        }
        readIds.add(id);
        return new HttpResponse(null, { status: 204 });
      }
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage() {
  render(<NotificationInboxPage />, { wrapper: createGcZeroWrapper() });
}

/** 첫 목록(기본 3행)이 도착할 때까지 기다린다. */
async function renderReady(rowCount = 3) {
  renderPage();
  await waitFor(() =>
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(
      rowCount
    )
  );
}

/** "아무 일도 더 안 일어났다"를 보기 위해 잠시 흘려보낸다. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** 앱 전역 QueryClient(AppProviders)와 같은 신선도 — 캐시는 안 지우고(gcTime Infinity), 30초 안엔 다시 안 받는다. */
function appLikeClient(): QueryClient {
  const client = newTestQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, staleTime: 30_000 },
  });
  return client;
}

const ERROR = 'notification-inbox-error';
const RETRY = 'notification-inbox-retry';
const EMPTY = 'notification-inbox-empty';
const ROW = 'notification-inbox-row';

// TRIP-1501 · 조회 실패 얼굴. 클라이언트 재시도 0 이라 실패 응답 1개 = 실패 1회(앱 전역은 3회 재시도 ≈7초 뒤).
describe('조회 실패 — "알림 없음"으로 접지 않고 오류 얼굴 + 다시 시도', () => {
  describe('E1 · 첫 조회 실패', () => {
    it.each<[string, ListReply['status']]>([
      ['500', 500],
      ['네트워크 오류', 'network'],
    ])(
      '%s 이면 오류 얼굴과 다시 시도가 보이고 empty·행·"모두 읽음"은 없고, 뒤로 갈 길은 열려 있다',
      async (_label, status) => {
        // 준비
        listReplies = [{ status }];

        // 실행
        renderPage();

        // 단언
        expect(await screen.findByTestId(ERROR)).toBeOnTheScreen();
        expect(screen.getByTestId(RETRY)).toBeOnTheScreen();
        expect(screen.queryByTestId(EMPTY)).toBeNull();
        expect(screen.queryAllByTestId(ROW)).toHaveLength(0);
        expect(screen.queryByTestId(MARK_ALL)).toBeNull();
        fireEvent.press(screen.getByTestId('notification-inbox-back'));
        expect(backMock).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe('E2 · 다시 시도 성공', () => {
    it('다시 시도를 누르면 목록을 다시 받아 행이 나타나고 오류·빈 얼굴은 사라진다', async () => {
      // 준비 — 첫 GET 만 실패(큐가 비면 정상).
      listReplies = [{ status: 500 }];
      renderPage();
      await screen.findByTestId(ERROR);
      expect(listGets()).toBe(1);

      // 실행
      fireEvent.press(screen.getByTestId(RETRY));

      // 단언
      await waitFor(() => expect(screen.queryAllByTestId(ROW)).toHaveLength(3));
      expect(screen.queryByTestId(ERROR)).toBeNull();
      expect(screen.queryByTestId(EMPTY)).toBeNull();
      expect(listGets()).toBe(2);
    });
  });

  describe('E3 · 다시 시도도 실패', () => {
    it('재시도 중엔 비활성(연타해도 GET 이 늘지 않음), 끝나도 오류 얼굴이 남고 빈 얼굴로 접히지 않는다', async () => {
      // 준비 — 두 번째 GET(다시 시도)이 문 뒤에서 실패한다.
      const gate = createGate();
      listReplies = [{ status: 500 }, { status: 500, gate }];
      renderPage();
      await screen.findByTestId(ERROR);

      // 실행 1 — 누르고, 응답이 붙잡힌 채 한 번 더 누른다.
      fireEvent.press(screen.getByTestId(RETRY));
      await waitFor(() => expect(listGets()).toBe(2));
      await waitFor(() => expect(screen.getByTestId(RETRY)).toBeDisabled());
      fireEvent.press(screen.getByTestId(RETRY));
      await settle();

      // 단언 1 — 비활성·GET 2회에 머묾·얼굴 유지.
      expect(listGets()).toBe(2);
      expect(screen.getByTestId(ERROR)).toBeOnTheScreen();
      expect(screen.queryByTestId(EMPTY)).toBeNull();

      // 실행 2 — 응답(실패)을 보낸다.
      await act(async () => {
        gate.release();
      });

      // 단언 2 — 다시 누를 수 있고, 오류 얼굴이 그대로다.
      await waitFor(() => expect(screen.getByTestId(RETRY)).toBeEnabled());
      expect(screen.getByTestId(ERROR)).toBeOnTheScreen();
      expect(screen.queryByTestId(EMPTY)).toBeNull();
    });
  });

  describe('E5 · 서버가 준 빈 목록은 오류가 아니다', () => {
    it('200 + 빈 items → 빈 얼굴, 오류 얼굴 없음', async () => {
      // 준비
      items = [];

      // 실행
      renderPage();

      // 단언
      expect(await screen.findByTestId(EMPTY)).toBeOnTheScreen();
      expect(screen.queryByTestId(ERROR)).toBeNull();
    });

    it('빈 목록을 받은 뒤 재조회가 실패해도(푸시 무효화 등) 빈 얼굴 그대로다 — 판정은 items.length 가 아니라 data 유무', async () => {
      // 준비 — 클라이언트를 직접 쥔다(재조회를 밖에서 일으키려고).
      const client = newTestQueryClient();
      items = [];
      listReplies = [{ status: 200 }, { status: 500 }];
      render(<NotificationInboxPage />, { wrapper: createWrapper(client) });
      await screen.findByTestId(EMPTY);

      // 실행 — 외부 무효화 → 재조회 500.
      await act(async () => {
        await client.invalidateQueries({
          queryKey: getGetMeNotificationsQueryKey(),
        });
      });

      // 단언 — 앵커: 실패가 캐시에 실제로 도착했다. 그 위에서 빈 얼굴 유지·오류 얼굴 없음.
      expect(
        client.getQueryState(getGetMeNotificationsQueryKey())?.status
      ).toBe('error');
      expect(screen.getByTestId(EMPTY)).toBeOnTheScreen();
      expect(screen.queryByTestId(ERROR)).toBeNull();
    });
  });
});

describe('AC-12·13 · 성공 — read-all 1회, 응답 뒤 재조회, 버튼·dot 사라짐', () => {
  it('read-all 정확히 1회 · 건별 0회, 204 뒤 GET 이 한 번 더 나가고 미읽음 표시가 전부 사라진다', async () => {
    await renderReady();
    expect(screen.queryAllByTestId(UNREAD_DOT)).toHaveLength(2);

    fireEvent.press(screen.getByTestId(MARK_ALL));

    await waitFor(() => expect(listGets()).toBe(2));
    await waitFor(() => expect(screen.queryByTestId(MARK_ALL)).toBeNull());

    // 한 번에 — read-all 1회, 건별 호출 0회.
    expect(readAllPosts).toBe(1);
    expect(perIdPosts).toHaveLength(0);

    // 재조회 GET 은 read-all 응답 뒤다.
    expect(timeline.indexOf('POST-done read-all')).toBeGreaterThan(-1);
    expect(timeline.indexOf('POST-done read-all')).toBeLessThan(
      timeline.lastIndexOf(`GET ${LIST_PATH}`)
    );

    // 행은 그대로 3개(긍정 짝) + 미읽음 dot 0 + 안내 없음.
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(3);
    expect(screen.queryAllByTestId(UNREAD_DOT)).toHaveLength(0);
    expect(screen.queryByTestId(MARK_ALL_ERROR)).toBeNull();
  });

  it('read-all 응답 전(문 닫힘)엔 재조회하지 않고, 응답이 오면 재조회한다', async () => {
    const gate = createGate();
    readAllReplies = [{ status: 204, gate }];
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));
    await waitFor(() => expect(readAllPosts).toBe(1));
    await settle();

    expect(listGets()).toBe(1);

    await act(async () => {
      gate.release();
    });

    await waitFor(() => expect(listGets()).toBe(2));
    await waitFor(() => expect(screen.queryByTestId(MARK_ALL)).toBeNull());
  });
});

describe('AC-14 · 실패 — 재조회하고 안내를 보인다', () => {
  it('read-all 500 → 재조회 + 안내, 미읽음은 그대로 남는다', async () => {
    readAllReplies = [{ status: 500 }];
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));

    expect(await screen.findByTestId(MARK_ALL_ERROR)).toHaveTextContent(
      FAILURE
    );
    await waitFor(() => expect(listGets()).toBe(2));
    expect(screen.queryAllByTestId(UNREAD_DOT)).toHaveLength(2);
    expect(screen.getByTestId(MARK_ALL)).toBeOnTheScreen();
    expect(readAllPosts).toBe(1);
    expect(perIdPosts).toHaveLength(0);
  });

  it('read-all 네트워크 오류 → 재조회 + 안내', async () => {
    readAllReplies = [{ status: 'network' }];
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));

    expect(await screen.findByTestId(MARK_ALL_ERROR)).toHaveTextContent(
      FAILURE
    );
    await waitFor(() => expect(listGets()).toBe(2));
    expect(screen.getByTestId(MARK_ALL)).toBeOnTheScreen();
  });

  it('안내는 다음 "모두 읽음" press 때 걷히고, 이번엔 성공해 버튼이 사라진다', async () => {
    const retry = createGate();
    readAllReplies = [{ status: 500 }, { status: 204, gate: retry }];
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));
    await screen.findByTestId(MARK_ALL_ERROR);
    await waitFor(() => expect(screen.getByTestId(MARK_ALL)).toBeEnabled());

    fireEvent.press(screen.getByTestId(MARK_ALL));

    // 응답 전인데도 안내가 걷혔다(press 때 걷힘).
    await waitFor(() =>
      expect(screen.queryByTestId(MARK_ALL_ERROR)).toBeNull()
    );

    await act(async () => {
      retry.release();
    });
    await waitFor(() => expect(screen.queryByTestId(MARK_ALL)).toBeNull());
    expect(screen.queryByTestId(MARK_ALL_ERROR)).toBeNull();
    expect(readAllPosts).toBe(2);
  });
});

describe('AC-15 · 진행 중 비활성 — 응답 전 다시 눌러도 read-all 이 늘지 않는다', () => {
  it('응답 전엔 버튼이 disabled 이고, 한 번 더 눌러도 read-all 은 1회에 머문다', async () => {
    const gate = createGate();
    readAllReplies = [{ status: 204, gate }];
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));
    await waitFor(() => expect(screen.getByTestId(MARK_ALL)).toBeDisabled());
    fireEvent.press(screen.getByTestId(MARK_ALL));
    await settle();

    expect(readAllPosts).toBe(1);

    await act(async () => {
      gate.release();
    });
    await waitFor(() => expect(screen.queryByTestId(MARK_ALL)).toBeNull());
    expect(readAllPosts).toBe(1);
  });

  it('read-all 은 끝났어도 재조회 응답 전엔 버튼이 disabled 이고, 다시 눌러도 read-all 은 1회에 머문다', async () => {
    refetchGate = createGate();
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));
    // read-all 204 가 돌아왔고 재조회 GET 이 나갔다 — 그 응답만 문 뒤에 붙잡혀 있다.
    await waitFor(() => expect(listGets()).toBe(2));
    await settle();

    expect(timeline).toContain('POST-done read-all');
    expect(screen.getByTestId(MARK_ALL)).toBeDisabled();
    fireEvent.press(screen.getByTestId(MARK_ALL));
    await settle();
    expect(readAllPosts).toBe(1);

    await act(async () => {
      refetchGate?.release();
    });
    await waitFor(() => expect(screen.queryByTestId(MARK_ALL)).toBeNull());
    expect(readAllPosts).toBe(1);
  });
});

// TRIP-1420 · 행·인라인 액션 press 의 개별 읽음(Q-157).
describe('개별 읽음 — 누른 알림 하나를 읽음 요청하고, 응답 뒤 다시 받아 그 행의 점만 지운다', () => {
  const SUMMARY_ID = '00000000-0000-4000-8000-000000000011';
  const REFLECT_ID = '00000000-0000-4000-8000-000000000012';
  const PLANB_ID = '00000000-0000-4000-8000-000000000013';
  const STAY_ID = '00000000-0000-4000-8000-000000000014';
  const ITIN_READ_ID = '00000000-0000-4000-8000-000000000015';
  const NO_ROUTE_ID = '00000000-0000-4000-8000-000000000016';

  const SUMMARY_TITLE = '여행 요약이 도착했어요';
  const REFLECT_TITLE = '어제 하루를 돌아봐요';
  const PLANB_TITLE = '비 예보 — 일정이 영향받아요';
  const STAY_TITLE = '숙소가 등록됐어요';
  const ITIN_READ_TITLE = '내일 일정 미리 보기';
  const NO_ROUTE_TITLE = '공지사항';

  const SUMMARY_ROUTE = '/trips/t1/records/summary';

  /** 미읽음 5(누를 수 있는 4 + 누를 수 없는 1) + 읽음 1. 본문은 비워 제목만으로 행을 고른다. */
  const ROUTED_ITEMS: Notification[] = [
    {
      notificationId: SUMMARY_ID,
      kind: 'REFLECTION',
      title: SUMMARY_TITLE,
      body: '',
      actionType: 'TRIP_SUMMARY',
      actionPayload: { tripId: 't1' },
      occurredAt: minutesAgo(5),
      readAt: null,
    },
    {
      notificationId: REFLECT_ID,
      kind: 'REFLECTION',
      title: REFLECT_TITLE,
      body: '',
      actionType: 'REFLECTION_DAILY',
      actionPayload: { tripId: 't1', dayDate: '2026-10-16' },
      occurredAt: minutesAgo(6),
      readAt: null,
    },
    {
      notificationId: PLANB_ID,
      kind: 'PLAN_B',
      title: PLANB_TITLE,
      body: '',
      actionType: 'PLANB_REPLAN',
      actionPayload: { tripId: 't1', triggerId: 'tr1' },
      occurredAt: minutesAgo(7),
      readAt: null,
    },
    {
      notificationId: STAY_ID,
      kind: 'STAY',
      title: STAY_TITLE,
      body: '',
      actionType: 'STAY_DETAIL',
      actionPayload: { savedStayId: '00000000-0000-4000-8000-0000000000bb' },
      occurredAt: minutesAgo(8),
      readAt: null,
    },
    {
      notificationId: ITIN_READ_ID,
      kind: 'TRIP_PRE',
      title: ITIN_READ_TITLE,
      body: '',
      actionType: 'TRIP_ITINERARY',
      actionPayload: { tripId: 't1' },
      occurredAt: minutesAgo(9),
      readAt: minutesAgo(2),
    },
    {
      notificationId: NO_ROUTE_ID,
      kind: 'SYSTEM',
      title: NO_ROUTE_TITLE,
      body: '',
      actionType: null,
      actionPayload: null,
      occurredAt: minutesAgo(10),
      readAt: null,
    },
  ];

  /** 행은 같은 testID 가 여럿이라 제목 글자로 고른다(순서는 오늘/이전 구분에 따라 바뀔 수 있다). */
  function rowOf(title: string) {
    const row = screen
      .getAllByTestId('notification-inbox-row')
      .find((candidate) => within(candidate).queryByText(title) != null);
    if (row == null) throw new Error(`행을 못 찾았다: ${title}`);
    return row;
  }

  const dotIn = (title: string) =>
    within(rowOf(title)).queryByTestId(UNREAD_DOT);

  beforeEach(() => {
    items = ROUTED_ITEMS;
  });

  describe('AC-1 · 미읽음 행 press', () => {
    it('그 알림 id 로 읽음 요청이 정확히 1회, 이동도 1회 나간다', async () => {
      // 준비
      await renderReady(6);
      expect(dotIn(SUMMARY_TITLE)).toBeOnTheScreen();

      // 실행
      fireEvent.press(rowOf(SUMMARY_TITLE));

      // 단언 — 나간 뒤에도 더 나가지 않는지 흘려보내고 다시 센다.
      await waitFor(() => expect(perIdPosts).toHaveLength(1));
      await settle();
      expect(perIdPosts).toEqual([SUMMARY_ID]);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith(SUMMARY_ROUTE);
      expect(readAllPosts).toBe(0);
    });
  });

  describe('AC-2 · 읽음 성공 → 다시 받은 목록에서 그 행만 점이 사라진다', () => {
    it('204 뒤 재조회되고, 누른 행의 점만 없어지고 다른 미읽음 점은 남는다', async () => {
      // 준비 — 누를 행과 비교할 행 모두 점이 있다.
      await renderReady(6);
      expect(screen.queryAllByTestId(UNREAD_DOT)).toHaveLength(5);
      expect(dotIn(SUMMARY_TITLE)).toBeOnTheScreen();
      expect(dotIn(REFLECT_TITLE)).toBeOnTheScreen();

      // 실행
      fireEvent.press(rowOf(SUMMARY_TITLE));

      // 단언
      await waitFor(() => expect(listGets()).toBe(2));
      await waitFor(() => expect(dotIn(SUMMARY_TITLE)).toBeNull());
      expect(screen.queryAllByTestId(UNREAD_DOT)).toHaveLength(4);
      expect(dotIn(REFLECT_TITLE)).toBeOnTheScreen();
      expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(6);
      // 재조회 GET 은 읽음 응답 뒤다.
      const done = timeline.indexOf(`POST-done read ${SUMMARY_ID}`);
      expect(done).toBeGreaterThan(-1);
      expect(done).toBeLessThan(timeline.lastIndexOf(`GET ${LIST_PATH}`));
    });
  });

  describe('AC-3 · PLAN_B 인라인 액션 press', () => {
    it('"대안 일정 보기" 를 누르면 그 id 로 읽음 요청 1회 + 재계획 화면 이동 1회', async () => {
      // 준비
      await renderReady(6);
      expect(dotIn(PLANB_TITLE)).toBeOnTheScreen();

      // 실행
      fireEvent.press(
        within(rowOf(PLANB_TITLE)).getByTestId('notification-inbox-action')
      );

      // 단언
      await waitFor(() => expect(perIdPosts).toHaveLength(1));
      await settle();
      expect(perIdPosts).toEqual([PLANB_ID]);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith('/trips/t1/planb?triggerId=tr1');
    });
  });

  describe('AC-4 · 읽음 실패 → 다시 받아도 점이 남고, 안내도 없다 (INV-4)', () => {
    it.each<[string, Reply['status']]>([
      ['500', 500],
      ['네트워크 오류', 'network'],
      ['404(없음·타 계정)', 404],
    ])('%s 이면 재조회 뒤에도 그 행의 점이 남는다', async (_label, status) => {
      // 준비
      readOneReplies = [{ status }];
      await renderReady(6);
      expect(dotIn(SUMMARY_TITLE)).toBeOnTheScreen();

      // 실행
      fireEvent.press(rowOf(SUMMARY_TITLE));

      // 단언 — 실패해도 응답 뒤 재조회는 한다(서버 정본으로 확인).
      await waitFor(() => expect(listGets()).toBe(2));
      await settle();
      expect(dotIn(SUMMARY_TITLE)).toBeOnTheScreen();
      expect(screen.queryAllByTestId(UNREAD_DOT)).toHaveLength(5);
      expect(screen.queryByText(/읽음 처리/)).toBeNull();
      expect(screen.queryByTestId(MARK_ALL_ERROR)).toBeNull();
      expect(perIdPosts).toEqual([SUMMARY_ID]);
      expect(pushMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('AC-5 · 이동은 읽음 응답을 기다리지 않는다', () => {
    it('읽음 응답이 오기 전(문 닫힘)에 이미 이동이 1회 나가 있다', async () => {
      // 준비
      const gate = createGate();
      readOneReplies = [{ status: 204, gate }];
      await renderReady(6);

      // 실행
      fireEvent.press(rowOf(SUMMARY_TITLE));

      // 단언 — 요청은 나갔고 응답은 아직인데, 이동은 이미 됐다.
      await waitFor(() => expect(perIdPosts).toHaveLength(1));
      expect(timeline).not.toContain(`POST-done read ${SUMMARY_ID}`);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith(SUMMARY_ROUTE);

      // 뒷정리 — 문을 열어 남은 흐름을 끝낸다.
      await act(async () => {
        gate.release();
      });
      await waitFor(() => expect(listGets()).toBe(2));
    });
  });

  describe('AC-9 · 재조회는 읽음 응답 뒤에만', () => {
    it('응답 전(문 닫힘)엔 목록을 다시 받지 않고, 응답이 오면 다시 받아 점이 사라진다', async () => {
      // 준비
      const gate = createGate();
      readOneReplies = [{ status: 204, gate }];
      await renderReady(6);

      // 실행 1 — 누르고, 응답이 붙잡힌 채로 흘려보낸다.
      fireEvent.press(rowOf(SUMMARY_TITLE));
      await waitFor(() => expect(perIdPosts).toHaveLength(1));
      await settle();

      // 단언 1 — 아직 첫 GET 하나뿐, 점도 그대로.
      expect(listGets()).toBe(1);
      expect(dotIn(SUMMARY_TITLE)).toBeOnTheScreen();

      // 실행 2 — 응답을 보낸다.
      await act(async () => {
        gate.release();
      });

      // 단언 2
      await waitFor(() => expect(listGets()).toBe(2));
      await waitFor(() => expect(dotIn(SUMMARY_TITLE)).toBeNull());
    });
  });

  describe('AC-6 · 이미 읽은 행 press', () => {
    it('이동은 1회, 읽음 요청은 0회', async () => {
      // 준비 — 이 행은 처음부터 점이 없다(읽음).
      await renderReady(6);
      expect(dotIn(ITIN_READ_TITLE)).toBeNull();

      // 실행
      fireEvent.press(rowOf(ITIN_READ_TITLE));

      // 단언
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith(
        '/trips/t1/itinerary?from=notification'
      );
      await settle();
      expect(perIdPosts).toHaveLength(0);
      expect(listGets()).toBe(1);
    });
  });

  describe('AC-7 · route 없는 행 press (무회귀)', () => {
    it('미읽음이어도 누를 수 없는 행은 이동 0회 · 읽음 요청 0회', async () => {
      // 준비 — 미읽음(점 있음)인데도 요청이 0이어야 의미가 있다.
      await renderReady(6);
      expect(dotIn(NO_ROUTE_TITLE)).toBeOnTheScreen();

      // 실행
      fireEvent.press(rowOf(NO_ROUTE_TITLE));

      // 단언
      await settle();
      expect(pushMock).not.toHaveBeenCalled();
      expect(perIdPosts).toHaveLength(0);
    });
  });

  describe('AC-10 · 숙소 등록 알림(STAY_DETAIL) press', () => {
    it('등록 숙소 목록으로 이동 1회 + 그 id 로 읽음 요청 1회', async () => {
      // 준비
      await renderReady(6);
      expect(dotIn(STAY_TITLE)).toBeOnTheScreen();

      // 실행
      fireEvent.press(rowOf(STAY_TITLE));

      // 단언
      await waitFor(() => expect(perIdPosts).toHaveLength(1));
      await settle();
      expect(perIdPosts).toEqual([STAY_ID]);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(pushMock).toHaveBeenCalledWith('/my/stays');
    });
  });

  // TRIP-1501 · 목록이 있는 채 재조회만 실패 + 읽음 응답이 알림함을 나간 뒤 도착.
  describe('TRIP-1501 · 재조회 실패는 목록을 지우지 않는다', () => {
    it('읽음 204 뒤 재조회만 500 → 행 6개·점이 그대로 남고 오류 얼굴은 없다(isError 와 data 가 함께 산다)', async () => {
      // 준비 — 첫 GET 정상, 두 번째(읽음 뒤 재조회)만 500. 캐시 상태를 읽으려고 클라이언트를 직접 쥔다.
      const client = newTestQueryClient();
      listReplies = [{ status: 200 }, { status: 500 }];
      render(<NotificationInboxPage />, { wrapper: createWrapper(client) });
      await waitFor(() => expect(screen.queryAllByTestId(ROW)).toHaveLength(6));
      expect(dotIn(SUMMARY_TITLE)).toBeOnTheScreen();

      // 실행
      fireEvent.press(rowOf(SUMMARY_TITLE));

      // 단언 1(앵커) — 실패가 캐시에 도착했는데 옛 data 는 살아 있다.
      await waitFor(() =>
        expect(
          client.getQueryState(getGetMeNotificationsQueryKey())?.status
        ).toBe('error')
      );
      expect(
        client.getQueryState(getGetMeNotificationsQueryKey())?.data
      ).toBeDefined();
      expect(listGets()).toBe(2);

      // 단언 2 — 멀쩡한 목록이 오류 얼굴에 덮이지 않는다(새 목록을 못 받았으니 점도 그대로).
      expect(screen.queryByTestId(ERROR)).toBeNull();
      expect(screen.queryAllByTestId(ROW)).toHaveLength(6);
      expect(dotIn(SUMMARY_TITLE)).toBeOnTheScreen();
    });
  });

  describe('TRIP-1501 · 읽음 응답이 알림함을 나간 뒤 와도 목록 캐시는 낡음 처리된다', () => {
    const listKey = getGetMeNotificationsQueryKey();

    /** 미읽음 행을 누르고, 응답이 문 뒤에 붙잡힌 채 알림함을 나간다(언마운트). 문을 돌려준다. */
    async function pressUnreadThenLeave(client: QueryClient) {
      const gate = createGate();
      readOneReplies = [{ status: 204, gate }];
      const view = render(<NotificationInboxPage />, {
        wrapper: createWrapper(client),
      });
      await waitFor(() => expect(screen.queryAllByTestId(ROW)).toHaveLength(6));
      fireEvent.press(rowOf(SUMMARY_TITLE));
      await waitFor(() => expect(perIdPosts).toHaveLength(1));
      view.unmount();
      return gate;
    }

    it('U1 · 응답이 나간 화면 뒤에 도착해도 낡음 표식이 서고, 보는 화면이 없으니 재조회는 없다', async () => {
      // 준비 + 실행 1 — 누르고 나간다.
      const client = appLikeClient();
      const gate = await pressUnreadThenLeave(client);

      // 단언 1(실행 전 앵커) — 응답 전이라 아직 낡음 표식이 없다.
      expect(timeline).not.toContain(`POST-done read ${SUMMARY_ID}`);
      expect(client.getQueryState(listKey)?.isInvalidated).toBe(false);

      // 실행 2 — 응답을 보낸다.
      await act(async () => {
        gate.release();
      });

      // 단언 2 — 응답 뒤에 낡음 표식이 섰고, 화면이 없으니 재조회는 나가지 않았다.
      await waitFor(() =>
        expect(timeline).toContain(`POST-done read ${SUMMARY_ID}`)
      );
      await waitFor(() =>
        expect(client.getQueryState(listKey)?.isInvalidated).toBe(true)
      );
      await settle();
      expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
      expect(listGets()).toBe(1);
    });

    it('U2 · 30초 안에 알림함에 다시 들어오면 낡은 목록을 다시 받아 그 행의 점이 사라진다', async () => {
      // 준비 + 실행 1 — 누르고 나간 뒤 응답을 보낸다(낡음 표식이 서는 것까지 동기화점으로만 기다린다).
      const client = appLikeClient();
      const gate = await pressUnreadThenLeave(client);
      await act(async () => {
        gate.release();
      });
      await waitFor(() =>
        expect(client.getQueryState(listKey)?.isInvalidated).toBe(true)
      );
      expect(listGets()).toBe(1);

      // 실행 2 — 같은 클라이언트로 다시 들어온다.
      render(<NotificationInboxPage />, { wrapper: createWrapper(client) });

      // 단언 — staleTime 30초가 남았는데도 다시 받는다(표식 때문). 새 목록에선 그 행의 점이 없다.
      await waitFor(() => expect(listGets()).toBe(2));
      await waitFor(() => expect(dotIn(SUMMARY_TITLE)).toBeNull());
      expect(screen.queryAllByTestId(ROW)).toHaveLength(6);
    });

    it('U2 앵커 · 읽음 없이 나갔다 30초 안에 돌아오면 재조회가 없다(이 래퍼의 staleTime 이 실제로 먹는다)', async () => {
      // 준비 + 실행 — 렌더 → 나감 → 같은 클라이언트로 다시 들어옴.
      const client = appLikeClient();
      const first = render(<NotificationInboxPage />, {
        wrapper: createWrapper(client),
      });
      await waitFor(() => expect(screen.queryAllByTestId(ROW)).toHaveLength(6));
      first.unmount();
      render(<NotificationInboxPage />, { wrapper: createWrapper(client) });

      // 단언 — 캐시된 목록이 바로 보이고, 흘려보내도 GET 은 처음 1번뿐이다.
      expect(screen.queryAllByTestId(ROW)).toHaveLength(6);
      await settle();
      expect(listGets()).toBe(1);
      expect(client.getQueryState(listKey)?.isInvalidated).toBe(false);
    });
  });
});
