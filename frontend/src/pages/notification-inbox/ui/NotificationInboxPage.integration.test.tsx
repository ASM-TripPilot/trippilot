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
 * TRIP-773 · l01 '모두 읽음' 배선 — 실제 페이지 + msw + 실 QueryClient 로 "실제로 나간 요청"을 잰다.
 *
 * 무엇을 보장하나(01b D1~D3):
 *  - **AC-2 건별 호출**: 미읽음 2 + 읽음 1 에서 누르면 `POST /me/notifications/{id}/read` 가 정확히 2회,
 *    대상은 미읽음 두 건이고 읽음 행 id 로는 0회. `/read-all` 은 미처리 요청이라 쏘면 red(D1 — 전환은 새 티켓).
 *  - **AC-3 무효화**: POST 가 **모두 끝난 뒤** 목록 GET 이 한 번 더 나가고, 재조회 결과(모두 읽음)로 버튼이 사라진다.
 *  - **AC-4 부분 실패**: 1건이 500 이어도 나머지를 기다린 뒤 재조회하고, 안내 "일부 알림을 읽음 처리하지 못했어요"를
 *    보인다. 전부 실패도 같은 문구, 전부 성공이면 안내 부재. 다음 press 때 안내가 걷힌다.
 *  - **AC-5 진행 중 비활성**: 응답 전엔 버튼이 disabled 이고, 다시 눌러도 POST 가 늘지 않는다.
 *
 * 장치:
 *  - **상태 기억 핸들러** — POST 받은 id 를 `readIds` 에 넣고, GET 은 그 id 의 readAt 을 채워 돌려준다.
 *    고정 응답이면 재조회 뒤에도 미읽음이 그대로라 "버튼이 사라진다"를 관측할 수 없다.
 *  - **문(gate)** — 테스트가 열 때까지 응답하지 않는 POST. "응답 전"을 시간이 아니라 신호로 만든다
 *    (useToggles.integration.test.tsx 선례).
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
const PARTIAL_FAILURE = '일부 알림을 읽음 처리하지 못했어요';

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

/** POST 한 건을 어떻게 답할지 — 204(성공) / 500(실패), 필요하면 문 뒤에서. */
type Reply = { status: 204 | 500; gate?: ReturnType<typeof createGate> };

