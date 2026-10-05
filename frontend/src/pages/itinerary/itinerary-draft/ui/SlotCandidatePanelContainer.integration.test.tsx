import type { ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
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
import { buildSlotKey } from '@/entities/itinerary-slot';
import { SLOT_SWAP_CONFLICT_CODES } from '@/features/edit-itinerary/model/slotSwapError';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItemAlternativesItem,
  SlotCandidates,
} from '@/shared/api/index.schemas';
import { getGetTripsTripIdItineraryQueryKey } from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotCandidatePanelContainer } from './SlotCandidatePanelContainer';

/**
 * h08 다른 후보 시트 컨테이너(`SlotCandidatePanelContainer`) — **실 훅 + MSW** 통합 테스트.
 *
 * TRIP-1150 에서 세 파일을 한 파일로 합쳤다(page 안의 별도 컴포넌트라 DraftPage 통합과는 따로 둔다 —
 * 컨테이너만 단독 렌더하고 라우터 목이 없다). 옛 파일 하나 = 바깥 describe 하나, 각자의 픽스처·기본 MSW
 * 핸들러(describe 의 beforeEach)는 그대로다. 서버 listen/close 만 최상위 한 번. 옛 `.fetchStates` 의
 * 최상위 `afterEach(useRealTimers)` 는 그 describe 안으로 들어갔다.
 *
 * 3동작 뼈대: 준비 = MSW 핸들러·토큰 → 실행 = 컨테이너 렌더·카드/확정 press → 단언 = 보이는 것·나간 요청.
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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterAll(() => server.close());

// TRIP-793 · 옛 SlotCandidatePanelContainer.integration.test.tsx(본 파일)
describe('후보 조회·선택·교체 배선', () => {
  /**
   * h08 슬롯 교체 배선을 **실 HTTP 로** 태우는 심판(TRIP-793 — 컨테이너는 이제 `SlotCandidateSheet`
   * (바텀시트·라디오 2단계)를 그린다). 프레젠테이션이 인라인 패널→바텀시트로, 확정이 즉시확정 1단계→
   * 라디오 2단계로 바뀌었어도 **배선 로직은 재사용**이다(조회·치환·PUT·firedRef·콜드캐시).
   *
   * 무엇을 보장하나:
   *  - 마운트(=시트 열림)에 slot-candidates POST 1건, slotKey 만(BR-U3-24).
   *  - 화면 후보 집합 = 응답 집합(INV-1).
   *  - 🔴 **라디오 2단계**: 행 press 는 선택만(PUT 0) · "교체하기" press 에서 전체 days PUT 1건·성공 시
   *    onClose + 재조회(AC-4).
   *  - ★h09: 동기 연속 확정 2회여도 PUT 1건(firedRef, handleConfirm).
   *  - PUT 409/500/네트워크 실패는 인라인 오류로 뜨고 시트를 안 닫는다(AC-6·INV-4).
   *  - 🔴 GET 미도착 중 확정 → PUT 0(빈 days 전체교체 방지, 경고3).
   *  - 🔴 **PARTIAL(2차 생성 중)이면 확정 PUT 0**(★ 가드가 handleConfirm 으로 이전 · AC-11 · 뮤테이션 실측).
   *  - 🔴 **헤더에 시각범위·컨셉 관통**(`{HH:mm}–{HH:mm} · {category} 슬롯의 …`, K10 · D5 · 옛 timeBand 대체).
   *  - 🔴 **degraded 전용 표면 제거**(응답이 degraded 여도 시트에 무표시 · AC-6, K12).
   *
   * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=열고 라디오+확정 → 단언=나간 요청·보이는 것.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';
  const CURRENT_SLOT_KEY = buildSlotKey(DAY1, 'a');

  /** day1=[a(09:30–11:00 · category 문화) · b] · day2=[c](endsNextDay). 교체 대상은 day1 의 a. */
  function itinerary(): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'a',
            nameKo: '경복궁',
            startAt: '09:30:00',
            endAt: '11:00:00',
            category: '문화',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
          {
            poiId: 'b',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
      {
        date: DAY2,
        slots: [
          {
            poiId: 'c',
            startAt: '22:00:00',
            endAt: '01:00:00',
            isFixed: false,
            endsNextDay: true,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ];
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
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

  let getCalls = 0;
  let postCalls = 0;
  let putCalls = 0;
  let postBody: unknown = null;
  let putBody: unknown = null;
  let putHandler: () => Response;
  let candidatesResponse: object = CANDIDATES;

  const mockClose = jest.fn();

  beforeEach(() => {
    getCalls = 0;
    postCalls = 0;
    putCalls = 0;
    postBody = null;
    putBody = null;
    candidatesResponse = CANDIDATES;
    mockClose.mockClear();
    setAccessToken('valid-access');
    putHandler = () => HttpResponse.json(itinerary());

    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () => {
        getCalls += 1;
        return HttpResponse.json(itinerary());
      }),
      http.post(
        `${BASE}/trips/:tripId/itinerary/slot-candidates`,
        async ({ request }) => {
          postCalls += 1;
          postBody = await request.json();
          return HttpResponse.json(candidatesResponse);
        }
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        putCalls += 1;
        putBody = await request.json();
        return putHandler();
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderContainer() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(
      <SlotCandidatePanelContainer
        tripId={TRIP_ID}
        slotKey={CURRENT_SLOT_KEY}
        onClose={mockClose}
      />,
      { wrapper: Wrapper }
    );
  }

  /** 후보 카드 루트 셀렉터(재설계 반영 — 하위·특수 testID 부정 룩어헤드 제외). */
  const CANDIDATE_ROOT =
    /^itinerary-candidate-(?!sheet|scrim|current|empty|error|place-search|confirm|name-|image-|distance-|tags-|radio-|check-)/;

  /** 라디오 선택 후 "교체하기"를 눌러 확정하는 2단계 헬퍼. */
  async function selectAndConfirm(poiId: string) {
    fireEvent.press(
      await screen.findByTestId(`itinerary-candidate-radio-${poiId}`)
    );
    fireEvent.press(screen.getByTestId('itinerary-candidate-confirm'));
  }

  describe('🔴 SlotCandidatePanelContainer (h08) 배선', () => {
    it('K1 · AC1·BR-U3-24 — 마운트에 slot-candidates POST 1건, slotKey 만 실린다', async () => {
      renderContainer();

      await waitFor(() => expect(postCalls).toBe(1));
      expect((postBody as { slotKey: string }).slotKey).toBe(CURRENT_SLOT_KEY);
      expect(Object.keys(postBody as object).sort()).toEqual(['slotKey']);
      await screen.findByTestId('itinerary-candidate-X');
    });

    it('K2 · INV-1 — 렌더 후보 카드 집합 = 응답 후보 집합', async () => {
      renderContainer();

      await screen.findByTestId('itinerary-candidate-X');
      const poiIds = screen
        .getAllByTestId(CANDIDATE_ROOT)
        .map((n) => String(n.props.testID).replace('itinerary-candidate-', ''));
      expect(poiIds.sort()).toEqual(['X', 'Y'].sort());
    });

    it('K3 · AC4 — 라디오 2단계: 행 선택은 PUT 0, "교체하기"에서 치환 PUT 1건 + onClose + 재조회', async () => {
      renderContainer();
      await screen.findByTestId('itinerary-candidate-radio-X');
      await waitFor(() => expect(getCalls).toBe(1));

      // 1단계 — 라디오 선택은 controlled 상태만 바꾼다(PUT 안 나감).
      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
      expect(putCalls).toBe(0);

      // 2단계 — "교체하기"에서 확정.
      fireEvent.press(screen.getByTestId('itinerary-candidate-confirm'));

      await waitFor(() => expect(putCalls).toBe(1));
      const body = putBody as EditItineraryRequest;
      expect(body.days.map((d) => d.date)).toEqual([DAY1, DAY2]);
      expect(body.days[0].slots[0].poiId).toBe('X');
      expect(body.days[0].slots[1].poiId).toBe('b');
      expect(body.days[0].slots[0].startAt).toBe('09:30:00');
      expect(Object.keys(body.days[0].slots[0]).sort()).toEqual(
        ['poiId', 'startAt', 'endAt', 'isFixed', 'endsNextDay'].sort()
      );

      await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(getCalls).toBe(2));
    });

    it('K4 · AC4(★h09) — 확정 CTA 동기 연속 2회여도 PUT 은 1건이다(firedRef)', async () => {
      renderContainer();
      fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-X'));
      const confirm = screen.getByTestId('itinerary-candidate-confirm');

      act(() => {
        fireEvent.press(confirm);
        fireEvent.press(confirm);
      });

      await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
      expect(putCalls).toBe(1);
    });

    it('K5 · AC6 — PUT 409(확정)는 인라인 오류로 뜨고 시트를 안 닫는다', async () => {
      putHandler = () =>
        HttpResponse.json(
          {
            error: {
              code: SLOT_SWAP_CONFLICT_CODES.confirmed,
              message: '확정',
            },
          },
          { status: 409 }
        );
      renderContainer();
      await selectAndConfirm('X');

      await waitFor(() => expect(putCalls).toBe(1));
      const err = await screen.findByTestId('itinerary-candidate-error');
      expect(err).toHaveTextContent(/\S/);
      expect(mockClose).toHaveBeenCalledTimes(0);
      expect(screen.getByTestId('itinerary-candidate-sheet')).toBeOnTheScreen();
    });

    it('K6 · AC6·INV-4 — PUT 500 도 침묵하지 않는다', async () => {
      putHandler = () => new HttpResponse(null, { status: 500 });
      renderContainer();
      await selectAndConfirm('X');

      const err = await screen.findByTestId('itinerary-candidate-error');
      expect(err).toHaveTextContent(/\S/);
      expect(mockClose).toHaveBeenCalledTimes(0);
    });

    it('K7 · AC6·INV-4 — PUT 네트워크 실패도 침묵하지 않는다', async () => {
      putHandler = () => HttpResponse.error();
      renderContainer();
      await selectAndConfirm('X');

      const err = await screen.findByTestId('itinerary-candidate-error');
      expect(err).toHaveTextContent(/\S/);
    });

    it('K8 · 경고2 — 현 슬롯은 실이름(nameKo)을 보인다, "이름 준비 중" 아님', async () => {
      renderContainer();
      const current = await screen.findByTestId('itinerary-candidate-current');

      await waitFor(() => expect(current).toHaveTextContent(/경복궁/));
      expect(current).not.toHaveTextContent('이름 준비 중');
    });

    it('K9 · 경고3 — GET 미도착 중 확정 → PUT 0(빈 days 전체교체 방지)', async () => {
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
          await delay('infinite');
          return HttpResponse.json(itinerary());
        })
      );
      renderContainer();
      await selectAndConfirm('X');

      await waitFor(() => expect(postCalls).toBe(1));
      expect(putCalls).toBe(0);
      expect(mockClose).toHaveBeenCalledTimes(0);
    });

    it('K10 · AC2·D5 — 헤더에 현 슬롯 시각범위·컨셉이 관통된다(09:30–11:00 · 문화)', async () => {
      renderContainer();

      const subtitle = await screen.findByTestId(
        'itinerary-candidate-sheet-subtitle'
      );
      // 현 슬롯 startAt 09:30·endAt 11:00·category 문화 → 부제에 시각범위+컨셉이 실린다(옛 timeBand 대체).
      await waitFor(() => expect(subtitle).toHaveTextContent(/09:30–11:00/));
      expect(subtitle).toHaveTextContent(/문화/);
    });

    it('K11 · AC-11(★ PARTIAL 게이트 handleConfirm) — PARTIAL 중 라디오+확정 → PUT 0', async () => {
      // 준비 — GET 이 PARTIAL(day1 도착)로 정착. data 는 있어 콜드캐시(K9)와 달리 throw 안 나고,
      // 가드가 없으면 "교체하기"가 그대로 day1-only 전체교체 PUT 을 쏜다(traps-itinerary TRIP-467/483 잔여).
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () => {
          getCalls += 1;
          return HttpResponse.json({
            ...itinerary(),
            generationState: 'PARTIAL',
          });
        })
      );
      renderContainer();
      await screen.findByTestId('itinerary-candidate-radio-X');
      await waitFor(() => expect(getCalls).toBe(1));

      // 실행 — 라디오 선택은 되지만 확정(PUT)은 막혀야 한다.
      await selectAndConfirm('X');

      // ★ 통과형 목 함정 회피 — PUT 이 나갔다면 이 대기 동안 putCalls 가 오른다(나갈 시간을 실제로 준다).
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      // ★ PARTIAL 이면 전체교체 PUT 이 나가면 안 된다(handleConfirm 의 isConfirmLocked 가드).
      // 뮤테이션 실측: 이 가드를 지우면 이 테스트만 red(PUT 1) — 원복은 cp/Edit, git checkout 금지.
      expect(putCalls).toBe(0);
      expect(mockClose).toHaveBeenCalledTimes(0);
    });

    it('K12 · AC6 — degraded 전용 표면 제거: 응답이 degraded 여도 시트에 무표시', async () => {
      candidatesResponse = { ...CANDIDATES, degraded: true };
      renderContainer();

      // 후보는 뜨지만 강등 전용 표면은 더 이상 없다(옛 itinerary-candidate-degraded 소멸).
      await screen.findByTestId('itinerary-candidate-X');
      expect(screen.queryByTestId('itinerary-candidate-degraded')).toBeNull();
    });
  });
});

