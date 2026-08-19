import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * TRIP-402 — h25 완성 일정 화면의 **탈출구** 배선(브리프 01 · Seed 01b).
 *
 * 무엇을 보장하나: 4얼굴(loading·notFound·failed·listed) 어디에 착지해도 눈에 보이는 뒤로가기가
 * 있고, 뒤로 갈 히스토리가 없으면(딥링크) 조용히 무동작하지 않고 홈(`/(tabs)`)으로 간다(침묵 no-op
 * 금지 · INV-4). 빈 얼굴(notFound)은 나갈 길 대신 "일정 만들기" 다음 행동도 준다.
 *
 * 왜 페이지 통합 버킷인가: 화면(TimelineScreen)은 라우팅을 모르므로(구조 가드) 탈출구 배선은
 * 반드시 페이지에서만 성립한다. `useRouter`를 목으로 갈아 `back()`/`push()`/`replace()` 호출을
 * 관찰한다(TRIP-369 `StayRegisterPage.back.integration.test.tsx`와 동형 목).
 *
 * ★ `router.canGoBack()`은 리포 선례 0건 신규 API — 목이 그 함수를 안 주면 구현이 옳아도
 * `canGoBack is not a function`으로 죽어 거짓 red가 난다(02a ★1). 그래서 `canGoBack`을 목에 반드시
 * 넣고, 케이스마다 `mockCanGoBack.mockReturnValue(true|false)`로 히스토리 유무를 강제한다.
 *
 * 얼굴은 훅이 아니라 **실 HTTP로** 강제한다(02a ★2) — 훅을 목하면 얼굴 판정이 테스트의 가정이 되어
 * 그 판정 회귀를 아무도 못 본다. loading은 `delay('infinite')`로 두 GET을 영영 pending시킨다.
 */

// listed 얼굴이 KakaoMapView를 마운트하므로 얇은 가짜로 렌더 노이즈를 없앤다(관심사는 지도가
// 아니라 뒤로가기 배선이다).
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
// 변수만 예외다. `canGoBack`은 반드시 넣는다(리포 선례 0, 없으면 거짓 red).
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: mockPush,
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

/** PLANNED 완성 일정(2일·3슬롯). PLANNED여야 listed 얼굴에 활성 `itinerary-confirm-cta`가 뜬다
 * (CONFIRMED은 읽기전용 2버튼으로 갈림) — AC-6 대상이 확정 CTA라 PLANNED 고정. */