let readIds: Set<string>;
let postStarts: string[];
/** request:start(GET) 와 POST 완료를 한 줄에 섞어 순서를 본다. */
let timeline: string[];
let replies: Record<string, Reply>;

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
  readIds = new Set();
  postStarts = [];
  timeline = [];
  replies = {};
  setAccessToken('a');
  server.use(
    // 상태 기억 GET — POST 로 읽힌 id 는 readAt 이 채워져 나간다.
    http.get(`${BASE}/me/notifications`, () =>
      HttpResponse.json({
        items: BASE_ITEMS.map((item) =>
          readIds.has(item.notificationId)
            ? { ...item, readAt: item.readAt ?? minutesAgo(0) }
            : item
        ),
      })
    ),
    http.post(
      `${BASE}/me/notifications/:notificationId/read`,
      async ({ params }) => {
        const id = String(params.notificationId);
        postStarts.push(id);
        const reply = replies[id] ?? { status: 204 };
        if (reply.gate) await reply.gate.opened;
        timeline.push(`POST-done ${id}`);
        if (reply.status === 500) {
          return new HttpResponse(null, { status: 500 });
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

describe('AC-2·3 · 전부 성공 — 미읽음만 건별 POST, 모두 끝난 뒤 재조회, 버튼 사라짐', () => {
  it('POST 는 미읽음 2건에만 정확히 2회, 두 POST 가 끝난 뒤 GET 이 다시 나가고 버튼·dot 이 사라진다', async () => {
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));

    // 재조회가 나가고, 그 결과(모두 읽음)가 화면에 닿을 때까지.
    await waitFor(() => expect(listGets()).toBe(2));
    await waitFor(() => expect(screen.queryByTestId(MARK_ALL)).toBeNull());

    // 건별 호출 — 정확히 2회, 대상은 미읽음 두 건, 읽음 행은 0회.
    expect(postStarts).toHaveLength(2);
    expect([...postStarts].sort()).toEqual([U1, U2].sort());
    expect(postStarts).not.toContain(R1);

    // 무효화 — GET 이 한 번 더(1 → 2), 그리고 그 GET 은 두 POST 가 모두 끝난 뒤다.
    const refetchAt = timeline.lastIndexOf(`GET ${LIST_PATH}`);
    expect(timeline.indexOf(`POST-done ${U1}`)).toBeLessThan(refetchAt);
    expect(timeline.indexOf(`POST-done ${U2}`)).toBeLessThan(refetchAt);

    // 행은 그대로 3개(긍정 짝) + 미읽음 dot 0 + 전부 성공이면 안내 부재.
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(3);
    expect(
      screen.queryAllByTestId('notification-inbox-unread-dot')
    ).toHaveLength(0);
    expect(screen.queryByTestId(MARK_ALL_ERROR)).toBeNull();
  });
});

describe('AC-3·4 · 부분 실패 — 나머지를 기다린 뒤 재조회하고 안내를 보인다', () => {
  it('U1 500 · U2 지연: U2 가 끝나기 전엔 재조회 없음 → 끝나면 재조회 + 안내, 실패한 1건은 미읽음으로 남는다', async () => {
    const slow = createGate();
    replies[U1] = { status: 500 };
    replies[U2] = { status: 204, gate: slow };
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));
    await waitFor(() => expect(postStarts).toHaveLength(2));
    await settle();

    // U1 은 이미 실패했지만 U2 가 아직이다 — 모두 끝나기 전에 무효화하면 안 된다.
    expect(listGets()).toBe(1);

    await act(async () => {
      slow.release();
    });

    await waitFor(() => expect(listGets()).toBe(2));
    expect(await screen.findByTestId(MARK_ALL_ERROR)).toHaveTextContent(
      PARTIAL_FAILURE
    );
    // 재조회 결과: U2 만 읽힘 → 미읽음 1(U1) 이라 버튼·dot 1 이 남는다.
    await waitFor(() =>
      expect(
        screen.queryAllByTestId('notification-inbox-unread-dot')
      ).toHaveLength(1)
    );
    expect(screen.getByTestId(MARK_ALL)).toBeOnTheScreen();
  });

  it('안내는 다음 "모두 읽음" press 때 걷히고, 이번엔 성공해 버튼이 사라진다', async () => {
    replies[U1] = { status: 500 };
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));
    await screen.findByTestId(MARK_ALL_ERROR);
    await waitFor(() => expect(screen.getByTestId(MARK_ALL)).toBeEnabled());

    // 두 번째 시도 — U1 이 이번엔 성공하되 문 뒤에서 기다린다.
    const retry = createGate();
    replies[U1] = { status: 204, gate: retry };
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
  });

  it('전부 실패해도 재조회하고 같은 문구를 보인다', async () => {
    replies[U1] = { status: 500 };
    replies[U2] = { status: 500 };
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));

    expect(await screen.findByTestId(MARK_ALL_ERROR)).toHaveTextContent(
      PARTIAL_FAILURE
    );
    await waitFor(() => expect(listGets()).toBe(2));
    expect(postStarts).toHaveLength(2);
  });
});

describe('AC-5 · 진행 중 비활성 — 응답 전 다시 눌러도 POST 가 늘지 않는다', () => {
  it('응답 전엔 버튼이 disabled 이고, 한 번 더 눌러도 POST 는 미읽음 수(2)에 머문다', async () => {
    const gate = createGate();
    replies[U1] = { status: 204, gate };
    replies[U2] = { status: 204, gate };
    await renderReady();

    fireEvent.press(screen.getByTestId(MARK_ALL));
    await waitFor(() => expect(screen.getByTestId(MARK_ALL)).toBeDisabled());
    fireEvent.press(screen.getByTestId(MARK_ALL));
    await settle();

    expect(postStarts).toHaveLength(2);

    await act(async () => {
      gate.release();
    });
    await waitFor(() => expect(screen.queryByTestId(MARK_ALL)).toBeNull());
    expect(postStarts).toHaveLength(2);
  });
});
