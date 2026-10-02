import type { ReactNode } from 'react';
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

import { server } from '@/mocks/server';
import { DRAFT_POLL_INTERVAL_MS } from '@/features/itinerary';
import type {
  Itinerary,
  ItineraryCandidatesSummary,
  ItineraryDaysItem,
  ItineraryGenerationState,
  ItinerarySolveMode,
  ItineraryStatus,
  Trip,
  ItineraryDaysItemSlotsItem,
  ItineraryGenerationMode,
  GenerationSession,
  ItineraryUnplacedMustVisitsItem,
  SavedPlace,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { buildSlotKey } from '@/entities/itinerary-slot';
import { AlertCircleGlyph, CheckCircleGlyph } from '@/features/itinerary';

import { DraftPage } from './DraftPage';

/**
 * h07/h08 초안(DraftPage) — **실 훅 + MSW** 통합 테스트(TRIP-1150 에서 열두 파일을 한 파일로 합쳤다).
 *
 * 옛 파일 하나 = 바깥 describe 하나다. 안쪽 describe·it 이름과 각 파일의 픽스처·기본 MSW 핸들러
 * (describe 의 beforeEach)는 그대로다 — 기본 핸들러를 최상위로 올리면 다른 관점이 처리하지 않던 요청까지
 * 답해 주게 되므로(onUnhandledRequest:'error' 그물이 넓어진다) 각 describe 안에 둔다. 3000줄이 넘어도
 * 쪼개지 않는다(README 판정 4 · 배치 결정).
 *
 * 합치며 바뀐 장치(02a ★): 서버 listen/close 는 최상위 한 번. 라우터 목은 `push`·`back`·`replace`·
 * `canGoBack` 을 모두 기록한다(canGoBack 기본 true). 옛 `.baseline`·`.gaugeFold`·`.partial` 목에는
 * `canGoBack` 이 없어 페이지가 부르면 TypeError 로 red 였다 — 그 그물을 잃지 않게 세 describe 는
 * `canGoBack` 0회를 afterEach 로 명시 단언한다.
 *
 * 3동작 뼈대: 준비 = MSW 핸들러·토큰 → 실행 = 페이지 렌더·버튼 press → 단언 = 보이는 것·나간 요청·이동.
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

// jest.mock 팩토리는 파일 맨 위로 끌어올려지므로 바깥 변수를 못 본다 — 이름이 `mock` 으로
// 시작하는 변수만 예외다(리포 확립 규칙).
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
// TRIP-466 — onBack 가드가 `router.canGoBack()` 을 쓴다. 딥링크(canGoBack=false) 케이스만 각 테스트에서 뒤집는다.
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

// 지도는 이 칸의 심판 대상이 아니다 — 남는 props 를 통과시키는 관찰 마커(map-root)로 바꾼다.
// 셸이 `center` 를 반드시 넘겨야 이 목이 `center.lat` 접근에서 안 죽는다(DraftPage 배선 강제).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockClear();
  mockCanGoBack.mockReturnValue(true);
});

afterAll(() => server.close());

// TRIP-466 · 옛 DraftPage.integration.test.tsx(본 파일)
describe('2단계 생성 폴링 · 다시 시도 · 폴백 라우팅 · 확정 CTA · 뒤로가기', () => {
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
      baseCount: 0,
      itineraryDayCount: 0,
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
          alternatives: [],
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

  /** 생성 화면(`/trips/[tripId]/itinerary/generating`)으로 간 라우터 호출 수 — replace·push 모두 센다(TRIP-1037). */
  function generatingMoves(): number {
    return [...mockReplace.mock.calls, ...mockPush.mock.calls].filter(
      ([arg]) =>
        typeof arg === 'object' &&
        arg !== null &&
        (arg as { pathname?: string }).pathname ===
          '/trips/[tripId]/itinerary/generating'
    ).length;
  }

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
      // I1 이 합친 파일의 첫 테스트라 냉시작(모듈 첫 로드)을 흡수한다 — CI 에서 기본 1000ms 를 넘겨
      // I1 만 red(PR #862 CI 2회). TRIP-1144 `SavedPlacesPage` 첫 목록 대기와 같은 5000ms.
      await screen.findByTestId(
        'generation-progress-card',
        {},
        { timeout: 5000 }
      );
      expect(
        screen.getByTestId('generation-gauge-cell-3-waiting')
      ).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]);

      // 단언 ② — 폴링이 실제로 돈다. 2초 뒤 두 번째 조회가 나가 **깨끗한 COMPLETE → h08 셸**로 바뀐다
      //          (TRIP-792 D1-R NARROW). 전환 증거: h07 진행 카드가 사라지고 h08 day-chip 오버레이가
      //          뜬다(두 셸 다 map-sheet-shell-root 라 그건 전환 마커로 못 쓴다 — 오버레이로 가른다).
      await waitFor(
        () =>
          expect(screen.queryByTestId('generation-progress-card')).toBeNull(),
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
    it('FAILED 응답에도 day1 카드가 셸에 남고 시트 안 안내가 곁에 붙는다 (TRIP-1039 — 목록 → 셸)', async () => {
      // 준비 — openapi: "FAILED=2차 실패(**1차분은 유효**)". 받은 것까지 버리면 사용자는
      // 아무것도 없는 화면을 보고 다시 생성하는 수밖에 없다.
      itineraryScript = () =>
        itinerary({ dayCount: 1, generationState: 'FAILED' });

      renderPage();

      // ① 실패가 삼켜지지 않았다.
      expect(
        await screen.findByTestId(
          'itinerary-draft-stale-failed',
          {},
          { timeout: 4000 }
        )
      ).toBeOnTheScreen();

      // ② 목록이 지워지지 않았다 — 1일차 슬롯이 셸 카드로 그려진다(TRIP-1039).
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^slot-stopcard-/).length).toBeGreaterThan(
        0
      );
      // ③ 전면 실패 얼굴로 갈아 끼우지 않았다.
      expect(screen.queryAllByTestId('itinerary-draft-failed')).toEqual([]);
    });
  });

  describe('🔴 I3 · AC-11 — 다시 시도는 PLANNED 에서만 생성 화면으로 보낸다 (01b D8 · TRIP-1037 플립)', () => {
    it('PLANNED 면 누를 때 생성 화면으로 replace 1회 · 초안 화면 POST 0', async () => {
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
      fireEvent.press(retry);

      // TRIP-1037 — 재생성 POST 는 생성 화면이 마운트될 때 1회 보낸다. 초안 화면은 이동만 한다.
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/generating',
        params: { tripId: TRIP_ID, mode: 'FULLY_AI' },
      });
      await sleep(300);
      expect(hitsFor('POST', '/itinerary')).toBe(0);
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
      // TRIP-1037 — 초안 화면은 이제 어떤 경우에도 POST 를 안 보내 위 단언만으론 공허하다. 확정 가드의
      // 실체는 "생성 화면으로 보내지 않는다" 다(생성 화면이 마운트되면 POST 가 나가 확정이 풀린다).
      expect(generatingMoves()).toBe(0);
    });
  });

  /* ═════════════════════════ TRIP-791 · 폴백 인터스티셜 라우팅 (배너·zero 흡수) ═════════════════════════
   * TRIP-304 폴백 배너 3종과 TRIP-298 h35 후보 0건이 전용 인터스티셜 화면(GenerationFallbackScreen)
   * 하나로 합쳐졌다. DraftPage 는 `resolveFallbackNotice(...)` 가 non-null 이면 그 화면으로 라우팅한다
   * (01b D1). 곁줄 배너·zero 화면·zero 분기는 사라진다.
   *
   * 왜 통합 버킷인가: solveMode·isFallback·candidatesSummary 세 신호가 배선을 타고 **인터스티셜로
   * 이어지는지**는 model 도 screen 도 못 본다. 규칙(F-1~F-7)은 `draftView.test.ts` 「폴백·강등 배너 판정」 가,
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
    it.each(SIGNAL_ROWS)(
      '$name',
      async ({ solveMode, isFallback, summary }) => {
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
        expect(
          screen.queryAllByTestId('itinerary-draft-fallback-banner')
        ).toEqual([]);
        expect(cardTestIds()).toEqual([]);
      }
    );
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
        expect(
          screen.queryAllByTestId(/^slot-stopcard-/).length
        ).toBeGreaterThan(0)
      );
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      // 부정 — 인터스티셜로 새지 않았다(F-7: isFallback=false=선택, 폴백 아님).
      expect(screen.queryAllByTestId(INTERSTITIAL)).toEqual([]);
    });
  });

  describe('🔴 I6 · 01b D3 — "기본 일정 보기"는 로컬 dismiss 로 같은 데이터의 초안 셸을 연다', () => {
    it('인터스티셜에서 "기본 일정 보기"를 누르면 인터스티셜이 사라지고 셸이 폴백 안내와 함께 뜬다 (TRIP-1039 플립)', async () => {
      itineraryScript = () =>
        itinerary({
          dayCount: 3,
          generationState: 'COMPLETE',
          solveMode: 'DETERMINISTIC',
          isFallback: true,
        });

      renderPage();

      // 인터스티셜에서 주 CTA press.
      fireEvent.press(
        await screen.findByTestId(
          'itinerary-fallback-view-plan',
          {},
          { timeout: 4000 }
        )
      );

      // ① 인터스티셜이 감춰지고 초안 셸이 뜬다(같은 데이터 · route push 아님, 01b D3).
      await waitFor(() =>
        expect(screen.queryAllByTestId(INTERSTITIAL)).toEqual([])
      );
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^slot-stopcard-/).length).toBeGreaterThan(
        0
      );

      // ② 셸 시트 안에 폴백 안내가 1개 붙는다 — 폴백 사실은 dismiss 뒤에도 계속 보인다(BR-U3-11 ·
      //    INV-4 · TRIP-1039). 옛 계약(TRIP-791: dismiss 뒤 배너 0)을 뒤집었다.
      expect(
        screen.queryAllByTestId('itinerary-draft-fallback-banner')
      ).toHaveLength(1);

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
      // TRIP-1037 — 초안 화면은 이제 어떤 경우에도 POST 를 안 보내 위 단언만으론 공허하다. 확정 가드의
      // 실체는 "생성 화면으로 보내지 않는다" 다(생성 화면이 마운트되면 POST 가 나가 확정이 풀린다).
      expect(generatingMoves()).toBe(0);
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
});

// TRIP-1006 (C) #084 · 옛 DraftPage.baseline.integration.test.tsx
describe('폴링 상한 기준점', () => {
  /**
   * TRIP-1006 (C) · 초안 화면의 폴링 상한을 **이번 마운트부터** 센다(#084).
   *
   * 무엇이 문제였나: 폴링 횟수(`dataUpdateCount`)는 화면 것이 아니라 **캐시 속 쿼리 하나의 것**이라, 같은
   * 일정을 보는 모든 화면이 함께 올린다. 같이 짜기 화면이 생성 중(PARTIAL) 일정을 2초마다 수백 번 부른
   * 뒤 초안 화면이 새로 열리면, 카운터는 이미 상한(30)을 넘어 있다. 초안 화면이 0부터 셌기 때문에 열자마자
   * "상한 도달"로 판정해 **폴링을 아예 시작하지 않았고**, 서버가 생성을 끝내도 화면은 "생성 중"에 멈췄다.
   *
   * 무엇을 보장하나:
   *  - 🔴 C1 캐시 카운터가 이미 31인 상태에서 열려도 폴링을 시작하고, 서버가 COMPLETE 를 내면 결과
   *    얼굴(h08 — 확정 CTA 바)로 넘어간다.
   *  - 🟢 C2 (회귀) 이번 마운트 뒤 PARTIAL 이 30회 쌓이면 여전히 멈춘다 — 상한을 없애는 식으로 C1 을
   *    고치면 여기서 red(02a ★9).
   *
   * *(개념)* `setQueryData` — 서버를 안 거치고 캐시에 응답을 직접 넣는다. 넣을 때마다 그 쿼리의
   *   `dataUpdateCount` 가 1씩 오른다(02a §5). 다른 화면이 폴링으로 올린 카운터를 이걸로 흉내 낸다.
   *
   * 3동작: 준비 = 캐시 카운터를 미리 올리고 서버 응답 순서를 정한다 → 실행 = 초안 화면을 연다 →
   *   단언 = 얼굴이 넘어가는가 / 요청 수가 멈췄는가.
   */

  // 옛 목엔 canGoBack 이 없어 부르면 TypeError 로 red 였다 — 합친 목에서도 그 그물을 남긴다(TRIP-1150).
  afterEach(() => {
    expect(mockCanGoBack).not.toHaveBeenCalled();
  });

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '66666666-6666-6666-6666-666666666666';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';
  const ITINERARY_KEY = getGetTripsTripIdItineraryQueryKey(TRIP_ID);

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '부산 2일',
      startDate: DAY1,
      endDate: DAY2,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 1 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function day(date: string): ItineraryDaysItem {
    return {
      date,
      slots: [
        {
          poiId: `poi-${date}`,
          nameKo: '광안리 해변',
          category: '자연',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          alternatives: [],
          tags: [],
          imageUrl: null,
          distanceRange: null,
          lat: 35.153,
          lng: 129.118,
        },
      ],
    };
  }

  /** PARTIAL 은 1일차만, COMPLETE 는 2일 전부. */
  function itinerary(generationState: ItineraryGenerationState): Itinerary {
    return {
      itineraryId: 'itin-baseline',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'CO_PLAN',
      generationState,
      isFallback: false,
      days:
        generationState === 'PARTIAL' ? [day(DAY1)] : [day(DAY1), day(DAY2)],
    };
  }

  let getCalls = 0;
  /** GET 번호(1부터)를 받아 응답할 생성 상태를 정한다. */
  let stateForCall: (call: number) => ItineraryGenerationState;

  beforeEach(() => {
    getCalls = 0;
    stateForCall = () => 'PARTIAL';
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => {
        getCalls += 1;
        return HttpResponse.json(itinerary(stateForCall(getCalls)));
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /** `gcTime: Infinity` — 마운트 전에 채운 캐시가 관찰자 없이 다음 틱에 지워지면 카운터가 0부터
   * 다시 시작해 옛 코드도 통과한다(거짓 green, 02a ★7). */
  function newClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { gcTime: 0 },
      },
    });
  }

  function renderDraft(client: QueryClient) {
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  describe('🔴 C1 · 다른 화면이 이미 올린 카운터 위에서 열려도 폴링한다 (#084)', () => {
    it('캐시 카운터 31에서 열려도 다시 조회해 COMPLETE 를 받고 결과 얼굴로 넘어간다', async () => {
      // 준비 ① 같이 짜기 화면이 PARTIAL 을 31번 받아 둔 캐시를 흉내 낸다.
      const client = newClient();
      for (let i = 0; i < 31; i += 1) {
        client.setQueryData(ITINERARY_KEY, itinerary('PARTIAL'));
      }
      // 준비 자가검사 — 카운터가 정말 상한(30)을 넘었다(아니면 이 테스트는 아무것도 못 가른다).
      expect(client.getQueryState(ITINERARY_KEY)?.dataUpdateCount).toBe(31);
      // 준비 ② 서버는 첫 조회엔 아직 PARTIAL, 그다음부터 COMPLETE.
      stateForCall = (call) => (call === 1 ? 'PARTIAL' : 'COMPLETE');

      // 실행
      renderDraft(client);

      // 단언 ① 처음엔 캐시의 "생성 중" 얼굴(h07 진행 카드).
      await screen.findByTestId('generation-progress-card');
      // 단언 ② 폴링이 돌아 COMPLETE 를 받고 결과 얼굴(h08 확정 CTA 바)로 넘어간다.
      await waitFor(
        () => expect(screen.queryByTestId('sheet-cta-root')).not.toBeNull(),
        { timeout: DRAFT_POLL_INTERVAL_MS * 3 }
      );
      expect(screen.queryByTestId('generation-progress-card')).toBeNull();
      expect(getCalls).toBeGreaterThanOrEqual(2);
    }, 20000);
  });

  describe('🟢 C2 · (회귀) 이번 마운트 뒤 30회가 쌓이면 여전히 멈춘다', () => {
    it('마운트 뒤 PARTIAL 응답이 30회를 넘기면 한 간격이 지나도 GET 이 더 나가지 않는다', async () => {
      // 준비 — 빈 캐시에서 연다. 서버는 영영 PARTIAL(2차 생성이 멈춘 상황).
      const client = newClient();
      renderDraft(client);
      await screen.findByTestId('generation-progress-card');
      await waitFor(() => expect(getCalls).toBeGreaterThanOrEqual(1));

      // 실행 — 이번 마운트 뒤 30회 더 받은 것으로 만든다(60초를 기다리지 않으려고, 02a ★8).
      act(() => {
        for (let i = 0; i < 30; i += 1) {
          client.setQueryData(ITINERARY_KEY, itinerary('PARTIAL'));
        }
      });
      const callsAtCap = getCalls;

      // 단언 — 한 간격 넘게 흘려도 조회가 늘지 않는다(상한이 살아 있다).
      // act 로 감싸는 이유: 캐시 변경 알림이 다음 틱에 도착해 화면을 다시 그린다 — act 밖이면 경고가 난다.
      await act(async () => {
        await sleep(DRAFT_POLL_INTERVAL_MS + 400);
      });
      expect(getCalls).toBe(callsAtCap);
    }, 20000);
  });
});

