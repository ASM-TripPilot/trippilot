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
import { BASE } from '@/test-support/apiBase';
import { createRequestLog } from '@/test-support/mswItinerary';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { assistantPort } from '../api/assistantClient';
import type {
  AssistantMessage,
  OpenSessionResponse,
  SendTurnRequest,
} from '../api/assistantContract';
import {
  assistantSample,
  sampleActionLogs,
  sampleSession,
  startQuickReplies,
  userMessage,
} from '../api/assistantSamples';
import { AssistantSheetPage } from './AssistantSheetPage';

/**
 * TRIP-1514 · 도우미 시트 — **기본 어댑터(HttpAssistantAdapter) + MSW** 통합 테스트(U8 FD frontend-components R19).
 * `setAssistantPort` 로 가짜를 끼우지 않는다 — 실 axios 요청이 MSW 로 나가고, 응답 모양은 BE 계약
 * (openapi `/assistant/**` · `assistantContract.ts`)과 같은 샘플(`assistantSamples`)을 쓴다.
 *
 * 무엇을 보장하나: 열기(POST sessions, 여행 id만 싣는다) · TEXT 턴(멱등 키·발화·화면 문맥이 본문에 실린다) ·
 * 제안 [적용](POST apply) 이 409 STALE 이면 낡음 얼굴 + [다시 제안]이 새 턴 id 로 같은 발화를 다시 보낸다 ·
 * 429 TURN_IN_PROGRESS 는 말풍선·입력을 두고 Retry-After 뒤 **같은 clientTurnId** 로 재전송 ·
 * 429 RATE_LIMITED 는 말풍선을 거두고 입력을 돌려주며 다음 전송은 **새 id** · 이력(b06)은 ACTION_LOG 행과 다른 대화 목록.
 *
 * 3동작: 준비=MSW 핸들러 → 실행=렌더·입력·press → 단언=나간 요청 본문·횟수와 보이는 것.
 * ⚠️ MSW `onUnhandledRequest:'error'` 는 테스트를 실패시키지 않는다 — "안 나갔다/몇 번 나갔다" 는 요청 로거로 센다.
 * 실기기 키보드·시트 모션은 jest 가 못 본다(6-b).
 */

// 429 케이스는 Retry-After(1초)를 실시간으로 기다린다 — 기본 test 상한 5초를 이 파일만 넓힌다.
jest.setTimeout(20000);

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

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
}));

// 턴 id 는 호출마다 달라야 "같은 id 재시도 / 새 id" 를 가를 수 있다.
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => {
    mockUuid += 1;
    return `turn-${mockUuid}`;
  },
}));

const TRIP = '11111111-1111-1111-1111-111111111111';
const SESSION = sampleSession(TRIP);
const UTTERANCE = '둘째 날 오후 카페를 더 조용한 곳으로 바꿔줘';

const log = createRequestLog(server);
let client: QueryClient;
let turnBodies: SendTurnRequest[] = [];

function renderPage() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(<AssistantSheetPage surface="ITINERARY" tripId={TRIP} />, {
    wrapper: Wrapper,
  });
}

function opened(messages: AssistantMessage[] = []): OpenSessionResponse {
  return {
    session: SESSION,
    messages,
    quickReplies: startQuickReplies(true),
  };
}

function proposalMessage(id: string): AssistantMessage {
  return assistantSample('proposal', { id, tripId: TRIP });
}

/** 열기(POST sessions)·목록(GET sessions) 기본 핸들러 — 페이지는 마운트 때 둘 다 부른다. */
function serveOpen(
  open: OpenSessionResponse = opened(),
  sessionList: unknown[] = []
) {
  server.use(
    http.post(`${BASE}/assistant/sessions`, () => HttpResponse.json(open)),
    http.get(`${BASE}/assistant/sessions`, () => HttpResponse.json(sessionList))
  );
}

