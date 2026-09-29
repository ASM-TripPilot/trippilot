import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { SAVE_FAILURE_NOTICE } from '@/features/explore/model/placeSaveGuard';
import ExploreRoute from '@/app/(tabs)/explore';

/**
 * TRIP-1049 · d01 탐색 랜딩 '장소' 레인 저장 하트 — 라우트 종단(msw).
 *
 * 무엇을 보장하나(실제로 나간 요청을 센다):
 *  - 로그인 사용자가 하트를 누르면 **응답 전에** 찬 하트가 되고, 담은 곳 FAB 라벨 수도 함께 는다(AC-1·AC-3).
 *  - 같은 순간 두 번 눌러도 담기 요청은 한 번이다(AC-6 — 화면·훅을 통째로 태운 종단 확인).
 *  - 담기 실패는 되돌리고 실패 문구를 보인다(AC-7) · 담긴 곳은 담기 기록 id 로 해제된다(AC-2).
 *  - 게스트는 요청 없이 로그인으로(AC-5) · 대기 중 하트를 또 눌러도 상세로 새지 않는다(AC-4).
 *
 * seam: 숙소 검색(`useStaySearch`)만 목(빈 목록) — 이 파일의 관심은 장소 하트다. 장소 조회
 * (`useGetPlaces`)·담기 훅(`useSavedPlaces`)·숙소 담기 훅(`useSavedStays`, 로그인 분기 자식)은 **실물**
 * + msw. 담기 훅을 목하면 낙관 반영·롤백·연타 흡수가 사라져 이 파일이 무의미해진다.
 *
 * (개념) **한 act 안 두 press** — `fireEvent.press` 를 따로 두 번 부르면 첫 press 의 상태가 반영돼
 * 하트가 잠기고, 둘째 press 는 하트가 아니라 부모 카드로 샌다(02a ★1 실측). "같은 순간 두 탭"을
 * 재현하려면 두 press 를 하나의 `act(() => { … })` 에 넣어야 한다.
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
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/features/stay/model/useStaySearch', () => ({
  useStaySearch: jest.fn(),
}));
const mockUseStaySearch = useStaySearch as jest.MockedFunction<
  typeof useStaySearch
>;

const BASE = 'http://localhost:8080/api/v1';

/** 네트워크 도착을 기다리는 한도 — 로컬 기본 1000ms 의 CI 러너(약 4배 느림) 환산(02a ★9). */
const WAIT = { timeout: 4000 };

