import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
  ItineraryStatus,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * TRIP-1008 · C1~C3 — h14 완성(PLANNED)·h16 확정(CONFIRMED) 일정의 위반 슬롯 카드에 경고 표식이 뜬다
 * (D6 · BR-U3-13 지속 가시화). 표식 문구는 서버 사유와 무관한 **고정 라벨**이다(02c) — 서버 사유 원문에
 * "이동 54분 필요" 같은 소요시간이 섞여 오므로, 원문을 그리면 INV-3(소요시간 비표시)이 이 화면으로 번진다.
 * FE 는 원문을 파싱해 거르지 않는다(D5) — 아예 그리지 않는다.
 *
 * ★ 모드가 아니라 데이터가 정한다(Q3) — 같은 단언을 PLANNED·CONFIRMED 두 행이 받는다. 휴관 경고
 *   (`warning`)처럼 `isConfirmed` 로 게이트하면 PLANNED 행이 red 다.
 *
 * 3동작 뼈대: 준비=가짜 서버(status 행별) → 실행=렌더·셸 도착 대기 → 단언=카드 안 표식 텍스트·개수.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
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

const RAW_RANGE = /\d{3,4}~\d{3,4}/;
/** 소요시간 탐지기 — 리포 INV-3 스캐너들과 같은 식(`DraftScreen.test.tsx` 등). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;
/** 서버 사유 — HC2(소요시간 섞임) · HC1(원시 분 범위)을 ` · ` 로 이은 실제 결합 형태. */
const MIXED_REASON = '이동 54분 필요, 간격 -60분 · 영업시간 밖: 543~618';
const VIOLATION_LABEL = '일정 확인이 필요해요';
const k = (poiId: string): string => buildSlotKey(DAY1, poiId);

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
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

function slot(
  poiId: string,
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    ...over,
  };
}

/** 1일·2슬롯 — `poi-a` 위반(사유는 행이 정함), `poi-b` 위반 없음. */
function itinerary(status: ItineraryStatus, reason: string | null): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [
      {
        date: DAY1,
        slots: [
          slot('poi-a', { hasViolation: true, violationReason: reason }),
          slot('poi-b', { startAt: '13:00:00', endAt: '14:00:00' }),
        ],
      },
    ],
  };
}

let itineraryScript: () => Itinerary;

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
      HttpResponse.json(itineraryScript())
    )
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
  return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

describe('🔴 C1·C2 · h14/h16 — 위반 슬롯 카드에만 고정 라벨 표식, 사유 원문·소요시간 0건 (확정 여부 무관 · Q3 · INV-3)', () => {
  it.each<[string, ItineraryStatus]>([
    ['h14 완성(PLANNED)', 'PLANNED'],
    ['h16 확정(CONFIRMED)', 'CONFIRMED'],
  ])(
    '%s — poi-a 카드 안 "일정 확인이 필요해요", 전체 1개, 소요시간·사유 원문·원시 분 범위 0건',
    async (_label, status) => {
      itineraryScript = () => itinerary(status, MIXED_REASON);

      renderPage();
      await screen.findByTestId('map-sheet-shell-root');

      const cardA = screen.getByTestId(`slot-stopcard-${k('poi-a')}`);
      expect(
        within(cardA).getByTestId(`slot-stopcard-violation-${k('poi-a')}`)
      ).toHaveTextContent(VIOLATION_LABEL);
      // C2 — 위반 없는 poi-b 카드는 떠 있지만 표식은 없다(전체 1개).
      const cardB = screen.getByTestId(`slot-stopcard-${k('poi-b')}`);
      expect(
        within(cardB).queryAllByTestId(/^slot-stopcard-violation-/).length
      ).toBe(0);
      expect(screen.queryAllByTestId(/^slot-stopcard-violation-/).length).toBe(
        1
      );
      // INV-3 — 위 긍정 짝(표식이 카드 안에 있다)이 선 뒤라 이 0건은 빈 화면 공짜 통과가 아니다.
      expect(screen.queryAllByText(DURATION_TEXT).length).toBe(0);
      expect(screen.queryAllByText(/영업시간 밖/).length).toBe(0);
      expect(screen.queryAllByText(RAW_RANGE).length).toBe(0);
    }
  );
});

describe('🔴 C3 · h14 — 사유가 없어도 같은 고정 라벨이다 (사유 유무로 문구가 갈리지 않는다 · 02c)', () => {
  it('hasViolation=true · violationReason=null → 표식 "일정 확인이 필요해요"', async () => {
    itineraryScript = () => itinerary('PLANNED', null);

    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    expect(
      screen.getByTestId(`slot-stopcard-violation-${k('poi-a')}`)
    ).toHaveTextContent(VIOLATION_LABEL);
  });
});
