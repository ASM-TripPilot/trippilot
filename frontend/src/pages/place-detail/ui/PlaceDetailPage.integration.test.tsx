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
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { PlaceDetailPage } from './PlaceDetailPage';

/**
 * TRIP-456 · AC-4·5·6·7·8 — d06 장소 상세 배선(페이지 층).
 *
 * 무엇을 보장하나:
 *  - **D1 (AC-4)** poiId 로 목록 캐시(`GET /places`)에서 장소를 찾아 상세 표면을 그린다.
 *  - **D2·D3·D4 (AC-5)** 하트가 `useSavedPlaces` 로 **서버 토글**된다 — 담김/미담김을 서로 다른
 *    글리프 testID + `selected` 로 관찰(색 fill 아님, 02a ★4). 실패는 롤백(안 굳음)+안내(INV-4).
 *  - **D5 (AC-6)** 계약에 없는 필드는 지어내지 않는다 — 주소=region ?? '미확인', 없는 블록은 testID 부재.
 *  - **D6 (AC-7)** 뒤로가기가 딥링크(히스토리 없음)에서 갇히지 않는다(canGoBack 폴백).
 *  - **D7 (AC-8)** 공유가 `Share.share` 를 place.nameKo 로 실제로 부른다.
 *  - **D8·D9** 못 찾으면 notFound 얼굴(오케 결정), 조회 중엔 loading 얼굴(공개 쿼리 기준, ★6).
 *
 * 왜 통합 버킷인가: 데이터 출처 A(목록 캐시 읽기)·저장 토글의 낙관/롤백은 실 조회에서 갈리므로,
 * 훅을 목킹하면 그 조합이 테스트의 가정이 되어 버린다(`LivePlacePage.integration` 계승).
 *
 * ★ 담김/미담김은 `explore-place-save-{filled,outline}` **서로 다른 글리프 testID** +
 *   `accessibilityState.selected`(=`toBeSelected()`)로 잰다 — SVG fill 은 렌더 트리에 안 남는다
 *   (repo-trap 글리프 함정, d02 선례). 02a ★4.
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

// 목록·담은목록 캐시를 각 테스트가 세팅한다(POST/DELETE 가 savedRows 를 고친다).
let placesData: Place[] = [];
let savedRows: SavedPlace[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  placesData = [makePlace()];
  savedRows = [];
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockReset();
  mockCanGoBack.mockReturnValue(true);
  clearAccessToken();
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/places`, () =>
      HttpResponse.json({ items: placesData, nextCursor: null })
    ),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(savedRows)),
    http.post(`${BASE}/saved-places`, async ({ request }) => {
      const body = (await request.json()) as { poiId: string };
      const place =
        placesData.find((p) => p.poiId === body.poiId) ?? makePlace();
      const row: SavedPlace = {
        savedPlaceId: `saved-${body.poiId}`,
        savedAt: '2026-08-02T00:00:00Z',
        place,
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

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('D1 · d06 상세 표면 렌더 (AC-4)', () => {
  it('poiId 로 목록 캐시에서 장소를 찾아 갤러리·정보·미니맵을 그린다', async () => {
    // 준비·실행 — p1 로 진입.
    render(<PlaceDetailPage poiId="p1" />, { wrapper });

    // 단언 — 상세 얼굴 + 갤러리 컨트롤 + 정보 카드 + 미니맵.
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('explore-place-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-back')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-share')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-save')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-map')).toBeOnTheScreen();

    // leaf 는 완전일치(문자열 매처 = exact, 02a §5).
    expect(screen.getByTestId('explore-place-title')).toHaveTextContent(
      '부산시립미술관'
    );
    expect(screen.getByTestId('explore-place-openhours')).toHaveTextContent(
      '10:00~18:00 (월 휴관)'
    );
    expect(screen.getByTestId('explore-place-address')).toHaveTextContent(
      '부산 부산진구'
    );

    // 태그칩 — 각 tag 앞에 #.
    expect(screen.getByText('#미술')).toBeOnTheScreen();
    expect(screen.getByText('#실내')).toBeOnTheScreen();
  });
});

describe('D2·D3·D4 · 저장 하트 서버 토글 (AC-5)', () => {
  it('D2 미담김 하트를 누르면 save(place) 가 나가고 filled+selected 로 굳는다', async () => {
    // 준비 — 담은 목록 비어 있음(미담김).
    render(<PlaceDetailPage poiId="p1" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen()
    );

    // 실행 — 하트를 누른다.
    fireEvent.press(screen.getByTestId('explore-place-save'));

    // 단언 — 담김: filled 글리프로 바뀌고 selected, outline 은 사라진다(색 아님).
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-filled')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-save-outline')).toBeNull();
    expect(screen.getByTestId('explore-place-save')).toBeSelected();
  });

  it('D3 재진입 시 savedPoiIds 에 있으면 처음부터 filled 다', async () => {
    // 준비 — 이미 담은 상태.
    savedRows = [
      {
        savedPlaceId: 'saved-p1',
        savedAt: '2026-08-01T00:00:00Z',
        place: makePlace(),
      },
    ];
    render(<PlaceDetailPage poiId="p1" />, { wrapper });

    // 단언 — 누르지 않아도 filled + selected.
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-filled')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-save-outline')).toBeNull();
    expect(screen.getByTestId('explore-place-save')).toBeSelected();
  });

  it('D4 저장 실패 시 하트가 안 굳고(롤백) 안내가 뜬다 (INV-4)', async () => {
    // 준비 — POST 가 500 을 준다.
    server.use(
      http.post(
        `${BASE}/saved-places`,
        () => new HttpResponse(null, { status: 500 })
      )
    );
    render(<PlaceDetailPage poiId="p1" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen()
    );

    // 실행 — 담기를 시도하지만 서버가 거부한다.
    fireEvent.press(screen.getByTestId('explore-place-save'));

    // 단언 — 롤백으로 outline 으로 돌아오고(안 굳음), 침묵하지 않고 안내를 세운다.
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
    // 준비 — region·openingHours 가 NULL, 태그 없음.
    placesData = [makePlace({ region: null, openingHours: null, tags: [] })];
    render(<PlaceDetailPage poiId="p1" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );

    // 긍정 — 주소는 region 없으면 '미확인', 영업시간 NULL 은 unknown 자리로 바뀐다.
    expect(screen.getByTestId('explore-place-address')).toHaveTextContent(
      '미확인'
    );
    expect(
      screen.getByTestId('explore-place-unknown-openhours')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-place-openhours')).toBeNull();

    // 부재 짝 — 소개·입장료·관련사진·갤러리카운트는 데이터원이 없어 자리 자체를 안 만든다.
    expect(screen.queryByTestId('explore-place-intro')).toBeNull();
    expect(screen.queryByTestId('explore-place-fee')).toBeNull();
    expect(screen.queryByTestId('explore-place-relphotos')).toBeNull();
    expect(screen.queryByTestId('explore-place-galcount')).toBeNull();
  });
});

describe('D6 · 뒤로가기 딥링크 탈출 (AC-7)', () => {
  it('히스토리가 있으면 back(), 딥링크면 홈으로 replace 한다', async () => {
    // ⑴ 히스토리 있음.
    render(<PlaceDetailPage poiId="p1" />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-back')).toBeOnTheScreen()
    );
    fireEvent.press(screen.getByTestId('explore-place-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    // ⑵ 딥링크(히스토리 없음) — replace('/(tabs)') 만.
    mockBack.mockClear();
    mockCanGoBack.mockReturnValue(false);
    render(<PlaceDetailPage poiId="p1" />, { wrapper });
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

    render(<PlaceDetailPage poiId="p1" />, { wrapper });
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
    // 준비 — 두 캐시 모두 비어 있음.
    placesData = [];
    savedRows = [];
    render(<PlaceDetailPage poiId="ghost" />, { wrapper });

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-notfound')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-detail')).toBeNull();
  });

  it('D9 조회 로딩 창에서는 loading 얼굴만 서고 notFound·detail 은 아직 없다', async () => {
    // 실행 — 렌더 직후 동기 초기 렌더(msw settle 전, waitFor 없음).
    render(<PlaceDetailPage poiId="p1" />, { wrapper });

    // 단언 — 공개 목록 조회가 pending 인 동안 loading 만.
    expect(screen.getByTestId('explore-place-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-place-notfound')).toBeNull();
    expect(screen.queryByTestId('explore-place-detail')).toBeNull();

    // 정리 — settle 시켜 teardown 의 act 경고를 없앤다(단언 아님).
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );
  });
});
