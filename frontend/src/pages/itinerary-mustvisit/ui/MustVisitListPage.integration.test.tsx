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

// 지도를 관찰 마커로 바꾼다 — 이 파일의 관심사는 **좌표가 조회에서 지도까지 흐르는가**이지
// 지도 자체가 아니다. 실물 지도를 태우는 심판은 `MustVisitPickerScreen.map.test.tsx`(AC-6)다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

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
/** 보류시킨 응답을 푸는 스위치(I15). **테스트가 도중에 실패해도** `afterEach` 가 반드시 풀어
 * 준다 — 안 풀면 가짜 서버가 응답을 붙든 채 남아 `A worker process has failed to exit
 * gracefully` 가 뜨고, 그 경고가 다음 사람에게 "내 테스트가 뭔가 잘못됐나" 로 읽힌다. */
let releaseHeldResponse: (() => void) | null = null;

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
  releaseHeldResponse = null;
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
  releaseHeldResponse?.();
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
  // 🔴 TRIP-326 — timeMode 칩이 이 제외 목록에 없으면 카드 3장이 9장으로 잡힌다(02a §5-6 실측).
  // 화면 테스트에 같은 목록의 사본이 있다 — 둘 다 고쳐야 한다.
  'timemode-',
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

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-326 추가분 — 좌표 조인(AC-1·AC-2·AC-19) · 칩 동선(AC-8) · 강등 2단(AC-9·AC-10) ·
 * 비활성 CTA(AC-14).
 *
 * 왜 여기서 재나: 강등 심판의 핵심이 **어떤 요청이 어떤 순서로 몇 건 나갔나** 다. 계약에
 * `PATCH` 가 없어 강등은 DELETE→POST 2단이고 **원자성이 없다** — 훅을 목킹하면 그 위험이
 * 테스트의 *가정*이 되어 가정이 틀려도 아무도 모른다.
 *
 * 새 케이스는 각자 `server.use(...)` 로 POST 핸들러를 건다(`beforeEach` 기본 핸들러 셋은
 * 그대로 둔다). `onUnhandledRequest:'error'` 라 안 걸면 AC 실패가 아니라 준비 단계에서 죽는다.
 * ──────────────────────────────────────────────────────────────────────────── */

const DEMOTE_LOST = '바꾸지 못해 목록에서 빠졌어요. 다시 시도해 주세요';
const DEMOTE_KEPT = '바꾸지 못했어요. 다시 시도해 주세요';
const DEMOTE_DUPLICATE = '이미 아무 때나로 담겨 있어요';
const BLOCKED_REASON = '다음 단계는 아직 준비 중이에요';

/** 좌표가 서로 다른 담은 장소. 기본 핸들러의 `savedPlace()` 는 좌표가 전부 같은 값이라
 * "몇 번 핀이 어느 장소인가" 를 구별할 수 없다. */
function savedPlaceAt(
  poiId: string,
  nameKo: string,
  lat: number,
  lng: number
): SavedPlace {
  const base = savedPlace(poiId, nameKo);
  return { ...base, place: { ...base.place, lat, lng } };
}

/** 등록 목록 조회를 한 번은 성공시키고 나서 카드를 기다린다(모든 케이스의 공통 준비). */
async function openList(): Promise<void> {
  renderPage();
  await screen.findByTestId('itinerary-mustvisit-poi-a');
  await waitFor(() => expect(cardTestIds()).toHaveLength(3));
}

/** FIXED 카드의 `아무 때나` 를 눌러 확인 시트를 띄우고 승인한다(강등 2단의 방아쇠). */
function confirmDemote(sourcePoiId = 'poi-a'): void {
  fireEvent.press(
    screen.getByTestId(`itinerary-mustvisit-timemode-anytime-${sourcePoiId}`)
  );
  fireEvent.press(
    screen.getByTestId('itinerary-mustvisit-screen-demote-confirm')
  );
}

/** `poi-a`·`poi-b` 를 **둘 다** FIXED 로 세운다. 기본 픽스처는 `poi-a` 하나만 FIXED 라
 * "강등 두 건이 서로에게 무슨 짓을 하나" 를 아예 만들 수 없다(I14 · I15 의 공통 준비). */
function makeBothFixed(): void {
  mustVisitStore = [
    mustVisit({
      sourcePoiId: 'poi-a',
      type: 'FIXED',
      fixedDate: '2026-06-11',
      fixedStart: '13:00',
    }),
    mustVisit({
      sourcePoiId: 'poi-b',
      type: 'FIXED',
      fixedDate: '2026-06-12',
      fixedStart: '10:00',
    }),
    mustVisit({ sourcePoiId: 'poi-z' }),
  ];
}

