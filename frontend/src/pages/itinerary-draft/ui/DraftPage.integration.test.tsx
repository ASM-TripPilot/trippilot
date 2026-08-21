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
import { DRAFT_POLL_INTERVAL_MS } from '@/features/itinerary/model/draftView';
import type {
  Itinerary,
  ItineraryCandidatesSummary,
  ItineraryDaysItem,
  ItineraryGenerationState,
  ItinerarySolveMode,
  ItineraryStatus,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * h11 배선을 **실 HTTP 로** 태우는 심판(AC-4 · AC-9 · AC-10 · AC-11).
 *
 * 무엇을 보장하나:
 *  - 🔴 **2단계 생성이 실제로 이어진다.** 서버는 `generationState=PARTIAL` 로 day1 만 먼저 주고
 *    나머지는 백그라운드로 채운다 — 클라가 GET 으로 `COMPLETE` 까지 폴링해야 2·3일차가 온다.
 *    이 리포 프론트에 이 패턴의 소비자가 **아직 0개**라 배선을 실제로 태워 보는 것이 값을 낸다.
 *  - 🔴 **COMPLETE 가 되면 폴링이 멈춘다.** 안 멈추면 화면을 열어 둔 사용자가 2초마다 영원히
 *    서버를 때린다 — 목킹된 훅으로는 이 사고가 안 보인다.
 *  - 탭 개수의 출처가 **여행 기간**(`GET /trips/{id}`)이지 `days.length` 가 아니다(01b D7).
 *  - 🔴 **확정된 일정에서는 재생성 POST 가 한 건도 안 나간다**(01b D8). openapi 원문: 확정
 *    일정에 이 POST 를 호출하면 확정이 풀리고 동결됐던 `poi_snapshot` 참조가 사라진다.
 *
 * 왜 통합 버킷인가: 심판의 핵심이 **어떤 요청이 몇 건 나갔나**다. 훅을 목킹하면 "폴링이 멈춘다"·
 * "확정이면 POST 가 안 나간다"가 테스트의 *가정*이 되어 그 가정이 틀려도 아무도 모른다
 * (문제로그 `2026-08-02 목이 성공만 흉내내 도달 불가 분기가 초록으로 남았다`).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=화면을 열고 기다리거나 누른다 → 단언=나간 요청·보이는 것.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다 — 실물
// 로드를 피하려면 목킹해야 한다(선례와 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려지므로 바깥 변수를 못 본다 — 이름이 `mock` 으로
// 시작하는 변수만 예외다(리포 확립 규칙).
const mockPush = jest.fn();
const mockBack = jest.fn();
// TRIP-466 — (c) onBack 가드가 `router.canGoBack()`/`router.replace(...)` 를 쓴다. `canGoBack` 은
// 리포 신규 API 라(선례 0) 목에 없으면 press 시 `canGoBack is not a function` 으로 **거짓 red** 가
// 난다(02a ★3, `ItineraryPlanPage.escape.integration.test.tsx` 목 셋업 선례). `replace` 도 지금까지
// 익명이라 관찰 불가였던 것을 이름 있는 목으로 승격한다.
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

// 지도는 이 칸의 심판 대상이 아니다 — WebView 실물이 뜨지 않게만 막는다. 인라인 팩토리는
// NativeWind babel 호이스트 규칙에 걸리므로 모듈을 require 한다(리포 선례와 동형).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

/** `authWiring.integration.test.ts:59` 와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';

const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const DAY3 = '2026-06-12';

/** `endDate` 를 케이스가 정할 수 있게 열어 둔다 — 탭 개수의 출처가 여행 기간이라
 * (TRIP-297 01b D7) "부분 0건에도 탭이 그대로"(TRIP-298 AC-9)를 재려면 2일 여행이 필요하다. */
function trip(endDate: string = DAY3): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 3일',
    // ★ 탭 개수의 출처 — `days.length` 가 아니라 이 두 날짜다(01b D7).
    startDate: DAY1,
    endDate,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

function daysUpTo(count: number): ItineraryDaysItem[] {
  return [DAY1, DAY2, DAY3].slice(0, count).map((date) => ({
    date,
    slots: [
      {
        poiId: `poi-${date}`,
        startAt: '09:30:00',
        endAt: '11:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        tags: [],
        nameKo: `${date} 첫 장소`,
        lat: 33.458,
        lng: 126.942,
      },
    ],
  }));
}

function itinerary(input: {
  dayCount: number;
  generationState: ItineraryGenerationState;
  status?: ItineraryStatus;
  /** TRIP-298 — 3상태 옵셔널(`undefined`/`null`/객체)을 그대로 태운다. `undefined` 는
   * JSON 직렬화에서 키째 사라지므로 "키 자체가 없는" 응답이 실제로 만들어진다. */
  candidatesSummary?: ItineraryCandidatesSummary;
  /** 일자 모양을 케이스가 직접 정할 때(슬롯 0장 · 날짜별 개수 차이). 없으면 기존 `dayCount`. */
  days?: ItineraryDaysItem[];
  /** TRIP-304 — 폴백 신호 두 축. 기본값은 정상 경로(FULL_AI, false)라 I1~I7 은 무영향이다. */
  solveMode?: ItinerarySolveMode;
  isFallback?: boolean;
}): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: input.status ?? 'PLANNED',
    solveMode: input.solveMode ?? 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: input.generationState,
    isFallback: input.isFallback ?? false,
    candidatesSummary: input.candidatesSummary,
    days: input.days ?? daysUpTo(input.dayCount),
  };
}

