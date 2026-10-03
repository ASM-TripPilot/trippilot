import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { useSavedPlaces } from './savedPlaces';

/**
 * 01b Seed Q1 — `useSavedPlaces` 가 **담은 목록 원본과 조회 상태**를 함께 준다.
 *
 * 왜 훅을 넓히나: d02 는 `savedPlaceId`·`savedAt`·`place` 셋 다 필요한데 기존 반환은
 * `savedPoiIds`(문자열 배열)뿐이라 전부 버렸다. 페이지가 `useGetSavedPlaces` 를 따로 부르면
 * `enabled: isAuthed` 가드를 두 곳에 복제하게 되고 **그게 정확히 TRIP-220 W-3 이 났던 자리**다.
 * 서버 상태의 소유자를 이 훅 하나로 유지한다(`frontend/README.md` §66).
 *
 * 무엇을 보장하나:
 *  - **H-1** 로그인 상태에서 `savedPlaces` 가 서버 응답 **원본 그대로** 나온다(정렬은 순수
 *    함수 `orderSavedPlaces` 몫 — 훅이 미리 가공하면 판정이 두 곳으로 갈린다).
 *  - **H-2 (BR-U1-03)** 미로그인이면 요청 0건에 `savedPlaces` 가 `[]` 다.
 *  - **H-2 ★** 그런데 미로그인에서도 `isPending` 은 **true** 다 — 이 사실이 d02 페이지가
 *    게스트 분기를 상태 판정보다 **먼저** 두어야 하는 이유다.
 *  - **회귀 짝** 기존 `savedPoiIds` 가 그대로 나온다 — d04(TRIP-221·222)가 그 값에 매달려 있다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 반환 계약과 미로그인 가드는 훅이 사는 한 유효하다. **B 없음.**
 */

// authedClient(생성 클라이언트가 타는 인증 계층)가 @/shared/storage 를 정적으로 물고 있다.
// expo-secure-store 실물 로드를 피하려면 리포 관례대로 목킹해야 한다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
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
    tags: [],
    savedCount: 2,
    dataStatus: 'ACTIVE',
  };
}

const ROWS: SavedPlace[] = [
  {
    savedPlaceId: 'sp-1',
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace('p1', '감천문화마을'),
  },
  {
    savedPlaceId: 'sp-2',
    savedAt: '2026-08-01T11:00:00.000Z',
    place: makePlace('p2', '광안리 해변'),
  },
];

let observed: { method: string; url: string }[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

beforeEach(() => {
  observed = [];
  clearAccessToken();
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
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe('H-1 · 담은 목록 원본을 준다 (01b Seed Q1)', () => {
  it('서버 응답을 가공하지 않고 그대로 내고, savedPoiIds 도 그대로 낸다', async () => {
    setAccessToken('valid-access');

    const { result } = renderHook(() => useSavedPlaces({ isAuthed: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.savedPlaces).toHaveLength(2));

    // 원본 그대로 — 정렬을 훅이 미리 해 버리면 "무엇이 참인 순서인가"가 두 곳에 생긴다.
    expect(result.current.savedPlaces).toEqual(ROWS);
    // 회귀 짝 — d04 가 매달린 반환값이 그대로 살아 있다(추가지 교체가 아니다).
    expect(result.current.savedPoiIds).toEqual(['p1', 'p2']);
    expect(result.current.isError).toBe(false);
  });
});

describe('H-2 · 미로그인이면 아무것도 보내지 않는다 (BR-U1-03)', () => {
  it('빈 목록을 주고 요청은 0건이며, isPending 은 true 로 남는다', async () => {
    const { result } = renderHook(() => useSavedPlaces({ isAuthed: false }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.savedPlaces).toEqual([]));
    expect(result.current.savedPoiIds).toEqual([]);
    expect(
      observed.filter(
        (hit) => new URL(hit.url).pathname === '/api/v1/saved-places'
      )
    ).toEqual([]);

    // ★ 함정을 계약으로 못박는다 — `enabled: false` 인 쿼리는 "아직 안 받았다"는 뜻의
    // `isPending: true` 로 **영원히** 남는다(fetchStatus 는 idle). 이 값을 그대로
    // `resolvePlaceListState` 에 태우면 게스트가 끝나지 않는 스켈레톤을 본다.
    expect(result.current.isPending).toBe(true);
  });
});
