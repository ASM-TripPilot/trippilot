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
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { MustVisitTimePage } from './MustVisitTimePage';

/**
 * h07 배선을 **실 HTTP 로** 태우는 심판 — 이 칸의 급소다(AC-4 · AC-5 · AC-6 · AC-7 · D1 · D8).
 *
 * ⚠️ **왜 이 파일이 가장 무거운가**: 계약에 must-visit **수정 오퍼레이션이 없다**
 * (`origin/develop` openapi 전수 확인 — POST·GET·DELETE 3개뿐, `PATCH`/`PUT` 부재). 같은
 * `sourcePoiId` 재-POST 는 INV-U1-18 로 409다. 그래서 01b D1 이 고른 유일한 경로가
 * **DELETE → POST 2단**이고, 그 경로에는 **원자성이 없다** — DELETE 가 성공한 뒤 POST 가
 * 실패하면 항목이 통째로 사라진다(사용자가 잃는다).
 *
 * 이 파일이 세우는 심판 셋:
 *  1. 순서가 **DELETE 먼저**다(I7). POST 를 먼저 보내는 구현은 가짜 서버에서만 초록이고 실제
 *     서버에서는 409로 전부 막힌다.
 *  2. DELETE 성공 + POST 실패를 **침묵하지 않고**, 재시도 수단을 낸다(I8).
 *  3. 그 재시도가 **DELETE 를 다시 내지 않는다**(I8 ④). 다시 내면 없는 id 로 404 가 나거나
 *     방금 성공한 등록을 지운다.
 *
 * *(개념)* **`observedHits`** — 가짜 서버에 도착한 요청을 `METHOD /경로` 로 **도착 순서 그대로**
 * 쌓아 둔 배열. 배열 `toEqual` 은 순서에 민감하므로 이 배열 한 줄로 "몇 건이 어떤 순서로
 * 나갔나" 를 통째로 잠글 수 있다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=날짜·시각을 고르고 저장 → 단언=나간 요청·본문·화면.
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const POI_ID = 'poi-a';
const MUST_VISIT_ID = 'mv-poi-a';

const DELETE_HIT = `DELETE /api/v1/trips/${TRIP_ID}/must-visits/${MUST_VISIT_ID}`;
const POST_HIT = `POST /api/v1/trips/${TRIP_ID}/must-visits`;

/** openapi `Trip.required` 10필드를 그대로 채운다(상상해서 만들지 않는다). 기간이 3일이라
 * 날짜 칩이 정확히 3개여야 한다(AC-6). */
const TRIP: Trip = {
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-12',
  party: 1,
  companionType: null,
  budgetTotal: 800000,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'PLANNED',
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
};

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

const SAVED: SavedPlace[] = [
  {
    savedPlaceId: 'sp-poi-a',
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace(POI_ID, '부산시립미술관'),
  },
];

/** 승격 전 상태 — `poi-a` 는 지금 `ANYTIME` 으로 등록돼 있다. */
const REGISTERED: MustVisit[] = [
  {
    mustVisitId: MUST_VISIT_ID,
    poiSnapshotId: 'snap-poi-a',
    sourcePoiId: POI_ID,
    type: 'ANYTIME',
  },
];

let observedHits: string[] = [];
let postBodies: Record<string, unknown>[] = [];
/** POST 를 이 상태 코드로 실패시킨다(없으면 201). */
let postStatus: number | null = null;

/** must-visits **쓰기** 요청만 도착 순서대로. GET 은 섞지 않는다 — 개수·순서 단언의 모집단이다. */
function mustVisitWrites(): string[] {
  return observedHits.filter(
    (hit) => /^(POST|DELETE) /.test(hit) && hit.includes('/must-visits')
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
  postBodies = [];
  postStatus = null;
  mockPush.mockClear();
  mockBack.mockClear();
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(TRIP)),
    http.get(`${BASE}/trips/:tripId/must-visits`, () =>
      HttpResponse.json(REGISTERED)
    ),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(SAVED)),
    http.delete(
      `${BASE}/trips/:tripId/must-visits/:mustVisitId`,
      () => new HttpResponse(null, { status: 204 })
    ),
    http.post(`${BASE}/trips/:tripId/must-visits`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      postBodies.push(body);
      if (postStatus !== null)
        return HttpResponse.json({}, { status: postStatus });
      return HttpResponse.json(
        {
          mustVisitId: 'mv-new',
          poiSnapshotId: 'snap-poi-a',
          sourcePoiId: POI_ID,
          type: 'FIXED',
          fixedDate: body.fixedDate,
          fixedStart: body.fixedStart,
        },
        { status: 201 }
      );
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

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
  return render(<MustVisitTimePage tripId={TRIP_ID} sourcePoiId={POI_ID} />, {
    wrapper: Wrapper,
  });
}

