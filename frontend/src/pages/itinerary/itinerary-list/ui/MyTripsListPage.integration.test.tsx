import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
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

import { DRAFT_POLL_INTERVAL_MS } from '@/features/itinerary';
import { server } from '@/mocks/server';
import {
  getGetTripsQueryKey,
  getGetTripsTripIdItineraryQueryKey,
} from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Itinerary, Trip } from '@/shared/api/index.schemas';
import { MyTripsListPage } from '@/pages/itinerary/itinerary-list';

/**
 * TRIP-1055 · 작성중 여행 삭제 — ⋯ → '삭제' → 확인 다이얼로그 → `DELETE /trips/{tripId}` 흐름을 실제로
 * 나간 요청으로 잰다(US-TRIP-10 · BR-U1-57 · BR-U1-42 · INV-4).
 *
 * 무엇을 보장하나:
 *  - 확인 전에는 어떤 경로(⋯·메뉴 항목·취소)로도 DELETE 가 나가지 않는다.
 *  - 확인하면 그 여행의 DELETE 가 정확히 1번 나가고, 목록(`GET /trips` — 홈·기록·내 숙소가 같은 키로
 *    구독)을 다시 받아 카드가 사라진다. 연타해도 두 번째 DELETE 는 없다.
 *  - 500·네트워크 실패면 다이얼로그 안에 실패 문구를 띄우고 카드를 남기며, 다시 누를 수 있다(INV-4).
 *  - 404 는 "이미 없다"로 보고 목록만 다시 받는다(01b Q5 — 실패 문구 없음).
 *  - 완료 배너 여행(확정)에는 ⋯ 가 없다 — 그래서 "배너 여행을 지운다"(AC-9)가 화면에서 생기지 않는다.
 *  - 다이얼로그는 카드·목록 스크롤 밖에서 그려지고 Figma 4682:3206 토큰을 쓴다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청의 수와 경로"다(msw 만 관찰 가능). 훅 목 대신 실제
 * react-query 가 돈다 — 연타 판정은 `isPending` 이 늦게 알려지는 실물 거동에서만 의미가 있다(02a ★2).
 *
 * "0번" 단언은 전부 `settle()` 뒤다. I3 이 같은 `settle()` 한 번 뒤 DELETE 1번을 바로 단언해 "settle 이면
 * 요청이 나갈 시간은 충분하다"를 이 파일 안에서 증명한다(02a ★1).
 *
 * TRIP-1271 · 맨 아래 두 describe — 생성 중 여행 폴링·탭 복귀 재조회(가짜 타이머)와 생성 중 카드 삭제. 탭 복귀는
 * `expo-router` 목의 `useFocusEffect` 를 테스트가 `refocus()` 로 다시 부르는 것으로 흉내 낸다.
 *
 * ⚠️ 딤이 화면 전체를 실제로 덮는지·가운데 오는지·뒤 터치를 막는지는 jest 사각(repo-traps 오버레이 절) — 6-b.
 */

const mockPush = jest.fn();
/**
 * TRIP-1271 · 포커스 목의 레지스트리 — 지금 등록된 포커스 콜백과 그 정리 함수. 페이지가 useFocusEffect 를 둘
 * 부르므로(TRIP-1286 완료 배너 · TRIP-1271 탭 복귀 재조회) 콜백마다 한 칸씩 든다. 모듈 싱글턴이라 파일 최상위
 * afterEach 에서 비운다.
 */
const mockFocus = new Map<() => void | (() => void), void | (() => void)>();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({
      push: mockPush,
      replace: jest.fn(),
      navigate: jest.fn(),
    }),
    useNavigation: () => ({ setOptions: jest.fn() }),
    // TRIP-1271 — 실물(expo-router 6 build/useFocusEffect.js)처럼 포커스 상태로 마운트되면 즉시, 콜백이
    // 바뀌면 정리 후 다시 부른다. 탭 복귀는 테스트의 refocus() 가 흉내 낸다.
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        mockFocus.set(effect, effect());
        return () => {
          const cleanup = mockFocus.get(effect);
          mockFocus.delete(effect);
          if (typeof cleanup === 'function') cleanup();
        };
      }, [effect]);
    },
  };
});

// 생성 클라이언트의 인증 계층이 @/shared/storage 를 정적으로 문다(expo-secure-store 실물 로드 회피,
// useCreateTrip.integration.test.tsx 와 같은 목).
// TRIP-1157: 배럴이 idSet·stringValue·installId 도 재수출한다 — 통째로 갈아끼우면 그 함수들이 지워지므로 실물을 펼친 뒤 토큰 함수만 덮는다.
jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// 완료 배너가 읽는 "알린 여행" 저장소 — 비어 있다(확정 여행 B 가 배너로 뜬다).
jest.mock('@/shared/storage/idSet', () => ({
  readIdSet: jest.fn().mockResolvedValue([]),
  writeIdSet: jest.fn().mockResolvedValue(undefined),
}));

