import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  GenerateItineraryRequestGenerationMode,
  GenerationSession,
  Itinerary,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { GeneratingPage } from './GeneratingPage';

/**
 * TRIP-1032 · A — **다른 여행의 일정을 만드는 중**이면 서버가 생성 POST 를 409 `GENERATION_IN_PROGRESS`
 * (+ `error.activeTripId`)로 거절한다. 생성 화면은 이것을 일반 실패로 접지 않고 안내한 뒤, 사용자가
 * 누를 때만 그 여행의 생성을 취소하고 이 여행을 다시 만든다(사용자 결정 2026-09-27 · INV-4).
 *
 * 무엇을 보장하나:
 *  - 🔴 G1 409 면 일반 실패 얼굴이 아니라 안내(+[취소하고 새로 만들기]·[기다리기])가 뜨고, 뜨기만 해서는
 *    아무것도 취소하지 않는다(AC-1 · AC-5). 문구에 소요시간이 없다(AC-10 · INV-3).
 *  - 🟢 G2 다른 409·500 은 지금처럼 일반 실패 얼굴이다(무회귀 앵커).
 *  - 🔴 G3 [취소하고 새로 만들기] = 그 여행 일정 조회 → 세션 cancel → **같은 body** 로 생성 재시도, 이 순서로
 *    한 번씩(AC-2). 성공하면 원래 목적지로 간다.
 *  - 🔴 G4·G5 cancel 이 409(이미 끝남)이거나 취소할 세션이 없어도 곧장 재시도한다(AC-3).
 *  - 🔴 G6 재시도가 또 409 면 알아서 다시 취소하지 않는다 — 누를 때마다 cancel 최대 1회(AC-4).
 *  - 🔴 G7 세션 id 를 못 얻었는데 또 409 면 "첫날 만드는 중이라 취소 불가" + [기다리기]만(01b Q1).
 *  - 🔴 G8 [기다리기] = 홈으로 replace, 아무것도 취소하지 않는다(AC-5 · 01b Q5).
 *
 * 왜 MSW 인가: 핵심 단언이 "cancel 이 네트워크로 몇 번, 어떤 순서로 나갔나"다. 훅을 목하면 구현이
 * 다른 경로(순수 fetcher)로 쏘는 순간 "0회"가 공허해진다 — 가짜 서버는 어느 경로든 센다(02a ★3).
 *
 * 3동작: 준비 = 가짜 서버 응답 차례 → 실행 = 화면을 열고 안내 버튼을 누른다 → 단언 = 얼굴·요청 순서·이동.
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

// 생성 성공 순간 알림 권한을 묻는다(TRIP-835) — 이 파일의 관심사가 아니다.
jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외(02a ★11).
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    navigate: jest.fn(),
  }),
}));

// 지도는 이 파일의 관심사가 아니다(꼭 갈 곳 0개라 어차피 안 그려진다).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
/** 지금 만들려는 여행(T1)과 이미 생성 중인 다른 여행(T2), 그 생성 세션(S2). */
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const ACTIVE_TRIP_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';

/** 로그를 읽기 쉽게 — 긴 uuid 대신 T1·T2·S2 로 적는다. */
const LABEL: Record<string, string> = {
  [TRIP_ID]: 'T1',
  [ACTIVE_TRIP_ID]: 'T2',
  [SESSION_ID]: 'S2',
};
const label = (id: unknown): string => LABEL[String(id)] ?? String(id);

