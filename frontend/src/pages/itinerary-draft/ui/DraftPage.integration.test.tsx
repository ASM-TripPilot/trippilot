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
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

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
  it('PARTIAL 이면 2초 뒤 다시 조회해 COMPLETE 셸(h08)로 바뀌고, COMPLETE 뒤에는 요청이 더 안 나간다 (TRIP-792 플립)', async () => {
    // 준비 — 첫 조회는 day1 만 담긴 PARTIAL, 그 다음부터 3일 전부 담긴 COMPLETE.
    itineraryScript = (call) =>
      call === 0
        ? itinerary({ dayCount: 1, generationState: 'PARTIAL' })
        : itinerary({ dayCount: 3, generationState: 'COMPLETE' });

    renderPage();

    // 단언 ① — PARTIAL 이면 셸 얼굴이 뜨고, 진행 카드 게이지는 **3셀**이다(여행 기간 3에서
    //          도출). `days.length`(=1) 로 셌다면 cell-3 이 없다(01b D7 의 급소 — 옛 "탭 3개
    //          disabled" 심판을 셸 게이지 3셀로 이관, TRIP-790). 셸이라 일차 칩은 없다(★2).
    await screen.findByTestId('generation-progress-card');
    expect(
      screen.getByTestId('generation-gauge-cell-3-waiting')
    ).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]);

    // 단언 ② — 폴링이 실제로 돈다. 2초 뒤 두 번째 조회가 나가 **깨끗한 COMPLETE → h08 셸**로 바뀐다
    //          (TRIP-792 D1-R NARROW). 전환 증거: h07 진행 카드가 사라지고 h08 day-chip 오버레이가
    //          뜬다(두 셸 다 map-sheet-shell-root 라 그건 전환 마커로 못 쓴다 — 오버레이로 가른다).
    await waitFor(
      () => expect(screen.queryByTestId('generation-progress-card')).toBeNull(),
      { timeout: DRAFT_POLL_INTERVAL_MS * 3 }
    );
    expect(screen.getByTestId('sheet-daychip-0')).toBeOnTheScreen(); // h08 day-chip
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

    // TRIP-792 플립 — 깨끗한 COMPLETE·PLANNED → h08 셸. 재생성은 이제 셸의 '다시 짜기'(cta[0]).
    const retry = await screen.findByTestId('sheet-cta-button-0');
    expect(retry).toHaveTextContent('다시 짜기');
    // 배선이 mount 시 POST 를 내든 안 내든 상관없게 **누르기 직전 값과의 차이**를 잰다.
    const before = hitsFor('POST', '/itinerary');

    fireEvent.press(retry);

    await waitFor(() => expect(hitsFor('POST', '/itinerary')).toBe(before + 1));
  });

  it('🔴 CONFIRMED 면 다시 짜기를 눌러도 재생성 POST 가 0건이다 — 확정이 풀리면 되돌릴 수 없다 (TRIP-792 플립)', async () => {
    /**
     * ⚠️ openapi POST 원문: *"확정 일정에 호출하면 확정이 풀리고 PLANNED 새 일정으로 대체되며,
     * 동결됐던 poi_snapshot 참조는 사라진다."* 확정 해제 API 는 없다 — 되돌릴 방법이 없다.
     * TRIP-792 플립: CONFIRMED·깨끗한 COMPLETE 도 narrow 조건상 h08 셸로 간다(status 는 조건에
     * 없음). 셸의 CtaBar 는 disabled prop 이 없어(회색 잠금 없음) **진짜 방어는 handleRetry 의
     * CONFIRMED early-return**이다 — '다시 짜기'(cta[0])를 눌러도 **나간 POST 0건**으로 그 방어를 잰다.
     */
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        status: 'CONFIRMED',
      });

    renderPage();

    const retry = await screen.findByTestId('sheet-cta-button-0');
    expect(retry).toHaveTextContent('다시 짜기');

    fireEvent.press(retry);
    await sleep(50);

    expect(hitsFor('POST', '/itinerary')).toBe(0);
  });
});

