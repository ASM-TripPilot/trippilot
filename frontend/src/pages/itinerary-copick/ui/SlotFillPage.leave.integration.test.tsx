import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotFillPage } from './SlotFillPage';

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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

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

afterAll(() => server.close());

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
