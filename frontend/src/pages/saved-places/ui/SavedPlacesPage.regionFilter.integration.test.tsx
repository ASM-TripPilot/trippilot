import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { setAccessToken, clearAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { SavedPlacesPage } from './SavedPlacesPage';

/**
 * TRIP-689 · d02 저장목록 여행 지역 필터 — 배선(AC-2)·무필터(AC-3)·필터-후-0건(AC-5).
 *
 * 무엇을 보장하나:
 *  - **I1 (AC-3)** region 파라미터가 없으면(홈·탐색·목적지상세 진입) 저장목록 **전체**를 그린다(현행 보존).
 *  - **I2 (AC-2)** region 파라미터가 있으면 지역 안 저장만 남기고, **null 지역은 fail-open으로 표시**한다.
 *  - **I3 (AC-2·★6)** region이 배열이 아니라 **단일 문자열**(단일 목적지 여행)로 와도 배열처럼 정규화한다.
 *  - **I4 (AC-5)** 저장이 비지 않았는데 필터로 0건이면 "담은 곳 없음"(거짓)이 아니라 **구분 안내**
 *    (`explore-saved-region-empty`)를 그린다.
 *
 * 왜 통합 버킷인가: region 파라미터 수신(`useLocalSearchParams`) → 순수 필터 → 화면 얼굴까지가
 * 실제로 관통하는지를 봐야 한다. 목록은 msw가 `GET /saved-places`로 준다(실 훅·실 필터).
 *
 * ★ 파라미터는 `mockParams`로 갈아 끼운다(expo-router `useLocalSearchParams` 목).
 * ★ 하트·CTA를 누르지 않는다 — `onUnhandledRequest:'error'`라 GET 외 요청이 나가면 실패한다(02a ★9).
 * ★ 필터 판정 자체(양방향 접두사·fail-open·빈 지역 급소)의 주 심판은 순수함수 유닛 테스트
 *   (`filterSavedPlacesByTripRegions.test.ts`)다 — 여기선 "페이지가 실제로 그 필터를 태운다"만 본다.
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
// region 파라미터를 테스트마다 갈아 끼우는 창구. 목 팩토리가 호출 시점에 lazily 읽는다.
let mockParams: Record<string, unknown> = {};

jest.mock('expo-router', () => ({
  router: {
    push: (href: unknown) => mockPush(href),
    back: () => mockBack(),
  },
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

const BASE = 'http://localhost:8080/api/v1';

function makePlace(poiId: string, region: string | null): Place {
  return {
    poiId,
    nameKo: poiId,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region,
    openingHours: null,
    imageUrl: null,
    tags: ['골목'],
    savedCount: 4,
    dataStatus: 'ACTIVE',
  };
}

function row(
  savedPlaceId: string,
  poiId: string,
  region: string | null
): SavedPlace {
  return {
    savedPlaceId,
    savedAt: '2026-08-01T00:00:00.000Z',
    place: makePlace(poiId, region),
  };
}

// 부산 접두사 매칭 1 · 지역 밖(경주) 1 · null(fail-open) 1.
const MIXED: SavedPlace[] = [
  row('sp-busan', 'p-busan', '부산광역시 해운대구'),
  row('sp-gyeongju', 'p-gyeongju', '경주시'),
  row('sp-null', 'p-null', null),
];

// 전부 실지역이면서 '경주시'와는 전부 비매칭 → 필터 0건(AC-5)용.
const ALL_REAL_NONMATCH: SavedPlace[] = [
  row('sp-x', 'p-x', '수영구'),
  row('sp-y', 'p-y', '사하구'),
];

let savedRows: SavedPlace[] = [];

function itemCount(): number {
  return screen.queryAllByTestId(/^explore-saved-item-/).length;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockParams = {};
  savedRows = [];
  setAccessToken('valid-access'); // 게스트가 아니어야 조회가 나간다.
  server.use(
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(savedRows))
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
  return render(<SavedPlacesPage />, { wrapper: Wrapper });
}

describe('I1 · region 파라미터 없으면 무필터 (AC-3, 현행 보존)', () => {
  it('저장목록 전체를 그린다(지역 밖·null 포함)', async () => {
    mockParams = {}; // 홈·탐색 FAB·목적지상세 진입 = 파라미터 없음
    savedRows = MIXED;
    renderPage();

    // 3건 전부 도착·표시.
    await waitFor(() => expect(itemCount()).toBe(3));
    expect(screen.getByTestId('explore-saved-item-sp-busan')).toBeOnTheScreen();
    expect(
      screen.getByTestId('explore-saved-item-sp-gyeongju')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('explore-saved-item-sp-null')).toBeOnTheScreen();
  });
});

describe('I2 · region 파라미터 → 지역 안만 (AC-2, fail-open 포함)', () => {
  it('부산 지역과 null(fail-open)은 남고, 지역 밖(경주)은 빠진다', async () => {
    mockParams = { region: ['부산광역시'] };
    savedRows = MIXED;
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByTestId('explore-saved-item-sp-busan')
      ).toBeOnTheScreen()
    );
    // null 지역은 fail-open으로 표시.
    expect(screen.getByTestId('explore-saved-item-sp-null')).toBeOnTheScreen();
    // 지역 밖(경주)은 숨김 — 부재 단언은 queryBy*.
    expect(screen.queryByTestId('explore-saved-item-sp-gyeongju')).toBeNull();
    expect(itemCount()).toBe(2);
  });
});

describe('I3 · region이 단일 문자열이어도 배열처럼 정규화 (AC-2 · ★6)', () => {
  it('배열이 아닌 문자열 파라미터도 필터가 동작한다(정규화 없으면 크래시로도 red)', async () => {
    // expo-router는 1원소 배열 파라미터를 문자열로 되돌릴 수 있다(단일 목적지 여행).
    mockParams = { region: '부산광역시' };
    savedRows = MIXED;
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByTestId('explore-saved-item-sp-busan')
      ).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-saved-item-sp-gyeongju')).toBeNull();
  });
});

describe('I4 · 필터-후-0건은 구분 안내 (AC-5, ≠ empty)', () => {
  it('저장이 있는데 지역 필터로 0건이면 region-empty를 그리고 기본 empty는 안 그린다', async () => {
    mockParams = { region: ['경주시'] };
    savedRows = ALL_REAL_NONMATCH; // 전부 실지역·전부 비매칭 → 필터 0건
    renderPage();

    // 지역 필터 0건 전용 안내가 뜬다.
    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-region-empty')).toBeOnTheScreen()
    );
    // "담은 곳 없음"(기본 empty)은 거짓이므로 안 뜬다.
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
    // 실제로 행은 0건.
    expect(itemCount()).toBe(0);
  });
});
