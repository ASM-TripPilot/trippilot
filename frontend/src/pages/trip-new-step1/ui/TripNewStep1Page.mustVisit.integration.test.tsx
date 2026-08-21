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
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-209 '꼭 갈 곳' — **실 HTTP 로 태우는 심판**(AC-7 · AC-8 · AC-9 · AC-10 · 01b D1~D4).
 *
 * 무엇을 보장하나:
 *  - `GET /saved-places` 가 실제로 나가고 그 결과가 썸네일·캡션까지 이어진다.
 *  - 여행 생성이 성공한 **뒤에** 남은 시드가 `POST /trips/{tripId}/must-visits` 로 한 건씩
 *    `type: ANYTIME` 으로 나간다(BR-U1-48). 시드가 0건이면 한 건도 안 나간다.
 *  - **409 는 성공으로 수렴**하고(INV-U1-18 — 목표 상태 = 결과 상태), 404 는 사용자에게
 *    드러난다(INV-4 침묵 실패 금지).
 *  - 🔴 **등록 실패가 "여행 생성 실패"로 둔갑하지 않는다.** 여행은 이미 만들어졌으므로 롤백하지
 *    않고, [다시 시도]는 **등록만** 다시 한다 — `POST /trips` 가 두 번째로 나가면 사용자에게
 *    **여행이 하나 더 생긴다(되돌릴 수 없다)**.
 *
 * 왜 통합 버킷인가: 심판의 핵심이 **요청의 개수·순서·본문**이다. 훅이나 등록 함수를 목킹하면
 * "409 도 axios 는 예외로 던진다"·"실패해도 나머지 요청은 나간다" 같은 성질이 테스트의 *가정*이
 * 되어, 그 가정이 틀려도 아무도 모른다(문제로그 `2026-08-02 목이 성공만 흉내내 도달 불가 분기가
 * 초록으로 남았다`). 상태 조합별 얼굴은 `TripNewStep1Page.mustVisit.test.tsx` 가 본다.
 *
 * *(개념)* **`Promise.allSettled`** — 여러 비동기 작업을 성공·실패 상관없이 **전부 기다렸다가**
 * 결과 배열을 돌려주는 표준 API. `Promise.all` 은 하나만 실패해도 즉시 던져 나머지 결과를 잃는데,
 * 이 칸은 "3곳 중 1곳 실패"를 **세어서 문구로** 만들어야 하므로 `all` 로는 만들 수 없다(01b D3).
 *
 * 3동작 뼈대: 준비=핸들러 응답 지정 + 드래프트 채우기 → 실행=`[다음]`/재시도 press →
 * 단언=나간 요청(개수·본문) · 배너 · 이동 여부.
 */

// authedClient(생성 클라이언트가 타는 인증 계층)가 `@/shared/storage` 를 정적으로 물고 있다 —
// expo-secure-store 실물 로드를 피하려면 목킹해야 한다(선례와 동형).
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

/** `authWiring.integration.test.ts:59` 와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';

/** 프리셋 계산 기준일 고정 — 실행일이 바뀌어도 날짜 단언이 흔들리지 않는다. */
const BASE_DATE = '2026-06-10';

const TRIP_ID = '11111111-1111-1111-1111-111111111111';

/** openapi `Trip.required` 10필드를 그대로 채운다(상상해서 만들지 않는다). */
const TRIP: Trip = {
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  party: 1,
  companionType: null,
  budgetTotal: 800000,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 3 }],
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
    region: '수영구',
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

const THREE: SavedPlace[] = [
  savedPlace('poi-1', '감천마을'),
  savedPlace('poi-2', '광안리'),
  savedPlace('poi-3', '전포'),
];

function mustVisitBody(poiId: string): MustVisit {
  return {
    mustVisitId: `mv-${poiId}`,
    poiSnapshotId: `snap-${poiId}`,
    sourcePoiId: poiId,
    type: 'ANYTIME',
  };
}

/** 나간 요청의 `METHOD /경로` 누적 — 요청 **횟수**를 세는 데 쓴다. */
let observedHits: string[] = [];
/** must-visits 로 실제로 나간 본문(JSON 직렬화 **이후**). */
let mustVisitBodies: { poiId?: string; type?: string }[] = [];
/** 이 poiId 는 이 상태 코드로 실패시킨다(없으면 201). */
let failFor: Record<string, number> = {};

/** ⚠️ **완전 일치**로 센다 — must-visits 경로(`POST /api/v1/trips/{id}/must-visits`)가
 * 생성 경로를 접두로 포함하므로, 부분 일치로 세면 두 축이 섞여 "여행이 두 번 만들어졌다"를
 * 못 본다. 이 칸에서 가장 비싼 사고가 정확히 그 축이다(02a ★3). */