/**
 * 토글을 원하는 상태로 만든다. **초기 상태를 못 박지 않는다** — 항목이 지금 `ANYTIME` 이라
 * 꺼진 채로 열리는 것도, Figma 프레임처럼 켜진 채로 열리는 것도 정본이 말하지 않았다.
 * 여기서 초기값을 단언하면 이 칸이 정하지 않은 것을 정하는 셈이 된다.
 */
function ensureFixed(on: boolean): void {
  const toggle = screen.getByTestId('itinerary-mustvisit-time-toggle');
  const checked = Boolean(toggle.props.accessibilityState?.checked);
  if (checked !== on) fireEvent.press(toggle);
}

/** 날짜 6.11 + 시작 시각 13:00 을 고르는 3동작 묶음. */
function pickDateAndStart(): void {
  fireEvent.press(
    screen.getByTestId('itinerary-mustvisit-time-date-2026-06-11')
  );
  fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-field'));
  fireEvent.press(
    screen.getByTestId('itinerary-mustvisit-time-start-option-13:00')
  );
}

function submit(): void {
  fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-submit'));
}

/** 화면이 준비될 때까지(여행 기간이 도착해 날짜 칩이 그려질 때까지) 기다린다. */
async function ready(): Promise<void> {
  await screen.findByTestId('itinerary-mustvisit-time-date-2026-06-11');
}

describe('🔴 I7 · AC-4 · 01b D1 — 승격은 DELETE 가 먼저, POST 가 뒤다', () => {
  it('쓰기 요청이 정확히 두 건이고 그 순서이며, 본문이 FIXED 계약 그대로다', async () => {
    renderPage();
    await ready();
    ensureFixed(true);
    pickDateAndStart();

    submit();

    // ★ 배열 완전 일치 한 줄이 **개수·순서·경로**를 통째로 잠근다. `toContain` 두 줄로 나눠 쓰면
    //   POST 를 먼저 보내는 구현이 통과하는데, 그 구현은 실제 서버에서 INV-U1-18(중복 금지)에
    //   걸려 409 로 전부 막힌다 — 가짜 서버에서만 초록인 코드가 된다.
    await waitFor(() =>
      expect(mustVisitWrites()).toEqual([DELETE_HIT, POST_HIT])
    );

    // 본문 완전 일치 — `AddMustVisitRequest` 계약 그대로이고 여분 필드가 없다.
    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]).toEqual({
      poiId: POI_ID,
      type: 'FIXED',
      fixedDate: '2026-06-11',
      fixedStart: '13:00',
      dwellMin: 60,
    });

    // 성공하면 목록으로 되돌아간다.
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(screen.queryAllByTestId('itinerary-mustvisit-time-error')).toEqual(
      []
    );
  });
});