/** 턴 POST — 요청마다 `responders` 를 차례로 쓰고(마지막은 반복), 본문은 `turnBodies` 에 쌓는다. */
function serveTurns(...responders: (() => Response | Promise<Response>)[]) {
  let call = 0;
  server.use(
    http.post(
      `${BASE}/assistant/sessions/:sessionId/turns`,
      async ({ request }) => {
        turnBodies.push((await request.json()) as SendTurnRequest);
        const responder = responders[Math.min(call, responders.length - 1)];
        call += 1;
        return responder();
      }
    )
  );
}

const turnOk =
  (...messages: AssistantMessage[]) =>
  () =>
    HttpResponse.json({
      messages: [userMessage('u-1', UTTERANCE), ...messages],
      quickReplies: [],
    });

// 구현 폴백(`retryAfterSeconds ?? 1`)과 다른 값 — 헤더를 읽어야만 안내가 "2초"로 뜬다(W1).
const RETRY_AFTER_SECONDS = '2';
const RATE_LIMIT_WAIT = { timeout: 8000 };

const tooMany =
  (code: string, retryAfter = RETRY_AFTER_SECONDS) =>
  () =>
    HttpResponse.json(
      { error: { code, message: '잠시 후 다시' } },
      { status: 429, headers: { 'Retry-After': retryAfter } }
    );

const turnHits = () => log.hitsFor('POST', '/turns');

async function typeAndSend(text: string): Promise<void> {
  fireEvent.changeText(await screen.findByTestId('assistant-input'), text);
  await act(async () => {
    fireEvent.press(screen.getByTestId('assistant-send'));
  });
}

beforeAll(() => {
  log.attach();
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  log.reset();
  turnBodies = [];
  mockUuid = 0;
  mockBack.mockClear();
  mockReplace.mockClear();
  setAccessToken('valid-access');
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  client.clear();
});

afterAll(() => server.close());

describe('도우미 시트 · 열기와 턴 (TRIP-1514 AC-2)', () => {
  it('I1 열기는 POST sessions 1회(여행 id 만 싣는다)·칩과 시작 quick reply 가 뜬다', async () => {
    let openBody: unknown;
    server.use(
      http.post(`${BASE}/assistant/sessions`, async ({ request }) => {
        openBody = await request.json();
        return HttpResponse.json(opened());
      }),
      http.get(`${BASE}/assistant/sessions`, () => HttpResponse.json([]))
    );

    renderPage();

    expect(
      await screen.findByTestId('assistant-context-chip')
    ).toHaveTextContent('부산 2박 3일 · 등록 숙소 서면');
    expect(
      screen.getByTestId('assistant-quick-reply-qr-review')
    ).toBeOnTheScreen();
    expect(openBody).toEqual({ tripId: TRIP });
    expect(log.hitsFor('POST', '/assistant/sessions')).toBe(1);
  });

  it('I2 TEXT 턴은 멱등 키·발화·화면 문맥을 싣고, 제안 카드가 그려진다', async () => {
    serveOpen();
    serveTurns(turnOk(proposalMessage('m-1')));
    renderPage();
    await screen.findByTestId('assistant-input');
    // 아직 제안 카드가 없다 — 앵커
    expect(screen.queryByTestId('assistant-proposal-apply')).toBeNull();

    await typeAndSend(UTTERANCE);

    expect(
      await screen.findByTestId('assistant-proposal-apply')
    ).toBeOnTheScreen();
    expect(turnHits()).toBe(1);
    expect(turnBodies).toEqual([
      {
        clientTurnId: 'turn-1',
        input: { type: 'TEXT', text: UTTERANCE },
        screen: { surface: 'ITINERARY' },
      },
    ]);
  });
});

