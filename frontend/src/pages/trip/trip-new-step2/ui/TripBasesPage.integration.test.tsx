import type { ReactElement } from 'react';
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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type {
  AssignBaseRequest,
  BaseAssignment,
  SavedStay,
  Trip,
  TripStatus,
} from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/create-trip';
import { resetPressGuard } from '@/shared/press/pressGuard';
import { getGetTripsTripIdBasesQueryKey } from '@/shared/api/generated/trips/trips';

import { TripBasesPage } from './TripBasesPage';
import { TripNewStep2Page } from './TripNewStep2Page';

/**
 * TRIP-1149 — 여행 단위 거점 화면(`TripBasesPage`) 통합 테스트(실 HTTP·MSW). 옛 본 파일과 옛 `.editMode`
 * 를 합쳤다. 옛 파일 하나 = 바깥 describe 하나다. 두 옛 파일의 jest.mock 은 글자까지 같아 그대로 올렸다.
 * 갈리는 것은 생명주기다 — 편집 모드의 시계 정지(`Date.now`)·서버 초기 배정(`A_BOTH_NIGHTS`)은 그 describe 의
 * beforeEach/afterEach 안에만 있다. 가짜 서버·요청 관찰자도 describe 마다 따로다.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// 복귀 분기가 canGoBack 을 부르므로 반드시 넣는다(없으면 "canGoBack is not a function" 거짓 red).
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
  router: {
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  },
}));

jest.mock('../model/useStayAddresses', () => ({
  useStayAddresses: () => ({}),
}));

// 교체 흐름은 DELETE→POST→재조회 왕복이 여럿이라 로컬 ~1.7s, CI 러너에서 5s 기본 제한을 넘는다
// (PR #766 CI 실측). 한 테스트 안에 NETWORK_WAIT(15s) 대기가 여러 번이라 그보다 넉넉히.
jest.setTimeout(60000);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  clearAccessToken();
  resetPressGuard();
  useTripWizardStore.getState().reset();
  server.resetHandlers();
});

afterAll(() => server.close());

/**
 * TRIP-1011 C(#039) — 3/4 에서 "거점 숙소 다시 고르기"로 여는 **여행 단위 거점 화면**
 * (`/trips/[tripId]/bases`)과, 그 화면·위저드 2/4 가 함께 쓰는 **밤 교체**.
 *
 * 무엇을 보장하나 — 실제로 나간 요청과 보이는 얼굴로 잰다(msw + 실물 조회·지정 훅):
 *  - AC-C2 카드는 **서버 여행**(`GET /trips/{T}`)의 기간·여행지로 그려지고, 지정 POST 는 T 로 간다.
 *    위저드 스토어에 다른 여행(S) 값이 남아 있어도 그 값은 쓰지 않는다.
 *  - AC-C3 조회 중이면 loading, 실패하면 error 얼굴. 재시도는 실패한 조회(여행·저장 숙소·거점 셋
 *    중 무엇이든)를 다시 부른다. 여행 id 가 늘 있으므로 notrip 얼굴은 나오지 않는다.
 *  - AC-C4 두 CTA 는 3/4 로 돌아간다 — 뒤로 갈 곳이 있으면 `back()`, 없으면 3/4 로 `replace`.
 *    위저드(`/trips/new/*`)로는 가지 않는다.
 *  - AC-C5 들어갔다 나와도 위저드 스토어는 그대로다.
 *  - AC-C6 이미 숙소가 있는 밤을 다른 숙소로 바꾸면 **지우고(DELETE) → 다시 붙인다(POST)**.
 *    여러 밤짜리 배정은 나머지 밤을 다시 붙인다. 같은 숙소면 요청 0건. 중간에 실패하면 시트를
 *    유지한 채 오류를 띄우고 거점을 다시 받아 **지금 서버 상태**를 보여 준다(INV-4). 위저드 2/4 도 같다.
 *
 * 가짜 서버는 **상태를 기억한다** — DELETE 는 목록에서 지우고 POST 는 더한다. 그래서 "재조회 뒤
 * 카드가 B 다"가 목이 아니라 서버 흉내의 결과로 잰다. 교체 **순서**는 서버 쪽 처리 기록으로
 * 잰다: DELETE 처리를 일부러 늦게 끝내므로, DELETE 를 기다리지 않고 POST 를 같이 보내면 POST 가
 * 먼저 기록돼 red 가 된다.
 *
 * 주소 조회 훅(`useStayAddresses`)은 목이다 — 이 파일은 역지오코딩을 재지 않는다(형제
 * `geocodeLazy` 파일 몫). 바텀시트는 `__mocks__` 통과형 목이라 실제 열림은 6-b 몫.
 *
 * ⚠️ `jest.mock` 팩토리가 참조하는 바깥 변수는 이름이 `mock` 으로 시작해야 한다(리포 확립 규칙).
 */