// TRIP-467→483→793 · 옛 DraftPage.candidate.integration.test.tsx
describe('다른 후보 시트 배선', () => {
  /**
   * h08(DraftPage)에 슬롯 교체 **시트**를 배선하는 심판(TRIP-467→483→793 이관). 컨테이너 내부
   * (POST→라디오→확정 PUT→닫힘·재조회)는 `SlotCandidatePanelContainer.integration.test.tsx` 가 완결 —
   * 여기선 **트리거·토글·조건부 마운트** 페이지 층 배선만 잰다.
   *
   * TRIP-793 변경: 인라인 패널(`itinerary-candidate-panel`)이 바텀시트(`itinerary-candidate-sheet` +
   * scrim)로 바뀌었고, **h08 지도+시트 셸의 슬롯 "다른 후보 ›" 트리거(옛 no-op)를 처음 실배선**한다.
   * 세 얼굴 모두 이제 h08 지도+시트 셸이다(TRIP-1039 — 폴백·staleFailed 목록이 옛 `DraftScreen` 에서 셸로
   * 옮겨 왔다). 시트는 `DraftPage` 가 **셸의 형제(뒤)** 로 마운트한다(TRIP-983):
   *  - 경로1(h08 셸 · staleFailed) — `SlotStopCard` 의 `slot-stopcard-alt-{slotKey}` 가 시트를 연다.
   *    (옛 DraftScreen 트리거 `itinerary-draft-alt-*` 의 "같은 트리거 재press 로 접힘"(D5)은 DraftScreen
   *    전용 토글이라 프로덕션 도달 경로가 사라져 삭제했다 — 02a J5.)
   *  - 경로2(h08 셸 · clean COMPLETE) — 같은 트리거(첫 실배선, D7~D9).
   *  - 경로3(폴백 dismiss → 셸 · TRIP-983 QA #024 재현 · TRIP-1039 AC-11) — 시트가 셸 **밖**에, 트리 순서상
   *    모든 카드·「처음부터 직접 짜기」·CTA 두 버튼 **뒤**에 산다(F1·F2 짝). 실제 겹침·딤 터치 차단은 6-b 몫.
   *  - D6 — 「직접 고르기」는 DraftScreen 에 남는 empty 얼굴 헤더에서 manual 로 간다.
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=트리거/닫기/manual press → 단언=마운트·POST·push.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';

  /** 1일 여행 — 탭 흔들림·폴링을 피한다. */
  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 하루',
      startDate: DAY1,
      endDate: DAY1,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 0 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /** day1 = [고정 숙소(21:00) · 비고정 a · 비고정 b]. 고정은 트리거가 없어야 한다. */
  function days(): ItineraryDaysItem[] {
    return [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-fixed',
            startAt: '21:00:00',
            endAt: '22:00:00',
            isFixed: true,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '제주 신라스테이',
          },
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: ['바다'],
            nameKo: '성산일출봉',
          },
          {
            poiId: 'poi-b',
            startAt: '12:30:00',
            endAt: '13:30:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
            nameKo: '광안리',
          },
        ],
      },
    ];
  }

  /** 경로1 — staleFailed(FAILED+슬롯). fallbackNotice=null(FULL_AI·isFallback false)이라 인터스티셜을
   * 건너뛰고 h08 셸로 간다(TRIP-1039 — 옛 계약은 DraftScreen). staleFailed 안내가 시트 안에 붙지만
   * alt 트리거·시트 계약엔 영향 없다. */
  function staleFailedItinerary(): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'FAILED',
      isFallback: false,
      days: days(),
    };
  }

  /** 경로2 — 깨끗한 COMPLETE. isPartial=false·staleFailed=false·fallbackNotice=null 이라 h08 지도+시트
   * 셸(MapSheetShell) 분기로 떨어진다(SlotStopCard 의 alt 트리거가 시트를 여는 유일 경로). */
  function cleanItinerary(): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: days(),
    };
  }

  const CANDIDATES = {
    candidates: [
      { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
      { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
    ],
    radiusMUsed: 1100,
    degraded: false,
  };

  let postCalls = 0;
  let postBody: unknown = null;

  const SHEET = 'itinerary-candidate-sheet';

  /** 네트워크 응답을 기다리는 첫 조회 한도 — 로컬 기본 1000ms 의 CI 러너(약 4배 느림) 환산. */
  const WAIT = { timeout: 4000 };

  /** h08 셸 SlotStopCard 트리거 — fieldId 규약 `slot-stopcard-${role}-${slotKey}`(role 이 앞). */
  function stopcardAltId(poiId: string): string {
    return `slot-stopcard-alt-${buildSlotKey(DAY1, poiId)}`;
  }
  function stopcardId(poiId: string): string {
    return `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;
  }

  beforeEach(() => {
    postCalls = 0;
    postBody = null;
    mockPush.mockClear();
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      // 기본은 경로1(staleFailed). 경로2 는 각 it 에서 server.use 로 덮는다.
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(staleFailedItinerary())
      ),
      http.post(
        `${BASE}/trips/:tripId/itinerary/slot-candidates`,
        async ({ request }) => {
          postCalls += 1;
          postBody = await request.json();
          return HttpResponse.json(CANDIDATES);
        }
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

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
    return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  // ─── 경로1: h08 셸(staleFailed) · 형제 마운트 (TRIP-1039 — 옛 DraftScreen 경로) ───────────
  describe('🔴 D1 · AC-1 — 배선 전엔 시트가 없다 (조건부 마운트 · staleFailed 셸 경로)', () => {
    it('아무 트리거도 누르기 전엔 시트가 트리에 없고 slot-candidates POST 도 0건이다', async () => {
      renderPage();
      await screen.findByTestId(stopcardId('poi-a'), {}, WAIT);

      expect(screen.queryByTestId(SHEET)).toBeNull();
      expect(postCalls).toBe(0);
    });
  });

  describe('🔴 D2 · AC-1 — 비고정 트리거 press → 시트 마운트(+scrim) + 그 slotKey 로 POST 1건', () => {
    it('poi-b 트리거를 누르면 시트+scrim 이 뜨고 slot-candidates POST 가 poi-b 의 slotKey 로 나간다', async () => {
      renderPage();
      fireEvent.press(
        await screen.findByTestId(stopcardAltId('poi-b'), {}, WAIT)
      );

      expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
      // scrim 존재는 심판(구조) — 실 딤 커버·터치 차단은 6-b 실기 몫(바텀시트 목 사각).
      expect(screen.getByTestId('itinerary-candidate-scrim')).toBeOnTheScreen();

      await waitFor(() => expect(postCalls).toBe(1));
      expect((postBody as { slotKey: string }).slotKey).toBe(
        buildSlotKey(DAY1, 'poi-b')
      );
      expect(Object.keys(postBody as object)).toEqual(['slotKey']);
    });
  });

  describe('🔴 D3 · AC-2 — 고정 슬롯은 트리거 부재라 열 방법이 없다', () => {
    it('고정 카드엔 트리거가 없고(비고정엔 있고) 시트도 안 뜬다', async () => {
      renderPage();
      await screen.findByTestId(stopcardId('poi-a'), {}, WAIT);

      expect(screen.queryByTestId(stopcardAltId('poi-fixed'))).toBeNull();
      expect(screen.getByTestId(stopcardAltId('poi-a'))).toBeOnTheScreen();
      expect(screen.queryByTestId(SHEET)).toBeNull();
    });
  });

  describe('🔴 D4 · AC-1 — scrim press → 시트 언마운트 (X 버튼 없음, scrim onClose)', () => {
    it('시트를 열고 scrim 을 누르면 시트가 트리에서 사라진다', async () => {
      renderPage();
      fireEvent.press(
        await screen.findByTestId(stopcardAltId('poi-a'), {}, WAIT)
      );
      await screen.findByTestId(SHEET);

      fireEvent.press(screen.getByTestId('itinerary-candidate-scrim'));

      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
    });
  });

  describe('🔴 D6 · AC-4 — DraftScreen 에 남는 empty 얼굴의 「직접 고르기」 → manual 라우트 push', () => {
    it('일자 없는 COMPLETE(empty 얼굴)에서 직접 고르기를 누르면 /trips/[tripId]/itinerary/manual 로 push 한다', async () => {
      // 갈래: COMPLETE·FULL_AI·days 0 → empty 얼굴(DraftScreen 잔류, TRIP-1039 D1-i). 셸 폴백 얼굴의
      // 「처음부터 직접 짜기」는 「폴백 셸」 describe S7 이 맡는다.
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json({ ...cleanItinerary(), days: [] })
        )
      );
      renderPage();
      await screen.findByTestId('itinerary-draft-empty', {}, WAIT);

      fireEvent.press(screen.getByTestId('itinerary-draft-pick-manual'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenLastCalledWith({
        pathname: '/trips/[tripId]/itinerary/manual',
        params: { tripId: TRIP_ID },
      });
    });
  });

  // ─── 경로2: h08 지도+시트 셸(clean COMPLETE) · SlotStopCard 트리거 첫 실배선 ──────
  describe('🔴 D7~D9 · h08 셸 트리거 실배선 (no-op → 실배선 · clean COMPLETE)', () => {
    function renderShell() {
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json(cleanItinerary())
        )
      );
      return renderPage();
    }

    it('D7 · AC-1 — 셸 트리거 누르기 전엔 시트가 없고 POST 0건이다', async () => {
      renderShell();
      await screen.findByTestId(stopcardAltId('poi-a'));

      expect(screen.queryByTestId(SHEET)).toBeNull();
      expect(postCalls).toBe(0);
    });

    it('D8 · AC-1·D9(첫 실배선) — 비고정 슬롯 alt press → 시트 마운트 + 그 slotKey 로 POST 1건', async () => {
      renderShell();
      fireEvent.press(await screen.findByTestId(stopcardAltId('poi-a')));

      // 셸의 onPressAlt 가 옛 no-op 이면 시트도 POST 도 없다 → 여기서 red.
      expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
      await waitFor(() => expect(postCalls).toBe(1));
      expect((postBody as { slotKey: string }).slotKey).toBe(
        buildSlotKey(DAY1, 'poi-a')
      );
    });

    it('D9 · AC-2 — 고정 슬롯은 alt 트리거 부재(비고정엔 있음)', async () => {
      renderShell();
      await screen.findByTestId(stopcardAltId('poi-a'));

      expect(screen.queryByTestId(stopcardAltId('poi-fixed'))).toBeNull();
      expect(screen.getByTestId(stopcardAltId('poi-a'))).toBeOnTheScreen();
    });
  });

  // ─── 경로3: 폴백 dismiss → 셸 (TRIP-983 · QA #024 재현 · TRIP-1039 AC-11) ─────────────
  describe('🔴 F1~F3 · TRIP-983·TRIP-1039 — 폴백 셸의 "다른 후보" 시트는 셸 밖, 셸 뒤에 산다', () => {
    const SCRIM = 'itinerary-candidate-scrim';
    const SHELL = 'map-sheet-shell-root';
    const LIST_IDS = [
      stopcardId('poi-fixed'),
      stopcardId('poi-a'),
      stopcardId('poi-b'),
      'itinerary-draft-manual',
      'sheet-cta-button-0',
      'sheet-cta-button-1',
    ];
    const SHEET_IDS = [SCRIM, SHEET];

    /** 폴백 추천안 — COMPLETE + DETERMINISTIC + isFallback 이라 `deterministic` 인터스티셜이 먼저 뜨고,
     * "기본 일정 보기"(로컬 dismiss)를 눌러야 셸 폴백 얼굴에 닿는다(TRIP-1039). */
    function fallbackItinerary(): Itinerary {
      return {
        itineraryId: 'itin-1',
        tripId: TRIP_ID,
        status: 'PLANNED',
        solveMode: 'DETERMINISTIC',
        generationMode: 'FULLY_AI',
        generationState: 'COMPLETE',
        isFallback: true,
        days: days(),
      };
    }

    let putCalls = 0;

    beforeEach(() => {
      putCalls = 0;
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json(fallbackItinerary())
        ),
        http.put(`${BASE}/trips/:tripId/itinerary`, () => {
          putCalls += 1;
          return HttpResponse.json(fallbackItinerary());
        })
      );
    });

    /** 인터스티셜 "기본 일정 보기" → 그 슬롯 "다른 후보 ›" → 시트가 뜰 때까지. */
    async function openFallbackSheet(poiId: string): Promise<void> {
      renderPage();
      fireEvent.press(
        await screen.findByTestId('itinerary-fallback-view-plan', {}, WAIT)
      );
      fireEvent.press(
        await screen.findByTestId(stopcardAltId(poiId), {}, WAIT)
      );
      await screen.findByTestId(SHEET);
    }

    function escapeRe(text: string): string {
      return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    it('F1 · AC-1 — 시트·딤이 뜨고, 둘 다 셸(map-sheet-shell-root)의 자손이 아니다', async () => {
      await openFallbackSheet('poi-a');

      expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
      expect(screen.getByTestId(SCRIM)).toBeOnTheScreen();

      const shell = screen.getByTestId(SHELL);
      // 손잡이 검증 — 카드는 이 셸 안에 있다(빈 손잡이면 아래 부재 단언이 공허하게 통과한다).
      expect(within(shell).getByTestId(stopcardId('poi-a'))).toBeOnTheScreen();
      expect(within(shell).queryByTestId(SHEET)).toBeNull();
      expect(within(shell).queryByTestId(SCRIM)).toBeNull();
    });

    it('F2 · AC-2 — 트리 순서상 딤·시트가 모든 카드·「처음부터 직접 짜기」·CTA 두 버튼보다 뒤에 온다', async () => {
      // poi-a 는 첫 비고정 슬롯이라 뒤에 poi-b 카드·CTA 두 버튼이 더 있다.
      await openFallbackSheet('poi-a');

      const pattern = new RegExp(
        `^(${[...LIST_IDS, ...SHEET_IDS].map(escapeRe).join('|')})$`
      );
      // getAllByTestId 는 호스트 요소를 트리 pre-order(부모→자식, 형→아우)로 돌려준다.
      const order = screen
        .getAllByTestId(pattern)
        .map((node) => String(node.props.testID));

      expect(order).toHaveLength(LIST_IDS.length + SHEET_IDS.length);
      expect([...order.slice(0, LIST_IDS.length)].sort()).toEqual(
        [...LIST_IDS].sort()
      );
      expect([...order.slice(LIST_IDS.length)].sort()).toEqual(
        [...SHEET_IDS].sort()
      );
    });

    it('F3 · AC-3 — 후보 라디오 → 「교체하기」 → PUT 1회 + 시트 닫힘 (폴백 경로 무회귀)', async () => {
      await openFallbackSheet('poi-a');

      fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-X'));
      fireEvent.press(screen.getByTestId('itinerary-candidate-confirm'));

      await waitFor(() => expect(putCalls).toBe(1));
      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
    });
  });
});

// TRIP-792 · 옛 DraftPage.default.integration.test.tsx
describe('h08 셸 기본 얼굴', () => {
  /**
   * TRIP-792 · AC-1~7 h08 "AI 추천안 default(완성 초안)" 얼굴을 **실 HTTP 로** 태우는 심판
   * (01b D1-R NARROW · 계약 플립 두 번째 — 같은 `listed` 응답에 옛 DraftScreen 대신 공용 지도+시트 셸).
   *
   * 무엇을 보장하나 (draft 라우트의 **깨끗한 COMPLETE**(listed·!generating·!staleFailed·!fallback) 분기):
   *  - 🔴 셸 얼굴이 뜬다 — 전면 지도(`map-root`) + 좌상단 day-chip 오버레이(`sheet-daychip-*`) +
   *    시트 헤더(`sheet-header-*`) + 슬롯 카드(`slot-stopcard-*`) + 하단 CTA 바(`sheet-cta-root`).
   *    옛 DraftScreen 앱바(`itinerary-draft-back`·`-retry`·`-complete`·일차 탭)는 사라진다(AC-1).
   *  - 🔴 **INV-4 는 셸 안에서 지킨다** — staleFailed 응답도 셸로 가고 셸 시트 안에 staleFailed 안내가 붙는다
   *    (TRIP-1039 로 narrow 를 풀었다 — 옛 계약 "staleFailed → DraftScreen" 을 뒤집음). fallback 응답은 여전히
   *    전용 인터스티셜이 먼저 잡는다(AC-1b · TRIP-791).
   *  - 🔴 확정하기 → h14(index 라우트) push 완전일치 / 다시 짜기 → 생성 화면 replace 1회 · 초안 화면 POST 0
   *    (AC-2 · TRIP-1037 플립 — POST 는 생성 화면이 마운트될 때 보낸다).
   *  - 🔴 전 슬롯 시각 칩(isFixed 무관, en-dash) · 제거요소 부재 · 헤더 "N곳 · X.Xkm" · INV-3 0 ·
   *    다른 후보 ›는 비고정만(AC-3~7).
   *
   * ⚠️ 함정(02a §4):
   *  - ★3 "AI 추천안" 텍스트는 **셸 헤더(`sheet-header-title`)에도 있다** → DraftScreen 앱바 부재는
   *    `queryByText('AI 추천안')` 이 아니라 **testID**(`itinerary-draft-back`)로 잰다.
   *  - ★2 "1일차"는 day-chip 과 헤더 dayLabel 둘 다 그린다 → `getByText('1일차')` 완전일치는 두 노드를
   *    잡아 throw. 여기선 셸 골격을 testID 로만 잰다.
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=화면을 열고/누른다 → 단언=보이는 얼굴·testID·나간 요청.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';

  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';
  const DAY3 = '2026-06-12';

  /** 3일 여행 — day-chip 개수의 출처는 `days.length` 가 아니라 이 두 날짜다(01b D7). */
  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 3일',
      startDate: DAY1,
      endDate: DAY3,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /**
   * 하루치 3슬롯 — AC-3·AC-5·AC-7 을 한 픽스처로 잰다.
   *  - poi-b 는 **isFixed=true**(고정)인데도 시각 칩이 떠야 한다(AC-3 핵심 · BR-U3-07 개정).
   *  - 첫 슬롯 distanceRange 는 **null**(거점 없는 날)이다. 헤더 합은 커넥터 구간(`slice(1)`)만 더하므로
   *    3.5km(2.1+1.4)다 — TRIP-1110 이후 전 슬롯을 넘기면 첫 null 에 접혀 A5 가 red 가 된다(A5b-2 짝).
   *  - lat/lng 를 실어 셸 지도(map-root)가 마운트되고 DraftPage 가 center 를 계산하게 한다.
   */
  function daySlots(date: string): ItineraryDaysItemSlotsItem[] {
    return [
      {
        poiId: 'poi-a',
        startAt: '09:30:00',
        endAt: '11:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: ['바다', '산책'],
        nameKo: '광안리 해변',
        category: '자연',
        imageUrl: null,
        distanceRange: null,
        lat: 33.458,
        lng: 126.942,
      },
      {
        poiId: 'poi-b',
        startAt: '13:00:00',
        endAt: '14:30:00',
        isFixed: true,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: ['호텔'],
        nameKo: `${date} 숙소`,
        category: '숙소',
        imageUrl: null,
        distanceRange: '2.1km',
        lat: 33.512,
        lng: 126.522,
      },
      {
        poiId: 'poi-c',
        startAt: '15:00:00',
        endAt: '16:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: ['카페'],
        nameKo: '흰여울 마을',
        category: '자연',
        imageUrl: null,
        distanceRange: '1.4km',
        lat: 33.245,
        lng: 126.412,
      },
    ];
  }

  function daysUpTo(count: number): ItineraryDaysItem[] {
    return [DAY1, DAY2, DAY3]
      .slice(0, count)
      .map((date) => ({ date, slots: daySlots(date) }));
  }

  function itinerary(input: {
    dayCount: number;
    generationState: ItineraryGenerationState;
    status?: ItineraryStatus;
    solveMode?: ItinerarySolveMode;
    isFallback?: boolean;
    candidatesSummary?: ItineraryCandidatesSummary;
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
      days: daysUpTo(input.dayCount),
    };
  }

  /** 깨끗한 COMPLETE 3일에서 매일 슬롯 a·b·c 의 distanceRange 만 `ranges` 로 덮어쓴다(TRIP-1110 헤더 케이스). */
  function completeWithRanges(ranges: (string | null)[]): Itinerary {
    const base = itinerary({ dayCount: 3, generationState: 'COMPLETE' });
    return {
      ...base,
      days: base.days.map((day) => ({
        ...day,
        slots: day.slots.map((slot, index) => ({
          ...slot,
          distanceRange: ranges[index],
        })),
      })),
    };
  }

  /** GET /itinerary 응답을 케이스가 정한다. 기본은 깨끗한 COMPLETE 3일(→ h08 셸). */
  let itineraryHandler: () => Response;
  /** 다시 짜기(재생성) POST 가 몇 번 나갔나. */
  let postCount = 0;

  /** 렌더된 문자열 전부를 공백으로 이어 붙인다(퍼센트·소요 부정 스캔의 모집단, h07 선례). */
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

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    mockReplace.mockClear();
    postCount = 0;
    setAccessToken('valid-access');
    itineraryHandler = () =>
      HttpResponse.json(
        itinerary({ dayCount: 3, generationState: 'COMPLETE' })
      );

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => itineraryHandler()),
      http.post(`${BASE}/trips/:tripId/itinerary`, () => {
        postCount += 1;
        return HttpResponse.json(
          itinerary({ dayCount: 1, generationState: 'PARTIAL' }),
          { status: 201 }
        );
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /** `retry:false`·`gcTime:0` — 실패 즉시, 폴링 타이머 잔존 방지. COMPLETE 는 폴링을 안 유발한다. */
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
    return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  describe('🔴 A1 · AC-1 — 깨끗한 COMPLETE 면 h08 셸 얼굴이 뜬다 (D1-R · 계약 플립)', () => {
    it('셸 골격이 뜨고 옛 DraftScreen 앱바·일차 탭은 사라진다', async () => {
      renderPage();

      // 셸 골격 — 지도 + day-chip 오버레이 + 헤더 + 슬롯 카드 + CTA 바.
      await screen.findByTestId('map-sheet-shell-root');
      expect(screen.getByTestId('map-root')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-daychip-0')).toBeOnTheScreen(); // DayChipOverlay
      expect(screen.getByTestId('sheet-header-title')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-header-meta')).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^slot-stopcard-/).length).toBeGreaterThan(
        0
      );
      expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();

      // 옛 DraftScreen 앱바 부재 — ★3: 'AI 추천안' 텍스트는 셸 헤더에도 있어 testID 로 잰다.
      expect(screen.queryByTestId('itinerary-draft-back')).toBeNull();
      expect(screen.queryByTestId('itinerary-draft-retry')).toBeNull();
      expect(screen.queryByTestId('itinerary-draft-complete')).toBeNull();
      expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]);
    });
  });

  describe('A1b · AC-1b — INV-4 는 셸 안에서 지킨다 (staleFailed → 셸 + 안내 · fallback → 인터스티셜)', () => {
    it('🔴 staleFailed(FAILED+슬롯) 응답은 셸로 가고 시트 안에 staleFailed 안내가 붙는다 (TRIP-1039 플립)', async () => {
      // 준비 — FAILED+day1 슬롯 → resolveDraftView: listed + staleFailed. TRIP-1039 가 셸 조건에서
      // `!staleFailed` 를 뺐다 — 안내는 셸 시트 안으로 옮겨 간다(INV-4 — 안내 소실 금지).
      itineraryHandler = () =>
        HttpResponse.json(
          itinerary({ dayCount: 1, generationState: 'FAILED' })
        );

      renderPage();

      expect(
        await screen.findByTestId(
          'itinerary-draft-stale-failed',
          {},
          { timeout: 4000 }
        )
      ).toBeOnTheScreen();
      // ★ 셸이다 — 옛 목록(DraftScreen 스크롤)으로 새면 여기가 red 로 잡는다.
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-draft-scroll')).toBeNull();
    });

    it('🔴 fallback(DETERMINISTIC+isFallback) 응답은 셸도 DraftScreen 도 아닌 인터스티셜로 간다 (TRIP-791)', async () => {
      // TRIP-791 플립 — 폴백 신호(non-null fallbackNotice)는 곁줄 배너가 아니라 전용 인터스티셜
      // (GenerationFallbackScreen)로 라우팅된다(01b D1). 셸도 아니다(narrow 조건이 fallback 을 셸에서 뺌).
      itineraryHandler = () =>
        HttpResponse.json(
          itinerary({
            dayCount: 3,
            generationState: 'COMPLETE',
            solveMode: 'DETERMINISTIC',
            isFallback: true,
          })
        );

      renderPage();

      expect(
        await screen.findByTestId('itinerary-fallback-root')
      ).toBeOnTheScreen();
      // 기존 두 얼굴로 새지 않는다 — 셸도, 곁줄 폴백 배너(이제 소멸)도 아니다.
      expect(screen.queryByTestId('map-sheet-shell-root')).toBeNull();
      expect(
        screen.queryByTestId('itinerary-draft-fallback-banner')
      ).toBeNull();
    });
  });

  describe('🔴 A2 · AC-2 — CTA 두 갈래 배선 (혼동 방지)', () => {
    it('확정하기 press → /trips/[tripId]/itinerary 로 tripId 를 실어 한 번 push 한다', async () => {
      renderPage();
      await screen.findByTestId('sheet-cta-root');

      // 순서 계약 — cta[1]=확정하기(primary). 라벨을 함께 확인해 index 뒤바뀜을 잡는다.
      const confirm = screen.getByTestId('sheet-cta-button-1');
      expect(confirm).toHaveTextContent('확정하기');
      fireEvent.press(confirm);

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

      // ★ 완전일치(맹점④) — `'itinerary'` 부분문자열은 draft·generating 경로에도 있어 substring 이면
      //   엉뚱한 곳으로 가도 통과한다. h14 는 접미 없는 index 라우트이고 객체형 push 여야 `[tripId]` 가
      //   해소된다(I9·must-visits push 선례 동형).
      const dest = mockPush.mock.calls[0][0] as {
        pathname?: string;
        params?: { tripId?: string };
      };
      expect(dest.pathname).toBe('/trips/[tripId]/itinerary');
      expect(dest.params?.tripId).toBe(TRIP_ID);
    });

    it('다시 짜기 press → 생성 화면으로 replace 1회(mode=FULLY_AI) · 초안 화면 POST 0 (TRIP-1037 플립)', async () => {
      renderPage();
      await screen.findByTestId('sheet-cta-root');

      // 순서 계약 — cta[0]=다시 짜기(outline).
      const retry = screen.getByTestId('sheet-cta-button-0');
      expect(retry).toHaveTextContent('다시 짜기');
      fireEvent.press(retry);

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/generating',
        params: { tripId: TRIP_ID, mode: 'FULLY_AI' },
      });
      // POST 는 생성 화면 몫 — 흘려 보낸 뒤에도 초안 화면이 보낸 것은 0이다.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(postCount).toBe(0);
    });
  });

  describe('🔴 A3 · AC-3 — 전 슬롯이 isFixed 무관 시각 칩을 그린다 (BR-U3-07 · en-dash)', () => {
    it('3슬롯 전부 시각 칩이고, 고정 슬롯(poi-b)도 en-dash 시각 칩이다', async () => {
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      expect(screen.queryAllByTestId(/^slot-stopcard-time-/)).toHaveLength(3);
      // 고정 슬롯도 시각 칩 — toHaveTextContent(문자열)=완전일치라 en-dash `–`(U+2013)를 정확히 요구.
      expect(
        screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-b`)
      ).toHaveTextContent('13:00–14:30');
    });
  });

  describe('🔴 A4 · AC-4 — 제거 요소가 셸 얼굴에 없다', () => {
    it('AI 배지·시간대 라벨·도보·#·옛 일차 탭·reason·다시 만들기 가 0건이다', async () => {
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      expect(screen.queryAllByText('AI 추천')).toEqual([]); // 옛 AI_BADGE
      expect(screen.queryAllByText(/^(오전|점심|오후|저녁)$/)).toEqual([]); // 시간대 라벨
      expect(screen.queryByText(/도보/)).toBeNull(); // 도보 추정
      expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]); // 옛 일차 탭
      expect(
        screen.queryByTestId('itinerary-draft-reason-subtitle')
      ).toBeNull();
      // 옛 RETRY_LABEL('다시 만들기')는 없다 — h08 CTA '다시 짜기'와 완전일치로 구별된다.
      expect(screen.queryByText('다시 만들기')).toBeNull();
      // 슬롯 태그는 '바다 · 산책'(가운뎃점)이지 '#바다'가 아니다(옛 DraftSlotCard 해시태그 소멸).
      expect(renderedText()).not.toContain('#');
    });
  });

  describe('🔴 A5 · AC-5 — 시트 헤더 meta 가 "N곳 · X.Xkm"(거리 합)다', () => {
    it('meta 에 3곳·3.5km 가 있고 이동/소요 어휘는 0건이다 (INV-3)', async () => {
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const meta = screen.getByTestId('sheet-header-meta');
      // 곳 수 = 3, 거리 합 = 2.1+1.4 = 3.5km(정규식=부분 매칭).
      expect(meta).toHaveTextContent(/3곳/);
      expect(meta).toHaveTextContent(/3\.5km/);
      // legDistance 는 '이동 3.5km' 를 주지만 헤더는 km 부만 — '이동' 접두·소요 어휘 금지.
      expect(meta).not.toHaveTextContent(/이동|분|시간|소요/);
    });
  });

  describe('🔴 A6 · AC-6 — 셸 얼굴 텍스트에 분·시간·소요·% 가 0건이다 (INV-3)', () => {
    it('퍼센트·소요시간 어휘가 화면 어디에도 없다', async () => {
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const text = renderedText();
      expect(text).not.toContain('%');
      expect(text).not.toMatch(/\d+\s*(분|시간)|소요/);
    });
  });

  describe('🔴 A7 · AC-7 — "다른 후보 ›"는 비고정 슬롯에만 뜬다 (D2-R)', () => {
    it('비고정(poi-a·poi-c)엔 alt 링크가 있고 고정(poi-b)엔 없다', async () => {
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 비고정 2개만 alt 링크(SlotStopCard 는 onPressAlt 가 주어졌을 때만 그린다).
      expect(screen.queryAllByTestId(/^slot-stopcard-alt-/)).toHaveLength(2);
      expect(
        screen.getByTestId(`slot-stopcard-alt-${DAY1}#poi-a`)
      ).toBeOnTheScreen();
      // 고정 슬롯엔 onPressAlt 미주입 → 링크 부재.
      expect(
        screen.queryByTestId(`slot-stopcard-alt-${DAY1}#poi-b`)
      ).toBeNull();
    });
  });

  describe('🔴 TRIP-1076 AC-3 · h08 결과 지도는 핀 전부에 맞춰 연다', () => {
    it('셸 지도에 핀 2개 이상과 fitPins 가 함께 전달된다', async () => {
      // 준비·실행 — 기본 COMPLETE 응답으로 셸 얼굴을 연다.
      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      // 단언 — 관찰 목(map-root)은 셸이 MapView 에 넘긴 props 를 그대로 싣는다.
      const map = screen.getByTestId('map-root');
      expect((map.props.pins as unknown[]).length).toBeGreaterThanOrEqual(2);
      expect(map.props.fitPins).toBe(true);
    });
  });

  describe('🔴 A5b · TRIP-1110 AC-5·AC-6 — h08 헤더 meta 는 커넥터 구간(slice(1))만 보고, 하나라도 비면 km 를 접는다', () => {
    it('A5b-1 · 커넥터 구간에 null 이 섞이면 meta 는 정확히 "3곳"이고 null 커넥터는 글리프 줄만 남는다', async () => {
      // 준비 — a→b 구간 2.1km, b→c 구간 null(교체 뒤 재산출 전). 옛 스킵 규약이면 "3곳 · 2.1km"(부분합).
      itineraryHandler = () =>
        HttpResponse.json(completeWithRanges([null, '2.1km', null]));

      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const meta = screen.getByTestId('sheet-header-meta');
      expect(meta).toHaveTextContent('3곳'); // 문자열 인자 = 완전 일치(02a §5)
      expect(meta).not.toHaveTextContent(/km|이동|분|시간|소요/);
      // 커넥터는 무변경(결정 2=A) — 값 있는 구간은 서버 문자열 그대로, null 구간은 줄만 있고 문구 칸이 없다.
      expect(
        screen.getByTestId(`sheet-connector-distance-${DAY1}#poi-a`)
      ).toHaveTextContent('2.1km');
      expect(
        screen.getByTestId(`sheet-connector-${DAY1}#poi-b`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`sheet-connector-distance-${DAY1}#poi-b`)
      ).toBeNull();
    });

    it('A5b-2 · 첫 슬롯(거점→첫 방문지) 거리는 커넥터가 없으니 헤더 합에도 안 들어간다 — "3곳 · 3.5km"', async () => {
      // 준비 — 거점 있는 날: 첫 슬롯에도 0.9km. 전 슬롯을 더하면 4.4km 가 된다(옛 Draft 모집단).
      itineraryHandler = () =>
        HttpResponse.json(completeWithRanges(['0.9km', '2.1km', '1.4km']));

      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
        '3곳 · 3.5km'
      );
    });
  });
});

