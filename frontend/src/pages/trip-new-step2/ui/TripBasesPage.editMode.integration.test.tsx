import type { ReactElement } from 'react';
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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { getGetTripsTripIdBasesQueryKey } from '@/shared/api/generated/trips/trips';
import type {
  AssignBaseRequest,
  BaseAssignment,
  SavedStay,
  Trip,
  TripStatus,
} from '@/shared/api/generated/schemas';
import { resetPressGuard } from '@/shared/press/pressGuard';

import { TripBasesPage } from './TripBasesPage';

/**
 * TRIP-1082 — l04 '출발점 변경'으로 여는 **거점 편집 모드**(`/trips/[tripId]/bases?mode=edit`)의 행위.
 *
 * 무엇을 보장하나 — 실제로 나간 요청과 라우터 호출로 잰다(msw + 실물 조회·지정 훅):
 *  - AC-6 거점이 **실제로** 안 바뀌었으면(아무것도 안 함 · 같은 숙소 재선택 · A→B→A) [완료]는 묻지 않고
 *    떠난다: 뒤로 갈 곳이 있으면 `back()`, 없으면(딥링크) l04 로 `replace('/my/stays')`.
 *  - AC-7 바뀌었고 다시 만들 일정이 있는 여행(PLANNED/CONFIRMED · 일정 > 0)이면 묻는 다이얼로그가 뜨고,
 *    아직 어디로도 가지 않는다(BR-U6-21 "묻는다").
 *  - AC-8 [그대로 두기]는 떠나기만 한다 · AC-9 [일정 다시 만들기]는 생성 화면(h09)으로 `replace` 한 번 —
 *    **이 화면은 일정 POST 를 쏘지 않는다**(POST 는 h09 소관, BR-U6-21 "조용히 재생성 금지").
 *  - AC-10 진행 중·종료 여행, 일정 0일 여행은 재생성 선택지 없이 떠난다(서버가 409 로 거절하는 조합, Q4).
 *  - AC-11 부분 실패(지우기만 성공)로 밤이 비어도 '변경'이다 — 서버 상태 변화를 조용히 넘기지 않는다(INV-4).
 *  - Q6 헤더 ‹ 도 [완료]와 같은 판정을 탄다.
 *  - 01b 스냅샷 — 들어오기 전 캐시(l04 가 채운 값)가 아니라 **들어와서 처음 받은 서버 값**이 비교 기준이다.
 *  - AC-13 mode 없이 열면 위저드 얼굴 그대로다(기존 `TripBasesPage.integration.test.tsx` 무수정 green 과 짝).
 *
 * 가짜 서버는 **상태를 기억한다**(형제 `TripBasesPage.integration.test.tsx` 복제) — DELETE 는 지우고 POST 는
 * 더한다. 그래서 "A→B→A 뒤 행은 두 개로 갈렸지만 밤의 숙소는 같다"가 서버 흉내의 결과로 재진다.
 *
 * 일정 POST(`POST /trips/T/itinerary`)는 **핸들러 없이** 발사 기록(`request:start`)으로만 센다 — 응답 모양을
 * 발명하지 않는다. 쏘는 것 자체가 위반이다.
 *
 * jest 사각(→ 6-b): 다이얼로그의 실제 덮임·중앙 정렬, 시트가 [완료]를 덮는지, 실제 스택의 back 목적지,
 * iOS 스와이프·Android 하드웨어 뒤로(묻지 않고 나감 = 암묵적 [그대로 두기]).
 *
 * ⚠️ `jest.mock` 팩토리가 참조하는 바깥 변수는 이름이 `mock` 으로 시작해야 한다(리포 확립 규칙).
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
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
  router: {
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  },
}));

jest.mock('@/features/trip/model/useStayAddresses', () => ({
  useStayAddresses: () => ({}),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_T = 'trip-t';

const GENERATING_ROUTE = {
  pathname: '/trips/[tripId]/itinerary/generating',
  params: { tripId: TRIP_T, mode: 'FULLY_AI' },
};

function stay(savedStayId: string, name: string): SavedStay {
  return {
    savedStayId,
    name,
    coordConfirmed: true,
    linkedTripIds: [],
    checkIn: null,
    checkOut: null,
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

// 두 이름은 서로의 부분 문자열이 아니다 — 카드 텍스트 부분 일치(정규식)가 서로를 잡지 않게.
const STAY_A = stay('stay-a', '롯데호텔 서울');
const STAY_B = stay('stay-b', '메리어트 동대문');

/** 서울특별시 2박(9/26·9/27) 여행. 기본은 확정 + 일정 2일 — "다시 만들 일정이 있는" 여행. */
function trip(status: TripStatus = 'CONFIRMED', itineraryDayCount = 2): Trip {
  return {
    tripId: TRIP_T,
    title: '서울 여행',
    startDate: '2026-09-26',
    endDate: '2026-09-28',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '서울특별시', nights: 2 }],
    status,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    baseCount: 1,
    itineraryDayCount,
  };
}