/** 카드 루트만 세는 셀렉터 — 번호·라벨·배지·사진이 같은 접두를 공유하므로 제외한다
 * (동결 `DraftScreen.test.tsx` 가 세운 규약과 같은 형태). */
const CARD_SUB_PREFIXES = [
  'no-',
  'band-',
  'badge-',
  'fixed-',
  'image-',
  'tags-',
  'name-',
];

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-draft-slot-/)
    .map((node) => String(node.props.testID))
    .filter((testID) => {
      const tail = testID.slice('itinerary-draft-slot-'.length);
      return !CARD_SUB_PREFIXES.some((prefix) => tail.startsWith(prefix));
    });
}

/** 나간 요청의 `METHOD /경로` 누적 — **도착 순서 그대로** 쌓인다. */
let observedHits: string[] = [];
/** GET /itinerary 가 몇 번 처리됐나. ⚠️ `observedHits` 로 세지 않는다 — `request:start` 는
 * 핸들러가 돌기 **전에** 발화하므로 그 값으로 시나리오를 고르면 한 칸씩 밀린다. */
let itineraryGetCalls = 0;
/** GET /itinerary 가 n 번째(0-based)로 불릴 때 무엇을 돌려줄지 — 시나리오를 테스트가 정한다. */
let itineraryScript: (call: number) => Itinerary;
/** GET /trips/{id} 가 무엇을 돌려줄지 — 여행 기간을 케이스가 정한다(위 `itineraryScript` 와 동형). */
let tripScript: () => Trip;

function hitsFor(method: string, includes: string): number {
  return observedHits.filter(
    (hit) => hit.startsWith(method) && hit.includes(includes)
  ).length;
}

/** 실타이머로 n 밀리초를 실제로 흘려보낸다. 폴링 간격이 2초라 "그 뒤에도 요청이 안 나갔다"를
 * 재려면 벽시계가 필요하다 — 가짜 타이머를 쓰면 MSW 의 응답 파이프라인과 엉킨다. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  itineraryGetCalls = 0;
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockClear();
  // 기본: 히스토리 있음. 딥링크(canGoBack=false) 케이스만 각 테스트에서 뒤집는다.
  mockCanGoBack.mockReturnValue(true);
  itineraryScript = () =>
    itinerary({ dayCount: 3, generationState: 'COMPLETE' });
  tripScript = () => trip();
  setAccessToken('valid-access');

  // 통합 버킷은 `onUnhandledRequest: 'error'` 라 핸들러가 없으면 AC 실패가 아니라 **준비
  // 단계에서 죽는다**. 이 칸이 쓰는 세 경로를 매번 명시적으로 건다.
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(tripScript())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      const call = itineraryGetCalls;
      itineraryGetCalls += 1;
      return HttpResponse.json(itineraryScript(call));
    }),
    http.post(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(
        itinerary({ dayCount: 1, generationState: 'PARTIAL' }),
        {
          status: 201,
        }
      )
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/**
 * `gcTime: 0` — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를 붙잡는다.
 * `retry: false` — 실패를 즉시 실패로 본다(재시도가 돌면 요청 개수 단언이 흔들린다).
 * ⚠️ `refetchInterval` 은 **여기서 주지 않는다** — 그것이 배선의 책임이고 이 테스트의 심판이다.
 */