// TRIP-1109 · 옛 SlotCandidatePanelContainer.fetchStates.integration.test.tsx
describe('조회 중·실패·지연', () => {
  /**
   * TRIP-1109 · h08 다른 후보 시트의 **조회 중·실패·지연** 배선을 실 HTTP(msw)로 태운다.
   *
   * 무엇을 보장하나:
   *  - 응답 전엔 스켈레톤(loading), 실패면 안내 + [다시 시도](error) — 0건 얼굴은 **응답이 0건일 때만**(INV-4).
   *  - 실패 문구 = `resolveSlotSwapError(error).message` 그대로(404 갈래가 하드코딩 우회를 막는다).
   *  - 10초가 지나도 응답이 없으면 로딩 얼굴 안에 안내 줄 + [다시 시도](slow). 요청은 끊지 않는다.
   *  - [다시 시도]는 같은 바디로 POST 1회, 새 요청 기준으로 10초를 다시 잰다.
   *  - 한 틱 연타는 1회로 접히고(앞 창), 다음 [다시 시도]가 다시 보이면 그 버튼은 산다(뒤 창).
   *
   * ★ 타이머 케이스는 fake timer 를 **렌더 전에** 켜고, 경계 사이엔 `findBy`/`waitFor` 를 쓰지 않는다
   *   (fake 아래 findBy 가 시계를 스스로 민다 — 02a ★2·★4). 해제는 파일 최상위 afterEach.
   *
   * 3동작 뼈대: 준비=POST 호출 순번별 응답 계획 → 실행=시트 열기·시간 흘리기·[다시 시도] → 단언=얼굴·요청 수.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const SLOT_KEY = buildSlotKey(DAY1, 'a');

  /** `resolveSlotSwapError` 문구(slotSwapError.ts MESSAGE) — 화면에 그대로 떠야 한다. */
  const FALLBACK = '지금은 바꿀 수 없어요. 잠시 후 다시 시도해 주세요';
  const NOT_FOUND = '해당 일정을 찾을 수 없어요';
  const EMPTY_TITLE = '이 슬롯에 맞는 다른 후보가 없어요';
  const SLOW_TEXT = /시간이 걸리고 있어요/;

  const ID = {
    loading: 'itinerary-candidate-loading',
    slow: 'itinerary-candidate-slow',
    retry: 'itinerary-candidate-fetch-retry',
    fetchError: 'itinerary-candidate-fetch-error',
    empty: 'itinerary-candidate-empty',
    emptySearch: 'itinerary-candidate-empty-search',
    current: 'itinerary-candidate-current',
    confirm: 'itinerary-candidate-confirm',
    putError: 'itinerary-candidate-error',
    sheet: 'itinerary-candidate-sheet',
    title: 'itinerary-candidate-sheet-title',
  } as const;

  function itinerary(): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [
        {
          date: DAY1,
          slots: [
            {
              poiId: 'a',
              nameKo: '경복궁',
              startAt: '09:30:00',
              endAt: '11:00:00',
              category: '문화',
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

  const CANDIDATES = {
    candidates: [
      { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
      { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
    ],
    radiusMUsed: 1100,
    degraded: false,
  };

  /**
   * POST 호출 순번별 응답 계획. `hang` = 영원히 응답 안 함, `gate` = 테스트가 `releaseGate()` 로 풀 때까지
   * 대기 후 후보 2건, 숫자 = 그 상태코드, `network` = 연결 실패, `ok` = 후보 2건, `empty` = 0건.
   */
  type PostStep =
    | 'hang'
    | 'gate'
    | 'ok'
    | 'empty'
    | 'emptyAllIn'
    | 'network'
    | 500
    | 404
    | 409;

  let postPlan: PostStep[] = [];
  let postBodies: unknown[] = [];
  let releaseGate: () => void = () => undefined;
  let putHandler: () => Response;

  function postCalls(): number {
    return postBodies.length;
  }

  async function respond(step: PostStep): Promise<Response> {
    switch (step) {
      case 'hang':
        await delay('infinite');
        return HttpResponse.json(CANDIDATES);
      case 'gate':
        await new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        return HttpResponse.json(CANDIDATES);
      case 'ok':
        return HttpResponse.json(CANDIDATES);
      case 'empty':
        return HttpResponse.json({
          candidates: [],
          radiusMUsed: 3000,
          degraded: false,
          emptyReason: 'NO_NEARBY',
        });
      case 'emptyAllIn':
        return HttpResponse.json({
          candidates: [],
          radiusMUsed: 3000,
          degraded: false,
          emptyReason: 'ALL_IN_ITINERARY',
        });
      case 'network':
        return HttpResponse.error();
      case 409:
        // 실서버 모양 — 모든 409 가 `CONFLICT` 로 온다(Q4 · 브리프 ④-c).
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: '충돌' } },
          { status: 409 }
        );
      default:
        return new HttpResponse(null, { status: step });
    }
  }

  beforeEach(() => {
    postPlan = [];
    postBodies = [];
    releaseGate = () => undefined;
    putHandler = () => HttpResponse.json(itinerary());
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.post(
        `${BASE}/trips/:tripId/itinerary/slot-candidates`,
        async ({ request }) => {
          const step = postPlan[postBodies.length] ?? 'hang';
          postBodies.push(await request.json());
          return respond(step);
        }
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, () => putHandler())
    );
  });

  // 파일 최상위 — 타이머 describe 의 fake 가 다른 케이스로 새지 않게(02a ★2).
  afterEach(() => {
    jest.useRealTimers();
    server.resetHandlers();
    clearAccessToken();
  });

  function renderContainer() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(
      <SlotCandidatePanelContainer
        tripId={TRIP_ID}
        slotKey={SLOT_KEY}
        onClose={jest.fn()}
      />,
      { wrapper: Wrapper }
    );
  }

  /** fake timer 아래에서 시간을 흘리고 그 사이 약속(axios→msw→TanStack)을 함께 푼다. */
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  /** 실시간 짧은 대기 — 더 나갈 요청이 있었다면 이 사이에 나간다(K11 선례). */
  async function settleRealTime(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    });
  }

  function expectConfirmDisabled(): void {
    expect(
      screen.getByTestId(ID.confirm).props.accessibilityState.disabled
    ).toBe(true);
  }

  describe('🔴 TRIP-1109 · 응답 전·도착 (L1·L2·N1·N2)', () => {
    it('C1 · L1·L2 — 응답 전엔 스켈레톤, 0건 얼굴은 없다. 헤더·현재 행은 GET 값, 교체하기는 비활성', async () => {
      postPlan = ['hang'];
      renderContainer();

      await waitFor(() => expect(postCalls()).toBe(1));
      await waitFor(() =>
        expect(screen.getByTestId(ID.title)).toHaveTextContent('경복궁 대신')
      );

      expect(screen.getByTestId(ID.loading)).toBeOnTheScreen();
      expect(screen.queryByTestId(ID.empty)).toBeNull();
      expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
      expect(screen.queryByTestId(ID.emptySearch)).toBeNull();
      expect(screen.getByTestId(ID.current)).toBeOnTheScreen();
      expectConfirmDisabled();
    });

    it('C13 · L1 첫 프레임 — 시트를 연 바로 그 렌더에도 0건 얼굴이 새지 않는다(03b 참고 2)', async () => {
      postPlan = ['hang'];

      renderContainer();

      // await 없이 곧장 본다 — 기다리면 이미 요청 중(pending)이라 첫 프레임(idle)을 못 본다(C1 의 사각).
      expect(postCalls()).toBe(0);
      expect(screen.queryByTestId(ID.empty)).toBeNull();
      expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
      expect(screen.getByTestId(ID.loading)).toBeOnTheScreen();

      // 뒷정리 겸 앵커 — 이 케이스가 본 것이 정말 "요청 직전"이었다(요청은 곧 1회 나간다).
      await waitFor(() => expect(postCalls()).toBe(1));
    });

    it('C2 · N1 — 후보가 도착하면 스켈레톤이 사라지고 후보 행이 선다', async () => {
      postPlan = ['ok'];
      renderContainer();

      await screen.findByTestId('itinerary-candidate-radio-X');
      expect(
        screen.getByTestId('itinerary-candidate-radio-Y')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId(ID.loading)).toBeNull();
    });

    it('C3 · N2 — 응답이 실제로 0건이면 **그때** 0건 얼굴(BR-U3-25)', async () => {
      postPlan = ['empty'];
      renderContainer();

      await screen.findByTestId(ID.empty);
      expect(screen.getByTestId(ID.emptySearch)).toBeOnTheScreen();
      expect(screen.queryByTestId(ID.loading)).toBeNull();
      expect(screen.queryByTestId(ID.fetchError)).toBeNull();
      // TRIP-948 — NO_NEARBY 는 기존 문구 + 접미 노드.
      expect(
        screen.getByTestId('itinerary-candidate-empty-no-nearby')
      ).toBeOnTheScreen();
    });

    it('C3b · TRIP-948 — emptyReason=ALL_IN_ITINERARY 응답이면 새 문구(응답 → 컨테이너 → 시트 관통)', async () => {
      postPlan = ['emptyAllIn'];
      renderContainer();

      await screen.findByTestId('itinerary-candidate-empty-all-in-itinerary');
      expect(
        screen.getByText('근처 후보가 이미 모두 일정에 있어요')
      ).toBeOnTheScreen();
      expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
      expect(screen.getByTestId(ID.emptySearch)).toBeOnTheScreen();
    });
  });

  describe('🔴 TRIP-1109 · 조회 실패 (E1·E2·E3·R1·P1)', () => {
    it.each<[string, PostStep, string]>([
      ['500', 500, FALLBACK],
      ['네트워크 실패', 'network', FALLBACK],
      ['404', 404, NOT_FOUND],
    ])(
      'C4 · E1·INV-4 — %s 는 "후보 없음"으로 접히지 않고 실패 카드에 resolveSlotSwapError 문구가 뜬다',
      async (_label, step, message) => {
        postPlan = [step];
        renderContainer();

        const card = await screen.findByTestId(ID.fetchError);
        expect(within(card).getByText(message)).toBeOnTheScreen();
        expect(screen.queryByTestId(ID.empty)).toBeNull();
        expect(screen.queryByTestId(ID.loading)).toBeNull();
        // 조회 실패는 PUT 인라인 오류와 다른 자리다.
        expect(screen.queryByTestId(ID.putError)).toBeNull();
      }
    );

    it('C5 · E3 — 409(실서버 code CONFLICT)는 fallback 문구로 뜬다', async () => {
      postPlan = [409];
      renderContainer();

      const card = await screen.findByTestId(ID.fetchError);
      expect(within(card).getByText(FALLBACK)).toBeOnTheScreen();
    });

    it('C6 · E2 — [다시 시도]는 같은 바디로 POST 1회, 응답 전엔 스켈레톤으로 돌아가고 도착하면 후보', async () => {
      postPlan = [500, 'gate'];
      renderContainer();
      await screen.findByTestId(ID.fetchError);

      fireEvent.press(screen.getByTestId(ID.retry));

      await waitFor(() => expect(postCalls()).toBe(2));
      expect(Object.keys(postBodies[1] as object)).toEqual(['slotKey']);
      expect((postBodies[1] as { slotKey: string }).slotKey).toBe(SLOT_KEY);
      await waitFor(() =>
        expect(screen.getByTestId(ID.loading)).toBeOnTheScreen()
      );
      expect(screen.queryByTestId(ID.fetchError)).toBeNull();

      await act(async () => {
        releaseGate();
      });
      await screen.findByTestId('itinerary-candidate-radio-X');
      expect(screen.queryByTestId(ID.loading)).toBeNull();
    });

    it('C7 · R1(실패 얼굴) — 한 틱 연타는 POST 1회만 더, 다시 실패하면 그다음 [다시 시도]는 산다', async () => {
      postPlan = [500, 500, 'hang'];
      renderContainer();
      await screen.findByTestId(ID.fetchError);

      // 앞 창 — 같은 틱 두 번(리렌더 없이). useState 잠금은 둘 다 옛 값을 읽어 못 막는다.
      const retry = screen.getByTestId(ID.retry);
      act(() => {
        fireEvent.press(retry);
        fireEvent.press(retry);
      });
      await waitFor(() => expect(postCalls()).toBe(2));
      await settleRealTime();
      expect(postCalls()).toBe(2);

      // 뒤 창 — 두 번째도 실패해 실패 얼굴이 다시 뜨면, 그 [다시 시도]는 눌린다.
      await screen.findByTestId(ID.fetchError);
      fireEvent.press(screen.getByTestId(ID.retry));
      await waitFor(() => expect(postCalls()).toBe(3));
    });

    it('C12 · P1 — 교체 PUT 실패는 기존 인라인 오류만, 조회 실패 카드는 뜨지 않는다', async () => {
      postPlan = ['ok'];
      putHandler = () => new HttpResponse(null, { status: 500 });
      renderContainer();

      fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-X'));
      fireEvent.press(screen.getByTestId(ID.confirm));

      await screen.findByTestId(ID.putError);
      expect(screen.queryByTestId(ID.fetchError)).toBeNull();
      expect(screen.getByTestId(ID.sheet)).toBeOnTheScreen();
    });
  });

  describe('🔴 TRIP-1109 · 10초 지연 (T1~T4·R1) — fake timer', () => {
    it('C8 · T1·T2 — 9.9초엔 안내 없음, 10초를 넘기면 스켈레톤 위에 안내 줄 + [다시 시도]. 자동 재요청은 없다', async () => {
      postPlan = ['hang'];
      jest.useFakeTimers();
      renderContainer();

      await advance(9_900);
      expect(postCalls()).toBe(1);
      expect(screen.getByTestId(ID.loading)).toBeOnTheScreen();
      expect(screen.queryByTestId(ID.slow)).toBeNull();
      expect(screen.queryByTestId(ID.retry)).toBeNull();

      await advance(200);
      expect(screen.getByTestId(ID.slow)).toHaveTextContent(SLOW_TEXT);
      expect(screen.getByTestId(ID.retry)).toBeOnTheScreen();
      // 로딩 얼굴 **안의** 한 줄 — 스켈레톤은 그대로다.
      expect(screen.getByTestId(ID.loading)).toBeOnTheScreen();
      expect(postCalls()).toBe(1);
    });

    it('C9 · T3 — 지연 안내가 뜬 뒤 응답이 오면 후보로 바뀐다(요청을 끊지 않는다)', async () => {
      postPlan = ['gate'];
      jest.useFakeTimers();
      renderContainer();

      await advance(10_100);
      expect(screen.getByTestId(ID.slow)).toBeOnTheScreen();

      await act(async () => {
        releaseGate();
      });
      // 도착 사슬(msw→axios→TanStack 알림)을 풀 여유 — 경계 단언이 아니라 50ms 는 무해(02a §5-1 P2).
      await advance(50);

      expect(
        screen.getByTestId('itinerary-candidate-radio-X')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId(ID.slow)).toBeNull();
      expect(screen.queryByTestId(ID.loading)).toBeNull();
    });

    it('C10 · T4 — [다시 시도] 뒤엔 새 요청 기준으로 10초를 다시 재고, 다시 뜬 [다시 시도]도 눌린다', async () => {
      postPlan = ['hang', 'hang', 'hang'];
      jest.useFakeTimers();
      renderContainer();

      await advance(10_100);
      fireEvent.press(screen.getByTestId(ID.retry));
      await advance(0);
      expect(postCalls()).toBe(2);
      expect(screen.queryByTestId(ID.slow)).toBeNull();

      // 새 요청 기준 9.9초 — 아직 안내 없음(첫 요청 기준이면 이미 20초라 떠 있다).
      await advance(9_900);
      expect(screen.queryByTestId(ID.slow)).toBeNull();

      // 새 요청 기준 10.1초 — 다시 뜬다.
      await advance(200);
      expect(screen.getByTestId(ID.slow)).toHaveTextContent(SLOW_TEXT);

      // 다시 뜬 버튼이 죽어 있으면 침묵 실패다 — 두 번째 요청은 아직 매달려 있어도 눌려야 한다(02a ★1).
      fireEvent.press(screen.getByTestId(ID.retry));
      await advance(0);
      expect(postCalls()).toBe(3);
    });

    it('C11 · R1(지연 얼굴) — 한 틱 연타는 POST 1회만 더(pending 중이어도 한 번은 나간다)', async () => {
      postPlan = ['hang', 'hang'];
      jest.useFakeTimers();
      renderContainer();

      await advance(10_100);
      const retry = screen.getByTestId(ID.retry);
      act(() => {
        fireEvent.press(retry);
        fireEvent.press(retry);
      });
      await advance(0);

      expect(postCalls()).toBe(2);
    });
  });
});