function createHits(): number {
  return observedHits.filter((hit) => hit === 'POST /api/v1/trips').length;
}

function mustVisitHits(): number {
  return observedHits.filter((hit) => hit.endsWith('/must-visits')).length;
}

function savedPlaceHits(method: 'GET' | 'DELETE'): number {
  return observedHits.filter(
    (hit) => hit.startsWith(method) && hit.includes('/api/v1/saved-places')
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
  mustVisitBodies = [];
  failFor = {};
  mockPush.mockClear();
  useTripWizardStore.getState().reset();
  // 담은 목록 조회는 `enabled: isAuthed` 다 — 토큰이 없으면 요청 자체가 안 나간다(BR-U1-03).
  setAccessToken('valid-access');

  // 통합 버킷은 `onUnhandledRequest: 'error'` 라 핸들러가 없으면 AC 실패가 아니라 **준비
  // 단계에서 죽는다**. 이 칸이 쓰는 세 경로를 매번 명시적으로 건다.
  server.use(
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(THREE)),
    http.post(`${BASE}/trips`, () => HttpResponse.json(TRIP, { status: 201 })),
    http.post(`${BASE}/trips/:tripId/must-visits`, async ({ request }) => {
      const body = (await request.json()) as { poiId?: string; type?: string };
      mustVisitBodies.push(body);
      const status = failFor[body.poiId ?? ''];
      if (status !== undefined) {
        return HttpResponse.json({}, { status });
      }
      return HttpResponse.json(mustVisitBody(body.poiId ?? ''), {
        status: 201,
      });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/**
 * `gcTime: 0` — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를 붙잡는다.
 * mutation 기본 gcTime 은 5분이라 그쪽도 0으로 둔다(TRIP-203 실측).
 * `retry: false` — 실패를 즉시 실패로 본다.
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
  return render(<TripNewStep1Page baseDate={BASE_DATE} />, {
    wrapper: Wrapper,
  });
}

/** 도시 추가 시트를 열어 지역 하나를 N박으로 확정하는 3동작 묶음(승인 파일과 같은 형태). */
function addDestination(regionCode: string, nights: number): void {
  fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
  fireEvent.press(
    screen.getByTestId(`trip-wizard-destination-region-${regionCode}`)
  );
  for (let i = 1; i < nights; i += 1) {
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc'));
  }
  fireEvent.press(screen.getByTestId('trip-wizard-destination-confirm'));
}

/** 정상 제출이 가능한 상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
function fillValidDraft(): void {
  addDestination('busan', 3);
  fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

function poiIdsSent(): string[] {
  return mustVisitBodies.map((body) => body.poiId ?? '');
}

describe('I-1 · AC-1 — 조회가 실제로 나가고 썸네일까지 이어진다', () => {
  it('담은 곳 3건이 썸네일과 캡션으로 그려진다', async () => {
    renderPage();

    expect(
      await screen.findByTestId('trip-wizard-mustvisit-poi-1')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-wizard-saved-place-count')).getByText(
        '담은 곳 3곳'
      )
    ).toBeOnTheScreen();
    expect(savedPlaceHits('GET')).toBe(1);
  });
});

describe('I-2 · AC-7 — 생성 성공 뒤 남은 시드를 한 건씩 등록한다 (BR-U1-48)', () => {
  it('POST /trips 1건 뒤 must-visits 3건이 ANYTIME 으로 나가고 step2 로 간다', async () => {
    renderPage();
    await screen.findByTestId('trip-wizard-mustvisit-poi-1');

    fillValidDraft();
    fireEvent.press(next());

    // 계약상 꼭 갈 곳을 생성 요청에 실어 보낼 방법이 없다(CreateTripRequest 에 필드가 없다) —
    // 그래서 반드시 "생성 → tripId 확보 → 등록 N건" 2단이다.
    await waitFor(() => expect(mustVisitBodies).toHaveLength(3));
    expect(poiIdsSent().sort()).toEqual(['poi-1', 'poi-2', 'poi-3']);
    mustVisitBodies.forEach((body) => expect(body.type).toBe('ANYTIME'));
    expect(createHits()).toBe(1);
    expect(mustVisitHits()).toBe(3);

    // ★ 요청이 **어느 여행으로** 갔는지 본다. 위 두 줄은 경로 끝만 세므로, 여행 id 자리에
    // 엉뚱한 값이 박혀 나가도(가짜 서버는 아무 값이나 받는다) 그대로 초록이다 — 실제 앱에서는
    // 모든 등록이 404가 되어 사용자가 매번 실패 배너를 본다.
    expect(observedHits).toContain(`POST /api/v1/trips/${TRIP_ID}/must-visits`);

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('I-3 시드가 0건이면 한 건도 부르지 않는다 (짝)', async () => {
    server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json([])));
    renderPage();
    // 0곳 얼굴이 뜰 때까지 기다린다 — 조회가 끝나기 전에 제출하면 "아직 안 왔다"와
    // "정말 0건이다"를 구별할 수 없다.
    await screen.findByTestId('trip-wizard-mustvisit-empty');

    fillValidDraft();
    fireEvent.press(next());

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(mustVisitHits()).toBe(0);
    expect(createHits()).toBe(1);
  });
});

describe('I-4 · AC-8 — 409(이미 추가됨)는 성공으로 수렴한다 (INV-U1-18 · 01b D4)', () => {
  it('배너를 띄우지 않고 그대로 이동한다', async () => {
    // 목표 상태(그 장소가 꼭 갈 곳에 있다)와 결과 상태가 같다 — 실패가 아니다.
    // 리포 선례: `savedPlaces.ts:100` 이 담기 409 를 같은 판단으로 이미 수렴시킨다.
    failFor = { 'poi-2': 409 };
    renderPage();
    await screen.findByTestId('trip-wizard-mustvisit-poi-1');

    fillValidDraft();
    fireEvent.press(next());

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(screen.queryByTestId('trip-wizard-mustvisit-banner')).toBeNull();
    // 짝(긍정) — 409 를 받은 요청이 실제로 나갔다. 없으면 "아무것도 안 보낸" 구현도 통과한다.
    expect(poiIdsSent()).toContain('poi-2');
  });
});

describe('🔴 I-5 · AC-9 · AC-10 — 등록 실패가 "여행 생성 실패"로 둔갑하지 않는다', () => {
  it('등록 배너만 뜨고, 이동하지 않고, POST /trips 는 여전히 1건이다', async () => {
    // ⚠️ 문제로그 `2026-08-02 성공 후 부작용을 try가 감싸면 성공이 실패로 둔갑한다`.
    // 두 try 를 한 블록으로 묶으면 등록 실패가 "네트워크 실패" 배너로 보이고, 사용자가
    // [다시 시도]를 눌러 **여행이 하나 더 만들어진다 — 되돌릴 수 없다**(01b D2).
    failFor = { 'poi-2': 404 };
    renderPage();
    await screen.findByTestId('trip-wizard-mustvisit-poi-1');

    fillValidDraft();
    fireEvent.press(next());

    // ① 실패를 조용히 삼키지 않는다(INV-4) — 문구가 시도·실패 건수를 둘 다 말한다(D4).
    const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
    expect(banner).toHaveTextContent(/3/);
    expect(banner).toHaveTextContent(/1/);

    // ② 여행 생성 실패 배너가 **아니다**. 그쪽 [다시 시도]는 `submit` 을 다시 태운다.
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();

    // ③ 한 건이 실패해도 나머지는 전부 나갔다(01b D3 — `Promise.allSettled` 병렬).
    expect(poiIdsSent().sort()).toEqual(['poi-1', 'poi-2', 'poi-3']);

    // ④ 여행은 그대로 둔다 — 롤백하지 않고(BR-U1-51 입력 보존), 두 번 만들지도 않는다.
    expect(createHits()).toBe(1);
    expect(observedHits.filter((hit) => hit.startsWith('DELETE'))).toEqual([]);

    // ⑤ 배너를 못 본 채 다음 화면으로 떠나지 않는다(01b D1 — 배너는 step1 에만 있다).
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 I-6 · 재시도는 등록만 다시 한다 (01b §4-3 · AC-10)', () => {
  it('실패분 1건만 다시 나가고 POST /trips 는 늘지 않으며, 성공하면 이동한다', async () => {
    failFor = { 'poi-2': 404 };
    renderPage();
    await screen.findByTestId('trip-wizard-mustvisit-poi-1');

    fillValidDraft();
    fireEvent.press(next());
    await screen.findByTestId('trip-wizard-mustvisit-banner');
    expect(createHits()).toBe(1);

    // 실행 — 서버가 회복된 뒤 사용자가 배너의 [다시 시도]를 누른다.
    failFor = {};
    mustVisitBodies = [];
    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-banner-retry'));

    // ① 실패한 것만 다시 보낸다 — 이미 성공한 두 건을 또 보내면 요청만 늘어난다.
    await waitFor(() => expect(mustVisitBodies).toHaveLength(1));
    expect(poiIdsSent()).toEqual(['poi-2']);

    // ② ★ 이 칸에서 가장 비싼 사고의 심판 — 재시도가 여행을 **다시 만들지 않는다**.
    //    2가 되는 순간 사용자에게 여행이 하나 더 생긴 것이고, 되돌릴 수 없다.
    expect(createHits()).toBe(1);

    // ③ 다 성공했으니 배너가 걷히고 이동한다.
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-mustvisit-banner')).toBeNull()
    );
  });
});

describe('I-7 · AC-5 — x 로 뺀 항목은 등록되지 않고, 담기는 그대로다', () => {
  it('등록은 2건이고 뺀 poiId 가 없으며 담기 해제 요청이 0건이다', async () => {
    renderPage();
    await screen.findByTestId('trip-wizard-mustvisit-poi-1');

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-remove-poi-2'));
    fillValidDraft();
    fireEvent.press(next());

    await waitFor(() => expect(mustVisitBodies).toHaveLength(2));
    expect(poiIdsSent().sort()).toEqual(['poi-1', 'poi-3']);

    // ★ 부정 짝 — 시드 제거는 **복사본만** 건드린다(BR-U1-37 · INV-U1-04). 담기 해제가
    // 함께 나가면 사용자는 탐색 화면의 ♥ 까지 잃는다.
    expect(savedPlaceHits('DELETE')).toBe(0);
    // 담은 목록 조회도 다시 부르지 않는다 — 제거는 로컬 드래프트 안의 일이다.
    expect(savedPlaceHits('GET')).toBe(1);
  });
});

/**
 * ─── 게이트①-2 추가분 (I-8 · I-9 · I-10) ───────────────────────────────────────
 *
 * 무엇을 보는가: **여행이 두 개 만들어지는 문이 아직 열려 있나.**
 * `[다음]`을 누르면 여행이 먼저 만들어지고 그 다음에 꼭 갈 곳이 한 건씩 나가는데, 그 사이
 * (모바일 회선이면 수백 ms~수 초) 화면은 아무 변화가 없다. 버튼은 여전히 진하고 눌린다.
 * "안 눌렸나?" 하고 한 번 더 누르면 여행 만들기가 두 번째로 나가고, **사용자에게 여행이 두 개
 * 생긴다 — 되돌릴 수 없다.** 위 I-1~I-7 은 `[다음]` 을 전부 **한 번만** 누르므로 이 문을 못 본다.
 *
 * *(개념)* **응답을 붙잡아 둔다** — 가짜 서버가 응답을 만들기 직전에 멈춰 서서, 테스트가
 * 바깥에서 풀어 줄 때까지 기다리게 하는 방법이다. 이렇게 해야 "요청은 나갔고 답은 아직"인
 * 짧은 창 안으로 테스트가 들어갈 수 있다. `TripNewStep1Page.integration.test.tsx` 의 I-6 이
 * 여행 만들기 구간에 대해 이미 쓰고 있는 형태이고, 여기서는 그것을 **등록 구간**에 쓴다.
 *
 * ⚠️ 그 선례는 붙잡는 요청이 **하나**라 풀어 줄 손잡이도 하나였다. 이 칸은 등록이 **3건 동시**로
 * 나가서, 손잡이를 변수 하나에 담으면 마지막 하나만 풀리고 나머지 둘이 영원히 매달린다. 그래서
 * 손잡이를 **배열로 모아 전부 푼다**(02a ★14, 실행으로 확인).
 */

describe('🔴 I-8 · 등록이 날아가는 중에 [다음]을 다시 눌러도 여행은 하나뿐', () => {
  it('붙잡힌 창에서 두 번째 press 는 POST /trips 를 만들지 않고, 풀면 정상 완주한다', async () => {
    // 준비 — 등록 응답을 손으로 붙잡아 두는 핸들러. 요청이 도착한 사실은 바깥에서 보이도록
    // 본문을 먼저 쌓고, 그 다음에 멈춘다.
    const releases: (() => void)[] = [];
    server.use(
      http.post(`${BASE}/trips/:tripId/must-visits`, async ({ request }) => {
        const body = (await request.json()) as { poiId?: string };
        mustVisitBodies.push(body);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return HttpResponse.json(mustVisitBody(body.poiId ?? ''), {
          status: 201,
        });
      })
    );

    renderPage();
    await screen.findByTestId('trip-wizard-mustvisit-poi-1');
    fillValidDraft();

    // 실행 ① — 첫 press. 등록 3건이 **서버에 도달해 붙잡힐 때까지** 기다린다.
    // ⚠️ 이 기다림이 이 케이스의 전부다. 같은 순간에 연달아 두 번 누르면 여행 만들기가 아직
    //    끝나지 않은 **다른 구간**을 태우게 되어, 이 칸이 닫은 문을 심판하지 못한다(02a ★15).
    fireEvent.press(next());
    await waitFor(() => expect(mustVisitBodies).toHaveLength(3));
    expect(createHits()).toBe(1);

    // 실행 ② — 여행은 이미 만들어졌고 등록은 아직인 창에서 한 번 더 누른다.
    fireEvent.press(next());
    // 두 번째 요청이 나갈 **틈을 준다** — 곧바로 세면 "아직 안 나갔을 뿐"인 것을 통과시킨다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // 단언 ① — 여행은 여전히 하나다. 이 숫자가 2가 되는 순간 되돌릴 수 없는 피해다.
    expect(createHits()).toBe(1);
    // 등록 물결도 두 번 돌지 않는다(이미 나간 3건을 또 보내면 요청만 는다).
    expect(mustVisitHits()).toBe(3);

    // 실행 ③ + 단언 ② (짝, 긍정) — 붙잡은 것을 전부 풀면 정상적으로 끝난다.
    // "아무것도 안 나감"이 아니라 **한 번은 제대로 완주한다**는 것을 못박는다.
    await act(async () => {
      releases.forEach((release) => release());
    });
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(createHits()).toBe(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 I-9 · 등록이 끝나 넘어간 뒤에 되돌아와 다시 눌러도 여행은 하나뿐', () => {
  it('이동 후 두 번째 press 는 생성도 등록도 다시 만들지 않고, 이동만 다시 한다', async () => {
    renderPage();
    await screen.findByTestId('trip-wizard-mustvisit-poi-1');
    fillValidDraft();

    // 실행 ① — 정상 완주.
    fireEvent.press(next());
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(createHits()).toBe(1);
    expect(mustVisitHits()).toBe(3);

    // 실행 ② — step1 은 스택에 남아 있어 뒤로 오면 같은 버튼이 다시 눌린다(라우터를 목킹한
    // 이 테스트에서는 화면이 실제로 그대로 남아 있다).
    fireEvent.press(next());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // 단언 — 지켜야 할 것은 **되돌릴 수 없는 쪽**뿐이다: 여행은 하나, 등록 물결도 한 번.
    expect(createHits()).toBe(1);
    expect(mustVisitHits()).toBe(3);
    // 이동은 다시 한다(2026-08-21 실측 회귀) — 예전 계약은 여기서 아무것도 안 하는 것이었고,
    // 그 결과 활성인 `[다음]`이 무반응이라 사용자가 고장으로 읽었다. 이동은 되돌릴 수 있으므로
    // 잠금이 막아야 할 대상이 아니다.
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenNthCalledWith(2, '/trips/new/step2');
  });
});

describe('🔴 I-10 · 배너 [다시 시도]를 연타해도 재등록도 이동도 한 번뿐', () => {
  it('두 번 눌러도 실패분 1건만 다시 나가고 step2 는 한 장만 쌓인다', async () => {
    failFor = { 'poi-2': 404 };
    renderPage();
    await screen.findByTestId('trip-wizard-mustvisit-poi-1');
    fillValidDraft();
    fireEvent.press(next());
    await screen.findByTestId('trip-wizard-mustvisit-banner');

    // 준비 — 서버가 회복됐고, 여기서부터 나가는 요청만 센다.
    failFor = {};
    mustVisitBodies = [];

    // 실행 — 연달아 두 번 누른다. 첫 호출은 이미 네트워크를 기다리는 중이라 창이 저절로
    // 열려 있다(여기서는 붙잡는 장치가 필요 없다 — 02a ★15).
    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-banner-retry'));
    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-banner-retry'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    // 두 번째 물결이 나갈 틈을 준 뒤에 센다.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // 단언 ① — 실패분 한 건만 다시 나갔다.
    expect(poiIdsSent()).toEqual(['poi-2']);
    // 단언 ② — 재시도는 여행을 다시 만들지 않는다(★3 축, I-6 과 같은 급소).
    expect(createHits()).toBe(1);
    // 단언 ③ — 화면 이동이 두 번 실행되면 step2 가 두 장 쌓여, 사용자가 뒤로 가기를 눌렀을 때
    //          step1 이 아니라 step2 가 또 나온다(03b N-1).
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