function renderPage() {
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
  const utils = render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  return { ...utils, client };
}

describe('🔴 I1 · AC-4 · AC-9 — 2단계 생성을 폴링으로 잇고, 다 받으면 멈춘다', () => {
  it('PARTIAL 이면 2초 뒤 다시 조회해 3일차가 활성이 되고, COMPLETE 뒤에는 요청이 더 안 나간다', async () => {
    // 준비 — 첫 조회는 day1 만 담긴 PARTIAL, 그 다음부터 3일 전부 담긴 COMPLETE.
    itineraryScript = (call) =>
      call === 0
        ? itinerary({ dayCount: 1, generationState: 'PARTIAL' })
        : itinerary({ dayCount: 3, generationState: 'COMPLETE' });

    renderPage();

    // 단언 ① — 탭은 처음부터 **3개**다. 여행이 3일이기 때문이지 `days` 가 3개여서가 아니다.
    //          `days.length` 로 셌다면 여기서 1개가 나온다(01b D7 의 급소).
    await waitFor(() =>
      expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toHaveLength(3)
    );
    expect(screen.getByTestId('itinerary-draft-day-3')).toBeDisabled();

    // 단언 ② — 폴링이 실제로 돈다. 2초 뒤 두 번째 조회가 나가 3일차가 활성이 된다.
    await waitFor(
      () => expect(screen.getByTestId('itinerary-draft-day-3')).toBeEnabled(),
      { timeout: DRAFT_POLL_INTERVAL_MS * 3 }
    );
    expect(itineraryGetCalls).toBe(2);

    // 단언 ③ — ★ COMPLETE 가 된 뒤로는 **한 건도 더 안 나간다**. 안 멈추면 화면을 열어 둔
    //          사용자가 2초마다 영원히 서버를 때린다(그 사고는 화면에 아무 증상이 없다).
    await sleep(DRAFT_POLL_INTERVAL_MS + 400);
    expect(itineraryGetCalls).toBe(2);
  }, 20000);
});

describe('🔴 I2 · AC-9 · AC-10 — 2차 실패해도 1차분은 살아남는다 (INV-4)', () => {
  it('FAILED 응답에도 day1 카드가 남고 상단 배너가 곁에 붙는다', async () => {
    // 준비 — openapi: "FAILED=2차 실패(**1차분은 유효**)". 받은 것까지 버리면 사용자는
    // 아무것도 없는 화면을 보고 다시 생성하는 수밖에 없다.
    itineraryScript = () =>
      itinerary({ dayCount: 1, generationState: 'FAILED' });

    renderPage();

    // ① 실패가 삼켜지지 않았다.
    expect(
      await screen.findByTestId('itinerary-draft-stale-failed')
    ).toBeOnTheScreen();

    // ② 목록이 지워지지 않았다 — 1일차 슬롯이 그대로 그려진다.
    await waitFor(() =>
      expect(
        screen.queryAllByTestId(/^itinerary-draft-slot-/).length
      ).toBeGreaterThan(0)
    );
    // ③ 전면 실패 얼굴로 갈아 끼우지 않았다.
    expect(screen.queryAllByTestId('itinerary-draft-failed')).toEqual([]);
  });
});

