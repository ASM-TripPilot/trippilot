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
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  SlotCandidatesRequest,
  Trip,
  ItineraryDaysItemSlotsItem,
  SlotCandidates,
  SlotCandidatesCandidatesItem,
  TripDestination,
  ItineraryGenerationState,
} from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdQueryKey,
} from '@/shared/api/generated/trips/trips';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { DRAFT_POLL_INTERVAL_MS } from '@/features/itinerary/model/draftView';

import { SlotFillPage } from './SlotFillPage';

/**
 * h13~h15 같이 짜기 슬롯 채우기(SlotFillPage) — **실 훅 + MSW** 통합 테스트(TRIP-1150 에서 일곱 파일을
 * 한 파일로 합쳤다).
 *
 * 옛 파일 하나 = 바깥 describe 하나다. 안쪽 describe·it 이름과 각 파일의 픽스처·기본 MSW 핸들러
 * (describe 의 beforeEach)는 그대로다. 3000줄이 넘어도 쪼개지 않는다(README 판정 4 · 배치 결정).
 *
 * 합치며 바뀐 장치(02a ★): 서버 listen/close 는 최상위 한 번. 라우터 목은 `push`·`back`·`replace` 를 모두
 * 기록한다(옛 파일 중 셋은 렌더마다 새 jest.fn 이었다 — 메서드는 다 있었으니 그물이 줄지 않는다).
 * 지도 관찰 목(`mapViewMock`)은 옛 `.context` 에만 있었는데 이제 파일 전체에 걸린다 — 다른 관점의 픽스처는
 * 좌표가 없어 지도가 안 그려지고, 옛 본 파일 I-DEGRADE 의 `map-root` 부재 단언은 이 목이 있어야 의미를 갖는다.
 *
 * 3동작 뼈대: 준비 = MSW 핸들러·토큰 → 실행 = 슬롯 화면 열기·컨셉/후보/확정 press → 단언 = 보이는 것·나간 요청·이동.
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

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외.
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
}));

// 지도는 관찰 목으로 바꾼다 — center 는 텍스트로, 나머지 prop 은 host 로 그대로 노출된다(옛 `.context` 02a ★6).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
});

afterAll(() => server.close());

// TRIP-504 · 옛 SlotFillPage.integration.test.tsx(본 파일)
describe('컨셉·후보·확정 순회 배선', () => {
  /**
   * h13→h14/h15 슬롯 채우기 배선 — 슬라이스1 코어(POST 후보 → swapSlotPoi 치환 → PUT 전체교체)를
   * 컨셉/반경 앞단과 잇는다. 찬 슬롯 "변경" 경로로 잰다(빈 슬롯 스켈레톤은 계약 미결 · 코드 경로 동일).
   *
   * 무엇을 보장하나:
   *  - AC-1: 후보 조회는 usePostTripsTripIdItinerarySlotCandidates(slotKey+concept+radiusM)만.
   *  - AC-2: 컨셉 라벨이 concept 로 실림 · 스킵=concept 미전송(undefined).
   *  - AC-7(TRIP-504): 라디오 → "A로 선택" → swapSlotPoi+PUT 1건 → 성공 시 **다음 비고정 슬롯으로
   *    replace**(다음 없으면 h17 complete). 구 `router.back()`(허브 복귀)은 폐기 — 선형 순회.
   *  - AC-4: 반경 max → radiusM=null 재요청 · 서버 radiusMUsed → 화면 포맷 표시.
   *  - AC-5: 후보 0건 → 반경확대(재조회)·컨셉변경(h13 복귀) CTA 배선.
   *  - AC-8: 저장 실패 인라인(resolveSlotSwapError).
   *  - E1: 콜드캐시 가드(GET 미도착 중 확정 → PUT 0). firedRef: 같은 틱 연타 → PUT 1.
   *
   * 3동작: 준비=MSW 응답 → 실행=컨셉·반경·라디오·확정 → 단언=나간 요청 바디·이동.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '22222222-2222-2222-2222-222222222222';

  // TRIP-1043 — 페이지가 진행 줄 여행지 접두를 위해 여행(`GET /trips/:tripId`)을 조회한다. 이 파일은 접두를
  // 재지 않으므로 여행지 없는 여행으로 답한다(접두 생략 degrade — 기존 `N일차` 단언이 그대로 유효). 핸들러를
  // 빼면 MSW 'error' 전략이 console.error 만 찍고 쿼리를 조용히 실패시켜 누락이 드러나지 않는다(02a ★1).
  const TRIP_NO_DESTINATIONS: Trip = {
    tripId: TRIP_ID,
    title: '테스트 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-11',
    party: 1,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 1,
  };
  const DAY1 = '2026-06-10';
  const SLOT_KEY = buildSlotKey(DAY1, 'a');

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
    ];
    return {
      itineraryId: 'itin-2',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'CO_PLAN',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  // 테스트별로 바꿔 끼우는 후보 응답(핸들러 클로저가 요청 시점에 읽는다).
  let candidatesResponse: {
    candidates: { poiId: string; distanceRange: string; rationale: string }[];
    radiusMUsed: number;
  };
  let postCalls = 0;
  let postBody: SlotCandidatesRequest | null = null;
  let putCalls = 0;
  let putBody: unknown = null;

  beforeEach(() => {
    postCalls = 0;
    postBody = null;
    putCalls = 0;
    putBody = null;
    mockBack.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
    candidatesResponse = {
      candidates: [
        {
          poiId: 'X',
          distanceRange: '420m',
          rationale: '가장 가까운 실내 전시',
        },
        { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
      ],
      radiusMUsed: 11300,
    };
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(TRIP_NO_DESTINATIONS)
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      http.post(
        `${BASE}/trips/:tripId/itinerary/slot-candidates`,
        async ({ request }) => {
          postCalls += 1;
          postBody = (await request.json()) as SlotCandidatesRequest;
          return HttpResponse.json(candidatesResponse);
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
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage(slotKey: string = SLOT_KEY) {
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
    return render(<SlotFillPage tripId={TRIP_ID} slotKey={slotKey} />, {
      wrapper: Wrapper,
    });
  }

  async function pickConcept(key = 'culture') {
    await screen.findByTestId(`itinerary-copick-concept-${key}`);
    fireEvent.press(screen.getByTestId(`itinerary-copick-concept-${key}`));
  }

  describe('🔴 SlotFillPage (h13→h14/h15) 배선', () => {
    it('C1 · 마운트=컨셉 화면, 조회 POST 는 아직 0', async () => {
      renderPage();

      await screen.findByTestId('itinerary-copick-concept-root');
      expect(postCalls).toBe(0);
    });

    it('C2 · AC-1·AC-2 컨셉 탭 → slot-candidates POST 1건 · 바디에 slotKey·concept·radiusM', async () => {
      renderPage();
      await pickConcept('culture');

      await waitFor(() => expect(postCalls).toBe(1));
      expect(postBody?.slotKey).toBe(SLOT_KEY);
      expect(postBody?.concept).toBe('전시·문화');
      expect(postBody?.radiusM).toBe(1100); // 기본 mid 단계
    });

    it('C3 · AC-2 스킵 → concept 미전송(undefined)', async () => {
      renderPage();
      await screen.findByTestId('itinerary-copick-concept-skip');
      fireEvent.press(screen.getByTestId('itinerary-copick-concept-skip'));

      await waitFor(() => expect(postCalls).toBe(1));
      expect(postBody?.concept).toBeUndefined();
      expect(postBody?.radiusM).toBe(1100);
    });

    it('C4 · AC-1·INV-1 렌더 후보 집합 = 응답 poiId 집합', async () => {
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');

      const poiIds = screen
        .getAllByTestId(
          /^itinerary-candidate-(?!radio-|name-|image-|distance-|rationale-|current$|select-)/
        )
        .map((node) => node.props.testID.replace('itinerary-candidate-', ''))
        .sort();
      expect(poiIds).toEqual(['X', 'Y']);
    });

    it('C5 · AC-7 라디오 → "A로 선택" → PUT 1건(a→X) → 다음 비고정 슬롯으로 replace(허브 복귀 폐기)', async () => {
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');

      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

      await waitFor(() => expect(putCalls).toBe(1));
      // 같은 치환 = swapSlotPoi 코어 재사용(BR-U3-23, 무변경).
      expect((putBody as EditItineraryRequest).days[0].slots[0].poiId).toBe(
        'X'
      );

      // ★ 확정 성공 = 허브로 back 이 아니라 **다음 비고정 슬롯**으로 replace(선형 전진, 01b 순회 세부).
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      const destination = mockReplace.mock.calls[0][0] as unknown;
      const asText =
        typeof destination === 'string'
          ? destination
          : JSON.stringify(destination);
      expect(asText).toContain('copick');
      // ★ 다음 비고정 슬롯 키(d1#b)가 목적지에 실려야 한다 — 허브(slotKey 없음)로 새면 red.
      expect(asText).toContain(buildSlotKey(DAY1, 'b'));
      // ★ 허브 복귀(router.back)는 폐기됐다.
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('C12 · AC-7 마지막 비고정 슬롯 확정 → 다음이 없으면 h17(complete)로 replace', async () => {
      // 마지막 비고정 슬롯(d1#b)에서 진입 — 뒤에 비고정이 없다.
      renderPage(buildSlotKey(DAY1, 'b'));
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');

      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

      await waitFor(() => expect(putCalls).toBe(1));

      // ★ 다음 비고정 슬롯이 없으면 h17 완성 확인(copick/complete)으로.
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      const destination = mockReplace.mock.calls[0][0] as unknown;
      const asText =
        typeof destination === 'string'
          ? destination
          : JSON.stringify(destination);
      expect(asText).toContain('complete');
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('C6 · AC-4 반경 max → radiusM=null 재요청', async () => {
      renderPage();
      await pickConcept('culture');
      await waitFor(() => expect(postCalls).toBe(1));

      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-max'));

      await waitFor(() => expect(postCalls).toBe(2));
      expect(postBody?.radiusM).toBeNull(); // 3단째 = 명시적 null
    });

    it('C7 · AC-4 서버 radiusMUsed(11300) → 캡션이 "약 11.3km"를 넣어 넓힌 사실을 말한다', async () => {
      renderPage();
      await pickConcept('culture');

      // TRIP-1081 결정 1 — 문자열 매처는 완전 일치다(02a §5-1).
      const used = await screen.findByTestId('itinerary-copick-radius-used');
      expect(used).toHaveTextContent('1.1km 안에 없어 약 11.3km까지 넓혔어요');
    });

    it('C8 · AC-5 후보 0건 → 반경확대(재조회)·컨셉변경(h13 복귀) 배선', async () => {
      candidatesResponse = { candidates: [], radiusMUsed: 1100 };
      renderPage();
      await pickConcept('culture');
      await waitFor(() => expect(postCalls).toBe(1));

      // 반경 확대 → 다음 단으로 재조회.
      fireEvent.press(
        await screen.findByTestId('itinerary-copick-zero-radius')
      );
      await waitFor(() => expect(postCalls).toBe(2));

      // 컨셉 변경 → h13 컨셉 화면 복귀.
      fireEvent.press(screen.getByTestId('itinerary-copick-zero-concept'));
      await screen.findByTestId('itinerary-copick-concept-root');
    });

    it('C9 · E1 콜드캐시 가드 — GET 미도착 중 확정 → PUT 0(빈 days 전체교체 방지)', async () => {
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
          await delay('infinite');
          return HttpResponse.json(itinerary());
        })
      );
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X'); // POST 는 도착

      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

      await waitFor(() => expect(postCalls).toBe(1));
      expect(putCalls).toBe(0);
      // 가드가 막았으니 어느 이동도 없다(전진 replace 도, 구 back 도 0).
      expect(mockReplace).toHaveBeenCalledTimes(0);
      expect(mockBack).toHaveBeenCalledTimes(0);
    });

    it('C14 · TRIP-601 가드 b — generationState=PARTIAL 이면 확정 PUT 0(생성 중 전체교체 차단)', async () => {
      // 준비 — GET 이 PARTIAL(day1 도착, 뒷날 생성 중)로 정착한다. day1 data 는 있으므로 콜드캐시(C9)와
      // 달리 throw 가 안 나고, 가드가 없으면 확정이 그대로 day1-only 전체교체 PUT 을 쏜다(★b-2).
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json({ ...itinerary(), generationState: 'PARTIAL' })
        )
      );
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');

      // 실행 — 라디오 선택 후 확정. 후보 조회(POST)는 정상 진행, 막는 건 확정(PUT)뿐이다.
      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
      await waitFor(() => expect(postCalls).toBe(1));
      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

      // ★b-1 통과형 목 함정 회피 — 확정을 눌러 PUT 이 나갔다면 이 대기 동안 MSW 핸들러가 putCalls 를
      // 올린다. "안 나갔다"를 거짓 green 없이 잠그려면 나갈 시간을 실제로 줘야 한다(콜드캐시 C9 는 mutate
      // 자체가 호출조차 안 돼 이 대기가 불필요했다 — PARTIAL 은 호출 경로가 살아 있어 다르다).
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      // ★ PARTIAL 이면 day1-only 전체교체 PUT 이 나가면 안 된다(서버 409 의 클라 사본, 심층 방어).
      expect(putCalls).toBe(0);
      // 막혔으니 전진(성공 콜백의 replace)도 없다.
      expect(mockReplace).toHaveBeenCalledTimes(0);
      expect(mockBack).toHaveBeenCalledTimes(0);
    });

    it('C10 · firedRef — 같은 틱 확정 2회 연타여도 PUT 1건', async () => {
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');

      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
      const confirm = await screen.findByTestId(
        'itinerary-copick-slotfill-confirm'
      );
      await waitFor(() =>
        expect(confirm.props.accessibilityState?.disabled).not.toBe(true)
      );

      act(() => {
        fireEvent.press(confirm);
        fireEvent.press(confirm);
      });

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(putCalls).toBe(1);
    });

    it('C11 · AC-8 저장 실패 → 인라인 오류 · 이동 0', async () => {
      server.use(
        http.put(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json(
            { error: { code: 'X', message: 'x' } },
            { status: 500 }
          )
        )
      );
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');

      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

      await screen.findByTestId('itinerary-copick-slotfill-error');
      // 실패는 이동이 없다(전진 replace 도, 구 back 도 0).
      expect(mockReplace).toHaveBeenCalledTimes(0);
      expect(mockBack).toHaveBeenCalledTimes(0);
    });

    it('C13 · AC-7·경고-1 — 순차 확정: a→X 확정 뒤 b 확정 시 PUT 바디에 앞선 X 가 보존된다(캐시 무효화)', async () => {
      // 서버 진실을 쥔 stateful 핸들러 — GET 은 마지막 PUT 을 반영한다(실서버 동형). 두 슬롯을 이어
      // 확정하는 순회에서 "다음 SlotFillPage 가 최신 days 를 읽는가"를 재려면 GET 이 앞 확정을 반영해야
      // 하고, 그러려면 확정 성공(onSuccess)이 GET 캐시를 무효화(재조회)해야 한다.
      let serverDays = itinerary().days; // [a, b] 로 시작.
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json({ ...itinerary(), days: serverDays })
        ),
        http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
          putCalls += 1;
          const body = (await request.json()) as EditItineraryRequest;
          putBody = body;
          // PUT 바디(5필드만)의 poiId 들을 원본 풀 슬롯에 얹어, 다음 GET 이 갱신된 days 를 돌려주게 한다.
          serverDays = itinerary().days.map((day, di) => ({
            ...day,
            slots: day.slots.map((slot, si) => ({
              ...slot,
              poiId: body.days[di].slots[si].poiId,
            })),
          }));
          return HttpResponse.json({ ...itinerary(), days: serverDays });
        })
      );

      // staleTime: Infinity 로 **refetch-on-mount 를 끈다** — 그러면 캐시를 최신으로 만드는 유일한 힘이
      // onSuccess 의 무효화뿐이라 그 효과만 격리해 잰다(안 끄면 다음 화면 마운트가 알아서 재조회해 무효화가
      // 없어도 통과 → 회귀를 못 잡는다). gcTime: Infinity 는 첫 화면이 언마운트돼도 stale 캐시가 살아남게
      // 해 실서비스 remount 상황을 재현한다.
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
          mutations: { gcTime: 0 },
        },
      });
      function Wrapper({ children }: { children: ReactNode }) {
        return (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
      }

      // 1) slot a 진입 → a 를 X 로 확정.
      const first = render(
        <SlotFillPage tripId={TRIP_ID} slotKey={SLOT_KEY} />,
        {
          wrapper: Wrapper,
        }
      );
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');
      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

      await waitFor(() => expect(putCalls).toBe(1));
      // 무효화가 재조회를 태워 GET 캐시가 [X, b] 로 수렴할 때까지 기다린다 — 무효화가 없으면 캐시가
      // stale [a, b] 로 남아 이 첫 슬롯 poiId 가 영영 'a' 라 여기서 멈춘다(회귀 잡힘).
      await waitFor(() =>
        expect(
          (
            client.getQueryData(getGetTripsTripIdItineraryQueryKey(TRIP_ID)) as
              Itinerary | undefined
          )?.days[0].slots[0].poiId
        ).toBe('X')
      );
      first.unmount();

      // 2) 다음 슬롯(b)로 전진 — 라우터는 목이라 직접 재렌더로 remount 를 흉내(같은 client = 캐시 공유).
      render(
        <SlotFillPage tripId={TRIP_ID} slotKey={buildSlotKey(DAY1, 'b')} />,
        {
          wrapper: Wrapper,
        }
      );
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-Y');
      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-Y'));
      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

      await waitFor(() => expect(putCalls).toBe(2));
      // ★ 둘째 PUT 바디에 앞서 확정한 X 가 살아 있어야 한다 — 무효화가 없으면 다음 화면이 stale [a, b]
      // 를 읽어 slot a 가 X→a 로 되돌아간다(경고-1 데이터 손실). slot b 는 이번에 고른 Y.
      const second = putBody as EditItineraryRequest;
      expect(second.days[0].slots[0].poiId).toBe('X');
      expect(second.days[0].slots[1].poiId).toBe('Y');
    });
  });

  /**
   * U3 소급 백필(20260824) · h13 문맥 줄 도출 회귀 심판. TRIP-1043(QA #041)로 문구가 "{시간대} 일정 ·
   * {직전 이름} 다음"이 됐다 — 내부 용어 「슬롯」을 화면에서 뺀다(결정 1b).
   *
   * 무엇을 보장하나: 커밋 7cda1f5(발표용 domo, 사이클 없이 들어옴)가 문맥 줄을
   * prop 이 아니라 SlotFillPage 안 `slotContextLabel()` 로 **도출**하도록 바꿨는데
   * 심판이 0이었다. 이 도출은 채울 슬롯의 `startAt`(→timeBandLabel)과 그 **직전** 슬롯 이름을
   * itinerary GET 캐시(위 fixture)에서 읽는다. 직전 슬롯이 없으면(첫 슬롯) "· 다음" 구간을 접는다.
   *
   * fixture: day1 = [a 경복궁 09:30(오전), b (이름 없음) 13:00(점심)]. timeBandLabel 경계는
   * 05:00·11:00·14:00·17:00(동결).
   */
  describe('U3 · h13 문맥 줄 도출 (slotContextLabel)', () => {
    it('첫 슬롯(a·09:30·직전 없음) → "오전 일정"만이고 "…다음"은 없다', async () => {
      renderPage(SLOT_KEY); // slot a — index 0, 직전 없음

      // itinerary GET 도착 후 문맥 줄이 뜬다(async).
      expect(await screen.findByText('오전 일정')).toBeTruthy();
      // 직전이 없으므로 "…다음" 꼬리는 붙지 않는다.
      expect(screen.queryByText(/다음$/)).toBeNull();
    });

    it('둘째 슬롯(b·13:00·직전 경복궁) → "점심 일정 · 경복궁 다음"', async () => {
      renderPage(buildSlotKey(DAY1, 'b')); // slot b — index 1, 직전 = a(경복궁)

      expect(await screen.findByText('점심 일정 · 경복궁 다음')).toBeTruthy();
    });
  });

  /**
   * TRIP-795 · h10 후보 선택 배선 — 진행줄·스텝퍼(h09 헬퍼 재사용)를 후보 얼굴(SlotFillScreen)에도
   * 내리고, 반경 좁히기(신규 onShrinkRadius)를 잇고, 좌표 없는 프로덕션에선 지도를 안 그린다(degrade).
   *
   * fixture: day1 비고정 [a 경복궁, b]. slot a = index 0(스텝퍼 없음), slot b = index 1(스텝퍼 있음).
   */
  describe('🔴 TRIP-795 · h10 진행줄·스텝퍼·반경 좁히기·좌표 degrade 배선', () => {
    it('I-PROG · 후보 얼굴에 진행줄(신규 namespace)이 뜨고 카운트가 1번째 / 2', async () => {
      renderPage(SLOT_KEY); // slot a — index 0, nonFixed [a,b]
      await pickConcept('culture');

      expect(
        await screen.findByTestId('itinerary-copick-slotfill-progress')
      ).toBeTruthy();
      expect(
        screen.getByTestId('itinerary-copick-slotfill-progress-count')
      ).toHaveTextContent('1번째 / 2');
    });

    it('I-STEP · 둘째 슬롯(index 1)엔 스텝퍼가 뜨고, 첫 슬롯(index 0)엔 안 뜬다', async () => {
      // 둘째 슬롯 — 이전(경복궁 고름)이 있어 스텝퍼를 그린다(conceptStepper 재사용).
      renderPage(buildSlotKey(DAY1, 'b'));
      await pickConcept('culture');
      expect(await screen.findByTestId('copick-stepper')).toBeTruthy();

      // 첫 슬롯 — 이전이 없어 conceptStepper()가 undefined → 스텝퍼 미렌더(h09 승계).
      screen.unmount();
      renderPage(SLOT_KEY);
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X'); // 후보 얼굴 도착
      expect(screen.queryByTestId('copick-stepper')).toBeNull();
    });

    it('I-SHRINK · 마지막 단계에서 반경 좁히기 → 한 단계 뒤(mid·1100m)로 재조회', async () => {
      renderPage();
      await pickConcept('culture');
      await waitFor(() => expect(postCalls).toBe(1));

      // 반경 max 로 올린다(radiusM=null) → 마지막 단계라 결과 얼굴에 "반경 좁히기" 상시 노출.
      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-max'));
      await waitFor(() => expect(postCalls).toBe(2));
      expect(postBody?.radiusM).toBeNull();

      const radiusBtn = screen.getByTestId('itinerary-copick-slotfill-radius');
      expect(radiusBtn).toHaveTextContent('반경 좁히기');

      // 좁히기 → 한 단계 뒤(mid) 반경으로 재조회.
      fireEvent.press(radiusBtn);
      await waitFor(() => expect(postCalls).toBe(3));
      expect(postBody?.radiusM).toBe(1100);
    });

    it('I-DEGRADE · 현재 슬롯에 좌표가 없으면 지도 카드를 안 그린다(선제 green)', async () => {
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');

      // TRIP-1043 — 지도 기준점은 현재 슬롯 좌표다. 이 픽스처 슬롯엔 lat/lng 가 없어 지도를 안 그린다
      // (0,0·서울 폴백 금지). 좌표가 있을 때의 지도는 「진행 줄 여행지 접두·지도」 describe B1~B4.
      expect(screen.queryByTestId('map-root')).toBeNull();
    });
  });

  /**
   * TRIP-978 · 반경 라벨 — 셋째 칸과 캡션을 무엇으로 채울지는 **요청 radiusM × 응답 radiusMUsed** 로
   * 페이지가 가른다(BR-U3-25 · Seed Q3·Q6).
   *
   * 무엇을 보장하나:
   *  - AC-8: mid 조회에 서버가 1100 을 그대로 썼으면 셋째 칸은 '최대', 캡션 없음 — "1.1km" 는 가운데 칸 하나뿐.
   *  - AC-9: 최대(radiusM=null) 조회면 셋째 칸이 서버값, 캡션 없음. 좁히기로 돌아오면 다시 '최대'(Q6).
   *  - AC-10: mid 조회를 서버가 넓혔으면(radiusMUsed > radiusM) 셋째 칸은 '최대', 넓힌 사실은 캡션이 말한다.
   */
  describe('🔴 TRIP-978 · 반경 셋째 칸·캡션 라벨', () => {
    it('R-MID · AC-8 기본 반경(1.1km)을 서버가 그대로 썼으면 셋째 칸은 "최대"이고 "1.1km" 는 한 번만 보인다', async () => {
      // 기본 후보 Y 의 거리 '1.1km' 가 세기를 흐리지 않게 거리를 바꾼다.
      candidatesResponse = {
        candidates: [
          {
            poiId: 'X',
            distanceRange: '420m',
            rationale: '가장 가까운 실내 전시',
          },
          { poiId: 'Y', distanceRange: '770m', rationale: '조용한 카페' },
        ],
        radiusMUsed: 1100,
      };
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');

      expect(
        screen.getByTestId('itinerary-copick-radius-seg-max')
      ).toHaveTextContent('최대');
      expect(screen.queryByTestId('itinerary-copick-radius-used')).toBeNull();
      expect(screen.queryAllByText(/1\.1km/)).toHaveLength(1);
    });

    it('R-MAX · AC-9 "최대"로 조회하면 셋째 칸이 서버값이고 캡션은 없다 → 좁히기로 돌아오면 다시 "최대"', async () => {
      // 요청 radiusM 에 따라 서버가 쓴 반경을 돌려준다 — null(최대)=11300·후보 W, 숫자=그 값·후보 X·Y.
      // 응답마다 후보를 달리해, 그 응답이 화면에 반영된 뒤에 라벨을 읽는다(조회 중 라벨로 판정 금지).
      server.use(
        http.post(
          `${BASE}/trips/:tripId/itinerary/slot-candidates`,
          async ({ request }) => {
            postCalls += 1;
            postBody = (await request.json()) as SlotCandidatesRequest;
            const radiusM = postBody.radiusM ?? null;
            return HttpResponse.json(
              radiusM === null
                ? {
                    candidates: [
                      {
                        poiId: 'W',
                        distanceRange: '2.4km',
                        rationale: '넓힌 곳',
                      },
                    ],
                    radiusMUsed: 11300,
                  }
                : {
                    candidates: candidatesResponse.candidates,
                    radiusMUsed: radiusM,
                  }
            );
          }
        )
      );
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');

      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-max'));
      await screen.findByTestId('itinerary-candidate-radio-W');
      expect(postBody?.radiusM).toBeNull();
      expect(
        screen.getByTestId('itinerary-copick-radius-seg-max')
      ).toHaveTextContent('약 11.3km');
      expect(screen.queryByTestId('itinerary-copick-radius-used')).toBeNull();

      // 좁히기 → mid(1100) 재조회 → 셋째 칸은 다시 '최대'(마지막 최대값을 기억하지 않는다, Q6).
      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-radius'));
      await screen.findByTestId('itinerary-candidate-radio-X');
      expect(postCalls).toBe(3);
      expect(postBody?.radiusM).toBe(1100);
      expect(
        screen.getByTestId('itinerary-copick-radius-seg-max')
      ).toHaveTextContent('최대');
    });

    it('R-AUTO · AC-10 mid 조회를 서버가 11.3km 로 넓혔으면 셋째 칸은 "최대"이고 캡션이 넓힌 사실을 말한다', async () => {
      // 기본 candidatesResponse.radiusMUsed = 11300 — mid(1100) 요청보다 크다(서버 자동 확대).
      renderPage();
      await pickConcept('culture');

      const used = await screen.findByTestId('itinerary-copick-radius-used');
      expect(used).toHaveTextContent('1.1km 안에 없어 약 11.3km까지 넓혔어요');
      expect(
        screen.getByTestId('itinerary-copick-radius-seg-max')
      ).toHaveTextContent('최대');
    });
  });

  /**
   * TRIP-1081 결정 1(a) · QA #067 — 서버가 요청 반경을 넓혔을 때 칩은 사용자가 고른 그대로 두고, 캡션이
   * "요청 반경 안에 없어 서버 반경까지 넓혔다"는 사실을 말한다(BR-U3-25 · INV-2 서버 값 그대로).
   */
  describe('🔴 TRIP-1081 · 서버가 넓힌 반경 캡션 문구', () => {
    it('R-WIDEN12 · 1.1km 요청을 12km 로 넓혔으면 가운데 칩은 선택 그대로, 캡션은 사실 문장', async () => {
      candidatesResponse = { ...candidatesResponse, radiusMUsed: 12000 };
      renderPage();
      await pickConcept('culture');

      const used = await screen.findByTestId('itinerary-copick-radius-used');
      expect(used).toHaveTextContent('1.1km 안에 없어 약 12.0km까지 넓혔어요');
      // 칩이 서버 반경 쪽으로 옮겨가지 않는다 — 사용자가 고른 1.1km 가 선택 상태.
      expect(
        screen.getByTestId('itinerary-copick-radius-seg-mid').props
          .accessibilityState?.selected
      ).toBe(true);
      expect(
        screen.getByTestId('itinerary-copick-radius-seg-max')
      ).toHaveTextContent('최대');
    });

    it('R-WIDEN-NEAR · 700m 요청을 1.5km 로 넓혔으면 캡션 앞머리도 요청 반경 "700m" 다', async () => {
      candidatesResponse = { ...candidatesResponse, radiusMUsed: 1500 };
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-copick-radius-used');

      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));

      // 요청 반경 쪽도 포맷한다 — '1.1km' 를 박아 둔 구현이면 red(02a ★10).
      await waitFor(() =>
        expect(
          screen.getByTestId('itinerary-copick-radius-used')
        ).toHaveTextContent('700m 안에 없어 약 1.5km까지 넓혔어요')
      );
      expect(postBody?.radiusM).toBe(700);
    });
  });
});

