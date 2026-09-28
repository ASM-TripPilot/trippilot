import type { ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  SlotCandidates,
  SlotCandidatesCandidatesItem,
  SlotCandidatesRequest,
  Trip,
  TripDestination,
} from '@/shared/api/generated/schemas';
import { getGetTripsTripIdQueryKey } from '@/shared/api/generated/trips/trips';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotFillPage } from './SlotFillPage';

/**
 * TRIP-1043 · 같이 짜기(h09 컨셉 · h10 후보) — 여행지 맥락 · 「슬롯」 제거 · 후보 화면 상단 지도.
 *
 * 무엇을 보장하나:
 *  - 🔴 A1·A2 진행 줄 왼쪽 앞에 **그날 여행지**가 붙는다(`{지역} · N일차 / 총 · 날짜`). 그날 여행지는
 *    여행의 destinations 를 seq 순서로 박수만큼 펼쳐 고르고, 박수 합을 넘는 날은 마지막 seq(결정 3).
 *  - A3 여행 조회가 아직 안 왔거나 실패했거나 여행지가 비면 접두 없이 종전 모양 그대로 뜬다 —
 *    `undefined · ` 같은 글자가 새지 않고, 여행 조회를 기다리느라 진행 줄이 늦어지지도 않는다(INV-4).
 *  - 🔴 A4 두 화면 어디에도 내부 용어 「슬롯」이 없고 카운트는 `N번째 / M` 이다(QA #041).
 *  - 🔴 B1~B4 후보 화면 위에 지도 카드: 기준점 = **지금 채우는 슬롯의 장소**(사용자 GPS 아님 — '현재 위치'
 *    라벨 금지, Seed Q1), 반경 원 = 응답 `radiusMUsed` 우선·조회 중엔 요청 반경·최대 조회 중엔 원 없음
 *    (Seed Q2 · BR-U3-25). 후보 A/B/C 핀은 없다 — 후보 좌표 계약이 아직 없다(결정 2). 슬롯 좌표가 없으면
 *    지도 카드 자체를 안 그린다(0,0·서울 폴백 금지).
 *
 * 3동작: 준비 = 가짜 서버(일정·여행·후보) → 실행 = 슬롯 화면 열기·컨셉/반경 누르기 → 단언 = 진행 줄
 * 글자·지도에 넘어간 값.
 */

// 지도는 관찰 목으로 바꾼다 — center 는 텍스트로, 나머지 prop 은 host 로 그대로 노출된다(02a ★6).
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

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

afterAll(() => server.close());

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
  fireEvent.press(await screen.findByTestId(`itinerary-copick-concept-${key}`));
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
    }
  );
});

describe('A3 · 여행지를 모르면 접두 없이 종전 모양 그대로 (INV-4 정직 degrade)', () => {
  it('여행 조회가 아직 안 와도 진행 줄은 뜨고, 접두 없이 "1일차 / 2 · "로 시작한다', async () => {
    tripMode = 'pending';
    renderPage(buildSlotKey(DAY1, 'a'));

    const day = await screen.findByTestId(
      'itinerary-copick-concept-progress-day'
    );
    expect(day).toHaveTextContent(/^1일차 \/ 2 · /);
    expect(day).not.toHaveTextContent(/undefined/);
  });

  it.each([
    ['error', 'error'],
    ['empty', 'success'],
  ] as const)(
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

    await waitFor(() => expect(mapInCard().props.radiusCircle).toBeUndefined());
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
      expect(screen.queryByTestId('itinerary-copick-slotfill-map')).toBeNull();
      expect(screen.queryByTestId('map-root')).toBeNull();
    }
  );
});

describe('🔴 B4 · 후보 A/B/C 핀은 그리지 않는다 (후보 좌표 계약 대기 · 결정 2)', () => {
  it('후보가 3곳 와도 지도 핀은 기준 핀 1개뿐이고 letter 핀이 없다', async () => {
    candidates = [
      ...TWO_CANDIDATES,
      { poiId: 'Z', distanceRange: '980m', rationale: '야외 정원' },
    ];
    renderPage(buildSlotKey(DAY1, 'a'));
    await pickConcept();
    await screen.findByTestId('itinerary-candidate-radio-Z');

    const pins = mapInCard().props.pins as { label?: string }[];
    expect(pins).toHaveLength(1);
    expect(pins.filter((pin) => /^[A-Z]$/.test(pin.label ?? ''))).toEqual([]);
  });
});