describe('🔴 I3 · AC-11 — 다시 시도는 PLANNED 에서만 POST 를 낸다 (01b D8)', () => {
  it('PLANNED 면 누를 때 재생성 POST 가 한 건 나간다', async () => {
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        status: 'PLANNED',
      });

    renderPage();

    const retry = await screen.findByTestId('itinerary-draft-retry');
    // 배선이 mount 시 POST 를 내든 안 내든 상관없게 **누르기 직전 값과의 차이**를 잰다.
    const before = hitsFor('POST', '/itinerary');

    fireEvent.press(retry);

    await waitFor(() => expect(hitsFor('POST', '/itinerary')).toBe(before + 1));
  });

  it('🔴 CONFIRMED 면 버튼이 비활성이고 POST 가 0건이다 — 확정이 풀리면 되돌릴 수 없다', async () => {
    /**
     * ⚠️ openapi POST 원문: *"확정 일정에 호출하면 확정이 풀리고 PLANNED 새 일정으로 대체되며,
     * 동결됐던 poi_snapshot 참조는 사라진다."* 확정 해제 API 는 없다 — 되돌릴 방법이 없다.
     * `toBeDisabled()` 만으로는 "회색인데 눌리는" 구현을 통과시키므로(02a ★8) **나간 요청 0건**을
     * 짝으로 잰다.
     */
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        status: 'CONFIRMED',
      });

    renderPage();

    const retry = await screen.findByTestId('itinerary-draft-retry');
    await waitFor(() => expect(retry).toBeDisabled());

    fireEvent.press(retry);
    await sleep(50);

    expect(hitsFor('POST', '/itinerary')).toBe(0);
  });
});

/* ───────────────────────── TRIP-298 · 강등 안내 + h35 후보 0건 ─────────────────────────
 * 왜 이 축들이 통합 버킷에 있나: 심판의 핵심이 **응답 한 벌이 어떤 얼굴로 이어지나**다.
 * 훅을 목킹하면 "페이지가 두 얼굴을 동시에 그리지 않는다"가 테스트의 *가정*이 되어 버린다
 * (이 파일 머리말의 판단을 승계). 순수 판정 축은 `draftView.test.ts` M11~M14 가 따로 잰다 —
 * 모델은 **규칙**을, 여기는 그 규칙이 실제 화면으로 **이어졌는지**를 잰다.
 */

const FALLBACK_BANNER = 'itinerary-draft-fallback-banner';

const FACE_ROWS: {
  name: string;
  days: ItineraryDaysItem[];
  summary?: ItineraryCandidatesSummary;
  face: 'empty' | 'zero' | 'listed';
}[] = [
  {
    name: '1행 · 일자 없음 + 요약 키 없음 → 빈 화면',
    days: [],
    summary: undefined,
    face: 'empty',
  },
  {
    name: "1'행 · 일자 없음 + 요약 null → 빈 화면",
    days: [],
    summary: null,
    face: 'empty',
  },
  {
    name: '2행 · 일자 없음 + 요약 객체 → 후보 0건(h35)',
    days: [],
    summary: { level: 'LOW' },
    face: 'zero',
  },
  {
    name: '3행 · 일자는 왔는데 슬롯 합계 0 + 요약 객체 → 후보 0건(h35)',
    days: [
      { date: DAY1, slots: [] },
      { date: DAY2, slots: [] },
    ],
    summary: { level: 'LOW' },
    face: 'zero',
  },
  {
    name: '4행 · 슬롯 있음 + 요약 객체 → 목록(강등 안내는 곁에)',
    days: daysUpTo(3),
    summary: { level: 'LOW' },
    face: 'listed',
  },
  {
    name: '5행 · 슬롯 있음 + 요약 null → 목록',
    days: daysUpTo(3),
    summary: null,
    face: 'listed',
  },
];

describe('🔴 I4 · AC-5 — 01b D5 판정표대로 얼굴이 정확히 하나만 뜬다', () => {
  it.each(FACE_ROWS)('$name', async ({ days, summary, face }) => {
    itineraryScript = () =>
      itinerary({
        dayCount: 0,
        generationState: 'COMPLETE',
        days,
        candidatesSummary: summary,
      });

    renderPage();

    /**
     * ★ 세 얼굴의 존재 여부를 **한 배열로 묶어 완전 일치**로 비교한다. 하나씩 따로 단언하면
     * "빈 화면과 h35 가 동시에 떠 있는" 구현이 두 단언을 각각 통과한다 — AC-5 가 막으려는
     * 사고가 정확히 그것이다(01b AC-5: "두 testID 가 동시에 뜨지 않는다").
     */
    await waitFor(() => {
      expect([
        screen.queryAllByTestId('itinerary-draft-empty').length > 0,
        screen.queryAllByTestId('itinerary-draft-zero').length > 0,
        cardTestIds().length > 0,
      ]).toEqual([face === 'empty', face === 'zero', face === 'listed']);
    });
  });
});

