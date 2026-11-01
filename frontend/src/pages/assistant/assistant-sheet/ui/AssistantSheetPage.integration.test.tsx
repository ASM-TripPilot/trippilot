import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
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
import { day, itinerary, slot } from '@/test-support/itineraryFixtures';
import { createRequestLog, serveItinerary } from '@/test-support/mswItinerary';
import { getGetTripsTripIdItineraryQueryKey } from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';

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
import { newTestQueryClient } from '@/test-support/queryRender';
import { routerSpies } from '@/test-support/expoRouterMock';

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
 * 「일정 보기」 목적지(TRIP-1566)도 이 파일이다 — 누른 시점에 일정 GET 이 몇 번·어떤 응답으로 나갔는지가 계약이라 요청 횟수를
 * 셀 수 있는 MSW 가 필요하다(node 버킷의 FakeAssistantAdapter 는 일정 서버가 없다).
 *
 * 3동작: 준비=MSW 핸들러 → 실행=렌더·입력·press → 단언=나간 요청 본문·횟수와 보이는 것.
 * ⚠️ MSW `onUnhandledRequest:'error'` 는 테스트를 실패시키지 않는다 — "안 나갔다/몇 번 나갔다" 는 요청 로거로 센다.
 * 실기기 키보드·시트 모션은 jest 가 못 본다(6-b).
 */

// 429 케이스는 Retry-After(1초)를 실시간으로 기다린다 — 기본 test 상한 5초를 이 파일만 넓힌다.
jest.setTimeout(20000);

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));

const { back: mockBack, replace: mockReplace, push: mockPush } = routerSpies;
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'replace', 'back', 'canGoBack'],
  })
);

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

function renderPage(queryDefaults: Record<string, unknown> = {}) {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, ...queryDefaults },
      mutations: { retry: false },
    },
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
    nextBefore: null,
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
  mockPush.mockClear();
  // TRIP-1565 — push 갈래가 여는 모듈 전역 연타 창이 테스트 사이에 새지 않게(파일 최상위)
  resetPressGuard();
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

    // TRIP-1526 — 서버가 준 contextChip 문구는 칩 접근성 라벨로 도달하고, 보이는 문구는 surface 라벨이다.
    const chip = await screen.findByTestId('assistant-context-chip');
    expect(chip).toHaveTextContent('이 일정에 관해 질문하기');
    expect(chip.props.accessibilityLabel).toContain(
      '부산 2박 3일 · 등록 숙소 서면'
    );
    // TRIP-1567 — 시작 quick reply 는 칩 안에 접혀 있다가 칩을 누르면 보인다(옛: 열자마자 줄로 보임).
    expect(chip).toBeCollapsed();
    expect(screen.queryByTestId('assistant-quick-reply-qr-review')).toBeNull();
    fireEvent.press(chip);
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
    client = newTestQueryClient();

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