describe('I7 · AC-1 · AC-2 · AC-19 — 좌표가 담은 장소에서 지도까지 흐른다', () => {
  it('핀 번호가 [1,2] 로 뛰고 좌표가 서버 값과 같으며, 좌표 없는 카드가 이유를 말한다', async () => {
    // 준비 — 등록 3건(a·b·z) 중 `poi-z` 만 담은 목록에 없다. 계약상 `Place.lat`·`lng` 는
    // required 라 **담은 목록에 없다 = 좌표가 없다** 이고 다른 원인이 없다(01 §4 실측).
    server.use(
      http.get(`${BASE}/saved-places`, () =>
        HttpResponse.json([
          savedPlaceAt('poi-a', '부산시립미술관', 35.1, 129.1),
          savedPlaceAt('poi-b', '해운대 블루라인파크', 35.2, 129.2),
        ])
      )
    );

    await openList();

    // ① 조인은 `pages` 층에서 일어난다(AC-19 의 동작 짝) — 화면은 완성된 핀만 받는다.
    expect(screen.getByTestId('map-root').props.pins).toEqual([
      { number: 1, lat: 35.1, lng: 129.1 },
      { number: 2, lat: 35.2, lng: 129.2 },
    ]);

    // ② 🔴 목록은 3장인데 핀은 2개다 — 그 차이의 **이유가 화면에 있다**(BR-U1-55).
    expect(cardTestIds()).toHaveLength(3);
    expect(
      within(screen.getByTestId('itinerary-mustvisit-poi-z')).getByText(
        '위치를 확인할 수 없어요'
      )
    ).toBeOnTheScreen();
  });
});

describe('I8 · AC-8 — 시간 정해두기는 h07 로만 가고 요청을 만들지 않는다', () => {
  it('여행 id 와 sourcePoiId 를 들고 이동하며 POST·DELETE 가 0건이다', async () => {
    await openList();

    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-fixed-poi-b')
    );

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/must-visits/[poiId]',
      params: { tripId: TRIP_ID, poiId: 'poi-b' },
    });
    // 🔴 날짜·시각 없는 FIXED 는 INV-U1-17 위반이라 **여기서 바로 바꿀 수 없다.** 이 화면은
    //    아무 요청도 만들지 않고 입력 화면으로 보내기만 한다.
    expect(hitsFor('POST', '/must-visits')).toBe(0);
    expect(hitsFor('DELETE', '/must-visits')).toBe(0);
  });
});

