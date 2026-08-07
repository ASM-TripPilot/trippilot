import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  MustVisit,
  Place,
  SavedPlace,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { MustVisitListPage } from './MustVisitListPage';

/**
 * h05 배선을 **실 HTTP 로** 태우는 심판(AC-1 · AC-2 · AC-3 · AC-8 · AC-10 · AC-M1 · D3).
 *
 * 무엇을 보장하나:
 *  - 두 조회(`GET /trips/{id}/must-visits` · `GET /saved-places`)가 실제로 나가고, 그 둘이
 *    조인돼 이름까지 이어진다.
 *  - 조인 실패 항목이 **실 HTTP 위에서도** 목록에 남는다(사용자 동결 · INV-4).
 *  - 해제는 `must_visit` 만 지운다 — 담기(`saved-places`)는 건드리지 않는다(INV-U1-04 ·
 *    BR-U1-04 양방향 독립). 사용자가 탐색 화면의 ♥ 까지 잃으면 되돌릴 방법이 없다.
 *  - 🔴 **이미 도착한 목록이 재조회 실패에 지워지지 않는다**(문제로그 2026-08-04 · 이 계열 화면
 *    에서 두 번 재발했고, 이 칸이 세 번째다).
 *  - 게스트가 **끝나지 않는 스켈레톤**을 보지 않는다(`useSavedPlaces` 는 `enabled: isAuthed` 라
 *    미로그인이면 `isPending` 이 영원히 true 다).
 *
 * 왜 통합 버킷인가: 심판의 핵심이 **어떤 요청이 몇 건 나갔나** 다. 훅을 목킹하면 "해제가
 * saved-places 를 안 건드린다" 가 테스트의 *가정*이 되어 그 가정이 틀려도 아무도 모른다
 * (문제로그 `2026-08-02 목이 성공만 흉내내 도달 불가 분기가 초록으로 남았다`).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=화면을 열고 누른다 → 단언=나간 요청 · 보이는 것.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다 — 실물
// 로드를 피하려면 목킹해야 한다(선례와 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려지므로 바깥 변수를 못 본다 — 이름이 `mock` 으로
// 시작하는 변수만 예외다(리포 확립 규칙).
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

/** `authWiring.integration.test.ts:59` 와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';

function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '부산진구',
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

function mustVisit(
  over: Partial<MustVisit> & { sourcePoiId: string }
): MustVisit {
  return {
    mustVisitId: `mv-${over.sourcePoiId}`,
    poiSnapshotId: `snap-${over.sourcePoiId}`,
    type: 'ANYTIME',
    ...over,
  };
}

/** 나간 요청의 `METHOD /경로` 누적 — **도착 순서 그대로** 쌓인다(02a §5-1 실행 확인). */
let observedHits: string[] = [];
/** 가짜 서버가 들고 있는 등록 목록. DELETE 가 여기서 지우므로, 배선이 낙관 갱신을 하든
 * 재조회를 하든 **같은 결과**로 수렴한다(구현 전략을 테스트가 못 박지 않는다). */
let mustVisitStore: MustVisit[] = [];
/** must-visits 조회를 이 상태 코드로 실패시킨다(없으면 200). */
let listStatus: number | null = null;