const BASE = 'http://localhost:8080/api/v1';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function trip(tripId: string, title: string, updatedAt: string): Trip {
  return {
    tripId,
    title,
    startDate: '2099-06-10',
    endDate: '2099-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt,
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

/** A = 작성중(일정 없음 → 404) · B = 확정. A 가 더 최근이라 목록 맨 위. */
const TRIP_A = trip(A, '부산 여행', '2026-09-02T00:00:00Z');
const TRIP_B = trip(B, '제주 여행', '2026-09-01T00:00:00Z');
/** C = 작성중(일정 없음). 셋 중 가장 오래돼 목록 맨 아래 — "첫 카드가 아닌" 삭제 대상(5-b 경고-1·4). */
const TRIP_C = trip(C, '강릉 여행', '2026-08-31T00:00:00Z');

const CONFIRMED_B: Itinerary = {
  itineraryId: 'itin-b',
  tripId: B,
  status: 'CONFIRMED',
  solveMode: 'FULL_AI',
  generationMode: 'FULLY_AI',
  isFallback: false,
  generationState: 'COMPLETE',
  generationSessionId: null,
  days: [{ date: '2099-06-10', slots: [] }],
};

const TITLE = '이 여행을 삭제할까요?';
const BODY = '작성 중인 일정도 함께 지워지고 되돌릴 수 없어요.';
const ERROR_TEXT = '삭제하지 못했어요. 다시 시도해 주세요.';

/** 서버가 지금 가진 여행 — DELETE 가 204/404 면 여기서 빠진다(목록 재요청이 그걸 본다). */
let serverTrips: Trip[] = [];
/** 나간 요청 `METHOD /경로` 누적. */
let hits: string[] = [];
/** 돌아온 응답 `METHOD /경로 상태` 누적 — "앞 요청의 응답이 이미 왔다"를 기다리는 앵커(5-b 경고-4). */
let responses: string[] = [];

type DeleteMode = 204 | 404 | 500 | 'network' | 'gate';
let deleteMode: DeleteMode = 204;
/**
 * 'gate' 모드 — 테스트가 열 때까지 DELETE 응답을 붙잡는다. 붙잡힌 요청마다 문 하나씩 모은다: 두 번째
 * 요청이 첫 문을 덮어쓰면 첫 요청은 영영 못 연다(5-b 경고-3).
 */
let gates: (() => void)[] = [];
/** 문이 열린 뒤 붙잡혔던 DELETE 가 받을 응답. */
let gateThen: 204 | 500 = 204;

/** 붙잡힌 DELETE 를 전부 풀어 준다. */
function openGates(): void {
  const waiting = gates;
  gates = [];
  waiting.forEach((open) => open());
}

function count(needle: string): number {
  return hits.filter((hit) => hit === needle).length;
}
const deletes = () => hits.filter((hit) => hit.startsWith('DELETE '));

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    hits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  server.events.on('response:mocked', ({ request, response }) => {
    responses.push(
      `${request.method} ${new URL(request.url).pathname} ${response.status}`
    );
  });
});