describe('🔴 I9 · AC-9 — 확인해야 나가고, DELETE 가 POST 보다 먼저다', () => {
  it('확인 전에는 요청이 0건이고, 확인 후 순서가 DELETE → POST 이며 본문에 시각이 없다', async () => {
    let postBody: unknown = null;
    server.use(
      http.post(`${BASE}/trips/:tripId/must-visits`, async ({ request }) => {
        postBody = await request.json();
        const created = mustVisit({ sourcePoiId: 'poi-a', type: 'ANYTIME' });
        mustVisitStore = [...mustVisitStore, created];
        return HttpResponse.json(created, { status: 201 });
      })
    );

    await openList();

    // ① 칩만 눌렀을 때 — 확인 시트가 뜨고 **아무 요청도 안 나간다**(01b D1). 이 세 줄이 없으면
    //    확인 시트는 그냥 한 번 더 누르게 하는 장애물일 뿐이다.
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-a')
    );
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-demote')
    ).toBeOnTheScreen();
    expect(hitsFor('DELETE', '/must-visits')).toBe(0);
    expect(hitsFor('POST', '/must-visits')).toBe(0);

    // ② 승인
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-screen-demote-confirm')
    );
    await waitFor(() => expect(hitsFor('POST', '/must-visits')).toBe(1));

    // ③ 🔴 순서 — POST 를 먼저 보내면 실서버에서 중복 금지(INV-U1-18)로 409 가 나 전부 막힌다.
    const deleteAt = observedHits.findIndex((hit) => hit.startsWith('DELETE'));
    const postAt = observedHits.findIndex((hit) => hit.startsWith('POST'));
    expect(deleteAt).toBeGreaterThanOrEqual(0);
    expect(postAt).toBeGreaterThan(deleteAt);
    expect(hitsFor('DELETE', '/must-visits/mv-poi-a')).toBe(1);

    // ④ 🔴 본문에 날짜·시각을 **다시 실어 보내지 않는다** — 강등은 그것을 버리는 방향이고,
    //    남겨 보내면 서버가 ANYTIME 인데 시각이 있는 모순된 등록 건을 갖게 된다.
    expect(postBody).toEqual({ poiId: 'poi-a', type: 'ANYTIME' });

    // ⑤ 결과가 화면에 반영된다 — 자물쇠 칩이 사라지고 필수 칩이 선다.
    await waitFor(() =>
      expect(
        screen.getByTestId('itinerary-mustvisit-chip-must-poi-a')
      ).toBeOnTheScreen()
    );
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-chip-fixed-poi-a')
    ).toEqual([]);
  });

  it('I9-b 응답 전 두 번째 승인이 두 번째 DELETE 를 만들지 않는다', async () => {
    server.use(
      http.post(`${BASE}/trips/:tripId/must-visits`, () =>
        HttpResponse.json(
          mustVisit({ sourcePoiId: 'poi-a', type: 'ANYTIME' }),
          { status: 201 }
        )
      )
    );

    await openList();

    // 상태 갱신은 다음 렌더에야 보이므로 **같은 틱의 두 번째 누름을 못 막는다** — 배선이 ref 로
    // 잠가야 한다. 두 번 나가면 없는 id 로 404 가 나거나 방금 만든 등록을 지운다.
    confirmDemote();
    confirmDemote();

    await waitFor(() => expect(hitsFor('POST', '/must-visits')).toBe(1));
    expect(hitsFor('DELETE', '/must-visits/mv-poi-a')).toBe(1);
  });
});

describe('🔴 I10 · AC-10 lost — DELETE 성공 + POST 실패는 항목이 사라진 상태다', () => {
  it('사실을 말하고 재시도를 주며, 재시도는 POST 만 다시 낸다', async () => {
    server.use(
      http.post(`${BASE}/trips/:tripId/must-visits`, () =>
        HttpResponse.json({}, { status: 500 })
      )
    );

    await openList();
    confirmDemote();

    // ① 침묵하지 않는다(INV-4 · BR-U1-55) — 사용자의 항목이 **실제로 사라진** 자리다.
    expect(await screen.findByText(DEMOTE_LOST)).toBeOnTheScreen();

    // ② 🔴 재시도는 **POST 만** 다시 낸다. DELETE 를 또 내면 없는 id 로 404 가 나거나 방금
    //    성공한 등록을 지운다 — 실패 상태가 "다시 낼 요청" 을 통째로 들고 있어야 한다.
    const deletesBefore = hitsFor('DELETE', '/must-visits/mv-poi-a');
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-screen-demote-retry')
    );
    await waitFor(() => expect(hitsFor('POST', '/must-visits')).toBe(2));
    expect(hitsFor('DELETE', '/must-visits/mv-poi-a')).toBe(deletesBefore);
  });
});

describe('🔴 I11 · AC-10 kept — DELETE 자체가 실패하면 POST 를 보내지 않는다', () => {
  it('POST 가 0건이고 항목이 FIXED 그대로 살아 있으며 사실을 말한다', async () => {
    server.use(
      http.delete(`${BASE}/trips/:tripId/must-visits/:mustVisitId`, () =>
        HttpResponse.json({}, { status: 500 })
      ),
      http.post(`${BASE}/trips/:tripId/must-visits`, () =>
        HttpResponse.json({}, { status: 201 })
      )
    );

    await openList();
    confirmDemote();

    expect(await screen.findByText(DEMOTE_KEPT)).toBeOnTheScreen();

    // 🔴 보내면 409 로 막히고 요청만 는다 — 서버 상태가 안 바뀌었으므로 처음부터 다시 하면 된다.
    expect(hitsFor('POST', '/must-visits')).toBe(0);

    // 짝 — 항목은 **그대로 살아 있다**. 실패했는데 목록에서 사라지면 그게 더 나쁜 거짓말이다.
    expect(
      screen.getByTestId('itinerary-mustvisit-chip-fixed-poi-a')
    ).toBeOnTheScreen();
    expect(cardTestIds()).toHaveLength(3);
  });
});

