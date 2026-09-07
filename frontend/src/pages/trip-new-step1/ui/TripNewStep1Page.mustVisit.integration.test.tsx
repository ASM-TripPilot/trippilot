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
import type { Place, SavedPlace, Trip } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-665 g01 default 재작성 — **자동 시드 폐지 + 등록 파이프라인 부재**(실 HTTP 심판, 보존).
 *
 * 무엇을 보장하나: 담은 곳(하트) 자동 시드는 폐지됐다(사용자 결정) — `GET /saved-places` 는 (담은목록 게이트
 * 때문에) 여전히 나가지만 "꼭 갈 곳" 스트립은 자동으로 채워지지 않고, 제출해도 `POST /trips/{id}/must-visits`
 * 등록 요청이 **한 건도 안 나간다**. 이 두 성질은 훅을 목하면 가정으로 전락하므로 실 HTTP 로 태운다.
 *
 * 왜 재작성인가: 옛 스트립은 담은 곳을 자동 시드해 썸네일로 보여줬다(옛 I-1 이 `-mustvisit-poi-1` 셋을 봄).
 * 신 스트립은 `mustVisits`(스토어) 만 그리고 자동 시드 경로가 없어 항상 카드 0장이다 — 옛 empty 얼굴·캡션
 * 단언을 신 스트립(카드 0장)으로 교체한다.
 *
 * ⚠️ /regions·/saved-stays 핸들러는 안 준다 — 신 페이지가 그 훅을 드롭했음을 강제한다(02a ★9).
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

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const BASE_DATE = '2026-06-10';

const TRIP_ID = '11111111-1111-1111-1111-111111111111';

const TRIP: Trip = {
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  party: 1,
  companionType: null,
  budgetTotal: 800000,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 3 }],
  status: 'PLANNED',
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
};

function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '수영구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

function savedPlace(poiId: string, nameKo: string): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace(poiId, nameKo),
  };
}

const THREE: SavedPlace[] = [
  savedPlace('poi-1', '감천마을'),
  savedPlace('poi-2', '광안리'),
  savedPlace('poi-3', '전포'),
];

let observedHits: string[] = [];

/** ⚠️ 완전 일치로 센다 — must-visits 경로가 생성 경로를 접두로 포함하므로 부분 일치로 세면 섞인다. */
function createHits(): number {
  return observedHits.filter((hit) => hit === 'POST /api/v1/trips').length;
}
function mustVisitHits(): number {
  return observedHits.filter((hit) => hit.endsWith('/must-visits')).length;
}
function savedPlaceGetHits(): number {
  return observedHits.filter((hit) => hit === 'GET /api/v1/saved-places')
    .length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  mockPush.mockClear();
  useTripWizardStore.getState().reset();
  // 담은목록 조회는 enabled:isAuthed — 토큰이 있어야 나간다.
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(THREE)),
    http.post(`${BASE}/trips`, () => HttpResponse.json(TRIP, { status: 201 })),
    // must-visits 핸들러는 **호출되면 안 되는** 것을 확인하는 용도로만 건다(등록 파이프라인 폐지).
    http.post(`${BASE}/trips/:tripId/must-visits`, () =>
      HttpResponse.json({}, { status: 201 })
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
  return render(<TripNewStep1Page baseDate={BASE_DATE} />, {
    wrapper: Wrapper,
  });
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

/** 정상 제출 가능한 스토어 선상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
function seedValidDraft(): void {
  const store = useTripWizardStore.getState();
  store.addDestination('부산', 3);
  store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
}

describe('I-1 · 조회는 나가지만 "꼭 갈 곳"은 자동으로 안 채워진다', () => {
  it('담은 곳 3건이 있어도 스트립 카드는 0장이고, GET /saved-places 는 나간다', async () => {
    renderPage();

    // GET 은 게이트 때문에 여전히 나간다(자동 시드와 무관).
    await waitFor(() => expect(savedPlaceGetHits()).toBe(1));

    // ★ 예전엔 여기서 썸네일이 셋 다 떴다 — 자동 시드가 폐지돼 이제 담은 곳이 몇이든 카드 0장이다.
    expect(screen.getByTestId('trip-wizard-mustvisit-block')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-mustvisit-poi-1')).toBeNull();
    expect(screen.queryAllByTestId(/^trip-wizard-mustvisit-poi-/)).toHaveLength(
      0
    );
  });
});

describe('I-2 · 제출해도 must-visits 등록 자체가 안 나간다', () => {
  it('POST /trips 1건만 나가고 must-visits 는 0건, step2 로 이동한다', async () => {
    seedValidDraft();
    renderPage();

    // 담은목록 게이트가 열릴 때까지 기다린다(GET 도착 → savedPlacesLoading false).
    await waitFor(() => expect(next()).toBeEnabled());

    fireEvent.press(next());

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(createHits()).toBe(1);
    // ★ 옛 계약(남은 시드를 ANYTIME 으로 등록)은 폐지됐다 — 시드를 채우는 경로가 없어 등록이 안 나간다.
    expect(mustVisitHits()).toBe(0);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
