import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { Notification } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { NotificationInboxPage } from './NotificationInboxPage';

/**
 * l01 '모두 읽음' 배선 — 실제 페이지 + msw + 실 QueryClient 로 "실제로 나간 요청"을 잰다.
 * TRIP-773 신설(건별 POST), TRIP-946 에서 `POST /me/notifications/read-all` 1회로 계약 교체.
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
 *  - 건별 POST 핸들러는 일부러 204 로 살려 두고 호출만 센다 — 옛 방식으로 돌아가면 "건별 0회" 단언이 red 가 된다.
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

const BASE = 'http://localhost:8080/api/v1';
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

/** read-all 한 번을 어떻게 답할지 — 204(성공) / 500 / 네트워크 오류, 필요하면 문 뒤에서. */
type Reply = {
  status: 204 | 500 | 'network';
  gate?: ReturnType<typeof createGate>;
};

let allRead: boolean;
let readAllPosts: number;
let perIdPosts: string[];
/** request:start(GET) 와 read-all 완료를 한 줄에 섞어 순서를 본다. */
let timeline: string[];
/** read-all 호출 순서대로 꺼내 쓰는 응답 큐. 비면 204. */
let readAllReplies: Reply[];
/** 있으면 read-all 성공 뒤의 목록 GET(재조회)을 이 문 뒤에 붙잡는다. 첫 GET 은 안 막는다. */
let refetchGate: ReturnType<typeof createGate> | undefined;

const listGets = () => timeline.filter((e) => e === `GET ${LIST_PATH}`).length;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'GET') {
      timeline.push(`GET ${new URL(request.url).pathname}`);
    }
  });
});

beforeEach(() => {
  allRead = false;
  readAllPosts = 0;
  perIdPosts = [];
  timeline = [];
  readAllReplies = [];
  refetchGate = undefined;
  setAccessToken('a');
  server.use(
    // 상태 기억 GET — read-all 이 성공한 뒤로는 전 행이 읽음으로 나간다.
    http.get(`${BASE}/me/notifications`, async () => {
      if (allRead && refetchGate) await refetchGate.opened;
      return HttpResponse.json({
        items: BASE_ITEMS.map((item) =>
          allRead ? { ...item, readAt: item.readAt ?? minutesAgo(0) } : item
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
    // 옛 방식(건별) 감시용 — 정상 응답하되 호출을 센다.
    http.post(`${BASE}/me/notifications/:notificationId/read`, ({ params }) => {
      perIdPosts.push(String(params.notificationId));
      return new HttpResponse(null, { status: 204 });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(<NotificationInboxPage />, { wrapper: Wrapper });
}

/** 첫 목록(3행)이 도착할 때까지 기다린다. */
async function renderReady() {
  renderPage();
  await waitFor(() =>
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(3)
  );
}

/** "아무 일도 더 안 일어났다"를 보기 위해 잠시 흘려보낸다. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

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