/* ═════════════════════════ TRIP-791 · 폴백 인터스티셜 라우팅 (배너·zero 흡수) ═════════════════════════
 * TRIP-304 폴백 배너 3종과 TRIP-298 h35 후보 0건이 전용 인터스티셜 화면(GenerationFallbackScreen)
 * 하나로 합쳐졌다. DraftPage 는 `resolveFallbackNotice(...)` 가 non-null 이면 그 화면으로 라우팅한다
 * (01b D1). 곁줄 배너·zero 화면·zero 분기는 사라진다.
 *
 * 왜 통합 버킷인가: solveMode·isFallback·candidatesSummary 세 신호가 배선을 타고 **인터스티셜로
 * 이어지는지**는 model 도 screen 도 못 본다. 규칙(F-1~F-7)은 `draftView.fallback.test.ts` 가,
 * 화면(카피·체크리스트·CTA)은 `GenerationFallbackScreen.test.tsx` 가 따로 잰다 — 여기는 응답 한 벌이
 * 실제로 인터스티셜/기존 얼굴로 갈렸는지다. (하드실패 라우팅은 이 사이클 DraftPage 무심판 — 02a §3.)
 */

const INTERSTITIAL = 'itinerary-fallback-root';

/** AC-10 — 폴백 신호 세 축이 오면 인터스티셜로 라우팅된다(deterministic·minimal·demoted). */
const SIGNAL_ROWS: {
  name: string;
  solveMode: ItinerarySolveMode;
  isFallback: boolean;
  summary?: ItineraryCandidatesSummary;
}[] = [
  {
    name: 'DETERMINISTIC + isFallback=true → 인터스티셜',
    solveMode: 'DETERMINISTIC',
    isFallback: true,
    summary: undefined,
  },
  {
    name: 'MINIMAL + isFallback=true → 인터스티셜',
    solveMode: 'MINIMAL',
    isFallback: true,
    summary: undefined,
  },
  {
    name: 'LOW 강등(FULL_AI·isFallback=false)도 인터스티셜',
    solveMode: 'FULL_AI',
    isFallback: false,
    summary: { level: 'LOW' },
  },
];

describe('🔴 I4 · AC-10 — 폴백 신호가 오면 인터스티셜로 라우팅된다 (INV-4 파수꾼 이관)', () => {
  it.each(SIGNAL_ROWS)('$name', async ({ solveMode, isFallback, summary }) => {
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        solveMode,
        isFallback,
        candidatesSummary: summary,
      });

    renderPage();

    // ① 폴백 신호는 인터스티셜로 이어진다(배너·zero·셸 아님).
    expect(await screen.findByTestId(INTERSTITIAL)).toBeOnTheScreen();

    // ② ★ 기존 얼굴로 새지 않는다 — h08 셸·초안 카드가 동시에 뜨지 않는다(상호배타).
    //    testID 접두 분리(`itinerary-fallback-*` ↔ `itinerary-draft-*`)라 cardTestIds 가 인터스티셜을
    //    오계수하지 않는다(01b ★). 배너 testID 는 이제 화면 어디에도 없다.
    expect(screen.queryAllByTestId('map-sheet-shell-root')).toEqual([]);
    expect(screen.queryAllByTestId('itinerary-draft-fallback-banner')).toEqual(
      []
    );
    expect(cardTestIds()).toEqual([]);
  });
});

describe('I5 · AC-10 F-7 이관 — MANUAL(MINIMAL·isFallback=false)은 인터스티셜로 안 간다 (선제 green · 무회귀)', () => {
  it('MANUAL 은 실패가 아니라 선택이라 인터스티셜 대신 깨끗한 COMPLETE 얼굴(h08 셸)로 간다', async () => {
    // `resolveFallbackNotice(MINIMAL, false)===null`(F-7)이라 現 코드도 이미 셸 → 구현 전후 green.
    // F-7 방어가 화면 승격 뒤에도 **안 흔들림**을 잠근다(직접 만들기 빈 일정에 거짓 폴백 안내 금지).
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        solveMode: 'MINIMAL',
        isFallback: false,
      });

    renderPage();

    // 긍정 앵커 — 셸 슬롯 카드가 정상으로 떴다(빈 화면이 아래 부정 단언을 공짜로 통과하는 것 방지).
    await waitFor(() =>
      expect(screen.queryAllByTestId(/^slot-stopcard-/).length).toBeGreaterThan(
        0
      )
    );
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    // 부정 — 인터스티셜로 새지 않았다(F-7: isFallback=false=선택, 폴백 아님).
    expect(screen.queryAllByTestId(INTERSTITIAL)).toEqual([]);
  });
});