// TRIP-1043 · 옛 SlotFillPage.context.integration.test.tsx
describe('진행 줄 여행지 접두·지도', () => {
  /**
   * TRIP-1043 · 같이 짜기(h09 컨셉 · h10 후보) — 여행지 맥락 · 「슬롯」 제거 · 후보 화면 상단 지도.
   *
   * 무엇을 보장하나:
   *  - 🔴 A1·A2 진행 줄 왼쪽 앞에 **그날 여행지**가 붙는다(`{지역} · N일차 / 총 · 날짜`). 그날 여행지는
   *    여행의 destinations 를 seq 순서로 박수만큼 펼쳐 고르고, 박수 합을 넘는 날은 마지막 seq(결정 3).
   *  - A3 여행 조회가 아직 안 왔거나 실패했거나 여행지가 비면 접두 없이 종전 모양 그대로 뜬다 —
   *    `undefined · ` 같은 글자가 새지 않고, 여행 조회를 기다리느라 진행 줄이 늦어지지도 않는다(INV-4).
   *  - 🔴 A4 두 화면 어디에도 내부 용어 「슬롯」이 없고 카운트는 `N번째 / M` 이다(QA #041).
   *  - 🔴 B1~B3 후보 화면 위에 지도 카드: 기준점 = **지금 채우는 슬롯의 장소**(사용자 GPS 아님 — '현재 위치'
   *    라벨 금지, Seed Q1), 반경 원 = 응답 `radiusMUsed` 우선·조회 중엔 요청 반경·최대 조회 중엔 원 없음
   *    (Seed Q2 · BR-U3-25). 슬롯 좌표가 없으면 지도 카드 자체를 안 그린다(0,0·서울 폴백 금지).
   *  - 🔴 P1~P6(TRIP-1081, 옛 B4 "후보 핀 없음" 반전) 좌표가 둘 다 있는 후보만 카드 글자(A/B/C…)로 핀이
   *    되고, 후보 핀이 2개 이상이면 지도가 핀 전부에 맞춰 열린다(fitPins, 반경 원은 유지).
   *
   * 3동작: 준비 = 가짜 서버(일정·여행·후보) → 실행 = 슬롯 화면 열기·컨셉/반경 누르기 → 단언 = 진행 줄
   * 글자·지도에 넘어간 값.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '44444444-4444-4444-4444-444444444444';
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';
  const SLOT_A = { lat: 37.5796, lng: 126.977 };
  const MAX_RADIUS_USED = 11300;

  function slot(
    overrides: Partial<ItineraryDaysItemSlotsItem> &
      Pick<ItineraryDaysItemSlotsItem, 'poiId' | 'startAt' | 'endAt'>
  ): ItineraryDaysItemSlotsItem {
    return {
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      ...overrides,
    };
  }

  function itineraryOf(days: ItineraryDaysItem[]): Itinerary {
    return {
      itineraryId: 'itin-ctx',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'CO_PLAN',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  // 2일 일정 — day1 [a 경복궁 09:30(좌표 가변), b 13:00] · day2 [c 10:00].
  let slotALat: number | null;
  let slotALng: number | null;
  function twoDayItinerary(): Itinerary {
    return itineraryOf([
      {
        date: DAY1,
        slots: [
          slot({
            poiId: 'a',
            nameKo: '경복궁',
            startAt: '09:30:00',
            endAt: '11:00:00',
            lat: slotALat,
            lng: slotALng,
          }),
          slot({
            poiId: 'b',
            nameKo: '국립현대미술관',
            startAt: '13:00:00',
            endAt: '14:00:00',
            lat: 37.5786,
            lng: 126.98,
          }),
        ],
      },
      {
        date: DAY2,
        slots: [slot({ poiId: 'c', startAt: '10:00:00', endAt: '11:00:00' })],
      },
    ]);
  }

  // 4일 일정 — 날마다 비고정 1곳(d1~d4). A2(그날 여행지 규칙) 전용.
  const FOUR_DAYS = ['2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13'];
  function fourDayItinerary(): Itinerary {
    return itineraryOf(
      FOUR_DAYS.map((date, index) => ({
        date,
        slots: [
          slot({
            poiId: `d${index + 1}`,
            startAt: '10:00:00',
            endAt: '11:00:00',
          }),
        ],
      }))
    );
  }

  function tripWith(destinations: TripDestination[], endDate: string): Trip {
    return {
      tripId: TRIP_ID,
      title: '맥락 테스트 여행',
      startDate: DAY1,
      endDate,
      party: 1,
      preferenceSnapshot: {},
      destinations,
      status: 'PLANNED',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
      baseCount: 0,
      itineraryDayCount: 2,
    };
  }

  type TripMode = 'gangjin' | 'shuffled' | 'pending' | 'error' | 'empty';
  let tripMode: TripMode;
  let itineraryMode: 'twoDay' | 'fourDay';
  let candidates: SlotCandidatesCandidatesItem[];
  let radiusUsedOverride: number | null;
  let holdPosts: boolean;

  const TWO_CANDIDATES: SlotCandidatesCandidatesItem[] = [
    { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
    { poiId: 'Y', distanceRange: '770m', rationale: '조용한 카페' },
  ];

  beforeEach(() => {
    slotALat = SLOT_A.lat;
    slotALng = SLOT_A.lng;
    tripMode = 'gangjin';
    itineraryMode = 'twoDay';
    candidates = TWO_CANDIDATES;
    radiusUsedOverride = null;
    holdPosts = false;
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(
          itineraryMode === 'twoDay' ? twoDayItinerary() : fourDayItinerary()
        )
      ),
      http.get(`${BASE}/trips/:tripId`, async () => {
        switch (tripMode) {
          case 'pending':
            await delay('infinite');
            return HttpResponse.json(tripWith([], DAY2));
          case 'error':
            return HttpResponse.json(
              { code: 'INTERNAL', message: 'boom' },
              { status: 500 }
            );
          case 'empty':
            return HttpResponse.json(tripWith([], DAY2));
          case 'shuffled':
            // 배열 순서 ≠ seq 순서 — 배열 첫 칸(경주)을 1일차로 고르면 red.
            return HttpResponse.json(
              tripWith(
                [
                  { seq: 2, region: '경주', nights: 1 },
                  { seq: 1, region: '부산', nights: 2 },
                ],
                '2026-06-13'
              )
            );
          case 'gangjin':
          default:
            return HttpResponse.json(
              tripWith([{ seq: 1, region: '강진군', nights: 1 }], DAY2)
            );
        }
      }),
      // 요청 반경을 그대로 radiusMUsed 로 돌려준다(에코). 최대(null)는 서버 기본 11.3km. 테스트가
      // radiusUsedOverride 로 "서버가 넓힘"을, holdPosts 로 "조회 중"을 만든다(02a ★4·★5).
      http.post(
        `${BASE}/trips/:tripId/itinerary/slot-candidates`,
        async ({ request }) => {
          const body = (await request.json()) as SlotCandidatesRequest;
          if (holdPosts) await delay('infinite');
          const response: SlotCandidates = {
            candidates,
            radiusMUsed: radiusUsedOverride ?? body.radiusM ?? MAX_RADIUS_USED,
            degraded: false,
          };
          return HttpResponse.json(response);
        }
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderPage(slotKey: string): QueryClient {
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
    render(<SlotFillPage tripId={TRIP_ID} slotKey={slotKey} />, {
      wrapper: Wrapper,
    });
    return client;
  }

  async function pickConcept(key = 'culture'): Promise<void> {
    fireEvent.press(
      await screen.findByTestId(`itinerary-copick-concept-${key}`)
    );
  }

  /** 지도 목의 host — 지도 카드(`itinerary-copick-slotfill-map`) 안에서 찾는다. */
  function mapInCard() {
    const card = screen.getByTestId('itinerary-copick-slotfill-map');
    return within(card).getByTestId('map-root');
  }

  describe('🔴 A1 · 진행 줄 앞에 그날 여행지가 붙는다 (QA #041 · 결정 3)', () => {
    it('강진군 1박 여행 1일차 — 컨셉 화면과 후보 화면 둘 다 "강진군 · 1일차 / 2 · "로 시작한다', async () => {
      renderPage(buildSlotKey(DAY1, 'a'));

      // 컨셉 화면 — 여행 조회가 도착하면 접두가 붙는다.
      await waitFor(() =>
        expect(
          screen.getByTestId('itinerary-copick-concept-progress-day')
        ).toHaveTextContent(/^강진군 · 1일차 \/ 2 · /)
      );

      // 후보 화면 — 같은 진행 줄.
      await pickConcept();
      expect(
        await screen.findByTestId('itinerary-copick-slotfill-progress-day')
      ).toHaveTextContent(/^강진군 · 1일차 \/ 2 · /);
    });
  });

  describe('🔴 A2 · 그날 여행지 = seq 순서로 박수 누적, 넘치는 날은 마지막 seq', () => {
    it.each([
      [1, '부산'],
      [2, '부산'],
      [3, '경주'],
      [4, '경주'],
    ])(
      '부산 2박(seq1)·경주 1박(seq2)을 뒤섞어 받아도 %i일차는 %s 다',
      async (day, region) => {
        tripMode = 'shuffled';
        itineraryMode = 'fourDay';
        renderPage(buildSlotKey(FOUR_DAYS[day - 1], `d${day}`));

        await waitFor(() =>
          expect(
            screen.getByTestId('itinerary-copick-concept-progress-day')
          ).toHaveTextContent(new RegExp(`^${region} · ${day}일차 / 4 · `))
        );
        // 진행바도 같은 분자·분모다(TRIP-1096 03b 경고 2) — 채움 칸 = N일차, 빈 칸 = 4 − N.
        expect(
          screen.getAllByTestId('itinerary-copick-concept-progress-cell-filled')
        ).toHaveLength(day);
        expect(
          screen.queryAllByTestId(
            'itinerary-copick-concept-progress-cell-track'
          )
        ).toHaveLength(4 - day);
      }
    );
  });

  describe('A3 · 여행지를 모르면 접두 없이 종전 모양 그대로 (INV-4 정직 degrade)', () => {
    // TRIP-1096 결정 1 — 분모(여행 기간)도 여행 조회에서 온다. 여행을 모르면 "/ N" 을 통째로 뺀다
    // (itinerary.days 길이로 폴백하지 않는다 — PARTIAL 에선 그 값이 1이라 틀린 분모가 된다).
    it('여행 조회가 아직 안 와도 진행 줄은 뜨고, 접두·분모 없이 "1일차 · "로 시작한다', async () => {
      tripMode = 'pending';
      renderPage(buildSlotKey(DAY1, 'a'));

      const day = await screen.findByTestId(
        'itinerary-copick-concept-progress-day'
      );
      expect(day).toHaveTextContent(/^1일차 · /);
      expect(day).not.toHaveTextContent(/\//);
      expect(day).not.toHaveTextContent(/undefined/);
    });

    it('여행 조회가 error 로 끝나면 접두·분모 없이 "1일차 · "로 시작한다', async () => {
      tripMode = 'error';
      const client = renderPage(buildSlotKey(DAY1, 'a'));

      await waitFor(() =>
        expect(
          client.getQueryState(getGetTripsTripIdQueryKey(TRIP_ID))?.status
        ).toBe('error')
      );
      const day = await screen.findByTestId(
        'itinerary-copick-concept-progress-day'
      );
      expect(day).toHaveTextContent(/^1일차 · /);
      expect(day).not.toHaveTextContent(/\//);
    });

    it.each([['empty', 'success']] as const)(
      '여행 조회가 %s 로 끝나도 접두 없이 "1일차 / 2 · "로 시작한다',
      async (mode, settled) => {
        tripMode = mode;
        const client = renderPage(buildSlotKey(DAY1, 'a'));

        // 조회가 끝난 뒤에 재야 "조회 중"과 다른 경우를 잰다(02a ★3).
        await waitFor(() =>
          expect(
            client.getQueryState(getGetTripsTripIdQueryKey(TRIP_ID))?.status
          ).toBe(settled)
        );
        const day = await screen.findByTestId(
          'itinerary-copick-concept-progress-day'
        );
        expect(day).toHaveTextContent(/^1일차 \/ 2 · /);
        expect(day).not.toHaveTextContent(/undefined/);
      }
    );
  });

  describe('🔴 A4 · 두 화면 어디에도 「슬롯」이 없고 카운트는 "N번째 / M" (QA #041)', () => {
    it('둘째 슬롯 — 컨셉 화면과 후보 화면 모두 "2번째 / 2"이고 「슬롯」 글자가 0개다', async () => {
      renderPage(buildSlotKey(DAY1, 'b'));

      // 컨셉 화면 — 카운트가 먼저 떠 있어야 "없다"가 의미를 갖는다(02a ★10).
      expect(
        await screen.findByTestId('itinerary-copick-concept-progress-count')
      ).toHaveTextContent('2번째 / 2');
      expect(
        screen.queryAllByText(/슬롯/).map((node) => node.props.children)
      ).toEqual([]);

      // 후보 화면.
      await pickConcept();
      expect(
        await screen.findByTestId('itinerary-copick-slotfill-progress-count')
      ).toHaveTextContent('2번째 / 2');
      await screen.findByTestId('itinerary-candidate-radio-X');
      expect(
        screen.queryAllByText(/슬롯/).map((node) => node.props.children)
      ).toEqual([]);
    });
  });

  describe('🔴 B1 · 후보 화면 지도 — 기준점은 지금 채우는 슬롯, 보여주기 전용', () => {
    it('슬롯 좌표를 중심·원 중심으로, 기본 반경 1100m 원과 기준 핀 1개만 넘기고 "현재 위치"는 없다', async () => {
      renderPage(buildSlotKey(DAY1, 'a'));
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-X');

      const map = mapInCard();
      // 중심 = 슬롯 a 좌표(목은 center 를 텍스트로 낸다).
      expect(map).toHaveTextContent(`${SLOT_A.lat},${SLOT_A.lng}`);
      // 보여주기 전용 + 선 없음.
      expect(map.props.viewOnly).toBe(true);
      expect(map.props.connectPins).toBe(false);
      // 반경 원 — 중심은 슬롯, 반경은 기본(mid) 1100m.
      expect(map.props.radiusCircle).toEqual({
        center: { lat: SLOT_A.lat, lng: SLOT_A.lng },
        radiusM: 1100,
      });
      // 기준 핀 하나 — 슬롯 좌표, 후보 letter 아님.
      const pins = map.props.pins as {
        lat: number;
        lng: number;
        label?: string;
      }[];
      expect(pins).toHaveLength(1);
      expect({ lat: pins[0].lat, lng: pins[0].lng }).toEqual(SLOT_A);
      expect(/^[A-Z]$/.test(pins[0].label ?? '')).toBe(false);
      // 사용자 위치가 아니다 — 현재위치 점도 '현재 위치' 글자도 없다(Seed Q1).
      expect(map.props.currentLocation).toBeUndefined();
      expect(screen.queryByText(/현재 위치/)).toBeNull();
    });
  });

  describe('B1b · 둘째 슬롯을 채울 때 지도 중심은 그 슬롯 (5-b W1 보강)', () => {
    it('슬롯 b(국립현대미술관) — 중심·원 중심·기준 핀이 b 좌표다(그날 첫 슬롯 a 가 아니다)', async () => {
      // 준비 — 좌표가 a 와 다른 둘째 슬롯으로 연다. 실행 — 컨셉 고르고 후보 화면. 단언 — 기준점이 b.
      const SLOT_B = { lat: 37.5786, lng: 126.98 };
      renderPage(buildSlotKey(DAY1, 'b'));
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-X');

      const map = mapInCard();
      expect(map.props.radiusCircle.center).toEqual(SLOT_B);
      const pins = map.props.pins as { lat: number; lng: number }[];
      expect({ lat: pins[0].lat, lng: pins[0].lng }).toEqual(SLOT_B);
    });
  });

  describe('🔴 B2 · 반경 원 크기 — 응답 radiusMUsed 우선, 조회 중엔 요청 반경 (Seed Q2 · BR-U3-25)', () => {
    it('B1p · 후보 응답이 오기 전에는 요청 반경(1100m)으로 원을 그린다', async () => {
      holdPosts = true;
      renderPage(buildSlotKey(DAY1, 'a'));
      await pickConcept();

      await waitFor(() =>
        expect(mapInCard().props.radiusCircle?.radiusM).toBe(1100)
      );
    });

    it('B2 · 700m 칸을 누르면 700, 최대 칸을 누르면 서버가 쓴 11.3km 로 원이 바뀐다', async () => {
      renderPage(buildSlotKey(DAY1, 'a'));
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-X');

      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
      await waitFor(() =>
        expect(mapInCard().props.radiusCircle?.radiusM).toBe(700)
      );

      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-max'));
      await waitFor(() =>
        expect(mapInCard().props.radiusCircle?.radiusM).toBe(MAX_RADIUS_USED)
      );
    });

    it('B2w · 서버가 요청(700m)보다 넓혀 1500m 를 썼으면 원도 1500m 다', async () => {
      renderPage(buildSlotKey(DAY1, 'a'));
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-X');

      radiusUsedOverride = 1500;
      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
      await waitFor(() =>
        expect(mapInCard().props.radiusCircle?.radiusM).toBe(1500)
      );
    });

    it('B2m · 최대 칸 조회 중(서버 반경 미정)에는 지도는 남고 원은 그리지 않는다', async () => {
      renderPage(buildSlotKey(DAY1, 'a'));
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-X');
      // 첫 응답(1100) 뒤라 원이 있는 상태에서 시작한다(긍정 짝).
      expect(mapInCard().props.radiusCircle?.radiusM).toBe(1100);

      holdPosts = true;
      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-max'));

      await waitFor(() =>
        expect(mapInCard().props.radiusCircle).toBeUndefined()
      );
      expect(screen.getByTestId('itinerary-copick-slotfill-map')).toBeTruthy();
    });
  });

  describe('B3 · 슬롯 좌표가 없으면 지도 카드 자체가 없다 (0,0·폴백 좌표 금지)', () => {
    it.each([
      ['lat', null, SLOT_A.lng],
      ['lng', SLOT_A.lat, null],
    ] as const)(
      '슬롯 %s 가 null 이면 후보는 뜨지만 지도 카드·지도가 없다',
      async (_field, lat, lng) => {
        slotALat = lat;
        slotALng = lng;
        renderPage(buildSlotKey(DAY1, 'a'));
        await pickConcept();

        // 긍정 짝 — 후보 얼굴이 떠 있다(아직 안 떠서 "없음"인 공허 통과 차단).
        await screen.findByTestId('itinerary-candidate-radio-X');
        expect(
          screen.queryByTestId('itinerary-copick-slotfill-map')
        ).toBeNull();
        expect(screen.queryByTestId('map-root')).toBeNull();
      }
    );
  });

  // TRIP-1081 — 후보 좌표 픽스처. 전부 슬롯 a·b 좌표와 다르다(기준점 대체 뮤턴트와 구별, 02a ★3).
  const COORD_X = { lat: 37.581, lng: 126.975 };
  const COORD_Y = { lat: 37.577, lng: 126.983 };
  const COORD_Z = { lat: 37.583, lng: 126.98 };
  const COORD_V = { lat: 37.57, lng: 126.97 };
  const COORD_W = { lat: 37.59, lng: 126.99 };
  const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

  function located(): SlotCandidatesCandidatesItem[] {
    return [
      { poiId: 'X', distanceRange: '420m', rationale: '실내 전시', ...COORD_X },
      {
        poiId: 'Y',
        distanceRange: '770m',
        rationale: '조용한 카페',
        ...COORD_Y,
      },
      { poiId: 'Z', distanceRange: '980m', rationale: '야외 정원', ...COORD_Z },
    ];
  }

  type Pin = { number: number; lat: number; lng: number; label?: string };

  function mapPins(): Pin[] {
    return mapInCard().props.pins as Pin[];
  }

  /** 기준 핀(맨 앞)을 뺀 후보 핀을 글자·좌표만 남겨 비교한다(02a ★1). */
  function candidatePins(): { label?: string; lat: number; lng: number }[] {
    return mapPins()
      .slice(1)
      .map(({ label, lat, lng }) => ({ label, lat, lng }));
  }

  async function openCandidates(lastPoiId: string): Promise<void> {
    renderPage(buildSlotKey(DAY1, 'a'));
    await pickConcept();
    await screen.findByTestId(`itinerary-candidate-radio-${lastPoiId}`);
  }

  // B4(후보 핀 없음)는 결정 반전으로 삭제 — 후보 좌표 계약(TRIP-1063)이 생겼다.
  describe('🔴 TRIP-1081 · 후보 A/B/C 핀 (QA #068 · 결정 2)', () => {
    it('P1 · 좌표 있는 후보 3곳 → 기준 핀 뒤에 A·B·C 핀이 카드 순서·후보 좌표로 붙는다', async () => {
      candidates = located();
      await openCandidates('Z');

      const pins = mapPins();
      expect(pins).toHaveLength(4);
      // 맨 앞은 여전히 기준 핀(슬롯 a) — 글자 핀이 아니다.
      expect({ lat: pins[0].lat, lng: pins[0].lng }).toEqual(SLOT_A);
      expect(/^[A-Z]$/.test(pins[0].label ?? '')).toBe(false);
      // 후보 핀 = 응답 후보뿐, 카드 순서 글자 + 그 후보 좌표(INV-1).
      expect(candidatePins()).toEqual([
        { label: 'A', ...COORD_X },
        { label: 'B', ...COORD_Y },
        { label: 'C', ...COORD_Z },
      ]);
      // 지도는 number 로 마커 key 를 만든다 — 겹치면 실기에서 핀이 조용히 사라진다(02a ★2).
      expect(new Set(pins.map((pin) => pin.number)).size).toBe(pins.length);
    });

    it.each([
      ['lat 가 null', { lat: null, lng: COORD_Y.lng }],
      ['lng 가 null', { lat: COORD_Y.lat, lng: null }],
      ['lat 키가 없음', { lng: COORD_Y.lng }],
      ['lng 키가 없음', { lat: COORD_Y.lat }],
    ])(
      'P2 · 둘째 후보(Y)의 %s → 후보 핀은 A·C 두 개뿐(글자 유지, 0,0·기준점으로 대신 찍지 않음)',
      async (_case, coords) => {
        candidates = [
          {
            poiId: 'X',
            distanceRange: '420m',
            rationale: '실내 전시',
            ...COORD_X,
          },
          {
            poiId: 'Y',
            distanceRange: '770m',
            rationale: '조용한 카페',
            ...coords,
          },
          {
            poiId: 'Z',
            distanceRange: '980m',
            rationale: '야외 정원',
            ...COORD_Z,
          },
        ];
        await openCandidates('Z');

        expect(mapPins()).toHaveLength(3);
        expect(candidatePins()).toEqual([
          { label: 'A', ...COORD_X },
          { label: 'C', ...COORD_Z },
        ]);
      }
    );

    it('P3 · 반경을 바꿔 재조회하면 이전 후보 핀은 사라지고 새 후보 핀만 남는다', async () => {
      candidates = located().slice(0, 2);
      await openCandidates('Y');
      expect(candidatePins()).toEqual([
        { label: 'A', ...COORD_X },
        { label: 'B', ...COORD_Y },
      ]);

      // 핸들러가 요청 시점에 candidates 를 읽는다 — 누르기 전에 바꾼다(02a ★11).
      candidates = [
        {
          poiId: 'V',
          distanceRange: '300m',
          rationale: '골목 식당',
          ...COORD_V,
        },
        { poiId: 'W', distanceRange: '650m', rationale: '공원', ...COORD_W },
      ];
      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
      await screen.findByTestId('itinerary-candidate-radio-V');

      expect(candidatePins()).toEqual([
        { label: 'A', ...COORD_V },
        { label: 'B', ...COORD_W },
      ]);
    });

    it.each([
      [0, false],
      [1, false],
      [2, true],
      [3, true],
    ] as const)(
      'P4 · 후보 3곳 중 좌표 있는 곳이 %i 곳이면 fitPins=%s, 반경 원은 그대로',
      async (withCoords, fit) => {
        candidates = located().map((candidate, index) =>
          index < withCoords
            ? candidate
            : { ...candidate, lat: null, lng: null }
        );
        await openCandidates('Z');

        const map = mapInCard();
        expect(mapPins()).toHaveLength(1 + withCoords);
        // 미설정은 false·undefined 둘 다 허용 — 지도는 === true 로만 분기한다(02a ★7).
        if (fit) {
          expect(map.props.fitPins).toBe(true);
        } else {
          expect(map.props.fitPins).not.toBe(true);
        }
        expect(map.props.radiusCircle).toEqual({
          center: SLOT_A,
          radiusM: 1100,
        });
      }
    );

    it('P5 · 슬롯 좌표가 없으면 후보 좌표가 있어도 지도 카드 자체가 없다(무회귀)', async () => {
      slotALat = null;
      candidates = located();
      renderPage(buildSlotKey(DAY1, 'a'));
      await pickConcept();

      // 긍정 짝 — 후보 얼굴이 떠 있다.
      await screen.findByTestId('itinerary-candidate-radio-X');
      expect(screen.queryByTestId('itinerary-copick-slotfill-map')).toBeNull();
      expect(screen.queryByTestId('map-root')).toBeNull();
    });

    it('P6 · 후보 핀·넓힘 캡션이 떠 있어도 소요시간 문자열이 없다 (INV-3)', async () => {
      candidates = located();
      radiusUsedOverride = 12000;
      await openCandidates('Z');

      // 긍정 앵커 — 새 캡션과 후보 핀이 실제로 떠 있다(02a ★12).
      expect(
        screen.getByTestId('itinerary-copick-radius-used')
      ).toHaveTextContent('1.1km 안에 없어 약 12.0km까지 넓혔어요');
      expect(mapPins()).toHaveLength(4);

      expect(screen.queryAllByText(DURATION_TEXT)).toEqual([]);
      expect(
        mapPins().filter((pin) => DURATION_TEXT.test(pin.label ?? ''))
      ).toEqual([]);
    });
  });
});

// TRIP-1073 · 옛 SlotFillPage.defaultPick.integration.test.tsx
describe('후보 기본 선택', () => {
  /**
   * TRIP-1073 B · h10 후보가 도착하면 첫 후보(A)를 선택 상태로 두고 버튼을 'A로 선택'으로 켠다
   * (결정 2 (a) · Figma h10 default). 반경·컨셉을 바꿔 다시 조회하면 사용자가 **직접 탭한** 후보가 새
   * 목록에 있을 때만 그 선택을 유지하고, 아니면 새 A 로 다시 잡는다(01b 열린 질문 3 글자 그대로).
   *
   * 무엇을 보장하나:
   *  - 🔴 B1·B2 아무것도 안 눌러도 A 가 선택돼 있고, 그대로 확정하면 A 로 PUT 이 나간다.
   *  - B3·B3c 탭한 후보가 새 목록에 있으면 반경(B3)·컨셉(B3c) 재조회 뒤에도 유지된다.
   *  - B3r 반경 재조회의 나머지 입구(하단 넓히기·좁히기, 0건 얼굴 넓히기)에서도 같다.
   *  - 🔴 B4·B4c 자동으로 잡힌 A 는 "고른 것"이 아니다 — 재조회 뒤 새 A 로 바뀐다(02a ★B-1).
   *  - 🔴 B5 탭한 후보가 새 목록에서 빠지면 새 A 로 바뀌고, 확정 PUT 도 새 A 다 — 목록에 없는 poiId 로
   *    PUT 이 나가지 않는다(INV-1, 02a ★B-7). 재조회 중엔 확정 버튼 자체가 없다(B5p, ★B-3).
   *  - B6 후보 0건·조회 실패·조회 중엔 선택도 확정 버튼도 없다.
   *  - 🔴 B7 생성 중(PARTIAL)이면 A 는 선택되지만 확정은 잠기고 PUT 은 0이다(TRIP-978 무회귀).
   *  - D 반경 밖 표지가 계약에 없으니 거리 문자열이 멀어 보여도 어느 카드도 흐리게 그리지 않는다.
   *
   * 3동작: 준비=MSW 응답(요청 반경·컨셉별 대본) → 실행=컨셉·반경·라디오·확정 → 단언=선택 표지·버튼·PUT 바디.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '44444444-4444-4444-4444-444444444444';
  const DAY1 = '2026-06-10';
  const SLOT_KEY = buildSlotKey(DAY1, 'a');
  const LOCKED_TEXT = '나머지 일정을 만드는 중이에요';

  const TRIP_NO_DESTINATIONS: Trip = {
    tripId: TRIP_ID,
    title: '테스트 여행',
    startDate: DAY1,
    endDate: '2026-06-11',
    party: 1,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 1,
  };

  /** 같이 짜기 일정 — 1일차 비고정 [a, b]. slot a 를 채운다(다음 = b). */
  function itinerary(
    generationState: Itinerary['generationState'] = 'COMPLETE'
  ): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: ['a', 'b'].map((poiId, i) => ({
          poiId,
          nameKo: poiId === 'a' ? '경복궁' : '북촌',
          startAt: i === 0 ? '09:30:00' : '13:00:00',
          endAt: i === 0 ? '11:00:00' : '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          alternatives: [],
          tags: [],
        })),
      },
    ];
    return {
      itineraryId: 'itin-1073',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'CO_PLAN',
      generationState,
      isFallback: false,
      days,
    };
  }

  /** 후보 한 건 — 이름을 채워 둔다(이름 leaf 의 흐림 톤 판정용, D). */
  function cand(
    poiId: string,
    distanceRange = '420m'
  ): SlotCandidatesCandidatesItem {
    return {
      poiId,
      distanceRange,
      rationale: `${poiId} 근거`,
      nameKo: `장소 ${poiId}`,
    };
  }

  function ok(candidates: SlotCandidatesCandidatesItem[], radiusMUsed = 1100) {
    const body: SlotCandidates = { candidates, radiusMUsed, degraded: false };
    return HttpResponse.json(body);
  }

  /** 후보 POST 대본 — 요청 바디(반경·컨셉)로 응답을 고른다. 테스트마다 바꿔 끼운다. */
  let candidatesScript: (
    body: SlotCandidatesRequest
  ) => Response | Promise<Response>;
  let itineraryState: Itinerary['generationState'] = 'COMPLETE';
  let postCalls = 0;
  let putCalls = 0;
  let putBody: EditItineraryRequest | null = null;

  beforeEach(() => {
    postCalls = 0;
    putCalls = 0;
    putBody = null;
    itineraryState = 'COMPLETE';
    mockBack.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
    candidatesScript = () => ok([cand('X'), cand('Y'), cand('Z')]);
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(TRIP_NO_DESTINATIONS)
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary(itineraryState))
      ),
      http.post(
        `${BASE}/trips/:tripId/itinerary/slot-candidates`,
        async ({ request }) => {
          postCalls += 1;
          return candidatesScript(
            (await request.json()) as SlotCandidatesRequest
          );
        }
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        putCalls += 1;
        putBody = (await request.json()) as EditItineraryRequest;
        return HttpResponse.json(itinerary());
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
    return render(<SlotFillPage tripId={TRIP_ID} slotKey={SLOT_KEY} />, {
      wrapper: Wrapper,
    });
  }

  async function pickConcept(key = 'culture'): Promise<void> {
    fireEvent.press(
      await screen.findByTestId(`itinerary-copick-concept-${key}`)
    );
  }

  /** 라디오의 선택 표지(호스트 accessibilityState, 02a ★B-6). */
  const isSelected = (poiId: string): boolean | undefined =>
    screen.getByTestId(`itinerary-candidate-radio-${poiId}`).props
      .accessibilityState?.selected;

  const confirmButton = () =>
    screen.getByTestId('itinerary-copick-slotfill-confirm');

  /** "안 나갔다"는 나갈 시간을 준 뒤 센다(02a ★B-5). */
  const sleep = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  /** 반경 near(700m)·mid(1100m)로 응답을 가르는 대본. */
  function byRadius(
    mid: SlotCandidatesCandidatesItem[],
    near: SlotCandidatesCandidatesItem[] | 'never'
  ) {
    return async (body: SlotCandidatesRequest) => {
      if (body.radiusM === 700) {
        if (near === 'never') {
          await delay('infinite');
        }
        return ok(near === 'never' ? [] : near, 700);
      }
      return ok(mid);
    };
  }

  /** 컨셉 전시·문화 / 카페로 응답을 가르는 대본. */
  function byConcept(
    culture: SlotCandidatesCandidatesItem[],
    cafe: SlotCandidatesCandidatesItem[]
  ) {
    return (body: SlotCandidatesRequest) =>
      ok(body.concept === '카페' ? cafe : culture);
  }

  describe('🔴 TRIP-1073 B1·B2 · 후보가 오면 A 가 선택돼 있다', () => {
    it('B1 · 아무것도 안 눌러도 첫 후보 X 가 선택이고 확정이 켜진 "A로 선택"이다', async () => {
      // 준비·실행 — 컨셉만 고른다(라디오는 건드리지 않는다).
      renderPage();
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-X');

      // 단언 — A 하나만 선택, 확정 활성, 라벨은 완전 일치.
      await waitFor(() => expect(isSelected('X')).toBe(true));
      expect(isSelected('Y')).toBe(false);
      expect(isSelected('Z')).toBe(false);
      expect(confirmButton().props.accessibilityState?.disabled).not.toBe(true);
      expect(confirmButton()).toHaveTextContent('A로 선택');
    });

    it('B2 · 라디오를 안 누르고 확정하면 X 로 PUT 1건이 나가고 다음 슬롯(b)으로 간다', async () => {
      renderPage();
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-X');
      await waitFor(() => expect(isSelected('X')).toBe(true));

      // 실행 — 확정만 누른다.
      fireEvent.press(confirmButton());

      // 단언 — 대상 슬롯(a)이 X 로 바뀐 PUT 1건 → 다음 비고정 슬롯으로 replace 1회.
      await waitFor(() => expect(putCalls).toBe(1));
      expect(putBody?.days[0].slots[0].poiId).toBe('X');
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      expect(JSON.stringify(mockReplace.mock.calls[0][0])).toContain(
        buildSlotKey(DAY1, 'b')
      );
    });
  });

  describe('TRIP-1073 B3 · 탭한 후보가 새 목록에 있으면 유지된다', () => {
    it('🟢 B3 · Y 를 탭한 뒤 반경을 바꿔 [W, Y] 가 와도 Y 가 선택이고 "B로 선택"이다 (선제 green, ★B-2)', async () => {
      // 준비 — mid=[X,Y,Z], near=[W,Y].
      candidatesScript = byRadius(
        [cand('X'), cand('Y'), cand('Z')],
        [cand('W'), cand('Y')]
      );
      renderPage();
      await pickConcept();
      fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-Y'));
      expect(confirmButton()).toHaveTextContent('B로 선택'); // 앵커 — 탭이 먹었다

      // 실행 — 반경 700m 로 다시 조회.
      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
      await screen.findByTestId('itinerary-candidate-radio-W'); // 새 목록 도착(★B-4)

      // 단언
      await waitFor(() => expect(isSelected('Y')).toBe(true));
      expect(isSelected('W')).toBe(false);
      expect(confirmButton()).toHaveTextContent('B로 선택');
    });

    it('🔴 B3c · Y 를 탭한 뒤 컨셉을 바꿔 [W, Y] 가 와도 Y 가 선택이고 "B로 선택"이다', async () => {
      // 준비 — 전시·문화=[X,Y,Z], 카페=[W,Y].
      candidatesScript = byConcept(
        [cand('X'), cand('Y'), cand('Z')],
        [cand('W'), cand('Y')]
      );
      renderPage();
      await pickConcept('culture');
      fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-Y'));
      expect(confirmButton()).toHaveTextContent('B로 선택');

      // 실행 — 결과 얼굴의 ‹(컨셉 변경) → 카페.
      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-back'));
      await pickConcept('cafe');
      await screen.findByTestId('itinerary-candidate-radio-W');

      // 단언
      await waitFor(() => expect(isSelected('Y')).toBe(true));
      expect(isSelected('W')).toBe(false);
      expect(confirmButton()).toHaveTextContent('B로 선택');
    });
  });

  /** 호출 순서대로 목록을 내주는 대본 — 같은 반경이 두 번 불려도 다른 목록을 줄 수 있다. 요청 반경도 적는다. */
  function inOrder(
    lists: SlotCandidatesCandidatesItem[][],
    radii: (number | null | undefined)[]
  ) {
    return (body: SlotCandidatesRequest) => {
      radii.push(body.radiusM);
      return ok(lists[Math.min(radii.length, lists.length) - 1]);
    };
  }

  type RadiusEntryRow = {
    label: string;
    lists: SlotCandidatesCandidatesItem[][];
    /** Y 를 탭하기 전 — 입구 버튼이 보이는 반경 단계로 옮긴다. */
    beforeTap?: () => Promise<void>;
    /** Y 를 탭한 뒤 — 입구 버튼이 있는 얼굴로 옮긴다. */
    afterTap?: () => Promise<void>;
    entryTestID: string;
    entryLabel: string;
    radiusM: number | null;
  };

  // it.each = 같은 본문을 표의 행마다 한 번씩 돌린다. 입구만 다르고 기대(Y 유지)는 같아서 쓴다.
  describe('TRIP-1073 B3r · 반경 재조회 입구 셋 모두에서 탭한 후보가 유지된다 (03b 경고 1)', () => {
    it.each<RadiusEntryRow>([
      {
        label: '하단바 반경 넓히기 (1.1km → 최대)',
        lists: [
          [cand('X'), cand('Y'), cand('Z')],
          [cand('W'), cand('Y')],
        ],
        entryTestID: 'itinerary-copick-slotfill-radius',
        entryLabel: '반경 넓히기',
        radiusM: null,
      },
      {
        label: '하단바 반경 좁히기 (최대 → 1.1km)',
        lists: [
          [cand('X'), cand('Y'), cand('Z')],
          [cand('V'), cand('Y'), cand('Z')],
          [cand('W'), cand('Y')],
        ],
        beforeTap: async () => {
          fireEvent.press(
            screen.getByTestId('itinerary-copick-radius-seg-max')
          );
          await screen.findByTestId('itinerary-candidate-radio-V');
        },
        entryTestID: 'itinerary-copick-slotfill-radius',
        entryLabel: '반경 좁히기',
        radiusM: 1100,
      },
      {
        label: '0건 얼굴 반경 넓히기 (700m 0건 → 1.1km)',
        lists: [[cand('X'), cand('Y'), cand('Z')], [], [cand('W'), cand('Y')]],
        afterTap: async () => {
          fireEvent.press(
            screen.getByTestId('itinerary-copick-radius-seg-near')
          );
          await screen.findByTestId('itinerary-copick-zero');
        },
        entryTestID: 'itinerary-copick-zero-radius',
        entryLabel: '반경 넓히기',
        radiusM: 1100,
      },
    ])('$label', async (row) => {
      // 준비 — 호출 순서 대본. Y 를 탭해 "직접 고른 후보"를 만들고, 입구 버튼이 있는 얼굴까지 간다.
      const radii: (number | null | undefined)[] = [];
      candidatesScript = inOrder(row.lists, radii);
      renderPage();
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-X');
      await row.beforeTap?.();
      fireEvent.press(screen.getByTestId('itinerary-candidate-radio-Y'));
      expect(confirmButton()).toHaveTextContent('B로 선택'); // 앵커 — 탭이 먹었다
      await row.afterTap?.();
      const entry = screen.getByTestId(row.entryTestID);
      expect(entry).toHaveTextContent(row.entryLabel); // 앵커 — 누를 버튼이 이 입구다

      // 실행 — 그 입구로 다시 조회.
      fireEvent.press(entry);
      await screen.findByTestId('itinerary-candidate-radio-W'); // 새 목록 도착(★B-4)

      // 단언 — 요청이 그 입구의 반경으로 나갔고, 새 목록 [W, Y] 에서 Y 가 유지된다.
      expect(radii[radii.length - 1]).toBe(row.radiusM);
      await waitFor(() => expect(isSelected('Y')).toBe(true));
      expect(isSelected('W')).toBe(false);
      expect(confirmButton()).toHaveTextContent('B로 선택');
    });
  });

  describe('🔴 TRIP-1073 B4 · 자동으로 잡힌 A 는 재조회 뒤 새 A 로 바뀐다 (★B-1)', () => {
    it('B4 · 탭 없이 반경을 바꿔 [W, X] 가 오면 옛 A(X)가 아니라 새 A(W)가 선택이다', async () => {
      // 준비 — mid=[X,Y], near=[W,X]. X 는 두 목록에 다 있다.
      candidatesScript = byRadius(
        [cand('X'), cand('Y')],
        [cand('W'), cand('X')]
      );
      renderPage();
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-X');
      await waitFor(() => expect(isSelected('X')).toBe(true)); // 앵커 — 자동 A

      // 실행
      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
      await screen.findByTestId('itinerary-candidate-radio-W');

      // 단언 — "지금 선택(자동 포함) 유지"로 구현하면 X 가 남아 red.
      await waitFor(() => expect(isSelected('W')).toBe(true));
      expect(isSelected('X')).toBe(false);
      expect(confirmButton()).toHaveTextContent('A로 선택');
    });

    it('B4c · 탭 없이 컨셉을 바꿔 [W, X] 가 와도 새 A(W)가 선택이다', async () => {
      candidatesScript = byConcept(
        [cand('X'), cand('Y')],
        [cand('W'), cand('X')]
      );
      renderPage();
      await pickConcept('culture');
      await screen.findByTestId('itinerary-candidate-radio-X');
      await waitFor(() => expect(isSelected('X')).toBe(true));

      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-back'));
      await pickConcept('cafe');
      await screen.findByTestId('itinerary-candidate-radio-W');

      await waitFor(() => expect(isSelected('W')).toBe(true));
      expect(isSelected('X')).toBe(false);
    });
  });

  describe('🔴 TRIP-1073 B5 · 목록에 없는 후보로 확정되지 않는다 (INV-1)', () => {
    it('B5 · 탭한 Y 가 새 목록 [W, X] 에서 빠지면 W 가 선택되고 확정 PUT 도 W 다', async () => {
      // 준비 — mid=[X,Y,Z], near=[W,X]. Y 는 새 목록에 없다.
      candidatesScript = byRadius(
        [cand('X'), cand('Y'), cand('Z')],
        [cand('W'), cand('X')]
      );
      renderPage();
      await pickConcept();
      fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-Y'));
      expect(confirmButton()).toHaveTextContent('B로 선택');

      // 실행 — 반경을 바꾸고, 새 목록에서 확정.
      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
      await screen.findByTestId('itinerary-candidate-radio-W');
      await waitFor(() => expect(isSelected('W')).toBe(true));
      expect(confirmButton()).toHaveTextContent('A로 선택');
      fireEvent.press(confirmButton());

      // 단언 — 화면 라벨이 아니라 PUT 바디가 최종 증거다(★B-7). 지금 코드는 Y 로 나간다.
      await waitFor(() => expect(putCalls).toBe(1));
      expect(putBody?.days[0].slots[0].poiId).toBe('W');
    });

    it('🟢 B5p · 재조회 중(목록 비움)엔 라디오도 확정 버튼도 없다 (선제 green, ★B-3)', async () => {
      // 준비 — near 응답은 영원히 안 온다.
      candidatesScript = byRadius([cand('X'), cand('Y'), cand('Z')], 'never');
      renderPage();
      await pickConcept();
      fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-Y'));
      expect(confirmButton()).toBeOnTheScreen(); // 앵커 — 조회 전엔 있었다

      // 실행
      fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
      await waitFor(() => expect(postCalls).toBe(2));

      // 단언 — 누를 버튼 자체가 없으니 옛 Y 로 PUT 이 나갈 길이 없다.
      expect(
        screen.getByTestId('itinerary-copick-slotfill-root')
      ).toBeOnTheScreen();
      expect(
        screen.queryAllByTestId(/^itinerary-candidate-radio-/)
      ).toHaveLength(0);
      expect(
        screen.queryByTestId('itinerary-copick-slotfill-confirm')
      ).toBeNull();
      expect(putCalls).toBe(0);
    });
  });

  describe('🟢 TRIP-1073 B6 · 후보가 없으면 선택도 확정 버튼도 없다 (선제 green)', () => {
    it.each<[string, () => Response | Promise<Response>, string]>([
      ['후보 0건', () => ok([]), 'itinerary-copick-zero'],
      [
        '조회 실패(500)',
        () =>
          HttpResponse.json(
            { error: { code: 'X', message: 'x' } },
            { status: 500 }
          ),
        'itinerary-copick-candidates-error',
      ],
      [
        '조회 중',
        async () => {
          await delay('infinite');
          return ok([cand('X')]);
        },
        'itinerary-copick-slotfill-root',
      ],
    ])('%s', async (_label, respond, faceTestID) => {
      // 준비
      candidatesScript = respond;

      // 실행
      renderPage();
      await pickConcept();
      await waitFor(() => expect(postCalls).toBe(1));

      // 단언 — 그 얼굴이 떴다(긍정 앵커) + 선택·확정 0.
      expect(await screen.findByTestId(faceTestID)).toBeOnTheScreen();
      expect(
        screen.queryAllByTestId(/^itinerary-candidate-radio-/)
      ).toHaveLength(0);
      expect(
        screen.queryByTestId('itinerary-copick-slotfill-confirm')
      ).toBeNull();
    });
  });

  describe('🔴 TRIP-1073 B7 · 생성 중(PARTIAL)이면 A 는 선택되지만 확정은 잠긴다 (TRIP-978 무회귀)', () => {
    it('X 가 선택이어도 확정은 비활성이고 잠금 사유가 보이며 눌러도 PUT 0 이다', async () => {
      // 준비 — 일정이 생성 중이고 후보는 X 하나.
      itineraryState = 'PARTIAL';
      candidatesScript = () => ok([cand('X')]);
      renderPage();
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-X');

      // 단언 ① 자동 A.
      await waitFor(() => expect(isSelected('X')).toBe(true));
      // 단언 ② 잠금.
      expect(confirmButton().props.accessibilityState?.disabled).toBe(true);
      expect(
        screen.getByTestId('itinerary-copick-confirm-locked')
      ).toHaveTextContent(LOCKED_TEXT);

      // 실행 — 그래도 눌러 본다.
      fireEvent.press(confirmButton());
      await sleep(50);

      // 단언 ③ PUT·이동 0.
      expect(putCalls).toBe(0);
      expect(mockReplace).toHaveBeenCalledTimes(0);
    });
  });

  /** className 을 공백으로 쪼갠 토큰 — `text-muted-soft` 같은 부분 일치 오탐을 막는다(★D-1). */
  const classTokens = (testID: string): string[] =>
    String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);

  describe('🟢 TRIP-1073 D · 반경 밖 표지가 없으면 어느 카드도 흐리지 않다 (선제 green)', () => {
    it('거리 문자열이 "약 9.9km" 여도 이름 글자는 흐림 톤(text-muted)이 아니라 기본 톤(text-ink)이다', async () => {
      // 준비 — 계약엔 반경 밖 표지·숫자 거리가 없다. 문자열만 멀어 보인다.
      candidatesScript = () => ok([cand('X', '420m'), cand('D', '약 9.9km')]);

      // 실행
      renderPage();
      await pickConcept();
      await screen.findByTestId('itinerary-candidate-radio-D');

      // 단언 — distanceRange 를 파싱해 흐림을 지어내면 red.
      for (const id of ['X', 'D']) {
        const tokens = classTokens(`itinerary-candidate-name-${id}`);
        expect(tokens).toContain('text-ink');
        expect(tokens).not.toContain('text-muted');
      }
    });
  });
});