function assignment(
  baseAssignmentId: string,
  savedStayId: string,
  dateFrom: string,
  dateTo: string
): BaseAssignment {
  return { baseAssignmentId, savedStayId, dateFrom, dateTo };
}

/** 기본 배정 — A 가 두 밤을 **한 행**으로 덮는다(★5: A→B→A 뒤 두 행으로 갈려야 판별력이 생긴다). */
const A_BOTH_NIGHTS = [assignment('a', 'stay-a', '2026-09-26', '2026-09-28')];

// ── 상태를 기억하는 가짜 서버 ───────────────────────────────────────────────

let serverBases: BaseAssignment[] = [];
let serverTrip: Trip = trip();
let savedStays: SavedStay[] = [];
/** 나간 요청 `METHOD /경로`(발사 순서) — 핸들러 없는 요청도 기록된다. */
let hits: string[] = [];
/** 서버가 처리를 끝낸 순서. */
let handled: string[] = [];
let postBodies: AssignBaseRequest[] = [];
/** n 번째 bases POST(1부터)를 500 으로 — 부분 실패 재현. */
let failPostAt: number | null = null;
let postSeq = 0;

function hitCount(needle: string): number {
  return hits.filter((hit) => hit === needle).length;
}

const BASES_POST_HIT = `POST /api/v1/trips/${TRIP_T}/bases`;
const ITINERARY_POST_HIT = `POST /api/v1/trips/${TRIP_T}/itinerary`;

function useFakeServer(): void {
  server.use(
    http.get(`${BASE}/trips/:tripId`, ({ params }) => {
      if (params.tripId !== TRIP_T)
        return new HttpResponse(null, { status: 404 });
      return HttpResponse.json(serverTrip);
    }),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json(savedStays)),
    http.get(`${BASE}/trips/:tripId/bases`, ({ params }) => {
      if (params.tripId !== TRIP_T)
        return new HttpResponse(null, { status: 404 });
      return HttpResponse.json(serverBases);
    }),
    http.delete(
      `${BASE}/trips/:tripId/bases/:baseAssignmentId`,
      async ({ params }) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        const id = String(params.baseAssignmentId);
        const exists = serverBases.some((row) => row.baseAssignmentId === id);
        if (params.tripId !== TRIP_T || !exists) {
          return new HttpResponse(null, { status: 404 });
        }
        serverBases = serverBases.filter((row) => row.baseAssignmentId !== id);
        handled.push(`DELETE ${id}`);
        return new HttpResponse(null, { status: 204 });
      }
    ),
    http.post(`${BASE}/trips/:tripId/bases`, async ({ params, request }) => {
      const body = (await request.json()) as AssignBaseRequest;
      postBodies.push(body);
      handled.push(`POST ${body.savedStayId} ${body.dateFrom}`);
      if (params.tripId !== TRIP_T)
        return new HttpResponse(null, { status: 404 });
      if (failPostAt !== null && postBodies.length === failPostAt) {
        return new HttpResponse(null, { status: 500 });
      }
      postSeq += 1;
      const created = { baseAssignmentId: `new-${postSeq}`, ...body };
      serverBases = [...serverBases, created];
      return HttpResponse.json(created, { status: 201 });
    })
  );
}

// 교체 왕복이 여럿이라 CI 러너에서 5s 기본 제한을 넘는다(형제 파일 PR #766 실측).
jest.setTimeout(60000);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    hits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

/** 연타 가드 판정용으로 멈춰 둘 시각 — 흐르지 않는 것이 요점(★7). */
const FROZEN_NOW = 1_790_000_000_000;

