import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { getGetSavedPlacesQueryKey } from '@/shared/api/generated/places/places';
import type {
  Place,
  SavedPlace,
  SavedStay,
} from '@/shared/api/generated/schemas';

import { SavedPlacesPage } from './SavedPlacesPage';

/**
 * TRIP-449 d02 담은 곳 — **숙소·장소 분리 + 통합 빈 상태**의 배선(01b Seed AC-1~6·게스트).
 * 장소 축 배선은 동결 `SavedPlacesPage.integration.test.tsx`가 이미 잠갔다(그 파일은 이 사이클에서
 * 한 글자도 안 건드린다). 이 파일은 **숙소 축을 additive로 얹었을 때의 관찰 가능한 동작**만 잰다.
 *
 * 무엇을 보장하나:
 *  - **AC-1** 장소·숙소가 둘 다 있으면 각 섹션을 나눠 본다(`explore-saved-item-*` & `saved-stay-item-*`).
 *  - **AC-2** 숙소를 담아두면 숙소 섹션에 그 숙소 이름이 뜬다.
 *  - **AC-3** 장소·숙소 둘 다 0이면 통합 빈 상태만 뜬다(목록·부제·CTA·숙소 섹션 없음).
 *  - **AC-4** 숙소 해제는 `DELETE /saved-stays/{id}`를 그 id로 **정확히 1회** 쏘고 그 행만 뺀다(★3).
 *  - **AC-5a/5b** 한쪽 조회가 5xx여도 다른 축은 산다 — **양방향 둘 다**(★1, 전역 error 접기 차단).
 *  - **AC-6** 숙소 조회가 아직이면 통합 빈 상태를 **먼저 그리지 않는다**(★2, 조회 중 거짓 empty 잠금).
 *  - **AC-게스트** 미로그인은 두 조회를 아예 안 보낸다 + 로그인 안내(게스트 판정 > 상태 판정).
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 나간 요청**"(어느 숙소 id를 지웠나 · 요청 유무)이다 — msw 만
 * 관찰할 수 있다. 그래서 `useSavedStays`를 **목하지 않는다**(목이면 관찰 대상이 사라진다).
 *
 * ★ 빈/찬은 색이 아니라 testID 존재/부재로 잰다(repo-trap 글리프 함정 회피).
 * ★ 숙소 축은 **additive 옵셔널 prop** — 미지정 시 섹션 미렌더라 동결 장소 축 테스트는 불변이다.
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

// ★ `router.push`를 화살표로 감싸 지연 참조한다 — `jest.mock` 팩토리는 hoist 되어 `mockPush`
// 선언보다 먼저 도는데, 즉시 읽으면 그 시점의 undefined 가 박힌다(프론즌 파일 ★8 계승).
jest.mock('expo-router', () => ({
  router: {
    push: (href: string) => mockPush(href),
    back: () => mockBack(),
  },
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({}),
}));

const BASE = 'http://localhost:8080/api/v1';

function makePlace(
  poiId: string,
  nameKo: string,
  region: string | null
): Place {
  return {
    poiId,
    nameKo,
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

function makeSavedPlace(
  savedPlaceId: string,
  savedAt: string,
  place: Place
): SavedPlace {
  return { savedPlaceId, savedAt, place };
}

function makeStay(savedStayId: string, name: string): SavedStay {
  return {
    savedStayId,
    name,
    lat: 35.1531,
    lng: 129.1188,
    coordConfirmed: true,
    checkIn: '2026-08-10',
    checkOut: '2026-08-12',
    externalSource: null,
    externalId: null,
    registerRoute: 'MAP_SEARCH',
    memo: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

const PLACE_A = makeSavedPlace(
  'sp-a',
  '2026-08-01T10:00:00.000Z',
  makePlace('p1', '감천문화마을', '사하구')
);
const STAY_B = makeStay('ss-b', '광안리 오션뷰');
const STAY_C = makeStay('ss-c', '해운대 게스트하우스');

/** 테스트가 풀어 줄 때까지 응답하지 않는 문(리포 선례). `delay(ms)`로 재면 느린 CI 에서 흔들린다. */
function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

let savedPlaceRows: SavedPlace[] = [];
let savedStayRows: SavedStay[] = [];
let observed: { method: string; url: string }[] = [];