describe('🔴 I12 · AC-10 duplicate — POST 409 는 실패가 아니되 침묵도 아니다', () => {
  it('안내가 뜨고 실패 문구 둘은 0건이며 목록을 다시 불러온다', async () => {
    server.use(
      http.post(`${BASE}/trips/:tripId/must-visits`, () =>
        HttpResponse.json({ code: 'ALREADY_REGISTERED' }, { status: 409 })
      )
    );

    await openList();
    const listsBefore = hitsFor('GET', `/trips/${TRIP_ID}/must-visits`);
    confirmDemote();

    // 409 = 목표 상태와 결과 상태가 같다. 실패로 세지 않되 아무 말 안 하지도 않는다.
    expect(await screen.findByText(DEMOTE_DUPLICATE)).toBeOnTheScreen();
    expect(screen.queryAllByText(DEMOTE_LOST)).toEqual([]);
    expect(screen.queryAllByText(DEMOTE_KEPT)).toEqual([]);

    // 서버 진실을 다시 그린다 — 무엇이 남아 있는지는 서버가 안다.
    await waitFor(() =>
      expect(hitsFor('GET', `/trips/${TRIP_ID}/must-visits`)).toBeGreaterThan(
        listsBefore
      )
    );
  });
});

describe('🔴 I13 · TRIP-454 AC-2 — CTA·건너뛰기가 활성이고 각각 h09 로 가며 사유가 없다', () => {
  /**
   * TRIP-326(AC-14)에서 이 두 표면은 **상시 차단·무동작**이었다 — h09(생성 중)가 리포에 없어
   * "목적지 없는 버튼을 말없이 죽이지 않으려"(INV-4) 사유 문구를 항상 띄웠다. h09 는 이제
   * 존재하므로 이 사이클이 그 문을 연다: 배선만 바뀌고 화면 계약은 무수정이다(브리프 part 1 ·
   * 맹점 ①). 재작성 정당 = 새 사이클(파일 머리말 · 02a §2).
   */
  it('두 표면이 활성이고 각각 눌러 generating 으로 가며 사유 문구가 없고 요청이 0건이다', async () => {
    await openList();

    const proceed = screen.getByTestId('itinerary-mustvisit-screen-proceed');
    const skip = screen.getByTestId('itinerary-mustvisit-screen-skip');

    // ① 활성 — 회색 잠금이 풀렸다. `toBeDisabled` 단독은 "회색인데 눌리는" 구현도 통과시키므로
    //    아래 press→이동을 짝으로 붙인다(02a ★5).
    expect(proceed).not.toBeDisabled();
    expect(skip).not.toBeDisabled();
    // ② 사유 문구 부재 — 목적지가 생겼으므로 "준비 중" 안내가 사라진다(브리프 INV-4 절).
    //    기존 I13 이 `getByText(BLOCKED_REASON)` 으로 존재를 증명했었다 — 그 null-safe 짝이다.
    expect(screen.queryByText(BLOCKED_REASON)).toBeNull();

    // ③ 다음 CTA → h09(생성 중). 목적지 형태를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다.
    fireEvent.press(proceed);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const proceedDest = mockPush.mock.calls[0][0];
    const proceedFlat =
      typeof proceedDest === 'string'
        ? proceedDest
        : JSON.stringify(proceedDest);
    expect(proceedFlat).toContain('generating');
    expect(proceedFlat).toContain(TRIP_ID);

    // ④ 건너뛰기도 같은 목적지(h09). 앞 호출과 섞이지 않게 비우고 다시 잰다.
    mockPush.mockClear();
    fireEvent.press(skip);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const skipDest = mockPush.mock.calls[0][0];
    const skipFlat =
      typeof skipDest === 'string' ? skipDest : JSON.stringify(skipDest);
    expect(skipFlat).toContain('generating');
    expect(skipFlat).toContain(TRIP_ID);

    // ⑤ 전진은 요청을 만들지 않는다 — 생성 POST 는 h09 가 마운트 시 소유한다(무회귀).
    expect(hitsFor('POST', '/must-visits')).toBe(0);
    expect(hitsFor('DELETE', '/must-visits')).toBe(0);
  });
});

/* ── 게이트①-2 추가분 (03b 경고② · 경고③) ────────────────────────────────────────
 *
 * 앞의 I9~I12 는 강등을 **한 번만** 한다. 그래서 "강등 두 건이 시간축에서 서로에게 무슨 짓을
 * 하는가" 를 재는 심판이 하나도 없었다 — 적대적 리뷰가 그 자리에서 결함 두 개를 재현했다.
 * 아래 둘은 **지금 red 다**(구현이 아직 안 고쳐졌다). 5-c 에서 초록이 된다.
 * ──────────────────────────────────────────────────────────────────────────── */