let client: QueryClient;
let clock: jest.SpyInstance;

// 모듈 싱글턴(연타 가드 창)·가짜 서버 상태는 파일 최상위에서 매번 되돌린다(앞 테스트 누수 차단).
beforeEach(() => {
  resetPressGuard();
  // 시계를 멈춘다 — 지정 성공이 여는 400ms 창 안에서 [완료]를 누르게 된다. [완료]를 연타 가드로 감싸면
  // 그 누름이 삼켜져 결정론적으로 red(TRIP-1013 AC-S: 여행 단위 출구는 가드 밖).
  clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  serverBases = [...A_BOTH_NIGHTS];
  serverTrip = trip();
  savedStays = [STAY_A, STAY_B];
  hits = [];
  handled = [];
  postBodies = [];
  failPostAt = null;
  postSeq = 0;
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockReset();
  mockCanGoBack.mockReturnValue(true);
  setAccessToken('valid-access');
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  useFakeServer();
});

afterEach(() => {
  clock.mockRestore();
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

const NETWORK_WAIT = { timeout: 15000 };

function editPage(): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <TripBasesPage tripId={TRIP_T} mode="edit" />
    </QueryClientProvider>
  );
}

/** 편집 화면을 그리고 1박 카드가 서버 값(A)으로 뜰 때까지 기다린다 — 이때 스냅샷이 확정된다. */
async function renderEdit(): Promise<void> {
  render(editPage());
  await waitFor(
    () =>
      expect(screen.getByTestId('trip-base-night-card-1')).toHaveTextContent(
        /롯데호텔 서울/
      ),
    NETWORK_WAIT
  );
}

function assignNight(nightNumber: number, savedStayId: string): void {
  fireEvent.press(screen.getByTestId(`trip-base-night-card-${nightNumber}`));
  fireEvent.press(
    screen.getByTestId(`trip-base-staysheet-cand-${savedStayId}`)
  );
  fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
}

async function sheetClosed(): Promise<void> {
  await waitFor(
    () => expect(screen.queryByTestId('trip-base-staysheet')).toBeNull(),
    NETWORK_WAIT
  );
}

/** 1박 카드가 그 숙소 이름을 보일 때까지(재조회 끝) 기다린다. */
async function night1Shows(name: RegExp): Promise<void> {
  await waitFor(
    () =>
      expect(screen.getByTestId('trip-base-night-card-1')).toHaveTextContent(
        name
      ),
    NETWORK_WAIT
  );
}

/** 1박을 B 로 바꾸고 재조회가 끝나 카드가 B 가 될 때까지. */
async function changeNight1ToB(): Promise<void> {
  assignNight(1, 'stay-b');
  await sheetClosed();
  await night1Shows(/메리어트 동대문/);
}