describe('🔴 I5 · AC-4 — poolSize 가 없어도 0 으로 채우지 않는다', () => {
  it.each([
    { name: 'poolSize 키 자체가 없다', summary: { level: 'LOW' } },
    {
      name: 'poolSize 가 null 이다',
      summary: { level: 'LOW', poolSize: null },
    },
    {
      name: '진짜 0 이다 (NO_CANDIDATES · poolSize 0)',
      summary: { level: 'NO_CANDIDATES', poolSize: 0 },
    },
  ])('$name — 안내는 뜨고 개수 표기는 0건이다', async ({ summary }) => {
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        candidatesSummary: summary,
      });

    renderPage();

    // 긍정 짝 — 안내가 실제로 떴다. 없으면 아래 "숫자 0건"이 공허하다.
    const banner = await screen.findByTestId(FALLBACK_BANNER);
    // openapi 원문: *"poolSize 는 AI 가 주지 않으면 없다(0 으로 채우지 않는다 — 0 은 '후보
    // 0건'이라는 판정이다)"*. `?? 0` 한 글자가 "모른다"를 "0건"으로 바꿔 놓는다.
    expect(banner).not.toHaveTextContent(/\d/);

    // ★ 세 번째 행이 요점 — **진짜 0** 이 와도 얼굴은 목록이다. 0건 판정은 문자열·숫자 어휘가
    //   아니라 **슬롯 합계**로 한다(01b D5). 어휘가 얼굴을 정하면 서버가 말을 바꾸는 날
    //   화면이 통째로 달라진다.
    expect(screen.queryAllByTestId('itinerary-draft-zero')).toEqual([]);
  });
});

