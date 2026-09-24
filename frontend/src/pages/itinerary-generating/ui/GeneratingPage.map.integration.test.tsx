import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  GenerateItineraryRequestGenerationMode,
  MustVisit,
  Place,
  SavedPlace,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { GeneratingPage } from './GeneratingPage';

/**
 * TRIP-929 · h07 생성 중 지도에 **실 좌표**가 흐르는지를 실 HTTP 로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - 꼭 갈 곳(`GET /trips/{id}/must-visits`)과 담은 장소(`GET /saved-places`)를 이어 번호 핀을
 *    만들고, 첫 핀 좌표를 지도 중심으로 넘긴다(M1). 연결선은 그리지 않는다(M2, INV-2).
 *  - 좌표가 하나도 없으면 지도 카드를 통째로 생략한다(M3~M5, INV-4). `[]` 는 JS 에서 참이라
 *    `pins && center` 게이트를 막는 것은 `center` 뿐이다 — M5 가 그 급소.
 *  - 조회 도착으로 페이지가 다시 그려져도 생성 POST 는 1회다(M6, `firedRef` 의 첫 심판).
 *  - 조회가 실패하면 지도만 빠지고 생성 실패 표면은 뜨지 않는다(M7, Seed Q2).
 *  - CO_PLAN 갈래도 같은 지도를 보인다(M8, Seed Q3).
 *
 * 왜 통합 버킷인가: 지도가 뜨는지는 **어떤 요청이 나갔고 무엇이 돌아왔나**에 달려 있다. 조회 훅을
 * 목킹하면 "미로그인이면 saved-places 가 안 나간다"가 테스트의 가정이 된다. 생성 POST 만 기존
 * 파일처럼 훅 목으로 둔다(진행 중 상태를 붙들어 두려고).
 *
 * 3동작 뼈대: 준비 = 가짜 서버 응답·로그인 상태 → 실행 = 페이지 렌더 후 조회가 끝날 때까지 대기
 * (`settle`) → 단언 = 지도 카드·좌표·핀·나간 요청·POST 횟수.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외.
const mockMutate = jest.fn();

// 조회 훅(useGetTripsTripIdMustVisits 등)은 실물 그대로 두고 생성 POST 만 바꾼다. 목은 **호출마다
// 새 객체**를 준다 — 실 useMutation 도 렌더마다 새 객체라, 이래야 `firedRef` 없이는 재렌더마다
// effect 가 다시 돌아 POST 가 또 나간다(M6 이 재는 것).
jest.mock('@/shared/api/generated/trips/trips', () => ({
  ...jest.requireActual('@/shared/api/generated/trips/trips'),
  usePostTripsTripIdItinerary: () => ({
    mutate: mockMutate,
    isPending: true,
    isError: false,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
  }),
}));

// 지도를 관찰 마커로 바꾼다 — 중심 좌표는 `map-root` 텍스트, 나머지 prop 은 그대로 통과한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/** `authWiring.integration.test.ts:59` 와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';

/** 첫 핀(A)과 둘째 핀(B)의 좌표는 서로 다르고 둘의 평균(35.12935,129.1802)과도 다르다 —
 * 중심이 "첫 핀"이 아니면 텍스트 완전 일치에서 갈린다. */
const A = { poiId: 'poi-a', lat: 35.1587, lng: 129.1604 };
const B = { poiId: 'poi-b', lat: 35.1, lng: 129.2 };
const A_CENTER_TEXT = '35.1587,129.1604';