function plannedItinerary(): Itinerary {
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
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockClear();
  // 기본: 히스토리 있음. 딥링크(canGoBack=false) 케이스만 각 테스트에서 뒤집는다.
  mockCanGoBack.mockReturnValue(true);
  setAccessToken('valid-access');
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false` — 404/500을 즉시 실패로(재시도가 돌면 얼굴이 흔들린다). `gcTime:0` — 기본 타이머가
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

/** 얼굴 강제 헤더 — trip GET은 케이스마다 다르지 않아 항상 200, itinerary GET만 갈린다(02a ★2). */
function useTripOk() {
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip()))
  );
}
function useItineraryNotFound() {
  useTripOk();
  server.use(
    http.get(
      `${BASE}/trips/:tripId/itinerary`,
      () => new HttpResponse(null, { status: 404 })
    )
  );
}
function useItineraryFailed() {
  useTripOk();
  server.use(
    http.get(
      `${BASE}/trips/:tripId/itinerary`,
      () => new HttpResponse(null, { status: 500 })
    )
  );
}
function useItineraryListed() {
  useTripOk();
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(plannedItinerary())
    )
  );
}

describe('🔴 AC-1 · 빈 얼굴(notFound) 뒤로가기 — 히스토리 있으면 이전 화면으로', () => {
  it('notFound 얼굴에서 뒤로가기를 누르면 router.back()으로 이어진다', async () => {
    // 준비 — 일정 404 → 빈 얼굴("아직 완성된 일정이 없어요")로 착지.
    useItineraryNotFound();
    renderPage();
    await screen.findByTestId('itinerary-view-notfound');

    // 실행 — 4얼굴 공통 뒤로가기(없으면 getByTestId가 throw).
    fireEvent.press(screen.getByTestId('itinerary-view-back'));

    // 단언 — 히스토리 있으니 back(), replace 아님.
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-2 · 빈 얼굴 다음 행동 — "일정 만들기" → 방식 선택(h04)', () => {
  it('notFound 얼굴의 일정 만들기 액션을 누르면 method 라우트로 push한다', async () => {
    // 준비 — 빈 얼굴 착지.
    useItineraryNotFound();
    renderPage();
    await screen.findByTestId('itinerary-view-notfound');

    // 실행 — StateNotice 액션 버튼(현행은 actions=[]라 부재 → red).
    fireEvent.press(screen.getByTestId('itinerary-plan-create-cta'));

    // 단언 — 동적 라우트 push 관용구(객체 1인자, DraftPage·MethodPage 선례).
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/method',
      params: { tripId: TRIP_ID },
    });
  });
});

describe('🔴 AC-3 · 실패 얼굴(failed) 뒤로가기', () => {
  it('failed 얼굴에서 뒤로가기를 누르면 router.back()으로 이어진다', async () => {
    // 준비 — 일정 500(비-404) → 실패 얼굴(404는 notFound가 먹으므로 500이어야 failed).
    useItineraryFailed();
    renderPage();
    await screen.findByTestId('itinerary-view-failed');

    // 실행 + 단언.
    fireEvent.press(screen.getByTestId('itinerary-view-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-4 · 딥링크(히스토리 없음) — 침묵 no-op 금지, 홈으로 replace', () => {
  it('canGoBack()===false면 back이 아니라 홈(/(tabs))으로 replace한다', async () => {
    // 준비 — 빈 얼굴 + 히스토리 없음(딥링크로 직접 들어온 최악 조합).
    useItineraryNotFound();
    mockCanGoBack.mockReturnValue(false);
    renderPage();
    await screen.findByTestId('itinerary-view-notfound');

    // 실행.
    fireEvent.press(screen.getByTestId('itinerary-view-back'));

    // 단언 — 홈 목적지 자체를 잠근다('/(tabs)/itinerary'는 trips[0] 리다이렉트 함정이라 금지).
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    // 침묵 no-op도, back+replace 이중 호출도 아님 — replace만.
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('AC-5a · listed 뒤로가기 무회귀 (선제 green)', () => {
  it('완성 일정이 있는 얼굴의 기존 뒤로가기가 계속 이전 화면으로 간다', async () => {
    // 준비 — 두 조회 성공 → 시간표(listed) 얼굴.
    useItineraryListed();
    renderPage();
    await screen.findByTestId('itinerary-view-timeline');

    // 실행 + 단언 — 히스토리 있으면 back(무회귀).
    fireEvent.press(screen.getByTestId('itinerary-view-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-5b · listed 딥링크 사각 봉합 — 공통 handleBack이라 이 얼굴도 홈 폴백', () => {
  it('listed 얼굴에서도 canGoBack()===false면 홈(/(tabs))으로 replace한다', async () => {
    // 준비 — listed + 히스토리 없음(기존은 맨 router.back()이라 조용히 무동작이던 자리).
    useItineraryListed();
    mockCanGoBack.mockReturnValue(false);
    renderPage();
    await screen.findByTestId('itinerary-view-timeline');

    // 실행 + 단언.
    fireEvent.press(screen.getByTestId('itinerary-view-back'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('AC-6 · listed 본체 무회귀 (선제 green)', () => {
  it('인라인 지도·지도 크게 보기·시간표 카드·확정 CTA가 현행 그대로 있다', async () => {
    // 준비 — listed 얼굴.
    useItineraryListed();
    renderPage();
    await screen.findByTestId('itinerary-view-timeline');

    // 단언 — onBack 배선 교체가 본체 표면을 안 부순다(세그먼트 토글은 이미 없음 — TRIP-354 폐기).
    expect(screen.getByTestId('itinerary-view-map')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-map-expand')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-view-timeline')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-confirm-cta')).toBeOnTheScreen();
  });
});

describe('🔴 AC-7 · loading 얼굴 뒤로가기 — 조회가 걸려도 갇히지 않는다', () => {
  it('loading 얼굴에도 뒤로가기가 있고 router.back()으로 이어진다', async () => {
    // 준비 — 정상 핸들러지만 아직 settle 안 됨: 두 쿼리가 `isPending`이라 **초기 렌더가 곧 loading**
    // 이다(동결 통합테스트가 loading을 지나려 `findBy`로 기다리는 바로 그 창). 영영 pending(delay
    // infinite)은 jest 프로세스를 붙잡아 leak을 내므로 안 쓴다 — settle되는 핸들러로 창만 쓴다.
    useItineraryListed();
    renderPage();

    // 얼굴 증명 — settle 전이라 다른 3얼굴은 없다(부재는 queryAll, getAll은 0건에서 throw). loading임.
    expect(screen.queryAllByTestId('itinerary-view-timeline')).toEqual([]);
    expect(screen.queryAllByTestId('itinerary-view-notfound')).toEqual([]);
    expect(screen.queryAllByTestId('itinerary-view-failed')).toEqual([]);

    // 실행 — loading 얼굴의 뒤로가기를 지금(settle 전) 누른다. 현행 loading은 빈 View라 여기서 throw.
    fireEvent.press(screen.getByTestId('itinerary-view-back'));

    // 단언 — 히스토리 있으니 back().
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    // 정리 — 쿼리를 settle시켜 teardown의 dangling promise/act 경고를 없앤다(단언 아님).
    await screen.findByTestId('itinerary-view-timeline');
  });
});
