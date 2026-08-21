import type { ReactNode } from 'react';
import { Share } from 'react-native';
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
import { getGetPlacesQueryKey } from '@/shared/api/generated/places/places';
import type {
  GetPlacesParams,
  Place,
  SavedPlace,
} from '@/shared/api/generated/schemas';

import { PlaceDetailPage } from './PlaceDetailPage';

/**
 * TRIP-501 · TRIP-456 · AC-4·5·6·7·8 — d06 장소 상세 배선(페이지 층).
 *
 * TRIP-501 이 바꾼 계약: 상세가 더 이상 `GET /places`(ACTIVE 전량 약 2MB)를 **새로 받지 않는다**.
 * 앞 화면(d04·d02)이 이미 채운 **캐시만** 읽는다 — 목록 캐시(`useGetPlaces` 가 심은 것) + 담은목록
 * 캐시. 그래서 이 스위트는 msw 로 목록을 내려주지 않고, QueryClient 캐시에 **직접 심는다**.
 *
 * ★ 회귀 심판: `placesHandler`(GET /places) 가 **한 번도 안 불려야** 한다. 구현이 옛날처럼
 *   `useGetPlaces()` 로 되돌아가면 이 핸들러가 불려 `expect(...).not.toHaveBeenCalled()` 가 깨진다
 *   — "전량 수신을 멈췄다"는 보장을 이 단언 하나가 지킨다(02a ★TRIP-501).
 *
 * 무엇을 보장하나:
 *  - **D1 (AC-4)** 목록 캐시에 심긴 장소를 poiId 로 찾아 상세 표면을 그린다 — 네트워크 호출 0.
 *  - **D2·D3·D4 (AC-5)** 하트가 `useSavedPlaces` 로 서버 토글된다(담김/미담김 글리프 testID, 색 아님).
 *  - **D5 (AC-6)** 계약에 없는 필드는 지어내지 않는다.
 *  - **D6 (AC-7)** 뒤로가기가 딥링크에서 갇히지 않는다(canGoBack 폴백).
 *  - **D7 (AC-8)** 공유가 Share.share 를 place.nameKo 로 부른다.
 *  - **D8** 어느 캐시에도 없으면 notFound(콜드 딥링크 천장 — cache-only 결정의 결과).
 *  - **D9** 담은목록이 아직 해소 중이면(authed) loading, 해소되면 담은목록 캐시로 상세를 그린다.
 *  - **D10·D11** code-critic 사각 봉합 — 필터-키 부분일치 · 게스트 로딩 게이트.
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

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
    push: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
}));

const BASE = 'http://localhost:8080/api/v1';

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    poiId: 'p1',
    nameKo: '부산시립미술관',
    category: '문화',
    lat: 35.1,
    lng: 129.1,
    region: '부산 부산진구',
    openingHours: '10:00~18:00 (월 휴관)',
    imageUrl: null,
    tags: ['미술', '실내'],
    savedCount: 12,
    dataStatus: 'ACTIVE',
    ...overrides,
  };
}

// GET /places 회귀 심판 — 상세는 이 핸들러를 절대 부르면 안 된다(캐시만 읽음).
let placesHandler: jest.Mock;
let savedRows: SavedPlace[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  savedRows = [];
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockReset();
  mockCanGoBack.mockReturnValue(true);
  clearAccessToken();
  setAccessToken('valid-access');

  placesHandler = jest.fn(() =>
    HttpResponse.json({ items: [], nextCursor: null })
  );
  server.use(
    http.get(`${BASE}/places`, placesHandler),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(savedRows)),
    http.post(`${BASE}/saved-places`, async ({ request }) => {
      const body = (await request.json()) as { poiId: string };
      const row: SavedPlace = {
        savedPlaceId: `saved-${body.poiId}`,
        savedAt: '2026-08-02T00:00:00Z',
        place: makePlace({ poiId: body.poiId }),
      };
      savedRows = [...savedRows, row];
      return HttpResponse.json(row, { status: 201 });
    }),
    http.delete(`${BASE}/saved-places/:savedPlaceId`, ({ params }) => {
      savedRows = savedRows.filter(
        (r) => r.savedPlaceId !== params.savedPlaceId
      );
      return new HttpResponse(null, { status: 204 });
    })
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

// 앞 화면이 심어 놓은 목록 캐시를 흉내내 QueryClient 에 직접 심는다(fetch 아님).
// `listCacheParams` 를 주면 base 키(`['/places']`)가 아니라 필터 조합 키(`['/places', {…}]`)로
// 심어, d04 가 region·category 로 캐시한 실제 모양을 재현한다. `guest` 면 토큰을 지운다.
function renderSeeded(
  poiId: string,
  opts: {
    listCache?: Place[];
    listCacheParams?: GetPlacesParams;
    guest?: boolean;
  } = {}
): void {
  if (opts.guest) clearAccessToken();
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  if (opts.listCache !== undefined) {
    // 캐시는 이제 PlaceList(`{items, nextCursor}`)를 담는다(TRIP-503) — 앞 화면이 심는 모양 그대로.
    client.setQueryData(getGetPlacesQueryKey(opts.listCacheParams), {
      items: opts.listCache,
      nextCursor: null,
    });
  }
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(<PlaceDetailPage poiId={poiId} />, { wrapper });
}

describe('D1 · d06 상세 표면 렌더 (AC-4) — 캐시만 읽고 전량 수신 안 함', () => {
  it('목록 캐시에서 장소를 찾아 그린다 — GET /places 는 부르지 않는다', async () => {
    // 준비 — 목록 캐시에 p1 을 심는다(앞 화면이 심은 상황). 실행 — p1 진입.
    renderSeeded('p1', { listCache: [makePlace()] });

    // 단언 — 상세 얼굴이 뜨고, 전량 목록 요청은 한 번도 안 나갔다(★TRIP-501).
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );
    expect(placesHandler).not.toHaveBeenCalled();

    expect(screen.getByTestId('explore-place-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-back')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-share')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-save')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-map')).toBeOnTheScreen();

    expect(screen.getByTestId('explore-place-title')).toHaveTextContent(
      '부산시립미술관'
    );
    expect(screen.getByTestId('explore-place-openhours')).toHaveTextContent(
      '10:00~18:00 (월 휴관)'
    );
    expect(screen.getByTestId('explore-place-address')).toHaveTextContent(
      '부산 부산진구'
    );
    expect(screen.getByText('#미술')).toBeOnTheScreen();
    expect(screen.getByText('#실내')).toBeOnTheScreen();
  });
});

describe('D2·D3·D4 · 저장 하트 서버 토글 (AC-5)', () => {
  it('D2 미담김 하트를 누르면 save(place) 가 나가고 filled+selected 로 굳는다', async () => {
    renderSeeded('p1', { listCache: [makePlace()] });
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('explore-place-save'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-filled')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-save-outline')).toBeNull();
    expect(screen.getByTestId('explore-place-save')).toBeSelected();
  });

  it('D3 재진입 시 savedPoiIds 에 있으면 처음부터 filled 다', async () => {
    savedRows = [
      {
        savedPlaceId: 'saved-p1',
        savedAt: '2026-08-01T00:00:00Z',
        place: makePlace(),
      },
    ];
    renderSeeded('p1', { listCache: [makePlace()] });

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-filled')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-save-outline')).toBeNull();
    expect(screen.getByTestId('explore-place-save')).toBeSelected();
  });

  it('D4 저장 실패 시 하트가 안 굳고(롤백) 안내가 뜬다 (INV-4)', async () => {
    server.use(
      http.post(
        `${BASE}/saved-places`,
        () => new HttpResponse(null, { status: 500 })
      )
    );
    renderSeeded('p1', { listCache: [makePlace()] });
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('explore-place-save'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-saveerror')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-place-save-filled')).toBeNull();
    expect(screen.getByTestId('explore-place-save')).not.toBeSelected();
  });
});

describe('D5 · 무발명 (AC-6 · INV-1)', () => {
  it('계약에 없는 필드는 지어내지 않는다 — 주소=미확인, 없는 블록의 testID 부재', async () => {
    renderSeeded('p1', {
      listCache: [makePlace({ region: null, openingHours: null, tags: [] })],
    });
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );

    expect(screen.getByTestId('explore-place-address')).toHaveTextContent(
      '미확인'
    );
    expect(
      screen.getByTestId('explore-place-unknown-openhours')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-place-openhours')).toBeNull();

    expect(screen.queryByTestId('explore-place-intro')).toBeNull();
    expect(screen.queryByTestId('explore-place-fee')).toBeNull();
    expect(screen.queryByTestId('explore-place-relphotos')).toBeNull();
    expect(screen.queryByTestId('explore-place-galcount')).toBeNull();
  });
});

describe('D6 · 뒤로가기 딥링크 탈출 (AC-7)', () => {
  it('히스토리가 있으면 back(), 딥링크면 홈으로 replace 한다', async () => {
    renderSeeded('p1', { listCache: [makePlace()] });
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-back')).toBeOnTheScreen()
    );
    fireEvent.press(screen.getByTestId('explore-place-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    mockBack.mockClear();
    mockCanGoBack.mockReturnValue(false);
    renderSeeded('p1', { listCache: [makePlace()] });
    const backs = await screen.findAllByTestId('explore-place-back');
    fireEvent.press(backs[backs.length - 1]);
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('D7 · 공유 실동작 (AC-8)', () => {
  it('공유를 누르면 Share.share 가 place.nameKo 로 불린다', async () => {
    const spy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);

    renderSeeded('p1', { listCache: [makePlace()] });
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-share')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('explore-place-share'));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].message).toBe('부산시립미술관');
    spy.mockRestore();
  });
});

describe('D8·D9 · 얼굴 판정', () => {
  it('D8 poiId 가 어느 캐시에도 없으면 notFound 얼굴이다', async () => {
    // 준비 — 목록 캐시 비어 있고 담은목록도 비어 해소된다.
    renderSeeded('ghost', { listCache: [] });

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-notfound')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-detail')).toBeNull();
    expect(placesHandler).not.toHaveBeenCalled();
  });

  it('D9 담은목록 해소 전엔 loading, 해소되면 담은목록 캐시로 상세를 그린다', async () => {
    // 준비 — 목록 캐시엔 없고, 담은목록에만 p1 이 있다(d02→d06 콜드 담은캐시).
    savedRows = [
      {
        savedPlaceId: 'saved-p1',
        savedAt: '2026-08-01T00:00:00Z',
        place: makePlace(),
      },
    ];
    // 실행 — 목록 캐시 비움, 담은목록 조회는 아직 pending.
    renderSeeded('p1', { listCache: [] });

    // 단언 — 담은목록이 pending 인 동안 loading 만(notFound 로 성급히 접지 않는다).
    expect(screen.getByTestId('explore-place-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-place-notfound')).toBeNull();
    expect(screen.queryByTestId('explore-place-detail')).toBeNull();

    // 해소되면 담은목록 캐시에서 찾아 상세를 그린다.
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );
    expect(placesHandler).not.toHaveBeenCalled();
  });
});

describe('D10·D11 · code-critic 사각 봉합 (TRIP-501)', () => {
  it('D10 필터 조합 키(region·category)로 캐시된 목록에서도 찾는다 (getQueriesData 부분일치)', async () => {
    // 준비 — d04 가 필터를 켜고 온 실제 캐시 모양: base 키가 아니라 ['/places', {region,category}].
    //  이 케이스가 없으면 읽기를 base 키 정확일치로 바꿔도 green 이라(getQueriesData→getQueryData),
    //  필터를 켠 d04 에서 온 모든 장소가 상세에서 notFound 로 깨지는 회귀를 못 잡는다.
    renderSeeded('p1', {
      listCache: [makePlace()],
      listCacheParams: { region: '부산', category: '문화' },
    });

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('explore-place-title')).toHaveTextContent(
      '부산시립미술관'
    );
    expect(placesHandler).not.toHaveBeenCalled();
  });

  it('D11 게스트(미인증)는 캐시 없어도 무한 로딩이 아니라 notFound 다', async () => {
    // 준비 — 토큰 없음. 게스트는 담은목록 쿼리가 enabled:false 라 isPending 이 영원히 true 다.
    //  로딩 게이트의 `isAuthed &&` 서브조건이 없으면 이 사용자는 끝나지 않는 로딩에 갇힌다.
    renderSeeded('ghost', { listCache: [], guest: true });

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-notfound')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-loading')).toBeNull();
    expect(placesHandler).not.toHaveBeenCalled();
  });
});