describe('🔴 I6 · 01b D3 — "기본 일정 보기"는 로컬 dismiss 로 기존 초안 목록을 연다', () => {
  it('인터스티셜에서 "기본 일정 보기"를 누르면 인터스티셜이 사라지고 초안 목록이 배너 없이 뜬다', async () => {
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        solveMode: 'DETERMINISTIC',
        isFallback: true,
      });

    renderPage();

    // 인터스티셜에서 주 CTA press.
    fireEvent.press(await screen.findByTestId('itinerary-fallback-view-plan'));

    // ① 인터스티셜이 감춰지고 초안 목록이 뜬다(같은 데이터 · route push 아님, 01b D3).
    await waitFor(() =>
      expect(screen.queryAllByTestId(INTERSTITIAL)).toEqual([])
    );
    expect(cardTestIds().length).toBeGreaterThan(0);

    // ② 초안 목록엔 폴백 배너가 없다 — DraftScreen 은 목록만 남는다(배너 승격, 화면 어디에도 0건).
    expect(screen.queryAllByTestId('itinerary-draft-fallback-banner')).toEqual(
      []
    );

    // ③ dismiss 는 라우팅이 아니다(route push 0 · 로컬 상태 토글).
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('I7 · AC-5 — 폴백 신호 없는 빈 응답은 빈 화면이다 (선제 green · 무회귀)', () => {
  it('일자 없음 + 요약 없음 → 인터스티셜·셸 아닌 빈 화면', async () => {
    // 現 코드도 이 조합은 빈 얼굴이라 구현 전후 green — 폴백/zero 승격이 빈 얼굴을 안 건드림을 잠근다.
    itineraryScript = () =>
      itinerary({
        dayCount: 0,
        generationState: 'COMPLETE',
        days: [],
        candidatesSummary: undefined,
      });

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('itinerary-draft-empty')).toBeOnTheScreen()
    );
    expect(screen.queryAllByTestId(INTERSTITIAL)).toEqual([]);
    expect(screen.queryAllByTestId('map-sheet-shell-root')).toEqual([]);
  });
});

/* ───────────────────────── TRIP-454 · h11→h25 완성 CTA 배선 ─────────────────────────
 * 화면(DraftScreen)은 완성 버튼을 그리고 `onComplete` 만 부른다 — **어디로 가는지**는 이 배선의
 * 책임이자 심판이다. 기본 시나리오(COMPLETE·PLANNED·3일 = listed 얼굴)에서 CTA 를 눌러 h25 로
 * 정확히 가는지 잰다.
 * ─────────────────────────────────────────────────────────────────────────── */