describe('도우미 시트 · 제안 적용 (TRIP-1514 AC-2)', () => {
  async function renderWithProposal() {
    serveOpen();
    serveTurns(turnOk(proposalMessage('m-1')), turnOk(proposalMessage('m-2')));
    renderPage();
    await typeAndSend(UTTERANCE);
    await screen.findByTestId('assistant-proposal-apply');
  }

  it('A1 [적용] 이 200 APPLIED 면 POST apply 1회 · 적용했어요 얼굴', async () => {
    await renderWithProposal();
    server.use(
      http.post(`${BASE}/assistant/proposals/:proposalId/apply`, () =>
        HttpResponse.json({
          proposal: { id: 'proposal-m-1', status: 'APPLIED' },
          messages: sampleActionLogs(TRIP).slice(1),
        })
      )
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-proposal-apply'));
    });

    expect(await screen.findByText('적용했어요')).toBeOnTheScreen();
    expect(log.hitsFor('POST', '/proposals/proposal-m-1/apply')).toBe(1);
    expect(screen.queryByTestId('assistant-proposal-apply')).toBeNull();
  });

  it('A2 [적용] 이 409 STALE 이면 낡음 얼굴, [다시 제안] 은 새 턴 id 로 같은 발화를 다시 보낸다', async () => {
    await renderWithProposal();
    server.use(
      http.post(`${BASE}/assistant/proposals/:proposalId/apply`, () =>
        HttpResponse.json(
          { error: { code: 'STALE', message: '일정이 바뀌었어요' } },
          { status: 409 }
        )
      )
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-proposal-apply'));
    });

    expect(
      await screen.findByTestId('assistant-proposal-stale')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('assistant-proposal-apply')).toBeNull();
    expect(screen.queryByTestId('assistant-proposal-error')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-proposal-repropose'));
    });

    // 새 제안(m-2)이 PROPOSED 로 도착해 [적용] 이 다시 하나 생긴다
    expect(
      await screen.findByTestId('assistant-proposal-apply')
    ).toBeOnTheScreen();
    expect(turnHits()).toBe(2);
    expect(turnBodies[1].input).toEqual({ type: 'TEXT', text: UTTERANCE });
    expect(turnBodies[1].clientTurnId).not.toBe(turnBodies[0].clientTurnId);
  });
});

describe('도우미 시트 · 429 (TRIP-1514 AC-2 · TRIP-1409)', () => {
  it('T1 TURN_IN_PROGRESS — 말풍선·입력을 두고 Retry-After 뒤 [다시 보내기] 는 같은 clientTurnId', async () => {
    serveOpen();
    serveTurns(tooMany('TURN_IN_PROGRESS'), turnOk(proposalMessage('m-1')));
    renderPage();

    await typeAndSend(UTTERANCE);

    // 막히자마자 남은 초는 서버가 준 Retry-After 그대로다(시계 단언 없음 — 폴백이면 "1초")
    expect(
      await screen.findByTestId('assistant-rate-limited')
    ).toHaveTextContent('2초', { exact: false });
    // 서버가 이미 기록한 턴이다 — 말풍선은 남고 입력은 복원하지 않는다(복원하면 같은 말이 두 번 나간다)
    expect(
      screen.getByTestId('assistant-user-bubble-pending')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-input').props.value).toBe('');

    // Retry-After 뒤 막힘이 풀리면 [다시 보내기] 가 눌린다(실시간 대기 — 가짜 타이머는 MSW 비동기와 충돌)
    // 찾기는 act 밖에서 — act 안에서 기다리면 그동안의 상태 갱신이 act 끝까지 모여 영영 안 그려진다
    const resend = await screen.findByTestId(
      'assistant-resend',
      {},
      RATE_LIMIT_WAIT
    );
    await act(async () => {
      fireEvent.press(resend);
    });

    expect(
      await screen.findByTestId('assistant-proposal-apply')
    ).toBeOnTheScreen();
    expect(turnHits()).toBe(2);
    expect(turnBodies[1].clientTurnId).toBe(turnBodies[0].clientTurnId);
    expect(screen.queryByTestId('assistant-user-bubble-pending')).toBeNull();
  });

  it('T2 RATE_LIMITED — 말풍선을 거두고 입력을 돌려주며, 풀린 뒤 다시 보내면 새 clientTurnId', async () => {
    serveOpen();
    serveTurns(tooMany('RATE_LIMITED'), turnOk(proposalMessage('m-1')));
    renderPage();

    await typeAndSend(UTTERANCE);

    expect(
      await screen.findByTestId('assistant-rate-limited')
    ).toHaveTextContent('2초', { exact: false });
    // 서버가 턴을 기록하지 않았다 — 말풍선을 거두고 입력을 되돌린다
    expect(screen.queryByTestId('assistant-user-bubble-pending')).toBeNull();
    expect(screen.getByTestId('assistant-input').props.value).toBe(UTTERANCE);
    expect(screen.queryByTestId('assistant-resend')).toBeNull();

    // 막힘이 풀리면(Retry-After) 안내가 사라지고 보내기가 다시 열린다
    await waitFor(
      () => expect(screen.queryByTestId('assistant-rate-limited')).toBeNull(),
      RATE_LIMIT_WAIT
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('assistant-send'));
    });

    expect(
      await screen.findByTestId('assistant-proposal-apply')
    ).toBeOnTheScreen();
    expect(turnHits()).toBe(2);
    expect(turnBodies[1].input).toEqual({ type: 'TEXT', text: UTTERANCE });
    expect(turnBodies[1].clientTurnId).not.toBe(turnBodies[0].clientTurnId);
  });
});

