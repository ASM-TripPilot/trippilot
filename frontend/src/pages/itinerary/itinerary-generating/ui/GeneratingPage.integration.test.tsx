import type { ReactNode, ReactElement } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
  within,
} from '@testing-library/react-native';
import { Text } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { server } from '@/mocks/server';
import type * as TripsModule from '@/shared/api/generated/trips/trips';
import { useGetTripsTripIdItinerary } from '@/shared/api/index.hooks';
import type {
  GenerateItineraryRequestGenerationMode,
  GenerationSession,
  Itinerary,
  MustVisit,
  Place,
  SavedPlace,
  ItineraryGenerationState,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resolveItineraryDestination } from '@/features/itinerary';
import { isNotFound } from '@/shared/api';
import { seoulDate } from '@/shared/lib/seoulDate';
import * as ToastModule from '@/shared/ui/Toast';
import { resetToast } from '@/test-support/toastHarness';

import { GeneratingPage } from './GeneratingPage';

/**
 * h09 생성 중 — **실 훅 + MSW** 관점 통합 테스트(TRIP-1150 에서 네 파일을 한 파일로 합쳤다).
 *
 * 옛 파일 하나 = 바깥 describe 하나다. 안쪽 describe·it 이름과 각 파일의 픽스처·기본 핸들러(describe 의
 * beforeEach)는 그대로다. 생성 훅을 통째로 목으로 바꾼 관점은 node 버킷 `GeneratingPage.hookMock.test.tsx`.
 *  - 다른 여행 생성 중(409) 안내 — 옛 `.busy`
 *  - 생성 성공이 홈의 일정 캐시에 닿는다 — 옛 `.homeCache`
 *  - 꼭 갈 곳 지도 — 옛 `.map`(생성 POST 만 진행 중 스텁 — 아래 `mockStubPost` 스위치)
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
// TRIP-1268: 이 배럴은 한도 카운터 저장소(`readStringValue`·`writeStringValue`)도 내보낸다. 토큰 4함수만
// 돌려주면 두 함수가 undefined 로 지워진다(호출이 reject 로 삼켜져 fail-open 으로 공허 통과) → 실물을 펼친 뒤
// 덮고, 두 함수는 메모리 Map(`mockVault`)에 읽고 쓴다(02a ★7).
// 재호출 1(03b 차단-1): `mockRealStringStore` 를 켠 케이스만 두 함수가 **실물 래퍼**로 가고, 그 아래
// `expo-secure-store` 는 아래 키 규칙 대역에 닿는다(Map 은 키를 안 봐서 운영 키 거부를 원리적으로 못 본다).
const mockVault = new Map<string, string>();
const mockReadStringValue = jest.fn();
const mockWriteStringValue = jest.fn();
let mockRealStringStore = false;
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
    readStringValue: (key: string) =>
      mockRealStringStore
        ? actual.readStringValue(key)
        : mockReadStringValue(key),
    writeStringValue: (key: string, value: string) =>
      mockRealStringStore
        ? actual.writeStringValue(key, value)
        : mockWriteStringValue(key, value),
  };
});

// 키 규칙 대역(TRIP-1268 재호출 1) — 키 검사는 **라이브러리 실물**(`getItemAsync`·`setItemAsync` 첫 줄의
// `ensureValidKey`, 규칙 밖이면 reject)에 맡기고, 통과한 값만 메모리(`mockSecureVault`)에 남긴다. 규칙을
// 손으로 옮겨 적지 않아 라이브러리가 바뀌면 같이 따라간다. jest 의 네이티브 폴백은 값을 기억하지 않는다(02a §5).
const mockSecureVault = new Map<string, string>();
jest.mock('expo-secure-store', () => {
  const actual = jest.requireActual('expo-secure-store');
  return {
    ...actual,
    getItemAsync: async (key: string) => {
      await actual.getItemAsync(key);
      return mockSecureVault.get(key) ?? null;
    },
    setItemAsync: async (key: string, value: string) => {
      await actual.setItemAsync(key, value);
      mockSecureVault.set(key, value);
    },
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
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    dismissTo: mockDismissTo,
    back: mockBack,
    navigate: jest.fn(),
  }),
}));

// 생성 POST 스위치(TRIP-1150 합치기) — 옛 `.map` 만 trips 를 부분 목했다(조회 훅은 실물, 생성 POST 만
// 진행 중 스텁). `jest.mock` 은 파일 전체에 걸리므로 목 훅이 **불리는 순간** 이 값을 읽어, 꺼져 있으면
// 실물 훅으로 넘긴다. 최상위 beforeEach 가 끄고 지도 describe 의 beforeEach 만 켠다.
let mockStubPost = false;
const mockMutate = jest.fn();
// 스텁은 **호출마다 새 객체**를 준다 — 실 useMutation 도 렌더마다 새 객체라, 이래야 `firedRef` 없이는
// 재렌더마다 effect 가 다시 돌아 POST 가 또 나간다(옛 `.map` M6 이 재는 것).
jest.mock('@/shared/api/generated/trips/trips', () => {
  const actual = jest.requireActual<typeof TripsModule>(
    '@/shared/api/generated/trips/trips'
  );
  return {
    ...actual,
    usePostTripsTripIdItinerary: (
      ...args: Parameters<typeof actual.usePostTripsTripIdItinerary>
    ) =>
      mockStubPost
        ? { mutate: mockMutate, isPending: true, isError: false }
        : actual.usePostTripsTripIdItinerary(...args),
  };
});

// 지도를 관찰 마커로 바꾼다 — 중심 좌표는 `map-root` 텍스트, 나머지 prop 은 그대로 통과한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

/** TRIP-1268 — 파일 공용 API 주소(각 describe 의 `BASE` 와 같은 값, 이름 겹침을 피해 따로 둔다). */
const API_BASE = 'http://localhost:8080/api/v1';
/** 생성 화면이 계정 id 를 묻는 `GET /me` 가 서버에 닿은 횟수(TRIP-1268). */
let meHits = 0;

beforeEach(() => {
  mockStubPost = false;
  mockMutate.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockDismissTo.mockClear();
  mockBack.mockClear();
  // TRIP-1268: 한도 카운터 저장소는 매 케이스 빈 Map 에서 시작한다(실물 래퍼 스위치는 끈 채로).
  mockRealStringStore = false;
  mockSecureVault.clear();
  mockVault.clear();
  mockReadStringValue
    .mockReset()
    .mockImplementation(async (key: string) => mockVault.get(key) ?? null);
  mockWriteStringValue
    .mockReset()
    .mockImplementation(async (key: string, value: string) => {
      mockVault.set(key, value);
    });
  // TRIP-1268: 생성 POST 전에 `GET /me` 로 계정 id 를 읽는다. 이 파일은 `onUnhandledRequest: 'error'` 이고 기본
  // 핸들러에 /me 가 없어, 모든 describe 가 쓰도록 여기서 건다. 각 describe 의 afterEach 가 resetHandlers 로
  // 지우므로 매 케이스 다시 건다(02a ★8). 케이스가 server.use 로 덮으면 그쪽이 이긴다.
  meHits = 0;
  server.use(
    http.get(`${API_BASE}/me`, () => {
      meHits += 1;
      return HttpResponse.json({ accountId: 'acc-a', status: 'ACTIVE' });
    })
  );
});