describe('🔴 I9 · TRIP-454 AC-5 / TRIP-792 AC-2 — 확정 CTA 를 누르면 h25 로 정확히 배선된다', () => {
  it('h08 셸에서 확정하기(cta[1])를 누르면 /trips/[tripId]/itinerary 로 tripId 를 실어 한 번 이동한다', async () => {
    renderPage();

    // TRIP-792 플립 — 깨끗한 COMPLETE → h08 셸. 완성 CTA 는 셸의 '확정하기'(cta[1]).
    const confirm = await screen.findByTestId('sheet-cta-button-1');
    expect(confirm).toHaveTextContent('확정하기');
    fireEvent.press(confirm);

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

describe('🔴 I10 · TRIP-466 AC-a1 / TRIP-792 — CONFIRMED 도 h08 셸로 가되 확정을 푸는 재생성은 막힌다', () => {
  it('status=CONFIRMED 면 h08 셸이 뜨고, 다시 짜기를 눌러도 재생성 POST 가 0 건이다', async () => {
    /**
     * ⚠️ 확정 일정에서 재생성 POST 가 나가면 확정이 풀리고 동결된 poi_snapshot 참조가 사라진다
     * (되돌릴 API 없음, 브리프 (a)). TRIP-792 플립: CONFIRMED·깨끗한 COMPLETE 도 narrow 조건상
     * h08 셸로 간다(확정하기는 h14 조회로의 무해한 이동일 뿐). **진짜 위험은 재생성**이고 그 방어는
     * handleRetry 의 CONFIRMED early-return 이다 — '다시 짜기'(cta[0]) press → **POST 0건**으로 잰다.
     */
    itineraryScript = () =>
      itinerary({
        dayCount: 3,
        generationState: 'COMPLETE',
        status: 'CONFIRMED',
      });

    renderPage();

    // 셸이 떴다(CONFIRMED 도 깨끗하면 셸) — 그 위에서 재생성 방어를 잰다.
    await screen.findByTestId('map-sheet-shell-root');
    const retry = screen.getByTestId('sheet-cta-button-0');
    expect(retry).toHaveTextContent('다시 짜기');

    fireEvent.press(retry);
    await sleep(50);

    expect(hitsFor('POST', '/itinerary')).toBe(0);
  });
});

describe('🔴 I11 · TRIP-790 D9 — 생성 중(PARTIAL)엔 확정/완성 CTA 가 없다 (계약 플립)', () => {
  it('generationState=PARTIAL 이면 셸 얼굴이 뜨고 완성 CTA·CTA 바가 0건이다', async () => {
    /**
     * ★ 계약 플립(02a ★1·§6). 옛 계약은 "PARTIAL 도 완성 CTA 활성"이었으나, D1(PARTIAL→셸)·
     * D9(생성 중 CTA 없음)로 뒤집힌다 — 생성 중엔 확정할 완성본이 없어 CTA 자체를 안 그린다
     * (셸 `cta` 미전달). 현행은 PARTIAL 에 DraftScreen 완성 CTA 를 그려 이 부재 단언이 red,
     * 셸 전환 후 green. "과잉잠금"이 아니라 "표면 자체 부재"로 바뀐 것이다.
     */
    itineraryScript = () =>
      itinerary({
        dayCount: 1,
        generationState: 'PARTIAL',
        status: 'PLANNED',
      });

    renderPage();

    // 셸 얼굴이 떴다(진행 카드) — 그 위에서 CTA 부재를 잰다.
    await screen.findByTestId('generation-progress-card');

    expect(screen.queryByTestId('itinerary-draft-complete')).toBeNull();
    expect(screen.queryByTestId('sheet-cta-root')).toBeNull();
    // 짝 — CTA 가 없어도 이동은 애초에 일어나지 않는다(생성 중 확정 경로 자체가 없음).
    expect(mockPush).not.toHaveBeenCalled();
  });
});

/* ───────────────────────── TRIP-466 · (c) onBack canGoBack 가드 ─────────────────────────
 * h08 셸 뒤로가기(`sheet-daychip-back`)가 딥링크로 콜드 오픈돼 히스토리가 없으면(canGoBack()===false)
 * 침묵 no-op 이 아니라 홈으로 replace 한다(INV-4). 히스토리가 있으면(true) 이전 화면으로 back. 얼굴은
 * 실 HTTP 로 강제한다(훅 목킹 금지). ※ zero 뒤로가기는 TRIP-791 로 화면과 함께 소멸.
 * ─────────────────────────────────────────────────────────────────────────── */

/** 얼굴과 뒤로 버튼·얼굴 마커. TRIP-791 로 zero 화면·분기가 소멸해 이 축은 h08 셸 하나만 남는다
 * (zero 뒤로가기 가드는 화면과 함께 사라졌다 — DraftScreen 뒤로가기는 별도 계약). */
const BACK_CASES: {
  face: 'shell';
  backTestId: string;
  faceMarker: string;
  script: () => Itinerary;
}[] = [
  {
    // TRIP-792 플립 — 깨끗한 COMPLETE 는 h08 셸. 뒤로가기는 DayChipOverlay 의 back
    // (`sheet-daychip-back` → onBack=handleBack). faceMarker 도 셸 루트로.
    face: 'shell',
    backTestId: 'sheet-daychip-back',
    faceMarker: 'map-sheet-shell-root',
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