// TRIP-1008 · 옛 DraftPage.fallbackLabels.integration.test.tsx
describe('폴백·위반 라벨', () => {
  /**
   * TRIP-1008 · 폴백 얼굴과 위반 표식을 **실 HTTP 로** 태우는 심판(B1~B5 · C1·C2 · 티켓 금지 조항).
   * TRIP-1039 로 폴백·staleFailed 목록이 옛 `DraftScreen` 에서 **지도+시트 셸**로 옮겨 가 이 파일도 셸
   * testID 로 뒤집었다(`itinerary-draft-slot-*`·`itinerary-draft-title` → `slot-stopcard-*`·`sheet-header-title`).
   *
   * 무엇을 보장하나:
   *  - 🔴 폴백 인터스티셜을 "기본 일정 보기"로 넘긴 셸이 폴백임을 드러낸다 — 제목·안내 제목이 "기본 일정"
   *    결이고 "AI 추천"·"취향·거리로 채운" 은 0건이다(BR-U3-11 · D6 · TRIP-1039 AC-3). 셸 카드엔 배지가
   *    아예 없어 "배지가 AI 추천이 아니다"는 텍스트 0건으로 잰다. 폴백 3종(minimal·deterministic·demoted) 모두 같다.
   *  - 폴백이 아닌 staleFailed 셸의 제목은 그대로 "AI 추천안" 이다(무회귀 짝 — 무조건 바꾼 구현을 죽인다).
   *  - 🔴 위반 슬롯에 표식이 h08 셸(깨끗한 COMPLETE)과 폴백 셸 **둘 다** 뜨고, 문구는 서버 사유와 무관한
   *    고정 라벨이다(02c) — 사유 원문에 소요시간("이동 54분 필요")이 섞여 와 그리면 INV-3 위반이라서다.
   *    FE 는 원문을 파싱해 거르지 않는다(D5).
   *
   * 라우팅은 픽스처가 정한다(traps-itinerary) — 각 describe 가 어느 갈래를 태우는지 픽스처 옆에 적었다.
   *   인터스티셜 = fallbackNotice≠null(미해제) · h08 셸 = listed·!PARTIAL(폴백 dismiss 뒤·staleFailed 포함,
   *   TRIP-1039) · DraftScreen = loading·failed·empty.
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=렌더(+기본 일정 보기 press) → 단언=testID 텍스트·0건 스캔.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const DAY3 = '2026-06-12';

  /** 서버 사유 — HC2(소요시간 섞임) · HC1(원시 분 범위)을 ` · ` 로 이은 실제 결합 형태. */
  const RAW_REASON = '이동 54분 필요, 간격 -60분 · 영업시간 밖: 543~618';
  const VIOLATION_LABEL = '일정 확인이 필요해요';
  /** 소요시간 탐지기 — 리포 INV-3 스캐너들과 같은 식(`DraftScreen.test.tsx` 등). */
  const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;
  /** 원시 분 범위 탐지기(티켓 금지 조항). 치환된 `09:03~10:18` 은 앞이 2자리라 안 걸린다(02a §5-2). */
  const RAW_RANGE = /\d{3,4}~\d{3,4}/;

  const k = (poiId: string): string => buildSlotKey(DAY1, poiId);

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 3일',
      startDate: DAY1,
      endDate: DAY3,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function slot(
    poiId: string,
    over: Partial<ItineraryDaysItemSlotsItem> = {}
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      startAt: '09:30:00',
      endAt: '11:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: `장소-${poiId}`,
      lat: 33.458,
      lng: 126.942,
      ...over,
    };
  }

  /** day1 비고정 2장 — `poi-a` 는 위반(HC2 소요시간 + HC1 원시 분값), `poi-b` 는 위반 없음. */
  function daySlots(): ItineraryDaysItemSlotsItem[] {
    return [
      slot('poi-a', {
        hasViolation: true,
        violationReason: RAW_REASON,
      }),
      slot('poi-b', { startAt: '13:00:00', endAt: '14:00:00' }),
    ];
  }

  function itinerary(input: {
    solveMode: ItinerarySolveMode;
    isFallback: boolean;
    generationState?: ItineraryGenerationState;
    candidatesSummary?: ItineraryCandidatesSummary;
  }): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: input.solveMode,
      generationMode: 'FULLY_AI',
      generationState: input.generationState ?? 'COMPLETE',
      isFallback: input.isFallback,
      candidatesSummary: input.candidatesSummary,
      days: [{ date: DAY1, slots: daySlots() }],
    };
  }

  let itineraryScript: () => Itinerary;

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    mockReplace.mockClear();
    mockCanGoBack.mockClear();
    mockCanGoBack.mockReturnValue(true);
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itineraryScript())
      ),
      http.post(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itineraryScript(), { status: 201 })
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /** `retry:false`·`gcTime:0` — 동결 DraftPage 통합 테스트와 같은 클라이언트. */
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
    return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** 네트워크 응답을 기다리는 첫 조회 한도 — 로컬 기본 1000ms 의 CI 러너(약 4배 느림) 환산. */
  const WAIT = { timeout: 4000 };

  /** 인터스티셜에서 "기본 일정 보기" → 폴백 셸 도착까지(TRIP-1039 — 옛 목록 `DraftScreen` 아님). */
  async function openFallbackShell(): Promise<void> {
    renderPage();
    fireEvent.press(
      await screen.findByTestId('itinerary-fallback-view-plan', {}, WAIT)
    );
    await screen.findByTestId('map-sheet-shell-root', {}, WAIT);
  }

  /** 폴백 3종 — 인터스티셜이 세 kind 모두에 "취향 반영 (건너뜀)" 이라 목록도 같이 말한다(Q2). */
  const FALLBACK_ROWS: {
    kind: string;
    solveMode: ItinerarySolveMode;
    isFallback: boolean;
    summary?: ItineraryCandidatesSummary;
  }[] = [
    { kind: 'minimal', solveMode: 'MINIMAL', isFallback: true },
    { kind: 'deterministic', solveMode: 'DETERMINISTIC', isFallback: true },
    {
      kind: 'demoted',
      solveMode: 'FULL_AI',
      isFallback: false,
      summary: { level: 'LOW' },
    },
  ];

  describe('🔴 B1~B3·B5 · 폴백 셸은 "기본 일정" 이다 — AI 추천·취향·거리 문구 0건 (BR-U3-11 · D6 · TRIP-1039 AC-3)', () => {
    it.each(FALLBACK_ROWS)(
      '$kind — 제목·안내 제목이 기본 일정 결이고 카드엔 AI 배지가 없다',
      async ({ solveMode, isFallback, summary }) => {
        itineraryScript = () =>
          itinerary({ solveMode, isFallback, candidatesSummary: summary });

        await openFallbackShell();

        // 긍정 앵커 — 비고정 카드 2장이 셸에 떠 있다(빈 화면이 아래 0건을 공짜로 통과하지 못하게).
        expect(
          screen.getByTestId(`slot-stopcard-${k('poi-a')}`)
        ).toBeOnTheScreen();
        expect(
          screen.getByTestId(`slot-stopcard-${k('poi-b')}`)
        ).toBeOnTheScreen();

        // B1 — 셸 카드(SlotStopCard)엔 AI 배지 자체가 없다. 옛 목록 배지 testID 가 새지 않았다.
        expect(screen.queryAllByTestId(/^itinerary-draft-slot-badge-/)).toEqual(
          []
        );

        // B3 — 폴백 안내 제목과 시트 제목.
        expect(
          screen.getByTestId('itinerary-draft-reason-title')
        ).toHaveTextContent('취향 반영 없이 만든 기본 일정이에요');
        expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
          '기본 일정'
        );

        // B2 — 사실과 다른 문구가 화면 어디에도 없다(셸 헤더의 "AI 추천안" 포함 — 02a ★2).
        expect(screen.queryAllByText(/취향·거리로 채운/).length).toBe(0);
        expect(screen.queryAllByText(/AI 추천/).length).toBe(0);
      }
    );
  });

  describe('B4 · 폴백 아닌 staleFailed 셸의 제목은 그대로 "AI 추천안" 이다 (무회귀 짝)', () => {
    it('FULL_AI·FAILED·isFallback=false → 인터스티셜 없이 셸, 제목 AI 추천안, 폴백 안내 없음', async () => {
      // 갈래: fallbackNotice=null 이라 인터스티셜 없음 · listed(staleFailed) → h08 셸(TRIP-1039).
      itineraryScript = () =>
        itinerary({
          solveMode: 'FULL_AI',
          isFallback: false,
          generationState: 'FAILED',
        });

      renderPage();
      await screen.findByTestId('itinerary-draft-stale-failed', {}, WAIT);

      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        'AI 추천안'
      );
      expect(
        screen.queryByTestId('itinerary-draft-fallback-banner')
      ).toBeNull();
    });
  });

  describe('🔴 C1·C2 · h08 셸(깨끗한 COMPLETE) — 위반 슬롯 카드에만 고정 라벨 표식, 사유 원문·소요시간 0건 (INV-3)', () => {
    it('poi-a 카드 안에 "일정 확인이 필요해요" 표식, 전체 1개, 소요시간·사유 원문·원시 분 범위 0건', async () => {
      // 갈래: FULL_AI·COMPLETE·isFallback=false·요약 없음 → fallbackNotice=null·!staleFailed → h08 셸.
      itineraryScript = () =>
        itinerary({ solveMode: 'FULL_AI', isFallback: false });

      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const cardA = screen.getByTestId(`slot-stopcard-${k('poi-a')}`);
      expect(
        within(cardA).getByTestId(`slot-stopcard-violation-${k('poi-a')}`)
      ).toHaveTextContent(VIOLATION_LABEL);
      // C2 — 위반 없는 poi-b 에는 없다(전체 1개).
      expect(
        screen.getByTestId(`slot-stopcard-${k('poi-b')}`)
      ).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^slot-stopcard-violation-/).length).toBe(
        1
      );
      // INV-3 — 위 긍정 짝(표식이 카드 안에 있다)이 선 뒤라 이 0건은 빈 화면 공짜 통과가 아니다.
      expect(screen.queryAllByText(DURATION_TEXT).length).toBe(0);
      expect(screen.queryAllByText(/영업시간 밖/).length).toBe(0);
      expect(screen.queryAllByText(RAW_RANGE).length).toBe(0);
    });
  });

  describe('🔴 C1·C2 · 폴백 셸 — 위반 슬롯 카드에만 고정 라벨 표식, 사유 원문·소요시간 0건 (INV-3)', () => {
    it('인터스티셜을 넘긴 셸의 poi-a 카드 안에 표식, 전체 1개, 소요시간·사유 원문·원시 분 범위 0건', async () => {
      // 갈래: MINIMAL+isFallback=true → 인터스티셜 → "기본 일정 보기" → h08 셸(TRIP-1039).
      itineraryScript = () =>
        itinerary({ solveMode: 'MINIMAL', isFallback: true });

      await openFallbackShell();

      const cardA = screen.getByTestId(`slot-stopcard-${k('poi-a')}`);
      expect(
        within(cardA).getByTestId(`slot-stopcard-violation-${k('poi-a')}`)
      ).toHaveTextContent(VIOLATION_LABEL);
      expect(
        screen.getByTestId(`slot-stopcard-${k('poi-b')}`)
      ).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^slot-stopcard-violation-/).length).toBe(
        1
      );
      // INV-3 — 위 긍정 짝(표식이 카드 안에 있다)이 선 뒤라 이 0건은 빈 화면 공짜 통과가 아니다.
      expect(screen.queryAllByText(DURATION_TEXT).length).toBe(0);
      expect(screen.queryAllByText(/영업시간 밖/).length).toBe(0);
      expect(screen.queryAllByText(RAW_RANGE).length).toBe(0);
    });
  });
});