describe('🔴 I14 · AC-10 — `lost` 안내와 되돌릴 수단이 다음 강등 성공에 살아남는다', () => {
  /**
   * `lost` = DELETE 성공 + POST 실패 = **항목이 서버에서 실제로 사라진** 상태다. 그 실패 상태가
   * "다시 낼 요청" 의 **유일한 사본**을 들고 있다(배선 주석이 스스로 그렇게 적었다).
   *
   * 🔴 그런데 다른 항목의 강등이 성공하면 그 사본·재시도 버튼·안내 문구가 **한꺼번에** 버려진다.
   * `poi-a` 는 서버에서 이미 지워졌으므로 목록에도 없다 — 사용자가 h07 에서 직접 입력한
   * 날짜·시각과 함께 흔적 없이 증발하고, 되돌리려면 탐색 화면에서 다시 담고 h07 을 다시 거쳐야
   * 한다(03b §2 재현).
   *
   * 3동작 뼈대: 준비=둘 다 FIXED + POST 를 `poi-a` 만 실패시킴 → 실행=a 강등(실패) 후 b 강등(성공)
   * → 단언=a 의 안내·재시도·요청 사본이 아직 살아 있나.
   */
  it('다른 항목이 성공해도 안내·재시도가 남고, 재시도가 잃은 항목의 요청을 다시 낸다', async () => {
    // 준비 — 한 번의 실행 안에 실패와 성공을 함께 넣는 유일한 방법은 **본문으로 가르는 것**이다.
    const postBodies: { poiId: string }[] = [];
    makeBothFixed();
    server.use(
      http.post(`${BASE}/trips/:tripId/must-visits`, async ({ request }) => {
        const body = (await request.json()) as { poiId: string };
        postBodies.push(body);
        if (body.poiId === 'poi-a')
          return HttpResponse.json({}, { status: 500 });
        const created = mustVisit({
          sourcePoiId: body.poiId,
          type: 'ANYTIME',
        });
        mustVisitStore = [...mustVisitStore, created];
        return HttpResponse.json(created, { status: 201 });
      })
    );

    await openList();

    // 실행 ① — `poi-a` 강등이 `lost` 로 떨어진다.
    confirmDemote('poi-a');
    expect(await screen.findByText(DEMOTE_LOST)).toBeOnTheScreen();

    // 실행 ② — 사용자가 재시도 대신 **다른 항목**을 강등한다(정상 성공).
    confirmDemote('poi-b');
    await waitFor(() => expect(postBodies).toHaveLength(2));

    // ① 긍정 앵커 — `poi-b` 의 강등이 **실제로 성공했다**. 이 줄이 없으면 "둘째 강등이 아무것도
    //    안 한 덕에 첫 실패가 남아 있는" 구현이 통과한다.
    expect(postBodies[1]).toEqual({ poiId: 'poi-b', type: 'ANYTIME' });

    // ② 🔴 잃은 항목의 안내가 **아직 화면에 있다**. 사라지면 사용자는 무엇을 잃었는지도 모른다.
    expect(screen.getByText(DEMOTE_LOST)).toBeOnTheScreen();

    // ③ 🔴 되돌릴 수단도 아직 있다.
    const retry = screen.getByTestId('itinerary-mustvisit-screen-demote-retry');

    // ④ 🔴 급소 — 눌렀을 때 **잃은 항목(`poi-a`)의 요청**이 다시 나간다. 문구만 남기고 요청
    //    사본은 버린 구현이 여기서 죽는다.
    fireEvent.press(retry);
    await waitFor(() => expect(postBodies).toHaveLength(3));
    expect(postBodies[2]).toEqual({ poiId: 'poi-a', type: 'ANYTIME' });
  });
});