// TRIP-1566 — 「일정 보기」(OPEN_ITINERARY)는 고정 라우트가 아니라, 누른 시점에 일정을 조회해 앱 공통 판정
// (resolveItineraryDestination → itineraryDestinationHref)으로 간다. 조회가 정착하기 전·비-404 실패에는 이동하지 않는다(INV-4).
describe('도우미 시트 · 일정 보기 목적지', () => {
  const ITINERARY_KEY = getGetTripsTripIdItineraryQueryKey(TRIP);
  const itineraryHits = () => log.hitsFor('GET', `/trips/${TRIP}/itinerary`);
  const CHECKING_TEXT = '일정을 확인하고 있어요';
  const FAILED_TEXT = '일정을 불러오지 못했어요. 다시 눌러 주세요';

  const greeting = () =>
    assistantSample('greeting', { id: 'm-greet', tripId: TRIP });

  /** 앱 기본 옵션(retry 켜짐)을 흉내 낸다 — 누름 조회가 retry:false 를 따로 주지 않으면 500 이 3번 나간다. 대기 1ms 라 느려지지 않는다. */
  const RETRYING = { retry: 2, retryDelay: 1 };

  function holdResponse() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { gate, release };
  }

  async function openedPage(
    queryDefaults: Record<string, unknown> = {},
    messages: AssistantMessage[] = [greeting()]
  ) {
    serveOpen(opened(messages));
    renderPage(queryDefaults);
    await screen.findAllByTestId('assistant-next-action-OPEN_ITINERARY');
    return () =>
      screen.getAllByTestId('assistant-next-action-OPEN_ITINERARY')[0];
  }

  async function press(element: Parameters<typeof fireEvent.press>[0]) {
    await act(async () => {
      fireEvent.press(element);
    });
  }

  /** 일정 요청이 정착(성공)해 캐시에 들어갔고, 그 뒤 이어지는 마이크로태스크까지 흘렸다 — "안 갔다" 를 말하기 전의 앵커. */
  async function itineraryResponseConsumed() {
    await waitFor(() =>
      expect(client.getQueryState(ITINERARY_KEY)?.status).toBe('success')
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('O1 확정 일정이면 live 로 replace 한다(날짜와 무관) — 일정 화면(h16)으로 가지 않는다', async () => {
    serveItinerary(server, {
      itinerary: () => itinerary({ status: 'CONFIRMED' }),
    });
    const row = await openedPage();
    // 앵커 — 눌러 보기 전엔 요청도 이동도 없다
    expect(itineraryHits()).toBe(0);
    expect(mockReplace).not.toHaveBeenCalled();

    await press(row());

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP}/live`);
    expect(itineraryHits()).toBe(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('O2 일정이 아직 없으면(404) 생성 방식 고르기(method) 로 replace 한다', async () => {
    serveItinerary(server, {
      itinerary: () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: '일정 없음' } },
          { status: 404 }
        ),
    });
    const row = await openedPage(RETRYING);

    await press(row());

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP}/itinerary/method`);
    // 404 는 "없다"는 답이라 실패 안내를 띄우지 않는다
    expect(screen.queryByTestId('assistant-itinerary-failed')).toBeNull();
  });

  // 판정 표 전수는 features/itinerary 의 itineraryDestination.test 가 잠근다 — 여기는 시트가 그 판정·조립기를
  // 실제로 거쳐 가는지(자기 표를 따로 갖지 않는지) 대표 두 건으로만 본다. live·method 는 위 O1·O2.
  it.each([
    [
      '초안(COMPLETE·미확정) → draft',
      () => itinerary(),
      `/trips/${TRIP}/itinerary/draft`,
    ],
    [
      '같이 짜기 생성 중(PARTIAL+CO_PLAN) → 첫 비고정 슬롯 키(# 는 인코딩)로 copick',
      () =>
        itinerary({
          generationState: 'PARTIAL',
          generationMode: 'CO_PLAN',
          days: [
            day('2026-06-10', [
              slot('poi-fixed', { isFixed: true }),
              slot('poi-open'),
            ]),
          ],
        }),
      `/trips/${TRIP}/itinerary/copick/${encodeURIComponent('2026-06-10#poi-open')}`,
    ],
  ])('O3 %s', async (_label, body, href) => {
    serveItinerary(server, { itinerary: body });
    const row = await openedPage();

    await press(row());

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(href);
  });

  it('O4 조회 중에는 이동하지 않고 상태 줄을 보이며, 응답이 오면 그 결과로 이동한다', async () => {
    const held = holdResponse();
    serveItinerary(server, {
      itinerary: async () => {
        await held.gate;
        return itinerary({ status: 'CONFIRMED' });
      },
    });
    const row = await openedPage();
    // 앵커 — 누르기 전엔 상태 줄이 없다
    expect(screen.queryByTestId('assistant-itinerary-checking')).toBeNull();

    await press(row());

    // 요청이 서버에 닿았는데(응답은 보류) 이동은 없다 — 상태 줄은 정확히 이 문구다(완전 일치)
    await waitFor(() => expect(itineraryHits()).toBe(1));
    expect(
      await screen.findByTestId('assistant-itinerary-checking')
    ).toHaveTextContent(CHECKING_TEXT);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByTestId('assistant-itinerary-failed')).toBeNull();

    held.release();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP}/live`);
  });

  it.each([
    ['서버 오류(500)', () => new HttpResponse(null, { status: 500 })],
    ['네트워크 오류', () => HttpResponse.error()],
  ])(
    'O5 %s 면 이동하지 않고 안내를 보이며(시트는 열린 채, 재시도 없음), 다시 누르면 다시 조회해 이동한다',
    async (_label, failure) => {
      let calls = 0;
      serveItinerary(server, {
        itinerary: () => {
          calls += 1;
          return calls === 1 ? failure() : itinerary({ status: 'CONFIRMED' });
        },
      });
      // retry 가 켜진 앱 기본 옵션 아래 — 누름 조회가 retry:false 가 아니면 첫 실패 뒤 1ms 간격으로 더 나간다
      const row = await openedPage(RETRYING);
      expect(screen.queryByTestId('assistant-itinerary-failed')).toBeNull();

      await press(row());

      expect(
        await screen.findByTestId('assistant-itinerary-failed')
      ).toHaveTextContent(FAILED_TEXT);
      expect(mockReplace).not.toHaveBeenCalled();
      // 시트는 열려 있다 — 닫지도 않았고 입력도 그대로 있다
      expect(mockBack).not.toHaveBeenCalled();
      expect(screen.getByTestId('assistant-input')).toBeOnTheScreen();
      // 확인 중 줄이 안내 줄과 겹쳐 남지 않는다
      expect(screen.queryByTestId('assistant-itinerary-checking')).toBeNull();
      // 자동 재시도 없음 — 시간이 흘러도 요청은 한 번뿐이다(retry:false + 자동 재누름 없음)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(itineraryHits()).toBe(1);

      await press(row());

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP}/live`);
      expect(itineraryHits()).toBe(2);
      expect(screen.queryByTestId('assistant-itinerary-failed')).toBeNull();
    }
  );

  it('O6 조회 중 연타해도 일정 요청 1회·이동 1회다', async () => {
    const held = holdResponse();
    serveItinerary(server, {
      itinerary: async () => {
        await held.gate;
        return itinerary({ status: 'CONFIRMED' });
      },
    });
    const row = await openedPage();

    await press(row());
    await waitFor(() => expect(itineraryHits()).toBe(1));
    await press(row());
    await press(row());
    expect(mockReplace).not.toHaveBeenCalled();

    held.release();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    await itineraryResponseConsumed();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(itineraryHits()).toBe(1);
  });

  it('O7 조회 중 ✕ 로 닫으면(닫힘은 막히지 않는다) 늦게 온 응답에도 이동하지 않는다', async () => {
    const held = holdResponse();
    serveItinerary(server, {
      itinerary: async () => {
        await held.gate;
        return itinerary({ status: 'CONFIRMED' });
      },
    });
    const row = await openedPage();

    await press(row());
    await waitFor(() => expect(itineraryHits()).toBe(1));
    await press(screen.getByTestId('assistant-sheet-close'));
    // 앵커 — 확인 중에도 닫기는 동작한다(두 잠금이 한 ref 로 합쳐졌다면 여기서 0)
    expect(mockBack).toHaveBeenCalledTimes(1);

    held.release();
    await itineraryResponseConsumed();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('O8 제안을 적용한 뒤에는 신선해 보이는 캐시를 믿지 않고 다시 조회한다(방금 적용한 일정으로 간다)', async () => {
    // 앱 기본처럼 일정 캐시가 신선한 동안은 재조회하지 않는다 — 캐시엔 적용 전(미확정) 일정이 들어 있다
    serveItinerary(server, {
      itinerary: () => itinerary({ status: 'CONFIRMED' }),
    });
    server.use(
      http.post(`${BASE}/assistant/proposals/:proposalId/apply`, () =>
        HttpResponse.json({
          proposal: { id: 'proposal-m-1', status: 'APPLIED' },
          messages: sampleActionLogs(TRIP).slice(1),
        })
      )
    );
    await openedPage({ staleTime: 60_000 }, [
      greeting(),
      proposalMessage('m-1'),
    ]);
    client.setQueryData(ITINERARY_KEY, itinerary());
    expect(client.getQueryState(ITINERARY_KEY)?.isInvalidated).toBe(false);

    await press(await screen.findByTestId('assistant-proposal-apply'));
    expect(await screen.findByText('적용했어요')).toBeOnTheScreen();
    expect(client.getQueryState(ITINERARY_KEY)?.isInvalidated).toBe(true);
    expect(itineraryHits()).toBe(0);

    await press(
      (await screen.findAllByTestId('assistant-next-action-OPEN_ITINERARY'))[0]
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(itineraryHits()).toBe(1);
    expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP}/live`);
  });
  // TRIP-1565 R-A — push 갈래(상세)가 시트 위에 쌓이는 동안 늦게 끝난 일정 조회의 replace 가 "맨 위 화면"인 상세를 갈아치우면
  // 스택이 어긋난다. 그래서 일정 확인 중에는 push 갈래를 받지 않는다.
  describe('일정 확인과 push 갈래 (TRIP-1565)', () => {
    const placeInfo = (): AssistantMessage => ({
      id: 'm-place',
      role: 'ASSISTANT',
      kind: 'INFO',
      text: '장소 정보예요.',
      payload: {
        infoKind: 'PLACE',
        title: '이름',
        rows: [{ label: '영업', value: '매일' }],
      },
      nextActions: [
        { type: 'OPEN_PLACE', label: '장소 보기', params: { poiId: 'poi-a' } },
      ],
      createdAt: '2026-10-22T00:00:00.000Z',
    });
    const placeRow = () =>
      within(screen.getByTestId('assistant-message-m-place')).getByTestId(
        'assistant-next-action-OPEN_PLACE'
      );

    it('O9 일정 확인 중에 장소 보기(push 갈래)를 누르면 무시되고, 확인이 끝나면 replace 는 일정 목적지로 정확히 1회다', async () => {
      const held = holdResponse();
      serveItinerary(server, {
        itinerary: async () => {
          await held.gate;
          return itinerary({ status: 'CONFIRMED' });
        },
      });
      const row = await openedPage({}, [greeting(), placeInfo()]);

      await press(row());
      await waitFor(() => expect(itineraryHits()).toBe(1));
      // 앵커 — 지금은 확인 중이다(이 상태에서 누른 것만 의미가 있다)
      expect(
        await screen.findByTestId('assistant-itinerary-checking')
      ).toBeOnTheScreen();

      await press(placeRow());

      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();

      held.release();

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP}/live`);
      await itineraryResponseConsumed();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('O10 (O9 의 앵커) 일정 확인이 실패로 끝난 뒤에는 장소 보기가 다시 눌려 push 된다 — 확인 중 무시가 영구 잠금이 아니다', async () => {
      serveItinerary(server, {
        itinerary: () => new HttpResponse(null, { status: 500 }),
      });
      const row = await openedPage({}, [greeting(), placeInfo()]);

      await press(row());
      await screen.findByTestId('assistant-itinerary-failed');
      // 앵커 — 확인이 끝났다(확인 중 줄 없음)
      expect(screen.queryByTestId('assistant-itinerary-checking')).toBeNull();

      await press(placeRow());

      expect(mockPush.mock.calls).toEqual([['/explore/places/poi-a']]);
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});
