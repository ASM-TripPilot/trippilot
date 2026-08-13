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
 *  - 헤더가 **두 조회의 조립**이다 — 제목·기간(GET /trips)과 곳 수(GET /itinerary)를 합쳐 그린다(AC1).
 *  - 🔴 **일정이 아직 없으면(404) notFound 얼굴**을 그리지 시간표를 그리지 않는다(AC9 · isNotFound).
 *  - 🔴 **확정 mutation 3갈래** — 성공(setQueryData 재조회0)·409(안내+재조회)·404(status 불변).
 *
 * **재작성(TRIP-354)**: 세그먼트 토글이 사라져(결정 D) 구 I1(세그먼트 전환 재조회 0)은 **삭제**한다
 * — 토글 자체가 없어 잴 대상이 없다. 지도가 상시 인라인이라 페이지가 `KakaoMapView` 를 마운트하므로,
 * 지도를 얇은 가짜로 바꿔 렌더 노이즈를 없앤다(이 파일의 관심사는 요청 건수지 지도가 아니다).
 *
 * 왜 통합 버킷인가: 심판의 핵심이 **어떤 요청이 몇 건 나갔나**다. 훅을 목킹하면 그 계수가 테스트의
 * *가정*이 되어 그 가정이 틀려도 아무도 모른다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=열고 확정 CTA 를 탭 → 단언=나간 요청·보이는 것.
 */
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

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

/** 확정 흐름(TRIP-300)용 — 같은 일정을 status 만 갈아 끼운다. PLANNED 여야 활성 확정 CTA 가 뜬다. */
function plannedItinerary(): Itinerary {
  return { ...itinerary(), status: 'PLANNED' };
}
function confirmedItinerary(): Itinerary {
  return { ...itinerary(), status: 'CONFIRMED' };
}

/** GET /itinerary 가 몇 번 처리됐나. 세그먼트 전환에도 이 값이 안 늘어야 한다(AC6). 확정 흐름에선
 * 성공=불변(setQueryData), 409=+1(재조회), 404=불변(재조회 없음)으로 세 갈래를 가른다(★5·★6). */
let itineraryGetCalls = 0;
/** POST /confirm 이 몇 번 처리됐나. press 1회 → POST 1건(중간 다이얼로그 없음 · ★9). */
let confirmPostCalls = 0;
/** GET /itinerary 응답을 케이스가 정한다(정상 · 404 · PLANNED/CONFIRMED). */
let itineraryHandler: () => Response;
/** POST /confirm 응답을 케이스가 정한다(200 CONFIRMED · 409 · 404). */
let confirmHandler: () => Response;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  itineraryGetCalls = 0;
  confirmPostCalls = 0;
  mockBack.mockClear();
  setAccessToken('valid-access');
  itineraryHandler = () => HttpResponse.json(itinerary());
  confirmHandler = () => HttpResponse.json(confirmedItinerary());

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      itineraryGetCalls += 1;
      return itineraryHandler();
    }),
    http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
      confirmPostCalls += 1;
      return confirmHandler();
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

/**
 * ── TRIP-300 확정 mutation 3갈래 ─────────────────────────────────────────────
 * 무엇을 보장하나:
 *  - 🔴 성공(200)은 **재조회 없이** setQueryData 로 읽기전용 전환(I4 · ★6).
 *  - 🔴 409 는 침묵 없이 안내 + 재조회로 정합하되, 전환과 잔존을 케이스로 가른다(I5a·I5b · ★2).
 *  - 🔴 404 는 status 불변·재조회 없음(I7 · ★5). 409(+1)와 404(불변)를 GET 실건수로 가른다.
 */
describe('🔴 I4 · AC1 — 확정 성공(200)은 재조회 없이 읽기전용으로 전환한다 (setQueryData · US-SCHED-12)', () => {
  it('확정 CTA press → POST /confirm 1건, GET 재조회 없이 확정 배너가 뜬다', async () => {
    itineraryHandler = () => HttpResponse.json(plannedItinerary());
    confirmHandler = () => HttpResponse.json(confirmedItinerary());

    renderPage();

    // PLANNED 로 열려 활성 확정 CTA 가 뜬다(첫 GET 1건).
    const cta = await screen.findByTestId('itinerary-confirm-cta');
    await waitFor(() => expect(itineraryGetCalls).toBe(1));

    // 누른다 — 중간 다이얼로그 없이 곧장 POST(★9).
    fireEvent.press(cta);

    // 확정 배너로 전환. 부제는 페이지 조립(날짜범위 · 제목 · 총 곳수). 곳수 = 전 일자 슬롯 합(2+1=3).
    const banner = await screen.findByTestId('itinerary-confirmed-banner');
    expect(banner).toHaveTextContent(/6월 10일 – 13일/);
    expect(banner).toHaveTextContent(/제주 여행/);
    expect(banner).toHaveTextContent(/3곳/);
    expect(screen.getByText('확정 일정')).toBeOnTheScreen();

    // ★6 — POST 1건, GET 은 **안 늘었다**(재조회 0). 응답을 캐시에 직접 주입(setQueryData)했다는
    //   유일한 설명이다. invalidate/refetch 로 성공을 반영하면 GET 이 2가 되어 여기서 죽는다.
    expect(confirmPostCalls).toBe(1);
    expect(itineraryGetCalls).toBe(1);
  });
});