describe('여행 단위 거점 화면 · 밤 교체 (TRIP-1011 C)', () => {
  const BASE = 'http://localhost:8080/api/v1';
  /** 이번 화면의 여행(라우트 tripId). */
  const TRIP_T = 'trip-t';
  /** 위저드 스토어에 남아 있는 **다른** 여행 — 이 값이 새면 AC-C2·C5 가 red. */
  const TRIP_S = 'trip-s';

  const METHOD_ROUTE = {
    pathname: '/trips/[tripId]/itinerary/method',
    params: { tripId: TRIP_T },
  };

  function stay(savedStayId: string, name: string): SavedStay {
    return {
      savedStayId,
      name,
      coordConfirmed: true,
      linkedTripIds: [],
      checkIn: null,
      checkOut: null,
      registerRoute: 'MAP_SEARCH',
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
  }

  // 두 이름은 서로의 부분 문자열이 아니다 — 카드 텍스트 부분 일치(정규식)가 서로를 잡지 않게.
  const STAY_A = stay('stay-a', '롯데호텔 서울');
  const STAY_B = stay('stay-b', '메리어트 동대문');

  /** 서울특별시 N박 여행(9/26 시작). 기본 2박 = 9/26·9/27 두 밤. */
  function trip(nights = 2): Trip {
    const endDay = 26 + nights;
    return {
      tripId: TRIP_T,
      title: '서울 여행',
      startDate: '2026-09-26',
      endDate: `2026-09-${endDay}`,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '서울특별시', nights }],
      status: 'PLANNED',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      baseCount: 1,
      itineraryDayCount: 0,
    };
  }

  function assignment(
    baseAssignmentId: string,
    savedStayId: string,
    dateFrom: string,
    dateTo: string
  ): BaseAssignment {
    return { baseAssignmentId, savedStayId, dateFrom, dateTo };
  }

  // ── 상태를 기억하는 가짜 서버 ───────────────────────────────────────────────

  /** 서버가 지금 들고 있는 T 의 배정 — DELETE 가 지우고 POST 가 더한다. */
  let serverBases: BaseAssignment[] = [];
  let serverTrip: Trip = trip();
  let savedStays: SavedStay[] = [];
  /** 나간 요청 `METHOD /경로`(발사 순서). */
  let hits: string[] = [];
  /** 서버가 **처리를 끝낸** 순서 — 교체 순서(DELETE 먼저) 판정은 이 기록으로 한다. */
  let handled: string[] = [];
  /** 받은 POST 본문(도착 순서). */
  let postBodies: AssignBaseRequest[] = [];
  /** n 번째 POST(1부터)를 500 으로 — 중간 실패 재현. */
  let failPostAt: number | null = null;
  /** 다음 GET 한 번을 500 으로 — 재시도 재현. 한 번 실패하면 스스로 꺼진다. */
  let failOnce: { trip: boolean; stays: boolean; bases: boolean };
  /** 여행 GET 응답을 붙잡는 문 — loading 얼굴을 결정론적으로 만든다. */
  let tripGate: Promise<void> | null = null;
  let postSeq = 0;

  function hitCount(needle: string): number {
    return hits.filter((hit) => hit === needle).length;
  }

  const TRIP_HIT = `GET /api/v1/trips/${TRIP_T}`;
  const STAYS_HIT = 'GET /api/v1/saved-stays';
  const BASES_HIT = `GET /api/v1/trips/${TRIP_T}/bases`;
  const POST_HIT = `POST /api/v1/trips/${TRIP_T}/bases`;

  function useFakeServer(): void {
    server.use(
      http.get(`${BASE}/trips/:tripId`, async ({ params }) => {
        if (params.tripId !== TRIP_T)
          return new HttpResponse(null, { status: 404 });
        if (tripGate) await tripGate;
        if (failOnce.trip) {
          failOnce.trip = false;
          return new HttpResponse(null, { status: 500 });
        }
        return HttpResponse.json(serverTrip);
      }),
      http.get(`${BASE}/saved-stays`, () => {
        if (failOnce.stays) {
          failOnce.stays = false;
          return new HttpResponse(null, { status: 500 });
        }
        return HttpResponse.json(savedStays);
      }),
      http.get(`${BASE}/trips/:tripId/bases`, ({ params }) => {
        if (params.tripId !== TRIP_T)
          return new HttpResponse(null, { status: 404 });
        if (failOnce.bases) {
          failOnce.bases = false;
          return new HttpResponse(null, { status: 500 });
        }
        return HttpResponse.json(serverBases);
      }),
      http.delete(
        `${BASE}/trips/:tripId/bases/:baseAssignmentId`,
        async ({ params }) => {
          // 일부러 늦게 끝낸다 — DELETE 를 기다리지 않고 POST 를 같이 쏘면 POST 가 먼저 기록된다.
          await new Promise((resolve) => setTimeout(resolve, 30));
          const id = String(params.baseAssignmentId);
          const exists = serverBases.some((row) => row.baseAssignmentId === id);
          if (params.tripId !== TRIP_T || !exists) {
            return new HttpResponse(null, { status: 404 });
          }
          serverBases = serverBases.filter(
            (row) => row.baseAssignmentId !== id
          );
          handled.push(`DELETE ${id}`);
          return new HttpResponse(null, { status: 204 });
        }
      ),
      http.post(`${BASE}/trips/:tripId/bases`, async ({ params, request }) => {
        const body = (await request.json()) as AssignBaseRequest;
        postBodies.push(body);
        handled.push(`POST ${body.savedStayId} ${body.dateFrom}`);
        if (params.tripId !== TRIP_T)
          return new HttpResponse(null, { status: 404 });
        if (failPostAt !== null && postBodies.length === failPostAt) {
          return new HttpResponse(null, { status: 500 });
        }
        postSeq += 1;
        const created = { baseAssignmentId: `new-${postSeq}`, ...body };
        serverBases = [...serverBases, created];
        return HttpResponse.json(created, { status: 201 });
      })
    );
  }

  beforeAll(() => {
    server.events.on('request:start', ({ request }) => {
      hits.push(`${request.method} ${new URL(request.url).pathname}`);
    });
  });

  // 이 describe 의 관찰자만 떼어 낸다 — 다음 describe 의 요청이 이 배열로 새지 않게.
  afterAll(() => server.events.removeAllListeners('request:start'));

  /** 위저드 스토어를 **다른 여행 S** 로 채운다 — 부산 2박 + 경주 1박, 6/10–6/13(카드 3장이 나오는 값). */
  function seedOtherTripInStore(): void {
    const store = useTripWizardStore.getState();
    store.reset();
    store.setCreatedTripId(TRIP_S);
    store.addDestination('부산', 2);
    store.addDestination('경주', 1);
    store.setPeriod(undefined, '2026-06-10', '2026-06-13');
  }

  function storeSnapshot() {
    const state = useTripWizardStore.getState();
    return {
      createdTripId: state.createdTripId,
      destinations: state.destinations,
      startDate: state.startDate,
      endDate: state.endDate,
    };
  }

  let client: QueryClient;

  beforeEach(() => {
    // TRIP-1013 — 연타 가드의 400ms 창은 모듈 전역이라 앞 테스트의 "지정" 누름이 새지 않게 닫는다.
    resetPressGuard();
    serverBases = [];
    serverTrip = trip();
    savedStays = [STAY_A, STAY_B];
    hits = [];
    handled = [];
    postBodies = [];
    failPostAt = null;
    failOnce = { trip: false, stays: false, bases: false };
    tripGate = null;
    postSeq = 0;
    mockPush.mockClear();
    mockBack.mockClear();
    mockReplace.mockClear();
    mockCanGoBack.mockReset();
    mockCanGoBack.mockReturnValue(true);
    // 모듈 싱글턴 스토어 — 파일 최상위에서 매번 다른 여행 값으로 되돌린다(앞 테스트 누수 차단).
    seedOtherTripInStore();
    setAccessToken('valid-access');
    // retry:false — 실패를 곧바로 얼굴로. gcTime:0 — 테스트 뒤 타이머가 프로세스를 붙잡지 않게.
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false, gcTime: 0 },
      },
    });
    useFakeServer();
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  /**
   * 네트워크를 타는 기다림의 상한. RNTL 기본(1초)은 첫 실행(모듈 변환·msw 기동)에서 DELETE→POST→재조회
   * 사슬을 못 기다려 단독 실행에서만 간헐 red 가 났다(실측 — 묶음 실행은 green). 결과를 바꾸지 않고
   * "얼마나 기다리나"만 늘린다.
   */
  // CI 러너는 로컬보다 ~4배 느리다(PR #766 실측 — 이 파일 로컬 10s · CI 40s). 교체 왕복을 기다리는 한도.
  const NETWORK_WAIT = { timeout: 15000 };

  function tripBasesPage(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <TripBasesPage tripId={TRIP_T} />
      </QueryClientProvider>
    );
  }

  /** 여행 단위 화면을 그리고 첫 카드가 뜰 때까지 기다린다. */
  async function renderTripBases(): Promise<void> {
    render(tripBasesPage());
    await screen.findByTestId('trip-base-night-card-1', {}, NETWORK_WAIT);
  }

  /** n박 카드를 눌러 시트를 열고 숙소를 골라 "지정"한다. */
  function assignNight(nightNumber: number, savedStayId: string): void {
    fireEvent.press(screen.getByTestId(`trip-base-night-card-${nightNumber}`));
    fireEvent.press(
      screen.getByTestId(`trip-base-staysheet-cand-${savedStayId}`)
    );
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
  }

  /** 지정이 끝나 시트가 닫힐 때까지 기다린다. */
  async function sheetClosed(): Promise<void> {
    await waitFor(
      () => expect(screen.queryByTestId('trip-base-staysheet')).toBeNull(),
      NETWORK_WAIT
    );
  }

  /** 요청이 나갈 틈을 준다 — "0건" 단언이 "아직 안 나갔을 뿐"으로 공짜 통과하지 않게. */
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
  }

  // ── AC-C2 ────────────────────────────────────────────────────────────────────

  describe('AC-C2 · 카드는 서버 여행(T)으로 그리고, 지정은 T 로 간다', () => {
    it('스토어에 다른 여행(부산·경주 3박)이 있어도 카드는 T 의 서울특별시 2박 — 2장, 둘째 밤 9/27', async () => {
      await renderTripBases();

      // 스토어 값(3밤)을 쓰면 3장이 된다.
      expect(screen.getAllByTestId(/^trip-base-night-card-\d+$/)).toHaveLength(
        2
      );
      const card2 = screen.getByTestId('trip-base-night-card-2');
      expect(card2).toHaveTextContent(/서울특별시/);
      expect(card2).toHaveTextContent(/9\/27/);
      expect(screen.queryByText(/부산|경주/)).toBeNull();
    });

    it('1박에 숙소를 지정하면 POST 는 /trips/T/bases 로 {B, 9/26, 9/27} 한 건 — S 로는 한 건도 안 간다', async () => {
      await renderTripBases();
      // 앵커 — 아직 지정 요청이 없다.
      expect(postBodies).toEqual([]);

      assignNight(1, 'stay-b');

      await waitFor(() => expect(hitCount(POST_HIT)).toBe(1), NETWORK_WAIT);
      expect(postBodies).toEqual([
        { savedStayId: 'stay-b', dateFrom: '2026-09-26', dateTo: '2026-09-27' },
      ]);
      expect(hits.filter((hit) => hit.includes(TRIP_S))).toEqual([]);
    });
  });

  // ── AC-C3 ────────────────────────────────────────────────────────────────────

  describe('AC-C3 · 조회 중이면 loading, 실패하면 error — notrip 은 없다', () => {
    it('여행 조회가 끝나기 전엔 박별 스켈레톤을 그리고 notrip 얼굴이 아니다', async () => {
      let release!: () => void;
      tripGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      render(tripBasesPage());
      await settle();

      expect(
        screen.getAllByTestId(/^trip-base-skeleton-night-/).length
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId('trip-base-notrip')).toBeNull();
      // 카드가 스토어(S) 값으로 먼저 새지 않는다.
      expect(screen.queryByTestId('trip-base-night-card-1')).toBeNull();

      // 문을 꼭 푼다 — 안 풀면 요청이 테스트 뒤에 매달린다.
      await act(async () => {
        release();
      });
      await screen.findByTestId('trip-base-night-card-1', {}, NETWORK_WAIT);
    });

    it.each([
      ['여행', 'trip', TRIP_HIT],
      ['저장 숙소', 'stays', STAYS_HIT],
      ['거점', 'bases', BASES_HIT],
    ] as const)(
      '%s 조회가 실패하면 error 얼굴(notrip 아님) — 재시도를 누르면 그 조회를 다시 불러 카드가 뜬다',
      async (_label, key, hit) => {
        failOnce[key] = true;
        render(tripBasesPage());

        await screen.findByTestId('trip-base-error', {}, NETWORK_WAIT);
        expect(screen.queryByTestId('trip-base-notrip')).toBeNull();
        const before = hitCount(hit);
        expect(before).toBeGreaterThanOrEqual(1);

        fireEvent.press(screen.getByTestId('trip-base-error-retry'));

        await screen.findByTestId('trip-base-night-card-1', {}, NETWORK_WAIT);
        expect(hitCount(hit)).toBeGreaterThan(before);
        expect(screen.queryByTestId('trip-base-error')).toBeNull();
      }
    );
  });

  // ── AC-C4 ────────────────────────────────────────────────────────────────────

  describe('AC-C4 · 두 CTA 는 3/4 로 돌아간다 (위저드로 가지 않는다)', () => {
    it('뒤로 갈 곳이 있으면 주 CTA 가 back() 한 번 — replace·push 없음', async () => {
      mockCanGoBack.mockReturnValue(true);
      await renderTripBases();

      fireEvent.press(screen.getByTestId('trip-base-generate'));

      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('뒤로 갈 곳이 없으면(딥링크) 보조 CTA 가 3/4 로 replace — back 없음', async () => {
      mockCanGoBack.mockReturnValue(false);
      await renderTripBases();

      fireEvent.press(screen.getByTestId('trip-base-nostay-start'));

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith(METHOD_ROUTE);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('주 CTA 도 딥링크면 같은 3/4 로 replace — 어느 라우터 호출에도 /trips/new 가 없다', async () => {
      mockCanGoBack.mockReturnValue(false);
      await renderTripBases();

      fireEvent.press(screen.getByTestId('trip-base-generate'));

      expect(mockReplace).toHaveBeenCalledWith(METHOD_ROUTE);
      const routed = [...mockPush.mock.calls, ...mockReplace.mock.calls].map(
        (call) => JSON.stringify(call)
      );
      expect(routed.filter((call) => call.includes('/trips/new'))).toEqual([]);
    });

    // TRIP-1082 03b 경고-2 — onBack 에 편집 모드 분기가 생겼다. mode 없이(h04 입구) 헤더 ‹ 는
    // 여전히 3/4 로 가야 한다. 편집 출구(l04 폴백 '/my/stays')로 새면 여기서 red.
    it('mode 없이(h04 입구) 딥링크에서 헤더 ‹ 도 3/4 로 replace — /my/stays 로 가지 않는다', async () => {
      mockCanGoBack.mockReturnValue(false);
      await renderTripBases();

      fireEvent.press(screen.getByTestId('trip-base-back'));

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith(METHOD_ROUTE);
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  // ── TRIP-1013 AC-S ───────────────────────────────────────────────────────────

  /** 가드 판정용으로 멈춰 둘 시각(값 자체는 의미 없다 — 흐르지 않는 것이 요점). */
  const FROZEN_NOW = 1_790_000_000_000;

  describe('TRIP-1013 AC-S · 여행 단위 화면의 출구는 연타 가드 밖이다 (가드는 관찰된 5곳에만)', () => {
    // 시계를 멈춘다 — 화면을 그리고 응답을 기다리는 동안 실제 시간이 흘러 "창 안"이 400ms 를 넘기면
    // 판정이 흔들린다(02a ★2). "창 밖"은 resetPressGuard() 로만 만든다.
    let clock: jest.SpyInstance;
    beforeEach(() => {
      clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
    });
    afterEach(() => clock.mockRestore());

    it('지정 성공 직후 주 CTA 를 한 번 누르면 back() 이 정확히 1회다', async () => {
      mockCanGoBack.mockReturnValue(true);
      await renderTripBases();
      assignNight(1, 'stay-b');
      await sheetClosed();
      // 앵커 — 지정이 실제로 끝났다(시트 닫힘은 성공 경로에서만).
      expect(screen.queryByTestId('trip-base-staysheet')).toBeNull();

      fireEvent.press(screen.getByTestId('trip-base-generate'));

      // 위저드 2/4 의 같은 CTA 는 창 안이면 무시되지만(#038), 이 화면의 복귀는 가드를 안 탄다.
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC-C5 ────────────────────────────────────────────────────────────────────

  describe('AC-C5 · 여행 단위 화면은 위저드 스토어를 건드리지 않는다', () => {
    it('들어가서 지정하고 3/4 로 나와도 createdTripId·여행지·기간이 그대로다', async () => {
      const before = storeSnapshot();
      // 앵커 — 보존을 잴 값이 실제로 있다.
      expect(before.createdTripId).toBe(TRIP_S);
      expect(before.destinations).toHaveLength(2);

      await renderTripBases();
      assignNight(1, 'stay-a');
      await sheetClosed();
      fireEvent.press(screen.getByTestId('trip-base-generate'));

      expect(storeSnapshot()).toEqual(before);
    });
  });

  // ── AC-C6 ────────────────────────────────────────────────────────────────────

  describe('AC-C6 · 이미 숙소가 있는 밤을 바꾸면 지우고 다시 붙인다 (교체)', () => {
    it('1박짜리 A 가 있는 1박을 B 로 — DELETE a1 이 끝난 뒤 POST B, 재조회 후 1박 카드가 B 다', async () => {
      serverBases = [assignment('a1', 'stay-a', '2026-09-26', '2026-09-27')];
      await renderTripBases();
      // 앵커 — 바꾸기 전 카드는 A 다.
      expect(screen.getByTestId('trip-base-night-card-1')).toHaveTextContent(
        /롯데호텔 서울/
      );

      assignNight(1, 'stay-b');

      await sheetClosed();
      // 서버 처리 순서 — 지우기가 먼저 끝나고 붙이기가 온다.
      expect(handled).toEqual(['DELETE a1', 'POST stay-b 2026-09-26']);
      expect(postBodies).toEqual([
        { savedStayId: 'stay-b', dateFrom: '2026-09-26', dateTo: '2026-09-27' },
      ]);
      await waitFor(
        () =>
          expect(
            screen.getByTestId('trip-base-night-card-1')
          ).toHaveTextContent(/메리어트 동대문/),
        NETWORK_WAIT
      );
      expect(
        screen.getByTestId('trip-base-night-card-1')
      ).not.toHaveTextContent(/롯데호텔 서울/);
    });

    it('A 가 1–3박 한 배정일 때 2박만 B 로 — DELETE 1회 뒤 A[1박]·A[3박]·B[2박] POST, 카드는 A·B·A', async () => {
      serverTrip = trip(3);
      serverBases = [assignment('a', 'stay-a', '2026-09-26', '2026-09-29')];
      await renderTripBases();

      assignNight(2, 'stay-b');

      await sheetClosed();
      expect(handled.filter((line) => line.startsWith('DELETE'))).toEqual([
        'DELETE a',
      ]);
      // 지우기가 먼저 끝난다 — 첫 기록이 DELETE.
      expect(handled[0]).toBe('DELETE a');
      // 보내는 순서는 계약이 아니다(브리프 AC-C6) — 집합으로 잰다.
      const keys = postBodies
        .map((body) => `${body.savedStayId}|${body.dateFrom}|${body.dateTo}`)
        .sort();
      expect(keys).toEqual(
        [
          'stay-a|2026-09-26|2026-09-27',
          'stay-a|2026-09-28|2026-09-29',
          'stay-b|2026-09-27|2026-09-28',
        ].sort()
      );
      await waitFor(
        () =>
          expect(
            screen.getByTestId('trip-base-night-card-2')
          ).toHaveTextContent(/메리어트 동대문/),
        NETWORK_WAIT
      );
      expect(screen.getByTestId('trip-base-night-card-1')).toHaveTextContent(
        /롯데호텔 서울/
      );
      expect(screen.getByTestId('trip-base-night-card-3')).toHaveTextContent(
        /롯데호텔 서울/
      );
    });

    it('같은 숙소를 다시 고르면 요청 0건 — 시트는 닫힌다', async () => {
      serverBases = [assignment('a1', 'stay-a', '2026-09-26', '2026-09-27')];
      await renderTripBases();

      assignNight(1, 'stay-a');

      await sheetClosed();
      await settle();
      expect(hits.filter((hit) => hit.startsWith('DELETE'))).toEqual([]);
      expect(hitCount(POST_HIT)).toBe(0);
    });

    it('지운 뒤 붙이기가 실패하면 — 시트 유지·인라인 오류, 거점을 다시 받아 1박을 "숙소 미정"으로 보여 준다 (INV-4)', async () => {
      serverBases = [assignment('a1', 'stay-a', '2026-09-26', '2026-09-27')];
      failPostAt = 1;
      await renderTripBases();
      const basesBefore = hitCount(BASES_HIT);

      assignNight(1, 'stay-b');

      await screen.findByTestId('trip-base-staysheet-error', {}, NETWORK_WAIT);
      expect(screen.getByTestId('trip-base-staysheet')).toBeOnTheScreen();
      // 조용히 옛 화면(A)을 들고 있지 않다 — 서버에선 A 가 이미 지워졌다.
      await waitFor(
        () => expect(hitCount(BASES_HIT)).toBeGreaterThan(basesBefore),
        NETWORK_WAIT
      );
      await waitFor(
        () =>
          expect(
            screen.getByTestId('trip-base-night-card-1')
          ).toHaveTextContent(/숙소 미정/),
        NETWORK_WAIT
      );
    });
  });

  describe('AC-C6 · 위저드 2/4 도 같은 교체를 쓴다 (공통 배선)', () => {
    it('위저드에서 1박짜리 A 를 B 로 바꾸면 DELETE a1 → POST B, 카드가 B 다', async () => {
      const store = useTripWizardStore.getState();
      store.reset();
      store.setCreatedTripId(TRIP_T);
      store.addDestination('서울특별시', 2);
      store.setPeriod(undefined, '2026-09-26', '2026-09-28');
      serverBases = [assignment('a1', 'stay-a', '2026-09-26', '2026-09-27')];
      render(
        <QueryClientProvider client={client}>
          <TripNewStep2Page />
        </QueryClientProvider>
      );
      await waitFor(
        () =>
          expect(
            screen.getByTestId('trip-base-night-card-1')
          ).toHaveTextContent(/롯데호텔 서울/),
        NETWORK_WAIT
      );

      assignNight(1, 'stay-b');

      await sheetClosed();
      expect(handled).toEqual(['DELETE a1', 'POST stay-b 2026-09-26']);
      await waitFor(
        () =>
          expect(
            screen.getByTestId('trip-base-night-card-1')
          ).toHaveTextContent(/메리어트 동대문/),
        NETWORK_WAIT
      );
    });
  });
});

/**
 * TRIP-1082 — l04 '출발점 변경'으로 여는 **거점 편집 모드**(`/trips/[tripId]/bases?mode=edit`)의 행위.
 *
 * 무엇을 보장하나 — 실제로 나간 요청과 라우터 호출로 잰다(msw + 실물 조회·지정 훅):
 *  - AC-6 거점이 **실제로** 안 바뀌었으면(아무것도 안 함 · 같은 숙소 재선택 · A→B→A) [완료]는 묻지 않고
 *    떠난다: 뒤로 갈 곳이 있으면 `back()`, 없으면(딥링크) l04 로 `replace('/my/stays')`.
 *  - AC-7 바뀌었고 다시 만들 일정이 있는 여행(PLANNED/CONFIRMED · 일정 > 0)이면 묻는 다이얼로그가 뜨고,
 *    아직 어디로도 가지 않는다(BR-U6-21 "묻는다").
 *  - AC-8 [그대로 두기]는 떠나기만 한다 · AC-9 [일정 다시 만들기]는 생성 화면(h09)으로 `replace` 한 번 —
 *    **이 화면은 일정 POST 를 쏘지 않는다**(POST 는 h09 소관, BR-U6-21 "조용히 재생성 금지").
 *  - AC-10 진행 중·종료 여행, 일정 0일 여행은 재생성 선택지 없이 떠난다(서버가 409 로 거절하는 조합, Q4).
 *  - AC-11 부분 실패(지우기만 성공)로 밤이 비어도 '변경'이다 — 서버 상태 변화를 조용히 넘기지 않는다(INV-4).
 *  - Q6 헤더 ‹ 도 [완료]와 같은 판정을 탄다.
 *  - 01b 스냅샷 — 들어오기 전 캐시(l04 가 채운 값)가 아니라 **들어와서 처음 받은 서버 값**이 비교 기준이다.
 *  - AC-13 mode 없이 열면 위저드 얼굴 그대로다(기존 `TripBasesPage.integration.test.tsx` 무수정 green 과 짝).
 *
 * 가짜 서버는 **상태를 기억한다**(형제 `TripBasesPage.integration.test.tsx` 복제) — DELETE 는 지우고 POST 는
 * 더한다. 그래서 "A→B→A 뒤 행은 두 개로 갈렸지만 밤의 숙소는 같다"가 서버 흉내의 결과로 재진다.
 *
 * 일정 POST(`POST /trips/T/itinerary`)는 **핸들러 없이** 발사 기록(`request:start`)으로만 센다 — 응답 모양을
 * 발명하지 않는다. 쏘는 것 자체가 위반이다.
 *
 * jest 사각(→ 6-b): 다이얼로그의 실제 덮임·중앙 정렬, 시트가 [완료]를 덮는지, 실제 스택의 back 목적지,
 * iOS 스와이프·Android 하드웨어 뒤로(묻지 않고 나감 = 암묵적 [그대로 두기]).
 *
 * ⚠️ `jest.mock` 팩토리가 참조하는 바깥 변수는 이름이 `mock` 으로 시작해야 한다(리포 확립 규칙).
 *
 * 시계 정지·서버 초기값 `A_BOTH_NIGHTS` 는 이 describe 의 beforeEach/afterEach 안에만 있다(옛 파일 최상위에서 옮김).
 */
describe('편집 모드 (TRIP-1082)', () => {
  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_T = 'trip-t';

  const GENERATING_ROUTE = {
    pathname: '/trips/[tripId]/itinerary/generating',
    params: { tripId: TRIP_T, mode: 'FULLY_AI' },
  };

  function stay(savedStayId: string, name: string): SavedStay {
    return {
      savedStayId,
      name,
      coordConfirmed: true,
      linkedTripIds: [],
      checkIn: null,
      checkOut: null,
      registerRoute: 'MAP_SEARCH',
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
  }

  // 두 이름은 서로의 부분 문자열이 아니다 — 카드 텍스트 부분 일치(정규식)가 서로를 잡지 않게.
  const STAY_A = stay('stay-a', '롯데호텔 서울');
  const STAY_B = stay('stay-b', '메리어트 동대문');

  /** 서울특별시 2박(9/26·9/27) 여행. 기본은 확정 + 일정 2일 — "다시 만들 일정이 있는" 여행. */
  function trip(status: TripStatus = 'CONFIRMED', itineraryDayCount = 2): Trip {
    return {
      tripId: TRIP_T,
      title: '서울 여행',
      startDate: '2026-09-26',
      endDate: '2026-09-28',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '서울특별시', nights: 2 }],
      status,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      baseCount: 1,
      itineraryDayCount,
    };
  }

  function assignment(
    baseAssignmentId: string,
    savedStayId: string,
    dateFrom: string,
    dateTo: string
  ): BaseAssignment {
    return { baseAssignmentId, savedStayId, dateFrom, dateTo };
  }

  /** 기본 배정 — A 가 두 밤을 **한 행**으로 덮는다(★5: A→B→A 뒤 두 행으로 갈려야 판별력이 생긴다). */
  const A_BOTH_NIGHTS = [assignment('a', 'stay-a', '2026-09-26', '2026-09-28')];

  // ── 상태를 기억하는 가짜 서버 ───────────────────────────────────────────────

  let serverBases: BaseAssignment[] = [];
  let serverTrip: Trip = trip();
  let savedStays: SavedStay[] = [];
  /** 나간 요청 `METHOD /경로`(발사 순서) — 핸들러 없는 요청도 기록된다. */
  let hits: string[] = [];
  /** 서버가 처리를 끝낸 순서. */
  let handled: string[] = [];
  let postBodies: AssignBaseRequest[] = [];
  /** n 번째 bases POST(1부터)를 500 으로 — 부분 실패 재현. */
  let failPostAt: number | null = null;
  let postSeq = 0;

  function hitCount(needle: string): number {
    return hits.filter((hit) => hit === needle).length;
  }

  const BASES_POST_HIT = `POST /api/v1/trips/${TRIP_T}/bases`;
  const ITINERARY_POST_HIT = `POST /api/v1/trips/${TRIP_T}/itinerary`;

  function useFakeServer(): void {
    server.use(
      http.get(`${BASE}/trips/:tripId`, ({ params }) => {
        if (params.tripId !== TRIP_T)
          return new HttpResponse(null, { status: 404 });
        return HttpResponse.json(serverTrip);
      }),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json(savedStays)),
      http.get(`${BASE}/trips/:tripId/bases`, ({ params }) => {
        if (params.tripId !== TRIP_T)
          return new HttpResponse(null, { status: 404 });
        return HttpResponse.json(serverBases);
      }),
      http.delete(
        `${BASE}/trips/:tripId/bases/:baseAssignmentId`,
        async ({ params }) => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          const id = String(params.baseAssignmentId);
          const exists = serverBases.some((row) => row.baseAssignmentId === id);
          if (params.tripId !== TRIP_T || !exists) {
            return new HttpResponse(null, { status: 404 });
          }
          serverBases = serverBases.filter(
            (row) => row.baseAssignmentId !== id
          );
          handled.push(`DELETE ${id}`);
          return new HttpResponse(null, { status: 204 });
        }
      ),
      http.post(`${BASE}/trips/:tripId/bases`, async ({ params, request }) => {
        const body = (await request.json()) as AssignBaseRequest;
        postBodies.push(body);
        handled.push(`POST ${body.savedStayId} ${body.dateFrom}`);
        if (params.tripId !== TRIP_T)
          return new HttpResponse(null, { status: 404 });
        if (failPostAt !== null && postBodies.length === failPostAt) {
          return new HttpResponse(null, { status: 500 });
        }
        postSeq += 1;
        const created = { baseAssignmentId: `new-${postSeq}`, ...body };
        serverBases = [...serverBases, created];
        return HttpResponse.json(created, { status: 201 });
      })
    );
  }

  beforeAll(() => {
    server.events.on('request:start', ({ request }) => {
      hits.push(`${request.method} ${new URL(request.url).pathname}`);
    });
  });

  // 이 describe 의 관찰자만 떼어 낸다 — 다음 describe 의 요청이 이 배열로 새지 않게.
  afterAll(() => server.events.removeAllListeners('request:start'));

  /** 연타 가드 판정용으로 멈춰 둘 시각 — 흐르지 않는 것이 요점(★7). */
  const FROZEN_NOW = 1_790_000_000_000;

  let client: QueryClient;
  let clock: jest.SpyInstance;

  // 모듈 싱글턴(연타 가드 창)·가짜 서버 상태는 파일 최상위에서 매번 되돌린다(앞 테스트 누수 차단).
  beforeEach(() => {
    resetPressGuard();
    // 시계를 멈춘다 — 지정 성공이 여는 400ms 창 안에서 [완료]를 누르게 된다. [완료]를 연타 가드로 감싸면
    // 그 누름이 삼켜져 결정론적으로 red(TRIP-1013 AC-S: 여행 단위 출구는 가드 밖).
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
    serverBases = [...A_BOTH_NIGHTS];
    serverTrip = trip();
    savedStays = [STAY_A, STAY_B];
    hits = [];
    handled = [];
    postBodies = [];
    failPostAt = null;
    postSeq = 0;
    mockPush.mockClear();
    mockBack.mockClear();
    mockReplace.mockClear();
    mockCanGoBack.mockReset();
    mockCanGoBack.mockReturnValue(true);
    setAccessToken('valid-access');
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false, gcTime: 0 },
      },
    });
    useFakeServer();
  });

  afterEach(() => {
    clock.mockRestore();
    server.resetHandlers();
    clearAccessToken();
  });

  const NETWORK_WAIT = { timeout: 15000 };

  function editPage(): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <TripBasesPage tripId={TRIP_T} mode="edit" />
      </QueryClientProvider>
    );
  }

  /** 편집 화면을 그리고 1박 카드가 서버 값(A)으로 뜰 때까지 기다린다 — 이때 스냅샷이 확정된다. */
  async function renderEdit(): Promise<void> {
    render(editPage());
    await waitFor(
      () =>
        expect(screen.getByTestId('trip-base-night-card-1')).toHaveTextContent(
          /롯데호텔 서울/
        ),
      NETWORK_WAIT
    );
  }

  function assignNight(nightNumber: number, savedStayId: string): void {
    fireEvent.press(screen.getByTestId(`trip-base-night-card-${nightNumber}`));
    fireEvent.press(
      screen.getByTestId(`trip-base-staysheet-cand-${savedStayId}`)
    );
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
  }

  async function sheetClosed(): Promise<void> {
    await waitFor(
      () => expect(screen.queryByTestId('trip-base-staysheet')).toBeNull(),
      NETWORK_WAIT
    );
  }

  /** 1박 카드가 그 숙소 이름을 보일 때까지(재조회 끝) 기다린다. */
  async function night1Shows(name: RegExp): Promise<void> {
    await waitFor(
      () =>
        expect(screen.getByTestId('trip-base-night-card-1')).toHaveTextContent(
          name
        ),
      NETWORK_WAIT
    );
  }

  /** 1박을 B 로 바꾸고 재조회가 끝나 카드가 B 가 될 때까지. */
  async function changeNight1ToB(): Promise<void> {
    assignNight(1, 'stay-b');
    await sheetClosed();
    await night1Shows(/메리어트 동대문/);
  }

  /** 요청이 나갈 틈을 준다 — "0건" 단언이 "아직 안 나갔을 뿐"으로 공짜 통과하지 않게. */
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
  }

  function pressDone(): void {
    fireEvent.press(screen.getByTestId('trip-base-edit-done'));
  }

  function routerCalls(): number {
    return (
      mockPush.mock.calls.length +
      mockBack.mock.calls.length +
      mockReplace.mock.calls.length
    );
  }

  // ── AC-3·4 (페이지 관통) ──────────────────────────────────────────────────────

  describe('AC-3·4 · 편집 모드로 열면 편집 얼굴이다 (페이지 → 배선 → 화면)', () => {
    it('[완료]가 있고 진행바·생성 CTA 는 없다', async () => {
      await renderEdit();

      expect(screen.getByTestId('trip-base-edit-done')).toBeOnTheScreen();
      expect(screen.queryByTestId('trip-base-generate')).toBeNull();
      expect(screen.queryByTestId('trip-wizard-progress-seg-1')).toBeNull();
    });
  });

  // ── AC-6 ─────────────────────────────────────────────────────────────────────

  describe('AC-6 · 거점이 실제로 안 바뀌었으면 묻지 않고 떠난다', () => {
    it('아무것도 안 하고 [완료] — 다이얼로그 없이 back() 1회, 일정 POST 0', async () => {
      await renderEdit();

      pressDone();
      await settle();

      expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
    });

    it('같은 숙소(A)를 다시 지정하고 [완료] — 요청 0건이라도 성공은 불린다, 그래도 묻지 않는다', async () => {
      await renderEdit();

      assignNight(1, 'stay-a');
      await sheetClosed();
      await settle();
      // 앵커 — 지정 요청은 정말 0건이었다(같은 숙소 재선택).
      expect(hitCount(BASES_POST_HIT)).toBe(0);

      pressDone();
      await settle();

      expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
    });

    it('A → B → A 로 되돌리고 [완료] — 행은 갈렸지만 밤의 숙소가 같아 묻지 않는다', async () => {
      await renderEdit();

      await changeNight1ToB();
      // 시계가 멈춰 있어 방금 지정이 연 400ms 창이 닫히지 않는다 — 시트 [지정]은 연타 가드를 타므로(#038)
      // "사용자가 잠시 뒤 다시 지정한다"를 창 닫기로 만든다(★7). [완료]는 그 뒤 지정이 다시 연 창 안에서 누른다.
      resetPressGuard();
      assignNight(1, 'stay-a');
      await sheetClosed();
      await night1Shows(/롯데호텔 서울/);
      // 앵커 — 실제로 두 번 교체됐다(원래 행 a 와 B 행이 지워졌다). 행 id·행 수로 비교하면 여기서 묻는다.
      expect(handled.filter((line) => line.startsWith('DELETE'))).toHaveLength(
        2
      );

      pressDone();
      await settle();

      expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
    });

    it('뒤로 갈 곳이 없으면(딥링크) l04 로 replace("/my/stays") — back 없음', async () => {
      mockCanGoBack.mockReturnValue(false);
      await renderEdit();

      pressDone();

      expect(mockReplace.mock.calls).toEqual([['/my/stays']]);
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('들어오기 전 캐시(l04 가 채운 옛 값 B)가 서버(A)와 달라도, 아무것도 안 했으면 묻지 않는다 — 기준은 들어와서 받은 서버 값', async () => {
      // 준비 — l04 의 TripBasesProbe 가 같은 키를 채워 둔 상황. gcTime 0 이라 같은 틱에 렌더해 관찰자를 붙인다(★9).
      client.setQueryData(getGetTripsTripIdBasesQueryKey(TRIP_T), [
        assignment('old', 'stay-b', '2026-09-26', '2026-09-28'),
      ]);
      render(editPage());
      // 재조회가 끝나 카드가 서버 값(A)이 됐다 = 스냅샷 확정.
      await night1Shows(/롯데호텔 서울/);

      pressDone();
      await settle();

      expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC-7 · AC-5 ──────────────────────────────────────────────────────────────

  describe('AC-7 · 바뀌었고 다시 만들 일정이 있으면 묻는다 (BR-U6-21)', () => {
    it.each(['PLANNED', 'CONFIRMED'] as const)(
      '%s 여행에서 1박을 B 로 바꾸고 [완료] — 다이얼로그가 뜨고 아직 아무 데도 안 간다, 일정 POST 0',
      async (status) => {
        serverTrip = trip(status, 2);
        await renderEdit();

        await changeNight1ToB();
        // AC-5 앵커 — 편집 모드에서도 지정은 교체다(지우기가 먼저 끝난다).
        expect(handled[0]).toBe('DELETE a');

        pressDone();
        await settle();

        expect(screen.getByTestId('trip-base-regen-dialog')).toBeOnTheScreen();
        expect(routerCalls()).toBe(0);
        expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
      }
    );
  });

  // ── AC-8 ─────────────────────────────────────────────────────────────────────

  describe('AC-8 · [그대로 두기]는 떠나기만 한다', () => {
    it('뒤로 갈 곳이 있으면 back() 1회 — 일정 POST 0', async () => {
      await renderEdit();
      await changeNight1ToB();
      pressDone();
      await screen.findByTestId('trip-base-regen-dialog', {}, NETWORK_WAIT);

      fireEvent.press(screen.getByTestId('trip-base-regen-keep'));
      await settle();

      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
    });

    it('뒤로 갈 곳이 없으면 replace("/my/stays") — 일정 POST 0', async () => {
      mockCanGoBack.mockReturnValue(false);
      await renderEdit();
      await changeNight1ToB();
      pressDone();
      await screen.findByTestId('trip-base-regen-dialog', {}, NETWORK_WAIT);

      fireEvent.press(screen.getByTestId('trip-base-regen-keep'));
      await settle();

      expect(mockReplace.mock.calls).toEqual([['/my/stays']]);
      expect(mockBack).not.toHaveBeenCalled();
      expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
    });
  });

  // ── AC-9 ─────────────────────────────────────────────────────────────────────

  describe('AC-9 · [일정 다시 만들기]는 생성 화면(h09)으로 넘긴다 — 이 화면은 POST 를 쏘지 않는다', () => {
    it('generating 으로 { tripId, mode: FULLY_AI } replace 1회 · back·push 없음 · 일정 POST 0', async () => {
      await renderEdit();
      await changeNight1ToB();
      pressDone();
      await screen.findByTestId('trip-base-regen-dialog', {}, NETWORK_WAIT);

      fireEvent.press(screen.getByTestId('trip-base-regen-confirm'));
      await settle();

      expect(mockReplace.mock.calls).toEqual([[GENERATING_ROUTE]]);
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
    });
  });

  // ── AC-10 (Q4) ───────────────────────────────────────────────────────────────

  describe('AC-10 · 다시 만들 수 없는 여행은 묻지 않고 떠난다 (Q4)', () => {
    it.each(['ACTIVE', 'ENDED'] as const)(
      '%s 여행에서 바꾸고 [완료] — 재생성 선택지 없이 back() 1회, 일정 POST 0',
      async (status) => {
        serverTrip = trip(status, 2);
        await renderEdit();
        await changeNight1ToB();

        pressDone();
        await settle();

        expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
        expect(screen.queryByTestId('trip-base-regen-confirm')).toBeNull();
        expect(mockBack).toHaveBeenCalledTimes(1);
        expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
      }
    );

    it('일정이 아직 없는 여행(itineraryDayCount 0)은 바꿔도 묻지 않는다', async () => {
      serverTrip = trip('PLANNED', 0);
      await renderEdit();
      await changeNight1ToB();

      pressDone();
      await settle();

      expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC-11 ────────────────────────────────────────────────────────────────────

  describe('AC-11 · 부분 실패로 밤이 비어도 "바뀐 것"이다 (INV-4)', () => {
    it('지우기는 성공·붙이기는 실패 → 1박이 "숙소 미정"이 된 뒤 [완료] — 묻는다', async () => {
      // 1박짜리 A 한 행 — B 지정은 DELETE a1 → POST B(실패) 로 끝나 서버의 1박이 빈다(★10).
      serverBases = [assignment('a1', 'stay-a', '2026-09-26', '2026-09-27')];
      failPostAt = 1;
      await renderEdit();

      assignNight(1, 'stay-b');
      await screen.findByTestId('trip-base-staysheet-error', {}, NETWORK_WAIT);
      await night1Shows(/숙소 미정/);

      pressDone();
      await settle();

      expect(screen.getByTestId('trip-base-regen-dialog')).toBeOnTheScreen();
      expect(routerCalls()).toBe(0);
    });
  });

  // ── Q6 ───────────────────────────────────────────────────────────────────────

  describe('Q6 · 헤더 ‹ 도 [완료]와 같은 판정을 탄다', () => {
    it('바꾼 뒤 ‹ — 다이얼로그가 뜨고 아직 떠나지 않는다', async () => {
      await renderEdit();
      await changeNight1ToB();

      fireEvent.press(screen.getByTestId('trip-base-back'));
      await settle();

      expect(screen.getByTestId('trip-base-regen-dialog')).toBeOnTheScreen();
      expect(routerCalls()).toBe(0);
    });

    it('안 바꾸고 ‹ — 다이얼로그 없이 back() 1회', async () => {
      await renderEdit();

      fireEvent.press(screen.getByTestId('trip-base-back'));
      await settle();

      expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC-13 ────────────────────────────────────────────────────────────────────

  describe('AC-13 · mode 없이 열면(h04 입구) 위저드 얼굴 그대로다', () => {
    it('진행바·생성 CTA·숙소 없이 시작하기가 있고 편집 [완료]는 없다', async () => {
      render(
        <QueryClientProvider client={client}>
          <TripBasesPage tripId={TRIP_T} />
        </QueryClientProvider>
      );
      await screen.findByTestId('trip-base-night-card-1', {}, NETWORK_WAIT);

      expect(
        screen.getByTestId('trip-wizard-progress-seg-1')
      ).toBeOnTheScreen();
      expect(screen.getByTestId('trip-base-generate')).toBeOnTheScreen();
      expect(screen.getByTestId('trip-base-nostay-start')).toBeOnTheScreen();
      expect(screen.queryByTestId('trip-base-edit-done')).toBeNull();
    });
  });
});