describe('🔴 I6 · AC-8 — 완화 행이 실재하는 라우트로 간다 (01b D7)', () => {
  it('완화 행을 누르면 필수 방문지 화면으로 한 번 이동한다', async () => {
    itineraryScript = () =>
      itinerary({
        dayCount: 0,
        generationState: 'COMPLETE',
        days: [],
        candidatesSummary: {
          level: 'LOW',
          shortfallCategories: ['1일 예산 5만원'],
        },
      });

    renderPage();

    fireEvent.press(await screen.findByTestId('itinerary-draft-zero-relax'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    // ★ 목적지 표기 **형태**를 강요하지 않는다 — 리포에 `push('/문자열')` 과
    //   `push({pathname, params})` 두 관례가 다 있어서, 한쪽으로 완전 일치를 걸면 정당한
    //   구현이 red 가 된다. 직렬화해서 "어디로 갔나"만 잰다(02a ★8).
    const destination = mockPush.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('/itinerary/must-visits');
    expect(asText).toContain(TRIP_ID);
    // 짝 — 슬롯 상세(`must-visits/[poiId]`)로 새지 않았다. 그 라우트는 poiId 가 필요하고
    // 0건 화면에는 슬롯이 없다.
    expect(asText).not.toContain('[poiId]');
  });
});

describe('🔴 I7 · AC-9 — 일부 날짜만 0건이면 h11 을 유지한다 (01b D6)', () => {
  it('1일차 2장 · 2일차 0장이면 탭·카드가 남고 안내만 곁에 붙는다', async () => {
    // 준비 — 2일 여행. 이 리포에서 **네 번 반복된** 「얼굴 판정이 잔존 데이터를 가린다」 축이라
    // 화면 전체를 h35 로 갈아 끼우는 구현을 여기서 죽인다.
    tripScript = () => trip(DAY2);
    itineraryScript = () =>
      itinerary({
        dayCount: 0,
        generationState: 'COMPLETE',
        days: [
          {
            date: DAY1,
            slots: [
              {
                poiId: 'poi-1',
                startAt: '09:30:00',
                endAt: '11:00:00',
                isFixed: false,
                endsNextDay: false,
                hasViolation: false,
                tags: [],
                nameKo: '광안리 해변',
              },
              {
                poiId: 'poi-2',
                startAt: '12:30:00',
                endAt: '13:30:00',
                isFixed: false,
                endsNextDay: false,
                hasViolation: false,
                tags: [],
                nameKo: 'F1963',
              },
            ],
          },
          { date: DAY2, slots: [] },
        ],
        candidatesSummary: { level: 'LOW' },
      });

    renderPage();

    // ① 날짜 탭이 여행 기간(2일) 그대로다 — 빈 날이 탭을 지우지 않는다.
    await waitFor(() =>
      expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toHaveLength(2)
    );
    // ② 받은 두 장이 살아 있다.
    expect(cardTestIds()).toHaveLength(2);
    // ③ 안내는 곁에 붙어 있다(부족을 삼키지 않는다 — INV-4).
    expect(screen.getByTestId(FALLBACK_BANNER)).toBeOnTheScreen();
    // ④ 얼굴을 h35 로 갈아 끼우지 않았다.
    expect(screen.queryAllByTestId('itinerary-draft-zero')).toEqual([]);
  });
});

/* ───────────────────────── TRIP-304 · 폴백·강등 배너 (배선 이음매) ─────────────────────────
 * 왜 이 축들이 통합 버킷에 있나: `solveMode`·`isFallback` 두 신호가 **배선을 타고 배너로 이어지는지**는
 * model 도 screen 도 못 본다 — 함수가 옳고 화면이 옳아도 배선이 이 두 값을 `resolveFallbackNotice` 에
 * 안 넘기면 DETERMINISTIC 폴백에 배너가 안 뜬다(02a ★6). 규칙은 `draftView.fallback.test.ts` 가,
 * 그림은 `DraftScreen.fallback.test.tsx` 가 따로 잰다 — 여기는 응답 한 벌이 실제 화면으로 **이어졌나**다.
 */
describe('🔴 I8 · AC-1·AC-2·AC-7 — solveMode·isFallback 신호가 배선을 타고 배너로 이어진다', () => {
  it('AC-1 · DETERMINISTIC + isFallback=true → "기본 모드" 배너가 뜬다', async () => {
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        solveMode: 'DETERMINISTIC',
        isFallback: true,
      });

    renderPage();

    // 핵심어만 정규식으로 — 정확 문안은 01b 가 열어 뒀다(demoted 배너와 구별되는 지점).
    expect(await screen.findByTestId(FALLBACK_BANNER)).toHaveTextContent(
      /기본 모드/
    );
  });

  it('AC-2 · MINIMAL + isFallback=true → 배너와 배너 내 [다시 시도] 버튼이 뜬다', async () => {
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        solveMode: 'MINIMAL',
        isFallback: true,
      });

    renderPage();

    expect(await screen.findByTestId(FALLBACK_BANNER)).toBeOnTheScreen();
    // 배너 안 전용 retry(신규 testID) — 헤더의 `itinerary-draft-retry` 와 다른 버튼이다.
    expect(
      screen.getByTestId('itinerary-draft-fallback-retry')
    ).toBeOnTheScreen();
  });

  it('🔴 AC-7 · MINIMAL + isFallback=false(MANUAL) → 배너가 0건이다 (실패가 아니라 선택)', async () => {
    /**
     * ⚠️ openapi 원문: MANUAL(직접 만들기)은 `solveMode=MINIMAL` 이지만 `isFallback=false` 다.
     * 배선이 solveMode 만 보고 배너를 켜면 직접 만든 빈 일정에 "최소 일정 폴백" 오배너가 뜬다.
     */
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        solveMode: 'MINIMAL',
        isFallback: false,
      });

    renderPage();

    // 긍정 앵커 — 목록은 정상으로 떴다(빈 화면이 아래 부정 단언을 공짜로 통과하는 것 방지).
    await waitFor(() => expect(cardTestIds().length).toBeGreaterThan(0));
    // 부정 — solveMode 만 보고 배너를 켜면 여기서 걸린다(isFallback 게이트가 없으면 red 로 전환).
    expect(screen.queryAllByTestId(FALLBACK_BANNER)).toEqual([]);
  });
});