// TRIP-1039 · 옛 DraftPage.fallbackShell.integration.test.tsx
describe('폴백 셸', () => {
  /**
   * TRIP-1039 · 폴백·강등·일부 실패 초안이 **지도+시트 셸**로 뜨고, 셸 안에서 그 사실을 계속 말하는지
   * 실 HTTP 로 태우는 심판(AC-1·2·4·5·6·7·10).
   *
   * 무엇을 보장하나:
   *  - 🔴 인터스티셜 「기본 일정 보기」 뒤 화면이 옛 목록(`itinerary-draft-scroll`)이 아니라 셸이다(QA #030).
   *  - 🔴 셸 폴백 얼굴은 시트 맨 위(헤더 뒤·첫 카드 앞)에 폴백 안내를 얹고 제목이 「기본 일정」이다
   *    (BR-U3-11 · INV-4). 안내 아이콘은 ✓ 가 아니다(QA #033).
   *  - 🔴 staleFailed(2차 실패)도 셸이고 「일부 정보를 불러오지 못했어요」가 곁에 붙는다(INV-4).
   *  - 깨끗한 COMPLETE·MANUAL 에는 안내가 없다(무회귀 · F-7).
   *  - 🔴 폴백 안내 안 「처음부터 직접 짜기」 → 수동 짜기 라우트 push(D2).
   *
   * jest 가 못 보는 것: 접힘(peek)에서 배너가 **눈에 보이는지**는 바텀시트 목이 children 을 전부 그려
   * 원리적 사각이다 — 트리 존재·순서까지만 잰다(6-b 실기 몫, 02a ★4).
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=렌더(+기본 일정 보기 press) → 단언=셸·안내 testID·글자.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const DAY3 = '2026-06-12';

  /** 네트워크 응답을 기다리는 첫 조회 한도 — 로컬 기본 1000ms 의 CI 러너(약 4배 느림) 환산. */
  const WAIT = { timeout: 4000 };

  const FALLBACK_TITLE = '기본 일정';
  const FALLBACK_REASON_TITLE = '취향 반영 없이 만든 기본 일정이에요';
  const REASON_SUBTITLE = '장소 하나만 다른 후보로 바꿀 수도 있어요';
  const STALE_FAILED_NOTE = '일부 정보를 불러오지 못했어요';
  const MANUAL_LINK = '처음부터 직접 짜기';

  const BANNER = 'itinerary-draft-fallback-banner';
  const STALE = 'itinerary-draft-stale-failed';
  const SHELL = 'map-sheet-shell-root';

  const cardId = (poiId: string): string =>
    `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 3일',
      startDate: DAY1,
      endDate: DAY3,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function slot(
    poiId: string,
    over: Partial<ItineraryDaysItemSlotsItem> = {}
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      startAt: '09:30:00',
      endAt: '11:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: `장소-${poiId}`,
      lat: 33.458,
      lng: 126.942,
      ...over,
    };
  }

  function itinerary(input: {
    solveMode?: ItinerarySolveMode;
    isFallback?: boolean;
    generationState?: ItineraryGenerationState;
    generationMode?: ItineraryGenerationMode;
    candidatesSummary?: ItineraryCandidatesSummary;
    /** 일자 목록을 통째로 바꿀 때만(S9 — 데이터 없는 날). 기본은 1일차 2슬롯. */
    days?: Itinerary['days'];
  }): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: input.solveMode ?? 'FULL_AI',
      generationMode: input.generationMode ?? 'FULLY_AI',
      generationState: input.generationState ?? 'COMPLETE',
      isFallback: input.isFallback ?? false,
      candidatesSummary: input.candidatesSummary,
      days: input.days ?? [
        {
          date: DAY1,
          slots: [
            slot('poi-a'),
            slot('poi-b', { startAt: '13:00:00', endAt: '14:00:00' }),
          ],
        },
      ],
    };
  }

  let itineraryScript: () => Itinerary;

  beforeEach(() => {
    mockPush.mockClear();
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itineraryScript())
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

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
    return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** 인터스티셜 「기본 일정 보기」 → 셸 도착까지. 폴백은 인터스티셜이 먼저 잡는다(02a ★7). */
  async function openFallbackShell(): Promise<void> {
    renderPage();
    fireEvent.press(
      await screen.findByTestId('itinerary-fallback-view-plan', {}, WAIT)
    );
    await screen.findByTestId(SHELL, {}, WAIT);
  }

  /** 정확한 testID 몇 개를 트리 전위 순서(부모→자식, 형→아우)로 뽑는다(02a ★3 · §5 실측). */
  function treeOrder(ids: string[]): string[] {
    const escaped = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return screen
      .getAllByTestId(new RegExp(`^(${escaped.join('|')})$`))
      .map((node) => String(node.props.testID));
  }

  const FALLBACK_ROWS: {
    kind: string;
    solveMode: ItinerarySolveMode;
    isFallback: boolean;
    summary?: ItineraryCandidatesSummary;
  }[] = [
    { kind: 'minimal', solveMode: 'MINIMAL', isFallback: true },
    { kind: 'deterministic', solveMode: 'DETERMINISTIC', isFallback: true },
    {
      kind: 'demoted',
      solveMode: 'FULL_AI',
      isFallback: false,
      summary: { level: 'LOW' },
    },
  ];

  describe('🔴 S1 · AC-1 — 「기본 일정 보기」 다음은 목록형이 아니라 지도+시트 셸이다 (QA #030)', () => {
    it.each(FALLBACK_ROWS)(
      '$kind — 셸이 뜨고 옛 목록 스크롤·인터스티셜은 없다',
      async ({ solveMode, isFallback, summary }) => {
        itineraryScript = () =>
          itinerary({ solveMode, isFallback, candidatesSummary: summary });

        await openFallbackShell();

        expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();
        expect(screen.queryByTestId('itinerary-draft-scroll')).toBeNull();
        expect(screen.queryByTestId('itinerary-fallback-root')).toBeNull();
      }
    );
  });

  describe('🔴 S2 · AC-2·AC-7 — 셸 폴백 얼굴은 시트 맨 위에 폴백 안내를 얹고 제목이 「기본 일정」이다 (BR-U3-11 · INV-4)', () => {
    beforeEach(() => {
      itineraryScript = () =>
        itinerary({ solveMode: 'DETERMINISTIC', isFallback: true });
    });

    it('제목 「기본 일정」 · 안내는 셸 안, 헤더 뒤·첫 카드 앞, CTA 바 밖이다', async () => {
      await openFallbackShell();

      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        FALLBACK_TITLE
      );
      const shell = screen.getByTestId(SHELL);
      expect(within(shell).getByTestId(BANNER)).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('sheet-cta-root')).queryByTestId(BANNER)
      ).toBeNull();
      // mapCard(지도 위)에 두면 헤더보다 앞, 헤더에 넣으면 헤더와 같은 줄 — 순서가 달라져 여기서 잡힌다.
      expect(treeOrder(['sheet-header-root', BANNER, cardId('poi-a')])).toEqual(
        ['sheet-header-root', BANNER, cardId('poi-a')]
      );
    });

    it('안내 제목·부제가 정확한 문구다 (부제에 「슬롯」 없음 · D3)', async () => {
      await openFallbackShell();

      const banner = screen.getByTestId(BANNER);
      // 컨테이너가 아니라 leaf 에 건다 — toHaveTextContent(문자열)은 완전 일치다(02a ★1).
      expect(
        within(banner).getByTestId('itinerary-draft-reason-title')
      ).toHaveTextContent(FALLBACK_REASON_TITLE);
      expect(
        within(banner).getByTestId('itinerary-draft-reason-subtitle')
      ).toHaveTextContent(REASON_SUBTITLE);
    });

    it('안내 아이콘은 주의 글리프(AlertCircleGlyph)이고 ✓(CheckCircleGlyph)는 화면 어디에도 없다 (QA #033)', async () => {
      await openFallbackShell();

      const banner = screen.getByTestId(BANNER);
      expect(
        within(banner).UNSAFE_queryAllByType(AlertCircleGlyph).length
      ).toBeGreaterThanOrEqual(1);
      expect(
        within(banner).UNSAFE_queryAllByType(CheckCircleGlyph)
      ).toHaveLength(0);
      expect(screen.UNSAFE_queryAllByType(CheckCircleGlyph)).toHaveLength(0);
    });
  });

  describe('🔴 S3 · AC-4 — staleFailed(2차 실패)도 셸이고 「일부 정보를 불러오지 못했어요」가 시트 안에 붙는다 (INV-4)', () => {
    it('인터스티셜 없이 셸 · stale 안내 · 제목 AI 추천안 · 폴백 안내·직접 짜기 링크 없음', async () => {
      itineraryScript = () =>
        itinerary({
          solveMode: 'FULL_AI',
          isFallback: false,
          generationState: 'FAILED',
        });

      renderPage();

      const stale = await screen.findByTestId(STALE, {}, WAIT);
      expect(stale).toHaveTextContent(STALE_FAILED_NOTE);
      expect(
        within(screen.getByTestId(SHELL)).getByTestId(STALE)
      ).toBeOnTheScreen();
      expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();
      expect(treeOrder(['sheet-header-root', STALE])).toEqual([
        'sheet-header-root',
        STALE,
      ]);
      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        'AI 추천안'
      );
      expect(screen.queryByTestId(BANNER)).toBeNull();
      expect(screen.queryByTestId('itinerary-draft-manual')).toBeNull();
      // 실패 안내 아이콘도 ✓ 가 아니다(AC-7).
      expect(
        within(stale).UNSAFE_queryAllByType(AlertCircleGlyph).length
      ).toBeGreaterThanOrEqual(1);
      expect(screen.UNSAFE_queryAllByType(CheckCircleGlyph)).toHaveLength(0);
    });
  });

  describe('🔴 S4 · AC-4 — 폴백과 staleFailed 가 겹치면 두 안내가 다 뜬다', () => {
    it('DETERMINISTIC·isFallback + FAILED → 셸에 폴백 안내와 stale 안내가 함께 있다', async () => {
      itineraryScript = () =>
        itinerary({
          solveMode: 'DETERMINISTIC',
          isFallback: true,
          generationState: 'FAILED',
        });

      await openFallbackShell();

      expect(screen.getByTestId(BANNER)).toBeOnTheScreen();
      expect(screen.getByTestId(STALE)).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        FALLBACK_TITLE
      );
    });
  });

  describe('S5 · AC-5 — 깨끗한 COMPLETE 는 지금의 h08 그대로다 (무회귀 · 짝)', () => {
    it('제목 AI 추천안 · 폴백/stale 안내·부제·안내 제목·직접 짜기 링크 0', async () => {
      itineraryScript = () => itinerary({});

      renderPage();

      // 긍정 앵커 — 셸 카드가 떴다(로딩 중 공허 통과 방지, 02a ★5).
      expect(
        await screen.findByTestId(cardId('poi-a'), {}, WAIT)
      ).toBeOnTheScreen();
      expect(screen.getByTestId(SHELL)).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        'AI 추천안'
      );
      expect(screen.queryByTestId(BANNER)).toBeNull();
      expect(screen.queryByTestId(STALE)).toBeNull();
      expect(screen.queryByTestId('itinerary-draft-reason-title')).toBeNull();
      expect(
        screen.queryByTestId('itinerary-draft-reason-subtitle')
      ).toBeNull();
      expect(screen.queryByTestId('itinerary-draft-manual')).toBeNull();
    });
  });

  describe('S6 · AC-6 — MANUAL(MINIMAL·isFallback=false)엔 폴백 안내가 없다 (F-7 · 선제 green 트립와이어)', () => {
    it('인터스티셜 없이 셸 · 폴백 안내 0 (제목은 TRIP-1038 몫이라 안 본다)', async () => {
      itineraryScript = () =>
        itinerary({
          generationMode: 'MANUAL',
          solveMode: 'MINIMAL',
          isFallback: false,
        });

      renderPage();

      expect(
        await screen.findByTestId(cardId('poi-a'), {}, WAIT)
      ).toBeOnTheScreen();
      expect(screen.getByTestId(SHELL)).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-fallback-root')).toBeNull();
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });
  });

  describe('🔴 S7 · AC-10 — 폴백 안내의 「처음부터 직접 짜기」는 비우기 확인을 먼저 띄우고 CTA 두 개는 그대로다 (D2 · TRIP-1038 C)', () => {
    it('링크 1개(안내 안) → 누르면 초기화 확인이 뜨고 push 0 · CTA 다시 짜기/확정하기', async () => {
      itineraryScript = () =>
        itinerary({ solveMode: 'DETERMINISTIC', isFallback: true });

      await openFallbackShell();

      const banner = screen.getByTestId(BANNER);
      const link = within(banner).getByTestId('itinerary-draft-manual');
      expect(screen.queryAllByTestId('itinerary-draft-manual')).toHaveLength(1);
      expect(link).toHaveTextContent(MANUAL_LINK);
      expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
        '다시 짜기'
      );
      expect(screen.getByTestId('sheet-cta-button-1')).toHaveTextContent(
        '확정하기'
      );

      fireEvent.press(link);

      // TRIP-1038 C(#036) — 곧장 수동 짜기로 가지 않는다. 비우기 확인이 먼저다(계속·취소는
      // 「직접 짠(MANUAL) 초안」 describe C2·C5 가 잰다). 「기본 일정 보기」도 로컬 dismiss 라 push 0.
      expect(
        screen.getByTestId('itinerary-draft-manual-reset-confirm')
      ).toBeOnTheScreen();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('🔴 S9 · 경고-1 보강(02c) — 셸 일차 칩은 데이터가 도착한 날만 그린다 (눌러도 무반응인 칩 금지)', () => {
    /** 칩 testID 는 `sheet-daychip-{index}`(뒤로 버튼·루트와 구별되게 숫자만) — 트리 순서대로. */
    function chipLabels(): string[] {
      return screen
        .queryAllByTestId(/^sheet-daychip-\d+$/)
        .map((node) => String(node.props.testID));
    }

    it('3일 여행에 1일차만 온 FAILED 초안 — 칩은 1일차 하나뿐이다', async () => {
      itineraryScript = () => itinerary({ generationState: 'FAILED' });

      renderPage();
      await screen.findByTestId(STALE, {}, WAIT);

      expect(chipLabels()).toEqual(['sheet-daychip-0']);
      expect(screen.getByTestId('sheet-daychip-0')).toHaveTextContent('1일차');
    });

    it('1·3일차만 온 초안 — 칩은 1일차·3일차 둘이고, 둘째 칩을 누르면 3일차로 바뀐다 (칩 번호 ↔ 날짜 대응)', async () => {
      itineraryScript = () =>
        itinerary({
          generationState: 'FAILED',
          days: [
            { date: DAY1, slots: [slot('poi-a')] },
            { date: DAY3, slots: [slot('poi-c')] },
          ],
        });

      renderPage();
      await screen.findByTestId(STALE, {}, WAIT);

      expect(chipLabels()).toEqual(['sheet-daychip-0', 'sheet-daychip-1']);
      expect(screen.getByTestId('sheet-daychip-0')).toHaveTextContent('1일차');
      expect(screen.getByTestId('sheet-daychip-1')).toHaveTextContent('3일차');

      // 실행 — 둘째 칩. 줄인 목록의 번호를 옛 여행 기간 번호(2일차=데이터 없음)로 읽으면 1일차로 되돌아간다.
      fireEvent.press(screen.getByTestId('sheet-daychip-1'));

      expect(await screen.findByTestId('sheet-header-day')).toHaveTextContent(
        '3일차'
      );
      expect(
        screen.getByTestId(`slot-stopcard-${buildSlotKey(DAY3, 'poi-c')}`)
      ).toBeOnTheScreen();
    });
  });
});

// TRIP-1040 · 옛 DraftPage.gaugeFold.integration.test.tsx
describe('칸 상한 게이지 접기', () => {
  /**
   * TRIP-1040 · AC-10 — h07 부분 결과 진행 카드의 **칸 상한 4**를 실 HTTP 로 태우는 심판.
   *
   * 무엇을 보장하나:
   *  - 🔴 5일 여행·day1 도착이면 칸이 4개다 — 일차 칸 3개 + 맨 끝 `…` 접기 칸(뒤 접기).
   *  - 🔴 7일 여행·day1~4 도착이면 `…` 가 맨 앞이고, 지금 만드는 5일차가 창 끝에 보인다(앞 접기 · 결정 2 = b).
   *  - 상한 4는 소비처(DraftPage)가 정한다 — 위젯은 받은 칸을 그대로 그린다. 상한이 없거나 5면 5일 여행이
   *    5칸이 되어 red.
   *  - 3일 이하 무회귀는 「h07 부분 결과(PARTIAL) 셸」 describe A8-1b 가 그대로 잰다.
   *
   * ★ 칸 testID 의 n 은 일차가 아니라 **칸 위치**다 — 앞 접기면 `cell-2-done` 이 3일차다. 그래서 일차는
   *   칸 안 글자(`toHaveTextContent` = 완전 일치)로 읽는다(02a ★1·★3).
   *
   * 3동작 뼈대: 준비=여행 기간·도착 일자를 가짜 서버에 지정 → 실행=화면을 연다 → 단언=칸 순서·칸 글자.
   * 목킹 규약은 「h07 부분 결과(PARTIAL) 셸」 describe 를 그대로 따른다.
   */

  // 옛 목엔 canGoBack 이 없어 부르면 TypeError 로 red 였다 — 합친 목에서도 그 그물을 남긴다(TRIP-1150).
  afterEach(() => {
    expect(mockCanGoBack).not.toHaveBeenCalled();
  });

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';

  /** 6월 10일부터 `count` 일의 날짜. */
  function datesFrom10(count: number): string[] {
    return Array.from(
      { length: count },
      (_, index) => `2026-06-${String(10 + index).padStart(2, '0')}`
    );
  }

  /** 여행 기간 — 게이지 칸의 출처는 `days.length` 가 아니라 이 두 날짜다. */
  function trip(dayCount: number): Trip {
    const dates = datesFrom10(dayCount);
    return {
      tripId: TRIP_ID,
      title: `제주 ${dayCount}일`,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: dayCount - 1 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /** 하루치 슬롯 1개 — 이 파일은 게이지만 본다(시각·거리 심판은 형제 파일 몫). 좌표는 지도 center 용. */
  function daySlots(date: string): ItineraryDaysItemSlotsItem[] {
    return [
      {
        poiId: `poi-${date}`,
        startAt: '09:30:00',
        endAt: '11:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: ['바다'],
        nameKo: '광안리 해변',
        category: '자연',
        imageUrl: null,
        distanceRange: null,
        lat: 33.458,
        lng: 126.942,
      },
    ];
  }

  /** 생성 중(PARTIAL) — 앞에서부터 `arrivedCount` 일만 도착했다. */
  function partialItinerary(tripDays: number, arrivedCount: number): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'PARTIAL',
      isFallback: false,
      days: datesFrom10(tripDays)
        .slice(0, arrivedCount)
        .map((date) => ({ date, slots: daySlots(date) })),
    };
  }

  function serve(tripDays: number, arrivedCount: number) {
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(trip(tripDays))
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(partialItinerary(tripDays, arrivedCount))
      )
    );
  }

  beforeEach(() => {
    setAccessToken('valid-access');
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /** `retry:false`·`gcTime:0` — 형제 파일과 같다. PARTIAL 은 폴링을 부르지만 같은 값이라 첫 렌더만 본다. */
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
    return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** 게이지 칸 testID 를 화면 순서대로(트랙 testID 는 접두가 달라 안 잡힌다). */
  function cellOrder(): string[] {
    return screen
      .getAllByTestId(/^generation-gauge-cell-/)
      .map((node) => String(node.props.testID));
  }

  describe('🔴 G-1 · TRIP-1040 AC-10 — 칸 상한 4가 실제 화면에 걸린다', () => {
    it('I-5d · 5일 여행·day1 도착 → [1일차 완성, 2일차 생성 중, 3일차 대기, …] (뒤 접기)', async () => {
      // 준비 — 5일 여행, day1 만 도착.
      serve(5, 1);

      // 실행
      renderPage();
      await screen.findByTestId('generation-progress-card');

      // 단언 — 칸 4개, `…` 는 맨 끝.
      expect(cellOrder()).toEqual([
        'generation-gauge-cell-1-done',
        'generation-gauge-cell-2-active',
        'generation-gauge-cell-3-waiting',
        'generation-gauge-cell-more',
      ]);
      expect(
        screen.getByTestId('generation-gauge-cell-1-done')
      ).toHaveTextContent('1일차 완성');
      expect(
        screen.getByTestId('generation-gauge-cell-2-active')
      ).toHaveTextContent('2일차 생성 중');
      expect(
        screen.getByTestId('generation-gauge-cell-3-waiting')
      ).toHaveTextContent('3일차 대기');
      expect(
        screen.getByTestId('generation-gauge-cell-more')
      ).toHaveTextContent('…');
      // 일차 칸은 3개뿐 — 4·5일차는 `…` 뒤로 숨는다.
      expect(screen.getAllByTestId(/^generation-gauge-cell-\d+-/)).toHaveLength(
        3
      );
    });

    it('I-7d · 7일 여행·day1~4 도착 → […, 3일차 완성, 4일차 완성, 5일차 생성 중] (앞 접기 · 결정 2 = b)', async () => {
      // 준비 — 7일 여행, day1~4 도착(지금 만드는 중 = 5일차).
      serve(7, 4);

      // 실행
      renderPage();
      await screen.findByTestId('generation-progress-card');

      // 단언 — `…` 가 맨 앞, 활성 5일차가 창 끝. 일차 칸 testID 는 칸 위치(2부터)다.
      expect(cellOrder()).toEqual([
        'generation-gauge-cell-more',
        'generation-gauge-cell-2-done',
        'generation-gauge-cell-3-done',
        'generation-gauge-cell-4-active',
      ]);
      expect(
        screen.getByTestId('generation-gauge-cell-more')
      ).toHaveTextContent('…');
      expect(
        screen.getByTestId('generation-gauge-cell-2-done')
      ).toHaveTextContent('3일차 완성');
      expect(
        screen.getByTestId('generation-gauge-cell-3-done')
      ).toHaveTextContent('4일차 완성');
      expect(
        screen.getByTestId('generation-gauge-cell-4-active')
      ).toHaveTextContent('5일차 생성 중');
    });
  });
});

// TRIP-1032 · 옛 DraftPage.generationBusy.integration.test.tsx
describe('이 여행 생성 중 확인', () => {
  /**
   * TRIP-1032 · 초안 화면(h11)의 재생성 — 사용자 결정(2026-09-27) "이미 생성 중이면 새 생성을 못 하게,
   * 다시 만들려면 기존 것을 취소하게".
   *
   * 무엇을 보장하나:
   *  - 🔴 D1~D3 **이 여행이 생성 중**(PARTIAL + 세션 있음)이면 [다시 시도]가 곧장 생성 화면으로 가지 않고
   *    확인을 먼저 연다. [계속]이어야 생성 화면으로 replace 1회(따로 cancel 하지 않는다 — 01b Q4),
   *    [취소]면 이동 0(AC-7).
   *  - 🔴 D4 세션 없는 PARTIAL 은 생성 중이 아니다 — 확인 없이 곧장 생성 화면으로(01b Q3).
   *  - TRIP-1037 플립: 재생성 POST 는 이제 생성 화면(GeneratingPage)이 마운트될 때 1회 보낸다 — 초안 화면의
   *    POST 는 어느 케이스에서도 0이다. 옛 D5~D7(초안 화면 위 409 안내)은 대상이 사라져 지웠다. 같은 계약은
   *    `GeneratingPage.integration.test.tsx` 「다른 여행 생성 중(409) 안내」 G1~G8 이 진다(1037 01b Q1).
   *
   * ★ D1~D4 의 `days: []` 는 억지가 아니다 — PARTIAL 에 슬롯이 있으면 h07 지도+시트 셸로 가고 그 셸엔
   * 재생성 버튼이 없다. [다시 시도](DraftScreen 앱바)에 닿는 PARTIAL 은 빈 얼굴일 때뿐이다(02a ★4).
   *
   * 3동작: 준비 = 가짜 서버 응답 → 실행 = 화면을 열고 [다시 시도]·확인·안내 버튼을 누른다 → 단언 = 얼굴·요청.
   */

  const BASE = 'http://localhost:8080/api/v1';
  /** 이 화면의 여행(T1)과 그 생성 세션(S1). */
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const OWN_SESSION_ID = '44444444-4444-4444-4444-444444444444';

  const LABEL: Record<string, string> = {
    [TRIP_ID]: 'T1',
    [OWN_SESSION_ID]: 'S1',
  };
  const label = (id: unknown): string => LABEL[String(id)] ?? String(id);

  /** 생성 화면 이동 계약 — successRoute 없이 mode=FULLY_AI(TRIP-1037 결정 A). */
  const EXPECTED_ROUTE = {
    pathname: '/trips/[tripId]/itinerary/generating',
    params: { tripId: TRIP_ID, mode: 'FULLY_AI' },
  };

  const DAY1 = '2026-06-10';
  const DAY3 = '2026-06-12';

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 3일',
      startDate: DAY1,
      endDate: DAY3,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function oneDay(date: string): ItineraryDaysItem {
    return {
      date,
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
          nameKo: '광안리 해변',
          category: '자연',
          imageUrl: null,
          distanceRange: null,
          lat: 33.458,
          lng: 126.942,
        },
      ],
    };
  }

  function itinerary(input: {
    generationState: ItineraryGenerationState;
    generationSessionId?: string | null;
    days: ItineraryDaysItem[];
  }): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: input.generationState,
      generationSessionId: input.generationSessionId,
      isFallback: false,
      days: input.days,
    };
  }

  /** 이 여행이 생성 중 — 1일차도 아직 안 와 빈 얼굴(★4). */
  const ownGenerating = (): Itinerary =>
    itinerary({
      generationState: 'PARTIAL',
      generationSessionId: OWN_SESSION_ID,
      days: [],
    });
  /** 깨끗한 COMPLETE 3일 — h08 셸, 하단 [다시 짜기]. */
  const completeThreeDays = (): Itinerary =>
    itinerary({
      generationState: 'COMPLETE',
      generationSessionId: null,
      days: [oneDay(DAY1), oneDay('2026-06-11'), oneDay(DAY3)],
    });

  const created = (): Response =>
    HttpResponse.json(
      itinerary({
        generationState: 'PARTIAL',
        generationSessionId: OWN_SESSION_ID,
        days: [oneDay(DAY1)],
      }),
      { status: 201 }
    );

  function canceledSession(): GenerationSession {
    return {
      sessionId: OWN_SESSION_ID,
      status: 'CANCELED',
      mode: 'FULLY_AI',
      isFallback: false,
      startedAt: '2026-09-27T10:00:00.000Z',
      finishedAt: '2026-09-27T10:03:00.000Z',
    };
  }

  /** 관심 요청만 순서대로: `POST T1` · `CANCEL T1/S1` (자기 조회·폴링은 적지 않는다). 이 파일 전부에서 비어야 한다. */
  let log: string[] = [];
  /** T1 일정 GET 응답(케이스가 정한다). */
  let ownItinerary: () => Itinerary;

  const count = (prefix: string): number =>
    log.filter((line) => line.startsWith(prefix)).length;

  beforeEach(() => {
    log = [];
    mockPush.mockClear();
    mockReplace.mockClear();
    mockBack.mockClear();
    setAccessToken('valid-access');
    ownItinerary = completeThreeDays;

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(ownItinerary())
      ),
      http.post(`${BASE}/trips/:tripId/itinerary`, ({ params }) => {
        log.push(`POST ${label(params.tripId)}`);
        return created();
      }),
      http.post(
        `${BASE}/trips/:tripId/generation-sessions/:sessionId/cancel`,
        ({ params }) => {
          log.push(`CANCEL ${label(params.tripId)}/${label(params.sessionId)}`);
          return HttpResponse.json(canceledSession());
        }
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /** `retry:false`·`gcTime:0` — 형제 DraftPage 통합 테스트와 같은 클라이언트. */
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
    return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** "안 나갔다"는 나갈 시간을 준 뒤에야 의미가 있다(02a ★5). */
  function settle(ms = 300): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  /** 빈 얼굴(DraftScreen)이 뜬 뒤 앱바 [다시 시도]를 누른다. */
  async function pressDraftRetry(): Promise<void> {
    await screen.findByTestId('itinerary-draft-empty');
    fireEvent.press(screen.getByTestId('itinerary-draft-retry'));
  }

  describe('🔴 D1 · AC-7 — 이 여행이 생성 중이면 [다시 시도]가 확인을 먼저 연다', () => {
    it('확인 얼굴·제목이 뜨고, 확인 전엔 생성 화면 이동·POST 가 0이다', async () => {
      ownItinerary = ownGenerating;

      renderPage();
      await pressDraftRetry();

      expect(
        await screen.findByTestId('itinerary-draft-inprogress-confirm')
      ).toBeOnTheScreen();
      // 01b Q7 채택 문구 — 정확 일치(02a ★7).
      expect(
        screen.getByText('지금 만들고 있는 일정이 있어요')
      ).toBeOnTheScreen();

      await settle();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(count('POST')).toBe(0);
      expect(renderedText()).not.toMatch(/\d+\s*(분|초|시간)|소요|%/);
    });
  });

  describe('🔴 D2 · AC-7·Q4 — 확인의 [계속]이어야 생성 화면으로 1회 (cancel 은 따로 안 부른다)', () => {
    it('계속 → replace 1(mode=FULLY_AI) · 초안 화면 POST 0 · cancel 0', async () => {
      ownItinerary = ownGenerating;

      renderPage();
      await pressDraftRetry();
      fireEvent.press(
        await screen.findByTestId('itinerary-draft-inprogress-confirm-continue')
      );

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
      await settle();
      expect(mockReplace).toHaveBeenCalledTimes(1);
      // POST 는 생성 화면이 마운트될 때 보낸다(TRIP-1037). 같은 여행 POST 는 서버가 이전 세션을 스스로
      // 닫는다 — 명시 cancel 은 실패 지점만 늘린다(01b Q4).
      expect(count('POST')).toBe(0);
      expect(count('CANCEL')).toBe(0);
    });
  });

  describe('🔴 D3 · AC-7 — 확인의 [취소]면 아무것도 안 나간다', () => {
    it('취소 → 확인 닫힘 · 생성 화면 이동 0 · POST 0', async () => {
      ownItinerary = ownGenerating;

      renderPage();
      await pressDraftRetry();
      fireEvent.press(
        await screen.findByTestId('itinerary-draft-inprogress-confirm-cancel')
      );

      await waitFor(() =>
        expect(
          screen.queryByTestId('itinerary-draft-inprogress-confirm')
        ).toBeNull()
      );
      await settle();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(count('POST')).toBe(0);
    });
  });

  describe('🔴 D4 · 01b Q3 — 세션 없는 PARTIAL 은 생성 중이 아니다 (TRIP-1037 플립)', () => {
    it('generationSessionId=null 이면 확인 없이 곧장 생성 화면으로 replace 1 · POST 0', async () => {
      ownItinerary = () =>
        itinerary({
          generationState: 'PARTIAL',
          generationSessionId: null,
          days: [],
        });

      renderPage();
      await pressDraftRetry();

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
      expect(
        screen.queryByTestId('itinerary-draft-inprogress-confirm')
      ).toBeNull();
      await settle();
      expect(count('POST')).toBe(0);
    });
  });
});

// TRIP-1038 · 옛 DraftPage.manual.integration.test.tsx
describe('직접 짠(MANUAL) 초안', () => {
  /**
   * TRIP-1038 — 직접 짠 일정(MANUAL)의 초안 얼굴과 「처음부터 직접 짜기」 비우기 확인을 실 HTTP 로 태운다.
   *
   * 무엇을 보장하나:
   *  - (A) MANUAL 초안은 「내 일정」이고 CTA 가 「편집하기」·「확정하기」다. 어떤 버튼으로도 AI 생성 POST 가
   *    나가지 않는다(QA #040 · BR-U3-18). MANUAL 인데 장소가 0곳이면 AI 빈 얼굴 대신 편집기로 보낸다.
   *    FULLY_AI·CO_PLAN 은 지금 그대로(무회귀).
   *  - (C) 셸 폴백 안내의 「처음부터 직접 짜기」는 곧장 가지 않고 비우기 확인을 먼저 띄운다(QA #036).
   *    계속 → 편집기에 `fresh:'1'` 을 실어 보낸다. 취소 → 셸 그대로. 확정된 일정에선 확인이 안 열린다.
   *    폴백 인터스티셜의 「직접 짜기」는 이번 범위 밖이라 지금 그대로다(01 Q7).
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=렌더·버튼 press → 단언=제목·CTA 글자·라우터 호출·POST 건수.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '44444444-4444-4444-4444-444444444444';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';

  /** 첫 조회 대기 한도 — 로컬 기본 1000ms 의 CI 러너(약 4배 느림) 환산. */
  const WAIT = { timeout: 4000 };

  const SHELL = 'map-sheet-shell-root';
  const TITLE = 'sheet-header-title';
  const CTA0 = 'sheet-cta-button-0';
  const CTA1 = 'sheet-cta-button-1';
  const BANNER = 'itinerary-draft-fallback-banner';
  const STALE = 'itinerary-draft-stale-failed';
  const LINK = 'itinerary-draft-manual';
  const RESET = 'itinerary-draft-manual-reset-confirm';
  const RESET_CONTINUE = 'itinerary-draft-manual-reset-confirm-continue';
  const RESET_CANCEL = 'itinerary-draft-manual-reset-confirm-cancel';

  const MANUAL_ROUTE = '/trips/[tripId]/itinerary/manual';

  const cardId = (poiId: string): string =>
    `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '강릉 2일',
      startDate: DAY1,
      endDate: DAY2,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '강릉', nights: 1 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function slot(
    poiId: string,
    over: Partial<ItineraryDaysItemSlotsItem> = {}
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      startAt: '09:30:00',
      endAt: '11:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: `장소-${poiId}`,
      lat: 37.75,
      lng: 128.9,
      ...over,
    };
  }

  function itinerary(input: {
    generationMode: ItineraryGenerationMode;
    solveMode?: ItinerarySolveMode;
    isFallback?: boolean;
    generationState?: ItineraryGenerationState;
    status?: ItineraryStatus;
    days?: Itinerary['days'];
  }): Itinerary {
    return {
      itineraryId: 'itin-1038',
      tripId: TRIP_ID,
      status: input.status ?? 'PLANNED',
      solveMode: input.solveMode ?? 'FULL_AI',
      generationMode: input.generationMode,
      generationState: input.generationState ?? 'COMPLETE',
      isFallback: input.isFallback ?? false,
      days: input.days ?? [
        {
          date: DAY1,
          slots: [
            slot('poi-a'),
            slot('poi-b', { startAt: '13:00:00', endAt: '14:00:00' }),
          ],
        },
      ],
    };
  }

  /** 직접 짠 일정 — MANUAL 은 MINIMAL 인데 isFallback=false 다(실패가 아니라 선택 · traps-itinerary). */
  function manual(over: Partial<Parameters<typeof itinerary>[0]> = {}) {
    return itinerary({
      generationMode: 'MANUAL',
      solveMode: 'MINIMAL',
      isFallback: false,
      ...over,
    });
  }

  /** 폴백 초안 — 인터스티셜이 먼저 잡고, 「기본 일정 보기」 뒤에 셸 폴백 얼굴(링크 있음)이 뜬다. */
  function fallback(status: ItineraryStatus = 'PLANNED') {
    return itinerary({
      generationMode: 'FULLY_AI',
      solveMode: 'DETERMINISTIC',
      isFallback: true,
      status,
    });
  }

  let itineraryScript: () => Itinerary;
  /** POST /trips/{tripId}/itinerary(생성·재생성) 건수 — 이 파일의 금지 단언 대부분이 이 값이다. */
  let generatePosts = 0;

  beforeEach(() => {
    generatePosts = 0;
    [mockPush, mockReplace, mockBack].forEach((fn) => fn.mockClear());
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itineraryScript())
      ),
      http.post(`${BASE}/trips/:tripId/itinerary`, () => {
        generatePosts += 1;
        return HttpResponse.json(itineraryScript(), { status: 201 });
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

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
    return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** 누름 → mutate → fetch → msw 는 비동기다 — 흘려 보낸 뒤에 세야 "0건"이 뜻을 갖는다(02a ★4). */
  async function flush(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }

  async function openFallbackShell(): Promise<void> {
    renderPage();
    fireEvent.press(
      await screen.findByTestId('itinerary-fallback-view-plan', {}, WAIT)
    );
    await screen.findByTestId(SHELL, {}, WAIT);
  }

  // ─── (A) MANUAL 초안 얼굴 ────────────────────────────────────────────────

  describe('🔴 A1 · #040 — MANUAL 초안은 「내 일정」이고 CTA 가 「편집하기」·「확정하기」다 (US-SCHED-10 · BR-U3-11)', () => {
    it('제목 내 일정 · CTA 편집하기/확정하기 · AI 추천안·다시 짜기·기본 일정 글자 0 · 폴백 안내 0', async () => {
      itineraryScript = () => manual();

      renderPage();

      // 긍정 앵커 — 셸 카드가 떴다(로딩 중 공허 통과 방지).
      expect(
        await screen.findByTestId(cardId('poi-a'), {}, WAIT)
      ).toBeOnTheScreen();
      expect(screen.getByTestId(TITLE)).toHaveTextContent('내 일정');
      expect(screen.getByTestId(CTA0)).toHaveTextContent('편집하기');
      expect(screen.getByTestId(CTA1)).toHaveTextContent('확정하기');
      expect(screen.queryByText('AI 추천안')).toBeNull();
      expect(screen.queryByText('다시 짜기')).toBeNull();
      expect(screen.queryByText('기본 일정')).toBeNull();
      expect(screen.queryByTestId(BANNER)).toBeNull();
    });

    it('A1b · 일부 조회 실패(FAILED)여도 MANUAL 이면 「내 일정」·「편집하기」다 — 실패 안내는 그대로 붙는다', async () => {
      itineraryScript = () => manual({ generationState: 'FAILED' });

      renderPage();

      // 짝 — 실패 안내가 떠 있다(이 얼굴이 staleFailed 셸임을 확인).
      expect(await screen.findByTestId(STALE, {}, WAIT)).toBeOnTheScreen();
      expect(screen.getByTestId(TITLE)).toHaveTextContent('내 일정');
      expect(screen.getByTestId(CTA0)).toHaveTextContent('편집하기');
      expect(screen.queryByText('다시 짜기')).toBeNull();
    });
  });

  describe('🔴 A2 · 「편집하기」 — 기존 일정을 이어 편집하는 편집기로 간다 (POST 0 · TRIP-601 가드 a)', () => {
    it('push 1회 · 경로 manual · params 에 fresh 없음 · 생성 POST 0', async () => {
      itineraryScript = () => manual();
      renderPage();
      await screen.findByTestId(cardId('poi-a'), {}, WAIT);

      fireEvent.press(screen.getByTestId(CTA0));
      await flush();

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: MANUAL_ROUTE,
        params: { tripId: TRIP_ID },
      });
      // toHaveBeenCalledWith 는 undefined 속성을 없는 것으로 본다 — fresh 가 어떤 값으로도 실리지 않았는지 따로 본다(02a ★2).
      expect(mockPush.mock.calls[0][0].params.fresh).toBeUndefined();
      expect(generatePosts).toBe(0);
    });
  });

  describe('🔴 A3 · BR-U3-18 — MANUAL 셸의 어떤 버튼을 눌러도 AI 생성 POST 가 나가지 않는다', () => {
    it('CTA 두 개와 ‹ 를 모두 눌러도 POST /trips/{tripId}/itinerary 는 0건이다', async () => {
      itineraryScript = () => manual();
      renderPage();
      await screen.findByTestId(cardId('poi-a'), {}, WAIT);

      fireEvent.press(screen.getByTestId(CTA0));
      fireEvent.press(screen.getByTestId(CTA1));
      fireEvent.press(screen.getByTestId('sheet-daychip-back'));
      await flush();

      expect(generatePosts).toBe(0);
    });
  });

  describe('A4 · 무회귀 — FULLY_AI·CO_PLAN 깨끗한 초안은 지금 그대로다 (선제 green)', () => {
    it.each<ItineraryGenerationMode>(['FULLY_AI', 'CO_PLAN'])(
      '%s — 제목 AI 추천안 · CTA 다시 짜기/확정하기',
      async (generationMode) => {
        itineraryScript = () => itinerary({ generationMode });

        renderPage();

        expect(
          await screen.findByTestId(cardId('poi-a'), {}, WAIT)
        ).toBeOnTheScreen();
        expect(screen.getByTestId(TITLE)).toHaveTextContent('AI 추천안');
        expect(screen.getByTestId(CTA0)).toHaveTextContent('다시 짜기');
        expect(screen.getByTestId(CTA1)).toHaveTextContent('확정하기');
      }
    );
  });

  describe('A5 · MANUAL 「확정하기」는 지금처럼 완성 일정(h14)으로 간다 (선제 green)', () => {
    it('push 1회 · 경로 /trips/[tripId]/itinerary · POST 0', async () => {
      itineraryScript = () => manual();
      renderPage();
      await screen.findByTestId(cardId('poi-a'), {}, WAIT);

      fireEvent.press(screen.getByTestId(CTA1));
      await flush();

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary',
        params: { tripId: TRIP_ID },
      });
      expect(generatePosts).toBe(0);
    });
  });

  describe('🔴 A6 · 01 Q1 — MANUAL 인데 장소가 0곳이면 AI 빈 얼굴 대신 편집기로 보낸다', () => {
    it('replace 1회(manual · fresh 없음) · POST 0 · 「추천안」·「다시 만들기」·「AI가 일정을 짜요」 글자 0', async () => {
      itineraryScript = () =>
        manual({
          days: [
            { date: DAY1, slots: [] },
            { date: DAY2, slots: [] },
          ],
        });

      renderPage();

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: MANUAL_ROUTE,
        params: { tripId: TRIP_ID },
      });
      expect(mockReplace.mock.calls[0][0].params.fresh).toBeUndefined();
      await flush();
      // 한 번만 보낸다(렌더마다 다시 부르지 않는다).
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(generatePosts).toBe(0);
      // 부분 일치는 정규식으로 — 문자열이면 완전 일치라 「아직 만들어진 추천안이 없어요」를 못 잡는다(02a ★1).
      expect(screen.queryByText(/추천안/)).toBeNull();
      expect(screen.queryByText('다시 만들기')).toBeNull();
      expect(screen.queryByText(/AI가 일정을 짜요/)).toBeNull();
    });
  });

  // ─── (C) 「처음부터 직접 짜기」 비우기 확인 ─────────────────────────────────

  describe('🔴 C1 · #036 — 「처음부터 직접 짜기」는 곧장 가지 않고 비우기 확인을 먼저 띄운다 (BR-U3-18)', () => {
    it('확인 얼굴(제목·비우고 시작·취소)이 셸 대신 뜨고, 이 시점까지 라우터·POST 는 0이다', async () => {
      itineraryScript = () => fallback();
      await openFallbackShell();

      fireEvent.press(screen.getByTestId(LINK));

      expect(screen.getByTestId(RESET)).toBeOnTheScreen();
      expect(
        screen.getByText('지금 일정을 비우고 새로 짤까요?')
      ).toBeOnTheScreen();
      expect(screen.getByTestId(RESET_CONTINUE)).toHaveTextContent(
        '비우고 시작'
      );
      expect(screen.getByTestId(RESET_CANCEL)).toHaveTextContent('취소');
      // 얼굴 교체형 — 확인하는 동안 셸은 트리에 없다(조건부 오버레이는 jest 사각 · 02a ★14).
      expect(screen.queryByTestId(SHELL)).toBeNull();
      // 앱에 복원 화면이 없다 — 되돌릴 수 있다고 약속하지 않는다(01b).
      expect(screen.queryByText(/되돌릴 수/)).toBeNull();

      await flush();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(generatePosts).toBe(0);
    });
  });

  describe('🔴 C2 · 확인 「비우고 시작」 → 편집기에 비우기 신호(fresh=1)를 실어 보낸다', () => {
    it('push 1회 · { pathname: manual, params: { tripId, fresh: "1" } } · 초안 화면은 POST 0', async () => {
      itineraryScript = () => fallback();
      await openFallbackShell();
      fireEvent.press(screen.getByTestId(LINK));

      fireEvent.press(screen.getByTestId(RESET_CONTINUE));
      await flush();

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: MANUAL_ROUTE,
        params: { tripId: TRIP_ID, fresh: '1' },
      });
      // 비우는 POST 는 편집기 몫이다(ManualPlanPage.fresh C3) — 초안 화면이 쏘지 않는다.
      expect(generatePosts).toBe(0);
    });
  });

  describe('🔴 C5 · 확인 「취소」 → 셸 그대로 (인터스티셜로 돌아가지 않는다)', () => {
    it('확인 얼굴이 사라지고 셸·폴백 안내가 보이며 인터스티셜은 없다 · 라우터·POST 0', async () => {
      itineraryScript = () => fallback();
      await openFallbackShell();
      fireEvent.press(screen.getByTestId(LINK));
      expect(screen.getByTestId(RESET)).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId(RESET_CANCEL));

      expect(screen.queryByTestId(RESET)).toBeNull();
      expect(screen.getByTestId(SHELL)).toBeOnTheScreen();
      expect(screen.getByTestId(BANNER)).toBeOnTheScreen();
      expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-fallback-root')).toBeNull();
      await flush();
      expect(mockPush).not.toHaveBeenCalled();
      expect(generatePosts).toBe(0);
    });
  });

  describe('C6 · 01 Q7 — 폴백 인터스티셜의 「직접 짜기」는 이번 범위 밖이라 지금 그대로다 (선제 green)', () => {
    it('확인 없이 fresh 없는 manual push 1회', async () => {
      itineraryScript = () => fallback();
      renderPage();

      fireEvent.press(
        await screen.findByTestId('itinerary-fallback-manual', {}, WAIT)
      );

      expect(screen.queryByTestId(RESET)).toBeNull();
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: MANUAL_ROUTE,
        params: { tripId: TRIP_ID },
      });
      expect(mockPush.mock.calls[0][0].params.fresh).toBeUndefined();
    });
  });

  describe('🔴 C7 · 확정된 일정에선 비우기 확인이 열리지 않는다 (확정 해제 API 없음)', () => {
    it('CONFIRMED 폴백 셸 — 링크가 있어도 눌러서 확인이 안 뜨고 fresh 를 실은 이동이 0이다', async () => {
      itineraryScript = () => fallback('CONFIRMED');
      await openFallbackShell();
      // 짝 — 셸 카드가 떠 있다.
      expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();

      // 링크를 숨기든 눌러도 무반응이든 둘 다 허용한다 — 있으면 누른다(02a ★15).
      screen.queryAllByTestId(LINK).forEach((link) => fireEvent.press(link));
      await flush();

      expect(screen.queryByTestId(RESET)).toBeNull();
      const freshMoves = [
        ...mockPush.mock.calls,
        ...mockReplace.mock.calls,
      ].filter(
        ([arg]) =>
          typeof arg === 'object' &&
          arg !== null &&
          (arg as { params?: { fresh?: string } }).params?.fresh !== undefined
      );
      expect(freshMoves).toEqual([]);
      expect(generatePosts).toBe(0);
    });
  });
});