function hitsFor(method: string, includes: string): number {
  return observedHits.filter(
    (hit) => hit.startsWith(method) && hit.includes(includes)
  ).length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  listStatus = null;
  mockPush.mockClear();
  mockBack.mockClear();
  mustVisitStore = [
    mustVisit({
      sourcePoiId: 'poi-a',
      type: 'FIXED',
      fixedDate: '2026-06-11',
      fixedStart: '13:00',
    }),
    mustVisit({ sourcePoiId: 'poi-b' }),
    // 담기를 푼 항목 — `saved-places` 에 없어 이름을 못 얻는다(BR-U1-04 · INV-U1-04).
    mustVisit({ sourcePoiId: 'poi-z' }),
  ];
  setAccessToken('valid-access');

  // 통합 버킷은 `onUnhandledRequest: 'error'` 라 핸들러가 없으면 AC 실패가 아니라 **준비
  // 단계에서 죽는다**. 이 칸이 쓰는 세 경로를 매번 명시적으로 건다.
  server.use(
    http.get(`${BASE}/trips/:tripId/must-visits`, () => {
      if (listStatus !== null)
        return HttpResponse.json({}, { status: listStatus });
      return HttpResponse.json(mustVisitStore);
    }),
    http.delete(
      `${BASE}/trips/:tripId/must-visits/:mustVisitId`,
      ({ params }) => {
        mustVisitStore = mustVisitStore.filter(
          (entry) => entry.mustVisitId !== String(params.mustVisitId)
        );
        return new HttpResponse(null, { status: 204 });
      }
    ),
    http.get(`${BASE}/saved-places`, () =>
      HttpResponse.json([
        savedPlace('poi-a', '부산시립미술관'),
        savedPlace('poi-b', '해운대 블루라인파크'),
      ])
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/**
 * `gcTime: 0` — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를 붙잡는다.
 * `retry: false` — 실패를 즉시 실패로 본다(재시도가 돌면 요청 개수 단언이 흔들린다).
 * 클라이언트를 **돌려주는** 이유: 재조회를 테스트가 직접 일으키기 위해서다(I4).
 */
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
  const utils = render(<MustVisitListPage tripId={TRIP_ID} />, {
    wrapper: Wrapper,
  });
  return { ...utils, client };
}

/** 카드 루트만 세는 셀렉터 — 화면 테스트와 같은 규칙(하위 접두 제외, `queryAll` 기반). */
const CARD_SUB_PREFIXES = [
  'image-',
  'name-',
  'remove-',
  'edit-',
  'chip-',
  'screen-',
];

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-mustvisit-/)
    .map((node) => String(node.props.testID))
    .filter((testID) => {
      const tail = testID.slice('itinerary-mustvisit-'.length);
      return !CARD_SUB_PREFIXES.some((prefix) => tail.startsWith(prefix));
    });
}

describe('I1 · AC-1 · AC-2 — 두 조회가 실제로 나가고 이름까지 이어진다', () => {
  it('카드 3장이 뜨고 조인된 장소명이 그려진다', async () => {
    renderPage();

    expect(
      await screen.findByTestId('itinerary-mustvisit-poi-a')
    ).toBeOnTheScreen();
    await waitFor(() => expect(cardTestIds()).toHaveLength(3));

    expect(
      screen.getByTestId('itinerary-mustvisit-name-poi-a')
    ).toHaveTextContent('부산시립미술관');
    expect(hitsFor('GET', `/trips/${TRIP_ID}/must-visits`)).toBe(1);
    expect(hitsFor('GET', '/saved-places')).toBe(1);
  });
});

describe('I2 · AC-3 — 조인 실패 항목이 실 HTTP 위에서도 목록에 남는다', () => {
  it('담기를 푼 항목이 빠지지 않고 3장 그대로다', async () => {
    renderPage();
    await screen.findByTestId('itinerary-mustvisit-poi-a');

    // 서버는 3건을 주는데 담은 목록에는 2건뿐이다 — 제외하면 2장이 된다. 그것이 기각된 선택지다.
    await waitFor(() => expect(cardTestIds()).toHaveLength(3));
    expect(screen.getByTestId('itinerary-mustvisit-poi-z')).toBeOnTheScreen();
    // 이름 자리가 빈칸이 아니다(플레이스홀더 문구 자체는 순수 함수 테스트가 잠근다).
    expect(
      screen.getByTestId('itinerary-mustvisit-name-poi-z')
    ).not.toHaveTextContent('');
  });
});

describe('🔴 I3 · AC-8 — 해제는 담기를 건드리지 않는다 (INV-U1-04 · BR-U1-04)', () => {
  it('must-visits 만 1건 DELETE 되고 saved-places DELETE 는 0건이며 카드가 줄어든다', async () => {
    renderPage();
    await screen.findByTestId('itinerary-mustvisit-poi-b');

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-remove-poi-b'));

    await waitFor(() =>
      expect(observedHits).toContain(
        `DELETE /api/v1/trips/${TRIP_ID}/must-visits/mv-poi-b`
      )
    );
    expect(hitsFor('DELETE', '/must-visits/')).toBe(1);

    // ★ 부정 짝 — 담기 해제가 함께 나가면 사용자는 탐색 화면의 ♥ 까지 잃는다. 시드는 복사본이라
    //   원본 담기와 **양방향으로 독립**이다.
    expect(hitsFor('DELETE', '/saved-places')).toBe(0);

    await waitFor(() => expect(cardTestIds()).toHaveLength(2));
    expect(screen.queryAllByTestId('itinerary-mustvisit-poi-b')).toEqual([]);
  });
});