describe('🔴🔴 I8 · 01b D1 의 위험 — DELETE 성공 후 POST 가 실패하면 사용자가 항목을 잃는다', () => {
  /**
   * 이 케이스가 이 칸에서 가장 비싼 심판이다. 계약에 원자적 수정이 없어 중간 실패가 **원리적으로**
   * 존재하고, 그때 사라지는 것은 사용자의 데이터다. 침묵하면 사용자는 이유를 모른 채 항목이
   * 없어진 목록을 본다(INV-4 · BR-U1-55 침묵 실패 금지).
   */
  it('실패를 드러내고 되돌아가지 않으며, 재시도는 POST 만 다시 내고 DELETE 는 1건에 머문다', async () => {
    postStatus = 500;
    renderPage();
    await ready();
    ensureFixed(true);
    pickDateAndStart();

    submit();

    // ① 긍정 앵커 — 두 요청이 실제로 나갔다. 없으면 "아무것도 안 보낸" 구현도 아래를 통과한다.
    await waitFor(() =>
      expect(mustVisitWrites()).toEqual([DELETE_HIT, POST_HIT])
    );

    // ② 침묵하지 않는다 — 실패가 화면에 뜨고, **되돌아가지 않는다**. 돌아가 버리면 사용자는
    //    항목이 사라진 목록만 보고 이유를 알 방법이 없다.
    const error = await screen.findByTestId('itinerary-mustvisit-time-error');
    expect(error).not.toHaveTextContent('');
    expect(mockBack).not.toHaveBeenCalled();

    // ③ 재시도 수단이 있다 — 원래 값으로 다시 POST 하면 복구된다(01b D1 §1).
    const retry = screen.getByTestId('itinerary-mustvisit-time-retry');
    expect(retry).toBeOnTheScreen();

    // 실행 ② — 서버가 회복된 뒤 사용자가 재시도를 누른다.
    postStatus = null;
    fireEvent.press(retry);

    // ④ ★ 이 칸의 급소 — 재시도는 **POST 만** 다시 낸다. DELETE 가 2건이 되는 순간, 없는 id 로
    //    404 가 나서 영원히 복구하지 못하거나 방금 성공한 등록을 지운다.
    await waitFor(() =>
      expect(mustVisitWrites()).toEqual([DELETE_HIT, POST_HIT, POST_HIT])
    );

    // ⑤ 재시도 본문이 첫 시도와 **완전히 같다** — 사용자가 하려던 일을 그대로 복구한다.
    expect(postBodies[1]).toEqual(postBodies[0]);

    // ⑥ 성공했으니 안내가 걷히고 되돌아간다.
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryAllByTestId('itinerary-mustvisit-time-error')).toEqual(
        []
      )
    );
  });
});

describe('I9 · AC-5 — 값이 비면 요청이 한 건도 안 나간다 (INV-U1-17)', () => {
  it('시각을 고르지 않고 저장을 누르면 쓰기 요청 0건이고 사유가 보인다', async () => {
    renderPage();
    await ready();
    ensureFixed(true);
    // 날짜만 고르고 시각은 비운다.
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-time-date-2026-06-11')
    );

    submit();

    // 요청이 나갈 틈을 준 뒤에 센다 — 곧바로 세면 "아직 안 나갔을 뿐" 인 것을 통과시킨다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // 🔴 DELETE 도 POST 도 0건. 클라 검증은 UX 사본이고 판정 권위는 서버지만, **되돌릴 수 없는
    //    DELETE 를 검증 전에 보내는 것**은 UX 사본의 문제가 아니라 데이터 손실이다.
    expect(mustVisitWrites()).toEqual([]);
    expect(
      screen.getByTestId('itinerary-mustvisit-time-error')
    ).not.toHaveTextContent('');

    // 긍정 앵커 — 화면이 죽어서 0건인 게 아니다. 조회는 정상으로 나갔다.
    expect(
      observedHits.filter((hit) => hit.startsWith('GET')).length
    ).toBeGreaterThan(0);
  });
});

describe('I10 · AC-6 — 날짜 칩은 여행 기간에서만 나온다 (INV-U1-17 을 위젯으로 강제)', () => {
  it('여행 조회가 나가고 칩이 정확히 그 3일이다', async () => {
    renderPage();
    await ready();

    expect(
      screen
        .queryAllByTestId(/^itinerary-mustvisit-time-date-/)
        .map((node) => String(node.props.testID))
    ).toEqual([
      'itinerary-mustvisit-time-date-2026-06-10',
      'itinerary-mustvisit-time-date-2026-06-11',
      'itinerary-mustvisit-time-date-2026-06-12',
    ]);
    expect(observedHits).toContain(`GET /api/v1/trips/${TRIP_ID}`);
  });
});