// TRIP-790 · 옛 DraftPage.partial.integration.test.tsx
describe('h07 부분 결과(PARTIAL) 셸', () => {
  /**
   * TRIP-790 · AC-8 h07 "부분 결과" 얼굴을 **실 HTTP 로** 태우는 심판(옛 TRIP-337 h10 게이지
   * 재작성 — 01b D1 로 PARTIAL 얼굴이 DraftScreen 인라인 게이지에서 **공용 지도+시트 셸**로 이동).
   *
   * 무엇을 보장하나 (draft 라우트의 `generationState==='PARTIAL'` 분기):
   *  - 🔴 PARTIAL 이면 **셸 얼굴**이 뜬다 — 전면 지도(`map-root`) + 상단 진행 카드
   *    (`generation-progress-card`, day-chip 대신) + 하단 peek 시트(SheetHeader + SlotStopCard).
   *    옛 게이지 testID(`itinerary-generating-*`)·일차 칩(`itinerary-draft-day-*`)은 사라진다(★1·★2).
   *  - 🔴 게이지 라벨이 `{n}일차 완성/생성 중/대기`(한글, 옛 `Day{n}` 아님)로 tabs 에서 도출된다(AC-6).
   *  - 🔴 도착 일차 슬롯은 isFixed 무관 **전부** 시각 칩(`HH:mm–HH:mm`, en-dash)을 그린다(AC-2·D6).
   *  - 🔴 AI 추천 배지·시간대 라벨·도보 추정·일차 칩·퍼센트·소요시간이 0건이다(AC-3·AC-5·INV-3).
   *  - 🔴 시트 헤더 meta 가 "N곳 · X.Xkm"(거리 합, `이동`/소요 어휘 0)다(AC-4·D8).
   *  - 🔴 생성 중이라 CTA(확정/완성)가 없다(D9).
   *  - `COMPLETE` 면 완성 얼굴(`<DraftScreen>` "AI 추천안")로 복귀하고 셸이 사라진다(revert guard).
   *
   * 왜 통합 버킷인가: 핵심 위험이 "가짜 진척"과 "옛 얼굴 잔존"이다 — 실제 PARTIAL 응답이 배선을
   * 타고 셸 얼굴로 이어지는지, 3상태가 옳게 **도출**되는지를 봐야 한다(DraftPage.integration 머리말 승계).
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=화면을 연다 → 단언=보이는 얼굴·testID·글자.
   */

  // 옛 목엔 canGoBack 이 없어 부르면 TypeError 로 red 였다 — 합친 목에서도 그 그물을 남긴다(TRIP-1150).
  afterEach(() => {
    expect(mockCanGoBack).not.toHaveBeenCalled();
  });

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';

  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';
  const DAY3 = '2026-06-12';

  /** 3일 여행 — 탭·게이지 셀 개수의 출처는 `days.length` 가 아니라 이 두 날짜다(01b D7). */
  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 3일',
      startDate: DAY1,
      endDate: DAY3,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /**
   * 하루치 3슬롯 — AC-2·AC-4 를 한 픽스처로 잰다.
   *  - 슬롯 b 는 **isFixed=true**(고정)인데도 시각 칩이 떠야 한다(AC-2 핵심 · D6).
   *  - 첫 슬롯 distanceRange 는 **null**(거점 없는 날)이다. 헤더 합은 커넥터 구간(`slice(1)`)만 더하므로
   *    3.5km(2.1+1.4)다 — TRIP-1110 이후 전 슬롯을 넘기면 첫 null 에 접혀 A8-1e 가 red 가 된다(A8-4b 짝).
   *  - lat/lng 를 실어 셸 지도(map-root)가 마운트되고 DraftPage 가 center 를 계산하게 한다.
   */
  function daySlots(date: string): ItineraryDaysItemSlotsItem[] {
    return [
      {
        poiId: 'poi-a',
        startAt: '09:30:00',
        endAt: '11:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: ['바다', '산책'],
        nameKo: '광안리 해변',
        category: '자연',
        imageUrl: null,
        distanceRange: null,
        lat: 33.458,
        lng: 126.942,
      },
      {
        poiId: 'poi-b',
        startAt: '13:00:00',
        endAt: '14:30:00',
        isFixed: true,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: ['호텔'],
        nameKo: `${date} 숙소`,
        category: '숙소',
        imageUrl: null,
        distanceRange: '2.1km',
        lat: 33.512,
        lng: 126.522,
      },
      {
        poiId: 'poi-c',
        startAt: '15:00:00',
        endAt: '16:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: ['카페'],
        nameKo: '흰여울 마을',
        category: '자연',
        imageUrl: null,
        distanceRange: '1.4km',
        lat: 33.245,
        lng: 126.412,
      },
    ];
  }

  /** 도착한 일자만 담는다(PARTIAL 은 day1 만). */
  function daysUpTo(count: number): ItineraryDaysItem[] {
    return [DAY1, DAY2, DAY3]
      .slice(0, count)
      .map((date) => ({ date, slots: daySlots(date) }));
  }

  function itinerary(input: {
    dayCount: number;
    generationState: ItineraryGenerationState;
  }): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: input.generationState,
      isFallback: false,
      days: daysUpTo(input.dayCount),
    };
  }

  /** PARTIAL day1 에서 슬롯 a·b·c 의 distanceRange 만 `ranges` 로 덮어쓴다(TRIP-1110 헤더 케이스). */
  function partialWithRanges(ranges: (string | null)[]): Itinerary {
    const base = itinerary({ dayCount: 1, generationState: 'PARTIAL' });
    return {
      ...base,
      days: base.days.map((day) => ({
        ...day,
        slots: day.slots.map((slot, index) => ({
          ...slot,
          distanceRange: ranges[index],
        })),
      })),
    };
  }

  /** GET /itinerary 응답을 케이스가 정한다(PARTIAL day1만 · COMPLETE 3일 전부). */
  let itineraryHandler: () => Response;

  /** 렌더된 문자열 전부를 공백으로 이어 붙인다. 퍼센트·소요 부정 스캔의 모집단이다 — 소스가 아니라
   * **보이는 글자**를 훑는다(DraftScreen.test.tsx C14 와 동일 패턴). */
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

  beforeEach(() => {
    mockPush.mockClear();
    mockBack.mockClear();
    setAccessToken('valid-access');
    itineraryHandler = () =>
      HttpResponse.json(
        itinerary({ dayCount: 3, generationState: 'COMPLETE' })
      );

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => itineraryHandler()),
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

  /** `retry:false`·`gcTime:0` — 실패를 즉시 실패로, 폴링 타이머가 종료 후 프로세스를 붙잡는 것 방지.
   * refetchInterval 은 배선의 책임이라 여기서 주지 않는다. PARTIAL 응답은 폴링을 유발하지만 값이
   * 안정적이라(같은 PARTIAL) 재렌더가 무해하고, 첫 렌더 상태만 findBy 로 즉시 단언한다. */
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
    return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  describe('A8-0 · 탐지기 자가검사 — 이게 통과해야 아래 "퍼센트 0건"이 의미를 갖는다', () => {
    it('퍼센트 스캔은 쪼개 그린 6·7·% 도 잡는다 (조합 실검증 · ★6)', () => {
      // ★ 조합 검증 — `renderedText()` 는 문자열 자식을 모아 공백으로 잇는다. Text 가 3조각으로
      //   쪼개져도 그 전처리가 `%` 를 지우지 않고 `\d+\s*%` 패턴이 살아남음을 실행으로 확인한다.
      render(
        <Text testID="pct-probe">
          <Text>6</Text>
          <Text>7</Text>
          <Text>%</Text>
        </Text>
      );

      const text = renderedText();
      expect(text).toContain('%');
      expect(text).toMatch(/\d+\s*%/);
    });
  });

  describe('🔴 A8-1 · AC-8 — PARTIAL 이면 h07 부분 결과(셸) 얼굴이 뜬다 (D1)', () => {
    beforeEach(() => {
      // 준비 — day1 만 담긴 PARTIAL, 여행은 3일.
      itineraryHandler = () =>
        HttpResponse.json(
          itinerary({ dayCount: 1, generationState: 'PARTIAL' })
        );
    });

    it('A8-1a · 셸 얼굴이 뜨고 옛 게이지·일차 칩은 사라진다', async () => {
      renderPage();

      // 셸 골격 — 진행 카드(day-chip 대신) + 지도 + 셸 루트.
      await screen.findByTestId('generation-progress-card');
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      expect(screen.getByTestId('map-root')).toBeOnTheScreen();
      // ★2 — 진행 카드가 day-chip 자리를 대체하므로 일차 칩은 없다(옛 additive 공존 폐기).
      expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]);
      // ★1 — 옛 h10 인라인 게이지 testID 는 이 얼굴에서 소멸했다.
      expect(
        screen.queryAllByTestId(/^itinerary-generating-(day|skeleton)-/)
      ).toEqual([]);
    });

    it('A8-1b · 게이지 라벨이 한글 {n}일차 …이고 3셀이 여행 기간에서 도출된다 (AC-6)', async () => {
      renderPage();
      await screen.findByTestId('generation-progress-card');

      // 3셀 — day1 완성 / day2 생성 중 / day3 대기(여행 기간 3에서 도출, days.length=1 아님).
      expect(
        screen.getByTestId('generation-gauge-cell-1-done')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('generation-gauge-cell-2-active')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('generation-gauge-cell-3-waiting')
      ).toBeOnTheScreen();
      // 한글 라벨(getByText=text 노드 완전일치).
      expect(screen.getByText('1일차 완성')).toBeOnTheScreen();
      expect(screen.getByText('2일차 생성 중')).toBeOnTheScreen();
      expect(screen.getByText('3일차 대기')).toBeOnTheScreen();
      // 짝 — 옛 `Day{n}` 형식은 사라졌다.
      expect(screen.queryAllByText(/Day\s*\d/)).toEqual([]);
    });

    it('A8-1c · 도착 일차 슬롯은 isFixed 무관 전부 시각 칩이다 (AC-2 · D6)', async () => {
      renderPage();
      await screen.findByTestId('generation-progress-card');

      // 3슬롯 전부 시각 칩(SlotStopCard time leaf).
      expect(screen.queryAllByTestId(/^slot-stopcard-time-/)).toHaveLength(3);
      // ★ 고정 슬롯(poi-b, isFixed=true)도 시각 칩이 뜬다 — "고정만 시각" 옛 규칙 폐기(BR-U3-07 개정).
      //   toHaveTextContent(문자열)=완전일치라(★5) en-dash `–`(U+2013) 를 정확히 요구한다.
      expect(
        screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-b`)
      ).toHaveTextContent('13:00–14:30');
    });

    it('A8-1d · AI 배지·시간대 라벨·도보 추정·일차 칩이 없다 (AC-3)', async () => {
      renderPage();
      await screen.findByTestId('generation-progress-card');

      expect(screen.queryAllByText('AI 추천')).toEqual([]); // 옛 AI_BADGE
      expect(screen.queryAllByText(/^(오전|점심|오후|저녁)$/)).toEqual([]); // 시간대 라벨
      expect(screen.queryByText(/도보/)).toBeNull(); // 도보 추정
      expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]); // 일차 칩
    });

    it('A8-1e · 시트 헤더가 "N곳 · X.Xkm"(거리 합, 소요/이동 어휘 0)다 (AC-4 · D8)', async () => {
      renderPage();
      await screen.findByTestId('generation-progress-card');

      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        /1일차 완성/
      );
      // 제목은 게이지 라벨과 겹치지 않게 날짜를 결합한다(DraftPage §3) — 날짜 값이 실제로
      // 붙는지 잠근다(5-b 경고-1: 이 단언이 없으면 formatDraftDayHeader 산출이 무심판).
      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        /6월 10일/
      );
      const meta = screen.getByTestId('sheet-header-meta');
      // 곳 수 = 도착 슬롯 3, 거리 합 = 2.1+1.4 = 3.5km(정규식=부분 매칭, ★5).
      expect(meta).toHaveTextContent(/3곳/);
      expect(meta).toHaveTextContent(/3\.5km/);
      // INV-3 + Figma 형식 — legDistance 의 `이동 ` 접두를 그대로 쓰면 red, 소요 어휘도 금지.
      expect(meta).not.toHaveTextContent(/이동|분|시간|소요/);
    });

    it('A8-1f · 퍼센트·소요·CTA 가 0건이다 (AC-5 · D9 · INV-3)', async () => {
      renderPage();
      await screen.findByTestId('generation-progress-card');

      const text = renderedText();
      expect(text).not.toContain('%'); // 진행 수치 없음(계약)
      expect(text).not.toMatch(/\d+\s*(분|시간)|소요/); // 소요시간 어휘 없음(INV-3)
      // D9 — 생성 중이라 확정/완성 CTA 가 없다(셸 cta 미전달).
      expect(screen.queryByTestId('sheet-cta-root')).toBeNull();
      expect(screen.queryByTestId('itinerary-draft-complete')).toBeNull();
    });
  });

  describe('🔴 A8-3 · TRIP-939 AC-7 — PARTIAL 셸에 눌러도 반응 없는 링크가 없다 (S8 · A-3)', () => {
    beforeEach(() => {
      // 준비 — day1 만 담긴 PARTIAL(생성 중 셸).
      itineraryHandler = () =>
        HttpResponse.json(
          itinerary({ dayCount: 1, generationState: 'PARTIAL' })
        );
    });

    it('A8-3a · "다른 후보 ›" 링크가 0개이고 장소 이름은 누를 수 없는 글자다', async () => {
      // 실행: 초안 화면을 연다.
      renderPage();
      await screen.findByTestId('generation-progress-card');

      // 단언: 교체 미배선이던 "다른 후보 ›"(빈 함수 주입)가 사라졌다.
      // testID 문자열로 비교(요소 배열 toEqual 은 실패 출력이 fiber 트리 diff 라 OOM — 02a ★22).
      expect(
        screen
          .queryAllByTestId(/^slot-stopcard-alt-/)
          .map((node) => node.props.testID)
      ).toEqual([]);
      // 이름 노드 3개(도착 슬롯 3)는 그려지되(앵커) 호스트가 전부 터치 불가(onPressName 미주입).
      const names = screen.queryAllByTestId(/^slot-stopcard-name-/);
      expect(names).toHaveLength(3);
      names.forEach((node) => {
        expect(
          typeof node.props.onStartShouldSetResponder === 'function' ||
            typeof node.props.onClick === 'function'
        ).toBe(false);
      });
    });
  });

  describe('🔴 A8-2 · TRIP-792 플립 — COMPLETE 면 h07 진행 카드가 사라지고 h08 셸(day-chip·CTA)이 뜬다', () => {
    it('진행 카드·게이지가 사라지고 h08 day-chip 오버레이·확정 CTA 가 나타난다', async () => {
      // 준비 — 3일 전부 도착한 **깨끗한 COMPLETE**(기본 핸들러). h07(PARTIAL)→h08(COMPLETE) 전환.
      // ⚠️ 옛 계약("COMPLETE→DraftScreen 복귀")은 TRIP-792 D1-R NARROW 로 뒤집혔다 — 깨끗한 COMPLETE
      //    는 이제 h08 셸이다. "AI 추천안" 텍스트는 셸 헤더에도 있어(★3) testID 로만 가른다.
      renderPage();

      // 데이터 도착 앵커 — h08 CTA 바가 뜬 시점을 기다린 뒤 단언한다(GET 완료 전 상태를 재지 않게).
      await waitFor(() =>
        expect(screen.queryByTestId('sheet-cta-root')).not.toBeNull()
      );

      // ① h07 진행 카드는 사라진다(COMPLETE=생성 완료라 진행 중 아님).
      expect(screen.queryByTestId('generation-progress-card')).toBeNull();
      // ② 옛 h10 게이지 흔적도 0.
      expect(
        screen.queryAllByTestId(/^itinerary-generating-(day|skeleton)-/)
      ).toEqual([]);
      // ③ h08 셸 얼굴 — day-chip 오버레이가 진행 카드 자리를 차지한다.
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-daychip-0')).toBeOnTheScreen();
      // ④ 옛 DraftScreen 완성 목록(일차 탭)은 없다(셸로 대체).
      expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]);
    });
  });

  describe('🔴 TRIP-1076 AC-3 · h07 부분 결과 지도는 핀 전부에 맞춰 연다', () => {
    beforeEach(() => {
      // 준비 — day1 만 담긴 PARTIAL(A8-1 과 같은 응답).
      itineraryHandler = () =>
        HttpResponse.json(
          itinerary({ dayCount: 1, generationState: 'PARTIAL' })
        );
    });

    it('셸 지도에 핀 2개 이상과 fitPins 가 함께 전달된다', async () => {
      renderPage();
      await screen.findByTestId('generation-progress-card');

      const map = screen.getByTestId('map-root');
      expect((map.props.pins as unknown[]).length).toBeGreaterThanOrEqual(2);
      expect(map.props.fitPins).toBe(true);
    });
  });

  describe('🔴 A8-4 · TRIP-1110 AC-5·AC-6 — h07 헤더 meta 는 커넥터 구간(slice(1))만 보고, 하나라도 비면 km 를 접는다', () => {
    it('A8-4a · 커넥터 구간에 null 이 섞이면 meta 는 정확히 "3곳"이고 null 커넥터는 글리프 줄만 남는다', async () => {
      // 준비 — a→b 구간 2.1km, b→c 구간 null. 옛 스킵 규약이면 "3곳 · 2.1km"(부분합).
      itineraryHandler = () =>
        HttpResponse.json(partialWithRanges([null, '2.1km', null]));

      renderPage();
      await screen.findByTestId('generation-progress-card');

      const meta = screen.getByTestId('sheet-header-meta');
      expect(meta).toHaveTextContent('3곳'); // 문자열 인자 = 완전 일치(02a §5)
      expect(meta).not.toHaveTextContent(/km|이동|분|시간|소요/);
      expect(
        screen.getByTestId(`sheet-connector-distance-${DAY1}#poi-a`)
      ).toHaveTextContent('2.1km');
      expect(
        screen.getByTestId(`sheet-connector-${DAY1}#poi-b`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`sheet-connector-distance-${DAY1}#poi-b`)
      ).toBeNull();
    });

    it('A8-4b · 첫 슬롯(거점→첫 방문지) 거리는 헤더 합에 안 들어간다 — "3곳 · 3.5km"', async () => {
      // 준비 — 첫 슬롯에도 0.9km. 전 슬롯을 더하면 4.4km(옛 PARTIAL 모집단).
      itineraryHandler = () =>
        HttpResponse.json(partialWithRanges(['0.9km', '2.1km', '1.4km']));

      renderPage();
      await screen.findByTestId('generation-progress-card');

      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
        '3곳 · 3.5km'
      );
    });
  });
});

