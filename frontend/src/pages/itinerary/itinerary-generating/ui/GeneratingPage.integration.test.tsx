import type { ReactNode, ReactElement } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Text } from 'react-native';

import { server } from '@/mocks/server';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import type {
  GenerateItineraryRequestGenerationMode,
  GenerationSession,
  Itinerary,
  ItineraryGenerationState,
  ReplanSession,
  ReplanSessionStatus,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resolveItineraryDestination } from '@/features/itinerary';
import { isNotFound } from '@/shared/api';
import { seoulDate } from '@/shared/lib/seoulDate';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';
import {
  itinerary as baseItinerary,
  trip as baseTrip,
  TRIP_ID,
} from '@/test-support/itineraryFixtures';
import { BASE, serveItinerary } from '@/test-support/mswItinerary';

import { GeneratingPage } from './GeneratingPage';

/**
 * h09 생성 중 — **실 훅 + MSW** 관점 통합 테스트(TRIP-1150 에서 네 파일을 한 파일로 합쳤다).
 *
 * 옛 파일 하나 = 바깥 describe 하나다. 안쪽 describe·it 이름과 각 파일의 픽스처·기본 핸들러(describe 의
 * beforeEach)는 그대로다. 생성 훅을 통째로 목으로 바꾼 관점은 node 버킷 `GeneratingPage.hookMock.test.tsx`.
 *  - 다른 여행 생성 중(409) 안내 — 옛 `.busy`
 *  - 생성 성공이 홈의 일정 캐시에 닿는다 — 옛 `.homeCache`
 *  - (꼭 갈 곳 지도 — 옛 `.map` 은 TRIP-1352 에서 지도 카드 코드째 삭제)
 *  - 관찰 모드(mode 없음) — 옛 `.observe`
 *
 * 합치며 바뀐 장치(02a ★): 서버 listen/close 는 최상위 한 번. 라우터 목은 옛 `.busy`·`.observe` 처럼
 * `push`·`replace`·`back` 을 기록한다(옛 `.homeCache` 목엔 `back` 이 없었지만, 그 부재가 잡던 결함은 실측상
 * 없었다 — 성공 콜백 안의 TypeError 는 react-query 가 삼키고, 생성 화면의 `back()` 회귀는 node 버킷
 * `GeneratingPage.hookMock.test.tsx` I4 가 잡는다). `@/shared/push` 목은 옛 `.busy`·`.homeCache` 것이고
 * GeneratingPage 모듈 그래프에 push 가 없어 나머지 두 관점에는 무해하다.
 *
 * 3동작 뼈대: 준비 = MSW 핸들러·토큰 → 실행 = 페이지 렌더·버튼 press → 단언 = 나간 요청·이동·보이는 것.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
jest.mock('@/shared/storage', () => {
  const actual = jest.requireActual('@/shared/storage');
  return {
    ...actual,
    saveTokens: jest.fn().mockResolvedValue(undefined),
    getTokens: jest.fn().mockResolvedValue({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
    }),
    clearTokens: jest.fn().mockResolvedValue(undefined),
    hasStoredToken: jest.fn().mockResolvedValue(true),
  };
});

// 생성 성공 순간 알림 권한을 묻는다(TRIP-835) — 이 파일의 관심사가 아니다.
jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외(02a ★11).
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockBack = jest.fn();
const mockSetParams = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    dismissTo: mockDismissTo,
    back: mockBack,
    navigate: jest.fn(),
    setParams: mockSetParams,
  }),
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockDismissTo.mockClear();
  mockBack.mockClear();
  mockSetParams.mockClear();
});

// 토스트는 모듈 싱글턴이다 — 진행 중에 화면이 빠지는 케이스(홈 캐시 H1)가 띄운 토스트·타이머가
// 다음 케이스로 새지 않게 최상위에서 비운다(02a ★12).
afterEach(() => {
  resetToast();
});

afterAll(() => server.close());

// TRIP-1032 · 옛 GeneratingPage.busy.integration.test.tsx
describe('다른 여행 생성 중(409) 안내', () => {
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

  /** 지금 만들려는 여행(T1)과 이미 생성 중인 다른 여행(T2), 그 생성 세션(S2). */
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
    return baseItinerary({
      itineraryId: `itin-${tripId}`,
      tripId,
      generationState: 'PARTIAL',
      generationSessionId,
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
    });
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
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage(
    props: {
      mode?: GenerateItineraryRequestGenerationMode;
      successRoute?: '/trips/[tripId]/itinerary/copick/[slotKey]';
      targetDate?: string;
    } = {}
  ) {
    const client = newTestQueryClient({ gcTime: 0 });
    return render(
      <GeneratingPage
        tripId={TRIP_ID}
        mode={props.mode ?? 'FULLY_AI'}
        successRoute={props.successRoute}
        targetDate={props.targetDate}
      />,
      { wrapper: createWrapper(client) }
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

  // 옛 GeneratingScreen.test.tsx(뷰 단위)를 B안으로 옮겼다 — 진행 얼굴 골격·숫자 어휘 없음·펄스 원·장식 그림.
  describe('진행 얼굴 — 골격 · 숫자 어휘 없음 · 펄스 원 · 장식 그림', () => {
    const PULSE = /^itinerary-generating-pulse-/;
    const ILLUSTRATION = 'itinerary-generating-illustration';

    it('생성 응답 전에는 앱바·진행 바·체크리스트 3행(행마다 펄스 원 1개)·숨김 장식 그림이 서고, 퍼센트·초·소요시간이 없다', async () => {
      // 응답이 영영 안 오는 생성 POST — 바깥 핸들러보다 앞에 끼운다(server.use). 진행 얼굴에 머문다.
      server.use(
        http.post(`${BASE}/trips/:tripId/itinerary`, async () => {
          await delay('infinite');
          return HttpResponse.json({});
        })
      );

      renderPage();

      expect(
        await screen.findByTestId('itinerary-generating-progress')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('itinerary-generating-appbar')
      ).toBeOnTheScreen();
      expect(
        screen.queryAllByTestId(/^itinerary-generating-step-/)
      ).toHaveLength(3);
      ['장소 수집', '동선 계산', '시간 배치'].forEach((label) =>
        expect(screen.getByText(label)).toBeOnTheScreen()
      );
      [1, 2, 3].forEach((n) => {
        const dots = within(
          screen.getByTestId(`itinerary-generating-step-${n}`)
        ).getAllByTestId(PULSE);
        expect(dots.map((dot) => dot.props.testID)).toEqual([
          `itinerary-generating-pulse-${n}`,
        ]);
      });

      // 장식 그림 — 카드 3장, 글자 0, 스크린리더에서 숨김(기본 질의엔 안 잡힌다).
      const illustration = screen.getByTestId(ILLUSTRATION, {
        includeHiddenElements: true,
      });
      expect(
        within(illustration).queryAllByTestId(
          /^itinerary-generating-illustration-card-/,
          { includeHiddenElements: true }
        )
      ).toHaveLength(3);
      expect(
        within(illustration).queryAllByText(/.*/, {
          includeHiddenElements: true,
        })
      ).toHaveLength(0);
      expect(illustration.props.accessibilityElementsHidden).toBe(true);
      expect(illustration.props.importantForAccessibility).toBe(
        'no-hide-descendants'
      );
      expect(screen.queryByTestId(ILLUSTRATION)).toBeNull();

      // 숫자 어휘 — 자리 앵커 `\d` 필수(`시간 배치` 라벨은 통과해야 한다).
      const text = renderedText();
      expect(text).not.toMatch(/\d\s*%/);
      expect(text).not.toMatch(/\d\s*초/);
      expect(text).not.toMatch(/\d\s*분|\d\s*시간/);
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
    });

    it('실패 얼굴·409 안내에는 펄스 원·장식 그림이 없다', async () => {
      postQueue = [
        () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: '서버 오류' } },
            { status: 500 }
          ),
      ];
      const { unmount } = renderPage();
      await screen.findByTestId('itinerary-generating-failed');
      expect(screen.queryAllByTestId(PULSE)).toHaveLength(0);
      expect(
        screen.queryByTestId(ILLUSTRATION, { includeHiddenElements: true })
      ).toBeNull();
      unmount();

      postQueue = [busy];
      renderPage();
      await screen.findByTestId('itinerary-generation-busy');
      expect(screen.queryAllByTestId(PULSE)).toHaveLength(0);
      expect(
        screen.queryByTestId(ILLUSTRATION, { includeHiddenElements: true })
      ).toBeNull();
    });
  });

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

  // 사유 문구가 있는 다른 code 의 409 는 이제 규칙 거절이다(아래 R1~R3) — 여기는 문구 없는 409·500 만 남는다.
  describe('🟢 G2 · AC-1 무회귀 — 문구 없는 409·500 은 지금처럼 일반 실패 얼굴이다 (선제 green)', () => {
    it.each<[string, () => Response]>([
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

  /**
   * TRIP-1368 · 서버 일일 한도(TRIP-1314) — 생성 POST 가 429 + `Retry-After`(KST 자정까지 남은 초)면 일반 실패가
   * 아니라 한도 얼굴(`ai-limit-notice`, TRIP-1268 임시 장치가 그린 얼굴 승계)을 그린다. 판정은 429 + `error.code === GENERATION_DAILY_LIMIT` 다(그 밖의 429 는 일반 실패).
   * 재시도로 풀리지 않으니 [다시 시도]가 없고 POST 도 더 나가지 않는다. 시계는 Date 만 고정한다(MSW 타이머 유지).
   */
  describe('🔴 L429 · 429 면 한도 얼굴 — 시각(Retry-After)·두 버튼·재시도 POST 0', () => {
    const KST_13_00 = new Date('2026-10-13T04:00:00Z');
    const limited = (headers: Record<string, string>) => () =>
      HttpResponse.json(
        {
          error: {
            code: 'GENERATION_DAILY_LIMIT',
            message: '오늘의 AI 일정 생성 횟수를 모두 썼어요',
          },
        },
        { status: 429, headers }
      );

    beforeEach(() => {
      jest.useFakeTimers({
        now: KST_13_00,
        doNotFake: [
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'setImmediate',
          'clearImmediate',
          'nextTick',
          'queueMicrotask',
          'performance',
          'requestAnimationFrame',
          'cancelAnimationFrame',
        ],
      });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('Retry-After 로 "내일 00:00 이후" 를 보이고 두 버튼만 있다 (실패 얼굴·안내 없음)', async () => {
      // 13:00 KST + 11시간 = 다음 날 00:00 KST.
      postQueue = [limited({ 'Retry-After': '39600' })];

      renderPage();

      const notice = await screen.findByTestId('ai-limit-notice');
      expect(
        within(notice).getByText('오늘 AI 일정 만들기를 모두 썼어요')
      ).toBeOnTheScreen();
      expect(
        within(notice).getByText(/내일 00:00 이후에 다시 쓸 수 있어요/)
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('ai-limit-manual-cta')).getByText(
          '직접 짜기 이어가기'
        )
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('ai-limit-close')).getByText('닫기')
      ).toBeOnTheScreen();
      // 부정 — 일반 실패·409 안내·다시 시도는 없다.
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
      expect(screen.queryByTestId('itinerary-generation-busy')).toBeNull();
      expect(screen.queryByTestId('itinerary-generating-retry')).toBeNull();
      // 재시도 POST 0 — 처음 나간 1건뿐이다.
      await settle();
      expect(log).toEqual(['POST T1']);
    });

    it('같은 날 안에 풀리면 "오늘 14:00 이후" 로 말한다', async () => {
      postQueue = [limited({ 'Retry-After': '3600' })];

      renderPage();

      expect(
        await screen.findByText(/오늘 14:00 이후에 다시 쓸 수 있어요/)
      ).toBeOnTheScreen();
    });

    it('🔴 Retry-After 가 없어도 깨지지 않는다 — 시각 없이 안내만 (INV-4)', async () => {
      postQueue = [limited({})];

      renderPage();

      const notice = await screen.findByTestId('ai-limit-notice');
      expect(within(notice).queryByText(/이후에 다시 쓸 수 있어요/)).toBeNull();
      expect(
        within(notice).getByText(/직접 짜기는 계속 쓸 수 있어요/)
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
    });

    it.each([
      [
        'RATE_LIMITED(짧은 연타 한도)',
        { error: { code: 'RATE_LIMITED', message: 'x' } },
      ],
      ['코드 없음', { error: { message: 'x' } }],
      ['바디 없음', null],
    ])(
      '429 + %s 는 한도 얼굴이 아니라 일반 실패 얼굴이다 — 재시도 가능',
      async (_n, body) => {
        postQueue = [
          () =>
            HttpResponse.json(body, {
              status: 429,
              headers: { 'Retry-After': '60' },
            }),
          () =>
            HttpResponse.json(
              { error: { code: 'RATE_LIMITED' } },
              { status: 429 }
            ),
        ];

        renderPage();

        expect(
          await screen.findByTestId('itinerary-generating-failed')
        ).toBeOnTheScreen();
        expect(screen.queryByTestId('ai-limit-notice')).toBeNull();
        expect(
          screen.getByTestId('itinerary-generating-retry')
        ).toBeOnTheScreen();
        fireEvent.press(screen.getByTestId('itinerary-generating-retry'));
        await settle();
        expect(log).toEqual(['POST T1', 'POST T1']);
      }
    );

    it('[직접 짜기 이어가기] = 편집기로 replace, [닫기] = 홈으로', async () => {
      postQueue = [limited({ 'Retry-After': '60' })];

      renderPage();

      fireEvent.press(await screen.findByTestId('ai-limit-manual-cta'));
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/manual',
        params: { tripId: TRIP_ID },
      });

      fireEvent.press(screen.getByTestId('ai-limit-close'));
      expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)');
      expect(log).toEqual(['POST T1']);
    });
  });

  /**
   * 서버 규칙 거절 — 여행 중·끝난 여행의 재생성은 409 `CONFLICT`(+ 사유 문구)다(BE `guardTripPeriod`).
   * 다시 보내도 같은 답이라 "네트워크를 확인하고 다시 시도" 실패 얼굴은 거짓말이다(DEV 실측: 여행 중 재생성
   * 49개 여행 0회 성공). 여행 중이면 다시 짜기는 Plan-B 의 몫이라 **모달(i04) 없이** 이 생성 화면을 재계획
   * 모드(`replan:'1'`)로 다시 연다(2026-10-14 사용자 결정 — 사유를 묻지 않고 바로 다시 짜서 반영한다).
   * 끝난 여행·기간 모름이면 서버 사유 + [닫기]만.
   */
  describe('🔴 R1~R3 — 규칙 거절(409 CONFLICT): 여행 중이면 재계획 모드로 넘기고, 아니면 서버 사유를 보인다', () => {
    const IN_TRIP_REASON =
      '여행 중에는 일정을 다시 만들 수 없어요. 재계획으로 오늘 일정을 바꿔 주세요.';
    const refused = (message: string) => (): Response =>
      HttpResponse.json(
        { error: { code: 'CONFLICT', message } },
        { status: 409 }
      );
    function tripHandler(startDate: string, endDate: string) {
      return http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(
          baseTrip({
            tripId: TRIP_ID,
            title: '부산',
            startDate,
            endDate,
            party: 1,
            destinations: [],
            status: 'ACTIVE',
            createdAt: '2026-10-01T00:00:00Z',
            updatedAt: '2026-10-01T00:00:00Z',
            itineraryDayCount: 2,
          })
        )
      );
    }

    it('R1 여행 중: 생성 화면을 재계획 모드로 replace 1회 · 모달 push 0 · 실패·거절 얼굴 없음 · POST 1회', async () => {
      const today = seoulDate(new Date());
      server.use(tripHandler(today, '2099-12-31'));
      postQueue = [refused(IN_TRIP_REASON)];

      renderPage();

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/generating',
        params: { tripId: TRIP_ID, replan: '1' }, // 보던 날이 없으면 날짜를 싣지 않는다(서버가 오늘)
      });
      await settle();
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
      expect(screen.queryByTestId('itinerary-generating-refused')).toBeNull();
      expect(count('POST')).toBe(1);
    });

    // 초안에서 오늘 뒤의 날을 보며 [다시 짜기]를 누르면 그 날이 실려 온다(DraftPage). 다녀온 기록이 있어 거절되면
    // 재계획도 그 날로 열어야 한다 — 빠지면 사용자가 보던 날 대신 오늘이 다시 짜인다.
    it('R1b 보던 날(targetDate)이 실려 오면 재계획 모드도 그 날로 연다', async () => {
      const today = seoulDate(new Date());
      const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      server.use(tripHandler(today, '2099-12-31'));
      postQueue = [refused(IN_TRIP_REASON)];

      renderPage({ targetDate: tomorrow });

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/generating',
        params: { tripId: TRIP_ID, replan: '1', targetDate: tomorrow },
      });
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('R2 끝난 여행: 서버 사유 + [닫기]만 · 다시 시도 없음 · 닫기 = 홈 · Plan-B 로 안 간다', async () => {
      const ENDED_REASON = '이미 끝난 여행은 일정을 다시 만들 수 없어요.';
      server.use(tripHandler('2020-01-01', '2020-01-02'));
      postQueue = [refused(ENDED_REASON)];

      renderPage();

      expect(
        await screen.findByTestId('itinerary-generating-refused')
      ).toBeOnTheScreen();
      expect(screen.getByText(ENDED_REASON)).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
      expect(screen.queryByTestId('itinerary-generating-retry')).toBeNull();

      fireEvent.press(screen.getByTestId('itinerary-generating-refused-close'));
      await settle();
      expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)');
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('R3 여행 기간을 모르면(조회 실패) Plan-B 로 넘기지 않고 서버 사유 + [닫기]', async () => {
      server.use(
        http.get(`${BASE}/trips/:tripId`, () =>
          HttpResponse.json({}, { status: 500 })
        )
      );
      postQueue = [refused(IN_TRIP_REASON)];

      renderPage();

      expect(
        await screen.findByTestId('itinerary-generating-refused-close')
      ).toBeOnTheScreen();
      expect(screen.getByText(IN_TRIP_REASON)).toBeOnTheScreen();
      await settle();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
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
    ])(
      '%s → cancel 0, 재시도 1, 성공하면 draft 로',
      async (_label, response) => {
        postQueue = [busy, created];
        activeItineraryHandler = response;

        renderPage();
        await pressCancelAndRetry();

        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
        expect(replacedTo()).toContain('/itinerary/draft');
        expect(log).toEqual(['POST T1', 'GET T2', 'POST T1']);
      }
    );
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

        expect(
          screen.getByTestId('itinerary-generation-busy')
        ).toBeOnTheScreen();
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
    it('dismissTo("/(tabs)") 1회 · replace 0 · push 0 · 조회·cancel 0 · 생성 POST 는 처음 1번뿐', async () => {
      postQueue = [busy];

      renderPage();
      fireEvent.press(
        await screen.findByTestId('itinerary-generation-busy-wait')
      );

      // 생성 화면 앱바 뒤로와 같은 목적지(TRIP-1006 홈 히어로가 T2 의 "만드는 중"을 보여 준다).
      await waitFor(() =>
        expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)')
      );
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();

      await settle();
      expect(log).toEqual(['POST T1']);
    });
  });
});