describe('🔴 I15 · AC-9 · BR-U1-55 — 요청이 나가는 중에 누른 다른 강등이 삼켜지지 않는다', () => {
  /**
   * 이중 제출 잠금(`submitLockedRef`)은 **항목별이 아니라 화면 전체 하나**다. 잠긴 동안 들어온
   * 강등은 값 없이 버려지는데, 확인 시트는 이미 닫혀 버려 **사용자에게 남는 신호가 0** 이다.
   * 🔴 "정해둔 날짜와 시각이 지워져요" 라는 경고까지 읽고 `바꾸기` 를 눌렀는데 아무 일도 아무
   * 말도 없다 — BR-U1-55(침묵 실패 금지) 위반이다(03b §3 재현).
   *
   * **계약: 잠금 중에는 확인 시트를 닫지 않는다.** 새 사용자 문구를 만들지 않는 방향이다 —
   * 이번 사이클의 문구 12개는 게이트①에서 동결됐고, 동결 밖 문구를 구현자가 발명하게 하는 것은
   * 다른 규칙을 깨는 일이다. 잠금을 **항목별로 쪼개는** 갈래는 기각했다: 실패 상태 슬롯이 하나뿐
   * 이라 동시 실패 두 건을 못 담아 같은 종류의 결함을 하나 더 만든다(02a2 §3-3).
   *
   * *(개념)* **인플라이트(in-flight)** — 요청을 보냈고 응답이 아직 안 온 구간. 아래 준비는
   * 가짜 서버가 **우리가 풀어 줄 때까지 응답하지 않게** 붙잡아 그 구간을 인위적으로 넓힌다.
   *
   * 3동작 뼈대: 준비=a 의 DELETE 를 보류 → 실행=인플라이트 중 b 를 강등 → 단언=조작이 남아 있나.
   */
  it('시트가 닫히지 않고, 잠금이 풀린 뒤 다시 누르면 그 항목의 요청이 실제로 나간다', async () => {
    // 준비 — `mv-poi-a` 의 DELETE 만 붙잡아 둔다. `resolve` 를 밖으로 꺼내 두면 원하는 시점에
    // 응답을 풀 수 있다(못 풀고 끝나도 `afterEach` 가 푼다).
    makeBothFixed();
    server.use(
      http.delete(
        `${BASE}/trips/:tripId/must-visits/:mustVisitId`,
        async ({ params }) => {
          const id = String(params.mustVisitId);
          if (id === 'mv-poi-a') {
            await new Promise<void>((resolve) => {
              releaseHeldResponse = resolve;
            });
          }
          mustVisitStore = mustVisitStore.filter(
            (entry) => entry.mustVisitId !== id
          );
          return new HttpResponse(null, { status: 204 });
        }
      ),
      http.post(`${BASE}/trips/:tripId/must-visits`, async ({ request }) => {
        const body = (await request.json()) as { poiId: string };
        const created = mustVisit({
          sourcePoiId: body.poiId,
          type: 'ANYTIME',
        });
        mustVisitStore = [...mustVisitStore, created];
        return HttpResponse.json(created, { status: 201 });
      })
    );

    await openList();

    // 실행 ① — `poi-a` 강등. DELETE 가 나갔고 **아직 안 끝났다**.
    confirmDemote('poi-a');
    await waitFor(() =>
      expect(hitsFor('DELETE', '/must-visits/mv-poi-a')).toBe(1)
    );

    // 실행 ② — 응답 전에 **다른 항목**을 강등한다. 여기까지는 사용자에게 아무 이상이 없다.
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-b')
    );
    // ① 긍정 앵커 — 확인 시트가 정상적으로 뜬다(경고 문구까지 읽고 누르는 동선이다).
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-demote')
    ).toBeOnTheScreen();
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-screen-demote-confirm')
    );

    // ② 🔴 시트가 **그대로 열려 있다** — 조작이 삼켜지지 않았다는 신호. 현행은 여기서 닫힌다.
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-demote')
    ).toBeOnTheScreen();

    // ③ 잠금 중에 두 번째 요청을 만들지는 **않는다** — 이중 제출 방지는 그대로 유지한다.
    expect(hitsFor('DELETE', '/must-visits/mv-poi-b')).toBe(0);

    // 실행 ③ — 보류를 푼다. 응답이 도착하면 리액트 상태가 바뀌므로 `act` 로 감싼다(안 감싸면
    // "not wrapped in act(...)" 경고가 뜬다).
    await act(async () => {
      releaseHeldResponse?.();
    });
    await waitFor(() => expect(hitsFor('POST', '/must-visits')).toBe(1));

    // ④ 🔴 이제 다시 누르면 `poi-b` 의 요청이 **실제로 나간다**. 시트를 껍데기로만 남겨 두는
    //    "고친 척" 이 여기서 죽는다.
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-screen-demote-confirm')
    );
    await waitFor(() =>
      expect(hitsFor('DELETE', '/must-visits/mv-poi-b')).toBe(1)
    );
  });
});