// TRIP-1024 · 옛 SlotCandidatePanelContainer.names.integration.test.tsx
describe('후보 이름·태그·사진', () => {
  /**
   * TRIP-1024 · AC-2·4·5·6·7 — h08 "다른 후보 시트"가 후보 응답의 이름·태그·사진을 **실 HTTP 로** 받아
   * 그린다(QA #053 "이름 준비 중"·회색 사진).
   *
   * 무엇을 보장하나:
   *  - 🔴 H1 응답 `nameKo`·`tags` 가 이름 leaf·태그 leaf 로 뜬다(매핑이 이름을 버리면 red).
   *  - 🔴 H2 `imageUrl` 이 있으면 같은 testID leaf 가 그 URL 을 source 로, null·'' 면 source 없는 회색 자리.
   *    크기는 h08 56 · `rounded-thumb`.
   *  - 🔴 H3 현재 행 사진은 GET 슬롯의 `imageUrl`(POST 가 아니라).
   *  - 🔴 H4 `nameKo` null → 플레이스홀더, poiId 원문 비노출(INV-1).
   *  - 🔴 H5 후보 카드 텍스트에 소요시간 단위 0(INV-3).
   *
   * 기존 `SlotCandidatePanelContainer.integration.test.tsx` 의 공유 픽스처는 건드리지 않는다 — 거기 후보는
   * 이름·사진이 없는 옛 응답 모양으로 남아 "값이 없어도 안 깨진다"를 계속 지킨다.
   *
   * 3동작: 준비=가짜 서버 응답(GET 일정 + POST 후보) → 실행=컨테이너 마운트(=시트 열림) → 단언=보이는 leaf.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const CURRENT_SLOT_KEY = buildSlotKey(DAY1, 'a');

  const CURRENT_IMG = 'https://img.example/current.jpg';
  const X_IMG = 'https://img.example/x.jpg';
  /** 정본에 값이 없는 후보 — poiId 원문이 새면 바로 보이도록 일부러 튀는 id. */
  const RAW_ID = 'poi-raw-7788';

  function itinerary(): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [
        {
          date: DAY1,
          slots: [
            {
              poiId: 'a',
              nameKo: '경복궁',
              startAt: '09:30:00',
              endAt: '11:00:00',
              category: '문화',
              imageUrl: CURRENT_IMG,
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

  /** 값이 다 있는 X · 값이 없는 RAW_ID · 사진만 빈 문자열인 Z(Q4). */
  const CANDIDATES: SlotCandidates = {
    candidates: [
      {
        poiId: 'X',
        distanceRange: '420m',
        rationale: '가장 가까운 교회',
        nameKo: '남부산교회',
        tags: ['교회', '야외'],
        imageUrl: X_IMG,
      },
      {
        poiId: RAW_ID,
        distanceRange: '1.1km',
        rationale: '조용한 곳',
        nameKo: null,
        tags: [],
        imageUrl: null,
      },
      {
        poiId: 'Z',
        distanceRange: '2.4km',
        rationale: '바다 옆 사찰',
        nameKo: '해동용궁사',
        tags: ['사찰'],
        imageUrl: '',
      },
    ],
    radiusMUsed: 2400,
    degraded: false,
  };

  const ALL_IDS = ['X', RAW_ID, 'Z'];

  beforeEach(() => {
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.post(`${BASE}/trips/:tripId/itinerary/slot-candidates`, () =>
        HttpResponse.json(CANDIDATES)
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderContainer() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(
      <SlotCandidatePanelContainer
        tripId={TRIP_ID}
        slotKey={CURRENT_SLOT_KEY}
        onClose={jest.fn()}
      />,
      { wrapper: Wrapper }
    );
  }

  /** 후보 3개가 다 그려질 때까지 기다린다(POST 응답 도착). */
  async function renderAndWaitCandidates() {
    renderContainer();
    for (const id of ALL_IDS) {
      await screen.findByTestId(`itinerary-candidate-${id}`);
    }
  }

  /** className 을 공백으로 쪼갠 토큰 목록 — `min-h-[56px]` 같은 부분 일치 오탐을 막는다. */
  const classTokens = (testID: string): string[] =>
    String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);

  const THUMB_56 = ['h-[56px]', 'w-[56px]', 'rounded-thumb'];

  /** 소요시간 단위(INV-3) — 거리만 보여야 한다. */
  const DURATION = /분|시간|\bmin\b|소요/;

  describe('🔴 TRIP-1024 h08 후보 시트 — 이름·태그·사진', () => {
    it('H1 · AC-2 — 응답 nameKo·tags 가 이름 leaf·태그 leaf 로 뜨고 플레이스홀더가 없다', async () => {
      await renderAndWaitCandidates();

      expect(
        screen.getByTestId('itinerary-candidate-name-X')
      ).toHaveTextContent('남부산교회');
      // h08 태그 줄은 Figma 와 코드가 같다 — 첫 태그만 `#`, 나머지는 ` · `(완전일치).
      expect(
        screen.getByTestId('itinerary-candidate-tags-X')
      ).toHaveTextContent('#교회 · 야외');
      expect(screen.getByTestId('itinerary-candidate-X')).not.toHaveTextContent(
        /이름 준비 중/
      );
    });

    it('H2 · AC-4·비주얼(a) — 사진 있으면 그 URL 이 source, null·빈 문자열이면 source 없는 회색 자리(56·thumb)', async () => {
      await renderAndWaitCandidates();

      expect(
        screen.getByTestId('itinerary-candidate-image-X').props.source
      ).toEqual({ uri: X_IMG });
      // 회색 자리도 testID 는 유지된다(존재) — 그리고 이미지 source 는 없다(부재). 둘을 짝으로 본다.
      for (const id of [RAW_ID, 'Z']) {
        const leaf = screen.getByTestId(`itinerary-candidate-image-${id}`);
        expect(leaf.props.source).toBeUndefined();
      }
      for (const id of ALL_IDS) {
        expect(classTokens(`itinerary-candidate-image-${id}`)).toEqual(
          expect.arrayContaining(THUMB_56)
        );
      }
    });

    it('H3 · AC-5 — 현재 행 사진은 GET 슬롯의 imageUrl 이다(56·thumb)', async () => {
      await renderAndWaitCandidates();

      // GET 과 POST 도착 순서는 보장이 없다 — source 가 들어올 때까지 기다린다.
      await waitFor(() =>
        expect(
          screen.getByTestId('itinerary-candidate-image-current').props.source
        ).toEqual({ uri: CURRENT_IMG })
      );
      expect(classTokens('itinerary-candidate-image-current')).toEqual(
        expect.arrayContaining(THUMB_56)
      );
    });

    it('H4 · AC-6·INV-1 — nameKo null 이면 플레이스홀더, poiId 원문은 화면 어디에도 없다', async () => {
      await renderAndWaitCandidates();

      expect(
        screen.getByTestId(`itinerary-candidate-name-${RAW_ID}`)
      ).toHaveTextContent('이름 준비 중');
      // 긍정 짝 — 이름 매핑 자체는 살아 있다(전부 플레이스홀더라서 참인 게 아니다).
      expect(
        screen.getByTestId('itinerary-candidate-name-X')
      ).toHaveTextContent('남부산교회');
      expect(screen.queryByText(new RegExp(RAW_ID))).toBeNull();
    });

    it('H5 · AC-7·INV-3 — 후보 카드 텍스트에 소요시간 단위가 없다', async () => {
      await renderAndWaitCandidates();

      for (const id of ALL_IDS) {
        expect(
          screen.getByTestId(`itinerary-candidate-${id}`)
        ).not.toHaveTextContent(DURATION);
      }
      // 긍정 짝 — 카드 텍스트를 실제로 읽고 있다.
      expect(screen.getByTestId('itinerary-candidate-X')).toHaveTextContent(
        /남부산교회/
      );
    });
  });
});

// TRIP-1245
describe('선표시 — 생성 때 받은 차선책', () => {
  /**
   * 시트를 열면 POST 응답을 기다리는 동안 그 슬롯의 `alternatives`(GET 응답, 최대 2건)를 기존 후보
   * 행 모양으로 먼저 그리고, POST 가 오면 그 목록으로 **교체**한다.
   *
   * 무엇을 보장하나:
   *  - 첫 렌더(요청 전)부터 선표시 행이 보이고 스켈레톤·0건 얼굴은 없다.
   *  - POST 가 오면 행 집합 = 응답(선표시 중 응답 밖의 것은 사라진다 — 병합 금지).
   *  - 선표시 중 고른 행이 응답에 있으면 선택 유지, 없으면 해제.
   *  - 응답 전(loading·slow)엔 교체하기 비활성·PUT 0. 확정은 POST 행으로만.
   *  - POST 실패·0건은 현행 실패 얼굴·0건 얼굴 그대로(선표시로 덮지 않는다 · INV-4).
   *  - 선표시 행도 이름 null → 플레이스홀더, 거리 null → 빈 칸, 소요시간 없음(INV-1·3).
   *
   * 실제 앱은 초안 화면이 GET 을 받아 둔 뒤 시트를 연다 — 그래서 GET 캐시를 렌더 전에 채운다.
   *
   * 3동작 뼈대: 준비=GET 캐시·POST 응답 계획 → 실행=시트 열기·행 탭·응답 풀기 → 단언=보이는 행·나간 요청.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '11111111-1111-1111-1111-111111111111';
  const DAY1 = '2026-06-10';
  const SLOT_KEY = buildSlotKey(DAY1, 'a');

  const FALLBACK = '지금은 바꿀 수 없어요. 잠시 후 다시 시도해 주세요';
  const EMPTY_TITLE = '이 슬롯에 맞는 다른 후보가 없어요';
  const P_IMG = 'https://img.example/p.jpg';
  /** 정본에 이름이 없는 선표시 항목 — poiId 원문이 새면 바로 보이도록 튀는 id. */
  const RAW_ALT = 'poi-raw-alt-5566';
  /** 소요시간 단위(INV-3). '도보 추정'은 단위가 아니다. */
  const DURATION = /분|시간|\bmin\b|소요/;
  const RADIO_ROWS = /^itinerary-candidate-radio-/;
  const SKELETON_ROW = 'itinerary-candidate-skeleton-row';

  const ID = {
    empty: 'itinerary-candidate-empty',
    emptySearch: 'itinerary-candidate-empty-search',
    fetchError: 'itinerary-candidate-fetch-error',
    retry: 'itinerary-candidate-fetch-retry',
    confirm: 'itinerary-candidate-confirm',
    putError: 'itinerary-candidate-error',
  } as const;

  /** 생성 때 AI 가 준 차선책 2건(서버 거리 문구 모양 그대로). */
  const ALTS: ItineraryDaysItemSlotsItemAlternativesItem[] = [
    {
      poiId: 'P',
      rationale: '야경이 좋은 전망대',
      distanceRange: '약 1.2km · 도보 추정',
      nameKo: '남산서울타워',
      category: '문화',
      tags: ['전망대', '야경'],
      imageUrl: P_IMG,
    },
    {
      poiId: 'Q',
      rationale: '조용한 한옥 골목',
      distanceRange: '약 2.4km · 도보 추정',
      nameKo: '북촌한옥마을',
      category: '문화',
      tags: ['한옥'],
      imageUrl: null,
    },
  ];

  /** POST 교체 목록 — P 가 없고 Q 의 거리 문구가 다르다. */
  const SWAP: SlotCandidates = {
    candidates: [
      {
        poiId: 'Q',
        distanceRange: '약 0.9km',
        rationale: '주변 문화',
        nameKo: '북촌한옥마을',
        tags: ['한옥'],
        imageUrl: null,
      },
      {
        poiId: 'Z',
        distanceRange: '약 1.5km',
        rationale: '주변 문화',
        nameKo: '국립현대미술관',
        tags: ['미술관'],
        imageUrl: null,
      },
      {
        poiId: 'W',
        distanceRange: '약 2.0km',
        rationale: '주변 문화',
        nameKo: '덕수궁',
        tags: ['궁궐'],
        imageUrl: null,
      },
    ],
    radiusMUsed: 2000,
    degraded: false,
  };

  let alternatives: ItineraryDaysItemSlotsItemAlternativesItem[] = ALTS;

  function itinerary(): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [
        {
          date: DAY1,
          slots: [
            {
              poiId: 'a',
              nameKo: '경복궁',
              startAt: '09:30:00',
              endAt: '11:00:00',
              category: '문화',
              isFixed: false,
              endsNextDay: false,
              hasViolation: false,
              alternatives,
              tags: [],
            },
          ],
        },
      ],
    };
  }

  /**
   * POST 호출 순번별 응답 계획. `hang` = 영원히 응답 안 함, `gate` = `releaseGate()` 까지 기다렸다가
   * SWAP, `swap` = 곧장 SWAP, `empty` = 0건(NO_NEARBY), 숫자 = 그 상태코드.
   */
  type PostStep = 'hang' | 'gate' | 'swap' | 'empty' | 500;

  let postPlan: PostStep[] = [];
  let postBodies: unknown[] = [];
  let releaseGate: () => void = () => undefined;
  let getCalls = 0;
  let putCalls = 0;
  let putBody: unknown = null;
  const mockClose = jest.fn();

  async function respond(step: PostStep): Promise<Response> {
    switch (step) {
      case 'hang':
        await delay('infinite');
        return HttpResponse.json(SWAP);
      case 'gate':
        await new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        return HttpResponse.json(SWAP);
      case 'swap':
        return HttpResponse.json(SWAP);
      case 'empty':
        return HttpResponse.json({
          candidates: [],
          radiusMUsed: 3000,
          degraded: false,
          emptyReason: 'NO_NEARBY',
        });
      default:
        return new HttpResponse(null, { status: step });
    }
  }

  beforeEach(() => {
    alternatives = ALTS;
    postPlan = [];
    postBodies = [];
    releaseGate = () => undefined;
    getCalls = 0;
    putCalls = 0;
    putBody = null;
    mockClose.mockClear();
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () => {
        getCalls += 1;
        return HttpResponse.json(itinerary());
      }),
      http.post(
        `${BASE}/trips/:tripId/itinerary/slot-candidates`,
        async ({ request }) => {
          const step = postPlan[postBodies.length] ?? 'hang';
          postBodies.push(await request.json());
          return respond(step);
        }
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        putCalls += 1;
        putBody = await request.json();
        return HttpResponse.json(itinerary());
      })
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    server.resetHandlers();
    clearAccessToken();
  });

  /** GET 캐시를 채운 뒤(초안 화면이 이미 받아 둔 상태) 시트를 연다. */
  function renderWithItinerary() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    client.setQueryData(
      getGetTripsTripIdItineraryQueryKey(TRIP_ID),
      itinerary()
    );
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(
      <SlotCandidatePanelContainer
        tripId={TRIP_ID}
        slotKey={SLOT_KEY}
        onClose={mockClose}
      />,
      { wrapper: Wrapper }
    );
  }

  /** 지금 보이는 후보 행의 poiId(정렬). */
  function rowIds(): string[] {
    return screen
      .queryAllByTestId(RADIO_ROWS)
      .map((node) =>
        String(node.props.testID).replace('itinerary-candidate-radio-', '')
      )
      .sort();
  }

  function isSelected(poiId: string): boolean {
    return (
      screen.getByTestId(`itinerary-candidate-radio-${poiId}`).props
        .accessibilityState?.selected === true
    );
  }

  function isConfirmDisabled(): boolean {
    return screen.getByTestId(ID.confirm).props.accessibilityState.disabled;
  }

  async function release(): Promise<void> {
    await act(async () => {
      releaseGate();
    });
  }

  async function settleRealTime(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    });
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  describe('응답 전·도착', () => {
    it('P1 · AC-1 — 시트를 연 바로 그 렌더에 선표시 2행, 스켈레톤·0건 얼굴은 없다', async () => {
      postPlan = ['hang'];

      renderWithItinerary();

      // await 없이 곧장 본다 — 요청이 나가기 전 첫 프레임이다.
      expect(postBodies).toHaveLength(0);
      expect(rowIds()).toEqual(['P', 'Q']);
      expect(
        screen.getByTestId('itinerary-candidate-name-P')
      ).toHaveTextContent('남산서울타워');
      expect(
        screen.getByTestId('itinerary-candidate-tags-P')
      ).toHaveTextContent('#전망대 · 야경');
      expect(
        screen.getByTestId('itinerary-candidate-image-P').props.source
      ).toEqual({ uri: P_IMG });
      expect(
        screen.getByTestId('itinerary-candidate-distance-P')
      ).toHaveTextContent('약 1.2km · 도보 추정');
      // 추천 이유는 선표시에서도 숨긴다(h08 행 모양 그대로).
      expect(
        screen.queryByTestId('itinerary-candidate-rationale-P')
      ).toBeNull();
      expect(screen.queryByText('야경이 좋은 전망대')).toBeNull();

      expect(screen.queryAllByTestId(SKELETON_ROW)).toHaveLength(0);
      expect(screen.queryByTestId(ID.empty)).toBeNull();
      expect(screen.queryByTestId(ID.emptySearch)).toBeNull();
      expect(screen.queryByText(EMPTY_TITLE)).toBeNull();

      // 선표시가 있어도 후보 조회는 그대로 1회 나간다.
      await waitFor(() => expect(postBodies).toHaveLength(1));
      expect(Object.keys(postBodies[0] as object)).toEqual(['slotKey']);
    });

    it('P2 · AC-2 — POST 가 오면 행 집합은 정확히 응답이다(응답 밖 선표시 행은 사라진다)', async () => {
      postPlan = ['gate'];
      renderWithItinerary();
      expect(rowIds()).toEqual(['P', 'Q']);
      await waitFor(() => expect(postBodies).toHaveLength(1));

      await release();
      await screen.findByTestId('itinerary-candidate-radio-Z');

      expect(rowIds()).toEqual(['Q', 'W', 'Z']);
      expect(screen.queryByTestId('itinerary-candidate-radio-P')).toBeNull();
      expect(screen.queryByText('남산서울타워')).toBeNull();
      // 같은 Q 라도 값은 POST 것이다(합치지 않고 바꾼다).
      expect(
        screen.getByTestId('itinerary-candidate-distance-Q')
      ).toHaveTextContent('약 0.9km');
      expect(screen.queryAllByTestId(SKELETON_ROW)).toHaveLength(0);
    });
  });

  describe('선표시 중 선택', () => {
    it('P3 · AC-3 — 선표시 중 고른 Q 가 응답에 있으면 선택이 남고 교체하기가 켜진다', async () => {
      postPlan = ['gate'];
      renderWithItinerary();
      await waitFor(() => expect(postBodies).toHaveLength(1));

      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-Q'));
      // 응답 전에도 라디오는 고를 수 있다 — 다만 교체하기는 아직 꺼져 있다.
      expect(isSelected('Q')).toBe(true);
      expect(isConfirmDisabled()).toBe(true);

      await release();
      await screen.findByTestId('itinerary-candidate-radio-Z');

      expect(isSelected('Q')).toBe(true);
      expect(
        screen.getByTestId('itinerary-candidate-check-Q')
      ).toBeOnTheScreen();
      expect(isConfirmDisabled()).toBe(false);
    });

    it('P4 · AC-3 — 선표시 중 고른 P 가 응답에 없으면 선택이 풀리고 교체하기는 꺼진 채 PUT 0', async () => {
      postPlan = ['gate'];
      renderWithItinerary();
      await waitFor(() => expect(postBodies).toHaveLength(1));

      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-P'));
      expect(isSelected('P')).toBe(true);

      await release();
      await screen.findByTestId('itinerary-candidate-radio-Z');

      expect(screen.queryByTestId('itinerary-candidate-radio-P')).toBeNull();
      for (const id of rowIds()) {
        expect(isSelected(id)).toBe(false);
      }
      expect(
        screen.queryAllByTestId(/^itinerary-candidate-check-/)
      ).toHaveLength(0);
      expect(isConfirmDisabled()).toBe(true);

      fireEvent.press(screen.getByTestId(ID.confirm));
      await settleRealTime();
      expect(putCalls).toBe(0);
    });
  });

  describe('조회 실패·0건', () => {
    it('P5 · AC-4 — POST 실패면 현행 실패 얼굴, 0건으로 접지 않는다. [다시 시도]는 같은 바디로 1회, 다시 응답 전이면 선표시', async () => {
      postPlan = [500, 'hang'];
      renderWithItinerary();
      expect(rowIds()).toEqual(['P', 'Q']);

      const card = await screen.findByTestId(ID.fetchError);
      expect(within(card).getByText(FALLBACK)).toBeOnTheScreen();
      expect(screen.getByTestId(ID.retry)).toBeOnTheScreen();
      expect(screen.queryByTestId(ID.empty)).toBeNull();
      expect(screen.queryByTestId(ID.emptySearch)).toBeNull();
      expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
      expect(screen.queryByTestId(ID.confirm)).toBeNull();
      expect(screen.queryByTestId(ID.putError)).toBeNull();
      // 선표시는 응답 전에만 쓴다 — 실패 얼굴엔 행이 없다.
      expect(rowIds()).toEqual([]);

      fireEvent.press(screen.getByTestId(ID.retry));

      await waitFor(() => expect(postBodies).toHaveLength(2));
      expect(Object.keys(postBodies[1] as object)).toEqual(['slotKey']);
      expect((postBodies[1] as { slotKey: string }).slotKey).toBe(SLOT_KEY);
      await waitFor(() => expect(rowIds()).toEqual(['P', 'Q']));
      expect(screen.queryByTestId(ID.fetchError)).toBeNull();
      expect(screen.queryAllByTestId(SKELETON_ROW)).toHaveLength(0);
    });

    it('P6 · AC-6 — 선표시가 있어도 POST 가 0건이면 0건 얼굴, 선표시 행은 지운다', async () => {
      postPlan = ['empty'];
      renderWithItinerary();
      expect(rowIds()).toEqual(['P', 'Q']);

      await screen.findByTestId(ID.empty);

      expect(screen.getByTestId(ID.emptySearch)).toBeOnTheScreen();
      expect(
        screen.getByTestId('itinerary-candidate-empty-no-nearby')
      ).toBeOnTheScreen();
      expect(rowIds()).toEqual([]);
      expect(screen.queryAllByTestId(SKELETON_ROW)).toHaveLength(0);
      expect(screen.queryByTestId(ID.fetchError)).toBeNull();
    });
  });

  describe('응답 전 확정 금지·확정 경로', () => {
    it('P7 · AC-7 — 응답 전(loading)엔 선표시 행을 골라도 교체하기 비활성, PUT 0', async () => {
      postPlan = ['hang'];
      renderWithItinerary();
      await waitFor(() => expect(postBodies).toHaveLength(1));

      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-P'));
      expect(isSelected('P')).toBe(true);
      expect(isConfirmDisabled()).toBe(true);

      fireEvent.press(screen.getByTestId(ID.confirm));
      await settleRealTime();

      expect(putCalls).toBe(0);
      expect(mockClose).toHaveBeenCalledTimes(0);
    });

    it('P8 · AC-7 — 10초가 넘어도(slow) 선표시 행은 남고, 교체하기 비활성·PUT 0', async () => {
      postPlan = ['hang'];
      jest.useFakeTimers();
      renderWithItinerary();

      await advance(10_100);
      expect(rowIds()).toEqual(['P', 'Q']);

      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-P'));
      await advance(0);
      expect(isSelected('P')).toBe(true);
      expect(isConfirmDisabled()).toBe(true);

      fireEvent.press(screen.getByTestId(ID.confirm));
      await advance(50);

      expect(putCalls).toBe(0);
      expect(postBodies).toHaveLength(1);
    });

    it('P11 · 5-b 경고-1 — 10초가 넘으면(slow) 선표시 행 아래에 지연 안내와 [다시 시도]가 남는다(응답이 안 올 때 유일한 출구)', async () => {
      // 준비 — 선표시 있음 + POST 는 영영 안 옴 + 가짜 시계
      postPlan = ['hang'];
      jest.useFakeTimers();
      renderWithItinerary();

      // 실행 — 10초를 넘긴다(slow). C8 처럼 9.9초 뒤 0.2초로 나눠 흘린다(한 번에 넘기면 안 뜬다).
      await advance(9_900);
      expect(screen.queryByTestId('itinerary-candidate-slow')).toBeNull();
      await advance(200);

      // 단언 — 행은 남고, 새 얼굴 없이 기존 slow 줄과 [다시 시도]가 같이 보인다(스켈레톤만 빠짐)
      expect(rowIds()).toEqual(['P', 'Q']);
      expect(screen.getByTestId('itinerary-candidate-slow')).toBeOnTheScreen();
      expect(screen.getByText(/시간이 걸리고 있어요/)).toBeOnTheScreen();
      expect(
        screen.getByTestId('itinerary-candidate-fetch-retry')
      ).toBeOnTheScreen();
    });

    it('P9 · AC-8 — 선표시가 있던 시트에서도 POST 행 확정은 치환 PUT 1건 + 닫힘 + 재조회', async () => {
      postPlan = ['swap'];
      renderWithItinerary();
      await screen.findByTestId('itinerary-candidate-radio-Z');
      await waitFor(() => expect(getCalls).toBe(1));

      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-Z'));
      fireEvent.press(screen.getByTestId(ID.confirm));

      await waitFor(() => expect(putCalls).toBe(1));
      const body = putBody as EditItineraryRequest;
      expect(body.days[0].slots[0].poiId).toBe('Z');
      expect(Object.keys(body.days[0].slots[0]).sort()).toEqual(
        ['poiId', 'startAt', 'endAt', 'isFixed', 'endsNextDay'].sort()
      );
      await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(getCalls).toBe(2));
    });
  });

  describe('선표시 행의 INV-1·INV-3', () => {
    it('P10 · AC-9 — 이름 null 은 플레이스홀더(poiId 원문 없음), 거리 null 은 빈 칸, 소요시간 단위 없음', async () => {
      alternatives = [
        {
          poiId: RAW_ALT,
          rationale: '정본 이름 미확보',
          distanceRange: '약 2.0km · 도보 추정',
          nameKo: null,
          tags: [],
          imageUrl: null,
        },
        {
          poiId: 'N',
          rationale: '조용한 한옥 골목',
          distanceRange: null,
          nameKo: '북촌한옥마을',
          tags: ['한옥'],
          imageUrl: null,
        },
      ];
      postPlan = ['hang'];

      renderWithItinerary();

      expect(
        screen.getByTestId(`itinerary-candidate-name-${RAW_ALT}`)
      ).toHaveTextContent('이름 준비 중');
      expect(screen.queryByText(new RegExp(RAW_ALT))).toBeNull();
      expect(
        screen.getByTestId('itinerary-candidate-name-N')
      ).toHaveTextContent('북촌한옥마을');

      // 문자열 인자는 완전 일치 — '' 는 정말 빈 칸일 때만 통과한다.
      expect(
        screen.getByTestId('itinerary-candidate-distance-N')
      ).toHaveTextContent('');
      expect(
        screen.getByTestId(`itinerary-candidate-distance-${RAW_ALT}`)
      ).toHaveTextContent('약 2.0km · 도보 추정');

      for (const id of [RAW_ALT, 'N']) {
        expect(
          screen.getByTestId(`itinerary-candidate-${id}`)
        ).not.toHaveTextContent(DURATION);
      }
      expect(screen.getByTestId('itinerary-candidate-N')).toHaveTextContent(
        /북촌한옥마을/
      );

      await waitFor(() => expect(postBodies).toHaveLength(1));
    });
  });
});
