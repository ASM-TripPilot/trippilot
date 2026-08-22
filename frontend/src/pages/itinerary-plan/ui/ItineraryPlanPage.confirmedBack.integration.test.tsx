import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryStatus,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * TRIP-505 — h34 확정 일정에서 **뒤로가기 재배선**(브리프 01 · Seed 01b AC-1·AC-2).
 *
 * 무엇을 보장하나: 확정(CONFIRMED) 얼굴에서 뒤로가기를 누르면, 생성/확정 흐름 스택으로
 * 되돌아가는 대신 **내 여행 목록**(`/(tabs)/itinerary`)으로 `router.replace` 한다(AC-1). 그리고
 * 그 확정 분기가 **미확정(PLANNED) 경로를 바꾸지 않는다** — PLANNED 뒤로가기는 기존
 * `canGoBack()?back():replace(HOME_FALLBACK)` 그대로다(AC-2, 회귀 방지).
 *
 * 왜 페이지 통합 버킷인가: 뒤로가기 목적지 판정은 status 를 아는 **배선(페이지)**에서만
 * 성립한다(화면 TimelineScreen 은 라우팅을 모른다 · 구조 가드). `useRouter` 를 목으로 갈아
 * `replace`/`back` 호출을 관찰한다.
 *
 * ★ 얼굴은 훅이 아니라 **실 HTTP** 로 강제한다 — 훅을 목하면 status(PLANNED/CONFIRMED)
 *   판정이 테스트의 가정이 되어, 페이지가 status 를 안 보는 회귀를 아무도 못 본다.
 * ★ 목은 `push`/`back`/`replace`/`canGoBack` 4종을 **hoisted** 상수로 올린다(`edit.integration`
 *   :55-66 복제). `replace` 가 익명 `jest.fn()` 이면 호출을 단언할 수 없고, `canGoBack` 이 없으면
 *   `handleBack` 이 `canGoBack is not a function` 으로 거짓 red 가 난다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답(status) 지정 → 실행=뒤로가기 press → 단언=나간 replace/back.
 */

// listed/confirmed 얼굴이 KakaoMapView 를 마운트하므로 얇은 가짜로 렌더 노이즈를 없앤다.
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다 — 실물
// 로드를 피하려면 목킹한다(동결 통합테스트와 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 호이스트돼 바깥 변수를 못 본다 — 이름이 `mock`으로 시작하는
// 변수만 예외다. `canGoBack`·`replace` 를 반드시 넣는다(없으면 거짓 red · 위 ★).
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
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

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

/** 2일·3슬롯 완성 일정. status 만 갈아 CONFIRMED(확정 얼굴) vs PLANNED(편집 얼굴)를 만든다 —
 * 뒤로가기 목적지는 status 로만 갈리므로 슬롯 내용은 그대로 둔다. */
function itineraryOf(status: ItineraryStatus): Itinerary {
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
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockClear();
  // 히스토리가 있다고 가정 — 이래야 CONFIRMED 확정 분기가 canGoBack 경로(back())와 갈린다(★T5).
  mockCanGoBack.mockReturnValue(true);
  setAccessToken('valid-access');
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false` — 상태를 즉시 확정(재시도가 돌면 얼굴이 흔들린다). `gcTime:0` — 기본 타이머가
 * 테스트 종료 후에도 프로세스를 붙잡는 것 방지(동결 통합테스트와 동형). */
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

/** trip GET 은 케이스마다 안 갈리니 항상 200, itinerary GET 의 status 만 갈린다. */
function useItinerary(status: ItineraryStatus) {
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itineraryOf(status))
    )
  );
}

describe('🔴 CB1 · AC-1 — 확정(CONFIRMED) 뒤로가기는 내 여행 목록으로 replace 한다', () => {
  it('CONFIRMED 얼굴에서 뒤로가기 press → replace("/(tabs)/itinerary") 1회, back() 미호출', async () => {
    // 준비 — 일정 200·CONFIRMED → 확정 얼굴. 착지 앵커는 상시 앱바 제목 '확정 일정'(배너는
    // 이 티켓이 제거하므로 앵커로 못 쓴다 · 02a ★T1). canGoBack 은 true(히스토리 있음).
    useItinerary('CONFIRMED');
    renderPage();
    await screen.findByText('확정 일정');

    // 실행 — 뒤로가기.
    fireEvent.press(screen.getByTestId('itinerary-view-back'));

    // 단언 — 확정 분기는 canGoBack 경로를 타지 않고 곧장 내 여행 목록으로 replace 한다.
    //   `/(tabs)/itinerary`(목록)는 딥링크 폴백 `/(tabs)`(홈)과 다른 리터럴이다(★T5).
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/itinerary');
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('🔴 CB2 · AC-2 — 미확정(PLANNED) 뒤로가기는 기존 동작 유지(회귀 방지)', () => {
  it('PLANNED 얼굴에서 뒤로가기 press → back() 1회, replace 미호출(확정 분기가 안 샌다)', async () => {
    // 준비 — 일정 200·PLANNED → 편집(listed) 얼굴. 히스토리 있음(canGoBack=true).
    useItinerary('PLANNED');
    renderPage();
    await screen.findByTestId('itinerary-view-timeline');

    // 실행 — 뒤로가기.
    fireEvent.press(screen.getByTestId('itinerary-view-back'));

    // 단언 — canGoBack()=true 라 back(). 확정 분기가 PLANNED 로 새지 않아 replace 는 안 불린다.
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