describe('도우미 시트 · 이력 (TRIP-1514 AC-2)', () => {
  it('H1 이력 보기 — 적용 기록(ACTION_LOG) 행과 다른 대화 목록이 나온다', async () => {
    const OTHER = '22222222-2222-2222-2222-222222222222';
    serveOpen(opened(sampleActionLogs(TRIP)), [
      { id: SESSION.id, tripId: TRIP, lastTurnAt: '2026-10-12T05:25:00Z' },
      {
        id: OTHER,
        tripId: '33333333-3333-3333-3333-333333333333',
        tripTitle: '제주 3박 4일',
        lastTurnAt: '2026-10-10T05:25:00Z',
      },
    ]);
    renderPage();

    fireEvent.press(await screen.findByTestId('assistant-history-toggle'));

    expect(await screen.findByTestId('assistant-history')).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-history-row-log-1')).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-history-row-log-2')).toBeOnTheScreen();
    // 지금 대화는 "다른 대화" 목록에서 빠진다
    expect(
      await screen.findByTestId(`assistant-history-session-${OTHER}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`assistant-history-session-${SESSION.id}`)
    ).toBeNull();
    expect(log.hitsFor('GET', '/assistant/sessions')).toBeGreaterThanOrEqual(1);
    // 열기 응답이 메시지 캐시를 채워 둬서 같은 메시지를 또 받으러 가지 않는다
    expect(log.hitsFor('GET', '/messages')).toBe(0);
  });

  it('H2 어댑터 getMessages — before·limit 을 쿼리로 싣고 nextBefore 를 그대로 돌려준다', async () => {
    let seen: URL | null = null;
    server.use(
      http.get(
        `${BASE}/assistant/sessions/:sessionId/messages`,
        ({ request }) => {
          seen = new URL(request.url);
          return HttpResponse.json({
            messages: [userMessage('u-9', '이전 발화')],
            nextBefore: 'cursor-2',
          });
        }
      )
    );
    client = new QueryClient();

    const page = await assistantPort().getMessages(SESSION.id, {
      before: 'cursor-1',
      limit: 30,
    });

    expect(seen).not.toBeNull();
    expect((seen as unknown as URL).pathname).toBe(
      `/api/v1/assistant/sessions/${SESSION.id}/messages`
    );
    expect((seen as unknown as URL).searchParams.get('before')).toBe(
      'cursor-1'
    );
    expect((seen as unknown as URL).searchParams.get('limit')).toBe('30');
    expect(page.nextBefore).toBe('cursor-2');
    expect(page.messages.map((message) => message.id)).toEqual(['u-9']);
  });
});