// TRIP-1015 A · 옛 GeneratingPage.homeCache.integration.test.tsx
describe('생성 성공 → 홈 일정 캐시', () => {
  /**
   * TRIP-1015 A · 생성이 끝났는데 홈 히어로가 "일정 만들기"로 남던 결함(QA #046 · US-SHELL-02).
   *
   * 원인: 생성 성공 처리가 `mutate(vars, { onSuccess })` 자리에만 있었다. 그 콜백은 **화면이 붙어 있을
   * 때만** 불린다(TanStack `mutationObserver` — 구독자가 없으면 건너뛴다). 생성 화면 뒤로(=홈으로 이탈)
   * 한 뒤 POST 가 끝나면 아무도 일정 캐시를 고치지 않아, 홈이 들고 있던 404("아직 일정 없음")가 남는다.
   *
   * 무엇을 보장하나:
   *  - 🔴 H1 생성 화면을 **떠난 뒤** POST 가 성공해도, 같은 QueryClient 에서 그 여행 일정을 구독하던
   *    쪽(홈 대역)이 새 일정을 본다 → 목적지가 'method'(방식 선택)가 아니라 'generating' 이다.
   *    화면이 떠났으니 이동(replace)은 0회다 — 이 0회가 "이탈 경로를 정말 재현했다"는 앵커다.
   *  - 🔴 H2 화면에 **머문 채** 성공해도 같은 캐시가 갱신되고, 이동은 지금처럼 draft 로 1회다(무회귀).
   *
   * 왜 이렇게 테스트하나:
   *  - 홈 화면 전체를 렌더하지 않고 **홈과 같은 훅(`useGetTripsTripIdItinerary`) + 같은 판정
   *    (`resolveItineraryDestination`)** 을 쓰는 작은 대역(HomeProbe)을 둔다. 홈이 보는 것은 결국
   *    "그 키의 캐시 → 목적지" 하나라서, 대역이 같은 키를 구독하면 홈이 볼 값을 그대로 본다.
   *  - 캐시를 직접 써 넣든(setQueryData) 무효화해 다시 묻든(invalidateQueries) 둘 다 통과하게 짰다 —
   *    가짜 서버의 GET 도 생성이 끝난 뒤엔 새 일정을 돌려준다. 단 **수정이 뮤테이션 쪽에 있어야** 한다:
   *    이 파일은 자체 QueryClient 를 쓰므로 앱 전역 QueryClient 설정에 넣은 수정은 여기서 안 보인다
   *    (02a §2-A 판정).
   *  - MSW(가짜 서버)를 쓰는 이유: 훅을 목하면 "화면이 떠나면 콜백이 안 불린다"는 라이브러리 동작 자체가
   *    사라진다 — 진짜 react-query 와 진짜 네트워크 경로를 태워야 이 결함이 재현된다.
   *
   * 3동작: 준비 = 느린 생성 POST + 404 인 일정 GET → 실행 = 생성 화면을 열고(떠나고) POST 를 풀어 준다 →
   * 단언 = 홈 대역이 본 목적지·이동 횟수.
   */

  const TRIP_ID = '55555555-5555-5555-5555-555555555555';

  /** 생성 응답(201) = 1일차가 도착한 일정(PARTIAL). openapi `Itinerary` 필수 필드를 채운다. */
  function generatedItinerary(): Itinerary {
    return baseItinerary({
      itineraryId: 'itin-home-cache',
      tripId: TRIP_ID,
      generationState: 'PARTIAL',
      days: [
        {
          date: '2026-06-10',
          slots: [
            {
              poiId: 'a',
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
    });
  }

  /** 케이스가 손으로 풀어 주는 생성 POST — 풀기 전까지 응답이 오지 않는다("수 분 걸리는 생성"). */
  let releasePost: () => void = () => {};
  let generated = false;
  let postCalls = 0;

  beforeEach(() => {
    generated = false;
    postCalls = 0;
    mockPush.mockClear();
    mockReplace.mockClear();
    setAccessToken('valid-access');

    server.use(
      // 일정 GET — 생성이 끝나기 전엔 404(아직 일정 없음), 끝난 뒤엔 새 일정. 수정이 무효화(재조회)
      // 방식이어도 이 핸들러가 새 일정을 돌려주므로 통과한다.
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        generated
          ? HttpResponse.json(generatedItinerary())
          : HttpResponse.json({}, { status: 404 })
      ),
      http.post(`${BASE}/trips/:tripId/itinerary`, async () => {
        postCalls += 1;
        await new Promise<void>((resolve) => {
          releasePost = resolve;
        });
        generated = true;
        return HttpResponse.json(generatedItinerary(), { status: 201 });
      })
    );
  });

  afterEach(() => {
    // 매달린 POST 를 풀어 다음 케이스로 새지 않게 한다.
    releasePost();
    server.resetHandlers();
    clearAccessToken();
  });

  /**
   * 홈 대역 — 홈 `PlanningHome` 과 같은 훅·같은 판정으로 "지금 캐시라면 히어로가 어디로 보낼까"를 글자로
   * 내보인다. 정착 전(로딩·404 아닌 오류)은 'unsettled'.
   */
  function HomeProbe(): ReactElement {
    const itinerary = useGetTripsTripIdItinerary(TRIP_ID);
    const notFound = isNotFound(itinerary.error);
    const settled = !itinerary.isPending && (!itinerary.isError || notFound);
    const destination = settled
      ? resolveItineraryDestination({
          notFound,
          generationState: itinerary.data?.generationState,
          status: itinerary.data?.status,
          generationMode: itinerary.data?.generationMode,
        })
      : 'unsettled';
    return <Text testID="home-probe-destination">{destination}</Text>;
  }

  /** 생성 화면과 홈 대역을 한 QueryClient 아래 나란히 둔다. `showGenerating=false` = 생성 화면을 떠남. */
  function Host({ showGenerating }: { showGenerating: boolean }): ReactElement {
    return (
      <>
        {showGenerating ? (
          <GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />
        ) : null}
        <HomeProbe />
      </>
    );
  }

  function renderHost() {
    const client = newTestQueryClient({ gcTime: 0 });
    return render(<Host showGenerating />, { wrapper: createWrapper(client) });
  }

  /** 준비 공통 — 홈 대역이 404 로 정착('method')하고 생성 POST 가 서버에 닿을 때까지 기다린다. */
  async function waitUntilGeneratingWithHomeOnMethod(): Promise<void> {
    // 앵커 — 수정 전 상태 그대로 "아직 일정 없음"을 본다(이게 없으면 아래 'generating' 이 공짜일 수 있다).
    await waitFor(() =>
      expect(screen.getByTestId('home-probe-destination')).toHaveTextContent(
        'method'
      )
    );
    await waitFor(() => expect(postCalls).toBe(1));
  }

  describe('🔴 1015-A · 생성 성공이 홈이 보는 일정 캐시에 닿는다 (QA #046 · US-SHELL-02)', () => {
    it('H1 생성 화면을 떠난 뒤 POST 가 성공해도 홈 대역의 목적지가 method 가 아니라 generating 이다 — 이동은 0회', async () => {
      // 준비
      const view = renderHost();
      await waitUntilGeneratingWithHomeOnMethod();

      // 실행 ① — 생성 화면을 떠난다(앱바 뒤로 = 홈으로 이탈). POST 는 아직 매달려 있다.
      view.rerender(<Host showGenerating={false} />);
      expect(screen.queryByTestId('itinerary-generating-progress')).toBeNull();

      // 실행 ② — 서버가 생성을 끝낸다.
      releasePost();

      // 단언 ① — 홈이 보는 캐시가 새 일정으로 바뀌었다(1일차 도착 = 생성 중 목적지).
      await waitFor(() =>
        expect(screen.getByTestId('home-probe-destination')).toHaveTextContent(
          'generating'
        )
      );
      // 단언 ② — 떠난 화면은 이동을 일으키지 않는다(=이탈 경로를 정말 재현했다는 앵커).
      expect(mockReplace).not.toHaveBeenCalled();
      expect(postCalls).toBe(1);
    });

    it('H2 화면에 머문 채 성공하면 draft 로 replace 1회(무회귀)이고, 홈 대역도 같은 새 일정을 본다', async () => {
      // 준비
      renderHost();
      await waitUntilGeneratingWithHomeOnMethod();

      // 실행
      releasePost();

      // 단언 ① — 지금처럼 초안으로 1회 넘어간다.
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(JSON.stringify(mockReplace.mock.calls[0][0])).toContain(
        '/itinerary/draft'
      );
      // 단언 ② — 이동은 목(mock)이라 초안 화면이 뜨지 않는다. 그래도 홈이 보는 캐시는 갱신돼 있어야 한다.
      await waitFor(() =>
        expect(screen.getByTestId('home-probe-destination')).toHaveTextContent(
          'generating'
        )
      );
      expect(postCalls).toBe(1);
    });
  });
});

// TRIP-1006 · 옛 GeneratingPage.observe.integration.test.tsx
describe('관찰 모드(mode 없음)', () => {
  /**
   * TRIP-1006 · 생성 중 화면의 **관찰 모드** — `mode` 없이 열리면 생성을 새로 쏘지 않고 이미 도는 생성을
   * 일정 GET 으로 지켜보기만 한다(A3·A4 · INV-4). 일정 탭 카드·홈 CTA 가 완전 AI 생성 중(PARTIAL)
   * 여행을 다시 열 때 이 모드로 온다(D2).
   *
   * 무엇을 보장하나:
   *  - 🔴 O1·O2 첫 GET 이 PARTIAL·COMPLETE·FAILED 면 곧장 초안(draft)으로 **replace** 한다(Q1 — 나머지
   *    폴링은 초안 화면 몫). 생성 POST 는 0.
   *  - 🔴 O3 404(관찰할 생성이 없음)면 생성 방식(method)으로 replace 한다. POST 0.
   *  - 🔴 O4 GET 이 오기 전엔 진행 얼굴이 떠 있다(빈 화면·실패 얼굴 아님). 정착 뒤에도 POST 0.
   *  - 🔴 O5 조회가 실패하면 실패 얼굴을 띄우고(침묵 금지), [다시 시도]는 **GET 만** 다시 한다(A6).
   *
   * 왜 MSW 인가: 핵심 단언이 "생성 POST 가 네트워크로 한 번도 안 나갔다"다. 훅을 목하면 그건 목의
   * 가정이 된다 — 가짜 서버에서 실제로 나간 요청 수를 센다.
   *
   * 3동작: 준비 = 가짜 서버 응답 → 실행 = mode 없이 화면을 연다(필요하면 다시 시도) → 단언 = 이동·요청 수.
   */

  const TRIP_ID = '44444444-4444-4444-4444-444444444444';

  function itinerary(generationState: ItineraryGenerationState): Itinerary {
    return baseItinerary({
      itineraryId: 'itin-observe',
      tripId: TRIP_ID,
      generationState,
      days: [
        {
          date: '2026-06-10',
          slots: [
            {
              poiId: 'a',
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
    });
  }

  /** 케이스가 바꿔 끼우는 일정 GET 응답(핸들러가 요청 시점에 읽는다). */
  let itineraryHandler: () => Response;
  let getCalls = 0;
  let postCalls = 0;

  beforeEach(() => {
    getCalls = 0;
    postCalls = 0;
    mockPush.mockClear();
    mockReplace.mockClear();
    mockBack.mockClear();
    setAccessToken('valid-access');
    itineraryHandler = () => HttpResponse.json(itinerary('PARTIAL'));

    serveItinerary(server, {
      itinerary: () => {
        getCalls += 1;
        return itineraryHandler();
      },
    });
    server.use(
      // 생성 POST — 나가면 안 된다. 핸들러를 두는 이유는 "나갔다"를 세기 위해서다(없으면 요청이
      // 미처리 오류로 사라져 수를 못 센다).
      http.post(`${BASE}/trips/:tripId/itinerary`, () => {
        postCalls += 1;
        return HttpResponse.json(itinerary('PARTIAL'), { status: 201 });
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderObserver() {
    const client = newTestQueryClient({ gcTime: 0 });
    // mode 를 **주지 않는다** — 이것이 관찰 모드의 신호다.
    return render(<GeneratingPage tripId={TRIP_ID} />, {
      wrapper: createWrapper(client),
    });
  }

  /** "안 나갔다"는 나갈 시간을 준 뒤에야 의미가 있다(02a ★4). */
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

  describe('🔴 O1 · A3 — 완전 AI 생성 중(PARTIAL)을 관찰하면 곧장 초안으로 넘긴다', () => {
    it('첫 GET 이 PARTIAL 이면 draft 로 replace 1회, push 0, 생성 POST 0', async () => {
      // 준비 — 기본 핸들러가 PARTIAL(1일차 도착) 을 준다.
      // 실행
      renderObserver();

      // 단언 ① 초안으로 넘어간다(뒤로가면 이 화면으로 안 돌아오게 replace).
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(replacedTo()).toContain('/itinerary/draft');
      expect(replacedTo()).toContain(TRIP_ID);
      expect(mockPush).not.toHaveBeenCalled();
      // TRIP-1385 — 다시 여는 진입(관찰)은 공개 모션 신호(reveal)를 싣지 않는다.
      expect(replacedTo()).not.toContain('reveal');

      // 단언 ② 생성은 한 번도 쏘지 않았다(#083 — 재진입이 생성을 다시 돌리면 같이 짜기가 덮인다).
      await settle();
      expect(postCalls).toBe(0);
      expect(getCalls).toBeGreaterThanOrEqual(1);
    });
  });

  describe('🔴 O2 · A3 — 이미 끝났거나(COMPLETE) 2차가 실패(FAILED)해도 초안으로', () => {
    it.each<ItineraryGenerationState>(['COMPLETE', 'FAILED'])(
      '첫 GET 이 %s 면 draft 로 replace 1회, 생성 POST 0',
      async (state) => {
        itineraryHandler = () => HttpResponse.json(itinerary(state));

        renderObserver();

        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
        expect(replacedTo()).toContain('/itinerary/draft');
        await settle();
        expect(postCalls).toBe(0);
      }
    );
  });

  describe('🔴 O3 · Q1 — 관찰할 일정이 없으면(404) 생성 방식 화면으로', () => {
    it('첫 GET 이 404 면 method 로 replace 1회, 생성 POST 0', async () => {
      itineraryHandler = () => HttpResponse.json({}, { status: 404 });

      renderObserver();

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(replacedTo()).toContain('/itinerary/method');
      expect(replacedTo()).toContain(TRIP_ID);
      await settle();
      expect(postCalls).toBe(0);
    });
  });

  describe('🔴 O4 · A4 — mode 없이 열려도 생성 모드를 지어내지 않는다 (INV-4)', () => {
    it('GET 이 오기 전엔 진행 얼굴이 뜨고, 정착한 뒤에도 생성 POST 는 0', async () => {
      renderObserver();

      // 단언 ① 마운트 직후 — 진행 얼굴(빈 화면 아님), 실패 얼굴 아님.
      expect(
        screen.getByTestId('itinerary-generating-progress')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();

      // 단언 ② GET 이 정착(=이동)한 뒤까지 기다려도 POST 는 0.
      await waitFor(() => expect(mockReplace).toHaveBeenCalled());
      await settle();
      expect(postCalls).toBe(0);
    });
  });

  describe('🔴 O5 · A6 — 조회 실패는 실패 얼굴로 말하고, 다시 시도는 GET 만 한다', () => {
    it('500 이면 실패 얼굴 · 이동 0 → [다시 시도] 가 GET 을 1회 더 하고 성공하면 draft 로, POST 는 끝까지 0', async () => {
      // 준비 — 첫 조회는 서버 오류.
      itineraryHandler = () => HttpResponse.json({}, { status: 500 });

      renderObserver();

      // 단언 ① 침묵하지 않는다 — 실패 얼굴이 뜨고, 모르는 상태로 아무 데도 가지 않는다.
      await screen.findByTestId('itinerary-generating-failed');
      expect(mockReplace).not.toHaveBeenCalled();
      const getsBeforeRetry = getCalls;

      // 실행 — 서버가 회복한 뒤 다시 시도.
      itineraryHandler = () => HttpResponse.json(itinerary('PARTIAL'));
      fireEvent.press(screen.getByTestId('itinerary-generating-retry'));

      // 단언 ② 다시 시도 = GET 재조회. 회복했으니 초안으로 간다.
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(getCalls).toBe(getsBeforeRetry + 1);
      expect(replacedTo()).toContain('/itinerary/draft');

      // 단언 ③ 다시 시도가 생성을 쏘는 경로로 새지 않았다.
      await settle();
      expect(postCalls).toBe(0);
    });
  });
});

describe('재계획 모드(replan)', () => {
  /**
   * 2026-10-14 사용자 결정 — 여행 중 [다시 짜기]는 재계획 요청 모달(i04)로 가지 않고, 이 생성 화면을 거쳐
   * 재계획(Plan-B → ScheduleAgent) 결과를 **확인 없이 바로 반영**한 뒤 추천안(draft)으로 간다. 원 일정은 서버가
   * 반영 전에 복원 지점을 남긴다(openapi apply 설명 — 되돌릴 지점을 먼저 남긴다).
   *
   * 무엇을 보장하나:
   *  - 🔴 RP1·RP1b 마운트 때 시작 POST 1회, 본문 모양(오늘 = PARTIAL_SLOTS·null / 보던 날 = FULL_DAY·그 날).
   *    위치는 안 읽는다 — `originKind:null` 이면 서버가 사다리로 정한다(openapi StartReplanRequest.originKind).
   *  - 🔴 RP2 SOLVING → DRAFT 가 되면 apply 가 **정확히 1회**, 성공하면 draft 로 replace.
   *  - 🔴 RP3 NO_SOLUTION → 원 일정 유지 안내 + [닫기](=홈). apply 0.
   *  - 🔴 RP4 시작 409 → 서버 사유 + [닫기]. 세션 조회·apply 0.
   *  - 🔴 RP5 FAILED → 실패 얼굴 + [다시 시도] = 시작 POST 를 처음부터 다시(새 세션).
   *  - 🔴 RP2·RP2b 추천안은 **다시 짠 날**로 연다(`day` = 보던 날, 없으면 오늘 KST) — 2일차 이후에 첫 날로 열리면
   *    바뀐 게 안 보여 "아무 일도 없었다"로 읽힌다(#1235 사후 리뷰 W2).
   *  - 🔴 RF1~RF5 (#1235 사후 리뷰 B1) 실패 얼굴로 가는 나머지 네 갈래 — 시작 POST 500 · 세션 조회 오류 · CANCELED ·
   *    자동 반영(apply) 409/500. 반영 실패 뒤 [다시 시도]면 새 세션 동안 실패 얼굴이 남지 않는다(apply 상태 리셋).
   *  - 🔴 RS1·RF2 (W3) 폴링은 종료 상태(DRAFT·NO_SOLUTION·FAILED)와 조회 오류 뒤 멈춘다.
   *  - 🔴 RC1 (B2) 세션이 COLLECTING·SOLVING 에 2분 머물면 폴링을 멈추고 실패 얼굴 + [다시 시도](INV-4).
   *  - 🔴 RB1·RB2 (W5) ‹ 로 나가면 "다시 짜기를 멈췄어요…" 토스트 — 단 반영 요청이 이미 나갔으면 띄우지 않는다
   *    (서버가 반영할 수 있는데 "원래 일정 그대로"라고 말하면 거짓이다).
   *  - 모든 케이스: 생성 POST(`POST /itinerary`) 0 — 재계획 모드는 일정을 새로 만들지 않는다.
   *
   * 왜 MSW 인가: 핵심 단언이 "apply 가 몇 번 나갔나·생성 POST 가 0 인가" 다. 훅을 목하면 그건 목의 가정이 된다.
   * 폴링 간격(2초)은 대개 실시간으로 기다린다. 2분 상한(RC1)과 "그 뒤로 더 안 묻는다"(RS)는 가짜 타이머 +
   * `advanceTimersByTimeAsync` 를 `act` 안에서 흘린다 — 동기 `advanceTimersByTime` 은 MSW 응답(약속)을 못 풀어
   * 엉킨다(SlotCandidatePanelContainer 통합 선례).
   *
   * 3동작: 준비 = 가짜 서버(시작·세션 차례·apply) → 실행 = replan 으로 화면을 연다(필요하면 버튼) → 단언 = 본문·요청 수·이동·얼굴.
   */

  const TRIP_ID = '55555555-5555-5555-5555-555555555555';
  const SESSION_ID = '66666666-6666-6666-6666-666666666666';
  const SESSION_ID_2 = '77777777-7777-7777-7777-777777777777';
  const NO_SOLUTION_TEXT =
    '지금 바꿀 수 있는 곳을 찾지 못했어요. 원래 일정을 그대로 둘게요.';

  /** openapi ReplanSession 모양 — 필수 필드만 채운다. */
  function replanSession(
    sessionId: string,
    status: ReplanSessionStatus
  ): ReplanSession {
    return {
      sessionId,
      tripId: TRIP_ID,
      itineraryId: 'itin-replan',
      scope: 'PARTIAL_SLOTS',
      targetDate: seoulDate(new Date()),
      fromInstant: '2026-10-14T03:00:00Z',
      originKind: 'LAST_VISIT',
      originEstimated: true,
      status,
      createdAt: '2026-10-14T03:00:00Z',
    };
  }

  /** 시작 POST 의 본문(파싱한 JSON) 누적. */
  let startBodies: unknown[] = [];
  /** 시작 POST 응답 차례. 비면 SESSION_ID 의 SOLVING 세션(201). */
  let startQueue: (() => Response)[] = [];
  /** 세션 GET 응답 — 세션 id·몇 번째 조회(0부터)로 케이스가 정한다. */
  let sessionScript: (sessionId: string, call: number) => ReplanSessionStatus;
  let sessionGets: Record<string, number> = {};
  /** 세션 GET 을 서버 오류(500)로 답할 차례인가 — 기본은 늘 정상. */
  let sessionFails: (sessionId: string, call: number) => boolean;
  /** apply 가 나간 세션 id(도착 순서). */
  let applied: string[] = [];
  /** apply 응답 — 기본은 200 APPLIED. 케이스가 409·500·붙잡기(약속)로 바꾼다. */
  let applyReply: (sessionId: string) => Response | Promise<Response>;
  let generatePosts = 0;

  /** openapi ErrorResponse 봉투. */
  const errorBody = (status: number, message = '잠시 후 다시 시도해 주세요.') =>
    HttpResponse.json(
      { error: { code: status === 409 ? 'CONFLICT' : 'INTERNAL', message } },
      { status }
    );
  /** 오늘(KST) — 다시 짠 날이 없을 때 추천안이 열 날. */
  const TODAY = seoulDate(new Date());

  beforeEach(() => {
    startBodies = [];
    startQueue = [];
    sessionGets = {};
    applied = [];
    generatePosts = 0;
    sessionScript = () => 'SOLVING';
    sessionFails = () => false;
    applyReply = (id) => HttpResponse.json(replanSession(id, 'APPLIED'));
    setAccessToken('valid-access');

    server.use(
      http.post(
        `${BASE}/trips/:tripId/replan-sessions`,
        async ({ request }) => {
          startBodies.push(await request.json());
          const next = startQueue.shift();
          return next
            ? next()
            : HttpResponse.json(replanSession(SESSION_ID, 'SOLVING'), {
                status: 201,
              });
        }
      ),
      http.get(
        `${BASE}/trips/:tripId/replan-sessions/:sessionId`,
        ({ params }) => {
          const id = String(params.sessionId);
          const call = sessionGets[id] ?? 0;
          sessionGets[id] = call + 1;
          if (sessionFails(id, call)) return errorBody(500);
          return HttpResponse.json(replanSession(id, sessionScript(id, call)));
        }
      ),
      http.post(
        `${BASE}/trips/:tripId/replan-sessions/:sessionId/apply`,
        ({ params }) => {
          applied.push(String(params.sessionId));
          return applyReply(String(params.sessionId));
        }
      ),
      // 생성 POST — 나가면 안 된다. 핸들러는 "나갔다"를 세기 위해 둔다.
      http.post(`${BASE}/trips/:tripId/itinerary`, () => {
        generatePosts += 1;
        return HttpResponse.json({}, { status: 500 });
      })
    );
  });

  afterEach(() => {
    // 가짜 타이머 케이스(RS·RC)가 다음 케이스로 새지 않게.
    jest.useRealTimers();
    server.resetHandlers();
    clearAccessToken();
  });

  function renderReplan(targetDate?: string) {
    const client = newTestQueryClient({ gcTime: 0 });
    // 토스트 호스트를 곁에 둔다 — ‹ 토스트(RB)를 "보였다"로 잰다(TRIP-990 하네스).
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <WithToastHost>{children}</WithToastHost>
        </QueryClientProvider>
      );
    }
    // mode 는 주지 않는다 — 재계획 주소에는 mode 가 없다(DraftPage·409 넘김이 `replan:'1'` 만 싣는다).
    return render(
      <GeneratingPage tripId={TRIP_ID} replan targetDate={targetDate} />,
      { wrapper: Wrapper }
    );
  }

  /** "안 나갔다"는 나갈 시간을 준 뒤에야 의미가 있다. */
  function settle(ms = 300): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 가짜 타이머 아래에서 시간을 흘리고 그 사이 약속(axios→MSW→TanStack)을 함께 푼다. */
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  const FAILED = 'itinerary-generating-failed';
  const RETRY = 'itinerary-generating-retry';
  const PROGRESS = 'itinerary-generating-progress';

  it('RP1 오늘(보던 날 없음)이면 PARTIAL_SLOTS·targetDate null 로 시작 POST 1회 · 진행 얼굴 · 생성 POST 0', async () => {
    renderReplan();

    await waitFor(() => expect(startBodies).toHaveLength(1));
    expect(startBodies[0]).toEqual({
      scope: 'PARTIAL_SLOTS',
      targetDate: null,
      originKind: null,
      reasons: ['JUST_CHANGE'],
      directives: [],
    });
    // 로딩 얼굴은 생성과 같은 화면(진행 바)이다 — 새 화면이 아니다.
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
    await settle();
    expect(startBodies).toHaveLength(1);
    expect(generatePosts).toBe(0);
  });

  it('RP1b 보던 날이 실려 오면 FULL_DAY·그 날로 시작한다', async () => {
    renderReplan('2026-10-20');

    await waitFor(() => expect(startBodies).toHaveLength(1));
    expect(startBodies[0]).toEqual({
      scope: 'FULL_DAY',
      targetDate: '2026-10-20',
      originKind: null,
      reasons: ['JUST_CHANGE'],
      directives: [],
    });
    await settle();
    expect(generatePosts).toBe(0);
  });

  it('RP2 SOLVING → DRAFT 가 되면 apply 가 정확히 1회 나가고 추천안(draft)으로 replace 한다', async () => {
    // 준비 — 첫 조회는 짜는 중, 다음 폴링에서 초안.
    sessionScript = (_id, call) => (call === 0 ? 'SOLVING' : 'DRAFT');

    renderReplan();

    // 단언 ① 짜는 중엔 반영하지 않는다(초안이 없다).
    await waitFor(() => expect(sessionGets[SESSION_ID]).toBe(1));
    expect(applied).toEqual([]);
    expect(mockReplace).not.toHaveBeenCalled();

    // 단언 ② 초안이 오면 확인 없이 바로 반영 → 추천안. 다시 짠 날(보던 날 없음 = 오늘)로 연다(W2).
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), {
      timeout: 6000,
    });
    expect(applied).toEqual([SESSION_ID]);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/draft',
      params: { tripId: TRIP_ID, day: TODAY },
    });

    // 단언 ③ 리렌더·폴링으로 apply 가 두 번 나가지 않는다.
    await settle();
    expect(applied).toEqual([SESSION_ID]);
    expect(generatePosts).toBe(0);
  }, 15_000);

  it('RP2b 보던 날을 다시 짰으면 추천안을 그 날로 연다 (W2)', async () => {
    sessionScript = () => 'DRAFT';

    renderReplan('2026-10-20');

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/draft',
      params: { tripId: TRIP_ID, day: '2026-10-20' },
    });
  });

  it('RP3 NO_SOLUTION 이면 원 일정 유지 안내 + [닫기](=홈) · apply 0', async () => {
    sessionScript = () => 'NO_SOLUTION';

    renderReplan();

    expect(await screen.findByText(NO_SOLUTION_TEXT)).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-generating-retry')).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-generating-refused-close'));
    expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)');
    await settle();
    expect(applied).toEqual([]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(generatePosts).toBe(0);
  });

  it('RP4 시작 POST 가 409 면 서버 사유 + [닫기] · 세션 조회·apply 0', async () => {
    const REASON = '지난 날은 다시 짤 수 없어요.';
    startQueue = [
      () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: REASON } },
          { status: 409 }
        ),
    ];

    renderReplan();

    expect(await screen.findByText(REASON)).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-generating-retry')).toBeNull();
    fireEvent.press(screen.getByTestId('itinerary-generating-refused-close'));
    expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)');

    await settle();
    expect(startBodies).toHaveLength(1);
    expect(sessionGets).toEqual({});
    expect(applied).toEqual([]);
    expect(generatePosts).toBe(0);
  });

  it('RP5 FAILED 면 실패 얼굴 → [다시 시도] 가 시작 POST 를 다시 하고, 새 세션이 초안이면 반영한다', async () => {
    // 준비 — 첫 세션은 실패, 재시작으로 연 두 번째 세션은 곧장 초안.
    startQueue = [
      () =>
        HttpResponse.json(replanSession(SESSION_ID, 'SOLVING'), {
          status: 201,
        }),
      () =>
        HttpResponse.json(replanSession(SESSION_ID_2, 'SOLVING'), {
          status: 201,
        }),
    ];
    sessionScript = (id) => (id === SESSION_ID ? 'FAILED' : 'DRAFT');

    renderReplan();

    // 단언 ① 침묵하지 않는다 — 실패 얼굴, 반영 0.
    fireEvent.press(await screen.findByTestId('itinerary-generating-retry'));

    // 단언 ② 다시 시도 = 처음부터 다시(새 세션) → 초안이면 그 세션만 반영.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), {
      timeout: 6000,
    });
    expect(startBodies).toHaveLength(2);
    expect(applied).toEqual([SESSION_ID_2]);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/draft',
      params: { tripId: TRIP_ID, day: TODAY },
    });
    expect(generatePosts).toBe(0);
  }, 15_000);

  describe('🔴 RF · 실패 얼굴로 가는 나머지 네 갈래 (#1235 사후 리뷰 B1 · INV-4)', () => {
    it('RF1 시작 POST 가 500(사유 없는 실패)이면 실패 얼굴 + [다시 시도] → 다시 시작해 진행 얼굴로 돌아온다', async () => {
      startQueue = [() => errorBody(500)];

      renderReplan();

      // 세션 id 를 못 받아 폴링이 시작조차 안 하는 갈래 — 진행 얼굴에 서면 침묵이다.
      expect(await screen.findByTestId(FAILED)).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-generating-refused')).toBeNull();
      expect(sessionGets).toEqual({});

      fireEvent.press(screen.getByTestId(RETRY));
      await waitFor(() => expect(sessionGets[SESSION_ID]).toBe(1));
      expect(startBodies).toHaveLength(2);
      expect(screen.queryByTestId(FAILED)).toBeNull();
      expect(screen.getByTestId(PROGRESS)).toBeOnTheScreen();
      expect(generatePosts).toBe(0);
    });

    it('RF2 짜는 중에 세션 조회가 오류(500)면 실패 얼굴이고 그 뒤로 더 묻지 않는다 — 남은 SOLVING 으로 진행 얼굴에 머물지 않는다 (W3 겸)', async () => {
      jest.useFakeTimers();
      sessionFails = (_id, call) => call === 1;

      renderReplan();
      await advance(3_000);
      expect(screen.getByTestId(FAILED)).toBeOnTheScreen();
      expect(sessionGets[SESSION_ID]).toBe(2);

      await advance(30_000);
      expect(sessionGets[SESSION_ID]).toBe(2);
      expect(applied).toEqual([]);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('RF3 세션이 CANCELED(다른 요청이 닫음)면 실패 얼굴이다', async () => {
      sessionScript = () => 'CANCELED';

      renderReplan();

      expect(await screen.findByTestId(FAILED)).toBeOnTheScreen();
      expect(applied).toEqual([]);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it.each([409, 500])(
      'RF4 자동 반영(apply)이 %i 면 실패 얼굴 + [다시 시도] · 추천안으로 가지 않는다',
      async (status) => {
        sessionScript = () => 'DRAFT';
        applyReply = () => errorBody(status, '그 사이 일정이 바뀌었어요.');

        renderReplan();

        // 세션은 DRAFT 라 폴링이 이미 멈췄다 — 이 얼굴이 아니면 진행 얼굴에 영원히 선다.
        expect(await screen.findByTestId(FAILED)).toBeOnTheScreen();
        expect(screen.getByTestId(RETRY)).toBeOnTheScreen();
        expect(applied).toEqual([SESSION_ID]);
        await settle();
        expect(mockReplace).not.toHaveBeenCalled();
      }
    );

    it('RF5 반영 실패 뒤 [다시 시도]면 새 세션이 짜는 동안 진행 얼굴이다 — 지난 반영 실패가 남지 않는다', async () => {
      startQueue = [
        () =>
          HttpResponse.json(replanSession(SESSION_ID, 'SOLVING'), {
            status: 201,
          }),
        () =>
          HttpResponse.json(replanSession(SESSION_ID_2, 'SOLVING'), {
            status: 201,
          }),
      ];
      sessionScript = (id) => (id === SESSION_ID ? 'DRAFT' : 'SOLVING');
      applyReply = (id) =>
        id === SESSION_ID
          ? errorBody(409, '그 사이 일정이 바뀌었어요.')
          : HttpResponse.json(replanSession(id, 'APPLIED'));

      renderReplan();
      fireEvent.press(await screen.findByTestId(RETRY));

      await waitFor(() => expect(sessionGets[SESSION_ID_2]).toBe(1));
      expect(screen.queryByTestId(FAILED)).toBeNull();
      expect(screen.getByTestId(PROGRESS)).toBeOnTheScreen();
      expect(applied).toEqual([SESSION_ID]);
    });
  });

  describe('🔴 RS · 폴링은 끝나면 멈춘다 (#1235 사후 리뷰 W3 — 가짜 타이머)', () => {
    it.each<ReplanSessionStatus>(['DRAFT', 'NO_SOLUTION', 'FAILED'])(
      'RS1 세션이 %s 로 끝나면 그 뒤로 세션을 더 묻지 않는다',
      async (terminal) => {
        jest.useFakeTimers();
        sessionScript = (_id, call) => (call === 0 ? 'SOLVING' : terminal);

        renderReplan();
        await advance(3_000);
        expect(sessionGets[SESSION_ID]).toBe(2);

        await advance(30_000);
        expect(sessionGets[SESSION_ID]).toBe(2);
      }
    );
    // 조회 오류 뒤 멈춤은 RF2 가 같이 본다.
  });

  describe('🔴 RC · 대기 상한 2분 (#1235 사후 리뷰 B2 · INV-4 — 가짜 타이머)', () => {
    // 재계획 AI 시한 25초 + 백엔드 여유. i12(PlanbSolvingPage)의 8분보다 짧다 — 생성 화면이라 기다리게 둘 수 없다.
    const CAP_MS = 2 * 60 * 1000;

    it('RC1 SOLVING 에 2분 머물면 폴링을 멈추고 실패 얼굴 + [다시 시도] — 직전까지는 진행 얼굴, [다시 시도]는 새 세션', async () => {
      jest.useFakeTimers();

      renderReplan();
      await advance(CAP_MS - 10_000);
      expect(screen.queryByTestId(FAILED)).toBeNull();
      expect(screen.getByTestId(PROGRESS)).toBeOnTheScreen();

      await advance(20_000);
      expect(screen.getByTestId(FAILED)).toBeOnTheScreen();
      const gets = sessionGets[SESSION_ID];
      await advance(60_000);
      expect(sessionGets[SESSION_ID]).toBe(gets);
      expect(applied).toEqual([]);
      expect(mockReplace).not.toHaveBeenCalled();

      // [다시 시도] = 처음부터 새 세션(열린 세션은 새 요청이 닫는다, INV-U4-06) — 상한도 새로 잰다.
      startQueue = [
        () =>
          HttpResponse.json(replanSession(SESSION_ID_2, 'SOLVING'), {
            status: 201,
          }),
      ];
      fireEvent.press(screen.getByTestId(RETRY));
      await advance(1_000);
      expect(startBodies).toHaveLength(2);
      expect(sessionGets[SESSION_ID_2]).toBe(1);
      expect(screen.queryByTestId(FAILED)).toBeNull();
      expect(screen.getByTestId(PROGRESS)).toBeOnTheScreen();
      expect(generatePosts).toBe(0);
    });

    // 화면이 잠기거나 앱을 바꾼 사이 서버가 이미 끝냈는데, 상한 순간 조회를 꺼서 실패 얼굴이 뜨던 것(#1248 리뷰 W-A).
    // 상한에 닿으면 실패로 판정하기 **전에 한 번 더** 묻는다 — 결과가 있으면 그대로 반영한다(바로 반영이 사용자 결정).
    it('RC2 앱이 뒤로 간 사이 서버가 끝났으면, 상한 순간의 마지막 확인으로 실패 얼굴 없이 반영 1회 → 추천안', async () => {
      jest.useFakeTimers();
      const t0 = Date.now();
      // 40초에 서버가 끝난다 — 그 전 조회는 SOLVING.
      sessionScript = () => (Date.now() - t0 >= 40_000 ? 'DRAFT' : 'SOLVING');

      renderReplan();
      await advance(10_000);
      // 앱이 뒤로 갔다 — 주기 조회가 선다(TanStack refetchInterval 은 포커스 없을 때 돌지 않는다, AppProviders 가 AppState 를 물린다).
      act(() => focusManager.setFocused(false));
      await advance(CAP_MS + 10_000);
      act(() => focusManager.setFocused(true));
      await advance(1_000);

      expect(applied).toEqual([SESSION_ID]);
      expect(screen.queryByTestId(FAILED)).toBeNull();
      expect(mockReplace).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: '/trips/[tripId]/itinerary/draft' })
      );
      act(() => focusManager.setFocused(undefined));
    });
  });

  describe('🔴 RB · ‹ 로 나가면 다시 짜기를 멈췄다고 말한다 (#1235 사후 리뷰 W5)', () => {
    const TOAST = 'itinerary-generating-replan-stopped-toast';

    afterEach(() => resetToast());

    it('RB1 짜는 중 ‹ → 홈으로 + "다시 짜기를 멈췄어요. 원래 일정을 그대로 둘게요." 토스트 · 반영 0', async () => {
      renderReplan();
      await waitFor(() => expect(sessionGets[SESSION_ID]).toBe(1));

      fireEvent.press(screen.getByTestId('itinerary-generating-back'));

      expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)');
      expect(screen.getByTestId(TOAST)).toHaveTextContent(
        '다시 짜기를 멈췄어요. 원래 일정을 그대로 둘게요.'
      );
      expect(applied).toEqual([]);
    });

    it('RB2 반영 요청이 이미 나간 뒤의 ‹ 엔 "원래 일정 그대로" 토스트를 띄우지 않는다 — 서버가 반영할 수 있다', async () => {
      sessionScript = () => 'DRAFT';
      // apply 응답을 붙잡아 둔다 — 요청은 나갔고 아직 답이 없다.
      applyReply = () => new Promise<Response>(() => undefined);

      renderReplan();
      await waitFor(() => expect(applied).toEqual([SESSION_ID]));

      fireEvent.press(screen.getByTestId('itinerary-generating-back'));

      expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)');
      expect(screen.queryByTestId(TOAST)).toBeNull();
    });
  });
});

