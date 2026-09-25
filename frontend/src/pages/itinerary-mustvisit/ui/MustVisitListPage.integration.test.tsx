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
  GenerateItineraryRequestGenerationMode,
  MustVisit,
  Place,
  SavedPlace,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { MustVisitListPage } from './MustVisitListPage';

/**
 * h02(구 h05) 배선을 **실 HTTP 로** 태우는 심판(AC-1 · AC-2 · AC-3 · AC-8 · AC-M1 · D3).
 *
 * 무엇을 보장하나:
 *  - 두 조회(`GET /trips/{id}/must-visits` · `GET /saved-places`)가 실제로 나가고, 그 둘이
 *    조인돼 이름까지 이어진다.
 *  - 조인 실패 항목이 **실 HTTP 위에서도** 목록에 남는다(사용자 동결 · INV-4).
 *  - 해제는 `must_visit` 만 지운다 — 담기(`saved-places`)는 건드리지 않는다(INV-U1-04 ·
 *    BR-U1-04 양방향 독립). 사용자가 탐색 화면의 ♥ 까지 잃으면 되돌릴 방법이 없다.
 *  - 🔴 **이미 도착한 목록이 재조회 실패에 지워지지 않는다**(문제로그 2026-08-04). 단 TRIP-785 로
 *    h02 는 stale 알림(AlertRow)을 **더는 안 그린다**(Q3 · model 은 유지, h03 이 흡수) — I4 가
 *    "목록은 살고 AlertRow 는 없다" 로 뒤집혔다.
 *  - 게스트가 **끝나지 않는 스켈레톤**을 보지 않는다(`useSavedPlaces` 는 `enabled: isAuthed` 라
 *    미로그인이면 `isPending` 이 영원히 true 다).
 *  - 🔴 TRIP-785 재정합: 강등 확인 시트·배선이 사라졌고(부재 단언 하나로 접음), 건너뛰기는
 *    listed 에서 사라져 **failed 얼굴 전용**이 됐다(I13·I16 재작성).
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
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

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
function renderPage(props?: { mode?: GenerateItineraryRequestGenerationMode }) {
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
  const utils = render(
    <MustVisitListPage tripId={TRIP_ID} mode={props?.mode} />,
    { wrapper: Wrapper }
  );
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

/** 노드의 부재를 **숫자로** 잰다. `expect(queryAll…).toEqual([])` 는 단언이 실패할 때 jest 가
 * ReactTestInstance 를 직렬화하며 순환 참조로 스택을 터뜨린다(RNTL 13.3.3 실측) — 부재 단언은
 * red 가 될 수 있으므로(뮤테이션 실측) `.length` 를 먼저 뽑아 숫자만 비교한다. */