function savedPlace(spot: { poiId: string; lat: number; lng: number }) {
  const place: Place = {
    poiId: spot.poiId,
    nameKo: `장소-${spot.poiId}`,
    category: '명소',
    lat: spot.lat,
    lng: spot.lng,
    region: '부산진구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
  const entry: SavedPlace = {
    savedPlaceId: `sp-${spot.poiId}`,
    savedAt: '2026-09-01T10:00:00.000Z',
    place,
  };
  return entry;
}

function mustVisit(sourcePoiId: string): MustVisit {
  return {
    mustVisitId: `mv-${sourcePoiId}`,
    poiSnapshotId: `snap-${sourcePoiId}`,
    sourcePoiId,
    type: 'ANYTIME',
  };
}

/** 나간 요청의 `METHOD /경로` 누적. */
let observedHits: string[] = [];

function hitsFor(method: string, includes: string): number {
  return observedHits.filter(
    (hit) => hit.startsWith(method) && hit.includes(includes)
  ).length;
}

/** 가짜 서버 응답을 건다. 통합 버킷은 `onUnhandledRequest: 'error'` 라 두 GET 을 매번 명시한다. */
function serve(input: {
  mustVisits: MustVisit[] | { status: number };
  savedPlaces: SavedPlace[] | { status: number };
}) {
  server.use(
    http.get(`${BASE}/trips/:tripId/must-visits`, () =>
      Array.isArray(input.mustVisits)
        ? HttpResponse.json(input.mustVisits)
        : HttpResponse.json({}, { status: input.mustVisits.status })
    ),
    http.get(`${BASE}/saved-places`, () =>
      Array.isArray(input.savedPlaces)
        ? HttpResponse.json(input.savedPlaces)
        : HttpResponse.json({}, { status: input.savedPlaces.status })
    )
  );
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  mockMutate.mockClear();
  setAccessToken('valid-access');
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/**
 * `retry: false` — 실패를 즉시 실패로 본다(재시도가 돌면 M7 이 흔들린다).
 * `gcTime: 0` — 기본 타이머가 테스트 뒤까지 살아 프로세스를 붙잡지 않게.
 * 클라이언트를 돌려주는 이유: `settle` 이 "조회가 전부 끝났나"를 여기서 읽는다.
 */
function renderPage(props?: {
  mode?: GenerateItineraryRequestGenerationMode;
  successRoute?: '/trips/[tripId]/itinerary/copick/[slotKey]';
}) {
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
  render(<GeneratingPage tripId={TRIP_ID} {...props} />, { wrapper: Wrapper });
  return client;
}

/**
 * 조회가 끝나 **화면까지 도착할 때까지** 기다린다. 첫 렌더엔 조회가 아직 안 끝나 지도가 원래
 * 없으므로, 이 대기 없이 "지도 없음"을 단언하면 무엇을 구현해도 통과한다.
 *  ① must-visits 요청이 실제로 나갔다 → ② 진행 중인 조회가 0개 → ③ react-query 가 화면에 알리는
 *  예약(setTimeout 0) 한 틱을 흘린다.
 * 이 대기가 충분하다는 것은 M1·M6·M8 이 대기 직후 **기다림 없는** `getByTestId` 로 지도를 찾는
 * 것으로 매번 증명된다.
 */
async function settle(client: QueryClient) {
  await waitFor(() =>
    expect(hitsFor('GET', '/must-visits')).toBeGreaterThanOrEqual(1)
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('M1 · AC-1 — 꼭 갈 곳 좌표가 있으면 지도가 뜨고 중심은 첫 핀이다', () => {
  it('지도 카드가 있고, 중심은 첫 핀(A) 좌표, 핀은 [①A, ②B] 다', async () => {
    serve({
      mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
      savedPlaces: [savedPlace(A), savedPlace(B)],
    });
    const client = renderPage();

    await settle(client);

    expect(screen.getByTestId('itinerary-generating-map')).toBeOnTheScreen();
    const map = screen.getByTestId('map-root');
    // 완전 일치 — B 좌표·평균 좌표면 red.
    expect(map).toHaveTextContent(A_CENTER_TEXT);
    expect(map.props.pins).toEqual([
      { number: 1, lat: A.lat, lng: A.lng },
      { number: 2, lat: B.lat, lng: B.lng },
    ]);
  });
});

describe('M9 · AC-1 — 첫 꼭 갈 곳에 좌표가 없어도 지도는 뜨고, 핀 번호는 당기지 않는다', () => {
  it('꼭 갈 곳 [Z, A]·담은 장소 [A] 면 중심은 A, 핀은 [②A] 하나다', async () => {
    // Z 는 담기를 해제한 곳 — 좌표가 없다. 중심을 "첫 꼭 갈 곳"에서 찾으면 지도가 사라지고,
    // 핀을 1..n 으로 다시 매기면 ②가 ①이 되어 h05 목록 번호와 어긋난다.
    serve({
      mustVisits: [mustVisit('poi-z'), mustVisit(A.poiId)],
      savedPlaces: [savedPlace(A)],
    });
    const client = renderPage();

    await settle(client);

    expect(screen.getByTestId('itinerary-generating-map')).toBeOnTheScreen();
    const map = screen.getByTestId('map-root');
    expect(map).toHaveTextContent(A_CENTER_TEXT);
    expect(map.props.pins).toEqual([{ number: 2, lat: A.lat, lng: A.lng }]);
  });
});

describe('M2 · AC-3 — 생성 중 지도는 핀 사이 연결선을 그리지 않는다 (INV-2)', () => {
  it('페이지를 거쳐 그린 지도의 connectPins 가 false 다', async () => {
    serve({
      mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
      savedPlaces: [savedPlace(A), savedPlace(B)],
    });
    const client = renderPage();

    await settle(client);

    expect(screen.getByTestId('map-root').props.connectPins).toBe(false);
  });
});

describe('M3~M5 · AC-2 — 좌표가 없으면 지도 카드를 통째로 생략한다 (INV-4)', () => {
  it('M3 (a) 담은 꼭 갈 곳이 0곳이면 — 담은 장소가 있어도 — 지도가 없고 진행 표면은 있다', async () => {
    // 담은 장소 A·B 를 일부러 둔다: 꼭 갈 곳 대신 담은 장소 전부를 핀으로 쓰면 지도가 떠서 red.
    serve({ mustVisits: [], savedPlaces: [savedPlace(A), savedPlace(B)] });
    const client = renderPage();

    await settle(client);

    expect(screen.queryByTestId('itinerary-generating-map')).toBeNull();
    expect(screen.queryByTestId('map-root')).toBeNull();
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
  });

  it('M4 (b) 미로그인이면 saved-places 요청이 0건이고 지도가 없으며 진행 표면은 있다 (BR-U1-03)', async () => {
    clearAccessToken();
    // 핸들러를 걸어 둬야 "0건"이 공허하지 않다 — 나갔다면 로그에 잡힌다.
    serve({
      mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
      savedPlaces: [savedPlace(A), savedPlace(B)],
    });
    const client = renderPage();

    await settle(client);

    expect(hitsFor('GET', '/saved-places')).toBe(0);
    expect(screen.queryByTestId('itinerary-generating-map')).toBeNull();
    expect(screen.queryByTestId('map-root')).toBeNull();
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
  });

  it('M5 (c) 꼭 갈 곳은 있지만 담은 장소에 짝이 없으면(핀 0개) 지도가 없고 진행 표면은 있다', async () => {
    // Z 는 담기를 해제한 곳 — saved-places 에 없어 좌표가 없다. 핀은 [] 가 되는데 [] 는 참이라,
    // 이때 중심에 폴백 좌표를 넣으면 빈 지도가 뜬다(급소).
    serve({
      mustVisits: [mustVisit('poi-z')],
      savedPlaces: [savedPlace(A), savedPlace(B)],
    });
    const client = renderPage();

    await settle(client);

    expect(screen.queryByTestId('itinerary-generating-map')).toBeNull();
    expect(screen.queryByTestId('map-root')).toBeNull();
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();
  });
});

describe('M6 · AC-5 — 조회 도착으로 다시 그려져도 생성 POST 는 1회다', () => {
  it('지도가 뜬 뒤(=재렌더가 일어난 뒤)에도 POST 는 1회이고 body 는 generationMode 하나뿐이다', async () => {
    serve({
      mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
      savedPlaces: [savedPlace(A), savedPlace(B)],
    });
    const client = renderPage();

    await settle(client);

    // 지도가 있다 = 조회 결과가 도착해 페이지가 최소 한 번 다시 그려졌다(재렌더의 증거).
    expect(screen.getByTestId('itinerary-generating-map')).toBeOnTheScreen();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    // 좌표 조회가 붙어도 POST body 에 새 키가 붙지 않는다(BR-U3-03, 정확 일치).
    const vars = mockMutate.mock.calls[0][0] as { data?: unknown };
    expect(vars.data).toEqual({ generationMode: 'FULLY_AI' });
  });
});

describe('M7 · Seed Q2 — 좌표 조회가 실패하면 지도만 빠지고 생성 실패 표면은 뜨지 않는다', () => {
  it.each([
    {
      label: 'must-visits 500',
      mustVisits: { status: 500 },
      savedPlaces: [savedPlace(A), savedPlace(B)],
    },
    {
      label: 'saved-places 500',
      mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
      savedPlaces: { status: 500 },
    },
  ])(
    '$label — 지도 없음, 실패 표면 없음, 진행 표면 있음',
    async ({ mustVisits, savedPlaces }) => {
      serve({ mustVisits, savedPlaces });
      const client = renderPage();

      await settle(client);

      expect(screen.queryByTestId('itinerary-generating-map')).toBeNull();
      // 생성 POST 는 아직 진행 중이다 — "일정을 만들지 못했어요"가 뜨면 거짓 실패.
      expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
      expect(
        screen.getByTestId('itinerary-generating-progress')
      ).toBeOnTheScreen();
    }
  );
});

describe('M8 · Seed Q3 — CO_PLAN 갈래도 같은 지도를 보인다', () => {
  it('mode=CO_PLAN 이어도 지도 카드가 있고 중심은 첫 핀(A) 좌표다', async () => {
    serve({
      mustVisits: [mustVisit(A.poiId), mustVisit(B.poiId)],
      savedPlaces: [savedPlace(A), savedPlace(B)],
    });
    const client = renderPage({
      mode: 'CO_PLAN',
      successRoute: '/trips/[tripId]/itinerary/copick/[slotKey]',
    });

    await settle(client);

    expect(screen.getByTestId('itinerary-generating-map')).toBeOnTheScreen();
    expect(screen.getByTestId('map-root')).toHaveTextContent(A_CENTER_TEXT);
  });
});