/** 요청이 나갈 틈을 준다 — "0건" 단언이 "아직 안 나갔을 뿐"으로 공짜 통과하지 않게. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

function pressDone(): void {
  fireEvent.press(screen.getByTestId('trip-base-edit-done'));
}

function routerCalls(): number {
  return (
    mockPush.mock.calls.length +
    mockBack.mock.calls.length +
    mockReplace.mock.calls.length
  );
}

// ── AC-3·4 (페이지 관통) ──────────────────────────────────────────────────────

describe('AC-3·4 · 편집 모드로 열면 편집 얼굴이다 (페이지 → 배선 → 화면)', () => {
  it('[완료]가 있고 진행바·생성 CTA 는 없다', async () => {
    await renderEdit();

    expect(screen.getByTestId('trip-base-edit-done')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-base-generate')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-progress-seg-1')).toBeNull();
  });
});

// ── AC-6 ─────────────────────────────────────────────────────────────────────

describe('AC-6 · 거점이 실제로 안 바뀌었으면 묻지 않고 떠난다', () => {
  it('아무것도 안 하고 [완료] — 다이얼로그 없이 back() 1회, 일정 POST 0', async () => {
    await renderEdit();

    pressDone();
    await settle();

    expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
  });

  it('같은 숙소(A)를 다시 지정하고 [완료] — 요청 0건이라도 성공은 불린다, 그래도 묻지 않는다', async () => {
    await renderEdit();

    assignNight(1, 'stay-a');
    await sheetClosed();
    await settle();
    // 앵커 — 지정 요청은 정말 0건이었다(같은 숙소 재선택).
    expect(hitCount(BASES_POST_HIT)).toBe(0);

    pressDone();
    await settle();

    expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
  });

  it('A → B → A 로 되돌리고 [완료] — 행은 갈렸지만 밤의 숙소가 같아 묻지 않는다', async () => {
    await renderEdit();

    await changeNight1ToB();
    // 시계가 멈춰 있어 방금 지정이 연 400ms 창이 닫히지 않는다 — 시트 [지정]은 연타 가드를 타므로(#038)
    // "사용자가 잠시 뒤 다시 지정한다"를 창 닫기로 만든다(★7). [완료]는 그 뒤 지정이 다시 연 창 안에서 누른다.
    resetPressGuard();
    assignNight(1, 'stay-a');
    await sheetClosed();
    await night1Shows(/롯데호텔 서울/);
    // 앵커 — 실제로 두 번 교체됐다(원래 행 a 와 B 행이 지워졌다). 행 id·행 수로 비교하면 여기서 묻는다.
    expect(handled.filter((line) => line.startsWith('DELETE'))).toHaveLength(2);

    pressDone();
    await settle();

    expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
  });

  it('뒤로 갈 곳이 없으면(딥링크) l04 로 replace("/my/stays") — back 없음', async () => {
    mockCanGoBack.mockReturnValue(false);
    await renderEdit();

    pressDone();

    expect(mockReplace.mock.calls).toEqual([['/my/stays']]);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('들어오기 전 캐시(l04 가 채운 옛 값 B)가 서버(A)와 달라도, 아무것도 안 했으면 묻지 않는다 — 기준은 들어와서 받은 서버 값', async () => {
    // 준비 — l04 의 TripBasesProbe 가 같은 키를 채워 둔 상황. gcTime 0 이라 같은 틱에 렌더해 관찰자를 붙인다(★9).
    client.setQueryData(getGetTripsTripIdBasesQueryKey(TRIP_T), [
      assignment('old', 'stay-b', '2026-09-26', '2026-09-28'),
    ]);
    render(editPage());
    // 재조회가 끝나 카드가 서버 값(A)이 됐다 = 스냅샷 확정.
    await night1Shows(/롯데호텔 서울/);

    pressDone();
    await settle();

    expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

// ── AC-7 · AC-5 ──────────────────────────────────────────────────────────────

describe('AC-7 · 바뀌었고 다시 만들 일정이 있으면 묻는다 (BR-U6-21)', () => {
  it.each(['PLANNED', 'CONFIRMED'] as const)(
    '%s 여행에서 1박을 B 로 바꾸고 [완료] — 다이얼로그가 뜨고 아직 아무 데도 안 간다, 일정 POST 0',
    async (status) => {
      serverTrip = trip(status, 2);
      await renderEdit();

      await changeNight1ToB();
      // AC-5 앵커 — 편집 모드에서도 지정은 교체다(지우기가 먼저 끝난다).
      expect(handled[0]).toBe('DELETE a');

      pressDone();
      await settle();

      expect(screen.getByTestId('trip-base-regen-dialog')).toBeOnTheScreen();
      expect(routerCalls()).toBe(0);
      expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
    }
  );
});

// ── AC-8 ─────────────────────────────────────────────────────────────────────

describe('AC-8 · [그대로 두기]는 떠나기만 한다', () => {
  it('뒤로 갈 곳이 있으면 back() 1회 — 일정 POST 0', async () => {
    await renderEdit();
    await changeNight1ToB();
    pressDone();
    await screen.findByTestId('trip-base-regen-dialog', {}, NETWORK_WAIT);

    fireEvent.press(screen.getByTestId('trip-base-regen-keep'));
    await settle();

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
  });

  it('뒤로 갈 곳이 없으면 replace("/my/stays") — 일정 POST 0', async () => {
    mockCanGoBack.mockReturnValue(false);
    await renderEdit();
    await changeNight1ToB();
    pressDone();
    await screen.findByTestId('trip-base-regen-dialog', {}, NETWORK_WAIT);

    fireEvent.press(screen.getByTestId('trip-base-regen-keep'));
    await settle();

    expect(mockReplace.mock.calls).toEqual([['/my/stays']]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
  });
});

// ── AC-9 ─────────────────────────────────────────────────────────────────────

describe('AC-9 · [일정 다시 만들기]는 생성 화면(h09)으로 넘긴다 — 이 화면은 POST 를 쏘지 않는다', () => {
  it('generating 으로 { tripId, mode: FULLY_AI } replace 1회 · back·push 없음 · 일정 POST 0', async () => {
    await renderEdit();
    await changeNight1ToB();
    pressDone();
    await screen.findByTestId('trip-base-regen-dialog', {}, NETWORK_WAIT);

    fireEvent.press(screen.getByTestId('trip-base-regen-confirm'));
    await settle();

    expect(mockReplace.mock.calls).toEqual([[GENERATING_ROUTE]]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
  });
});

// ── AC-10 (Q4) ───────────────────────────────────────────────────────────────

describe('AC-10 · 다시 만들 수 없는 여행은 묻지 않고 떠난다 (Q4)', () => {
  it.each(['ACTIVE', 'ENDED'] as const)(
    '%s 여행에서 바꾸고 [완료] — 재생성 선택지 없이 back() 1회, 일정 POST 0',
    async (status) => {
      serverTrip = trip(status, 2);
      await renderEdit();
      await changeNight1ToB();

      pressDone();
      await settle();

      expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
      expect(screen.queryByTestId('trip-base-regen-confirm')).toBeNull();
      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(hitCount(ITINERARY_POST_HIT)).toBe(0);
    }
  );

  it('일정이 아직 없는 여행(itineraryDayCount 0)은 바꿔도 묻지 않는다', async () => {
    serverTrip = trip('PLANNED', 0);
    await renderEdit();
    await changeNight1ToB();

    pressDone();
    await settle();

    expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

// ── AC-11 ────────────────────────────────────────────────────────────────────

describe('AC-11 · 부분 실패로 밤이 비어도 "바뀐 것"이다 (INV-4)', () => {
  it('지우기는 성공·붙이기는 실패 → 1박이 "숙소 미정"이 된 뒤 [완료] — 묻는다', async () => {
    // 1박짜리 A 한 행 — B 지정은 DELETE a1 → POST B(실패) 로 끝나 서버의 1박이 빈다(★10).
    serverBases = [assignment('a1', 'stay-a', '2026-09-26', '2026-09-27')];
    failPostAt = 1;
    await renderEdit();

    assignNight(1, 'stay-b');
    await screen.findByTestId('trip-base-staysheet-error', {}, NETWORK_WAIT);
    await night1Shows(/숙소 미정/);

    pressDone();
    await settle();

    expect(screen.getByTestId('trip-base-regen-dialog')).toBeOnTheScreen();
    expect(routerCalls()).toBe(0);
  });
});

// ── Q6 ───────────────────────────────────────────────────────────────────────

describe('Q6 · 헤더 ‹ 도 [완료]와 같은 판정을 탄다', () => {
  it('바꾼 뒤 ‹ — 다이얼로그가 뜨고 아직 떠나지 않는다', async () => {
    await renderEdit();
    await changeNight1ToB();

    fireEvent.press(screen.getByTestId('trip-base-back'));
    await settle();

    expect(screen.getByTestId('trip-base-regen-dialog')).toBeOnTheScreen();
    expect(routerCalls()).toBe(0);
  });

  it('안 바꾸고 ‹ — 다이얼로그 없이 back() 1회', async () => {
    await renderEdit();

    fireEvent.press(screen.getByTestId('trip-base-back'));
    await settle();

    expect(screen.queryByTestId('trip-base-regen-dialog')).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

// ── AC-13 ────────────────────────────────────────────────────────────────────

describe('AC-13 · mode 없이 열면(h04 입구) 위저드 얼굴 그대로다', () => {
  it('진행바·생성 CTA·숙소 없이 시작하기가 있고 편집 [완료]는 없다', async () => {
    render(
      <QueryClientProvider client={client}>
        <TripBasesPage tripId={TRIP_T} />
      </QueryClientProvider>
    );
    await screen.findByTestId('trip-base-night-card-1', {}, NETWORK_WAIT);

    expect(screen.getByTestId('trip-wizard-progress-seg-1')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-generate')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-nostay-start')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-base-edit-done')).toBeNull();
  });
});