/* ───────────────────────── TRIP-454 · h11→h25 완성 CTA 배선 ─────────────────────────
 * 화면(DraftScreen)은 완성 버튼을 그리고 `onComplete` 만 부른다 — **어디로 가는지**는 이 배선의
 * 책임이자 심판이다. 기본 시나리오(COMPLETE·PLANNED·3일 = listed 얼굴)에서 CTA 를 눌러 h25 로
 * 정확히 가는지 잰다.
 * ─────────────────────────────────────────────────────────────────────────── */
describe('🔴 I9 · TRIP-454 AC-5 — 완성 CTA 를 누르면 h25 로 정확히 배선된다', () => {
  it('listed 에서 완성 버튼을 누르면 /trips/[tripId]/itinerary 로 tripId 를 실어 한 번 이동한다', async () => {
    renderPage();

    fireEvent.press(await screen.findByTestId('itinerary-draft-complete'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    // ★ 여기서는 **정확 일치**다(02a ★1·★2) — `'itinerary'` 부분문자열은 draft·generating
    //   경로에도 있어 substring 매칭이면 엉뚱한 곳으로 가도 통과한다. h25 는 접미 없는
    //   `/trips/[tripId]/itinerary` 다. 이 단언은 객체형 push(`{pathname, params}`)를 강제한다 —
    //   문자열 `'/trips/[tripId]/itinerary'` 는 `[tripId]` 미해결이라 깨진 형태다(리포 선례
    //   must-visits push 동형).
    const dest = mockPush.mock.calls[0][0] as {
      pathname?: string;
      params?: { tripId?: string };
    };
    expect(dest.pathname).toBe('/trips/[tripId]/itinerary');
    expect(dest.params?.tripId).toBe(TRIP_ID);
  });
});

/* ═════════════════════════ TRIP-466 · 확정 이후 유효하지 않은 액션 정리 ═════════════════════════
 * (a) 완성 CTA 확정 가드 + (c) onBack canGoBack 가드. 배선을 실 HTTP·목 라우터로 태운다.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('🔴 I10 · TRIP-466 AC-a1 — CONFIRMED 면 완성 CTA 가 잠기고 라우팅이 0 건이다', () => {
  it('status=CONFIRMED 면 완성 버튼이 비활성이고 눌러도 router.push 가 0 건이다', async () => {
    /**
     * ⚠️ 확정 일정에서 완성 CTA 가 눌리면 안 되는 이유는 완성이 곧 다음 화면 이동이라, 확정 이후
     * 흐름에서 어긋난 액션이 살아 있는 것이다(브리프 (a)). 완성 CTA 는 `router.push` 로만 이동하므로
     * `toBeDisabled()` 와 **push 0 건**을 짝으로 잰다(회색인데 눌리는 함정 회피 · 02a ★2).
     * 초기 로딩엔 `data===undefined` 라 canRetry 가 잠깐 true 다 → settle 대기가 필수(★7, I3 동형).
     */
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        status: 'CONFIRMED',
      });

    renderPage();

    const complete = await screen.findByTestId('itinerary-draft-complete');
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-draft-complete')).toBeDisabled()
    );

    fireEvent.press(complete);
    await sleep(50);

    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 I11 · TRIP-466 AC-a3 — 생성 중(PARTIAL) 은 잠기지 않는다 (선제 green · 과잉잠금 트립와이어)', () => {
  it('generationState=PARTIAL(status PLANNED) 이면 완성 버튼이 활성이고 눌러 이동한다', async () => {
    /**
     * ★ canRetry 재사용의 정확성을 지키는 심판(02a ★1 · 브리프 맹점 ④). PARTIAL 은 generationState
     * 이고 status 는 여전히 PLANNED 라 canRetry=`PLANNED !== 'CONFIRMED'`=true → 완성 CTA 활성.
     * 지금도 green(잠금 0)이고 구현 후에도 green 이어야 한다 — 구현자가 "CONFIRMED 만"을 "생성
     * 중도 막음"으로 넓히면(예: canRetry 에 PARTIAL 배제를 곱함) 이 케이스가 red 로 전환된다.
     */
    itineraryScript = () =>
      itinerary({
        dayCount: 1,
        generationState: 'PARTIAL',
        status: 'PLANNED',
      });

    renderPage();

    const complete = await screen.findByTestId('itinerary-draft-complete');
    await waitFor(() =>
      expect(screen.getByTestId('itinerary-draft-complete')).toBeEnabled()
    );

    fireEvent.press(complete);

    // 활성이라 실제로 이동한다 — 목적지 정확일치는 AC-a2(기존 I9) 소관, 여기선 "잠기지 않았다"만.
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  });
});