describe('🔴 I5a · AC5 — 409 는 침묵 없이 안내 + 재조회, 서버가 PLANNED 면 편집 얼굴 유지 (INV-4)', () => {
  it('confirm 이 409 면 인라인 안내가 뜨고 GET 을 다시 조회하며, PLANNED 얼굴이 남는다', async () => {
    itineraryHandler = () => HttpResponse.json(plannedItinerary()); // 재조회해도 PLANNED
    confirmHandler = () => new HttpResponse(null, { status: 409 });

    renderPage();
    const cta = await screen.findByTestId('itinerary-confirm-cta');
    await waitFor(() => expect(itineraryGetCalls).toBe(1));

    fireEvent.press(cta);

    // 침묵 아님(INV-4) — 인라인 안내가 뜬다.
    const err = await screen.findByTestId('itinerary-confirm-error');
    expect(err).toHaveTextContent(/\S/);

    // 재조회로 정합 시도 — GET 이 한 번 더 나간다(invalidate → refetch). ★5 에서 404 와 갈린다.
    await waitFor(() => expect(itineraryGetCalls).toBe(2));

    // 서버 진실이 PLANNED 라 편집 얼굴 유지 — 타임라인·확정 CTA 가 남고 배너는 없다.
    expect(screen.getByTestId('itinerary-view-timeline')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-confirm-cta')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('itinerary-confirmed-banner')).toEqual([]);
  });
});

describe('🔴 I5b · AC5 — 409 후 재조회가 CONFIRMED 면 읽기전용으로 정합한다 (INV-4 · ★2)', () => {
  it('confirm 이 409 이고 서버가 이미 확정이면, 재조회로 확정 배너로 정합한다', async () => {
    itineraryHandler = () => HttpResponse.json(plannedItinerary());
    confirmHandler = () => new HttpResponse(null, { status: 409 });

    renderPage();
    const cta = await screen.findByTestId('itinerary-confirm-cta');
    await waitFor(() => expect(itineraryGetCalls).toBe(1));

    // 409 직후 서버 진실은 이미 CONFIRMED(다른 경로로 확정됨) — 재조회가 그것을 받아온다.
    itineraryHandler = () => HttpResponse.json(confirmedItinerary());
    fireEvent.press(cta);

    // 재조회로 확정 배너로 정합. ★2 — 얼굴이 읽기전용으로 바뀌면 인라인 안내는 그 리렌더에
    //   지워지므로 이 케이스는 잔존 안내를 단언하지 않는다(전환과 잔존을 케이스로 갈랐다).
    await screen.findByTestId('itinerary-confirmed-banner');
    await waitFor(() => expect(itineraryGetCalls).toBe(2));
  });
});

describe('🔴 I7 · AC6 — 404 는 status 를 바꾸지 않고 실패를 표시한다 (INV-4 · ★5)', () => {
  it('confirm 이 404 면 안내가 뜨고, 재조회 없이 PLANNED 가 유지된다', async () => {
    itineraryHandler = () => HttpResponse.json(plannedItinerary());
    confirmHandler = () => new HttpResponse(null, { status: 404 });

    renderPage();
    const cta = await screen.findByTestId('itinerary-confirm-cta');
    await waitFor(() => expect(itineraryGetCalls).toBe(1));

    fireEvent.press(cta);

    // 실패 표시(INV-4).
    const err = await screen.findByTestId('itinerary-confirm-error');
    expect(err).toHaveTextContent(/\S/);

    // ★5 — 404 는 409 와 달리 재조회하지 않는다(GET 불변 1). status 불변이라 배너도 없다.
    expect(itineraryGetCalls).toBe(1);
    expect(screen.queryAllByTestId('itinerary-confirmed-banner')).toEqual([]);
    expect(screen.getByTestId('itinerary-confirm-cta')).toBeOnTheScreen();
  });
});