// 토스트는 모듈 싱글턴이다 — 진행 중에 화면이 빠지는 케이스(홈 캐시 H1 · 한도 A15+)가 띄운 토스트·타이머가
// 다음 케이스로 새지 않게 최상위에서 비운다(TRIP-1268, 02a ★12).
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
      http.get(`${BASE}/trips/:tripId/must-visits`, () =>
        HttpResponse.json([])
      ),
      http.get(`${BASE}/saved-places`, () => HttpResponse.json([]))
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

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '55555555-5555-5555-5555-555555555555';

  /** 생성 응답(201) = 1일차가 도착한 일정(PARTIAL). openapi `Itinerary` 필수 필드를 채운다. */
  function generatedItinerary(): Itinerary {
    return {
      itineraryId: 'itin-home-cache',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'PARTIAL',
      isFallback: false,
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
    };
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
      }),
      http.get(`${BASE}/trips/:tripId/must-visits`, () =>
        HttpResponse.json([])
      ),
      http.get(`${BASE}/saved-places`, () => HttpResponse.json([]))
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
    return render(<Host showGenerating />, { wrapper: Wrapper });
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

// TRIP-929 · 옛 GeneratingPage.map.integration.test.tsx — 생성 POST 만 진행 중 스텁(mockStubPost).
describe('꼭 갈 곳 지도', () => {
  /**
   * TRIP-929 · h07 생성 중 지도에 **실 좌표**가 흐르는지를 실 HTTP 로 태우는 심판.
   *
   * 무엇을 보장하나:
   *  - 꼭 갈 곳(`GET /trips/{id}/must-visits`)과 담은 장소(`GET /saved-places`)를 이어 번호 핀을
   *    만들고, 첫 핀 좌표를 지도 중심으로 넘긴다(M1). 연결선은 그리지 않는다(M2, INV-2).
   *  - 좌표가 하나도 없으면 지도 카드를 통째로 생략한다(M3~M5, INV-4). `[]` 는 JS 에서 참이라
   *    `pins && center` 게이트를 막는 것은 `center` 뿐이다 — M5 가 그 급소.
   *  - 조회 도착으로 페이지가 다시 그려져도 생성 POST 는 1회다(M6, `firedRef` 의 첫 심판).
   *  - 조회가 실패하면 지도만 빠지고 생성 실패 표면은 뜨지 않는다(M7, Seed Q2).
   *  - CO_PLAN 갈래도 같은 지도를 보인다(M8, Seed Q3).
   *
   * 왜 통합 버킷인가: 지도가 뜨는지는 **어떤 요청이 나갔고 무엇이 돌아왔나**에 달려 있다. 조회 훅을
   * 목킹하면 "미로그인이면 saved-places 가 안 나간다"가 테스트의 가정이 된다. 생성 POST 만 기존
   * 파일처럼 훅 목으로 둔다(진행 중 상태를 붙들어 두려고).
   *
   * 3동작 뼈대: 준비 = 가짜 서버 응답·로그인 상태 → 실행 = 페이지 렌더 후 조회가 끝날 때까지 대기
   * (`settle`) → 단언 = 지도 카드·좌표·핀·나간 요청·POST 횟수.
   */

  /** `authWiring.integration.test.ts:59` 와 같은 값(리포 관례). */
  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '22222222-2222-2222-2222-222222222222';

  /** 첫 핀(A)과 둘째 핀(B)의 좌표는 서로 다르고 둘의 평균(35.12935,129.1802)과도 다르다 —
   * 중심이 "첫 핀"이 아니면 텍스트 완전 일치에서 갈린다. */
  const A = { poiId: 'poi-a', lat: 35.1587, lng: 129.1604 };
  const B = { poiId: 'poi-b', lat: 35.1, lng: 129.2 };
  const A_CENTER_TEXT = '35.1587,129.1604';

  function savedPlace(spot: { poiId: string; lat: number; lng: number }) {
    const place: Place = {
      poiId: spot.poiId,
      nameKo: `장소-${spot.poiId}`,
      category: '명소',
      lat: spot.lat,
      lng: spot.lng,
      region: '부산진구',
      openingHours: null,
      imageUrl: null,
      tags: [],
      savedCount: 0,
      dataStatus: 'ACTIVE',
    };
    const entry: SavedPlace = {
      savedPlaceId: `sp-${spot.poiId}`,
      savedAt: '2026-09-01T10:00:00.000Z',
      place,
    };
    return entry;
  }

  function mustVisit(sourcePoiId: string): MustVisit {
    return {
      mustVisitId: `mv-${sourcePoiId}`,
      poiSnapshotId: `snap-${sourcePoiId}`,
      sourcePoiId,
      type: 'ANYTIME',
    };
  }

  /** 나간 요청의 `METHOD /경로` 누적. */
  let observedHits: string[] = [];

  function hitsFor(method: string, includes: string): number {
    return observedHits.filter(
      (hit) => hit.startsWith(method) && hit.includes(includes)
    ).length;
  }

  /** 가짜 서버 응답을 건다. 통합 버킷은 `onUnhandledRequest: 'error'` 라 두 GET 을 매번 명시한다. */
  function serve(input: {
    mustVisits: MustVisit[] | { status: number };
    savedPlaces: SavedPlace[] | { status: number };
  }) {
    server.use(
      http.get(`${BASE}/trips/:tripId/must-visits`, () =>
        Array.isArray(input.mustVisits)
          ? HttpResponse.json(input.mustVisits)
          : HttpResponse.json({}, { status: input.mustVisits.status })
      ),
      http.get(`${BASE}/saved-places`, () =>
        Array.isArray(input.savedPlaces)
          ? HttpResponse.json(input.savedPlaces)
          : HttpResponse.json({}, { status: input.savedPlaces.status })
      )
    );
  }

  beforeAll(() => {
    server.events.on('request:start', ({ request }) => {
      observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
    });
  });

  beforeEach(() => {
    mockStubPost = true;
    observedHits = [];
    mockMutate.mockClear();
    setAccessToken('valid-access');
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /**
   * `retry: false` — 실패를 즉시 실패로 본다(재시도가 돌면 M7 이 흔들린다).
   * `gcTime: 0` — 기본 타이머가 테스트 뒤까지 살아 프로세스를 붙잡지 않게.
   * 클라이언트를 돌려주는 이유: `settle` 이 "조회가 전부 끝났나"를 여기서 읽는다.
   */
  function renderPage(props?: {
    mode?: GenerateItineraryRequestGenerationMode;
    successRoute?: '/trips/[tripId]/itinerary/copick/[slotKey]';
  }) {
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
    // TRIP-1006: mode 가 없으면 관찰 모드(POST 0·일정 GET)라 이 파일의 POST 경로 단언이 성립하지 않는다 —
    // 완전 AI 를 명시하고, 케이스가 준 mode(CO_PLAN)가 덮어쓴다.
    render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" {...props} />, {
      wrapper: Wrapper,
    });
    return client;
  }

  /**
   * 조회가 끝나 **화면까지 도착할 때까지** 기다린다. 첫 렌더엔 조회가 아직 안 끝나 지도가 원래
   * 없으므로, 이 대기 없이 "지도 없음"을 단언하면 무엇을 구현해도 통과한다.
   *  ① must-visits 요청이 실제로 나갔다 → ② 진행 중인 조회가 0개 → ③ react-query 가 화면에 알리는
   *  예약(setTimeout 0) 한 틱을 흘린다.
   * 이 대기가 충분하다는 것은 M1·M6·M8 이 대기 직후 **기다림 없는** `getByTestId` 로 지도를 찾는
   * 것으로 매번 증명된다.
   */
  async function settle(client: QueryClient) {
    await waitFor(() =>
      expect(hitsFor('GET', '/must-visits')).toBeGreaterThanOrEqual(1)
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  describe('M1 · AC-1 — 꼭 갈 곳 좌표가 있으면 지도가 뜨고 중심은 첫 핀이다', () => {
    it('지도 카드가 있고, 중심은 첫 핀(A) 좌표, 핀은 [①A, ②B] 다', async () => {
      serve({
        mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
        savedPlaces: [savedPlace(A), savedPlace(B)],
      });
      const client = renderPage();

      await settle(client);

      expect(screen.getByTestId('itinerary-generating-map')).toBeOnTheScreen();
      const map = screen.getByTestId('map-root');
      // 완전 일치 — B 좌표·평균 좌표면 red.
      expect(map).toHaveTextContent(A_CENTER_TEXT);
      expect(map.props.pins).toEqual([
        { number: 1, lat: A.lat, lng: A.lng },
        { number: 2, lat: B.lat, lng: B.lng },
      ]);
    });
  });

  describe('M9 · AC-1 — 첫 꼭 갈 곳에 좌표가 없어도 지도는 뜨고, 핀 번호는 당기지 않는다', () => {
    it('꼭 갈 곳 [Z, A]·담은 장소 [A] 면 중심은 A, 핀은 [②A] 하나다', async () => {
      // Z 는 담기를 해제한 곳 — 좌표가 없다. 중심을 "첫 꼭 갈 곳"에서 찾으면 지도가 사라지고,
      // 핀을 1..n 으로 다시 매기면 ②가 ①이 되어 h05 목록 번호와 어긋난다.
      serve({
        mustVisits: [mustVisit('poi-z'), mustVisit(A.poiId)],
        savedPlaces: [savedPlace(A)],
      });
      const client = renderPage();

      await settle(client);

      expect(screen.getByTestId('itinerary-generating-map')).toBeOnTheScreen();
      const map = screen.getByTestId('map-root');
      expect(map).toHaveTextContent(A_CENTER_TEXT);
      expect(map.props.pins).toEqual([{ number: 2, lat: A.lat, lng: A.lng }]);
    });
  });

  describe('M2 · AC-3 — 생성 중 지도는 핀 사이 연결선을 그리지 않는다 (INV-2)', () => {
    it('페이지를 거쳐 그린 지도의 connectPins 가 false 다', async () => {
      serve({
        mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
        savedPlaces: [savedPlace(A), savedPlace(B)],
      });
      const client = renderPage();

      await settle(client);

      expect(screen.getByTestId('map-root').props.connectPins).toBe(false);
    });
  });

  describe('M3~M5 · AC-2 — 좌표가 없으면 지도 카드를 통째로 생략한다 (INV-4)', () => {
    it('M3 (a) 담은 꼭 갈 곳이 0곳이면 — 담은 장소가 있어도 — 지도가 없고 진행 표면은 있다', async () => {
      // 담은 장소 A·B 를 일부러 둔다: 꼭 갈 곳 대신 담은 장소 전부를 핀으로 쓰면 지도가 떠서 red.
      serve({ mustVisits: [], savedPlaces: [savedPlace(A), savedPlace(B)] });
      const client = renderPage();

      await settle(client);

      expect(screen.queryByTestId('itinerary-generating-map')).toBeNull();
      expect(screen.queryByTestId('map-root')).toBeNull();
      expect(
        screen.getByTestId('itinerary-generating-progress')
      ).toBeOnTheScreen();
    });

    it('M4 (b) 미로그인이면 saved-places 요청이 0건이고 지도가 없으며 진행 표면은 있다 (BR-U1-03)', async () => {
      clearAccessToken();
      // 핸들러를 걸어 둬야 "0건"이 공허하지 않다 — 나갔다면 로그에 잡힌다.
      serve({
        mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
        savedPlaces: [savedPlace(A), savedPlace(B)],
      });
      const client = renderPage();

      await settle(client);

      expect(hitsFor('GET', '/saved-places')).toBe(0);
      expect(screen.queryByTestId('itinerary-generating-map')).toBeNull();
      expect(screen.queryByTestId('map-root')).toBeNull();
      expect(
        screen.getByTestId('itinerary-generating-progress')
      ).toBeOnTheScreen();
    });

    it('M5 (c) 꼭 갈 곳은 있지만 담은 장소에 짝이 없으면(핀 0개) 지도가 없고 진행 표면은 있다', async () => {
      // Z 는 담기를 해제한 곳 — saved-places 에 없어 좌표가 없다. 핀은 [] 가 되는데 [] 는 참이라,
      // 이때 중심에 폴백 좌표를 넣으면 빈 지도가 뜬다(급소).
      serve({
        mustVisits: [mustVisit('poi-z')],
        savedPlaces: [savedPlace(A), savedPlace(B)],
      });
      const client = renderPage();

      await settle(client);

      expect(screen.queryByTestId('itinerary-generating-map')).toBeNull();
      expect(screen.queryByTestId('map-root')).toBeNull();
      expect(
        screen.getByTestId('itinerary-generating-progress')
      ).toBeOnTheScreen();
    });
  });

  describe('M6 · AC-5 — 조회 도착으로 다시 그려져도 생성 POST 는 1회다', () => {
    it('지도가 뜬 뒤(=재렌더가 일어난 뒤)에도 POST 는 1회이고 body 는 generationMode 하나뿐이다', async () => {
      serve({
        mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
        savedPlaces: [savedPlace(A), savedPlace(B)],
      });
      const client = renderPage();

      await settle(client);

      // 지도가 있다 = 조회 결과가 도착해 페이지가 최소 한 번 다시 그려졌다(재렌더의 증거).
      expect(screen.getByTestId('itinerary-generating-map')).toBeOnTheScreen();
      // TRIP-1268: POST 는 계정 조회(순수 fetcher — `client.isFetching()` 이 모른다) 뒤에 나간다. 1회가 될 때까지
      // 기다리고, 시간을 더 줘도 1회 그대로인지 본다(02a ★9).
      await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(mockMutate).toHaveBeenCalledTimes(1);
      // 좌표 조회가 붙어도 POST body 에 새 키가 붙지 않는다(BR-U3-03, 정확 일치).
      const vars = mockMutate.mock.calls[0][0] as { data?: unknown };
      expect(vars.data).toEqual({ generationMode: 'FULLY_AI' });
    });
  });

  describe('M7 · Seed Q2 — 좌표 조회가 실패하면 지도만 빠지고 생성 실패 표면은 뜨지 않는다', () => {
    it.each([
      {
        label: 'must-visits 500',
        mustVisits: { status: 500 },
        savedPlaces: [savedPlace(A), savedPlace(B)],
      },
      {
        label: 'saved-places 500',
        mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
        savedPlaces: { status: 500 },
      },
    ])(
      '$label — 지도 없음, 실패 표면 없음, 진행 표면 있음',
      async ({ mustVisits, savedPlaces }) => {
        serve({ mustVisits, savedPlaces });
        const client = renderPage();

        await settle(client);

        expect(screen.queryByTestId('itinerary-generating-map')).toBeNull();
        // 생성 POST 는 아직 진행 중이다 — "일정을 만들지 못했어요"가 뜨면 거짓 실패.
        expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
        expect(
          screen.getByTestId('itinerary-generating-progress')
        ).toBeOnTheScreen();
      }
    );
  });

  describe('M8 · Seed Q3 — CO_PLAN 갈래도 같은 지도를 보인다', () => {
    it('mode=CO_PLAN 이어도 지도 카드가 있고 중심은 첫 핀(A) 좌표다', async () => {
      serve({
        mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
        savedPlaces: [savedPlace(A), savedPlace(B)],
      });
      const client = renderPage({
        mode: 'CO_PLAN',
        successRoute: '/trips/[tripId]/itinerary/copick/[slotKey]',
      });

      await settle(client);

      expect(screen.getByTestId('itinerary-generating-map')).toBeOnTheScreen();
      expect(screen.getByTestId('map-root')).toHaveTextContent(A_CENTER_TEXT);
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

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '44444444-4444-4444-4444-444444444444';

  function itinerary(generationState: ItineraryGenerationState): Itinerary {
    return {
      itineraryId: 'itin-observe',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState,
      isFallback: false,
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
    };
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

    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () => {
        getCalls += 1;
        return itineraryHandler();
      }),
      // 생성 POST — 나가면 안 된다. 핸들러를 두는 이유는 "나갔다"를 세기 위해서다(없으면 요청이
      // 미처리 오류로 사라져 수를 못 센다).
      http.post(`${BASE}/trips/:tripId/itinerary`, () => {
        postCalls += 1;
        return HttpResponse.json(itinerary('PARTIAL'), { status: 201 });
      }),
      http.get(`${BASE}/trips/:tripId/must-visits`, () =>
        HttpResponse.json([])
      ),
      http.get(`${BASE}/saved-places`, () => HttpResponse.json([]))
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderObserver() {
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
    // mode 를 **주지 않는다** — 이것이 관찰 모드의 신호다.
    return render(<GeneratingPage tripId={TRIP_ID} />, { wrapper: Wrapper });
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

// TRIP-1268 · AI 일정 생성 일일 한도 — 클라이언트 임시 장치(BE 일일 한도 + 429 처리 FE 칸이 배포되면 지운다).
describe('AI 일일 한도 — 생성 화면 배선', () => {
  /**
   * 계정당 하루(KST) AI 생성(FULLY_AI·CO_PLAN) **성공 5번**까지만 POST 를 보낸다. 6번째는 POST 를 아예 쏘지 않고
   * 한도 얼굴(`ai-limit-notice`)을 띄운다. 계정 id 는 `GET /me`, 횟수는 SecureStore 문자열(`aiGenUsage.{계정}`).
   *
   * 무엇을 보장하나:
   *  - 🔴 A1·A2 4회면 POST 가 나가고 성공 뒤 5회, 5회면 POST 0·한도 얼굴(두 AI 모드 모두 — AC-7·8).
   *  - 🔴 A3·A4 [직접 짜기 이어가기] = 편집기로 replace(`fresh` 없음), [닫기] = 홈(AC-9).
   *  - 🔴 A5·A6 실패(409·500·네트워크)는 세지 않고, 409 뒤 재전송이 성공하면 정확히 1번만 센다(AC-10·11).
   *  - 🔴 A7 생성 중 화면을 떠난 뒤 성공해도 센다 — 증가는 훅 옵션 onSuccess 자리여야 한다(AC-12).
   *  - 🟢 A8·A9 직접 짜기(MANUAL)·관찰 모드는 막지도 세지도 않는다(AC-13①·14).
   *  - 🔴 A10~A13 계정끼리 안 섞이고, 계정을 모르거나 저장소가 고장 나도 생성은 막히지 않는다(AC-15·16·6).
   *  - 🔴 A14 이전 POST 실패가 남아 있어도 한도 얼굴이 이긴다(AC-17). A15 한도 얼굴에서 떠나면 토스트 0(AC-18).
   *  - 🔴 A16·A17 `/me` 응답 전엔 POST 를 보류하고 진행 얼굴을 유지하며, 도착 뒤 한 번만 판정한다(AC-20·21).
   *  - 🔴 A18 실물 저장 래퍼 + 키 규칙 SecureStore 로도 5번 성공 뒤 6번째가 막힌다(AC-22, 재호출 1).
   *  - 🔴 A19·A20 계정 조회 중 [다시 시도]·[취소하고 새로 만들기]를 또 눌러도 POST 는 1번, 기록도 +1(AC-23).
   *
   * 왜 MSW 인가: "POST 0건"을 가짜 서버가 직접 센다 — 훅을 목하면 구현이 다른 경로로 쏘는 순간 0회가 공허해진다.
   * 저장소는 메모리 Map(`mockVault`, 파일 머리 목)이고 "오늘"은 페이지와 같은 `seoulDate(new Date())` 로 만든다.
   *
   * *(개념)* "안 나갔다"는 나갈 시간을 준 뒤에야 의미가 있다 — `settle()` 이 실제 시간 300ms 를 흘린 뒤 센다.
   * 반대로 "언젠가 된다"는 `waitFor` 로 기다린다.
   *
   * 3동작: 준비 = 저장소에 오늘 횟수 심기·가짜 서버 응답 차례 → 실행 = 화면 열기·버튼 누르기·떠나기 →
   * 단언 = 나간 POST 수·보이는 얼굴·이동·저장된 횟수.
   */
  const BASE = API_BASE;
  const TRIP_ID = '66666666-6666-6666-6666-666666666666';
  const ACTIVE_TRIP_ID = '77777777-7777-7777-7777-777777777777';
  const SESSION_ID = '88888888-8888-8888-8888-888888888888';
  const KEY_A = 'aiGenUsage.acc-a';
  const KEY_B = 'aiGenUsage.acc-b';
  const TITLE = '오늘 AI 일정 만들기 5번을 모두 썼어요';
  const COPICK_SLOT_ROUTE =
    '/trips/[tripId]/itinerary/copick/[slotKey]' as const;
  const MODES = [
    { mode: 'FULLY_AI' as const, successRoute: undefined },
    { mode: 'CO_PLAN' as const, successRoute: COPICK_SLOT_ROUTE },
  ];

  function itinerary(
    tripId: string,
    generationSessionId: string | null = null
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

  const created = (): Response =>
    HttpResponse.json(itinerary(TRIP_ID), { status: 201 });
  /** 409 GENERATION_IN_PROGRESS — openapi ErrorResponse 봉투(activeTripId 는 이 code 에만 실린다). */
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
  const serverError = (): Response =>
    HttpResponse.json(
      { error: { code: 'INTERNAL', message: 'boom' } },
      { status: 500 }
    );
  const networkError = (): Response => HttpResponse.error();

  /** 생성 POST 가 서버에 닿은 횟수 · 응답 차례(비면 201) · 손으로 풀기 전까지 매달아 둘지. */
  let postCalls = 0;
  let postQueue: (() => Response)[] = [];
  let holdPost = false;
  let releasePost: () => void = () => {};
  let releaseMe: () => void = () => {};

  beforeEach(() => {
    postCalls = 0;
    postQueue = [];
    holdPost = false;
    releasePost = () => {};
    releaseMe = () => {};
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/trips/:tripId/itinerary`, async () => {
        postCalls += 1;
        if (holdPost) {
          await new Promise<void>((resolve) => {
            releasePost = resolve;
          });
        }
        return (postQueue.shift() ?? created)();
      }),
      // 생성 화면 자기 여행은 404(관찰 모드면 method 로 간다), 409 취소 대상(다른 여행)은 세션이 도는 일정.
      http.get(`${BASE}/trips/:tripId/itinerary`, ({ params }) =>
        params.tripId === ACTIVE_TRIP_ID
          ? HttpResponse.json(itinerary(ACTIVE_TRIP_ID, SESSION_ID))
          : HttpResponse.json({}, { status: 404 })
      ),
      http.post(
        `${BASE}/trips/:tripId/generation-sessions/:sessionId/cancel`,
        () =>
          HttpResponse.json({
            sessionId: SESSION_ID,
            status: 'CANCELED',
            mode: 'FULLY_AI',
            isFallback: false,
            startedAt: '2026-10-07T01:00:00.000Z',
            finishedAt: '2026-10-07T01:03:00.000Z',
          } satisfies GenerationSession)
      ),
      http.get(`${BASE}/trips/:tripId/must-visits`, () =>
        HttpResponse.json([])
      ),
      http.get(`${BASE}/saved-places`, () => HttpResponse.json([]))
    );
  });

  afterEach(() => {
    // 매달린 요청을 풀어 다음 케이스로 새지 않게 한다.
    releasePost();
    releaseMe();
    server.resetHandlers();
    clearAccessToken();
  });

  /** 페이지와 같은 기준의 "오늘"(KST). */
  const today = (): string => seoulDate(new Date());

  /** 저장소에 오늘 n회를 심고, 심은 원문을 돌려준다("그대로다" 비교용). */
  function seed(key: string, n: number): string {
    const raw = JSON.stringify({ d: today(), n });
    mockVault.set(key, raw);
    return raw;
  }

  /** 저장된 값을 객체로 편다 — 키 순서를 강요하지 않으려고. */
  function stored(key: string): unknown {
    const raw = mockVault.get(key);
    return raw === undefined ? undefined : JSON.parse(raw);
  }

  /** `/me` 를 손으로 풀기 전까지 매달아 둔다("계정 조회 중" 재현). */
  function holdMe(): void {
    server.use(
      http.get(`${BASE}/me`, async () => {
        meHits += 1;
        await new Promise<void>((resolve) => {
          releaseMe = resolve;
        });
        return HttpResponse.json({ accountId: 'acc-a', status: 'ACTIVE' });
      })
    );
  }

  function answerMe(respond: () => Response): void {
    server.use(
      http.get(`${BASE}/me`, () => {
        meHits += 1;
        return respond();
      })
    );
  }

  function newClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
  }

  /** `mode: null` = 관찰 모드(mode 없이 연다). 생략하면 완전 AI. */
  function renderPage(
    options: {
      mode?: GenerateItineraryRequestGenerationMode | null;
      successRoute?: typeof COPICK_SLOT_ROUTE;
    } = {}
  ) {
    const client = newClient();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    const mode =
      options.mode === null ? undefined : (options.mode ?? 'FULLY_AI');
    return render(
      <GeneratingPage
        tripId={TRIP_ID}
        mode={mode}
        successRoute={options.successRoute}
      />,
      { wrapper: Wrapper }
    );
  }

  /** "안 나갔다"는 나갈 시간을 준 뒤에야 의미가 있다. */
  async function settle(ms = 300): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  function expectNoLeave(): void {
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  }

  describe('🔴 A1·A2 · AC-7·AC-8 — 4회면 나가고 5회째가 기록되며, 5회면 POST 0 + 한도 얼굴', () => {
    it.each(MODES)(
      'A1 $mode — 오늘 4회면 POST 가 1번 나가고, 성공 뒤 오늘 5회가 된다',
      async ({ mode, successRoute }) => {
        // 준비
        seed(KEY_A, 4);

        // 실행
        renderPage({ mode, successRoute });

        // 단언 — 성공해서 넘어갔고, 그 성공이 정확히 1번 세졌다.
        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
        await waitFor(() =>
          expect(stored(KEY_A)).toEqual({ d: today(), n: 5 })
        );
        expect(postCalls).toBe(1);
        expect(screen.queryByTestId('ai-limit-notice')).toBeNull();
      }
    );

    it.each(MODES)(
      'A2 $mode — 오늘 5회면 POST 를 쏘지 않고 한도 얼굴을 띄운다',
      async ({ mode, successRoute }) => {
        // 준비
        const raw = seed(KEY_A, 5);

        // 실행
        renderPage({ mode, successRoute });

        // 단언 ① 한도 얼굴 — 제목은 완전 일치, 본문 두 문장은 부분 일치(한 줄로 합쳐 그려도 된다).
        const notice = await screen.findByTestId('ai-limit-notice');
        expect(within(notice).getByText(TITLE)).toBeOnTheScreen();
        expect(
          within(notice).getByText(/내일 0시에 다시 쓸 수 있어요/)
        ).toBeOnTheScreen();
        expect(
          within(notice).getByText(/직접 짜기는 계속 쓸 수 있어요/)
        ).toBeOnTheScreen();
        // 단언 ② 나갈 시간을 줘도 POST 0 · 이동 0 · [다시 시도]·진행 얼굴 없음 · 횟수 그대로.
        await settle();
        expect(postCalls).toBe(0);
        expectNoLeave();
        expect(screen.queryByTestId('itinerary-generating-retry')).toBeNull();
        expect(
          screen.queryByTestId('itinerary-generating-progress')
        ).toBeNull();
        expect(mockVault.get(KEY_A)).toBe(raw);
      }
    );
  });

  describe('🔴 A3·A4 · AC-9 — 한도 얼굴의 두 버튼', () => {
    it('A3 [직접 짜기 이어가기] → 직접 짜기 편집기로 replace 1회(fresh 없음 — 기존 일정 보존)', async () => {
      seed(KEY_A, 5);
      renderPage();

      fireEvent.press(await screen.findByTestId('ai-limit-manual-cta'));

      // toHaveBeenCalledWith(객체) = 재귀 완전 일치 — params 에 fresh 키가 붙으면 red(BR-U3-06).
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/manual',
        params: { tripId: TRIP_ID },
      });
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockDismissTo).not.toHaveBeenCalled();
    });

    it('A4 [닫기] → 홈으로 dismissTo 1회', async () => {
      seed(KEY_A, 5);
      renderPage();

      fireEvent.press(await screen.findByTestId('ai-limit-close'));

      expect(mockDismissTo).toHaveBeenCalledTimes(1);
      expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)');
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('🔴 A5·A6 · AC-10·AC-11 — 실패는 세지 않고, 재전송 성공은 1번만 센다', () => {
    it.each([
      {
        label: '409 다른 여행 생성 중',
        respond: busy,
        face: 'itinerary-generation-busy',
      },
      {
        label: '500',
        respond: serverError,
        face: 'itinerary-generating-failed',
      },
      {
        label: '네트워크 오류',
        respond: networkError,
        face: 'itinerary-generating-failed',
      },
    ])(
      'A5 POST 가 $label 이면 그 얼굴이 뜨고 오늘 횟수는 그대로다',
      async ({ respond, face }) => {
        // 준비
        const raw = seed(KEY_A, 2);
        postQueue = [respond];

        // 실행
        renderPage();

        // 단언 — 기존 얼굴 그대로 · 쓰기 0 · 값 그대로.
        await screen.findByTestId(face);
        await settle();
        // 짝 — 판정은 실제로 거쳤다(안 읽고 안 쓰면 공허 통과).
        expect(mockReadStringValue).toHaveBeenCalledWith(KEY_A);
        expect(postCalls).toBe(1);
        expect(mockWriteStringValue).not.toHaveBeenCalled();
        expect(mockVault.get(KEY_A)).toBe(raw);
      }
    );

    it('A6 409 뒤 [취소하고 새로 만들기]로 성공하면 오늘 횟수가 정확히 1 오른다', async () => {
      seed(KEY_A, 2);
      postQueue = [busy, created];
      renderPage();

      fireEvent.press(
        await screen.findByTestId('itinerary-generation-busy-cancel-retry')
      );

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(stored(KEY_A)).toEqual({ d: today(), n: 3 }));
      // 시간을 더 줘도 3 그대로 — 409 와 성공을 둘 다 세면 4 가 된다.
      await settle();
      expect(stored(KEY_A)).toEqual({ d: today(), n: 3 });
      expect(postCalls).toBe(2);
    });
  });

  describe('🔴 A7 · AC-12 — 생성 중 화면을 떠난 뒤 성공해도 센다', () => {
    /** 생성 화면을 켰다 껐다 하는 호스트 — `showGenerating=false` = 화면을 떠남(뮤테이션은 살아 있다). */
    function Host({
      showGenerating,
    }: {
      showGenerating: boolean;
    }): ReactElement {
      return (
        <>
          {showGenerating ? (
            <GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />
          ) : null}
        </>
      );
    }

    it('A7 POST 가 매달린 채 떠나고 그 뒤 성공하면 오늘 횟수가 1 오르고, 이동은 0회다', async () => {
      // 준비
      seed(KEY_A, 1);
      holdPost = true;
      const client = newClient();
      function Wrapper({ children }: { children: ReactNode }) {
        return (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
      }
      const view = render(<Host showGenerating />, { wrapper: Wrapper });
      await waitFor(() => expect(postCalls).toBe(1));

      // 실행 ① 떠난다(호출별 onSuccess 는 이제 안 불린다) ② 서버가 생성을 끝낸다.
      view.rerender(<Host showGenerating={false} />);
      expect(screen.queryByTestId('itinerary-generating-progress')).toBeNull();
      releasePost();

      // 단언 — 훅 옵션 onSuccess 가 센다. 떠난 화면은 이동을 일으키지 않는다(이탈을 정말 재현한 앵커).
      await waitFor(() => expect(stored(KEY_A)).toEqual({ d: today(), n: 2 }));
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('🟢 A8·A9 · AC-13①·AC-14 — 직접 짜기·관찰 모드는 막지도 세지도 않는다', () => {
    it('A8 mode=MANUAL 이면 오늘 5회여도 POST 가 나가고, 성공해도 횟수를 쓰지 않는다', async () => {
      const raw = seed(KEY_A, 5);

      renderPage({ mode: 'MANUAL' });

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      await settle();
      expect(postCalls).toBe(1);
      expect(screen.queryByTestId('ai-limit-notice')).toBeNull();
      expect(mockWriteStringValue).not.toHaveBeenCalled();
      expect(mockVault.get(KEY_A)).toBe(raw);
    });

    it('A9 mode 없이(관찰 모드) 열면 계정·횟수를 묻지 않고 POST 도 없다', async () => {
      seed(KEY_A, 5);

      renderPage({ mode: null });

      // 앵커 — 관찰 모드가 실제로 돌았다(일정 404 → 생성 방식 화면으로).
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(JSON.stringify(mockReplace.mock.calls[0][0])).toContain(
        '/itinerary/method'
      );
      await settle();
      expect(meHits).toBe(0);
      expect(mockReadStringValue).not.toHaveBeenCalled();
      expect(mockWriteStringValue).not.toHaveBeenCalled();
      expect(postCalls).toBe(0);
      expect(screen.queryByTestId('ai-limit-notice')).toBeNull();
    });
  });

  describe('🔴 A10~A13 · AC-15·AC-16·AC-6 — 계정 분리 · 모르면 허용 · 저장소 오류는 삼킨다', () => {
    it('A10 /me 가 계정 B 면 A 의 5회와 무관하게 나가고, B 만 1회가 된다', async () => {
      answerMe(() =>
        HttpResponse.json({ accountId: 'acc-b', status: 'ACTIVE' })
      );
      const rawA = seed(KEY_A, 5);

      renderPage();

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(stored(KEY_B)).toEqual({ d: today(), n: 1 }));
      expect(postCalls).toBe(1);
      expect(mockVault.get(KEY_A)).toBe(rawA);
      expect(screen.queryByTestId('ai-limit-notice')).toBeNull();
    });

    it.each([
      {
        label: '/me 500',
        respond: (): Response =>
          HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'boom' } },
            { status: 500 }
          ),
      },
      {
        label: 'accountId 없는 /me',
        respond: (): Response => HttpResponse.json({ status: 'ACTIVE' }),
      },
      { label: '/me 네트워크 오류', respond: networkError },
    ])(
      'A11 $label 이면 막지 않고 POST 1번 · 성공해도 기록하지 않는다',
      async ({ respond }) => {
        // 준비 — 알 수만 있었다면 막혔을 5회를 심는다. 계정을 모르면 키도 모른다.
        answerMe(respond);
        seed(KEY_A, 5);

        // 실행
        renderPage();

        // 단언
        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
        await settle();
        // 짝 — 계정 조회를 실제로 시도했다(조회도 안 하고 통과하면 공허).
        expect(meHits).toBe(1);
        expect(postCalls).toBe(1);
        expect(screen.queryByTestId('ai-limit-notice')).toBeNull();
        expect(mockWriteStringValue).not.toHaveBeenCalled();
      }
    );

    it('A12 저장소 읽기가 실패하면 막지 않고 POST 1번 · 기록은 시도하지 않는다', async () => {
      mockReadStringValue.mockReset().mockRejectedValue(new Error('keychain'));

      renderPage();

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      await settle();
      // 짝 — 횟수 읽기를 실제로 시도했다.
      expect(mockReadStringValue).toHaveBeenCalledWith(KEY_A);
      expect(postCalls).toBe(1);
      expect(screen.queryByTestId('ai-limit-notice')).toBeNull();
      expect(mockWriteStringValue).not.toHaveBeenCalled();
    });

    it('A13 저장소 쓰기가 실패해도 생성 성공 흐름(초안으로 이동)은 그대로다', async () => {
      seed(KEY_A, 1);
      mockWriteStringValue.mockReset().mockRejectedValue(new Error('disk'));

      renderPage();

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(JSON.stringify(mockReplace.mock.calls[0][0])).toContain(
        '/itinerary/draft'
      );
      // 짝 — 기록을 실제로 시도했다(실패는 삼켰다).
      await waitFor(() =>
        expect(mockWriteStringValue).toHaveBeenCalledWith(
          KEY_A,
          expect.any(String)
        )
      );
      expect(postCalls).toBe(1);
    });
  });

  describe('🔴 A14 · AC-17 — 이전 실패가 남아 있어도 한도 얼굴이 이긴다', () => {
    it('실패 얼굴에서 [다시 시도]를 눌렀는데 그새 5회가 됐으면 POST 0 · 한도 얼굴 · 실패 얼굴 없음', async () => {
      // 준비 — 첫 POST 는 500 으로 실패한다.
      seed(KEY_A, 3);
      postQueue = [serverError];
      renderPage();
      await screen.findByTestId('itinerary-generating-failed');
      // 다른 경로(다른 화면·기기)에서 그새 5회가 됐다.
      seed(KEY_A, 5);

      // 실행
      fireEvent.press(screen.getByTestId('itinerary-generating-retry'));

      // 단언 — 진짜 react-query 는 새 mutate 전까지 isError 를 들고 있다. 그래도 한도가 이긴다.
      expect(await screen.findByTestId('ai-limit-notice')).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
      await settle();
      expect(postCalls).toBe(1);
    });
  });

  describe('AC-18 — 한도 얼굴에서 떠나면 "백그라운드에서 만드는 중" 토스트가 없다', () => {
    let showToastSpy: jest.SpyInstance;

    beforeEach(() => {
      showToastSpy = jest.spyOn(ToastModule, 'showToast');
    });

    afterEach(() => {
      showToastSpy.mockRestore();
    });

    it.each([
      { label: '앱바 ‹', testID: 'itinerary-generating-back' },
      { label: '[닫기]', testID: 'ai-limit-close' },
    ])(
      '🔴 A15 $label 로 떠나면 토스트 0회(POST 를 안 쐈으니 "만드는 중"은 거짓이다)',
      async ({ testID }) => {
        seed(KEY_A, 5);
        const view = renderPage();
        await screen.findByTestId('ai-limit-notice');

        fireEvent.press(screen.getByTestId(testID));
        expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)');
        view.unmount();

        expect(showToastSpy).not.toHaveBeenCalled();
      }
    );

    it('🟢 A15+ 짝 — POST 가 진행 중일 때 떠나면 토스트가 1회 뜬다(그물이 살아 있다는 앵커)', async () => {
      holdPost = true;
      const view = renderPage();
      await waitFor(() => expect(postCalls).toBe(1));

      view.unmount();

      expect(showToastSpy).toHaveBeenCalledTimes(1);
      // 매달린 POST 를 이 케이스 안에서 끝낸다(늦은 기록이 다음 케이스 저장소로 새지 않게).
      releasePost();
      await settle();
    });
  });

  describe('🔴 A16·A17 · AC-20·AC-21 — 계정 조회 중엔 POST 를 보류하고, 도착 뒤 한 번만 판정한다', () => {
    it('A16 /me 응답 전엔 POST 0 · 진행 얼굴 유지, 응답이 오면(한도 미만) POST 1번', async () => {
      // 준비
      holdMe();

      // 실행
      renderPage();

      // 단언 ① 첫 렌더부터 진행 얼굴 — 비거나 깜빡이지 않는다.
      expect(
        screen.getByTestId('itinerary-generating-progress')
      ).toBeOnTheScreen();
      await waitFor(() => expect(meHits).toBe(1));
      await settle();
      expect(postCalls).toBe(0);
      expect(
        screen.getByTestId('itinerary-generating-progress')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('ai-limit-notice')).toBeNull();
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();

      // 단언 ② 응답이 오면 그제야 나간다.
      releaseMe();
      await waitFor(() => expect(postCalls).toBe(1));
    });

    it('A17 /me 가 늦게 와도 오늘 5회면 POST 0 · 한도 얼굴, 계정 조회는 1번뿐', async () => {
      seed(KEY_A, 5);
      holdMe();

      renderPage();

      await waitFor(() => expect(meHits).toBe(1));
      await settle();
      expect(postCalls).toBe(0);
      expect(screen.queryByTestId('ai-limit-notice')).toBeNull();
      expect(
        screen.getByTestId('itinerary-generating-progress')
      ).toBeOnTheScreen();

      releaseMe();

      expect(await screen.findByTestId('ai-limit-notice')).toBeOnTheScreen();
      await settle();
      expect(postCalls).toBe(0);
      // 판정은 한 번 — 재렌더(꼭 갈 곳 조회 도착 등)마다 다시 묻지 않는다.
      expect(meHits).toBe(1);
    });
  });

  // 재호출 1 · 03b 차단-1 — 위 케이스는 전부 Map 저장소라 "운영 저장소가 이 키를 받아 주나"를 묻지 않았다.
  describe('🔴 A18 · AC-22 — 실제 저장 래퍼와 SecureStore 키 규칙을 거쳐도 한도가 걸린다', () => {
    beforeEach(() => {
      mockRealStringStore = true;
    });

    /** SecureStore 에 남은 값을 편다 — 키는 보지 않는다(카운터가 고른 키를 그대로 믿고 결과만 본다). */
    function secureCounts(): unknown[] {
      return [...mockSecureVault.values()].map((raw) => JSON.parse(raw));
    }

    it('앵커 — 키 규칙 대역은 `:` 키를 거부하고 `.` 키는 받는다(대역이 다 받아 주면 A18 이 공허해진다)', async () => {
      await expect(
        SecureStore.getItemAsync('aiGenUsage:acc-a')
      ).rejects.toThrow(/Invalid key/);
      await expect(
        SecureStore.getItemAsync('aiGenUsage.acc-a')
      ).resolves.toBeNull();
    });

    it('A18 생성 화면을 5번 성공시키면 저장소에 오늘 5회가 남고, 6번째 진입은 POST 0 · 한도 얼굴', async () => {
      // 준비·실행 ① — 화면을 열어 성공시키고, 기록이 저장소에 닿을 때까지 기다린 뒤 닫기를 5번.
      for (let round = 1; round <= 5; round += 1) {
        const view = renderPage();
        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(round));
        await waitFor(() =>
          expect(secureCounts()).toEqual([{ d: today(), n: round }])
        );
        view.unmount();
      }

      // 실행 ② — 6번째 진입
      renderPage();

      // 단언 — 한도 얼굴 · 나갈 시간을 줘도 POST 는 5 그대로
      expect(await screen.findByTestId('ai-limit-notice')).toBeOnTheScreen();
      await settle();
      expect(postCalls).toBe(5);
    });
  });

  // 재호출 1 · 03b 차단-2 — 계정 조회(`/me`)·저장소 읽기를 기다리는 동안 버튼이 살아 있어 두 번째 탭이
  // 두 번째 검사를 시작한다. 둘 다 "한도 미만"을 읽고 둘 다 POST 를 쏘면 6번째 생성이 성공하고 기록은 5다.
  describe('🔴 A19·A20 · AC-23 — 계정 조회 중 재시도 연타는 POST 1번 · 기록 +1', () => {
    /** 매달린 `/me` 응답을 **전부** 기억한다 — 하나만 기억하면 앞선 조회가 영영 안 풀려 POST 가 덜 나간다. */
    let meWaiters: (() => void)[] = [];

    /** 지금부터 오는 `/me` 를 손으로 풀기 전까지 전부 매달아 둔다. */
    function holdEveryMe(): void {
      server.use(
        http.get(`${BASE}/me`, async () => {
          meHits += 1;
          await new Promise<void>((resolve) => {
            meWaiters.push(resolve);
          });
          return HttpResponse.json({ accountId: 'acc-a', status: 'ACTIVE' });
        })
      );
    }

    function releaseEveryMe(): void {
      const waiters = meWaiters;
      meWaiters = [];
      waiters.forEach((resolve) => resolve());
    }

    /** 매달린 취소 왕복(다른 여행 일정 조회)·생성 POST 도 전부 기억한다 — A21 이 순서를 손으로 정한다. */
    let roundTripWaiters: (() => void)[] = [];
    let postWaiters: (() => void)[] = [];

    /** 취소 대상 일정 조회 중 첫 번째(첫 탭 왕복)는 바로 답하고, 두 번째부터(뒤 탭 왕복)는 매단다. */
    function holdLaterRoundTrips(): void {
      let hits = 0;
      server.use(
        http.get(`${BASE}/trips/${ACTIVE_TRIP_ID}/itinerary`, async () => {
          hits += 1;
          if (hits >= 2) {
            await new Promise<void>((resolve) => {
              roundTripWaiters.push(resolve);
            });
          }
          return HttpResponse.json(itinerary(ACTIVE_TRIP_ID, SESSION_ID));
        })
      );
    }

    /** 지금부터 오는 생성 POST 를 손으로 풀기 전까지 전부 매달아 둔다(세는 것은 도착 순간). */
    function holdEveryPost(): void {
      server.use(
        http.post(`${BASE}/trips/:tripId/itinerary`, async () => {
          postCalls += 1;
          await new Promise<void>((resolve) => {
            postWaiters.push(resolve);
          });
          return (postQueue.shift() ?? created)();
        })
      );
    }

    function releaseAll(waiters: (() => void)[]): void {
      waiters.splice(0).forEach((resolve) => resolve());
    }

    afterEach(() => {
      releaseEveryMe();
      releaseAll(roundTripWaiters);
      releaseAll(postWaiters);
    });

    it('A19 실패 얼굴에서 [다시 시도]를 같은 순간 두 번 눌러도 POST 는 1번 더, 오늘 5회 · 6번째는 한도 얼굴', async () => {
      // 준비 — 오늘 4회, 첫 POST 는 500 으로 실패해 실패 얼굴이 뜬다. 그다음 계정 조회는 매달린다.
      seed(KEY_A, 4);
      postQueue = [serverError];
      const first = renderPage();
      const retry = await screen.findByTestId('itinerary-generating-retry');
      expect(postCalls).toBe(1);
      expect(meHits).toBe(1);
      holdEveryMe();

      // 실행 ① — 한 act 안에서 두 번 누른다(다음 렌더 전에 들어온 두 번째 탭). 상태 갱신은 act 가 끝나야
      // 화면에 반영되므로, "다음 렌더에 버튼을 숨긴다"로는 못 막고 즉시 잠그는 장치가 있어야 1번이 된다.
      act(() => {
        fireEvent.press(retry);
        fireEvent.press(retry);
      });
      // 나갈 시간을 줘도 조회 응답 전엔 POST 가 없다(보류 계약 AC-20).
      await settle();
      expect(postCalls).toBe(1);

      // 실행 ② — 매달린 조회를 전부 푼다.
      releaseEveryMe();

      // 단언 ① — 성공해서 넘어갔고, 오늘 5회가 됐다.
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(stored(KEY_A)).toEqual({ d: today(), n: 5 }));
      // 단언 ② — 시간을 더 줘도 POST 는 실패 1 + 성공 1, 계정 조회는 마운트 1 + 재시도 1.
      await settle();
      expect(postCalls).toBe(2);
      expect(meHits).toBe(2);
      expect(stored(KEY_A)).toEqual({ d: today(), n: 5 });

      // 단언 ③ — 6번째 시도는 막힌다(이번 계정 조회는 매달지 않고 바로 답한다).
      first.unmount();
      answerMe(() =>
        HttpResponse.json({ accountId: 'acc-a', status: 'ACTIVE' })
      );
      renderPage();
      expect(await screen.findByTestId('ai-limit-notice')).toBeOnTheScreen();
      await settle();
      expect(postCalls).toBe(2);
    });

    it('A20 409 안내에서 [취소하고 새로 만들기]를 조회 중 또 눌러도 POST 는 1번 더, 오늘 3회', async () => {
      // 준비 — 오늘 2회, 첫 POST 는 409(다른 여행 생성 중). 그다음 계정 조회는 매달린다.
      seed(KEY_A, 2);
      postQueue = [busy];
      renderPage();
      fireEvent.press(
        await screen.findByTestId('itinerary-generation-busy-cancel-retry')
      );
      // 첫 탭 직전에 조회를 매달면 마운트 조회와 섞이므로, 마운트 조회가 끝난 뒤(안내가 뜬 뒤) 건다.
      expect(meHits).toBe(1);
      holdEveryMe();

      // 실행 ① — 취소 왕복이 끝나고 계정 조회가 매달린 순간까지 기다린다.
      await waitFor(() => expect(meHits).toBe(2));
      // 실행 ② — 그 사이 안내가 아직 떠 있으면 한 번 더 누른다. (안내를 걷어 버튼을 없애는 구현이면
      // 사용자가 두 번째로 누를 곳이 없으므로 그것도 맞는 답이다 — 지켜야 할 것은 아래 POST 수다.)
      const again = screen.queryByTestId(
        'itinerary-generation-busy-cancel-retry'
      );
      if (again !== null) fireEvent.press(again);
      await settle();
      expect(postCalls).toBe(1);

      // 실행 ③ — 매달린 조회를 전부 푼다.
      releaseEveryMe();

      // 단언 — 성공 이동 1번, POST 는 409 1 + 성공 1, 오늘 3회(정확히 +1).
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(stored(KEY_A)).toEqual({ d: today(), n: 3 }));
      await settle();
      expect(postCalls).toBe(2);
      expect(stored(KEY_A)).toEqual({ d: today(), n: 3 });
    });

    // 재호출 2 · 03b-2 차단-1 — A20 의 반대 순서. 두 번째 탭의 취소 왕복이 첫 검사보다 **늦게** 끝나면,
    // 그 왕복 끝의 재전송은 이미 풀린 검사 잠금을 지나 검사·POST 를 한 번 더 한다(실측 POST 3 · 기록 2→4).
    // 두 갈래: 왕복 2 가 끝날 때 재시도 POST 가 ① 아직 진행 중 ② 이미 성공으로 끝남. 둘 다 사용자는
    // "검사가 도는 동안 한 번 더 누른" 것이므로 POST 는 재시도분 1번이어야 한다(AC-23).
    it.each([
      { when: '재시도 POST 가 아직 진행 중', holdRetryPost: true },
      { when: '재시도 POST 가 이미 성공', holdRetryPost: false },
    ])(
      'A21 409 안내 두 번째 탭의 취소 왕복이 첫 검사보다 늦게 끝나도($when) POST 는 1번 더, 오늘 3회',
      async ({ holdRetryPost }) => {
        // 준비 — 오늘 2회, 첫 POST 는 409. 안내가 뜬 뒤부터 계정 조회는 매달고, 취소 왕복은 두 번째부터 매단다.
        seed(KEY_A, 2);
        postQueue = [busy];
        renderPage();
        const button = await screen.findByTestId(
          'itinerary-generation-busy-cancel-retry'
        );
        expect(meHits).toBe(1);
        holdEveryMe();
        holdLaterRoundTrips();

        // 실행 ① — 첫 탭: 왕복 1 은 바로 끝나고, 검사 1 의 계정 조회가 매달린 순간까지 기다린다.
        fireEvent.press(button);
        await waitFor(() => expect(meHits).toBe(2));
        // 실행 ② — 검사 1 이 도는 동안 안내가 남아 있으면 한 번 더 누른다(이 탭의 왕복은 매달린다).
        const again = screen.queryByTestId(
          'itinerary-generation-busy-cancel-retry'
        );
        if (again !== null) fireEvent.press(again);
        await settle();
        expect(postCalls).toBe(1);

        // 실행 ③ — 검사 1 을 **먼저** 끝낸다. 이 뒤의 계정 조회는 바로 답한다.
        if (holdRetryPost) holdEveryPost();
        answerMe(() =>
          HttpResponse.json({ accountId: 'acc-a', status: 'ACTIVE' })
        );
        releaseEveryMe();
        await waitFor(() => expect(postCalls).toBe(2));
        if (!holdRetryPost) {
          await waitFor(() =>
            expect(stored(KEY_A)).toEqual({ d: today(), n: 3 })
          );
        }

        // 실행 ④ — 그다음에야 매달린 왕복 2 를 끝내고, 시간을 준 뒤 매달린 POST 를 푼다.
        releaseAll(roundTripWaiters);
        await settle();
        releaseAll(postWaiters);

        // 단언 — POST 는 409 1 + 성공 1, 성공 이동 1번, 오늘 3회(정확히 +1).
        await settle();
        expect(postCalls).toBe(2);
        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
        await waitFor(() =>
          expect(stored(KEY_A)).toEqual({ d: today(), n: 3 })
        );
        expect(mockReplace).toHaveBeenCalledTimes(1);
      }
    );
  });
});