function countTestId(testID: string): number {
  return screen.queryAllByTestId(testID).length;
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

describe('🔴 I4 · AC-M1 · AC-5 · Q3 — 도착한 목록은 재조회 실패에 안 지워지고, h02 는 stale 알림을 안 그린다', () => {
  /**
   * ⚠️ 문제로그 `2026-08-04 화면 얼굴 전환이 잔존 목록을 지운다`(TRIP-222·223 두 번 재발).
   *
   * TRIP-785 로 **계약이 반쪽 갈렸다**(Q3): 재조회 실패는 여전히 `staleFailed` 로 model 에
   * 실려 나가고(순수 함수 `mustVisitList.test.ts` C5 가 잠금) — 페이지가 그대로 view 에 싣는다
   * — 그런데 h02 화면은 그 안내(`-stale-failed` AlertRow)를 **더는 안 그린다**(h03/TRIP-786 이
   * 흡수). 그래서 이 배선 층 심판은 옛 "AlertRow 가 붙는다" 를 **"안 붙는다" 로 뒤집는다**:
   * 목록은 살아 있고(AC-M1 데이터 안전 유지) 전면 실패·로딩 얼굴로 갈아 끼우지도 않되,
   * stale 알림은 화면에 없다(AC-5 · "삭제도 계약").
   *
   * 재조회를 **테스트가 직접 일으킨다**(캐시 무효화). 해제 뮤테이션 뒤에 일으키면 "배선이
   * 무효화를 하는가" 라는 다른 축이 섞여 들어와, 낙관 갱신으로 짠 정당한 구현이 red 를 낸다.
   */
  it('카드가 그대로 남되 stale 알림은 안 뜨고, 전면 실패·로딩 얼굴로 갈아 끼우지 않는다', async () => {
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
    //          아래 부재 단언을 공짜로 통과한다. 이 실패가 model 에 `staleFailed=true` 를 싣는다.
    await waitFor(() =>
      expect(
        hitsFor('GET', `/trips/${TRIP_ID}/must-visits`)
      ).toBeGreaterThanOrEqual(2)
    );

    // 단언 ② — 목록이 지워지지 않았다(AC-M1 데이터 안전은 그대로 산다 · listed 얼굴 유지).
    await waitFor(() =>
      expect(
        screen.getByTestId('itinerary-mustvisit-name-poi-a')
      ).toHaveTextContent('부산시립미술관')
    );
    expect(cardTestIds()).toHaveLength(3);

    // 단언 ③ 🔴 — h02 는 stale 알림을 안 그린다(Q3 · AC-5). model 은 여전히 staleFailed 를
    //   싣지만 화면이 AlertRow 를 지웠다 — 이 부재가 이 티켓이 뒤집은 계약이다("삭제도 계약").
    expect(countTestId('itinerary-mustvisit-screen-stale-failed')).toBe(0);
    expect(countTestId('itinerary-mustvisit-screen-stale-retry')).toBe(0);

    // 단언 ④ — 전면 실패·로딩 얼굴로 갈아 끼우지도 않았다(목록이 살아 있으므로 listed 유지).
    expect(countTestId('itinerary-mustvisit-screen-failed')).toBe(0);
    expect(countTestId('itinerary-mustvisit-screen-loading')).toBe(0);
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
 * TRIP-326 추가분 → TRIP-785 재정합 — 좌표 조인(AC-1·AC-2·AC-19) · 칩 동선(AC-8) ·
 * 전진 CTA·건너뛰기(TRIP-454·TRIP-785).
 *
 * ⚠️ **강등(FIXED→ANYTIME) 2단은 이 화면에서 사라졌다**(TRIP-785 Q2). 계약에 `PATCH` 가 없어
 * DELETE→POST 2단이던 강등 확인 시트·`onDemote`/`onRetryDemote`/`demoteErrorText` 배선을 h02 가
 * 전부 뗐다(h03/TRIP-786 이 흡수). 옛 I9~I12·I14·I15 가 그 2단의 순서·실패 3종(lost·kept·409)·
 * 인플라이트 잠금을 심판했으나, 심판 대상이 통째로 없어져 **부재 단언 하나로 접었다**(아래
 * '강등 배선 제거'). 되살아나면 그 하나가 red — "삭제도 계약".
 *
 * 살아남은 케이스는 각자 `server.use(...)` 로 핸들러를 건다(`beforeEach` 기본 핸들러 셋은
 * 그대로 둔다). `onUnhandledRequest:'error'` 라 안 걸면 AC 실패가 아니라 준비 단계에서 죽는다.
 * ──────────────────────────────────────────────────────────────────────────── */

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

/** 등록 목록 조회를 한 번은 성공시키고 나서 카드를 기다린다(모든 케이스의 공통 준비).
 * `mode` 를 넘기면 copick 갈래(CO_PLAN)로 연다 — 안 넘기면 완전AI(기존 동작 불변). */
async function openList(
  mode?: GenerateItineraryRequestGenerationMode
): Promise<void> {
  renderPage({ mode });
  await screen.findByTestId('itinerary-mustvisit-poi-a');
  await waitFor(() => expect(cardTestIds()).toHaveLength(3));
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

describe('🔴 강등 배선 제거 (TRIP-785 · Q2 · 삭제도 계약)', () => {
  /**
   * 옛 I9~I12·I14·I15 는 FIXED→ANYTIME 강등의 DELETE→POST 2단(순서·본문·실패 3종·인플라이트
   * 잠금)을 심판했다. TRIP-785 가 그 시트·배선(`onDemote`/`onRetryDemote`/`demoteErrorText`)을
   * 통째로 뗐다(Q2 · h03/TRIP-786 흡수) — 심판 대상이 없어져 **하나의 부재 단언으로 접는다**.
   * 되살아나면(시트가 다시 뜨거나 강등 요청이 다시 나가면) 이 하나가 red 다.
   *
   * 왜 통합 버킷에 남기나: "강등 요청이 **한 건도 안 나간다**" 는 실 HTTP 위에서만 정직하게
   * 재진다 — 훅을 목킹하면 "안 나간다" 가 테스트의 가정이 되어 되살아나도 모른다.
   */
  it('FIXED 의 `아무 때나` 를 눌러도 확인 시트가 없고 POST·DELETE 가 0건이며 칩은 FIXED 그대로다', async () => {
    await openList();

    // ① FIXED 카드의 `아무 때나` 칩은 이제 표시 전용이다(Q1) — 눌러도 아무 일이 없다.
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-a')
    );

    // ② 🔴 강등 확인 시트가 뜨지 않는다(어떤 testID 도 없다).
    expect(countTestId('itinerary-mustvisit-screen-demote')).toBe(0);
    expect(countTestId('itinerary-mustvisit-screen-demote-confirm')).toBe(0);
    expect(countTestId('itinerary-mustvisit-screen-demote-cancel')).toBe(0);

    // ③ 🔴 강등 요청(DELETE→POST 2단)이 한 건도 안 나간다 — 배선이 사라졌다.
    expect(hitsFor('POST', '/must-visits')).toBe(0);
    expect(hitsFor('DELETE', '/must-visits')).toBe(0);

    // ④ 짝 — 항목은 FIXED 그대로다(강등이 조용히 일어나 필수 칩으로 바뀌지 않았다).
    expect(
      screen.getByTestId('itinerary-mustvisit-chip-fixed-poi-a')
    ).toBeOnTheScreen();
    expect(cardTestIds()).toHaveLength(3);
  });
});

describe('🔴 I13 · TRIP-454·TRIP-785 — listed 는 CTA 활성·건너뛰기 부재, failed 에서만 건너뛰기가 h09 로', () => {
  /**
   * TRIP-454 가 h09(생성 중)를 열어 두 표면의 상시 차단을 풀었고, TRIP-785 가 **건너뛰기를
   * listed 에서 뗐다**(에러에서 빠져나갈 문이라 `failed` 전용으로 이사 — 화면 계약). 그래서
   * listed 에는 CTA 만 남고(활성→h09), 건너뛰기는 failed 얼굴에서만 뜬다.
   */
  it('listed — CTA 가 활성이고 눌러 h09 로 가며, 건너뛰기·사유 문구가 둘 다 없고 요청이 0건이다', async () => {
    await openList();

    const proceed = screen.getByTestId('itinerary-mustvisit-screen-proceed');

    // ① 활성 — 회색 잠금이 풀렸다. `toBeDisabled` 단독은 "회색인데 눌리는" 구현도 통과시키므로
    //    아래 press→이동을 짝으로 붙인다.
    expect(proceed).not.toBeDisabled();
    // ② 🔴 건너뛰기는 listed 에 없다(TRIP-785 — failed 전용으로 이사). 사유 문구도 없다.
    expect(countTestId('itinerary-mustvisit-screen-skip')).toBe(0);
    expect(screen.queryByText(BLOCKED_REASON)).toBeNull();

    // ③ 다음 CTA → h09(생성 중). 목적지 형태를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다.
    fireEvent.press(proceed);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const dest = mockPush.mock.calls[0][0];
    const flat = typeof dest === 'string' ? dest : JSON.stringify(dest);
    expect(flat).toContain('generating');
    expect(flat).toContain(TRIP_ID);
    // ★ 완전AI 갈래(mode 미전달)는 copick 신호를 얻지 않는다(TRIP-504 AC-5 회귀).
    expect(flat).not.toContain('CO_PLAN');
    expect(flat).not.toContain('copick');

    // ④ 전진은 요청을 만들지 않는다 — 생성 POST 는 h09 가 마운트 시 소유한다(무회귀).
    expect(hitsFor('POST', '/must-visits')).toBe(0);
    expect(hitsFor('DELETE', '/must-visits')).toBe(0);
  });

  it('I13-b failed — 건너뛰기가 앱바에 뜨고 눌러 h09 로 나간다 (에러 탈출문)', async () => {
    // 준비 — 첫 조회부터 실패시켜 error 얼굴을 띄운다. 건너뛰기는 이 얼굴에서만 렌더된다.
    listStatus = 500;
    renderPage();
    await screen.findByTestId('itinerary-mustvisit-screen-failed');

    // ① 🔴 건너뛰기가 error 얼굴에서 뜬다(위 listed 부재의 짝 — 이사가 실제로 일어났다).
    const skip = screen.getByTestId('itinerary-mustvisit-screen-skip');
    expect(skip).toBeOnTheScreen();

    // ② 눌러 h09 로 나간다 — 에러에서 빠져나갈 유일한 문이 살아 있다(INV-4).
    fireEvent.press(skip);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const dest = mockPush.mock.calls[0][0];
    const flat = typeof dest === 'string' ? dest : JSON.stringify(dest);
    expect(flat).toContain('generating');
    expect(flat).toContain(TRIP_ID);
  });
});

describe('🔴 I16 · TRIP-504 AC-5 · TRIP-785 — copick 갈래는 CO_PLAN generating + 첫 슬롯 successRoute, 건너뛰기 부재', () => {
  /**
   * 완전AI 갈래(I13)는 mode 없이 generating 으로만 간다. copick 갈래는 h04 에서 실려 온 `mode`
   * 신호를 받아 CTA 목적지를 **CO_PLAN generating + successRoute=첫 슬롯 경로**로 바꾼다(01b Q3).
   *
   * ★ 목적지 값이 급소다(462 gate②-2). h05 시점엔 slotKey 를 아직 모르므로 successRoute 는
   *   슬롯 라우트 **템플릿**(`copick/[slotKey]`)이고, 그 `[slotKey]` 세그먼트가 허브(`copick`)와
   *   가른다 — mode 만 맞고 successRoute 가 허브/draft 로 새면 사용자가 엉뚱한 화면에 착지한다.
   *   건너뛰기는 copick 갈래에서도 listed 에 없다(TRIP-785 — failed 전용).
   */
  it('proceed 가 CO_PLAN generating + 첫 슬롯 successRoute 로 가고, 건너뛰기는 listed 에 없으며 요청은 0건이다', async () => {
    await openList('CO_PLAN');

    const proceed = screen.getByTestId('itinerary-mustvisit-screen-proceed');

    // ① 다음 CTA → CO_PLAN generating. 목적지를 직렬화해 값째 잰다.
    fireEvent.press(proceed);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    const dest = mockPush.mock.calls[0][0];
    const flat = typeof dest === 'string' ? dest : JSON.stringify(dest);
    expect(flat).toContain('generating');
    // ★ mode 신호 — 완전AI(mode 없음)와 가르는 지점.
    expect(flat).toContain('CO_PLAN');
    // ★ successRoute = 첫 슬롯 경로 계열(허브 `copick` 가 아니라 슬롯 라우트 `copick/[slotKey]`).
    //   `[slotKey]` 세그먼트가 허브와 가른다 — 허브/draft 로 새면 red.
    expect(flat).toContain('copick/[slotKey]');
    expect(flat).toContain(TRIP_ID);

    // ② 🔴 건너뛰기는 listed 에 없다(TRIP-785 — failed 전용). copick 갈래도 예외 아니다.
    expect(countTestId('itinerary-mustvisit-screen-skip')).toBe(0);

    // ③ 전진은 요청을 만들지 않는다(생성 POST 는 h09 소유, 무회귀).
    expect(hitsFor('POST', '/must-visits')).toBe(0);
    expect(hitsFor('DELETE', '/must-visits')).toBe(0);
  });
});