// TRIP-1268 · AI 일정 생성 일일 한도 — 클라이언트 임시 장치(BE 일일 한도 + 429 처리 FE 칸이 배포되면 지운다).

/**
 * TRIP-1690 형식 검증 반례(verify-fv-polling R1·R1b·R3·R4) — 생성 POST 와 일정 GET 이 섞이는 순서.
 * 가짜 서버는 백엔드 규칙만 흉내 낸다: POST 를 받으면 세션을 새로 열고(A1), 1일차를 저장하면 행이 PARTIAL(A2).
 * 3동작: 준비 = 서버 행·지연 → 실행 = 생성 화면 렌더·이탈·연타·재마운트 → 단언 = 캐시·요청 수·주소 정리.
 */
describe('FV-POLL — 생성 POST 와 일정 조회 순서 (TRIP-1690)', () => {
  const OLD: Itinerary = baseItinerary({
    itineraryId: 'itin-old',
    generationState: 'COMPLETE',
    generationSessionId: null,
  });
  const partial = (session: string | null): Itinerary =>
    baseItinerary({
      itineraryId: 'itin-new',
      generationState: 'PARTIAL',
      generationSessionId: session,
    });
  let row: Itinerary;
  let running: string | null;
  let gets: number;
  let posts: number;
  let getDelay: (n: number) => number;
  let postReply: (n: number) => Promise<Response>;

  beforeEach(() => {
    row = OLD;
    running = null;
    gets = 0;
    posts = 0;
    getDelay = () => 0;
    postReply = async (n) => {
      await delay(50);
      row = partial(`sess-${n}`);
      return HttpResponse.json(row, { status: 201 });
    };
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        gets += 1;
        const snap = { ...row, generationSessionId: running };
        await delay(getDelay(gets));
        return HttpResponse.json(snap);
      }),
      http.post(`${BASE}/trips/:tripId/itinerary`, () => {
        posts += 1;
        running = `sess-${posts}`;
        return postReply(posts);
      })
    );
  });
  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  const sleep = (ms: number) =>
    act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const KEY = getGetTripsTripIdItineraryQueryKey(TRIP_ID);
  const holder: { refetch: (() => Promise<unknown>) | null } = {
    refetch: null,
  };
  /** 생성 화면 밑에 깔린 홈 탭의 일정 관찰자 — 포커스 복귀 재조회를 테스트가 직접 일으킨다. */
  function HomeObserver(): null {
    holder.refetch = useGetTripsTripIdItinerary(TRIP_ID).refetch;
    return null;
  }

  it('R1 POST 응답 전에 나간 늦은 GET 이 1일차(PARTIAL)를 예전 완성본으로 덮지 않는다', async () => {
    const client = newTestQueryClient({ staleTime: 30_000 });
    client.setQueryData(KEY, OLD);
    getDelay = (n) => (n === 1 ? 400 : 0);
    render(<HomeObserver />, { wrapper: createWrapper(client) });
    void act(() => void holder.refetch?.());
    await waitFor(() => expect(gets).toBe(1));

    const gen = render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />, {
      wrapper: createWrapper(client),
    });
    await waitFor(() =>
      expect(JSON.stringify(mockReplace.mock.calls)).toContain(
        '/itinerary/draft'
      )
    );
    gen.unmount();
    await sleep(500);

    expect(client.getQueryData<Itinerary>(KEY)?.itineraryId).toBe('itin-new');
    expect(client.getQueryData<Itinerary>(KEY)?.generationState).toBe(
      'PARTIAL'
    );
  }, 20000);

  it('R1b 화면을 떠난 뒤 POST 가 네트워크로 끊기면 일정을 다시 물어 서버의 새 1일차를 본다', async () => {
    const client = newTestQueryClient({ staleTime: 30_000 });
    client.setQueryData(KEY, OLD);
    let finishPost!: () => void;
    postReply = async () => {
      await new Promise<void>((resolve) => (finishPost = resolve));
      row = partial(running);
      return HttpResponse.error();
    };
    render(<HomeObserver />, { wrapper: createWrapper(client) });
    const gen = render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />, {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(posts).toBe(1));
    gen.unmount();
    expect(gets).toBe(0); // 앵커 — 캐시가 신선해 아무도 아직 안 묻는다

    await act(async () => finishPost());
    await waitFor(() => expect(gets).toBe(1));
    await waitFor(() =>
      expect(client.getQueryData<Itinerary>(KEY)?.itineraryId).toBe('itin-new')
    );
  }, 20000);

  it('R3 실패 얼굴 [다시 시도]를 다시 그려지기 전에 두 번 쳐도 POST 는 한 건만 더 나간다', async () => {
    postReply = async (n) =>
      n === 1
        ? HttpResponse.json({}, { status: 500 })
        : new Promise<Response>(() => undefined);
    render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />, {
      wrapper: createWrapper(newTestQueryClient()),
    });
    const retry = await screen.findByTestId('itinerary-generating-retry');
    act(() => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });
    await waitFor(() => expect(posts).toBe(2));
    await sleep(100);
    expect(posts).toBe(2);
  }, 20000);

  it('R4 생성을 쏜 뒤 주소에서 mode 를 지운다 — 새로고침하면 관찰 모드로 뜬다 · 주소가 바뀌어도 이 화면은 생성 화면 그대로다', async () => {
    postReply = () => new Promise<Response>(() => undefined);
    const view = render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />, {
      wrapper: createWrapper(newTestQueryClient()),
    });
    await waitFor(() => expect(posts).toBe(1));
    expect(mockSetParams).toHaveBeenCalledTimes(1);
    expect(mockSetParams).toHaveBeenCalledWith({ mode: undefined });

    // 주소 정리로 라우트가 mode 없이 다시 그린다 — 이 화면은 관찰 모드(GET)로 바뀌지 않는다.
    view.rerender(<GeneratingPage tripId={TRIP_ID} mode={undefined} />);
    await sleep(100);
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
    expect(gets).toBe(0);
    expect(posts).toBe(1);
  }, 20000);
});