/** openapi `Place.required` 필드를 채운다. */
function place(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.0975,
    lng: 129.0106,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

const POI_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const POI_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PLACE_A = place(POI_A, '감천문화마을');
const PLACE_B = place(POI_B, '광안리 해변');
/** 서버가 이미 가진 B 의 담기 기록 id — 해제가 실어야 할 값이다. */
const SAVED_ID_B = '22222222-2222-2222-2222-222222222222';
const SAVED_B: SavedPlace = {
  savedPlaceId: SAVED_ID_B,
  savedAt: '2026-09-01T00:00:00Z',
  place: PLACE_B,
};
const NEW_SAVED_ID = '99999999-9999-9999-9999-999999999999';

const heartA = `explore-place-save-${POI_A}`;
const heartB = `explore-place-save-${POI_B}`;

function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

let observedHits: string[] = [];
function hitCount(needle: string): number {
  return observedHits.filter((hit) => hit === needle).length;
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
  clearAccessToken();
  mockUseStaySearch.mockReset();
  mockUseStaySearch.mockReturnValue({
    data: { items: [], degraded: false, filterZeroReasons: [] },
    isError: false,
    isPending: false,
  } as unknown as ReturnType<typeof useStaySearch>);
  // 장소 레인 = A·B, 담은 장소 = B 하나, 저장 숙소 = 없음(로그인 분기 자식이 조회한다).
  server.use(
    http.get(`${BASE}/places`, () =>
      HttpResponse.json({ items: [PLACE_A, PLACE_B], nextCursor: null })
    ),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json([SAVED_B])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
  );
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

/** 담기 POST 를 문 뒤에 세운다(= "서버 응답 전"). */
function holdSavePost() {
  const gate = createGate();
  server.use(
    http.post(`${BASE}/saved-places`, async () => {
      await gate.opened;
      return HttpResponse.json(
        {
          savedPlaceId: NEW_SAVED_ID,
          savedAt: '2026-09-28T00:00:00Z',
          place: PLACE_A,
        },
        { status: 201 }
      );
    })
  );
  return gate;
}

/** 로그인 상태로 렌더하고, B 가 담김으로 그려질 때까지(담은 목록 도착) 기다린다. */
async function renderAuthedReady() {
  setAccessToken('valid-access');
  render(<ExploreRoute />, { wrapper: createWrapper() });
  await waitFor(
    () =>
      expect(
        screen.getByTestId(`explore-place-heart-filled-${POI_B}`)
      ).toBeOnTheScreen(),
    WAIT
  );
  // 앵커 — A 는 안 담김, FAB 는 "담은 장소 1곳".
  expect(
    screen.getByTestId(`explore-place-heart-outline-${POI_A}`)
  ).toBeOnTheScreen();
  expect(screen.getByTestId('explore-saved-menu-toggle')).toHaveAccessibleName(
    '담은 장소 1곳'
  );
}

describe('TRIP-1049 · d01 장소 하트 — 담기', () => {
  it('EP-1 · 하트 press → 응답 전에 찬 하트+선택됨, FAB 라벨이 2곳 · 문 연 뒤 POST 1건, 실패 배너 없음', async () => {
    const gate = holdSavePost();
    await renderAuthedReady();

    fireEvent.press(screen.getByTestId(heartA));

    // 응답 전(문 닫힘) — 낙관 반영(AC-1)과 FAB 수(AC-3)가 같은 캐시라 함께 움직인다.
    await waitFor(
      () =>
        expect(
          screen.getByTestId(`explore-place-heart-filled-${POI_A}`)
        ).toBeOnTheScreen(),
      WAIT
    );
    expect(screen.getByTestId(heartA)).toBeSelected();
    expect(
      screen.getByTestId('explore-saved-menu-toggle')
    ).toHaveAccessibleName('담은 장소 2곳');

    gate.release();
    await waitFor(
      () => expect(hitCount('GET /api/v1/saved-places')).toBe(2),
      WAIT
    );
    expect(hitCount('POST /api/v1/saved-places')).toBe(1);
    expect(screen.queryByTestId('explore-place-save-error')).toBeNull();
  });

  it('EP-2 · 같은 순간 두 번 눌러도(한 act 안) 담기 요청은 1건이다', async () => {
    const gate = holdSavePost();
    await renderAuthedReady();

    // 실행 — 두 press 를 한 act 에 넣는다(따로 부르면 둘째가 카드로 새 공허 통과, 02a ★1).
    act(() => {
      fireEvent.press(screen.getByTestId(heartA));
      fireEvent.press(screen.getByTestId(heartA));
    });
    await waitFor(
      () =>
        expect(hitCount('POST /api/v1/saved-places')).toBeGreaterThanOrEqual(1),
      WAIT
    );

    gate.release();
    await waitFor(
      () => expect(hitCount('GET /api/v1/saved-places')).toBe(2),
      WAIT
    );

    // 둘 다 끝난 뒤라 "아직 안 나감"이 아니다.
    expect(hitCount('POST /api/v1/saved-places')).toBe(1);
    expect(screen.queryByTestId('explore-place-save-error')).toBeNull();
  });

  it('EP-3 · 담기 실패(404) → 빈 하트로 되돌리고 담기 실패 문구를 보인다', async () => {
    server.use(
      http.post(`${BASE}/saved-places`, () =>
        HttpResponse.json({}, { status: 404 })
      )
    );
    await renderAuthedReady();

    fireEvent.press(screen.getByTestId(heartA));

    const banner = await screen.findByTestId(
      'explore-place-save-error',
      {},
      WAIT
    );
    expect(
      within(banner).getByText(SAVE_FAILURE_NOTICE['not-found'].message)
    ).toBeOnTheScreen();
    // 되돌림 — 찬 하트로 굳지 않았다(배너만 띄우고 하트는 칠한 채 두는 구현 차단).
    expect(
      screen.getByTestId(`explore-place-heart-outline-${POI_A}`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(heartA)).not.toBeSelected();
  });

  it('EP-6 · 대기 중 하트를 다시 눌러도 장소 상세로 새지 않는다', async () => {
    const gate = holdSavePost();
    await renderAuthedReady();

    fireEvent.press(screen.getByTestId(heartA));
    await waitFor(
      () => expect(screen.getByTestId(heartA)).toBeDisabled(),
      WAIT
    );

    // 잠긴 하트 press 는 부모 카드로 샌다(02a ★2) — 카드가 대기를 보고 막아야 한다.
    fireEvent.press(screen.getByTestId(heartA));

    expect(mockPush).not.toHaveBeenCalled();

    gate.release();
    await waitFor(
      () => expect(hitCount('GET /api/v1/saved-places')).toBe(2),
      WAIT
    );
  });
});

describe('TRIP-1049 · d01 장소 하트 — 해제·게스트', () => {
  it('EP-4 · 담긴 B 하트 press → 담기 기록 id 로 DELETE 1건, 응답 전에 빈 하트', async () => {
    const gate = createGate();
    server.use(
      http.delete(`${BASE}/saved-places/:savedPlaceId`, async () => {
        await gate.opened;
        return new HttpResponse(null, { status: 204 });
      })
    );
    await renderAuthedReady();

    fireEvent.press(screen.getByTestId(heartB));

    await waitFor(
      () =>
        expect(
          screen.getByTestId(`explore-place-heart-outline-${POI_B}`)
        ).toBeOnTheScreen(),
      WAIT
    );
    await waitFor(
      () =>
        expect(hitCount(`DELETE /api/v1/saved-places/${SAVED_ID_B}`)).toBe(1),
      WAIT
    );
    // poiId 를 그대로 경로에 넣지 않았다.
    expect(hitCount(`DELETE /api/v1/saved-places/${POI_B}`)).toBe(0);

    gate.release();
    await waitFor(
      () => expect(hitCount('GET /api/v1/saved-places')).toBe(2),
      WAIT
    );
  });

  it('EP-5 · 게스트 → 하트 press 는 로그인으로 push, 담기 요청 0건', async () => {
    // 준비 — 토큰 없음. 장소 레인이 그려질 때까지만 기다린다.
    render(<ExploreRoute />, { wrapper: createWrapper() });
    await waitFor(
      () => expect(screen.getByTestId(heartA)).toBeOnTheScreen(),
      WAIT
    );

    fireEvent.press(screen.getByTestId(heartA));

    expect(mockPush).toHaveBeenCalledWith('/(auth)/login');
    expect(hitCount('POST /api/v1/saved-places')).toBe(0);
    // 게스트에겐 담은 목록 조회도 나가지 않는다(BR-U1-03 — 기존 계약 유지 확인).
    expect(hitCount('GET /api/v1/saved-places')).toBe(0);
  });
});