// TRIP-1037 · 옛 DraftPage.regenerateLock.integration.test.tsx
describe('다시 만들기 연타 잠금', () => {
  /**
   * TRIP-1037 · 재생성 버튼은 생성 화면으로 **한 번만** 보낸다 (QA #028 · BR-U3-19 · INV-4).
   *
   * 무엇을 보장하나:
   *  - 🔴 L1 누르면 그 자리에서 생성 화면(`/trips/[tripId]/itinerary/generating`, mode=FULLY_AI)으로 replace 한다.
   *    초안 화면은 생성 POST 를 보내지 않는다 — POST 는 생성 화면이 마운트될 때 한 번 보낸다(결정 A).
   *  - 🔴 L2~L5 몇 번을 눌러도(1초 넘는 간격 · 같은 순간 두 탭 · 조회를 기다리는 동안) 이동은 1회다.
   *  - 🔴 L6·L7 조회 전 누름: 404(일정 없음)면 이동, 5xx 면 멈춤 — 멈춘 뒤엔 다시 누를 수 있다(AC-6).
   *  - 🟢 L8 확정 일정은 이동 0 · L9 생성 중 확인을 취소하면 다시 누를 때 확인이 또 뜬다.
   *  - 🔴 L10 확인의 「계속」도 같은 순간 두 탭에 이동 1회 · L11 409 안내는 초안 화면이 그리지 않는다.
   *  - 🟢 L12 직접 짠(MANUAL) 일정은 어떤 버튼으로도 생성 화면에 가지 않는다(TRIP-1038 무회귀).
   *  - 🔴 L13 조회를 기다리는 동안 화면을 떠나면, 조회가 도착해도 생성 화면으로 끌고 가지 않는다(5-b 경고-1).
   *
   * jest 의 라우터 목은 화면을 내리지 않는다 — 실기에선 replace 가 초안 화면을 없애지만 여기선 그대로 남아
   * 같은 버튼을 몇 번이고 누를 수 있다. 그래서 "여러 번 눌러도 1회"를 잴 수 있다(02a ★1).
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=화면을 열고 누른다 → 단언=라우터 호출·나간 요청.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const SESSION_ID = '44444444-4444-4444-4444-444444444444';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';
  const DAY3 = '2026-06-12';
  const WAIT = { timeout: 4000 };

  const GENERATING = '/trips/[tripId]/itinerary/generating';
  /** 이동 계약 — successRoute 는 싣지 않는다(기본 draft). CO_PLAN 일정도 FULLY_AI 로 간다(01b). */
  const EXPECTED_ROUTE = {
    pathname: GENERATING,
    params: { tripId: TRIP_ID, mode: 'FULLY_AI' },
  };

  const CTA0 = 'sheet-cta-button-0';
  const HEADER_RETRY = 'itinerary-draft-retry';
  const CONFIRM = 'itinerary-draft-inprogress-confirm';

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 3일',
      startDate: DAY1,
      endDate: DAY3,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function oneDay(date: string): ItineraryDaysItem {
    return {
      date,
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
          nameKo: '광안리 해변',
          category: '자연',
          imageUrl: null,
          distanceRange: null,
          lat: 33.458,
          lng: 126.942,
        },
      ],
    };
  }

  function itinerary(
    input: {
      status?: ItineraryStatus;
      generationMode?: ItineraryGenerationMode;
      generationState?: ItineraryGenerationState;
      generationSessionId?: string | null;
      days?: ItineraryDaysItem[];
    } = {}
  ): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: input.status ?? 'PLANNED',
      solveMode: input.generationMode === 'MANUAL' ? 'MINIMAL' : 'FULL_AI',
      generationMode: input.generationMode ?? 'FULLY_AI',
      generationState: input.generationState ?? 'COMPLETE',
      generationSessionId: input.generationSessionId ?? null,
      isFallback: false,
      days: input.days ?? [oneDay(DAY1), oneDay(DAY2), oneDay(DAY3)],
    };
  }

  /** 이 여행이 생성 중 — 세션 있음 · 1일차도 아직 없어 빈 얼굴(헤더 버튼이 닿는 유일한 PARTIAL). */
  const ownGenerating = (): Itinerary =>
    itinerary({
      generationState: 'PARTIAL',
      generationSessionId: SESSION_ID,
      days: [],
    });

  /** 일정 GET 응답. 문자열이면 그 상태 코드의 오류 응답이다. */
  let itineraryScript: () => Itinerary | 404 | 500;
  let itineraryGets = 0;
  /** 초안 화면이 보낸 생성 POST 수 — 이 파일 전부에서 0 이어야 한다. */
  let postCount = 0;
  let postResponse: () => Response;
  /** 일정 GET 을 붙잡는 문. null 이면 곧장 응답한다(02a ★5). */
  let gate: Promise<void> | null = null;
  let releaseGate: (() => void) | null = null;

  function holdItineraryGet(): void {
    gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
  }

  beforeEach(() => {
    [mockPush, mockReplace, mockBack].forEach((fn) => fn.mockClear());
    itineraryScript = () => itinerary();
    itineraryGets = 0;
    postCount = 0;
    postResponse = () =>
      HttpResponse.json(
        itinerary({ generationState: 'PARTIAL', days: [oneDay(DAY1)] }),
        { status: 201 }
      );
    gate = null;
    releaseGate = null;
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        itineraryGets += 1;
        if (gate !== null) await gate;
        const body = itineraryScript();
        if (body === 404 || body === 500) {
          return HttpResponse.json(
            { error: { code: body === 404 ? 'NOT_FOUND' : 'INTERNAL' } },
            { status: body }
          );
        }
        return HttpResponse.json(body);
      }),
      http.post(`${BASE}/trips/:tripId/itinerary`, () => {
        postCount += 1;
        return postResponse();
      })
    );
  });

  // 문을 안 열고 끝나면 붙잡힌 요청이 열린 핸들로 남는다 — describe 밖 최상위에서 항상 연다.
  afterEach(() => {
    releaseGate?.();
    server.resetHandlers();
    clearAccessToken();
  });

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
    return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  /** 생성 화면으로 간 라우터 호출 수 — replace 든 push 든(push 로 가도 여기서 잡힌다). */
  function toGenerating(): number {
    return [...mockReplace.mock.calls, ...mockPush.mock.calls].filter(
      ([arg]) =>
        typeof arg === 'object' &&
        arg !== null &&
        (arg as { pathname?: string }).pathname === GENERATING
    ).length;
  }

  /** "그대로 1건/0건"은 흘려 보낸 뒤에야 뜻을 갖는다(누름 → fetch → msw 는 비동기). */
  async function settle(ms = 300): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  describe('🔴 L1 · AC-1 — 누르면 그 자리에서 생성 화면으로 replace 하고, 초안 화면은 POST 하지 않는다', () => {
    it.each<ItineraryGenerationMode>(['FULLY_AI', 'CO_PLAN'])(
      '%s 초안 — 다시 짜기 press 직후 replace 1회(mode=FULLY_AI) · POST 0',
      async (generationMode) => {
        itineraryScript = () => itinerary({ generationMode });
        renderPage();
        const retry = await screen.findByTestId(CTA0, {}, WAIT);
        expect(retry).toHaveTextContent('다시 짜기');

        fireEvent.press(retry);

        // ★ 기다리지 않고 곧바로 — 응답을 기다린 뒤 이동하면 그동안 화면이 아무 말도 안 한다(INV-4 · 02a ★9).
        expect(mockReplace).toHaveBeenCalledTimes(1);
        expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);

        await settle();
        expect(postCount).toBe(0);
        expect(mockPush).not.toHaveBeenCalled();
      }
    );
  });

  describe('🔴 L2 · AC-2 — 1초 넘는 간격을 두고 세 번 눌러도 생성 화면 이동은 1회', () => {
    it('press → 1.1초 → press → press 뒤 이동 1 · POST 0 (400ms 공용 가드로는 못 막는 간격)', async () => {
      renderPage();
      const retry = await screen.findByTestId(CTA0, {}, WAIT);

      fireEvent.press(retry);
      await settle(1100);
      fireEvent.press(retry);
      fireEvent.press(retry);
      await settle();

      expect(toGenerating()).toBe(1);
      expect(postCount).toBe(0);
    });
  });

  describe('🔴 L3 · AC-2 — 같은 순간 두 탭(한 렌더 사본)에도 이동은 1회', () => {
    it('바깥 act 하나 안의 press 두 번 → 이동 1 · POST 0', async () => {
      renderPage();
      const retry = await screen.findByTestId(CTA0, {}, WAIT);

      // ★ 바깥 act 가 끝날 때까지 다시 그리지 않는다 — 두 누름이 같은 핸들러를 본다(02a ★3).
      await act(async () => {
        fireEvent.press(retry);
        fireEvent.press(retry);
      });
      await settle();

      expect(toGenerating()).toBe(1);
      expect(postCount).toBe(0);
    });
  });

  describe('🔴 L4 · AC-2 — 헤더 「다시 만들기」(빈 얼굴)도 세 번 눌러 이동 1회', () => {
    it('itinerary-draft-retry press 3번 → 이동 1 · POST 0', async () => {
      itineraryScript = () => itinerary({ days: [] });
      renderPage();
      await screen.findByTestId('itinerary-draft-empty', {}, WAIT);
      const retry = screen.getByTestId(HEADER_RETRY);

      fireEvent.press(retry);
      fireEvent.press(retry);
      fireEvent.press(retry);
      await settle();

      expect(toGenerating()).toBe(1);
      expect(postCount).toBe(0);
    });
  });

  describe('🔴 L5 · AC-2·AC-3 — 조회를 기다리는 동안 세 번 눌러도, 조회가 끝나면 이동은 1회', () => {
    it('로딩 중 press 3번 → 조회 도착 뒤 이동 1 · 일정 GET 1건 · POST 0', async () => {
      holdItineraryGet();
      renderPage();
      await screen.findByTestId('itinerary-draft-loading', {}, WAIT);
      const retry = screen.getByTestId(HEADER_RETRY);

      fireEvent.press(retry);
      fireEvent.press(retry);
      fireEvent.press(retry);
      await settle(100);
      // 앵커 — 조회가 안 끝났으니 아직 아무 데도 안 갔다(status 를 모르면 보내지 않는다).
      expect(toGenerating()).toBe(0);

      await act(async () => {
        releaseGate?.();
      });
      await waitFor(
        () => expect(toGenerating()).toBeGreaterThanOrEqual(1),
        WAIT
      );
      await settle();

      expect(toGenerating()).toBe(1);
      expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
      // 세 누름이 조회를 늘리지 않고 이미 도는 조회 하나에 올라탔다(cancelRefetch:false 무회귀 · 02a ★4).
      expect(itineraryGets).toBe(1);
      expect(postCount).toBe(0);
    });
  });

  describe('🔴 L6 · AC-3 — 조회가 404(일정 없음)면 만들어도 안전하니 생성 화면으로 간다', () => {
    it('실패 얼굴 헤더 retry → 재조회 404 → replace 1(mode=FULLY_AI) · POST 0', async () => {
      itineraryScript = () => 404;
      renderPage();
      await screen.findByTestId('itinerary-draft-failed', {}, WAIT);

      fireEvent.press(screen.getByTestId(HEADER_RETRY));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
      expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
      await settle();
      expect(toGenerating()).toBe(1);
      expect(postCount).toBe(0);
    });
  });

  describe('🔴 L7 · AC-3·AC-6 — 5xx 면 멈추고, 멈춘 뒤엔 다시 누를 수 있다 (잠금이 영구히 남지 않는다)', () => {
    it('500 → 이동 0 → 다시 누르면(이번엔 PLANNED) 이동 1 · POST 0', async () => {
      itineraryScript = () => 500;
      renderPage();
      await screen.findByTestId('itinerary-draft-failed', {}, WAIT);
      const getsBefore = itineraryGets;

      fireEvent.press(screen.getByTestId(HEADER_RETRY));
      // 앵커 — 재조회가 실제로 돌았다(안 돌아도 이동 0 이라 공허해진다 · 02a ★7).
      await waitFor(() => expect(itineraryGets).toBe(getsBefore + 1), WAIT);
      await settle();
      expect(toGenerating()).toBe(0);

      itineraryScript = () => itinerary();
      fireEvent.press(screen.getByTestId(HEADER_RETRY));

      await waitFor(() => expect(toGenerating()).toBe(1), WAIT);
      expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
      await settle();
      expect(toGenerating()).toBe(1);
      expect(postCount).toBe(0);
    });
  });

  describe('🟢 L8 · AC-4 — 조회 전 누른 뒤 도착한 일정이 확정(CONFIRMED)이면 이동 0 (선제 green · 무회귀)', () => {
    it('로딩 중 press → CONFIRMED 도착 → 셸이 떠도 이동 0 · POST 0', async () => {
      holdItineraryGet();
      itineraryScript = () => itinerary({ status: 'CONFIRMED' });
      renderPage();
      await screen.findByTestId('itinerary-draft-loading', {}, WAIT);

      fireEvent.press(screen.getByTestId(HEADER_RETRY));
      await act(async () => {
        releaseGate?.();
      });
      // 앵커 — 조회가 도착해 화면이 셸로 바뀌었다(판정 재료가 손에 들어왔다).
      await screen.findByTestId(CTA0, {}, WAIT);
      await settle();

      expect(toGenerating()).toBe(0);
      expect(postCount).toBe(0);
    });
  });

  describe('🟢 L9 · AC-5·AC-6 — 생성 중 확인을 「취소」하면, 다시 누를 때 확인이 또 뜬다 (선제 green · 잠금 해제 회귀 방지)', () => {
    it('retry → 확인 → 취소 → retry → 확인 다시 · 이동 0 · POST 0', async () => {
      itineraryScript = ownGenerating;
      renderPage();
      await screen.findByTestId('itinerary-draft-empty', {}, WAIT);

      fireEvent.press(screen.getByTestId(HEADER_RETRY));
      fireEvent.press(await screen.findByTestId(`${CONFIRM}-cancel`, {}, WAIT));
      await screen.findByTestId('itinerary-draft-empty', {}, WAIT);
      expect(screen.queryByTestId(CONFIRM)).toBeNull();

      fireEvent.press(screen.getByTestId(HEADER_RETRY));

      expect(await screen.findByTestId(CONFIRM, {}, WAIT)).toBeOnTheScreen();
      await settle();
      expect(toGenerating()).toBe(0);
      expect(postCount).toBe(0);
    });
  });

  describe('🔴 L10 · AC-5·AC-2 — 확인의 「계속」을 같은 순간 두 번 눌러도 이동은 1회', () => {
    it('retry → 확인 → 바깥 act 안 「계속」 두 번 → replace 1(mode=FULLY_AI) · POST 0', async () => {
      itineraryScript = ownGenerating;
      renderPage();
      await screen.findByTestId('itinerary-draft-empty', {}, WAIT);

      fireEvent.press(screen.getByTestId(HEADER_RETRY));
      const cont = await screen.findByTestId(`${CONFIRM}-continue`, {}, WAIT);
      await act(async () => {
        fireEvent.press(cont);
        fireEvent.press(cont);
      });
      await settle();

      expect(toGenerating()).toBe(1);
      expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
      expect(postCount).toBe(0);
    });
  });

  describe('🔴 L11 · AC-7 — 다른 여행이 생성 중(409)이어도 초안 화면은 안내를 그리지 않고 생성 화면으로 보낸다', () => {
    it('POST 가 409 로 준비돼 있어도 → 이동 1 · 409 안내 없음 · POST 0', async () => {
      postResponse = () =>
        HttpResponse.json(
          {
            error: {
              code: 'GENERATION_IN_PROGRESS',
              message: '다른 여행의 일정을 만들고 있어요',
              activeTripId: '22222222-2222-2222-2222-222222222222',
            },
          },
          { status: 409 }
        );
      renderPage();

      fireEvent.press(await screen.findByTestId(CTA0, {}, WAIT));
      await settle();

      expect(toGenerating()).toBe(1);
      // 409 안내는 생성 화면이 말한다(GeneratingPage.busy G1~G8) — 초안 화면엔 뜰 길이 없다.
      expect(screen.queryByTestId('itinerary-generation-busy')).toBeNull();
      expect(postCount).toBe(0);
    });
  });

  describe('🟢 L12 · AC-9 — 직접 짠(MANUAL) 일정은 어떤 버튼으로도 생성 화면에 가지 않는다 (선제 green · TRIP-1038 무회귀)', () => {
    it('MANUAL 셸의 첫 CTA(편집하기) press → 생성 화면 이동 0 · POST 0', async () => {
      itineraryScript = () => itinerary({ generationMode: 'MANUAL' });
      renderPage();
      const cta = await screen.findByTestId(CTA0, {}, WAIT);
      expect(cta).toHaveTextContent('편집하기');

      fireEvent.press(cta);
      await settle();

      expect(toGenerating()).toBe(0);
      expect(postCount).toBe(0);
    });

    it('조회 실패 얼굴에서 retry → 재조회가 MANUAL 이면 생성 화면 이동 0 · POST 0', async () => {
      itineraryScript = () => 500;
      renderPage();
      await screen.findByTestId('itinerary-draft-failed', {}, WAIT);

      itineraryScript = () => itinerary({ generationMode: 'MANUAL' });
      fireEvent.press(screen.getByTestId(HEADER_RETRY));
      // 앵커 — 재조회가 도착해 MANUAL 셸(「내 일정」)로 바뀌었다(판정 재료가 손에 있었다).
      expect(
        await screen.findByTestId('sheet-header-title', {}, WAIT)
      ).toHaveTextContent('내 일정');
      await settle();

      expect(toGenerating()).toBe(0);
      expect(postCount).toBe(0);
    });
  });

  /**
   * 같은 일정 캐시 키를 구독하는 **다른 화면**의 대역 — 실기에선 탭 아래 홈(`PlanningHome`)·카드가 이 키를
   * 계속 들고 있다. 이 관찰자가 없으면 초안 화면이 내려갈 때 react-query 가 조회를 abort 해 "모름"으로 멈추므로
   * 결함이 재현되지 않는다(03b 경고-1 탐침 실측). 조회 결과는 상태 글자로 드러내 "조회가 실제로 도착했다" 앵커로 쓴다.
   */
  function SiblingObserver(): ReactNode {
    const query = useGetTripsTripIdItinerary(TRIP_ID);
    return <Text testID="sibling-itinerary-status">{query.status}</Text>;
  }

  function renderWithSibling() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
    function Tree({ showDraft }: { showDraft: boolean }) {
      return (
        <QueryClientProvider client={client}>
          <SiblingObserver />
          {showDraft ? <DraftPage tripId={TRIP_ID} /> : null}
        </QueryClientProvider>
      );
    }
    const utils = render(<Tree showDraft />);
    return {
      ...utils,
      unmountDraft: () => utils.rerender(<Tree showDraft={false} />),
    };
  }

  describe('🔴 L13 · 5-b 경고-1 — 조회를 기다리는 동안 초안 화면을 떠나면, 조회가 도착해도 생성 화면으로 보내지 않는다', () => {
    it.each<{ name: string; arrives: () => Itinerary | 404; settled: string }>([
      { name: 'PLANNED 도착', arrives: () => itinerary(), settled: 'success' },
      { name: '404(일정 없음) 도착', arrives: () => 404, settled: 'error' },
    ])(
      '로딩 중 다시 만들기 → 응답 전 초안 화면만 언마운트 → $name → 생성 화면 이동 0 · POST 0',
      async ({ arrives, settled }) => {
        holdItineraryGet();
        itineraryScript = arrives;
        const { unmountDraft } = renderWithSibling();
        await screen.findByTestId('itinerary-draft-loading', {}, WAIT);

        fireEvent.press(screen.getByTestId(HEADER_RETRY));
        // 사용자가 ‹·스와이프로 떠났다 — 초안 화면만 내려가고 같은 키의 다른 관찰자는 남는다.
        unmountDraft();
        expect(screen.queryByTestId('itinerary-draft-loading')).toBeNull();

        await act(async () => {
          releaseGate?.();
        });
        // 앵커 — 조회가 abort 되지 않고 실제로 도착했다(안 오면 "이동 0"이 공허하다).
        await waitFor(
          () =>
            expect(
              screen.getByTestId('sibling-itinerary-status')
            ).toHaveTextContent(settled),
          WAIT
        );
        await settle();

        expect(toGenerating()).toBe(0);
        expect(postCount).toBe(0);
      }
    );
  });
});