// TRIP-1006 · 옛 SlotFillPage.leave.integration.test.tsx
describe('‹ 떠나기 확인', () => {
  /**
   * TRIP-1006 (B) · 같이 짜기 도중 ‹ — 필수 방문지(h02)로 새지 않는다(#072 · BR-U3-06·18 · D3 · Q2).
   *
   * 무엇이 문제였나: 컨셉 얼굴(h09)의 ‹ 가 `router.back()` 이라 스택상 h02 로 돌아갔고, 거기서 CTA 를
   * 누르면 생성이 다시 돌아 **이미 고른 슬롯이 사라졌다**(확인 없는 재생성).
   *
   * 무엇을 보장하나:
   *  - 🔴 B5 앞에서 고른 곳이 0곳이면 ‹ 는 확인 없이 **홈으로** 나간다(`replace('/(tabs)')`, Q2).
   *  - 🔴 B2 1곳 이상 골랐으면 ‹ 는 이탈 확인을 먼저 띄운다. 문구는 고른 수를 **일자를 건너** 세고,
   *    "저장돼 있다"는 사실대로 말한다(사라진다고 겁주지 않는다, Q2). 확인 전엔 이동·요청 0.
   *  - 🔴 B3 [머무르기] → 확인만 닫히고 같은 슬롯의 컨셉 얼굴 그대로. 이동·요청 0.
   *  - 🔴 B4 [나가기] → 홈으로 replace 1회. h02(must-visits)·뒤로가기 아님.
   *  - 🟢 B1 후보 얼굴의 ‹ 는 같은 슬롯의 컨셉 얼굴로 돌아간다(이미 되는 동작을 잠근다, 02a ★10).
   *
   * "고른 곳 수" = 지금 슬롯 **앞에 있는 비고정 슬롯 수**(고정 숙소 제외, 일자 횡단). 같이 짜기는 비고정
   * 슬롯을 순서대로 하나씩 채우므로, 앞에 있는 비고정 슬롯은 이미 고른 것이다.
   *
   * 픽스처가 세 가지 오답을 가른다(02a ★6):
   *   day1 = [hotel(고정), a, b], day2 = [c, d]
   *   - a: 앞에 고정 hotel 만 → 0곳. "앞 슬롯 전부 세기"면 1이 나와 B5 가 red.
   *   - b: 1곳.
   *   - c: 2곳(a·b). "그날 안의 순번"으로 세면 0이 나와 확인이 안 떠 B2 가 red.
   *
   * 3동작: 준비 = 가짜 서버 일정 → 실행 = 슬롯 화면을 열고 ‹ (와 확인 버튼)를 누른다 → 단언 = 확인 창·
   *   라우터 호출·나간 요청 수.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '55555555-5555-5555-5555-555555555555';

  // TRIP-1043 — 페이지가 진행 줄 여행지 접두를 위해 여행(`GET /trips/:tripId`)을 조회한다. 이 파일은 접두를
  // 재지 않으므로 여행지 없는 여행으로 답한다(접두 생략 degrade — 기존 `N일차` 단언이 그대로 유효). 핸들러를
  // 빼면 MSW 'error' 전략이 console.error 만 찍고 쿼리를 조용히 실패시켜 누락이 드러나지 않는다(02a ★1).
  const TRIP_NO_DESTINATIONS: Trip = {
    tripId: TRIP_ID,
    title: '테스트 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-11',
    party: 1,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 1,
  };
  const DAY1 = '2026-06-10';
  const DAY2 = '2026-06-11';

  const KEY_A = buildSlotKey(DAY1, 'a');
  const KEY_B = buildSlotKey(DAY1, 'b');
  const KEY_C = buildSlotKey(DAY2, 'c');

  const LEAVE = 'itinerary-copick-leave-confirm';

  function slot(
    poiId: string,
    startAt: string,
    isFixed: boolean
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      nameKo: `장소-${poiId}`,
      startAt,
      endAt: startAt,
      isFixed,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
    };
  }

  function itinerary(): Itinerary {
    return {
      itineraryId: 'itin-leave',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'CO_PLAN',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [
        {
          date: DAY1,
          slots: [
            slot('hotel', '00:00:00', true),
            slot('a', '09:30:00', false),
            slot('b', '13:00:00', false),
          ],
        },
        {
          date: DAY2,
          slots: [slot('c', '10:00:00', false), slot('d', '14:00:00', false)],
        },
      ],
    };
  }

  let generatePosts = 0;
  let candidatePosts = 0;
  let puts = 0;

  beforeEach(() => {
    generatePosts = 0;
    candidatePosts = 0;
    puts = 0;
    mockBack.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(TRIP_NO_DESTINATIONS)
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary())
      ),
      // 생성 POST — 이 화면에서 나가면 안 된다(재생성 = 고른 슬롯 소실). 세려고 핸들러를 둔다.
      http.post(`${BASE}/trips/:tripId/itinerary`, () => {
        generatePosts += 1;
        return HttpResponse.json(itinerary(), { status: 201 });
      }),
      http.post(`${BASE}/trips/:tripId/itinerary/slot-candidates`, () => {
        candidatePosts += 1;
        return HttpResponse.json({
          candidates: [
            { poiId: 'X', distanceRange: '420m', rationale: '가까움' },
          ],
          radiusMUsed: 1100,
        });
      }),
      http.put(`${BASE}/trips/:tripId/itinerary`, () => {
        puts += 1;
        return HttpResponse.json(itinerary());
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  function renderSlot(slotKey: string) {
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
    return render(<SlotFillPage tripId={TRIP_ID} slotKey={slotKey} />, {
      wrapper: Wrapper,
    });
  }

  /** 일정 GET 이 도착해 "고른 곳 수"를 셀 수 있게 된 시점까지 기다린다. 진행 줄은 일정 데이터에서
   * 현재 슬롯을 찾아야만 그려진다 — 도착 전에 ‹ 를 누르면 옳은 구현도 0곳으로 판정한다(02a ★5). */
  async function openConceptFace(slotKey: string): Promise<void> {
    renderSlot(slotKey);
    await screen.findByTestId('itinerary-copick-concept-progress');
  }

  function pressBack(): void {
    fireEvent.press(screen.getByTestId('itinerary-copick-concept-back'));
  }

  /** "안 나갔다"는 나갈 시간을 준 뒤에야 의미가 있다(02a ★4). */
  function settle(ms = 300): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function noRouting(): void {
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  }

  describe('🔴 B5 · 고른 곳이 0곳이면 ‹ 는 확인 없이 홈으로 (D3 · Q2)', () => {
    it('첫 비고정 슬롯(앞엔 고정 숙소뿐)에서 ‹ → 확인 창 없이 홈으로 replace 1회, 뒤로가기·push 0', async () => {
      // 준비
      await openConceptFace(KEY_A);

      // 실행
      pressBack();

      // 단언 ① 홈으로 나갔다(긍정 사건 — 아래 부재 단언의 짝).
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      // 단언 ② h02 로 돌아가는 뒤로가기가 아니고, 확인 창도 없었다(고른 게 없으니 잃을 것도 없다).
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.queryByTestId(LEAVE)).toBeNull();
    });
  });

  describe('🔴 B2 · 1곳 이상 골랐으면 ‹ 는 이탈 확인부터 (BR-U3-06·18 · #072)', () => {
    it.each<[string, number, string]>([
      ['1일차 둘째 비고정(b)', 1, KEY_B],
      ['2일차 첫 비고정(c) — 일자를 건너 센다', 2, KEY_C],
    ])(
      '%s 에서 ‹ → 확인 창에 "고른 %i곳 … 저장" · 확인 전 이동·요청 0',
      async (_label, picked, slotKey) => {
        // 준비
        await openConceptFace(slotKey);

        // 실행
        pressBack();

        // 단언 ① 확인 창이 떴고, 고른 수를 일자를 건너 센다.
        const dialog = screen.getByTestId(LEAVE);
        expect(dialog).toHaveTextContent(new RegExp(`고른 ${picked}곳`));
        // 단언 ② 사실대로 말한다 — 고른 곳은 확정마다 저장돼 있어 사라지지 않는다(Q2).
        expect(dialog).toHaveTextContent(/저장/);
        expect(dialog).not.toHaveTextContent(/사라/);
        // 단언 ③ 확인 전에는 아무 데도 안 가고, 아무것도 안 쏜다.
        await settle();
        noRouting();
        expect(generatePosts).toBe(0);
        expect(candidatePosts).toBe(0);
        expect(puts).toBe(0);
      }
    );
  });

  describe('🔴 B3 · [머무르기] → 확인만 닫히고 같은 슬롯 그대로', () => {
    it('확인 창이 사라지고 2일차 컨셉 얼굴이 그대로이며 이동·요청 0', async () => {
      await openConceptFace(KEY_C);
      pressBack();

      // 실행
      fireEvent.press(screen.getByTestId(`${LEAVE}-stay`));

      // 단언 ① 확인 창은 닫혔다 — 짝: 컨셉 얼굴은 떠 있다(아무것도 안 그려 통과하는 것 차단).
      expect(screen.queryByTestId(LEAVE)).toBeNull();
      expect(
        screen.getByTestId('itinerary-copick-concept-root')
      ).toBeOnTheScreen();
      // 단언 ② 같은 슬롯(2일차)이다.
      expect(
        screen.getByTestId('itinerary-copick-concept-progress-day')
      ).toHaveTextContent(/^2일차/);
      // 단언 ③ 이동·요청 0.
      await settle();
      noRouting();
      expect(generatePosts).toBe(0);
      expect(candidatePosts).toBe(0);
      expect(puts).toBe(0);
    });
  });

  describe('🔴 B4 · [나가기] → 홈으로, 필수 방문지(h02)로는 가지 않는다', () => {
    it('홈으로 replace 1회, 뒤로가기 0, 어느 목적지에도 must-visits 없음, 생성 POST 0', async () => {
      await openConceptFace(KEY_C);
      pressBack();

      // 실행
      fireEvent.press(screen.getByTestId(`${LEAVE}-leave`));

      // 단언 ① 홈으로 나간다(BR-U3-05 개정의 백그라운드 이탈과 같은 결).
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
      // 단언 ② h02 로 새지 않는다 — 뒤로가기도, must-visits 로의 전진도 없다.
      expect(mockBack).not.toHaveBeenCalled();
      const destinations = [
        ...mockPush.mock.calls,
        ...mockReplace.mock.calls,
      ].map((call) => JSON.stringify(call[0]));
      expect(destinations.some((d) => d.includes('must-visits'))).toBe(false);
      // 단언 ③ 나가기가 재생성을 부르지 않는다.
      await settle();
      expect(generatePosts).toBe(0);
    });
  });

  describe('🟢 B1 · 후보 얼굴의 ‹ 는 같은 슬롯의 컨셉 얼굴로 (회귀 잠금 · 02a ★10)', () => {
    it('컨셉을 골라 후보 얼굴로 간 뒤 ‹ → 컨셉 얼굴로 돌아오고 라우터는 안 부른다', async () => {
      await openConceptFace(KEY_A);
      fireEvent.press(screen.getByTestId('itinerary-copick-concept-culture'));
      await screen.findByTestId('itinerary-copick-slotfill-root');

      // 실행
      fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-back'));

      // 단언 — 컨셉 얼굴로 돌아왔고(라우트 이동 없이 얼굴만 바뀜), 확인 창도 없다.
      expect(
        screen.getByTestId('itinerary-copick-concept-root')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-copick-slotfill-root')).toBeNull();
      expect(screen.queryByTestId(LEAVE)).toBeNull();
      noRouting();
    });
  });
});

