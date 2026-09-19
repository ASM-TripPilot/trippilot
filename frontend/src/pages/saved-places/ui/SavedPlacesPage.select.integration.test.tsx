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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { SavedPlacesPage } from './SavedPlacesPage';

/**
 * TRIP-706 [d02] select 모드 **배선** — `SavedPlacesPage`(save 무접촉·별 파일, 게이트① 무개봉).
 *
 * 무엇을 보장하나:
 *  - **IS-1 (AC-3)** `?mode=select` 면 select 화면(체크 토글), mode 없으면 기존 save 화면(하트).
 *    `useLocalSearchParams().mode` 로 갈린다.
 *  - **IS-2 (AC-1 · TRIP-491 재현)** 6곳 중 3곳만 골라 완료하면 **선택한 3곳만** 위저드 스토어에
 *    시드된다(미선택 3곳은 빠짐). 전부 시드가 아님을 부정 짝으로 잠근다 — 이것이 TRIP-491 급소다.
 *  - **IS-3 (AC-2)** 선택 0곳이면 완료가 disabled — 눌러도 시드·네비 콜백이 0회다(빈 시드 진입 방지).
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 심긴 시드**"(`useTripWizardStore.getState().mustVisits`)와
 * mode 분기다. 페이지가 선택 집합을 소유(D2)하고 완료 시 `seedMustVisitsFromD02(seedMustVisits(선택분))`
 * 로 심는다 — save-mode CTA(`onPressCreateTrip`) 선례와 동형(`SavedPlacesPage.tsx`).
 *
 * ★ No QueryClient 함정(traps-explore): `useSavedPlaces`(react-query)를 물어 `QueryClientProvider`
 *   래퍼 필수. select 화면 자체는 props-only 라 그 화면 테스트는 래퍼가 필요 없다(별 파일, 02a §4-5).
 * ★ 선택/미선택은 색 fill 이 아니라 체크 press→선택 반영으로 관측 — 시드 내용이 최종 증거다.
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
const mockBack = jest.fn();

// 딥링크 파라미터를 테스트가 갈아 끼우는 창구 — `mock` 접두라 jest.mock 팩토리에서 참조 가능.
const mockSearchParams: { mode?: string; region?: string | string[] } = {};

// ★ router.push 를 화살표로 감싸 지연 참조(hoist 함정 회피, 기존 통합테스트 ★16 선례).
jest.mock('expo-router', () => ({
  router: {
    push: (href: string) => mockPush(href),
    back: () => mockBack(),
  },
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

const BASE = 'http://localhost:8080/api/v1';

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
    tags: ['골목'],
    savedCount: 4,
    dataStatus: 'ACTIVE',
  };
}

/** 6곳 — savedAt 오름차순이라 정렬 순 p1..p6. */
const ROWS: SavedPlace[] = [
  {
    savedPlaceId: 'sp-1',
    savedAt: '2026-08-01T01:00:00.000Z',
    place: makePlace('p1', '감천문화마을'),
  },
  {
    savedPlaceId: 'sp-2',
    savedAt: '2026-08-01T02:00:00.000Z',
    place: makePlace('p2', '광안리 해변'),
  },
  {
    savedPlaceId: 'sp-3',
    savedAt: '2026-08-01T03:00:00.000Z',
    place: makePlace('p3', '전포 카페거리'),
  },
  {
    savedPlaceId: 'sp-4',
    savedAt: '2026-08-01T04:00:00.000Z',
    place: makePlace('p4', '해운대 해변'),
  },
  {
    savedPlaceId: 'sp-5',
    savedAt: '2026-08-01T05:00:00.000Z',
    place: makePlace('p5', '해동용궁사'),
  },
  {
    savedPlaceId: 'sp-6',
    savedAt: '2026-08-01T06:00:00.000Z',
    place: makePlace('p6', '자갈치 시장'),
  },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  delete mockSearchParams.mode;
  delete mockSearchParams.region;
  clearAccessToken();
  useTripWizardStore.getState().reset();
  server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json(ROWS)));
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper() {
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
  return Wrapper;
}

function renderPage() {
  return render(<SavedPlacesPage />, { wrapper: createWrapper() });
}

/** select 6행이 그려진 상태까지 만든다. */
async function renderSelectLoaded() {
  mockSearchParams.mode = 'select';
  setAccessToken('valid-access');
  renderPage();
  await waitFor(() =>
    expect(screen.getByTestId('mustvisit-pick-row-p1')).toBeOnTheScreen()
  );
}

describe('IS-1 · mode 파라미터로 화면이 갈린다 (AC-3)', () => {
  it('?mode=select 면 select 화면(체크 토글)을 그린다', async () => {
    await renderSelectLoaded();

    expect(screen.getByTestId('mustvisit-pick-root')).toBeOnTheScreen();
    // 여행 만들기 CTA(save 화면 것)는 없다 — 두 화면은 별개다.
    expect(screen.queryByTestId('explore-saved-createtrip')).toBeNull();
  });

  it('mode 가 없으면 기존 save 화면(하트 목록)을 그린다', async () => {
    // mode 미설정(beforeEach 가 지움) = save 모드.
    setAccessToken('valid-access');
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-item-sp-1')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('mustvisit-pick-root')).toBeNull();
  });
});

describe('IS-2 · 선택한 곳만 시드된다 (AC-1 · TRIP-491 재현)', () => {
  it('6곳 중 3곳만 골라 완료하면 그 3곳만 위저드 스토어에 들어간다', async () => {
    await renderSelectLoaded();
    await waitFor(() =>
      expect(screen.getAllByTestId(/^mustvisit-pick-row-/)).toHaveLength(6)
    );

    // 흩어서 3곳 선택(1·3·5번).
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p1'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p3'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p5'));

    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    const state = useTripWizardStore.getState();
    // 긍정 — 선택한 3곳이 시드로 들어갔다.
    expect(state.mustVisits.map((m) => m.sourcePoiId).sort()).toEqual([
      'p1',
      'p3',
      'p5',
    ]);
    // ★ 부정 짝(TRIP-491 급소) — 미선택 3곳은 안 들어간다. 이 짝이 없으면 "전부 시드"(버그)도 통과한다.
    ['p2', 'p4', 'p6'].forEach((poiId) => {
      expect(state.mustVisits.some((m) => m.sourcePoiId === poiId)).toBe(false);
    });
    // 위저드로 이동.
    expect(mockPush).toHaveBeenCalledWith('/trips/new/step1');
  });
});

describe('IS-3 · 0곳 완료는 무효 (AC-2)', () => {
  it('아무것도 안 고르면 완료가 disabled — 시드·네비 콜백이 0회다', async () => {
    await renderSelectLoaded();
    await waitFor(() =>
      expect(screen.getAllByTestId(/^mustvisit-pick-row-/)).toHaveLength(6)
    );

    const complete = screen.getByTestId('mustvisit-pick-complete');
    expect(complete).toBeDisabled();

    fireEvent.press(complete);

    // 빈 시드로 위저드에 진입하지 않는다 — 시드 0회 + 네비 0회.
    expect(useTripWizardStore.getState().mustVisits).toEqual([]);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
