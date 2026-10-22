import { http, HttpResponse } from 'msw';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { BASE } from '@/test-support/apiBase';
import { createGcZeroWrapper } from '@/test-support/queryRender';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type {
  Place,
  SavedPlace,
  SavedStay,
  StayItem,
} from '@/shared/api/index.schemas';
import { stayKey } from '@/features/save-stay';
import { useStaySearch } from '@/features/stay';
import { SAVE_FAILURE_NOTICE } from '@/features/save-place';
import { ExploreLandingPage } from '@/pages/explore/explore-landing';

/**
 * 탐색 d01 page 의 담기 하트 — 실제 담기 훅 + msw 로 나간 요청을 센다.
 *
 * seam: 숙소 검색(`useStaySearch`)만 목이다(카드 공급). 장소 조회·장소 담기 훅·숙소 담기 훅은 **실물**
 * — 담기 훅을 목하면 낙관 반영·롤백·연타 흡수가 사라져 이 파일이 무의미해진다.
 * 담김/미담김은 색이 아니라 서로 다른 글리프 testID(`-heart-filled-`·`-heart-outline-`)로 잰다.
 *
 * (개념) 한 act 안 두 press — `fireEvent.press` 를 따로 두 번 부르면 첫 press 의 상태가 반영돼 하트가
 * 잠기고 둘째 press 는 부모 카드로 샌다. "같은 순간 두 탭"은 두 press 를 한 `act` 에 넣어야 재현된다.
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
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/features/stay/model/useStaySearch', () => ({
  useStaySearch: jest.fn(),
}));
const mockUseStaySearch = useStaySearch as jest.MockedFunction<
  typeof useStaySearch
>;

/** 네트워크 도착을 기다리는 한도 — 로컬 기본 1000ms 의 CI 러너(약 4배 느림) 환산. */
const WAIT = { timeout: 4000 };

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

function stayResults(items: StayItem[]) {
  return {
    data: { items, degraded: false, filterZeroReasons: [] },
    isError: false,
    isPending: false,
  } as unknown as ReturnType<typeof useStaySearch>;
}