beforeEach(() => {
  hits = [];
  responses = [];
  serverTrips = [TRIP_A, TRIP_B];
  deleteMode = 204;
  gateThen = 204;
  mockPush.mockClear();
  clearAccessToken();
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips`, () => HttpResponse.json(serverTrips)),
    http.get(`${BASE}/trips/:tripId/itinerary`, ({ params }) =>
      params.tripId === B
        ? HttpResponse.json(CONFIRMED_B)
        : HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: '일정이 없어요' } },
            { status: 404 }
          )
    ),
    http.delete(`${BASE}/trips/:tripId`, async ({ params }) => {
      const removeIt = () => {
        serverTrips = serverTrips.filter((t) => t.tripId !== params.tripId);
      };
      if (deleteMode === 'network') return HttpResponse.error();
      if (deleteMode === 500) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL', message: '서버 오류' } },
          { status: 500 }
        );
      }
      if (deleteMode === 404) {
        // 다른 기기에서 이미 지웠다 — 서버 목록에도 없다(02a ★8).
        removeIt();
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: '없음' } },
          { status: 404 }
        );
      }
      if (deleteMode === 'gate') {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
        if (gateThen === 500) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: '서버 오류' } },
            { status: 500 }
          );
        }
      }
      removeIt();
      return new HttpResponse(null, { status: 204 });
    })
  );
});

afterEach(() => {
  // 단언이 문을 열기 전에 실패해도 붙잡힌 요청을 남기지 않는다 — 안 풀면 jest 가 red 대신 멈춘다(5-b 경고-3).
  openGates();
  server.resetHandlers();
  // TRIP-1271 — 폴링 describe 의 가짜 시계와 포커스 레지스트리가 아래 실타이머 케이스로 새지 않게.
  jest.useRealTimers();
  mockFocus.clear();
});

afterAll(() => server.close());

/** `cached` — 다른 탭(홈)이 이미 받아 둔 여행 목록·여행별 일정을 캐시에 넣고 시작한다(TRIP-1271 AC-5a). */
function renderPage(cached?: {
  trips: Trip[];
  itineraries: Record<string, Itinerary>;
}) {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime 0 — 타이머가 테스트 뒤까지 살아 프로세스를 붙잡지 않게(mutations 도, useCreateTrip 선례).
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  if (cached) {
    client.setQueryData(getGetTripsQueryKey(), cached.trips);
    Object.entries(cached.itineraries).forEach(([tripId, data]) =>
      client.setQueryData(getGetTripsTripIdItineraryQueryKey(tripId), data)
    );
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<MyTripsListPage />, { wrapper: Wrapper });
}

/** 요청이 출발할 시간을 준다(02a §5-C 실측 — 30ms 한 번이면 DELETE 가 이미 잡힌다). */
async function settle(): Promise<void> {
  await act(() => new Promise((r) => setTimeout(r, 30)));
}

/** className 을 토큰 배열로(부분 문자열 오탐 방지). */
function tokens(el: ReactTestInstance): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

/** 그 카드의 ⋯ → '삭제' 까지 눌러 다이얼로그를 연다. */
async function openDialogFor(tripId: string): Promise<ReactTestInstance> {
  fireEvent.press(await screen.findByTestId(`my-trip-menu-${tripId}`));
  fireEvent.press(screen.getByTestId(`my-trip-menu-delete-${tripId}`));
  return screen.getByTestId('my-trip-delete-dialog');
}

/** 카드 A 의 ⋯ → '삭제' 까지 눌러 다이얼로그를 연다. */
function openDialogForA(): Promise<ReactTestInstance> {
  return openDialogFor(A);
}

describe('🔴 TRIP-1055 AC-2·3 · 확인 전에는 아무것도 지우지 않는다', () => {
  it('⋯ 와 "삭제" 항목을 눌러도 DELETE 0번 · 화면 이동 0번, 다이얼로그가 제목·본문과 함께 뜬다', async () => {
    // 준비 — 목록이 뜨고 A 카드의 ⋯ 가 보인다.
    renderPage();
    const dots = await screen.findByTestId(`my-trip-menu-${A}`);

    // 실행 ① — ⋯ 를 누른다.
    fireEvent.press(dots);
    await settle();

    // 단언 ① — 메뉴만 열렸다.
    expect(screen.getByTestId(`my-trip-menu-delete-${A}`)).toBeOnTheScreen();
    expect(deletes()).toEqual([]);
    expect(mockPush).not.toHaveBeenCalled();

    // 실행 ② — 메뉴의 '삭제' 를 누른다.
    fireEvent.press(screen.getByTestId(`my-trip-menu-delete-${A}`));
    await settle();

    // 단언 ② — 다이얼로그가 떴고 메뉴는 닫혔다. 여전히 DELETE 0번.
    const dialog = screen.getByTestId('my-trip-delete-dialog');
    expect(within(dialog).getByText(TITLE)).toBeOnTheScreen();
    expect(within(dialog).getByText(BODY)).toBeOnTheScreen();
    expect(screen.queryByTestId(`my-trip-menu-delete-${A}`)).toBeNull();
    expect(deletes()).toEqual([]);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1055 AC-4 · 취소', () => {
  it('취소하면 다이얼로그가 닫히고 DELETE 0번, 카드는 남는다', async () => {
    // 준비
    renderPage();
    await openDialogForA();

    // 실행
    fireEvent.press(screen.getByTestId('my-trip-delete-cancel'));
    await settle();

    // 단언
    expect(screen.queryByTestId('my-trip-delete-dialog')).toBeNull();
    expect(deletes()).toEqual([]);
    expect(screen.getByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1055 AC-5·8 · 확인하면 그 여행만 지우고 목록을 다시 받는다', () => {
  it('DELETE /trips/{A} 1번 → GET /trips 재요청 → A 카드·다이얼로그가 사라지고 B 는 남는다', async () => {
    // 준비 — 목록 1번 받은 상태에서 A 의 다이얼로그를 연다.
    renderPage();
    await openDialogForA();
    expect(count('GET /api/v1/trips')).toBe(1);

    // 실행 — 확인.
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
    await settle();

    // 단언 ① — settle 한 번 뒤 바로: A 의 DELETE 가 정확히 1번(이 줄이 ★1 의 증명이다).
    expect(deletes()).toEqual([`DELETE /api/v1/trips/${A}`]);

    // 단언 ② — 목록을 다시 받아 A 가 사라진다(홈이 구독하는 같은 키가 무효화됐다는 관찰).
    await waitFor(() =>
      expect(screen.queryByTestId(`my-trip-card-${A}`)).toBeNull()
    );
    expect(screen.queryByTestId('my-trip-delete-dialog')).toBeNull();
    expect(count('GET /api/v1/trips')).toBe(2);
    expect(screen.getByTestId(`my-trip-card-${B}`)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1055 AC-5 · 누른 카드의 여행을 지운다 — 맨 위 카드가 아니어도 (5-b 경고-1)', () => {
  it('지울 수 있는 카드가 A(맨 위)·C(맨 아래) 둘일 때 C 를 지우면 DELETE /trips/{C} 1번, A 는 남는다', async () => {
    // 준비 — 작성중 카드 둘. C 가 맨 위가 아니고 A 에도 ⋯ 가 있음을 먼저 확인한다(앵커).
    serverTrips = [TRIP_A, TRIP_B, TRIP_C];
    renderPage();
    await screen.findByTestId(`my-trip-menu-${C}`);
    expect(
      screen.getAllByTestId(/^my-trip-card-/).map((card) => card.props.testID)
    ).toEqual([`my-trip-card-${A}`, `my-trip-card-${B}`, `my-trip-card-${C}`]);
    expect(screen.getByTestId(`my-trip-menu-${A}`)).toBeOnTheScreen();

    // 실행 — C 의 ⋯ → 삭제 → 확인.
    await openDialogFor(C);
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
    await settle();

    // 단언 — C 의 DELETE 한 줄뿐, C 카드만 사라지고 A 는 남는다.
    expect(deletes()).toEqual([`DELETE /api/v1/trips/${C}`]);
    await waitFor(() =>
      expect(screen.queryByTestId(`my-trip-card-${C}`)).toBeNull()
    );
    expect(screen.getByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1055 AC-6 · 연타해도 두 번째 DELETE 는 없다', () => {
  it('응답이 오기 전에 확인을 두 번 눌러도 DELETE 는 1번이다', async () => {
    // 준비 — DELETE 응답을 문 뒤에 붙잡아 "진행 중" 을 만든다.
    deleteMode = 'gate';
    renderPage();
    await openDialogForA();

    // 실행 — 같은 틱에 두 번 누른다(isPending 이 아직 알려지기 전, 02a ★2).
    const confirm = screen.getByTestId('my-trip-delete-confirm');
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    await settle();

    // 단언 ① — 진행 중에 나간 DELETE 는 1번.
    expect(deletes()).toHaveLength(1);

    // 실행 — 문을 열어 응답을 보낸다.
    await act(async () => {
      openGates();
    });

    // 단언 ② — 끝난 뒤에도 1번(늦게 출발한 두 번째 요청이 없다).
    await waitFor(() =>
      expect(screen.queryByTestId(`my-trip-card-${A}`)).toBeNull()
    );
    expect(deletes()).toHaveLength(1);
  });
});

describe('🔴 TRIP-1055 AC-6·7 · 대기 중 취소한 요청의 결과는 새 다이얼로그를 건드리지 않는다 (5-b 경고-4)', () => {
  /** A 를 확인해 응답을 붙잡아 둔 채 취소하고, C 의 다이얼로그를 새로 연다. */
  async function cancelAWhilePendingThenOpenC(): Promise<void> {
    serverTrips = [TRIP_A, TRIP_B, TRIP_C];
    deleteMode = 'gate';
    renderPage();
    await openDialogFor(A);
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
    await settle();
    expect(deletes()).toEqual([`DELETE /api/v1/trips/${A}`]);

    // 대기 중에도 취소는 다이얼로그를 닫는다(이 시나리오의 전제).
    fireEvent.press(screen.getByTestId('my-trip-delete-cancel'));
    expect(screen.queryByTestId('my-trip-delete-dialog')).toBeNull();

    await openDialogFor(C);
    expect(screen.queryByTestId('my-trip-delete-error')).toBeNull();
    // 이 뒤로 나가는 DELETE(C)는 바로 204 — 붙잡힌 A 는 문이 열리면 gateThen 을 받는다.
    deleteMode = 204;
  }

  it('앞 요청(A)이 500 이어도 C 의 다이얼로그에 실패 문구가 뜨지 않고, C 를 확인하면 DELETE /trips/{C} 가 나간다', async () => {
    // 준비 — A 는 문이 열리면 500.
    gateThen = 500;
    await cancelAWhilePendingThenOpenC();

    // 실행 ① — A 의 응답을 보내고, 그 응답이 돌아온 뒤까지 기다린다.
    await act(async () => {
      openGates();
    });
    await waitFor(() =>
      expect(responses).toContain(`DELETE /api/v1/trips/${A} 500`)
    );
    await settle();

    // 단언 ① — C 의 다이얼로그는 열린 채, 실패 문구는 없다(C 는 아직 시도조차 안 했다). A 카드는 남는다.
    expect(screen.getByTestId('my-trip-delete-dialog')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-trip-delete-error')).toBeNull();
    expect(screen.getByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();

    // 실행 ② — C 를 확인한다.
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
    await settle();

    // 단언 ② — 이번엔 C 의 DELETE 가 나가고 C 카드가 사라진다.
    expect(deletes()).toEqual([
      `DELETE /api/v1/trips/${A}`,
      `DELETE /api/v1/trips/${C}`,
    ]);
    await waitFor(() =>
      expect(screen.queryByTestId(`my-trip-card-${C}`)).toBeNull()
    );
  });

  it('앞 요청(A)이 성공해도 C 의 다이얼로그는 닫히지 않고, C 를 확인해야 C 가 지워진다', async () => {
    // 준비 — A 는 문이 열리면 204.
    gateThen = 204;
    await cancelAWhilePendingThenOpenC();

    // 실행 ① — A 의 응답을 보내고, 목록에서 A 가 빠질 때까지(= 앞 요청 처리가 끝날 때까지) 기다린다.
    await act(async () => {
      openGates();
    });
    await waitFor(() =>
      expect(screen.queryByTestId(`my-trip-card-${A}`)).toBeNull()
    );

    // 단언 ① — C 의 다이얼로그는 그대로 열려 있고 C 카드도 있다. 나간 DELETE 는 여전히 A 하나.
    expect(screen.getByTestId('my-trip-delete-dialog')).toBeOnTheScreen();
    expect(screen.getByTestId(`my-trip-card-${C}`)).toBeOnTheScreen();
    expect(deletes()).toEqual([`DELETE /api/v1/trips/${A}`]);

    // 실행 ② — C 를 확인한다.
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
    await settle();

    // 단언 ② — C 의 DELETE 가 나가고, C 카드와 다이얼로그가 사라진다.
    expect(deletes()).toEqual([
      `DELETE /api/v1/trips/${A}`,
      `DELETE /api/v1/trips/${C}`,
    ]);
    await waitFor(() =>
      expect(screen.queryByTestId(`my-trip-card-${C}`)).toBeNull()
    );
    expect(screen.queryByTestId('my-trip-delete-dialog')).toBeNull();
  });
});

describe('🔴 TRIP-1055 AC-7 · 실패하면 카드를 남기고 다이얼로그 안에서 알린다 (INV-4)', () => {
  it.each<[string, DeleteMode]>([
    ['서버 오류(500)', 500],
    ['네트워크 실패', 'network'],
  ])(
    '%s → 실패 문구 · 다이얼로그·카드 유지 · 다시 누르면 다시 보낸다',
    async (_label, mode) => {
      // 준비 — DELETE 가 실패한다.
      deleteMode = mode;
      renderPage();
      await openDialogForA();
      expect(screen.queryByTestId('my-trip-delete-error')).toBeNull();

      // 실행 — 확인.
      fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));

      // 단언 ① — 다이얼로그 안에 실패 문구(완전 일치), 다이얼로그·카드는 그대로.
      const error = await screen.findByTestId('my-trip-delete-error');
      expect(error).toHaveTextContent(ERROR_TEXT);
      const dialog = screen.getByTestId('my-trip-delete-dialog');
      expect(within(dialog).getByTestId('my-trip-delete-error')).toBe(error);
      expect(screen.getByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
      expect(deletes()).toHaveLength(1);

      // 실행 ② — "다시 시도해 주세요" 대로 다시 누른다.
      fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
      await settle();

      // 단언 ② — 잠금이 풀려 두 번째 DELETE 가 나갔다(02a ★3).
      expect(deletes()).toHaveLength(2);
    }
  );
});

describe('🔴 TRIP-1055 Q5 · 404 는 "이미 없다" — 목록만 다시 받는다', () => {
  it('DELETE 404 → 실패 문구 없이 다이얼로그가 닫히고, 목록을 다시 받아 A 가 사라진다', async () => {
    // 준비 — 다른 기기에서 이미 지운 여행.
    deleteMode = 404;
    renderPage();
    await openDialogForA();

    // 실행
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));

    // 단언
    // CI 러너는 404 → 무효화 → 재조회 왕복이 기본 1초를 넘길 때가 있다(PR #780 CI 실측) — 한도만 늘린다.
    await waitFor(
      () => expect(screen.queryByTestId('my-trip-delete-dialog')).toBeNull(),
      { timeout: 5000 }
    );
    expect(screen.queryByTestId('my-trip-delete-error')).toBeNull();
    await waitFor(
      () => expect(screen.queryByTestId(`my-trip-card-${A}`)).toBeNull(),
      { timeout: 5000 }
    );
    expect(count('GET /api/v1/trips')).toBe(2);
  });
});

describe('TRIP-1055 AC-9 · 완료 배너 여행에는 ⋯ 가 없다 (도달 불가의 전제 잠금, 02a ★6)', () => {
  it('확정 여행 B 가 배너로 떠 있을 때 B 카드엔 ⋯ 가 없고, 작성중 A 에는 있다', async () => {
    // 준비·실행 — 목록과 배너가 뜰 때까지 기다린다.
    renderPage();
    expect(await screen.findByTestId('generation-done-bar')).toBeOnTheScreen();
    await screen.findByTestId(`my-trip-card-${B}`);

    // 단언 — 배너가 가리키는 여행(B)은 지울 수 없다 → 지운 여행을 배너가 붙잡는 상황이 안 생긴다.
    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      new RegExp(TRIP_B.title)
    );
    expect(screen.queryByTestId(`my-trip-menu-${B}`)).toBeNull();
    expect(await screen.findByTestId(`my-trip-menu-${A}`)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1055 AC-10 · 다이얼로그 구조 (Figma 4682:3206)', () => {
  it('딤·카드·버튼 토큰이 Figma 값이고, 다이얼로그는 카드·목록 스크롤 밖에 있다', async () => {
    // 준비·실행
    renderPage();
    const dialog = await openDialogForA();

    // 단언 — 딤: 화면을 덮는 absolute + 55% 딤.
    expect(tokens(dialog)).toEqual(
      expect.arrayContaining(['absolute', 'inset-0', 'bg-scrim/55'])
    );
    // 단언 — 카드: radius 20 · 흰 바탕.
    expect(tokens(screen.getByTestId('my-trip-delete-dialog-card'))).toEqual(
      expect.arrayContaining(['rounded-[20px]', 'bg-canvas'])
    );
    // 단언 — 버튼: 높이 52 · radius 12, 취소=hairline-strong 테두리 흰 바탕, 삭제=primary.
    const cancel = screen.getByTestId('my-trip-delete-cancel');
    const confirm = screen.getByTestId('my-trip-delete-confirm');
    expect(cancel).toHaveTextContent('취소');
    expect(confirm).toHaveTextContent('삭제');
    const HEIGHT_52 = ['h-[52px]', 'h-13'];
    expect(tokens(cancel).some((x) => HEIGHT_52.includes(x))).toBe(true);
    expect(tokens(confirm).some((x) => HEIGHT_52.includes(x))).toBe(true);
    expect(tokens(cancel)).toEqual(
      expect.arrayContaining([
        'rounded-button',
        'border-hairline-strong',
        'bg-canvas',
      ])
    );
    expect(tokens(confirm)).toEqual(
      expect.arrayContaining(['rounded-button', 'bg-primary'])
    );

    // 단언 — 위치: 카드(overflow-hidden) 안도, 목록 ScrollView 안도 아니다(02a ★7).
    expect(
      within(screen.getByTestId(`my-trip-card-${A}`)).queryByTestId(
        'my-trip-delete-dialog'
      )
    ).toBeNull();
    expect(
      within(screen.UNSAFE_getByType(ScrollView)).queryByTestId(
        'my-trip-delete-dialog'
      )
    ).toBeNull();
  });
});

// TRIP-1271 · 생성이 끝났는데 카드가 "AI가 일정을 짜는 중"으로 남던 문제 — 목록이 일정을 스스로 다시 묻는다.
// 생성이 도는 여행(PARTIAL 이거나 세션 있음)만 2초마다 묻고, 탭으로 돌아오면 전부 다시 묻는다(01b 결정 2).
describe('생성 중 여행은 목록이 스스로 다시 묻는다 — 폴링·탭 복귀 재조회', () => {
  const POLL = DRAFT_POLL_INTERVAL_MS;
  const D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const TRIP_D = trip(D, '여수 여행', '2026-08-30T00:00:00Z');
  const RUNNING_TEXT = 'AI가 일정을 짜는 중';

  type Reply = Itinerary | 404 | 500;
  /** 여행별 서버 응답 대본 — 요청마다 여기서 읽으므로 테스트 중간에 바꾸면 "서버가 바뀌었다"가 된다. */
  let script: Record<string, Reply> = {};

  function itinerary(
    tripId: string,
    generationState: Itinerary['generationState'],
    status: Itinerary['status'],
    generationSessionId: string | null
  ): Itinerary {
    return {
      itineraryId: `itin-${tripId}`,
      tripId,
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      isFallback: false,
      generationState,
      generationSessionId,
      days: [{ date: '2099-06-10', slots: [] }],
    };
  }
  const running = (id: string) => itinerary(id, 'PARTIAL', 'PLANNED', 'sess-1');
  const draft = (id: string) => itinerary(id, 'COMPLETE', 'PLANNED', null);
  const confirmed = (id: string) =>
    itinerary(id, 'COMPLETE', 'CONFIRMED', null);

  const itinPath = (id: string) => `GET /api/v1/trips/${id}/itinerary`;

  beforeEach(() => {
    script = {};
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, ({ params }) => {
        const reply = script[String(params.tripId)];
        if (reply === 404 || reply === undefined) {
          return HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: '일정이 없어요' } },
            { status: 404 }
          );
        }
        if (reply === 500) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: '서버 오류' } },
            { status: 500 }
          );
        }
        return HttpResponse.json(reply);
      })
    );
    jest.useFakeTimers();
  });

  /** 가짜 시계를 ms 만큼 흘리고, 그 사이 요청·응답(msw→axios→TanStack) 약속을 함께 푼다. */
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  /** 렌더 + 첫 조회 왕복 — 100ms 는 폴링 간격(2초)보다 한참 짧다. */
  async function load(): Promise<void> {
    renderPage();
    await advance(100);
  }

  /** 탭을 떠났다가 돌아온다 — 등록된 포커스 콜백의 정리 → 다시 실행. 등록이 없으면 배선이 없다는 뜻이라 던진다. */
  function refocus(): void {
    if (mockFocus.size === 0) {
      throw new Error(
        '페이지가 useFocusEffect 를 등록하지 않았다 — 탭 복귀 재조회 배선이 없다'
      );
    }
    act(() => {
      const effects = [...mockFocus.keys()];
      effects.forEach((effect) => {
        const cleanup = mockFocus.get(effect);
        if (typeof cleanup === 'function') cleanup();
      });
      effects.forEach((effect) => mockFocus.set(effect, effect()));
    });
  }

  describe('🔴 AC-1·2 · 생성이 끝나면 화면을 떠나지 않아도 카드가 바뀌고, 그 뒤엔 더 묻지 않는다', () => {
    it.each<[string, Itinerary, string, boolean]>([
      ['완료(COMPLETE + PLANNED)', draft(A), '추천안 준비 중', true],
      [
        '실패(FAILED + PLANNED)',
        itinerary(A, 'FAILED', 'PLANNED', null),
        '추천안 준비 중',
        true,
      ],
      ['확정(COMPLETE + CONFIRMED)', confirmed(A), '일정 확정', false],
    ])(
      '%s 로 끝나면 낡은 "짜는 중"이 끝난 얼굴로 바뀐다',
      async (_label, terminal, faceText, hasResume) => {
        // 준비 — A 는 생성 중. 첫 조회 1번에 "짜는 중" 얼굴(앵커).
        script = { [A]: running(A), [B]: confirmed(B) };
        await load();
        expect(screen.getByTestId(`my-trip-extra-${A}`)).toHaveTextContent(
          RUNNING_TEXT
        );
        expect(count(itinPath(A))).toBe(1);

        // 실행 ① — 서버에서 생성이 끝나고, 폴링 간격 하나가 지난다.
        script[A] = terminal;
        await advance(POLL + 100);

        // 단언 ① — 낡은 "짜는 중"이 내려가고 끝난 얼굴이 된다(AC-1).
        expect(screen.getByTestId(`my-trip-extra-${A}`)).toHaveTextContent(
          faceText
        );
        expect(screen.queryByText(RUNNING_TEXT)).toBeNull();
        if (hasResume) {
          expect(screen.getByTestId(`my-trip-resume-${A}`)).toBeOnTheScreen();
        } else {
          expect(screen.queryByTestId(`my-trip-resume-${A}`)).toBeNull();
        }

        // 실행 ② — 간격 세 번이 더 지난다.
        const afterDone = count(itinPath(A));
        await advance(POLL * 3);

        // 단언 ② — 종착에 닿은 여행은 더 묻지 않는다(AC-2).
        expect(count(itinPath(A))).toBe(afterDone);
      }
    );
  });

  describe('AC-3 · 생성이 도는 여행이 없으면 첫 조회 뒤에 더 묻지 않는다', () => {
    it('일정 없음·확정·완료 초안·실패 초안(전부 세션 없음) → 간격 세 번이 지나도 여행마다 1번', async () => {
      // 준비
      serverTrips = [TRIP_A, TRIP_B, TRIP_C, TRIP_D];
      script = {
        [A]: 404,
        [B]: confirmed(B),
        [C]: draft(C),
        [D]: itinerary(D, 'FAILED', 'PLANNED', null),
      };
      await load();
      expect(screen.getByTestId(`my-trip-card-${D}`)).toBeOnTheScreen();

      // 실행
      await advance(POLL * 3);

      // 단언
      expect([A, B, C, D].map((id) => count(itinPath(id)))).toEqual([
        1, 1, 1, 1,
      ]);
    });
  });

  describe('🔴 AC-4 · 생성이 도는 여행의 일정만 반복해서 묻는다', () => {
    it.each<[string, Itinerary]>([
      ['생성 중(PARTIAL · 세션 있음)', running(A)],
      // 재생성 1차 구간 — 일정 행은 옛 COMPLETE 인데 세션이 돈다(01 열린 질문 1 ③).
      [
        '재생성 중(COMPLETE + PLANNED · 세션 있음)',
        itinerary(A, 'COMPLETE', 'PLANNED', 'sess-2'),
      ],
      // 세션 없이 남은 PARTIAL — 서버 sweeper 가 FAILED 로 내릴 때까지 따라간다(01 열린 질문 1 ③).
      [
        '멈춘 부분 결과(PARTIAL · 세션 없음)',
        itinerary(A, 'PARTIAL', 'PLANNED', null),
      ],
    ])(
      '%s → A 는 2초마다 다시 묻고, 확정 B 는 1번에 그친다',
      async (_label, a) => {
        // 준비
        script = { [A]: a, [B]: confirmed(B) };
        await load();

        // 실행 ① — 간격이 차기 직전까지만 흐른다.
        await advance(POLL - 200);

        // 단언 ① — 간격 하한: 2초가 되기 전에는 다시 묻지 않는다(5-b 경고-1 — 간격을 줄이는 회귀를 막는다).
        expect(count(itinPath(A))).toBe(1);

        // 실행 ② — 합쳐서 간격 두 번이 지난다.
        await advance(POLL + 300);

        // 단언 ② — 첫 조회 + 두 번 이상(간격이 2초 이하) · B 는 그대로.
        expect(count(itinPath(A))).toBeGreaterThanOrEqual(3);
        expect(count(itinPath(B))).toBe(1);
      }
    );
  });

  describe('AC-5a · 처음 열 때(첫 포커스) 첫 조회를 취소하거나 겹쳐 보내지 않는다', () => {
    it.each<[string, boolean]>([
      ['여행 목록을 처음 받는다', false],
      // 홈 탭이 받아 둔 목록·일정이 캐시에 있으면 첫 렌더에 일정 재조회가 곧바로 출발한다 — 첫 포커스 재조회가
      // 겹칠 수 있는 실제 진입 경로(01 맹점 ①).
      ['홈 탭이 받아 둔 여행 목록·일정이 캐시에 있다', true],
    ])(
      '%s → 생성 중 A·확정 B 의 일정 조회가 여행마다 정확히 1번',
      async (_label, cached) => {
        // 준비
        script = { [A]: running(A), [B]: confirmed(B) };

        // 실행
        renderPage(
          cached
            ? {
                trips: [TRIP_A, TRIP_B],
                itineraries: { [A]: running(A), [B]: confirmed(B) },
              }
            : undefined
        );
        await advance(100);

        // 단언 — 화면이 떴고(앵커), 네트워크로 나간 일정 GET 은 여행마다 1번.
        expect(screen.getByTestId(`my-trip-extra-${A}`)).toHaveTextContent(
          RUNNING_TEXT
        );
        expect(count(itinPath(A))).toBe(1);
        expect(count(itinPath(B))).toBe(1);
      }
    );
  });

  describe('🔴 AC-5 · 탭으로 돌아오면 생성 중이 아닌 여행도 다시 묻는다', () => {
    it('다른 곳에서 확정된 초안 B 는 폴링으론 안 바뀌고, 탭 복귀 때 "일정 확정"으로 바뀐다', async () => {
      // 준비 — A 는 일정 없음(404), B 는 초안.
      script = { [A]: 404, [B]: draft(B) };
      await load();
      expect(screen.getByTestId(`my-trip-extra-${B}`)).toHaveTextContent(
        '추천안 준비 중'
      );

      // 실행 ① — 상세 화면 등에서 B 가 확정되고, 목록은 다른 탭 뒤에서 간격 두 번을 보낸다.
      script[B] = confirmed(B);
      await advance(POLL * 2);

      // 단언 ① — 생성 중이 아니라 폴링하지 않는다 → 아직 옛 얼굴(앵커).
      expect(screen.getByTestId(`my-trip-extra-${B}`)).toHaveTextContent(
        '추천안 준비 중'
      );
      expect(count(itinPath(B))).toBe(1);

      // 실행 ② — 일정 탭으로 돌아온다.
      refocus();
      await advance(100);

      // 단언 ② — 여행마다 다시 묻고(404 여행 포함), B 는 확정 얼굴이 된다.
      expect(screen.getByTestId(`my-trip-extra-${B}`)).toHaveTextContent(
        '일정 확정'
      );
      expect(count(itinPath(A))).toBe(2);
      expect(count(itinPath(B))).toBe(2);
    });
  });

  describe('🔴 AC-6 · 폴링 중 조회가 실패하면 낡은 "짜는 중"을 내리고 폴링을 멈춘다 (INV-4)', () => {
    it('500 → "모름" 얼굴 · 이후 간격이 지나도 다시 묻지 않음 · 탭 복귀 때 다시 묻는다', async () => {
      // 준비 — A 는 생성 중(앵커).
      script = { [A]: running(A), [B]: confirmed(B) };
      await load();
      expect(screen.getByTestId(`my-trip-extra-${A}`)).toHaveTextContent(
        RUNNING_TEXT
      );

      // 실행 ① — 다음 폴링이 500 을 받는다.
      script[A] = 500;
      await advance(POLL + 100);

      // 단언 ① — 실패 요청이 나갔고(2번), 카드는 남되 상태문·배지가 없는 "모름" 얼굴이다.
      expect(count(itinPath(A))).toBe(2);
      expect(screen.getByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
      expect(screen.queryByTestId(`my-trip-extra-${A}`)).toBeNull();
      expect(screen.queryByTestId(`my-trip-badge-${A}`)).toBeNull();
      expect(screen.queryByText(RUNNING_TEXT)).toBeNull();

      // 실행 ② — 간격 세 번이 더 지난다.
      await advance(POLL * 3);

      // 단언 ② — 조용한 무한 재시도가 없다.
      expect(count(itinPath(A))).toBe(2);

      // 실행 ③ — 서버가 회복했고, 사용자가 탭으로 돌아온다.
      script[A] = draft(A);
      refocus();
      await advance(100);

      // 단언 ③ — 다시 묻고 끝난 얼굴을 보인다.
      expect(count(itinPath(A))).toBe(3);
      expect(screen.getByTestId(`my-trip-extra-${A}`)).toHaveTextContent(
        '추천안 준비 중'
      );
    });
  });
});

// TRIP-1271 · 결정 1=A — 생성 중인 여행도 지울 수 있다(US-TRIP-10 개정의 "생성 중 ⋯ 숨김"을 뒤집는다).
describe('🔴 AC-7 · 생성 중 카드도 ⋯ → 삭제 → 확인 다이얼로그로 지운다', () => {
  it('생성 중 A 의 ⋯ 와 "삭제"를 눌러도 DELETE 0번, 확인하면 DELETE /trips/{A} 1번', async () => {
    // 준비 — A 는 생성 중(PARTIAL · 세션 있음), B 는 확정.
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, ({ params }) =>
        HttpResponse.json(
          params.tripId === A
            ? {
                ...CONFIRMED_B,
                itineraryId: 'itin-a',
                tripId: A,
                status: 'PLANNED',
                generationState: 'PARTIAL',
                generationSessionId: 'sess-1',
              }
            : CONFIRMED_B
        )
      )
    );
    renderPage();
    expect(await screen.findByText('AI가 일정을 짜는 중')).toBeOnTheScreen();

    // 실행 ① — ⋯ → '삭제'.
    const dialog = await openDialogFor(A);
    await settle();

    // 단언 ① — 다이얼로그가 떴고 아직 아무것도 안 지웠다.
    expect(within(dialog).getByText(TITLE)).toBeOnTheScreen();
    expect(deletes()).toEqual([]);

    // 실행 ② — 확인.
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
    await settle();

    // 단언 ② — 그 여행의 DELETE 가 정확히 1번.
    expect(deletes()).toEqual([`DELETE /api/v1/trips/${A}`]);
  });
});
