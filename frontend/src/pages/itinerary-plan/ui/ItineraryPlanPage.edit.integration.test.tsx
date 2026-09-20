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
 * TRIP-482 — h25 완성 일정(PLANNED)에서 h24 일정 편집으로 **들어가는 문** 배선(브리프 01 · Seed 01b).
 *
 * **재작성(TRIP-799 · narrow)**: PLANNED 완성 일정이 이제 지도+시트 셸이고 Figma h14 는 **편집 연필이
 * 없다**(01b D3 제거 목록) → IE1 은 "PLANNED → 편집 진입 push"에서 "PLANNED 셸엔 `itinerary-view-edit`
 * **부재**"로 뒤집힌다(★7). IE2(CONFIRMED)는 TimelineScreen 유지라 무변경(편집 문이 확정 일정으로
 * 새지 않음, AC-2).
 *
 * 무엇을 보장하나: PLANNED 셸 얼굴엔 편집 진입 어포던스(`itinerary-view-edit`)가 **없고**(Figma h14
 * 미설계), CONFIRMED(h34)에도 어포던스가 없다(편집 문이 확정 일정으로 새지 않음).
 *
 * 왜 페이지 통합 버킷인가: 화면(TimelineScreen)은 라우팅을 모르므로(구조 가드) push 배선은 반드시
 * 페이지에서만 성립한다. `useRouter` 를 목으로 갈아 `push` 호출 인자를 관찰한다(escape 통합테스트와
 * 동형 목).
 *
 * ★ 얼굴은 훅이 아니라 **실 HTTP 로** 강제한다(02a ★4) — 훅을 목하면 status(PLANNED/CONFIRMED) 판정이
 * 테스트의 가정이 되어, 페이지가 status 를 안 내리는 회귀를 아무도 못 본다.
 * ★ `router.canGoBack` 은 페이지 `handleBack` 이 부르므로 목에 반드시 넣는다 — 없으면 어떤 경로에서
 * `canGoBack is not a function` 으로 거짓 red 가 난다(escape 테스트 ★1 실측 · 02a ★5).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답(핸들러) 지정 → 실행=열고 어포던스 press → 단언=나간 push 인자·부재.
 */

// listed/confirmed 얼굴이 KakaoMapView 를 마운트하므로 얇은 가짜로 렌더 노이즈를 없앤다(관심사는
// 지도가 아니라 편집 진입 배선이다).
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다 — 실물 로드를
// 피하려면 목킹한다(동결 통합테스트와 동형).
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
// 변수만 예외다. `canGoBack`을 반드시 넣는다(리포 선례 0, 없으면 거짓 red · 02a ★5).
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

/** 2일·3슬롯 완성 일정. status 만 갈아 PLANNED(편집 진입 있음) vs CONFIRMED(h34, 편집 진입 없음)를
 * 만든다 — 편집 진입은 status 로만 갈리므로 슬롯 내용은 그대로 둔다. */
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

/** trip GET 은 케이스마다 안 갈리니 항상 200, itinerary GET 의 status 만 갈린다(02a ★4). */
function useItinerary(status: ItineraryStatus) {
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itineraryOf(status))
    )
  );
}

describe('🔴 IE1 · narrow(★7) — PLANNED 셸 얼굴엔 편집 연필이 없다 (Figma h14 미설계)', () => {
  it('PLANNED 는 지도+시트 셸이고 itinerary-view-edit 가 부재하며 push 도 안 나간다', async () => {
    // 준비 — 두 조회 성공(PLANNED) → 지도+시트 셸 얼굴.
    useItinerary('PLANNED');
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // 단언 — 편집 연필은 셸에 없다(D3 제거 목록). 현행은 PLANNED→TimelineScreen 이라 이 얼굴 자체가
    //   안 떠(map-sheet-shell-root findBy 에서 red), 셸 전환 후엔 어포던스 부재로 green.
    expect(screen.queryByTestId('itinerary-view-edit')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 IE2 · AC-7 의미 반전 — CONFIRMED h16 셸엔 "일정 수정" 버튼이 있고 h12 로 push 한다', () => {
  it('CONFIRMED 셸의 sheet-cta-button-0(일정 수정) press → h12 편집 push 1회', async () => {
    // 준비(TRIP-801 의미 반전) — 799 까지 IE2 는 "확정 일정엔 편집 문이 없다"를 잠갔으나, h16 정본이
    // 정면으로 **일정 수정 버튼을 추가**한다(01b D5 · 02a ★1). CONFIRMED 는 이제 셸이라 착지 앵커는
    // `map-sheet-shell-root`(옛 '확정 일정' 앱바 제목은 셸엔 없음 · ★2).
    useItinerary('CONFIRMED');
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // 단언 — 편집 문이 확정 일정으로 **의도적으로** 열린다. h12 는 이 배선이 최초 앱-내 진입점이다.
    const edit = screen.getByTestId('sheet-cta-button-0');
    expect(edit).toHaveTextContent('일정 수정');

    fireEvent.press(edit);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/edit',
      params: { tripId: TRIP_ID },
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