// TRIP-1024 · 옛 SlotFillPage.names.integration.test.tsx
describe('후보 카드 이름·태그·사진', () => {
  /**
   * TRIP-1024 · AC-3·4·6·7 — h10 같이 짜기 후보 선택이 후보 응답의 이름·태그·사진을 **실 HTTP 로** 받아
   * 그린다(QA #070).
   *
   * 무엇을 보장하나:
   *  - 🔴 F1 응답 `nameKo`·`tags` 가 카드 이름 leaf·태그 leaf 로 뜬다(페이지가 값을 버리면 red).
   *  - 🔴 F2 `imageUrl` 이 있으면 같은 testID leaf 가 그 URL 을 source 로, null·'' 면 source 없는 회색 자리.
   *    크기는 h10 **78**(Figma `3849:2272`, Q1) · `rounded-thumb` — h08(56)과 갈린다.
   *  - 🔴 F3 `nameKo` null → 플레이스홀더, poiId 원문 비노출(INV-1).
   *  - 🔴 F4 후보 카드 텍스트에 소요시간 단위 0(INV-3).
   *
   * 기존 `SlotFillPage.integration.test.tsx` 공유 픽스처는 건드리지 않는다 — 그 파일의 후보 루트 정규식이
   * `tags-` 를 제외하지 않아, 태그를 거기 넣으면 무관한 개수 단언이 깨진다. 그래서 픽스처를 여기 따로 둔다.
   *
   * 3동작: 준비=가짜 서버 응답(GET 일정 + POST 후보) → 실행=페이지 마운트 후 컨셉 탭 → 단언=보이는 leaf.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '22222222-2222-2222-2222-222222222222';

  // TRIP-1043 — 페이지가 진행 줄 여행지 접두를 위해 여행(`GET /trips/:tripId`)을 조회한다. 이 파일은 접두를
  // 재지 않으므로 여행지 없는 여행으로 답한다(접두 생략 degrade — 기존 `N일차` 단언이 그대로 유효). 핸들러를
  // 빼면 MSW 'error' 전략이 console.error 만 찍고 쿼리를 조용히 실패시켜 누락이 드러나지 않는다(02a ★1).
  const TRIP_NO_DESTINATIONS: Trip = {
    tripId: TRIP_ID,
    title: '테스트 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-11',
    party: 1,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 1,
  };
  const DAY1 = '2026-06-10';
  const SLOT_KEY = buildSlotKey(DAY1, 'a');

  const X_IMG = 'https://img.example/x.jpg';
  /** 정본에 값이 없는 후보 — poiId 원문이 새면 바로 보이도록 일부러 튀는 id. */
  const RAW_ID = 'poi-raw-7788';

  function itinerary(): Itinerary {
    return {
      itineraryId: 'itin-2',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'CO_PLAN',
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
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(TRIP_NO_DESTINATIONS)
      ),
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
    return render(<SlotFillPage tripId={TRIP_ID} slotKey={SLOT_KEY} />, {
      wrapper: Wrapper,
    });
  }

  /** 마운트 → 컨셉(전시·문화) 탭 → 후보 3개가 다 그려질 때까지 기다린다. */
  async function renderAndPickConcept() {
    renderPage();
    await screen.findByTestId('itinerary-copick-concept-culture');
    fireEvent.press(screen.getByTestId('itinerary-copick-concept-culture'));
    for (const id of ALL_IDS) {
      await screen.findByTestId(`itinerary-candidate-${id}`);
    }
  }

  /** className 을 공백으로 쪼갠 토큰 목록 — `min-h-[78px]` 같은 부분 일치 오탐을 막는다. */
  const classTokens = (testID: string): string[] =>
    String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);

  const THUMB_78 = ['h-[78px]', 'w-[78px]', 'rounded-thumb'];

  /** 소요시간 단위(INV-3) — 거리만 보여야 한다. */
  const DURATION = /분|시간|\bmin\b|소요/;

  describe('🔴 TRIP-1024 h10 후보 카드 — 이름·태그·사진', () => {
    it('F1 · AC-3 — 응답 nameKo·tags 가 카드 이름 leaf·태그 leaf 로 뜬다', async () => {
      await renderAndPickConcept();

      expect(
        screen.getByTestId('itinerary-candidate-name-X')
      ).toHaveTextContent('남부산교회');
      expect(
        screen.getByTestId('itinerary-candidate-name-Z')
      ).toHaveTextContent('해동용궁사');
      // h10 태그 표기(`#` 위치)는 Figma 와 드리프트 중이라 내용만 잰다(정규식 = 부분 포함).
      const tags = screen.getByTestId('itinerary-candidate-tags-X');
      expect(tags).toHaveTextContent(/교회/);
      expect(tags).toHaveTextContent(/야외/);
    });

    it('F2 · AC-4·Q1·비주얼(a) — 사진 있으면 그 URL 이 source, null·빈 문자열이면 source 없는 회색 자리(78·thumb)', async () => {
      await renderAndPickConcept();

      expect(
        screen.getByTestId('itinerary-candidate-image-X').props.source
      ).toEqual({ uri: X_IMG });
      // 회색 자리도 testID 는 유지된다(존재) — 그리고 이미지 source 는 없다(부재).
      for (const id of [RAW_ID, 'Z']) {
        const leaf = screen.getByTestId(`itinerary-candidate-image-${id}`);
        expect(leaf.props.source).toBeUndefined();
      }
      for (const id of ALL_IDS) {
        expect(classTokens(`itinerary-candidate-image-${id}`)).toEqual(
          expect.arrayContaining(THUMB_78)
        );
      }
    });

    it('F3 · AC-6·INV-1 — nameKo null 이면 플레이스홀더, poiId 원문은 화면 어디에도 없다', async () => {
      await renderAndPickConcept();

      expect(
        screen.getByTestId(`itinerary-candidate-name-${RAW_ID}`)
      ).toHaveTextContent('이름 준비 중');
      // 긍정 짝 — 이름 매핑 자체는 살아 있다.
      expect(
        screen.getByTestId('itinerary-candidate-name-X')
      ).toHaveTextContent('남부산교회');
      expect(screen.queryByText(new RegExp(RAW_ID))).toBeNull();
    });

    it('F4 · AC-7·INV-3 — 후보 카드 텍스트에 소요시간 단위가 없다', async () => {
      await renderAndPickConcept();

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

// TRIP-794 · 옛 SlotFillPage.parity.integration.test.tsx
describe('진행줄·스텝퍼 배선', () => {
  /**
   * TRIP-794 · h09 진행줄·스텝퍼 **배선**(AC-9) — SlotFillPage 가 itinerary GET 캐시에서 진행줄·
   * 스텝퍼 props 를 조립해 순수 화면(ConceptPickerScreen)에 내리고, 스텝퍼(위젯)는 층 경계상 pages 가
   * 노드로 조립해 `stepperSlot` 으로 내린다.
   *
   * 동결 앵커는 형제 `SlotFillPage.integration.test.tsx`(C1~C14·U3 문맥줄)가 무변경으로 지킨다 —
   * 이 파일은 새 조립만 잰다.
   *
   * 무엇을 보장하나:
   *  - 🔴 W1 진행줄: GET 도착 후 진행줄이 뜨고 슬롯 수가 **위치 도출**(비고정 index+1 / 총수)이다.
   *  - 🔴 W2 스텝퍼 상태 라벨을 **슬롯 위치로 결정론 도출**한다(current 이전=고름·current=지금 고르는
   *       중·이후=비어 있음, seed D1).
   *  - 🔴 W3 이전 단 제목 = 직전 슬롯 이름(GET 캐시).
   *  - 🔴 W4 현재 단 제목: category 있으면 그것(D1).
   *  - 🔴 W5 degrade: category 없으면 시간대 라벨만(D1).
   *  - 🔴 W6 INV-3: 조립된 어느 표면에도 소요시간 0.
   *
   * 3동작: 준비=MSW 로 GET 고정 → 실행=SlotFillPage 마운트(컨셉 화면) → 단언=진행줄·스텝퍼 렌더값.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '33333333-3333-3333-3333-333333333333';

  // TRIP-1043 — 페이지가 진행 줄 여행지 접두를 위해 여행(`GET /trips/:tripId`)을 조회한다. 이 파일은 접두를
  // 재지 않으므로 여행지 없는 여행으로 답한다(접두 생략 degrade — 기존 `N일차` 단언이 그대로 유효). 핸들러를
  // 빼면 MSW 'error' 전략이 console.error 만 찍고 쿼리를 조용히 실패시켜 누락이 드러나지 않는다(02a ★1).
  const TRIP_NO_DESTINATIONS: Trip = {
    tripId: TRIP_ID,
    title: '테스트 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-11',
    party: 1,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 1,
  };
  const DAY1 = '2026-06-10';

  const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

  // 슬롯 하나 만들기 헬퍼(계약 필수 필드 + 넘긴 것만 덮어쓰기).
  function slot(
    over: Partial<ItineraryDaysItemSlotsItem> & {
      poiId: string;
      startAt: string;
    }
  ): ItineraryDaysItemSlotsItem {
    return {
      endAt: '00:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      ...over,
    };
  }

  // day1 = [a 경복궁 09:30, b 13:00(category 전시), c 15:00] — 셋 다 비고정.
  function itinerary(currentHasCategory: boolean): Itinerary {
    const days: ItineraryDaysItem[] = [
      {
        date: DAY1,
        slots: [
          slot({ poiId: 'a', nameKo: '경복궁', startAt: '09:30:00' }),
          slot({
            poiId: 'b',
            startAt: '13:00:00',
            category: currentHasCategory ? '전시' : null,
          }),
          slot({ poiId: 'c', startAt: '15:00:00' }),
        ],
      },
    ];
    return {
      itineraryId: 'itin-3',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'CO_PLAN',
      generationState: 'COMPLETE',
      isFallback: false,
      days,
    };
  }

  let currentHasCategory = true;

  beforeEach(() => {
    currentHasCategory = true;
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(TRIP_NO_DESTINATIONS)
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary(currentHasCategory))
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  // slotKey=b(가운데 비고정 슬롯) 로 진입 — prev=a, current=b, next=c.
  function renderAtSlotB() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(
      <SlotFillPage tripId={TRIP_ID} slotKey={buildSlotKey(DAY1, 'b')} />,
      { wrapper: Wrapper }
    );
  }

  describe('🔴 SlotFillPage — 진행줄·스텝퍼 배선(AC-9)', () => {
    it('W1 · 진행줄 카운트가 위치 도출(가운데 슬롯 → 2번째 / 3)이고 일차 라벨이 뜬다', async () => {
      renderAtSlotB();

      // GET 도착 후 진행줄이 뜬다(비동기).
      await screen.findByTestId('itinerary-copick-concept-progress');

      // 슬롯 수 = 비고정 index(b=1)+1 / 총 비고정 3 → '2번째 / 3'(위치 도출, Figma 고정 3/4 픽스처와 다름).
      expect(
        screen.getByTestId('itinerary-copick-concept-progress-count')
      ).toHaveTextContent('2번째 / 3');

      // 일차 라벨은 '1일차' 를 포함한다(정확 날짜 서식은 6-b).
      expect(
        screen.getByTestId('itinerary-copick-concept-progress-day')
      ).toHaveTextContent(/1일차/);
    });

    it('W2 · 스텝퍼 상태 라벨을 슬롯 위치로 도출한다(고름/지금 고르는 중/비어 있음)', async () => {
      renderAtSlotB();

      expect(
        await screen.findByTestId('copick-stepper-prev-status')
      ).toHaveTextContent('고름');
      expect(
        screen.getByTestId('copick-stepper-current-status')
      ).toHaveTextContent('지금 고르는 중');
      expect(
        screen.getByTestId('copick-stepper-next-status')
      ).toHaveTextContent('비어 있음');
    });

    it('W3 · 이전 단 제목 = 직전 슬롯 이름(경복궁)', async () => {
      renderAtSlotB();

      expect(
        await screen.findByTestId('copick-stepper-prev-title')
      ).toHaveTextContent('경복궁');
    });

    it('W4 · 현재 단 제목: category 있으면 그것(전시)', async () => {
      currentHasCategory = true;
      renderAtSlotB();

      // 부분매치(정규식) — '{시간대} · 전시' 든 '전시' 든 category 를 담는다.
      expect(
        await screen.findByTestId('copick-stepper-current-title')
      ).toHaveTextContent(/전시/);
    });

    it('W5 · degrade: category 없으면 시간대 라벨만(전시 없음)', async () => {
      currentHasCategory = false;
      renderAtSlotB();

      const title = await screen.findByTestId('copick-stepper-current-title');
      // category 미주입 → '전시' 없고, 시간대 라벨(점심 등)로 degrade.
      expect(title).not.toHaveTextContent(/전시/);
      expect(title).toHaveTextContent(/오전|점심|오후|저녁/);
    });

    it('W6 · INV-3 — 조립된 어느 표면에도 소요시간 0', async () => {
      renderAtSlotB();
      await screen.findByTestId('itinerary-copick-concept-progress');
      expect(screen.queryByText(DURATION_TEXT)).toBeNull();
    });
  });
});

// TRIP-978 · 옛 SlotFillPage.partial.integration.test.tsx
describe('PARTIAL 폴링·확정 잠금·조회 실패', () => {
  /**
   * TRIP-978 · 같이 짜기 슬롯 채우기가 생성 중(PARTIAL) 일정에 갇히지 않는다.
   *
   * 무엇을 보장하나:
   *  - AC-1·AC-2: PARTIAL 인 동안 일정 GET 을 다시 부르고, COMPLETE·FAILED 에 닿으면 멈춘다(상한 없음, Q1).
   *  - AC-3·AC-4: PARTIAL 동안 'X로 선택'은 비활성 + "나머지 일정을 만드는 중이에요", PUT 0(INV-4).
   *  - AC-5·AC-6: COMPLETE 로 풀리면 확정이 되고, day1 마지막 슬롯은 complete 가 아니라 2일차로 전진한다.
   *    진행 줄 총 일수도 2 가 된다.
   *  - AC-7(Q2): 후보 조회 409 는 사유 문구로 말한다(0건 얼굴로 속이지 않음). 막힌 채 잠금이 풀리면 같은
   *    컨셉·반경으로 1회 다시 조회한다. 조회 중엔 0건 얼굴을 띄우지 않는다.
   *
   * 3동작: 준비=GET 응답을 호출 차수별로 정한다(itineraryScript) → 실행=머물거나 조작 → 단언=나간 요청 수·보이는 문구.
   * 폴링은 실타이머로 한 간격(2초)만 흘린다(DraftPage.integration I1 선례).
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '33333333-3333-3333-3333-333333333333';

  // TRIP-1043 — 페이지가 진행 줄 여행지 접두를 위해 여행(`GET /trips/:tripId`)을 조회한다. 이 파일은 접두를
  // 재지 않으므로 여행지 없는 여행으로 답한다(접두 생략 degrade — 기존 `N일차` 단언이 그대로 유효). 핸들러를
  // 빼면 MSW 'error' 전략이 console.error 만 찍고 쿼리를 조용히 실패시켜 누락이 드러나지 않는다(02a ★1).
  const TRIP_NO_DESTINATIONS: Trip = {
    tripId: TRIP_ID,
    title: '테스트 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-11',
    party: 1,
    preferenceSnapshot: {},
    destinations: [],
    status: 'PLANNED',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    baseCount: 0,
    itineraryDayCount: 1,
  };
  const DAY1 = '2026-10-12';
  const DAY2 = '2026-10-13';
  const POLL_TEST_TIMEOUT = 30000;
  // 폴링을 기다리는 waitFor 한도 — 간격의 5배. 3배(6초)는 CI 러너 부하에서 모자라 P-FAILED·P-UNLOCK 이
  // 간헐 실패했다(PR #755 첫 CI). 단언 내용은 그대로, 기다리는 시간만 늘린다.
  const POLL_WAIT_MS = DRAFT_POLL_INTERVAL_MS * 5;
  const LOCKED_TEXT = '나머지 일정을 만드는 중이에요';
  // resolveSlotSwapError 폴백 문구(slotSwapError.ts MESSAGE.fallback) — 실서버 409 코드는 늘 CONFLICT 라 여기로 떨어진다.
  const FALLBACK_TEXT = '지금은 바꿀 수 없어요. 잠시 후 다시 시도해 주세요';
  const CONFLICT_BODY = {
    error: {
      code: 'CONFLICT',
      message: '일정 생성이 진행 중입니다. 완료 후 교체할 수 있습니다.',
    },
  };

  function slot(poiId: string, startAt: string, endAt: string) {
    return {
      poiId,
      startAt,
      endAt,
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
    };
  }

  // 2일 여행 — day1 [a, b], day2 [c]. PARTIAL 은 day1 만 담긴다(openapi POST 201).
  function itinerary(state: ItineraryGenerationState): Itinerary {
    const day1: ItineraryDaysItem = {
      date: DAY1,
      slots: [
        slot('a', '09:30:00', '11:00:00'),
        slot('b', '13:00:00', '14:00:00'),
      ],
    };
    const day2: ItineraryDaysItem = {
      date: DAY2,
      slots: [slot('c', '10:00:00', '11:30:00')],
    };
    return {
      itineraryId: 'itin-978',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'CO_PLAN',
      generationState: state,
      isFallback: false,
      days: state === 'COMPLETE' ? [day1, day2] : [day1],
    };
  }

  const CANDIDATES = {
    candidates: [
      { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
      { poiId: 'Y', distanceRange: '770m', rationale: '조용한 카페' },
    ],
    radiusMUsed: 1100,
  };

  // 테스트별로 바꿔 끼우는 응답 대본 — call 은 0부터 센 호출 차수.
  let itineraryScript: (call: number) => Itinerary;
  let candidatesScript: (call: number) => Response | Promise<Response>;
  let getCalls = 0;
  let postCalls = 0;
  let postBodies: SlotCandidatesRequest[] = [];
  let putCalls = 0;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  beforeEach(() => {
    getCalls = 0;
    postCalls = 0;
    postBodies = [];
    putCalls = 0;
    mockBack.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
    itineraryScript = () => itinerary('COMPLETE');
    candidatesScript = () => HttpResponse.json(CANDIDATES);
    setAccessToken('valid-access');

    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json(TRIP_NO_DESTINATIONS)
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () => {
        const call = getCalls;
        getCalls += 1;
        return HttpResponse.json(itineraryScript(call));
      }),
      http.post(
        `${BASE}/trips/:tripId/itinerary/slot-candidates`,
        async ({ request }) => {
          const call = postCalls;
          postCalls += 1;
          postBodies.push((await request.json()) as SlotCandidatesRequest);
          return candidatesScript(call);
        }
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, () => {
        putCalls += 1;
        return HttpResponse.json(itinerary('COMPLETE'));
      })
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
  });

  // TRIP-1096 D-FAILED — 화면이 FAILED 응답을 실제로 받았는지 캐시로 기다리려고 마지막 client 를 쥔다.
  let lastClient: QueryClient | null = null;

  function renderPage(slotKey: string = buildSlotKey(DAY1, 'a')) {
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
    lastClient = client;
    return render(<SlotFillPage tripId={TRIP_ID} slotKey={slotKey} />, {
      wrapper: Wrapper,
    });
  }

  async function pickConcept(key = 'culture') {
    fireEvent.press(
      await screen.findByTestId(`itinerary-copick-concept-${key}`)
    );
  }

  function conflict() {
    return HttpResponse.json(CONFLICT_BODY, { status: 409 });
  }

  describe('🔴 TRIP-978 · PARTIAL 폴링 (AC-1·AC-2)', () => {
    it(
      'P-POLL · PARTIAL 이면 일정을 다시 조회하고, COMPLETE 를 받은 뒤엔 더 조회하지 않는다',
      async () => {
        itineraryScript = (call) =>
          call === 0 ? itinerary('PARTIAL') : itinerary('COMPLETE');

        renderPage();

        await waitFor(() => expect(getCalls).toBe(2), {
          timeout: POLL_WAIT_MS,
        });
        await sleep(DRAFT_POLL_INTERVAL_MS + 400);
        expect(getCalls).toBe(2);
      },
      POLL_TEST_TIMEOUT
    );

    it(
      'P-FAILED · FAILED 에 닿아도 조회가 멈추고 확정 잠금이 풀린다',
      async () => {
        itineraryScript = (call) =>
          call === 0 ? itinerary('PARTIAL') : itinerary('FAILED');

        renderPage();
        await pickConcept();
        fireEvent.press(
          await screen.findByTestId('itinerary-candidate-radio-X')
        );

        await waitFor(() => expect(getCalls).toBe(2), {
          timeout: POLL_WAIT_MS,
        });
        await waitFor(
          () =>
            expect(
              screen.queryByTestId('itinerary-copick-confirm-locked')
            ).toBeNull(),
          { timeout: POLL_WAIT_MS }
        );
        expect(
          screen.getByTestId('itinerary-copick-slotfill-confirm').props
            .accessibilityState?.disabled
        ).not.toBe(true);

        await sleep(DRAFT_POLL_INTERVAL_MS + 400);
        expect(getCalls).toBe(2);
      },
      POLL_TEST_TIMEOUT
    );
  });

  describe('🔴 TRIP-978 · 생성 중 확정 잠금과 해제 (AC-3~AC-6)', () => {
    it('P-LOCK · PARTIAL 동안 골라도 확정 버튼은 비활성이고 잠금 사유가 보이며 PUT 이 안 나간다', async () => {
      itineraryScript = () => itinerary('PARTIAL');

      renderPage();
      await pickConcept();
      fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-X'));
      const confirm = screen.getByTestId('itinerary-copick-slotfill-confirm');
      fireEvent.press(confirm);
      // PUT 이 나갔다면 이 대기 동안 핸들러가 셀 시간을 준다("안 나갔다"는 시간을 흘려야 잰다).
      await sleep(50);

      expect(confirm.props.accessibilityState?.disabled).toBe(true);
      expect(
        screen.getByTestId('itinerary-copick-confirm-locked')
      ).toHaveTextContent(LOCKED_TEXT);
      expect(putCalls).toBe(0);
      expect(mockReplace).toHaveBeenCalledTimes(0);
    });

    it(
      'P-UNLOCK · 폴링으로 COMPLETE 가 오면 확정이 풀리고, 1일차 마지막 슬롯은 complete 가 아니라 2일차 슬롯으로 전진한다',
      async () => {
        itineraryScript = (call) =>
          call === 0 ? itinerary('PARTIAL') : itinerary('COMPLETE');

        renderPage(buildSlotKey(DAY1, 'b')); // 1일차의 마지막 비고정 슬롯
        await pickConcept();
        fireEvent.press(
          await screen.findByTestId('itinerary-candidate-radio-X')
        );
        // 처음엔 잠겨 있다.
        expect(
          screen.getByTestId('itinerary-copick-confirm-locked')
        ).toBeTruthy();

        // 폴링이 COMPLETE 를 받아 오면 잠금이 풀린다.
        await waitFor(
          () =>
            expect(
              screen.queryByTestId('itinerary-copick-confirm-locked')
            ).toBeNull(),
          { timeout: POLL_WAIT_MS }
        );
        const confirm = screen.getByTestId('itinerary-copick-slotfill-confirm');
        expect(confirm.props.accessibilityState?.disabled).not.toBe(true);
        fireEvent.press(confirm);

        await waitFor(() => expect(putCalls).toBe(1));
        await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
        const destination = JSON.stringify(mockReplace.mock.calls[0][0]);
        expect(destination).toContain(buildSlotKey(DAY2, 'c'));
        expect(destination).not.toContain('complete');
        // 성공한 조회 뒤의 잠금 해제는 후보를 다시 부르지 않는다(Q2 — 실패였을 때만 재조회).
        expect(postCalls).toBe(1);
      },
      POLL_TEST_TIMEOUT
    );

    it(
      'P-DAYS · 2일 여행이 COMPLETE 로 갱신되면 진행 줄이 "1일차 / 2" 다',
      async () => {
        itineraryScript = (call) =>
          call === 0 ? itinerary('PARTIAL') : itinerary('COMPLETE');

        renderPage();
        // TRIP-1096 — PARTIAL(days=[day1]) 첫 화면부터 분모는 여행 기간 2다("/ 1" 을 거치지 않는다).
        await waitFor(() =>
          expect(
            screen.getByTestId('itinerary-copick-concept-progress-day')
          ).toHaveTextContent(/^1일차 \/ 2 · /)
        );
        expect(getCalls).toBe(1);
        await pickConcept();

        await waitFor(
          () =>
            expect(
              screen.getByTestId('itinerary-copick-slotfill-progress-day')
            ).toHaveTextContent(/^1일차 \/ 2 · /),
          { timeout: POLL_WAIT_MS }
        );
      },
      POLL_TEST_TIMEOUT
    );
  });

  describe('🔴 TRIP-978 · 후보 조회 실패를 말한다 (AC-7 · Q2)', () => {
    it('P-409-PARTIAL · 생성 중 후보 조회가 409 면 "나머지 일정을 만드는 중이에요"를 보이고 0건 얼굴을 띄우지 않는다', async () => {
      itineraryScript = () => itinerary('PARTIAL');
      candidatesScript = conflict;

      renderPage();
      await pickConcept();

      const error = await screen.findByTestId(
        'itinerary-copick-candidates-error'
      );
      expect(error).toHaveTextContent(LOCKED_TEXT);
      expect(screen.queryByTestId('itinerary-copick-zero')).toBeNull();
    });

    it('P-409-COMPLETE · 생성이 끝난 뒤의 409 는 공통 폴백 문구로 말하고 0건 얼굴을 띄우지 않는다', async () => {
      itineraryScript = () => itinerary('COMPLETE');
      candidatesScript = conflict;

      renderPage();
      await pickConcept();

      const error = await screen.findByTestId(
        'itinerary-copick-candidates-error'
      );
      expect(error).toHaveTextContent(FALLBACK_TEXT);
      expect(screen.queryByTestId('itinerary-copick-zero')).toBeNull();
    });

    it(
      'P-REQUERY · 409 로 막힌 채 잠금이 풀리면 같은 컨셉·반경으로 딱 한 번 다시 조회해 후보를 보인다',
      async () => {
        itineraryScript = (call) =>
          call === 0 ? itinerary('PARTIAL') : itinerary('COMPLETE');
        candidatesScript = (call) =>
          call === 0 ? conflict() : HttpResponse.json(CANDIDATES);

        renderPage();
        await pickConcept();
        await screen.findByTestId('itinerary-copick-candidates-error');

        await screen.findByTestId(
          'itinerary-candidate-radio-X',
          {},
          { timeout: POLL_WAIT_MS }
        );
        expect(
          screen.queryByTestId('itinerary-copick-candidates-error')
        ).toBeNull();
        expect(postCalls).toBe(2);
        expect(postBodies[1].concept).toBe('전시·문화');
        expect(postBodies[1].radiusM).toBe(1100);

        await sleep(DRAFT_POLL_INTERVAL_MS + 400);
        expect(postCalls).toBe(2);
      },
      POLL_TEST_TIMEOUT
    );

    it(
      'P-NO-REQUERY · 잠긴 적 없이(처음부터 COMPLETE) 후보 조회가 409 면 자동으로 다시 조회하지 않는다',
      async () => {
        itineraryScript = () => itinerary('COMPLETE');
        candidatesScript = conflict;

        renderPage();
        await pickConcept();
        await screen.findByTestId('itinerary-copick-candidates-error');

        await sleep(DRAFT_POLL_INTERVAL_MS + 400);
        expect(postCalls).toBe(1);
      },
      POLL_TEST_TIMEOUT
    );

    it('P-PENDING ·후보 조회가 아직 안 끝났으면 "못 찾았어요" 0건 얼굴을 띄우지 않는다', async () => {
      candidatesScript = async () => {
        await delay('infinite');
        return HttpResponse.json(CANDIDATES);
      };

      renderPage();
      await pickConcept();
      await waitFor(() => expect(postCalls).toBe(1));

      expect(screen.getByTestId('itinerary-copick-slotfill-root')).toBeTruthy();
      expect(screen.queryByTestId('itinerary-copick-zero')).toBeNull();
    });
  });

  /**
   * TRIP-1096 · 같이 짜기 진행 줄 분모 = 여행 기간(QA-2026-09-29 A15).
   *
   * 무엇을 보장하나: 생성 중(PARTIAL)·2차 실패(FAILED)로 일정에 day1 만 있어도, 진행 줄 "N일차 / 총" 의 총과
   * 진행바 칸 수는 여행 startDate~endDate 일수(2)다. 여행을 아직 모르거나 조회가 실패하면 틀린 숫자 대신
   * 분모와 진행바 칸을 아예 안 그린다(결정 1 · INV-4). 분자는 일정 days 안 순번 그대로다(결정 2) — 이 파일의
   * 여행 startDate(6/10)와 일정 날짜(10/12)는 일부러 다르다. 날짜 차로 셌다면 분자가 1이 아니다.
   *
   * 3동작: 준비 = 일정 GET 대본(PARTIAL/FAILED) + 여행 GET(2일 · 대기 · 실패) → 실행 = 화면 열기(·컨셉 고르기)
   * → 단언 = 진행 줄 글자와 진행바 칸 수(채움 + 트랙).
   */
  describe('🔴 TRIP-1096 · 진행 줄 분모 = 여행 기간', () => {
    function conceptCells(): number {
      return (
        screen.queryAllByTestId('itinerary-copick-concept-progress-cell-filled')
          .length +
        screen.queryAllByTestId('itinerary-copick-concept-progress-cell-track')
          .length
      );
    }

    it('D-PARTIAL · day1 만 온 2일 여행 — 컨셉·후보 화면 둘 다 "1일차 / 2"이고 진행바 칸이 2개다', async () => {
      itineraryScript = () => itinerary('PARTIAL');

      renderPage();

      const conceptDay = await screen.findByTestId(
        'itinerary-copick-concept-progress-day'
      );
      await waitFor(() =>
        expect(conceptDay).toHaveTextContent(/^1일차 \/ 2 · /)
      );
      expect(conceptCells()).toBe(2);
      expect(
        screen.getAllByTestId('itinerary-copick-concept-progress-cell-filled')
      ).toHaveLength(1);

      await pickConcept();
      expect(
        await screen.findByTestId('itinerary-copick-slotfill-progress-day')
      ).toHaveTextContent(/^1일차 \/ 2 · /);
      expect(
        screen.getAllByTestId('itinerary-copick-slotfill-progress-cell-filled')
          .length +
          screen.queryAllByTestId(
            'itinerary-copick-slotfill-progress-cell-track'
          ).length
      ).toBe(2);
    });

    it(
      'D-FAILED · 2차가 FAILED 로 끝나 day1 만 남아도 분모는 2다',
      async () => {
        itineraryScript = (call) =>
          call === 0 ? itinerary('PARTIAL') : itinerary('FAILED');

        renderPage();

        // PARTIAL 과 FAILED 의 진행 줄 글자가 같아서, "두 번째 요청이 나갔다"만 기다리면 아직 PARTIAL 인 화면을
        // 재고 통과할 수 있다(03b 경고 1). 캐시에 FAILED 가 들어온 것을 먼저 기다린 뒤 잰다.
        await waitFor(
          () =>
            expect(
              lastClient
                ?.getQueryCache()
                .findAll()
                .map(
                  (query) =>
                    (query.state.data as Itinerary | undefined)?.generationState
                )
            ).toContain('FAILED'),
          { timeout: POLL_WAIT_MS }
        );
        // 캐시 갱신 뒤 구독 화면의 다시 그리기를 끝까지 흘려보낸 다음 잰다 — 안 하면 아직 PARTIAL 로 그려진
        // 화면(글자가 같다)을 재고 통과할 수 있다.
        await act(async () => {
          await sleep(50);
        });
        expect(
          screen.getByTestId('itinerary-copick-concept-progress-day')
        ).toHaveTextContent(/^1일차 \/ 2 · /);
        expect(conceptCells()).toBe(2);
      },
      POLL_TEST_TIMEOUT
    );

    it('D-LOADING · 여행 조회가 아직이면 분모·진행바 칸 없이 "1일차 · ", 도착하면 "1일차 / 2"', async () => {
      let releaseTrip: () => void = () => undefined;
      const tripGate = new Promise<void>((resolve) => {
        releaseTrip = resolve;
      });
      server.use(
        http.get(`${BASE}/trips/:tripId`, async () => {
          await tripGate;
          return HttpResponse.json(TRIP_NO_DESTINATIONS);
        })
      );
      itineraryScript = () => itinerary('PARTIAL');

      renderPage();

      const day = await screen.findByTestId(
        'itinerary-copick-concept-progress-day'
      );
      expect(day).toHaveTextContent(/^1일차 · /);
      expect(day).not.toHaveTextContent(/\//);
      // 진행 줄이 떠 있는데(루트 존재) 칸이 0 — "안 그렸다"가 의미를 갖게 짝으로 잰다.
      expect(
        screen.getByTestId('itinerary-copick-concept-progress')
      ).toBeTruthy();
      expect(conceptCells()).toBe(0);

      releaseTrip();
      await waitFor(() => expect(day).toHaveTextContent(/^1일차 \/ 2 · /));
      expect(conceptCells()).toBe(2);
    });

    it('D-ERROR · 여행 조회가 실패하면 분모·진행바 칸 없이 "1일차 · "다(일정 days 길이로 폴백하지 않는다)', async () => {
      let tripCalls = 0;
      server.use(
        http.get(`${BASE}/trips/:tripId`, () => {
          tripCalls += 1;
          return HttpResponse.json(
            { code: 'INTERNAL', message: 'boom' },
            { status: 500 }
          );
        })
      );
      itineraryScript = () => itinerary('PARTIAL');

      renderPage();

      await waitFor(() => expect(tripCalls).toBe(1));
      const day = await screen.findByTestId(
        'itinerary-copick-concept-progress-day'
      );
      await waitFor(() => expect(day).toHaveTextContent(/^1일차 · /));
      expect(day).not.toHaveTextContent(/\//);
      expect(conceptCells()).toBe(0);
    });
  });
});