function renderPage(): void {
  render(<ExploreLandingPage />, { wrapper: createGcZeroWrapper() });
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
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// TRIP-1049 — 로그인 하트는 응답 전에 칠해지고(낙관), 담은 곳 FAB 수도 같은 캐시라 함께 움직인다.
describe('장소 하트 — 담기·해제', () => {
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

  beforeEach(() => {
    // 장소 레인 = A·B, 담은 장소 = B 하나, 숙소 = 없음.
    mockUseStaySearch.mockReturnValue(stayResults([]));
    server.use(
      http.get(`${BASE}/places`, () =>
        HttpResponse.json({ items: [PLACE_A, PLACE_B], nextCursor: null })
      ),
      http.get(`${BASE}/saved-places`, () => HttpResponse.json([SAVED_B])),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
    );
  });

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

  /** 로그인 상태로 그리고, B 가 담김으로 그려질 때까지(담은 목록 도착) 기다린다. */
  async function renderAuthedReady() {
    setAccessToken('valid-access');
    renderPage();
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
    expect(
      screen.getByTestId('explore-saved-menu-toggle')
    ).toHaveAccessibleName('담은 장소 1곳');
  }

  /** 대기 중 요청을 매듭짓는다 — 문을 열고 담은 목록 재조회(성공 후 무효화)까지 기다린다. */
  async function releaseAndSettle(gate: { release: () => void }) {
    gate.release();
    await waitFor(
      () => expect(hitCount('GET /api/v1/saved-places')).toBe(2),
      WAIT
    );
  }

  it('하트를 누르면 응답 전에 찬 하트·선택됨이고 FAB 라벨이 2곳 · 문을 열면 POST 1건, 실패 배너 없음', async () => {
    const gate = holdSavePost();
    await renderAuthedReady();

    fireEvent.press(screen.getByTestId(heartA));

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

    await releaseAndSettle(gate);
    expect(hitCount('POST /api/v1/saved-places')).toBe(1);
    expect(screen.queryByTestId('explore-place-save-error')).toBeNull();
  });

  it('같은 순간 두 번 눌러도(한 act 안) 담기 요청은 1건이다', async () => {
    const gate = holdSavePost();
    await renderAuthedReady();

    act(() => {
      fireEvent.press(screen.getByTestId(heartA));
      fireEvent.press(screen.getByTestId(heartA));
    });
    await waitFor(
      () =>
        expect(hitCount('POST /api/v1/saved-places')).toBeGreaterThanOrEqual(1),
      WAIT
    );

    await releaseAndSettle(gate);
    // 둘 다 끝난 뒤라 "아직 안 나감"이 아니다.
    expect(hitCount('POST /api/v1/saved-places')).toBe(1);
    expect(screen.queryByTestId('explore-place-save-error')).toBeNull();
  });

  it('담기 실패(404) → 빈 하트로 되돌리고 담기 실패 문구를 보인다', async () => {
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
    // 되돌림 — 배너만 띄우고 하트는 칠한 채 두는 구현 차단.
    expect(
      screen.getByTestId(`explore-place-heart-outline-${POI_A}`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(heartA)).not.toBeSelected();
  });

  // 잠긴 하트 press 는 부모 카드로 샌다 — 카드가 대기를 보고 막아야 한다.
  it('대기 중 하트를 다시 눌러도 장소 상세로 새지 않는다', async () => {
    const gate = holdSavePost();
    await renderAuthedReady();

    fireEvent.press(screen.getByTestId(heartA));
    await waitFor(
      () => expect(screen.getByTestId(heartA)).toBeDisabled(),
      WAIT
    );
    fireEvent.press(screen.getByTestId(heartA));

    expect(mockPush).not.toHaveBeenCalled();

    await releaseAndSettle(gate);
  });

  it('담긴 B 하트를 누르면 담기 기록 id 로 DELETE 1건이고, 응답 전에 빈 하트다', async () => {
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

    await releaseAndSettle(gate);
  });
});

// TRIP-447 AC-4~8 — 숙소 카드 하트.
describe('숙소 하트 — 담기·롤백·연타', () => {
  function stayItem(
    externalId: string,
    region: string,
    name: string,
    lat: number,
    lng: number,
    price: StayItem['price']
  ): StayItem {
    return {
      externalSource: 'NAVER',
      externalId,
      name,
      lat,
      lng,
      region,
      amenities: [],
      stayType: 'HOTEL',
      price,
    };
  }
  // 주소가 있어야 전국 d01 의 서비스 지역 거르기(TRIP-1432 — 주소 없으면 뺀다)를 통과한다.
  const ITEM_A: StayItem = {
    ...stayItem('s1', '해운대', '해운대 그랜드 호텔', 35.1587, 129.1604, {
      amount: 145000,
      currency: 'KRW',
    }),
    address: '부산광역시 해운대구 해운대해변로 296',
  };
  const ITEM_B: StayItem = {
    ...stayItem('s2', '서면', '서면 시티 호텔', 35.1577, 129.0594, null),
    address: '부산광역시 부산진구 중앙대로 692',
  };
  const KEY_A = stayKey(ITEM_A); // 'NAVER:s1'
  const KEY_B = stayKey(ITEM_B); // 'NAVER:s2'
  const SAVED_ID_A = 'aaaaaaaa-1111-1111-1111-111111111111';
  const NEW_SAVED_ID = '99999999-9999-9999-9999-999999999999';

  /** openapi SavedStay.required + 외부키를 채운 서버 담기 기록. */
  function savedFrom(source: StayItem, savedStayId: string): SavedStay {
    return {
      savedStayId,
      name: source.name,
      coordConfirmed: false,
      linkedTripIds: [],
      registerRoute: 'MAP_SEARCH',
      externalSource: source.externalSource,
      externalId: source.externalId,
      lat: source.lat,
      lng: source.lng,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
  }

  /** 담기 POST 를 문 뒤에 세운다(= "서버 응답 전"). */
  function holdSavePost() {
    const gate = createGate();
    server.use(
      http.post(`${BASE}/saved-stays`, async () => {
        await gate.opened;
        return HttpResponse.json(savedFrom(ITEM_A, NEW_SAVED_ID), {
          status: 201,
        });
      })
    );
    return gate;
  }

  /** 카드 A 의 빈 하트가 뜰 때까지(담은 목록 도착) 기다린다. */
  async function waitOutlineA() {
    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-heart-outline-${KEY_A}`)
      ).toBeOnTheScreen()
    );
  }

  beforeEach(() => {
    mockUseStaySearch.mockReturnValue(stayResults([ITEM_A, ITEM_B]));
    // 장소 레인·담은 장소는 이 describe 의 관심 밖이라 빈 응답만 준다.
    server.use(
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
      http.get(`${BASE}/saved-places`, () => HttpResponse.json([])),
      http.get(`${BASE}/places`, () =>
        HttpResponse.json({ items: [], nextCursor: null })
      )
    );
  });

  it('로그인 · 미담김 하트를 누르면 응답 전에 찬 하트+선택됨이고, 성공 뒤에도 실패 배너는 없다', async () => {
    setAccessToken('valid-access');
    const gate = holdSavePost();
    renderPage();
    await waitOutlineA();

    fireEvent.press(screen.getByTestId(`explore-stay-save-${KEY_A}`));

    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-heart-filled-${KEY_A}`)
      ).toBeOnTheScreen()
    );
    expect(screen.getByTestId(`explore-stay-save-${KEY_A}`)).toBeSelected();

    gate.release();
    await waitFor(() => expect(hitCount('GET /api/v1/saved-stays')).toBe(2));
    // 찬 하트와 "실패" 배너를 동시에 띄우는 거짓 실패 표시를 잠근다.
    expect(screen.queryByTestId('explore-stay-save-error')).toBeNull();
  });

  it('담은 목록에 A 가 있으면 press 없이 처음부터 A 만 찬 하트+선택됨이다(다른 카드로 새지 않는다)', async () => {
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([savedFrom(ITEM_A, SAVED_ID_A)])
      )
    );
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-heart-filled-${KEY_A}`)
      ).toBeOnTheScreen()
    );
    expect(screen.getByTestId(`explore-stay-save-${KEY_A}`)).toBeSelected();
    expect(
      screen.getByTestId(`explore-stay-heart-outline-${KEY_B}`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(`explore-stay-save-${KEY_B}`)).not.toBeSelected();
    expect(screen.queryByTestId('explore-stay-save-error')).toBeNull();
  });

  // 배너만 보면 "채우고 침묵"이, 하트만 보면 "되돌리고 침묵"이 통과한다 — 둘 다 단언(INV-4).
  it('담기 실패(500) → 실패 배너가 보이고, 하트는 찬 하트로 굳지 않고 되돌아간다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.post(`${BASE}/saved-stays`, () =>
        HttpResponse.json({ error: { code: 'X' } }, { status: 500 })
      )
    );
    renderPage();
    await waitOutlineA();

    fireEvent.press(screen.getByTestId(`explore-stay-save-${KEY_A}`));

    await waitFor(() =>
      expect(screen.getByTestId('explore-stay-save-error')).toBeOnTheScreen()
    );
    expect(
      screen.getByTestId(`explore-stay-heart-outline-${KEY_A}`)
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`explore-stay-heart-filled-${KEY_A}`)
    ).toBeNull();
    expect(screen.getByTestId(`explore-stay-save-${KEY_A}`)).not.toBeSelected();
  });

  it('응답 대기 중 하트를 다시 눌러도 POST 는 1건뿐이다', async () => {
    setAccessToken('valid-access');
    const gate = holdSavePost();
    renderPage();
    await waitOutlineA();

    fireEvent.press(screen.getByTestId(`explore-stay-save-${KEY_A}`));
    await waitFor(() =>
      expect(screen.getByTestId(`explore-stay-save-${KEY_A}`)).toBeDisabled()
    );
    fireEvent.press(screen.getByTestId(`explore-stay-save-${KEY_A}`));

    gate.release();
    await waitFor(() =>
      expect(
        screen.getByTestId(`explore-stay-save-${KEY_A}`)
      ).not.toBeDisabled()
    );
    expect(hitCount('POST /api/v1/saved-stays')).toBe(1);
  });
});

// TRIP-1432 — 전국 d01 장소 레인은 실제 다지역 훅으로 서울·부산·제주를 지역당 200곳씩 따로 묻는다. 지역 없는
// 전국 조회는 안 나가고, 한두 곳이 실패해도 남은 지역 카드로 레인을 채운다(전부 실패만 재시도).
describe('전국 d01 장소 레인 — 서비스 지역 3곳 조회', () => {
  function lanePlace(poiId: string, regionCode: string, photo: boolean): Place {
    return {
      poiId,
      nameKo: poiId,
      category: '명소',
      lat: 37.5,
      lng: 127.0,
      region: null,
      regionCode,
      openingHours: null,
      imageUrl: photo ? `https://img.example/${poiId}.jpg` : null,
      tags: [],
      savedCount: 0,
      dataStatus: 'ACTIVE',
    };
  }
  const BY_REGION: Record<string, Place[]> = {
    서울: Array.from({ length: 9 }, (_, i) =>
      lanePlace(`s${i}`, '11110', true)
    ),
    부산: [lanePlace('b0', '26350', true)],
    제주: [lanePlace('j0', '50110', false)],
  };

  let placesQueries: {
    region: string | null;
    limit: string | null;
    order: string | null;
    seed: string | null;
  }[] = [];

  /** 지역별로 응답한다. `failing` 에 든 지역은 500. */
  function servePlaces(failing: string[] = []): void {
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const url = new URL(request.url);
        const region = url.searchParams.get('region');
        placesQueries.push({
          region,
          limit: url.searchParams.get('limit'),
          order: url.searchParams.get('order'),
          seed: url.searchParams.get('seed'),
        });
        if (region !== null && failing.includes(region)) {
          return new HttpResponse(null, { status: 500 });
        }
        return HttpResponse.json({
          items: region === null ? [] : (BY_REGION[region] ?? []),
          nextCursor: null,
        });
      })
    );
  }

  beforeEach(() => {
    placesQueries = [];
    mockUseStaySearch.mockReturnValue(stayResults([]));
    server.use(
      http.get(`${BASE}/saved-places`, () => HttpResponse.json([])),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
    );
  });

  it('지역마다 200곳씩 3번 묻고 지역 없는 조회는 0건 — 레인 8장은 사진 먼저·지역 번갈아다', async () => {
    servePlaces();
    renderPage();

    await waitFor(
      () =>
        expect(screen.getByTestId('explore-place-card-b0')).toBeOnTheScreen(),
      WAIT
    );

    expect(placesQueries.map((q) => q.region).sort()).toEqual(
      ['부산', '서울', '제주'].sort()
    );
    expect(placesQueries.every((q) => q.limit === '200')).toBe(true);
    // TRIP-1563 — 무작위 시드는 d04 만 쓴다: d01 은 order·seed 를 안 보내 홈과 같은 이름순·같은 캐시를 유지한다.
    expect(
      placesQueries.every((q) => q.order === null && q.seed === null)
    ).toBe(true);
    for (const id of ['s0', 's1', 's2', 's3', 's4', 's5', 's6']) {
      expect(screen.getByTestId(`explore-place-card-${id}`)).toBeOnTheScreen();
    }
    for (const id of ['s7', 's8', 'j0']) {
      expect(screen.queryByTestId(`explore-place-card-${id}`)).toBeNull();
    }
  });

  it('서울만 실패해도 성공한 지역 카드로 레인을 채우고 재시도는 없다', async () => {
    servePlaces(['서울']);
    renderPage();

    // 서울이 실패해도 살아남은 부산·제주가 한 레인에 같이 합쳐진다(첫 지역만 남기는 고장을 잡는다).
    await waitFor(
      () =>
        expect(screen.getByTestId('explore-place-card-b0')).toBeOnTheScreen(),
      WAIT
    );

    expect(screen.getByTestId('explore-place-card-j0')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-place-card-s0')).toBeNull();
    expect(screen.queryByTestId('explore-lane-place-retry')).toBeNull();
  });

  it('세 곳이 다 실패하면 장소 레인 자리에 재시도를 띄운다(빈 목록으로 위장하지 않는다)', async () => {
    servePlaces(['서울', '부산', '제주']);
    renderPage();

    await waitFor(
      () =>
        expect(
          screen.getByTestId('explore-lane-place-retry')
        ).toBeOnTheScreen(),
      WAIT
    );
    expect(screen.queryByTestId('explore-lane-place-empty')).toBeNull();
  });
});
