import type { ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/features/itinerary/model/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { OptionSwapPage } from './OptionSwapPage';

/**
 * h18 같이 고르기 옵션 교체 배선 — h12 와 **같은 오퍼레이션**(POST 후보 → 치환 → PUT)이지만
 * 확정 UX 가 2단계다: 라디오 단일선택 후 "B로 교체" CTA 를 눌러야 확정하고, 성공 시 router.back()
 * 으로 진입 지점으로 pop 한다.
 *
 * 무엇을 보장하나:
 *  - 선택 없이 CTA 를 눌러도 PUT 0(2단계 게이트, AC3).
 *  - 라디오 → "교체" → PUT 1건에 **같은 치환**(a→X)이 실린다 = BR-U3-23 공통 증명 · 성공 시 back(AC3).
 *
 * 실패·이중발사 등 공통 갈래는 h12 통합(T5)·순수함수(T1/T2)가 이미 잠근다 — 여기선 2단계·back 차이만.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=라디오+확정 → 단언=나간 요청·router.back.
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

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack, replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const DAY1 = '2026-06-10';
const CURRENT_SLOT_KEY = buildSlotKey(DAY1, 'a');

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
          tags: [],
        },
        {
          poiId: 'b',
          startAt: '13:00:00',
          endAt: '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
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

const CANDIDATES = {
  candidates: [
    { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
    { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
  ],
  radiusMUsed: 1100,
};

let postCalls = 0;
let putCalls = 0;
let putBody: unknown = null;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  postCalls = 0;
  putCalls = 0;
  putBody = null;
  mockBack.mockClear();
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.post(`${BASE}/trips/:tripId/itinerary/slot-candidates`, () => {
      postCalls += 1;
      return HttpResponse.json(CANDIDATES);
    }),
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

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <OptionSwapPage tripId={TRIP_ID} slotKey={CURRENT_SLOT_KEY} />,
    { wrapper: Wrapper }
  );
}

describe('🔴 OptionSwapPage (h18) 배선', () => {
  it('C1 · 마운트에 slot-candidates POST, 후보 라디오가 뜬다', async () => {
    renderPage();

    await waitFor(() => expect(postCalls).toBe(1));
    await screen.findByTestId('itinerary-candidate-radio-X');
  });

  it('C2 · AC3 2단계 — 라디오 선택 없이 CTA 를 눌러도 PUT 0 · back 없음', async () => {
    renderPage();
    await screen.findByTestId('itinerary-candidate-radio-X');

    fireEvent.press(screen.getByTestId('itinerary-option-swap-confirm'));

    // 선택 전에는 확정이 나가지 않는다.
    await waitFor(() => expect(postCalls).toBe(1)); // 마운트 POST 만
    expect(putCalls).toBe(0);
    expect(mockBack).toHaveBeenCalledTimes(0);
  });

  it('C3 · AC3 — 라디오 → "교체" → PUT 1건(같은 치환) → router.back()', async () => {
    renderPage();
    await screen.findByTestId('itinerary-candidate-radio-X');

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-option-swap-confirm'));

    await waitFor(() => expect(putCalls).toBe(1));
    // 같은 치환 = 같은 PUT — h12 와 한 오퍼레이션임을 증명(BR-U3-23).
    expect((putBody as EditItineraryRequest).days[0].slots[0].poiId).toBe('X');

    // 성공 → 진입 지점으로 pop.
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });

  // 5-b 경고1 봉합 — h12 와 같은 이중발사 위험을 h18 에도 잠근다(firedRef 강제).
  it('C4 · 같은 틱 확정 CTA 2회 연타여도 PUT 은 1건이다(firedRef)', async () => {
    renderPage();
    await screen.findByTestId('itinerary-candidate-radio-X');

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    const confirm = await screen.findByTestId('itinerary-option-swap-confirm');
    // 선택 반영으로 CTA 가 활성화될 때까지 — 그래야 두 press 가 disabled 아닌 버튼에 닿는다.
    await waitFor(() =>
      expect(confirm.props.accessibilityState?.disabled).not.toBe(true)
    );

    // 펜딩이 전파(재렌더)되기 전 같은 틱에 두 번 — firedRef 없으면 둘째가 통과해 PUT 2건.
    act(() => {
      fireEvent.press(confirm);
      fireEvent.press(confirm);
    });

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(putCalls).toBe(1);
  });

  // 5-b 경고3 봉합 — itinerary GET 미도착(콜드 캐시) 중 확정하면 빈 days 전체교체 PUT 이 나가
  // 일정이 소실될 수 있다. 로딩 가드가 이를 막는지 잠근다(h18 은 단독 라우트라 이 창이 실재).
  it('C5 · itinerary GET 미도착 중 확정 → PUT 0(빈 days 전체교체 방지)', async () => {
    // GET 을 영영 응답하지 않게 덮어 itinerary.data 를 undefined 로 묶는다(POST 는 즉시 응답).
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        await delay('infinite');
        return HttpResponse.json(itinerary());
      })
    );
    renderPage();
    await screen.findByTestId('itinerary-candidate-radio-X'); // POST 는 도착

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-option-swap-confirm'));

    // 로딩 가드가 확정을 막는다 — PUT 도 이동도 없다.
    await waitFor(() => expect(postCalls).toBe(1));
    expect(putCalls).toBe(0);
    expect(mockBack).toHaveBeenCalledTimes(0);
  });

  // 5-b 경고2 봉합 — 현 슬롯 실이름은 후보와 달리 이미 GET 에 있다(nameKo). 배선이 이를 내려
  // 플레이스홀더 대신 실이름을 보이는지 잠근다(후보 이름·사진은 여전히 미확보).
  it('C6 · 현 슬롯은 실이름(nameKo)을 보인다 — "이름 준비 중" 아님', async () => {
    renderPage();
    const current = await screen.findByTestId('itinerary-candidate-current');

    await waitFor(() => expect(current).toHaveTextContent(/경복궁/));
    expect(current).not.toHaveTextContent('이름 준비 중');
  });
});