// TRIP-1094 · 옛 DraftPage.unplaced.integration.test.tsx
describe('넣지 못한 꼭 갈 곳', () => {
  /**
   * TRIP-1094 · h08 초안 셸이 서버의 "넣지 못한 꼭 갈 곳"을 시트 맨 위 블록으로 말하는지 실 HTTP 로 태운다.
   *
   * 무엇을 보장하나:
   *  - 🔴 COMPLETE 셸 시트에 블록이 헤더 뒤·첫 카드 앞에 서고, 항목마다 담은 장소 이름 + 서버 문구가 보인다.
   *    이름을 못 찾은 항목은 문구만 보인다(AC-1·2·3 · Q5).
   *  - 🔴 담은 장소 조회가 **대기 중·실패·게스트**여도 블록과 문구가 먼저 보인다(Q4 · INV-4).
   *  - 🔴 미배치가 0건이면 `/saved-places` 요청이 0회다 — 이름이 필요할 때만 조회한다(AC-13).
   *  - 🔴 일부 실패 안내·폴백 안내와 함께 뜨고, 폴백 안내 **안이 아니라 형제**다(AC-10 · Q3).
   *  - PARTIAL 진행 셸·폴백 인터스티셜에는 블록이 없다(결정 1).
   *
   * jest 가 못 보는 것: 접힘(peek)에서 블록이 **눈에 보이는지**는 바텀시트 목 사각이다(6-b 프리뷰 몫).
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=렌더(+기본 일정 보기 press) → 단언=testID·글자·요청 수.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const SAVED_PATH = '/api/v1/saved-places';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';

  /** 네트워크 응답을 기다리는 한도 — 로컬 기본 1000ms 의 CI 러너 환산(fallbackShell 선례). */
  const WAIT = { timeout: 4000 };

  const BLOCK = 'itinerary-unplaced-mustvisit';
  const ITEM_PREFIX = /^itinerary-unplaced-mustvisit-/;
  const STALE = 'itinerary-draft-stale-failed';
  const BANNER = 'itinerary-draft-fallback-banner';
  const SHELL = 'map-sheet-shell-root';

  /** 서버 `UnplacedText.kt` 원문. */
  const MSG_NO_SLOT =
    '남은 시간과 이동을 고려하면 넣을 자리가 없었어요. 시각 고정을 풀거나 일정을 줄여 보세요.';
  const MSG_WINDOW =
    '다른 필수 방문지와 시간이 겹쳐 넣지 못했어요. 한쪽 시각을 옮겨 주세요.';
  const DURATION_TEXT = /\d+\s*(분|시간)|소요/;

  /** 미배치 2건 — poi-mv-1 은 담은 장소에 있고(이름 해소), poi-mv-2 는 없다(문구만). */
  const UNPLACED: ItineraryUnplacedMustVisitsItem[] = [
    { poiId: 'poi-mv-1', reasonCode: 'NO_FEASIBLE_SLOT', message: MSG_NO_SLOT },
    { poiId: 'poi-mv-2', reasonCode: 'WINDOW_CONFLICT', message: MSG_WINDOW },
  ];
  const NAME_1 = '성산일출봉';

  const itemId = (poiId: string): string => `${BLOCK}-${poiId}`;
  const cardId = (poiId: string): string =>
    `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '제주 3일',
      startDate: DAY1,
      endDate: '2026-06-12',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '제주', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function slot(poiId: string, startAt: string): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      startAt,
      endAt: startAt,
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: `장소-${poiId}`,
      lat: 33.458,
      lng: 126.942,
    };
  }

  function itinerary(input: {
    unplaced?: ItineraryUnplacedMustVisitsItem[];
    solveMode?: ItinerarySolveMode;
    isFallback?: boolean;
    generationState?: ItineraryGenerationState;
  }): Itinerary {
    return {
      itineraryId: 'itin-1094',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: input.solveMode ?? 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: input.generationState ?? 'COMPLETE',
      isFallback: input.isFallback ?? false,
      days: [
        {
          date: DAY1,
          slots: [slot('poi-a', '09:30:00'), slot('poi-b', '13:00:00')],
        },
      ],
      ...(input.unplaced === undefined
        ? {}
        : { unplacedMustVisits: input.unplaced }),
    };
  }

  function savedPlace(poiId: string, nameKo: string): SavedPlace {
    return {
      savedPlaceId: `sp-${poiId}`,
      savedAt: '2026-08-01T10:00:00.000Z',
      place: {
        poiId,
        nameKo,
        category: '명소',
        lat: 33.458,
        lng: 126.942,
        tags: [],
        savedCount: 0,
        dataStatus: 'ACTIVE',
      },
    };
  }

  let itineraryScript: () => Itinerary;
  let savedScript: () => Promise<Response> | Response;
  let observed: { method: string; url: string }[] = [];
  /** 담은 장소 응답을 테스트가 풀 때까지 붙잡는 게이트(02a ★7). afterEach 가 반드시 연다. */
  let releaseSaved: () => void = () => undefined;

  function savedHits(): number {
    return observed.filter(
      (hit) => hit.method === 'GET' && new URL(hit.url).pathname === SAVED_PATH
    ).length;
  }

  beforeAll(() => {
    server.events.on('request:start', ({ request }) => {
      observed.push({ method: request.method, url: request.url });
    });
  });

  beforeEach(() => {
    observed = [];
    setAccessToken('valid-access');
    savedScript = () => HttpResponse.json([savedPlace('poi-mv-1', NAME_1)]);
    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itineraryScript())
      ),
      // AC-13 은 이 핸들러를 **항상** 등록해 두고 요청 수로 잰다(02a ★10).
      http.get(`${BASE}/saved-places`, () => savedScript())
    );
  });

  afterEach(() => {
    releaseSaved();
    releaseSaved = () => undefined;
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage(): { client: QueryClient } {
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
    render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
    return { client };
  }

  /** 정확한 testID 몇 개를 트리 전위 순서(부모→자식, 형→아우)로 뽑는다(fallbackShell 선례 · 02a ★11). */
  function treeOrder(ids: string[]): string[] {
    const escaped = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return screen
      .getAllByTestId(new RegExp(`^(${escaped.join('|')})$`))
      .map((node) => String(node.props.testID));
  }

  function itemIds(): string[] {
    return within(screen.getByTestId(BLOCK))
      .queryAllByTestId(ITEM_PREFIX)
      .map((node) => String(node.props.testID));
  }

  /** 두 항목이 서버 문구**만** 보인다(이름 자리·대체 이름 없음 — 완전 일치 · 02a ★1). */
  function expectMessageOnlyItems(): void {
    expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);
    expect(screen.getByTestId(itemId('poi-mv-1'))).toHaveTextContent(
      MSG_NO_SLOT
    );
    expect(screen.getByTestId(itemId('poi-mv-2'))).toHaveTextContent(
      MSG_WINDOW
    );
    expect(screen.queryByText('이름을 불러오지 못한 곳')).toBeNull();
  }

  /** 조회가 전부 끝날 때까지(담은 장소 요청 n건 + 진행 중 조회 0) 기다린다(02a ★8). */
  async function settle(
    client: QueryClient,
    savedCount: number
  ): Promise<void> {
    await waitFor(() => {
      expect(savedHits()).toBe(savedCount);
      expect(client.isFetching()).toBe(0);
    }, WAIT);
  }

  describe('🔴 D1 · AC-1·2·3·11·13 · Q5 — COMPLETE 셸 시트 맨 위에 블록이 서고, 이름은 담은 장소에서 온다', () => {
    it('헤더 뒤·첫 카드 앞 · 항목 2 · 이름 있음/없음 두 얼굴 · 소요시간 0 · 담은 장소 1회 조회', async () => {
      itineraryScript = () => itinerary({ unplaced: UNPLACED });

      const { client } = renderPage();

      const block = await screen.findByTestId(BLOCK, {}, WAIT);
      // 셸 시트 안, 하단 CTA 밖.
      expect(
        within(screen.getByTestId(SHELL)).getByTestId(BLOCK)
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('sheet-cta-root')).queryByTestId(BLOCK)
      ).toBeNull();
      expect(itemIds()).toEqual([itemId('poi-mv-1'), itemId('poi-mv-2')]);

      // 이름은 담은 장소 응답이 와야 붙는다 — findBy 로 기다린다.
      const first = screen.getByTestId(itemId('poi-mv-1'));
      expect(
        await within(first).findByText(NAME_1, {}, WAIT)
      ).toBeOnTheScreen();
      expect(first).toHaveTextContent(`${NAME_1}${MSG_NO_SLOT}`);
      // 담은 장소에 없는 항목은 문구만(AC-3).
      expect(screen.getByTestId(itemId('poi-mv-2'))).toHaveTextContent(
        MSG_WINDOW
      );

      // 자리(Q5) — 헤더 → 블록 → 첫 카드.
      expect(treeOrder(['sheet-header-root', BLOCK, cardId('poi-a')])).toEqual([
        'sheet-header-root',
        BLOCK,
        cardId('poi-a'),
      ]);
      // INV-3 — 서버 문구의 「시간」은 정당하고, 숫자+단위는 없다.
      expect(block).not.toHaveTextContent(DURATION_TEXT);

      await settle(client, 1);
    });
  });

  describe('🔴 D2 · Q4 — 담은 장소 조회가 대기 중이어도 블록과 서버 문구가 먼저 보인다', () => {
    it('응답 보류 중엔 문구만 · 응답이 오면 이름이 채워진다', async () => {
      itineraryScript = () => itinerary({ unplaced: UNPLACED });
      const gate = new Promise<void>((resolve) => {
        releaseSaved = resolve;
      });
      savedScript = async () => {
        await gate;
        return HttpResponse.json([savedPlace('poi-mv-1', NAME_1)]);
      };

      renderPage();

      // 실행 전 앵커 — 요청은 이미 나갔고 응답은 아직이다.
      await screen.findByTestId(BLOCK, {}, WAIT);
      await waitFor(() => expect(savedHits()).toBe(1), WAIT);

      // 보류 중 — 로딩이 보고를 가리지 않는다(INV-4).
      expectMessageOnlyItems();

      // 게이트를 연다 → 이름이 채워진다.
      releaseSaved();
      expect(
        await within(screen.getByTestId(itemId('poi-mv-1'))).findByText(
          NAME_1,
          {},
          WAIT
        )
      ).toBeOnTheScreen();
    });
  });

  describe('🔴 D3 · AC-3 · INV-4 — 담은 장소 조회가 실패해도 항목은 남고 서버 문구만 보인다', () => {
    it('/saved-places 500 → 조회가 끝난 뒤에도 블록·항목 2 · 대체 이름 없음', async () => {
      itineraryScript = () => itinerary({ unplaced: UNPLACED });
      savedScript = () => new HttpResponse(null, { status: 500 });

      const { client } = renderPage();
      await screen.findByTestId(BLOCK, {}, WAIT);

      // 실패가 확정될 때까지 기다린 뒤 잰다 — 요청 직후에 재면 isError 로 숨기는 구현도 통과한다(02a ★8).
      await settle(client, 1);

      expect(screen.getByTestId(BLOCK)).toBeOnTheScreen();
      expectMessageOnlyItems();
    });
  });

  describe('🔴 D4 · Q4 — 게스트는 담은 장소를 조회하지 않고, 문구는 그대로 보인다', () => {
    it('토큰 없음 → /saved-places 0회 · 두 항목 문구만', async () => {
      clearAccessToken();
      itineraryScript = () => itinerary({ unplaced: UNPLACED });

      const { client } = renderPage();
      await screen.findByTestId(BLOCK, {}, WAIT);
      await settle(client, 0);

      expectMessageOnlyItems();
    });
  });

  describe('D5 · AC-7·AC-13 — 미배치가 0건이면 블록도, 담은 장소 조회도 없다 (선제 green 트립와이어)', () => {
    it.each([
      ['빈 배열', [] as ItineraryUnplacedMustVisitsItem[]],
      ['필드 없음', undefined],
    ])('%s → 블록 0 · /saved-places 0회', async (_label, unplaced) => {
      itineraryScript = () => itinerary({ unplaced });

      const { client } = renderPage();

      // 긍정 앵커 — 셸 카드가 떴다(로딩 중 공허 통과 방지).
      expect(
        await screen.findByTestId(cardId('poi-a'), {}, WAIT)
      ).toBeOnTheScreen();
      await settle(client, 0);

      expect(screen.queryByTestId(BLOCK)).toBeNull();
    });
  });

  describe('🔴 D6 · AC-10ⓐ — 일부 실패(staleFailed) 안내와 블록이 함께 뜬다', () => {
    it('FAILED + 미배치 → 헤더 → 일부 실패 안내 → 블록 → 첫 카드', async () => {
      itineraryScript = () =>
        itinerary({ unplaced: UNPLACED, generationState: 'FAILED' });

      renderPage();

      await screen.findByTestId(STALE, {}, WAIT);
      expect(await screen.findByTestId(BLOCK, {}, WAIT)).toBeOnTheScreen();
      expect(
        treeOrder(['sheet-header-root', STALE, BLOCK, cardId('poi-a')])
      ).toEqual(['sheet-header-root', STALE, BLOCK, cardId('poi-a')]);
    });
  });

  describe('🔴 D7 · AC-10ⓑ · Q3 · 결정 1 — 폴백 안내와 블록이 함께 뜨고, 블록은 안내 밖 형제다', () => {
    it('인터스티셜엔 블록 없음 → 「기본 일정 보기」 → 헤더 → 폴백 안내 → 블록 → 첫 카드', async () => {
      itineraryScript = () =>
        itinerary({
          unplaced: UNPLACED,
          solveMode: 'DETERMINISTIC',
          isFallback: true,
        });

      renderPage();

      // 인터스티셜(h07 폴백) — 결정 1 의 자리가 아니다.
      const viewPlan = await screen.findByTestId(
        'itinerary-fallback-view-plan',
        {},
        WAIT
      );
      expect(screen.queryByTestId(BLOCK)).toBeNull();

      fireEvent.press(viewPlan);

      const block = await screen.findByTestId(BLOCK, {}, WAIT);
      const banner = screen.getByTestId(BANNER);
      // 형제 — 안내 안에 넣어도 전위 순서는 같게 나올 수 있어 따로 잰다(02a ★11).
      expect(within(banner).queryByTestId(BLOCK)).toBeNull();
      expect(block).toBeOnTheScreen();
      expect(
        treeOrder(['sheet-header-root', BANNER, BLOCK, cardId('poi-a')])
      ).toEqual(['sheet-header-root', BANNER, BLOCK, cardId('poi-a')]);
    });
  });

  describe('D8 · 결정 1 — PARTIAL 진행 셸에는 블록이 없다 (선제 green 트립와이어)', () => {
    it('PARTIAL + 미배치 → 진행 카드는 뜨고 블록은 없다', async () => {
      itineraryScript = () =>
        itinerary({ unplaced: UNPLACED, generationState: 'PARTIAL' });

      renderPage();

      expect(
        await screen.findByTestId('generation-progress-card', {}, WAIT)
      ).toBeOnTheScreen();
      expect(screen.queryByTestId(BLOCK)).toBeNull();
    });
  });
});
