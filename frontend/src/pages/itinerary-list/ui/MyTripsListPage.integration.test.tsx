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

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import { MyTripsListPage } from '@/pages/itinerary-list';

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
 * ⚠️ 딤이 화면 전체를 실제로 덮는지·가운데 오는지·뒤 터치를 막는지는 jest 사각(repo-traps 오버레이 절) — 6-b.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    navigate: jest.fn(),
  }),
}));

// 생성 클라이언트의 인증 계층이 @/shared/storage 를 정적으로 문다(expo-secure-store 실물 로드 회피,
// useCreateTrip.integration.test.tsx 와 같은 목).
jest.mock('@/shared/storage', () => ({
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
});

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime 0 — 타이머가 테스트 뒤까지 살아 프로세스를 붙잡지 않게(mutations 도, useCreateTrip 선례).
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
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