function itinerary(
  tripId: string,
  generationSessionId: string | null
): Itinerary {
  return {
    itineraryId: `itin-${tripId}`,
    tripId,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'PARTIAL',
    generationSessionId,
    isFallback: false,
    days: [
      {
        date: '2026-06-10',
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ],
  };
}

/** 409 GENERATION_IN_PROGRESS — openapi ErrorResponse 봉투 그대로(activeTripId 는 이 code 에만 실린다). */
const busy = (): Response =>
  HttpResponse.json(
    {
      error: {
        code: 'GENERATION_IN_PROGRESS',
        message: '다른 여행의 일정을 만들고 있어요',
        activeTripId: ACTIVE_TRIP_ID,
      },
    },
    { status: 409 }
  );
/** 201 — 생성됨(day1 PARTIAL). */
const created = (): Response =>
  HttpResponse.json(itinerary(TRIP_ID, SESSION_ID), { status: 201 });

/** cancel 200 — openapi GenerationSession 모양(CANCELED 로 닫힘). */
function canceledSession(): GenerationSession {
  return {
    sessionId: SESSION_ID,
    status: 'CANCELED',
    mode: 'FULLY_AI',
    isFallback: false,
    startedAt: '2026-09-27T10:00:00.000Z',
    finishedAt: '2026-09-27T10:03:00.000Z',
  };
}

/** 관심 요청만 순서대로 적는다: `POST T1` · `GET T2` · `CANCEL T2/S2` (02a ★3). */
let log: string[] = [];
/** 생성 POST 의 원문 body(문자열 — 본문 없는 요청도 받기 위해, 02a ★14). */
let postBodies: string[] = [];
/** 생성 POST 응답 차례. 비면 201. */
let postQueue: (() => Response)[] = [];
/** T2 일정 조회 응답. 기본 = 세션이 도는 PARTIAL. */
let activeItineraryHandler: () => Response;
/** cancel 응답. 기본 = 200 취소됨. */
let cancelHandler: () => Response;

const count = (prefix: string): number =>
  log.filter((line) => line.startsWith(prefix)).length;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  log = [];
  postBodies = [];
  postQueue = [];
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  setAccessToken('valid-access');
  activeItineraryHandler = () =>
    HttpResponse.json(itinerary(ACTIVE_TRIP_ID, SESSION_ID));
  cancelHandler = () => HttpResponse.json(canceledSession());

  server.use(
    http.post(
      `${BASE}/trips/:tripId/itinerary`,
      async ({ request, params }) => {
        postBodies.push(await request.text());
        log.push(`POST ${label(params.tripId)}`);
        return (postQueue.shift() ?? created)();
      }
    ),
    http.get(`${BASE}/trips/:tripId/itinerary`, ({ params }) => {
      // 생성 화면의 POST 경로는 자기 여행 일정을 조회하지 않는다 — 조회는 T2(취소 대상)만 로그에 남긴다.
      if (params.tripId !== ACTIVE_TRIP_ID) {
        return HttpResponse.json({}, { status: 404 });
      }
      log.push(`GET ${label(params.tripId)}`);
      return activeItineraryHandler();
    }),
    http.post(
      `${BASE}/trips/:tripId/generation-sessions/:sessionId/cancel`,
      ({ params }) => {
        log.push(`CANCEL ${label(params.tripId)}/${label(params.sessionId)}`);
        return cancelHandler();
      }
    ),
    http.get(`${BASE}/trips/:tripId/must-visits`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json([]))
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage(
  props: {
    mode?: GenerateItineraryRequestGenerationMode;
    successRoute?: '/trips/[tripId]/itinerary/copick/[slotKey]';
  } = {}
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <GeneratingPage
      tripId={TRIP_ID}
      mode={props.mode ?? 'FULLY_AI'}
      successRoute={props.successRoute}
    />,
    { wrapper: Wrapper }
  );
}

/** "안 나갔다"는 나갈 시간을 준 뒤에야 의미가 있다(02a ★5). */
function settle(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** replace 목적지를 형태(문자열/객체)와 무관하게 글자로 편다. */
function replacedTo(index = 0): string {
  const destination = mockReplace.mock.calls[index][0] as unknown;
  return typeof destination === 'string'
    ? destination
    : JSON.stringify(destination);
}

/** 렌더된 문자열 전부(소요시간 부정 스캔의 모집단 — DraftPage.default 선례). */
function renderedText(): string {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out.join(' ');
}

/** 안내가 뜰 때까지 기다린 뒤 [취소하고 새로 만들기]를 누른다. */
async function pressCancelAndRetry(): Promise<void> {
  fireEvent.press(
    await screen.findByTestId('itinerary-generation-busy-cancel-retry')
  );
}

describe('🔴 G1 · AC-1·AC-5·AC-10 — 다른 여행 생성 중(409)이면 일반 실패가 아니라 안내가 뜬다', () => {
  it('안내 얼굴·제목·두 버튼이 뜨고, 뜨기만 해서는 조회·취소가 0이다', async () => {
    postQueue = [busy];

    renderPage();

    // 단언 ① 안내 얼굴 — 일반 실패 얼굴은 아니다(짝).
    expect(
      await screen.findByTestId('itinerary-generation-busy')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
    // 01b Q7 채택 문구 — 정확 일치(02a ★7).
    expect(
      screen.getByText('다른 여행의 일정을 만들고 있어요')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-generation-busy-cancel-retry')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-generation-busy-wait')
    ).toBeOnTheScreen();

    // 단언 ② 확인 없는 취소 금지 — 안내가 떠 있기만 할 때는 T2 조회도 cancel 도 없다(AC-5).
    await settle();
    expect(log).toEqual(['POST T1']);
    expect(mockReplace).not.toHaveBeenCalled();

    // 단언 ③ INV-3 — 소요시간·분·초·퍼센트 표기가 없다(AC-10).
    expect(renderedText()).not.toMatch(/\d+\s*(분|초|시간)|소요|%/);
  });
});

describe('🟢 G2 · AC-1 무회귀 — 다른 409·500 은 지금처럼 일반 실패 얼굴이다 (선제 green)', () => {
  it.each<[string, () => Response]>([
    [
      '다른 code 의 409',
      () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: '충돌' } },
          { status: 409 }
        ),
    ],
    ['오류 봉투 없는 409', () => HttpResponse.json({}, { status: 409 })],
    [
      '500',
      () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: '서버 오류' } },
          { status: 500 }
        ),
    ],
  ])('%s → 실패 얼굴, 안내 없음', async (_label, response) => {
    postQueue = [response];

    renderPage();

    expect(
      await screen.findByTestId('itinerary-generating-failed')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-generation-busy')).toBeNull();
  });
});