/* ───────────────────────── TRIP-466 · (c) onBack canGoBack 가드 ─────────────────────────
 * 두 뒤로가기(ZeroCandidateScreen `itinerary-draft-zero-back` · DraftScreen `itinerary-draft-back`)가
 * 딥링크로 콜드 오픈돼 히스토리가 없으면(canGoBack()===false) 침묵 no-op 이 아니라 홈으로 replace 한다
 * (INV-4). 히스토리가 있으면(true) 이전 화면으로 back. 얼굴은 실 HTTP 로 강제한다(훅 목킹 금지).
 * ─────────────────────────────────────────────────────────────────────────── */

/** 두 얼굴과 각 얼굴의 뒤로 버튼·얼굴 마커. zero 는 `days:[]+요약객체`(I4 FACE_ROWS 2행이 zero 임을
 * 이미 증명), listed 는 기본 script. */
const BACK_CASES: {
  face: 'zero' | 'listed';
  backTestId: string;
  faceMarker: string;
  script: () => Itinerary;
}[] = [
  {
    face: 'zero',
    backTestId: 'itinerary-draft-zero-back',
    faceMarker: 'itinerary-draft-zero',
    script: () =>
      itinerary({
        dayCount: 0,
        generationState: 'COMPLETE',
        days: [],
        candidatesSummary: { level: 'LOW' },
      }),
  },
  {
    face: 'listed',
    backTestId: 'itinerary-draft-back',
    faceMarker: 'itinerary-draft-complete',
    script: () => itinerary({ dayCount: 3, generationState: 'COMPLETE' }),
  },
];

describe('🔴 I12 · TRIP-466 AC-c1 — 딥링크(canGoBack=false) 면 홈으로 replace 한다', () => {
  it.each(BACK_CASES)(
    '$face 얼굴에서 뒤로가기를 누르면 /(tabs) 로 replace 하고 back 은 0 건이다',
    async ({ backTestId, faceMarker, script }) => {
      itineraryScript = script;
      mockCanGoBack.mockReturnValue(false);

      renderPage();
      await screen.findByTestId(faceMarker);

      fireEvent.press(screen.getByTestId(backTestId));

      // 홈 목적지 자체를 잠근다 — `/(tabs)/itinerary` 는 trips[0] 리다이렉트 함정이라 금지
      // (`ItineraryPlanPage.escape` AC-4 동형). 침묵 no-op 도, back+replace 이중호출도 아님.
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      expect(mockBack).not.toHaveBeenCalled();
    }
  );
});

describe('I13 · TRIP-466 AC-c2 — 히스토리 있으면(canGoBack=true) 이전 화면으로 back (선제 green · 무회귀)', () => {
  it.each(BACK_CASES)(
    '$face 얼굴에서 뒤로가기를 누르면 router.back() 이고 replace 는 0 건이다',
    async ({ backTestId, faceMarker, script }) => {
      // 현행 `() => router.back()` 이 canGoBack=true 기대와 이미 일치 → 구현 전후 green(무회귀 앵커).
      itineraryScript = script;
      mockCanGoBack.mockReturnValue(true);

      renderPage();
      await screen.findByTestId(faceMarker);

      fireEvent.press(screen.getByTestId(backTestId));

      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
    }
  );
});
