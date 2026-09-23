import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * TRIP-919 · AC-5 — h14 완성 일정(PLANNED 셸)에서 지도가 실패하면 **페이지 코드 변경 없이** 셸이 폴백
 * 바를 띄우고, 시트 카드 목록과 [일정 저장하기] CTA 는 그대로 남는다(INV-4 · US-SCHED-06 예외).
 *
 * 무엇을 보장하나: 실패 감지·폴백 표시는 셸 몫이라 9 소비처가 공짜로 얻는다 — 그중 h14 페이지 층에서
 * "셸이 실패를 받아 처리한다"를 한 번 확인한다. 페이지 파일(ItineraryPlanPage.tsx) 무변경은 명령 검증
 * (`git diff --stat`)이 따로 본다.
 *
 * ★ 지도는 `mapViewMock` 이다(얇은 관찰 마커). 목은 남는 props 를 host 로 흘리므로, 셸이 넘긴
 *   `onLoadFailed` 를 `getByTestId('map-root').props.onLoadFailed()` 로 직접 발화한다(02a ★11, 실측).
 *   직접 호출이라 상태 갱신을 `act` 로 감싼다.
 * ★ 얼굴은 훅이 아니라 실 HTTP(MSW)로 강제한다 — 동결 통합 테스트들과 같은 장치. `canGoBack` 은
 *   페이지 handleBack 이 부르므로 목에 넣는다(escape ★1 계승).
 *
 * 3동작 뼈대: 준비=가짜 서버(PLANNED) + 셸 도착 → 실행=지도 실패 발화 → 단언=폴백·카드·CTA.
 */

// 셸이 `<MapView>` 를 마운트하므로 얇은 관찰 마커(map-root)로 바꾼다.
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다 — 목킹한다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 호이스트돼 바깥 변수를 못 본다 — `mock` 접두만 예외.
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
const FALLBACK_MESSAGE =
  '지도를 불러올 수 없어요 · 일정은 아래 목록에서 볼 수 있어요';

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 여행',
    startDate: DAY1,
    endDate: '2026-06-12',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** 1일·2슬롯 완성 일정(PLANNED) — 지도 실패 전후로 카드 2장이 그대로인지 본다. */
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
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockClear();
  mockCanGoBack.mockReturnValue(true);
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false` — 얼굴 즉시 확정. `gcTime:0` — 타이머가 프로세스를 붙잡지 않게(동결 통합 테스트 동형). */
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

const CARD_A = `slot-stopcard-${DAY1}#poi-a`;
const CARD_B = `slot-stopcard-${DAY1}#poi-b`;

describe('🔴 PF1 · AC-5 — h14 셸에서 지도가 실패하면 폴백 바가 뜨고 카드·CTA 는 남는다', () => {
  it('map-root 의 onLoadFailed 발화 → map-sheet-fallback 표시 · 지도 자리 교체 · 카드 2장·일정 저장하기 유지', async () => {
    // 준비 — PLANNED 셸 도착, 실패 전 카드·CTA 확인(부정 단언의 공허 통과 방지).
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');
    expect(screen.getByTestId(CARD_A)).toBeOnTheScreen();
    expect(screen.getByTestId(CARD_B)).toBeOnTheScreen();
    const map = screen.getByTestId('map-root');
    // 셸이 지도에 실패 콜백을 실제로 넘겼다(현행 셸은 안 넘겨 여기서 red).
    expect(typeof map.props.onLoadFailed).toBe('function');

    // 실행 — 지도가 실패를 알린다.
    act(() => {
      (map.props.onLoadFailed as () => void)();
    });

    // 단언 — 셸 기본 폴백 바가 지도 자리를 대신한다.
    const fallback = screen.getByTestId('map-sheet-fallback');
    expect(within(fallback).getByText(FALLBACK_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByTestId('map-root')).toBeNull();
    // 화면을 비우지 않는다(INV-4) — 카드 2장과 [일정 저장하기] CTA 가 그대로다.
    expect(screen.getByTestId(CARD_A)).toBeOnTheScreen();
    expect(screen.getByTestId(CARD_B)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('sheet-cta-button-0')).getByText(
        '일정 저장하기'
      )
    ).toBeOnTheScreen();
  });
});