function hitsOf(method: string, pathname: string) {
  return observed.filter(
    (hit) => hit.method === method && new URL(hit.url).pathname === pathname
  );
}

/** 나간 숙소 DELETE 의 대상 savedStayId 들 — 장소 DELETE(/saved-places/*)와 구분한다. */
function deletedStayIds(): string[] {
  return observed
    .filter(
      (hit) =>
        hit.method === 'DELETE' &&
        new URL(hit.url).pathname.startsWith('/api/v1/saved-stays/')
    )
    .map((hit) => new URL(hit.url).pathname.split('/').slice(-1)[0]);
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

beforeEach(() => {
  observed = [];
  savedPlaceRows = [];
  savedStayRows = [];
  mockPush.mockClear();
  mockBack.mockClear();
  clearAccessToken();

  server.use(
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(savedPlaceRows)),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json(savedStayRows)),
    http.delete(`${BASE}/saved-stays/:savedStayId`, ({ params }) => {
      savedStayRows = savedStayRows.filter(
        (row) => row.savedStayId !== params.savedStayId
      );
      return new HttpResponse(null, { status: 204 });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

function createClient() {
  return new QueryClient({
    defaultOptions: {
      // gcTime:0 — 기본 타이머가 테스트 종료 후에도 Node 를 붙잡는다. mutations 쪽도 반드시 0.
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
}

function renderPage(client: QueryClient = createClient()) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, ...render(<SavedPlacesPage />, { wrapper: Wrapper }) };
}

function placeItemTestIds(): string[] {
  return screen
    .queryAllByTestId(/^explore-saved-item-/)
    .map((node) => String(node.props.testID));
}

describe('AC-1 · 장소·숙소를 나눠 본다', () => {
  it('장소와 숙소가 둘 다 있으면 각 섹션의 항목을 함께 볼 수 있다', async () => {
    setAccessToken('valid-access');
    savedPlaceRows = [PLACE_A];
    savedStayRows = [STAY_B];

    renderPage();

    // 장소 A 는 현행도 그린다 — 두 축이 함께 사는지가 이 케이스의 핵심.
    await screen.findByTestId('explore-saved-item-sp-a');
    await screen.findByTestId('saved-stay-item-ss-b');
  });
});

describe('AC-2 · 숙소 이름이 숙소 섹션에 뜬다', () => {
  it('숙소를 담아두면 숙소 섹션에 그 숙소 이름이 보인다', async () => {
    setAccessToken('valid-access');
    savedStayRows = [STAY_B];

    renderPage();

    const section = await screen.findByTestId('saved-stay-section');
    expect(within(section).getByText('광안리 오션뷰')).toBeOnTheScreen();
  });
});

describe('AC-3 · 장소·숙소 둘 다 0이면 통합 빈 상태', () => {
  it('빈 상태만 그리고 목록·부제·CTA·숙소 섹션은 없다', async () => {
    setAccessToken('valid-access');
    savedPlaceRows = [];
    savedStayRows = [];

    renderPage();

    await screen.findByTestId('explore-saved-empty');
    // 숙소가 results 로 empty 를 덮지 않는다 — 둘 다 0 일 때만 empty.
    expect(screen.queryByTestId('saved-stay-section')).toBeNull();
    expect(placeItemTestIds()).toEqual([]);
    expect(screen.queryByTestId('explore-saved-subtitle')).toBeNull();
    expect(screen.queryByTestId('explore-saved-createtrip')).toBeNull();
  });
});

describe('AC-4 · 숙소 해제는 그 숙소만 정확히 1회 지운다 (★3)', () => {
  it('DELETE 를 그 savedStayId 로 한 번 쏘고, 무효화 후 그 행만 빠지며 다른 숙소는 산다', async () => {
    setAccessToken('valid-access');
    savedStayRows = [STAY_B, STAY_C];

    renderPage();
    await screen.findByTestId('saved-stay-item-ss-b');

    fireEvent.press(screen.getByTestId('saved-stay-remove-ss-b'));

    // 숙소 해제는 savedStayId 를 요구한다(계약) — 정확히 한 번, 대상 id 일치.
    await waitFor(() => expect(deletedStayIds()).toEqual(['ss-b']));
    // 무효화 후 재조회로 그 행이 사라진다.
    await waitFor(() =>
      expect(screen.queryByTestId('saved-stay-item-ss-b')).toBeNull()
    );
    // 다른 숙소는 그대로 남는다(아무 행이나 지운 게 아니다).
    expect(screen.getByTestId('saved-stay-item-ss-c')).toBeOnTheScreen();
  });
});

describe('AC-5a · 장소 조회 실패에도 숙소는 산다 (★1)', () => {
  it('장소 섹션은 실패를 알리고 숙소 섹션은 그대로 그린다', async () => {
    setAccessToken('valid-access');
    server.use(
      http.get(
        `${BASE}/saved-places`,
        () => new HttpResponse(null, { status: 500 })
      )
    );
    savedStayRows = [STAY_B];

    renderPage();

    await screen.findByTestId('explore-saved-error');
    await screen.findByTestId('saved-stay-item-ss-b');
    // 한쪽 실패를 통합 empty 로 위장하지 않는다.
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
  });
});

describe('AC-5b · 숙소 조회 실패에도 장소는 산다 (★1 대칭)', () => {
  it('숙소 섹션만 실패를 알리고 장소는 그대로 그린다 — 전역 error 로 접지 않는다', async () => {
    setAccessToken('valid-access');
    savedPlaceRows = [PLACE_A];
    server.use(
      http.get(
        `${BASE}/saved-stays`,
        () => new HttpResponse(null, { status: 500 })
      )
    );

    renderPage();

    await screen.findByTestId('explore-saved-item-sp-a');
    await screen.findByTestId('saved-stay-error');
    // ★ 핵심 — 숙소 실패가 장소 축까지 전역 error 얼굴로 접지 않았다.
    expect(screen.queryByTestId('explore-saved-error')).toBeNull();
  });
});

describe('AC-6 · 숙소 조회 중에는 빈 상태를 안 그린다 (★2)', () => {
  it('장소 0 정착 + 숙소 pending 이면 explore-saved-empty 가 뜨지 않는다', async () => {
    setAccessToken('valid-access');
    const stayGate = createGate();
    // 장소를 첫 프레임부터 정착-empty 로 만든다(로딩 트랜지언트 제거 — 종결 판정 결정론의 핵심).
    const client = createClient();
    client.setQueryData(getGetSavedPlacesQueryKey(), []);
    // 숙소는 문이 열릴 때까지 응답하지 않는다 → 영원히 pending.
    server.use(
      http.get(`${BASE}/saved-stays`, async () => {
        await stayGate.opened;
        return HttpResponse.json([]);
      })
    );

    renderPage(client);

    // 종결 얼굴(빈 상태 또는 로딩)까지 대기한 뒤 — 그 얼굴이 빈 상태가 아님을 확인한다.
    await waitFor(() =>
      expect(
        screen.queryByTestId('explore-saved-empty') ??
          screen.queryByTestId('explore-saved-loading')
      ).not.toBeNull()
    );
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();

    // 정리 — 매달린 요청을 풀어 준다.
    stayGate.release();
  });
});

describe('AC-게스트 · 미로그인은 두 조회를 안 보낸다', () => {
  it('요청 0건에 로그인 안내를 보인다 — 로딩도 빈 상태도 아니다', async () => {
    // 토큰 없음(beforeEach 가 지운다). `/explore/saved-places` 는 Stack.Protected 밖이라 게스트가
    // 딥링크로 들어올 수 있다.
    renderPage();

    await screen.findByTestId('explore-saved-guest');

    // 규칙의 본체 — 두 담은 목록 조회를 아예 안 보낸다(BR-U1-03). 게스트 판정이 상태 판정보다 앞선다.
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(0);
    expect(hitsOf('GET', '/api/v1/saved-stays')).toHaveLength(0);

    // enabled:false 쿼리는 isPending 이 영원히 true — 그 값을 상태 판정에 그대로 태우면 끝나지
    // 않는 스켈레톤이 되고, isLoading 으로 피하면 "담은 게 없다"는 거짓말이 뜬다.
    expect(screen.queryByTestId('explore-saved-loading')).toBeNull();
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
    expect(screen.queryByTestId('saved-stay-section')).toBeNull();
  });
});