describe('🔴 I4 · AC-M1 — 도착한 목록이 재조회 실패에 지워지지 않는다', () => {
  /**
   * ⚠️ 문제로그 `2026-08-04 화면 얼굴 전환이 잔존 목록을 지운다`. TRIP-222·223 에서 서로 반대
   * 방향으로 두 번 재발했다. 순수 함수(`mustVisitList.test.ts` C5)·화면(`MustVisitPickerScreen`
   * C23)·배선(여기) **세 층에 독립으로** 박는다 — 어느 한 층만 고쳐도 나머지가 red 로 남는다.
   *
   * 재조회를 **테스트가 직접 일으킨다**(캐시 무효화). 해제 뮤테이션 뒤에 일으키면 "배선이
   * 무효화를 하는가" 라는 다른 축이 섞여 들어와, 낙관 갱신으로 짠 정당한 구현이 red 를 낸다.
   */
  it('카드가 그대로 남고 실패 알림이 곁에 붙으며 전면 실패 얼굴로 갈아 끼우지 않는다', async () => {
    const { client } = renderPage();
    await screen.findByTestId('itinerary-mustvisit-poi-a');
    await waitFor(() => expect(cardTestIds()).toHaveLength(3));

    // 준비 — 서버가 죽는다. 다음 재조회부터 500 이다.
    listStatus = 500;

    // 실행 — 재조회.
    await act(async () => {
      await client.invalidateQueries();
    });

    // 단언 ① — 재조회가 실제로 나갔고 실패했다(긍정 앵커). 없으면 아무 일도 안 일어난 화면이
    //          아래 단언을 공짜로 통과한다.
    await waitFor(() =>
      expect(
        hitsFor('GET', `/trips/${TRIP_ID}/must-visits`)
      ).toBeGreaterThanOrEqual(2)
    );

    // 단언 ② — 목록이 지워지지 않았다.
    await waitFor(() =>
      expect(
        screen.getByTestId('itinerary-mustvisit-screen-stale-failed')
      ).toBeOnTheScreen()
    );
    expect(cardTestIds()).toHaveLength(3);
    expect(
      screen.getByTestId('itinerary-mustvisit-name-poi-a')
    ).toHaveTextContent('부산시립미술관');

    // 단언 ③ — 실패가 삼켜지지도, 목록을 덮지도 않았다.
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-failed')
    ).toEqual([]);
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-loading')
    ).toEqual([]);
  });
});

describe('🔴 I5 · AC-10 — 게스트가 끝나지 않는 로딩을 보지 않는다', () => {
  it('담은 목록 조회가 0건이고, 스켈레톤 대신 결정된 얼굴이 나온다', async () => {
    // 준비 — 토큰이 없다. `useSavedPlaces` 는 `enabled: isAuthed` 라 요청 자체가 안 나가고,
    // 그 쿼리의 `isPending` 은 **영원히 true** 다(fetchStatus 는 idle). 그 값을 그대로 얼굴
    // 판정에 태우면 사용자는 끝나지 않는 스켈레톤을 본다.
    clearAccessToken();
    renderPage();

    // 목록 자체는 온다 — 조인만 못 할 뿐이다.
    expect(
      await screen.findByTestId('itinerary-mustvisit-poi-a')
    ).toBeOnTheScreen();
    await waitFor(() => expect(cardTestIds()).toHaveLength(3));

    // ① 담은 목록 요청은 한 건도 안 나갔다.
    expect(hitsFor('GET', '/saved-places')).toBe(0);
    // ② 로딩 얼굴에 갇히지 않았다 — 이 한 줄이 이 케이스의 전부다.
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-loading')
    ).toEqual([]);
    // ③ 이름을 못 얻은 것은 숨기지 않고 드러낸다(게스트도 침묵 실패를 겪지 않는다).
    expect(
      screen.getByTestId('itinerary-mustvisit-name-poi-a')
    ).not.toHaveTextContent('');
  });
});

describe('I6 · D3 — 카드를 누르면 시각 지정 화면으로 간다', () => {
  it('여행 id 와 sourcePoiId 를 들고 h07 로 이동한다', async () => {
    renderPage();
    await screen.findByTestId('itinerary-mustvisit-poi-b');

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-poi-b'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    // ⚠️ 경로의 **형태**를 못 박지 않는다 — `typedRoutes: true` 아래 문자열 템플릿이 통과하는지
    //   `{pathname, params}` 객체여야 하는지는 구현자가 정할 자리다(틀리게 박으면 tsc 가 막는다).
    //   대신 어느 형태든 반드시 들어 있어야 하는 세 조각을 본다.
    const target = mockPush.mock.calls[0][0];
    const flat = typeof target === 'string' ? target : JSON.stringify(target);
    expect(flat).toContain(TRIP_ID);
    expect(flat).toContain('poi-b');
    expect(flat).toContain('must-visits');
  });
});