describe('I11 · AC-7 · D5(개정) · INV-U1-18 — 409 는 실패로 세지 않되 침묵하지도 않는다', () => {
  /**
   * **01b D5 개정(오케 판정 2026-08-08) — 409 안내 위치가 h05 → h07 로 옮겨졌다.**
   * D6 이 h05 의 검색 필·추가 타일을 범위 밖으로 빼면서 h05 에 POST 경로가 0이 됐다. 남은 유일한
   * POST 는 이 화면의 승격 요청이므로, 409 를 만드는 쪽도 알리는 쪽도 여기다.
   *
   * 판정 둘이 **동시에** 성립해야 한다:
   *  - 실패로 **세지 않는다** — 목표 상태(그 장소가 필수 방문지에 있다)와 결과 상태가 같다
   *    (U1 `isAlreadyRegistered` 선례). 그래서 실패 배너도 재시도 유도도 없다.
   *  - 그래도 **침묵하지 않는다** — 사용자가 "고정했다" 고 믿게 두면 안 된다(INV-4 · BR-U1-55).
   *
   * **게이트①-3 정정(오케 판정 2026-08-08)**: 이 케이스가 원래 되돌아가기 1회를 **함께** 요구해서,
   * 구현이 안내를 세운 직후 화면을 떠나 **실기에서 안내가 한 프레임도 안 보였다**(테스트가 초록이던
   * 이유는 라우터가 목이라 화면이 남아 있었기 때문이다). 심판이 "사용자가 볼 수 없는 안내"를
   * 강제하고 있었다 — AC 결함이다. **409 에서는 되돌아가지 않는다**로 고쳤다.
   * ⚠️ **성공 경로(I7·I8)의 되돌아가기 1회는 그대로다** — 거기서는 떠나는 것이 맞다.
   */
  it('안내 문구가 화면에 남고, 실패 배너·재시도는 없고, 더 보내지 않고, 되돌아가지 않는다', async () => {
    postStatus = 409;
    renderPage();
    await ready();
    ensureFixed(true);
    pickDateAndStart();

    submit();

    // ① 침묵하지 않는다 — 01b D5 가 동결한 문구다(은퇴한 `[보관] g03` 의 `이미 담은 곳이에요` 를
    //    이 화면의 대상에 맞춘 것). `toHaveTextContent(문자열)` 은 완전 일치라 이 한 줄이 문구
    //    전체를 잠근다.
    expect(
      await screen.findByTestId('itinerary-mustvisit-time-duplicate')
    ).toHaveTextContent('이미 추가된 곳이에요');

    // ② 실패로 세지 않는다 — 실패 배너도, 재시도 유도도 없다. 안내 슬롯과 실패 슬롯을 **다른
    //    testID 로 가르는 것**이 이 두 줄의 전부다. 하나로 합치면 409 가 실패로 되살아난다.
    expect(screen.queryAllByTestId('itinerary-mustvisit-time-error')).toEqual(
      []
    );
    expect(screen.queryAllByTestId('itinerary-mustvisit-time-retry')).toEqual(
      []
    );

    // ③ 요청을 더 보내지도 않는다(409 를 보고 재시도 물결을 돌리면 요청만 는다).
    expect(mustVisitWrites()).toEqual([DELETE_HIT, POST_HIT]);

    // ④ 🔴 **되돌아가지 않는다**(게이트①-3 오케 판정). 안내를 세운 직후 화면을 떠나면 그 안내는
    //    실기에서 **한 프레임도 보이지 않는다** — 침묵과 같아져 D5 가 존재하는 이유가 무효화된다.
    //    나가는 것은 사용자가 뒤로 눌러서 한다. 요청이 끝나고도 남는 창을 준 뒤에 센다 —
    //    곧바로 세면 "아직 안 불렸을 뿐" 인 것을 통과시킨다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mockBack).not.toHaveBeenCalled();

    // ⑤ 그리고 그 창이 지난 **뒤에도** 안내가 화면에 그대로 있다. ①은 뜨는 순간을 봤고,
    //    이 줄은 **머무는 것**을 본다 — 떴다가 스스로 사라지는 구현을 죽인다.
    expect(
      screen.getByTestId('itinerary-mustvisit-time-duplicate')
    ).toBeOnTheScreen();
  });
});

describe('I12 · D8 — 토글을 끄면 저장이 나가지 않는다', () => {
  it('CTA 가 잠기고 눌러도 쓰기 요청이 0건이다', async () => {
    renderPage();
    await ready();
    ensureFixed(true);
    pickDateAndStart();

    // 값을 다 채운 **뒤에** 끈다 — "값이 없어서 안 나간 것" 과 구별되는 자리다.
    ensureFixed(false);

    expect(
      screen.getByTestId('itinerary-mustvisit-time-submit')
    ).toBeDisabled();
    submit();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(mustVisitWrites()).toEqual([]);
    expect(mockBack).not.toHaveBeenCalled();
  });
});