describe('🔴 G3 · AC-2 — [취소하고 새로 만들기] = 조회 → cancel → 같은 body 로 재시도, 한 번씩 이 순서로', () => {
  it('완전 AI: 성공하면 draft 로 replace, POST body 는 처음과 같다', async () => {
    postQueue = [busy, created];

    renderPage();
    await pressCancelAndRetry();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(replacedTo()).toContain('/itinerary/draft');
    expect(replacedTo()).toContain(TRIP_ID);

    // 순서까지 — 개수만 세면 "cancel 전에 POST" 같은 뒤바뀜이 통과한다(02a ★3).
    expect(log).toEqual(['POST T1', 'GET T2', 'CANCEL T2/S2', 'POST T1']);
    // 원래 요청을 그대로 다시 — body 가 처음과 같고, 그 값은 완전 AI 모드다.
    expect(postBodies).toHaveLength(2);
    expect(JSON.parse(postBodies[1])).toEqual(JSON.parse(postBodies[0]));
    expect(JSON.parse(postBodies[1])).toEqual({ generationMode: 'FULLY_AI' });
  });

  it('같이 짜기(CO_PLAN): 재시도 body 도 CO_PLAN 이고, 성공하면 첫 슬롯(copick)으로 간다', async () => {
    postQueue = [busy, created];

    renderPage({
      mode: 'CO_PLAN',
      successRoute: '/trips/[tripId]/itinerary/copick/[slotKey]',
    });
    await pressCancelAndRetry();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(replacedTo()).toContain('copick');
    expect(log).toEqual(['POST T1', 'GET T2', 'CANCEL T2/S2', 'POST T1']);
    expect(postBodies.map((body) => JSON.parse(body) as unknown)).toEqual([
      { generationMode: 'CO_PLAN' },
      { generationMode: 'CO_PLAN' },
    ]);
  });
});

describe('🔴 G4 · AC-3 — cancel 이 409(이미 끝남)여도 곧장 재시도한다', () => {
  it('cancel 409 뒤 생성 POST 가 한 번 더 나가고 성공하면 draft 로', async () => {
    postQueue = [busy, created];
    cancelHandler = () =>
      HttpResponse.json(
        { error: { code: 'CONFLICT', message: '이미 끝난 생성' } },
        { status: 409 }
      );

    renderPage();
    await pressCancelAndRetry();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(replacedTo()).toContain('/itinerary/draft');
    expect(log).toEqual(['POST T1', 'GET T2', 'CANCEL T2/S2', 'POST T1']);
  });
});

