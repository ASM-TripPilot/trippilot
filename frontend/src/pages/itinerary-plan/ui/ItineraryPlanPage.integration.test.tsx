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
import type {
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * h25 배선을 **실 HTTP 로** 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - 🔴 **세그먼트 전환은 서버를 다시 때리지 않는다**(AC6 · US-SCHED-06). 시간표↔지도는 UI 상태라
 *    `GET /itinerary` 실건수가 전환 전후로 **불변**이어야 한다. 훅 호출수는 리렌더마다 늘어 거짓이
 *    되므로(02a ★6) MSW 로 나간 요청을 실제로 센다.
 *  - 헤더가 **두 조회의 조립**이다 — 제목·기간(GET /trips)과 곳 수(GET /itinerary)를 합쳐 그린다(AC1).
 *  - 🔴 **일정이 아직 없으면(404) notFound 얼굴**을 그리지 시간표를 그리지 않는다(AC9 · isNotFound).
 *
 * 왜 통합 버킷인가: 심판의 핵심이 **어떤 요청이 몇 건 나갔나**다. 훅을 목킹하면 "전환에 재조회가
 * 없다"가 테스트의 *가정*이 되어 그 가정이 틀려도 아무도 모른다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=열고 세그먼트를 탭 → 단언=나간 요청·보이는 것.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다 — 실물
// 로드를 피하려면 목킹한다(선례와 동형).
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
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

/** startDate/endDate 가 헤더의 "N박M일" 출처다(3박 4일 = 06-10 → 06-13). */
function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 여행',
    startDate: DAY1,
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** 2일 · 총 3곳(day1 2장 + day2 1장). status=CONFIRMED(완성 일정). */
function itinerary(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        {
          poiId: 'poi-a',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
        {
          poiId: 'poi-b',
          startAt: '13:00:00',
          endAt: '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
      ],
    },
    {
      date: DAY2,
      slots: [
        {
          poiId: 'poi-c',
          startAt: '10:00:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
      ],
    },
  ];
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'CONFIRMED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

/** GET /itinerary 가 몇 번 처리됐나. 세그먼트 전환에도 이 값이 안 늘어야 한다(AC6). */
let itineraryGetCalls = 0;
/** GET /itinerary 응답을 케이스가 정한다(정상 or 404). */
let itineraryHandler: () => Response;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  itineraryGetCalls = 0;
  mockBack.mockClear();
  setAccessToken('valid-access');
  itineraryHandler = () => HttpResponse.json(itinerary());

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      itineraryGetCalls += 1;
      return itineraryHandler();
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false` — 실패를 즉시 실패로(재시도가 돌면 요청 개수 단언이 흔들린다).
 * `gcTime:0` — 기본 타이머가 테스트 종료 후에도 프로세스를 붙잡는 것 방지. */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

describe('🔴 I1 · AC6 — 세그먼트 전환은 서버를 다시 때리지 않는다 (US-SCHED-06)', () => {
  it('지도↔시간표를 오가도 GET /itinerary 는 딱 한 번만 나간다', async () => {
    renderPage();

    // 시간표가 뜬다(첫 조회 1건).
    await screen.findByTestId('itinerary-view-timeline');
    await waitFor(() => expect(itineraryGetCalls).toBe(1));

    // 지도로 전환 — placeholder 가 뜬다.
    fireEvent.press(screen.getByTestId('itinerary-view-segment-map'));
    await screen.findByTestId('itinerary-view-map');
    // ★ 핵심 — 전환은 UI 상태라 재조회가 없다. 재키잉·수동 refetch·조건부 enabled 만 이 값을 올린다.
    expect(itineraryGetCalls).toBe(1);

    // 다시 시간표로 — 여전히 1건이다.
    fireEvent.press(screen.getByTestId('itinerary-view-segment-timeline'));
    await screen.findByTestId('itinerary-view-timeline');
    expect(itineraryGetCalls).toBe(1);
  });
});

describe('🔴 I2 · AC1 — 헤더가 두 조회의 조립이다', () => {
  it('제목·기간(GET /trips)과 곳 수(GET /itinerary)를 합쳐 그린다', async () => {
    renderPage();

    const header = await screen.findByTestId('itinerary-view-header');
    // 제목·N박M일 은 여행 메타에서, 총 N곳 은 일정 슬롯 합계에서 온다(3곳).
    expect(header).toHaveTextContent(/제주 여행 · 3박 4일/);
    expect(header).toHaveTextContent(/총 3곳/);
  });
});

describe('🔴 I3 · AC9 — 일정이 아직 없으면(404) notFound 얼굴을 그린다 (isNotFound)', () => {
  it('GET /itinerary 가 404 면 notFound 가 뜨고 시간표는 안 뜬다', async () => {
    itineraryHandler = () => new HttpResponse(null, { status: 404 });

    renderPage();

    // 404 = "일정이 아직 없다"(isNotFound). 전면 실패 얼굴이 아니라 별도 notFound 얼굴이다.
    await screen.findByTestId('itinerary-view-notfound');
    // 짝 — 시간표로 갈아 끼우지 않았다.
    expect(screen.queryAllByTestId('itinerary-view-timeline')).toEqual([]);
  });
});