describe('🔴 G5 · AC-3·Q1 — 취소할 세션이 없으면 cancel 없이 곧장 재시도한다', () => {
  it.each<[string, () => Response]>([
    [
      '세션 id 가 null(진행 중 아님)',
      () => HttpResponse.json(itinerary(ACTIVE_TRIP_ID, null)),
    ],
    [
      '일정 조회 404(첫날 생성 중이라 일정이 아직 없음)',
      () => HttpResponse.json({}, { status: 404 }),
    ],
  ])('%s → cancel 0, 재시도 1, 성공하면 draft 로', async (_label, response) => {
    postQueue = [busy, created];
    activeItineraryHandler = response;

    renderPage();
    await pressCancelAndRetry();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(replacedTo()).toContain('/itinerary/draft');
    expect(log).toEqual(['POST T1', 'GET T2', 'POST T1']);
  });
});

describe('🔴 G6 · AC-4 — 재시도가 또 409 면 알아서 다시 취소하지 않는다', () => {
  it('안내를 다시 보이고 멈춘다 · 사용자가 다시 누를 때만 cancel 한 번 더', async () => {
    postQueue = [busy, busy, created];

    renderPage();
    await pressCancelAndRetry();

    // ★ 두 안내는 testID 가 같다 — 둘째 POST 도착을 먼저 기다려야 첫 안내를 잘못 잡지 않는다(02a ★6).
    await waitFor(() => expect(count('POST')).toBe(2));
    await settle();

    // 단언 ① 안내가 다시 떠 있고, 취소 버튼도 다시 있다(A 안내 그대로).
    expect(screen.getByTestId('itinerary-generation-busy')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-generation-busy-cancel-retry')
    ).toBeOnTheScreen();
    // 단언 ② 자동 루프 없음 — 확인 1번에 cancel 1번, POST 2번에서 멈췄다.
    expect(count('CANCEL')).toBe(1);
    expect(count('POST')).toBe(2);
    expect(mockReplace).not.toHaveBeenCalled();

    // 실행 ② 사용자가 다시 확인한다.
    fireEvent.press(
      screen.getByTestId('itinerary-generation-busy-cancel-retry')
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(count('CANCEL')).toBe(2);
    expect(count('POST')).toBe(3);
  });
});

describe('🔴 G7 · 01b Q1 — 세션 id 를 못 얻었는데 또 409 면 취소 불가 안내 + [기다리기]만', () => {
  it.each<[string, () => Response]>([
    [
      '세션 id 가 null',
      () => HttpResponse.json(itinerary(ACTIVE_TRIP_ID, null)),
    ],
    ['일정 조회 404', () => HttpResponse.json({}, { status: 404 })],
  ])(
    '%s → 취소 버튼 없음, 기다리기 있음, cancel 0',
    async (_label, response) => {
      postQueue = [busy, busy];
      activeItineraryHandler = response;

      renderPage();
      await pressCancelAndRetry();

      await waitFor(() => expect(count('POST')).toBe(2));
      await settle();

      expect(screen.getByTestId('itinerary-generation-busy')).toBeOnTheScreen();
      // 취소할 수 없으니 취소 버튼을 주지 않는다 — 눌러도 같은 409 만 반복된다.
      expect(
        screen.queryByTestId('itinerary-generation-busy-cancel-retry')
      ).toBeNull();
      expect(
        screen.getByTestId('itinerary-generation-busy-wait')
      ).toBeOnTheScreen();
      // 설명 문장 안에 들어갈 수 있어 부분 일치로 잰다(02a ★7).
      expect(
        screen.getByText(/첫날을 만드는 중이라 취소할 수 없어요/)
      ).toBeOnTheScreen();
      expect(count('CANCEL')).toBe(0);
      expect(count('POST')).toBe(2);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(renderedText()).not.toMatch(/\d+\s*(분|초|시간)|소요|%/);
    }
  );
});

describe('🔴 G8 · AC-5·Q5 — [기다리기]는 홈으로 가고 아무것도 취소하지 않는다', () => {
  it('replace("/(tabs)") 1회 · push 0 · 조회·cancel 0 · 생성 POST 는 처음 1번뿐', async () => {
    postQueue = [busy];

    renderPage();
    fireEvent.press(
      await screen.findByTestId('itinerary-generation-busy-wait')
    );

    // 생성 화면 앱바 뒤로와 같은 목적지(TRIP-1006 홈 히어로가 T2 의 "만드는 중"을 보여 준다).
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)'));
    expect(mockPush).not.toHaveBeenCalled();

    await settle();
    expect(log).toEqual(['POST T1']);
  });
});
