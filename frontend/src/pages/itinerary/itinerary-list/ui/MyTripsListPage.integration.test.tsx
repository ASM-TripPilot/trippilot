import type { ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Dimensions, ScrollView } from 'react-native';
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
import * as fontScaleModule from '@/shared/lib/fontScale';
import { readIdSet, writeIdSet } from '@/shared/storage';

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
 *  - TRIP-1441 · 확정이어도 시작 전(B)이면 같은 흐름으로 지운다 — 확인 창은 확정 문구를 쓰고("작성 중인
 *    일정" 없음), 완료 배너가 그 여행을 가리키고 있었으면 삭제 성공 뒤 배너를 내린다(옛 AC-9 "배너 여행엔 ⋯
 *    없음"을 뒤집었다). 다른 여행을 지우거나 실패하면 배너는 남는다.
 *  - 다이얼로그는 카드·목록 스크롤 밖에서 그려진다(딤·카드·버튼 토큰은 실화면 몫 — TRIP-1367).
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
// TRIP-1240 — 정렬 시트가 열려 있는 동안 탭바를 숨기려고 페이지가 탭 화면 옵션을 바꾼다(`setOptions`).
const mockSetOptions = jest.fn();
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
    useNavigation: () => ({ setOptions: mockSetOptions }),
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

// 완료 배너가 읽는 "알린 여행" 저장소 — 한 칸짜리 메모리(`mockSeen`)다. 기본은 비어 있어(확정 여행 B 가 배너로
// 뜬다) 쓰면 실제로 값이 바뀐다 — 최상위 beforeEach 가 매번 비우고 구현을 되돌린다(TRIP-1352: 옛 hookMock 배선 이사).
let mockSeen: string[] = [];
jest.mock('@/shared/storage/idSet', () => ({
  readIdSet: jest.fn(),
  writeIdSet: jest.fn(),
}));

// 정렬 저장값 — 키·문자열을 페이지 수준에서 본다. 기본은 "저장값 없음"(최신순).
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
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
/** TRIP-1441 결정 1=A — 확정 여행의 확인 창 본문. */
const CONFIRMED_BODY =
  '확정한 일정과 예정 알림도 함께 지워지고 되돌릴 수 없어요.';
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
  mockSetOptions.mockClear();
  mockSeen = [];
  (readIdSet as jest.Mock)
    .mockReset()
    .mockImplementation(async () => [...mockSeen]);
  (writeIdSet as jest.Mock)
    .mockReset()
    .mockImplementation(async (_key: string, ids: readonly string[]) => {
      mockSeen = [...ids];
    });
  (SecureStore.getItemAsync as jest.Mock).mockReset();
  (SecureStore.setItemAsync as jest.Mock)
    .mockReset()
    .mockResolvedValue(undefined);
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

/** 마지막으로 렌더한 페이지의 QueryClient — 떠나 있는 사이 캐시가 바뀐 상황을 만들 때만 쓴다(TRIP-1352). */
let lastClient: QueryClient | null = null;

/** `cached` — 다른 탭(홈)이 이미 받아 둔 여행 목록·여행별 일정을 캐시에 넣고 시작한다(TRIP-1271 AC-5a). */
function renderPage(
  cached?: {
    trips: Trip[];
    itineraries: Record<string, Itinerary>;
  },
  /** `staleTime` — 기본 0(앱 기본값). 탭 복귀가 "낡은 것만" 다시 묻는지 볼 때만 올린다(TRIP-1348). */
  options?: { staleTime?: number }
) {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime 0 — 타이머가 테스트 뒤까지 살아 프로세스를 붙잡지 않게(mutations 도, useCreateTrip 선례).
      queries: {
        retry: false,
        gcTime: 0,
        ...(options?.staleTime !== undefined
          ? { staleTime: options.staleTime }
          : {}),
      },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  lastClient = client;
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

/**
 * TRIP-1441 · 확정 B 의 ⋯ → '삭제' 까지 눌러 다이얼로그를 연다. B 의 일정이 도착해 배지 '완성'이 선 뒤에 ⋯ 를
 * 바로(get) 찾는다 — ⋯ 판정은 일정이 와야 의미가 있고, ⋯ 가 없으면 기다림 시간 초과가 아니라 "못 찾음"으로 바로
 * 실패한다(02a ★11).
 */
async function openDialogForB(): Promise<ReactTestInstance> {
  expect(await screen.findByTestId(`my-trip-badge-${B}`)).toHaveTextContent(
    '완성'
  );
  fireEvent.press(screen.getByTestId(`my-trip-menu-${B}`));
  fireEvent.press(screen.getByTestId(`my-trip-menu-delete-${B}`));
  return screen.getByTestId('my-trip-delete-dialog');
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
  it('작성중 카드가 A(맨 위)·C(맨 아래) 둘일 때 C 를 지우면 DELETE /trips/{C} 1번, A 는 남는다', async () => {
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

// TRIP-1441 · 확정했지만 아직 시작 전인 여행(B — 2099-06-10 시작, 실시계 오늘보다 미래)도 지운다.
describe('🔴 확정·시작 전 여행도 ⋯ → 삭제 → 확인 창으로 지운다', () => {
  it('B 의 확인 창은 확정 문구이고 확인 전엔 DELETE 0번, 확인하면 DELETE /trips/{B} 1번 → 목록을 다시 받아 B 가 사라진다', async () => {
    // 준비 — B 의 ⋯ → '삭제'.
    renderPage();
    const dialog = await openDialogForB();
    await settle();

    // 단언 ① — 확정 문구(완전 일치)이고 "작성 중인 일정"은 없다. 아직 아무 요청도 이동도 없다.
    expect(within(dialog).getByText(TITLE)).toBeOnTheScreen();
    expect(within(dialog).getByText(CONFIRMED_BODY)).toBeOnTheScreen();
    expect(within(dialog).queryByText(/작성 중인 일정/)).toBeNull();
    expect(deletes()).toEqual([]);
    expect(mockPush).not.toHaveBeenCalled();

    // 실행 — 확인.
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
    await settle();

    // 단언 ② — B 의 DELETE 한 줄, 목록을 다시 받아 B 카드·확인 창이 사라지고 A 는 남는다.
    expect(deletes()).toEqual([`DELETE /api/v1/trips/${B}`]);
    await waitFor(() =>
      expect(screen.queryByTestId(`my-trip-card-${B}`)).toBeNull()
    );
    expect(screen.queryByTestId('my-trip-delete-dialog')).toBeNull();
    expect(count('GET /api/v1/trips')).toBe(2);
    expect(screen.getByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
  });

  it('문구는 대상마다 갈린다 — B(확정) 창을 닫고 A(작성중) 창을 열면 작성중 문구만 나온다', async () => {
    // 준비·실행 ① — B 창을 열었다 닫는다(B → A 순서라야 문구가 앞 대상에 들러붙는 것을 잡는다, 02a ★5).
    renderPage();
    const bDialog = await openDialogForB();
    expect(within(bDialog).getByText(CONFIRMED_BODY)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('my-trip-delete-cancel'));
    expect(screen.queryByTestId('my-trip-delete-dialog')).toBeNull();

    // 실행 ② — A 창을 연다.
    const aDialog = await openDialogFor(A);

    // 단언 — 작성중 문구 그대로(완전 일치), 확정 문구는 없다. 지운 것도 없다.
    expect(within(aDialog).getByText(BODY)).toBeOnTheScreen();
    expect(within(aDialog).queryByText(CONFIRMED_BODY)).toBeNull();
    await settle();
    expect(deletes()).toEqual([]);
  });
});

// TRIP-1441 · 옛 TRIP-1055 AC-9("완료 배너 여행에는 ⋯ 가 없다 — 도달 불가의 전제 잠금")를 뒤집었다. 배너 상태는
// Trip 객체를 쥐고 있어 목록에서 빠져도 스스로 사라지지 않는다 — 지운 여행으로 가는 [보기]가 남으면 안 된다.
describe('🔴 완료 배너가 가리키는 여행을 지우면 배너가 내려간다', () => {
  /** 기본 픽스처에선 확정 B 가 배너로 뜬다(seen 비어 있음) — 그것부터 확인한다(앵커). */
  async function expectBannerOnB(): Promise<void> {
    expect(await screen.findByTestId('generation-done-bar')).toBeOnTheScreen();
    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      new RegExp(TRIP_B.title)
    );
  }

  it('B 를 지우는 데 성공하면 B 카드가 빠진 뒤 배너·[보기]가 없고, 다시 뜨지도 않는다', async () => {
    // 준비
    renderPage();
    await expectBannerOnB();

    // 실행 — B 를 지운다.
    await openDialogForB();
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
    await waitFor(() =>
      expect(screen.queryByTestId(`my-trip-card-${B}`)).toBeNull()
    );

    // 단언 — 카드가 빠진 뒤에 본다(배너는 목록과 따로 남는다, 02a ★6). 한 번 더 기다려도 다시 안 뜬다.
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(screen.queryByTestId('generation-done-bar-view')).toBeNull();
    await settle();
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
  });

  it('다른 여행(작성중 A)을 지우면 배너는 B 를 그대로 가리킨다', async () => {
    // 준비
    renderPage();
    await expectBannerOnB();

    // 실행 — A 를 지운다.
    await openDialogFor(A);
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
    await waitFor(() =>
      expect(screen.queryByTestId(`my-trip-card-${A}`)).toBeNull()
    );

    // 단언 — 아무 삭제나 배너를 내리지 않는다(02a ★7).
    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      new RegExp(TRIP_B.title)
    );
  });

  it('B 삭제가 서버 오류(500)면 확인 창 안에 실패 문구 · B 카드와 배너는 그대로 남는다 (INV-4)', async () => {
    // 준비 — DELETE 가 실패한다.
    deleteMode = 500;
    renderPage();
    await expectBannerOnB();

    // 실행 — B 를 지우려 확인한다.
    await openDialogForB();
    fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));

    // 단언 — 실패 문구(완전 일치)가 창 안에 뜨고, 카드·배너는 남는다. 요청은 1번.
    const error = await screen.findByTestId('my-trip-delete-error');
    expect(error).toHaveTextContent(ERROR_TEXT);
    expect(
      within(screen.getByTestId('my-trip-delete-dialog')).getByTestId(
        'my-trip-delete-error'
      )
    ).toBe(error);
    expect(screen.getByTestId(`my-trip-card-${B}`)).toBeOnTheScreen();
    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      new RegExp(TRIP_B.title)
    );
    expect(deletes()).toEqual([`DELETE /api/v1/trips/${B}`]);
  });
});

describe('🔴 TRIP-1055 AC-10 · 다이얼로그 구조 (Figma 4682:3206)', () => {
  it('버튼 문구가 맞고, 다이얼로그는 카드·목록 스크롤 밖에 있다', async () => {
    // 준비·실행
    renderPage();
    expect(await openDialogForA()).toBeOnTheScreen();

    // 단언 — 버튼 문구.
    expect(screen.getByTestId('my-trip-delete-cancel')).toHaveTextContent(
      '취소'
    );
    expect(screen.getByTestId('my-trip-delete-confirm')).toHaveTextContent(
      '삭제'
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

  describe('TRIP-1348 · 탭 복귀는 낡은 일정만 다시 묻는다', () => {
    it('방금 받은(신선한) 일정은 건너뛰고, 실패한 일정만 다시 묻는다', async () => {
      // 준비 — staleTime 1분이면 방금 받은 B 는 신선하다. A 는 500(데이터 없음 = 낡음).
      script = { [A]: 500, [B]: confirmed(B) };
      renderPage(undefined, { staleTime: 60_000 });
      await advance(100);
      expect(count(itinPath(A))).toBe(1);
      expect(count(itinPath(B))).toBe(1);

      // 실행 — 탭을 떠났다가 곧바로 돌아온다.
      script[A] = draft(A);
      refocus();
      await advance(100);

      // 단언 — 신선한 B 는 안 묻고(1 유지), 실패했던 A 만 다시 물었다.
      expect(count(itinPath(B))).toBe(1);
      expect(count(itinPath(A))).toBe(2);
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

// TRIP-1352 · 옛 MyTripsListPage.hookMock.test.tsx(node 버킷, 조회 훅 목)의 **배선** 관점을 이사 왔다.
// 조회 훅을 목으로 대신하던 판정(누가 배너 대상인가·여행 중 판정·정렬 비교)은 순수 함수 PBT
// (`doneBar.test` · `myTripsOrder.test`)와 뷰 단위(`MyTripsListScreen.test` · `MyTripsSortSheet.test` ·
// `GenerationDoneBar.test`)가 잠그므로 여기는 "페이지가 그 재료를 제대로 잇는가"만 본다 — 실제 react-query 가
// MSW 응답으로 돈다(옛 파일은 `useQueries` 옵션 함수를 대본으로 갈아 끼웠다).
describe('내 여행 목록 배선 — 완료 배너·여행 중 고정·정렬', () => {
  const SEEN_KEY = 'itinerary.doneBar.seen';
  const SORT_KEY = 'itinerary.myTrips.sort';

  function mk(tripId: string, title: string, over: Partial<Trip> = {}): Trip {
    return {
      ...trip(tripId, title, '2026-08-10T00:00:00.000Z'),
      ...over,
    };
  }
  const TA = mk('trip-a', '제주 여행');
  const TB = mk('trip-b', '부산 여행', {
    updatedAt: '2026-08-20T00:00:00.000Z',
  });
  const TC = mk('trip-c', '강릉 여행', {
    updatedAt: '2026-08-30T00:00:00.000Z',
  });

  function itin(
    tripId: string,
    status: Itinerary['status'],
    over: Partial<Itinerary> = {}
  ): Itinerary {
    return {
      ...CONFIRMED_B,
      itineraryId: `itin-${tripId}`,
      tripId,
      status,
      generationState: 'COMPLETE',
      generationSessionId: null,
      ...over,
    };
  }
  const done = (id: string) => itin(id, 'CONFIRMED');
  const planned = (id: string) => itin(id, 'PLANNED');

  /** 여행별 일정 응답 대본. `'held'` 는 `release` 가 풀 때까지 응답을 붙잡는다(도착 순서를 테스트가 정한다). */
  type Script = Itinerary | 404 | 500 | 'held';
  let script: Record<string, Script> = {};
  const gates = new Map<string, () => void>();

  function serve(list: Trip[], itins: Record<string, Script>): void {
    script = itins;
    gates.clear();
    server.use(
      http.get(`${BASE}/trips`, () => HttpResponse.json(list)),
      http.get(`${BASE}/trips/:tripId/itinerary`, async ({ params }) => {
        const id = String(params.tripId);
        if (script[id] === 'held') {
          await new Promise<void>((resolve) => gates.set(id, resolve));
        }
        const reply = script[id];
        if (reply === 500) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: '서버 오류' } },
            { status: 500 }
          );
        }
        if (reply === undefined || reply === 404 || reply === 'held') {
          return HttpResponse.json(
            { error: { code: 'NOT_FOUND', message: '일정이 없어요' } },
            { status: 404 }
          );
        }
        return HttpResponse.json(reply);
      })
    );
  }
  /** 붙잡힌 응답을 `value` 로 푼다 — 요청이 이미 도착해 붙잡혔을 때까지 기다린다. */
  async function release(id: string, value: Script): Promise<void> {
    await waitFor(() => expect(gates.has(id)).toBe(true));
    script[id] = value;
    await act(async () => {
      gates.get(id)?.();
    });
  }

  /** 탭을 떠난다(blur) — 등록된 포커스 콜백의 정리 함수를 부른다. */
  function leaveTab(): void {
    act(() => {
      for (const [effect, cleanup] of [...mockFocus]) {
        if (typeof cleanup === 'function') cleanup();
        mockFocus.set(effect, undefined);
      }
    });
  }
  /** 탭으로 돌아온다 — 포커스 콜백을 다시 실행한다. */
  function returnToTab(): void {
    act(() => {
      for (const effect of [...mockFocus.keys()]) {
        mockFocus.set(effect, effect());
      }
    });
  }

  // 글자 배율 — jest 의 RN 목 기본은 1 이 아니라 2(= 큰 글자)라 운영 기본값 1 로 이 describe 를 고정한다.
  const BASE_WINDOW = Dimensions.get('window');
  function setFontScale(fontScale: number): void {
    const window = { ...BASE_WINDOW, fontScale };
    Dimensions.set({ window, screen: window });
  }
  let isLargeTextSpy: jest.SpyInstance | null = null;

  beforeEach(() => {
    setFontScale(1);
    lastClient = null;
  });
  afterEach(() => {
    gates.forEach((open) => open()); // 붙잡힌 응답을 남기지 않는다 — 안 풀면 jest 가 red 대신 멈춘다.
    // 아직 마운트된 화면이 배율 변화를 듣는다 — act 밖에서 바꾸면 경고가 쏟아진다.
    act(() => {
      Dimensions.set({ window: BASE_WINDOW, screen: BASE_WINDOW });
    });
    isLargeTextSpy?.mockRestore();
    isLargeTextSpy = null;
  });

  const bar = () => screen.queryByTestId('generation-done-bar');
  const barText = () => screen.getByTestId('generation-done-bar-text');
  const seenWrites = () =>
    (writeIdSet as jest.Mock).mock.calls.map(
      ([key, ids]: [string, string[]]) => [key, [...ids].sort()] as const
    );
  /** 카드 루트 testID 를 화면 순서대로. */
  const cardOrder = (): string[] =>
    screen
      .getAllByTestId(/^my-trip-card-/)
      .map((element) => element.props.testID as string);

  describe('완료 배너', () => {
    it('가장 최근 완성 한 건만 띄우고, 완성 전부를 seen 에 한 번(읽은 키 그대로) 쓰며, 다시 들어오면 없다', async () => {
      mockSeen = ['trip-gone'];
      serve([TA, TC, TB], {
        'trip-a': done('trip-a'),
        'trip-b': done('trip-b'),
        'trip-c': planned('trip-c'),
      });

      const first = renderPage();
      // 정렬상 첫째(C, 초안)도 입력 첫째(A, 옛 완성)도 아닌 최신 완성 B.
      expect(
        await screen.findByTestId('generation-done-bar')
      ).toBeOnTheScreen();
      expect(barText()).toHaveTextContent('부산 여행 일정이 완성됐어요');
      expect(screen.getAllByTestId('generation-done-bar')).toHaveLength(1);
      await settle();

      // 쓰기 1번 — 목록에 없는 옛 id 는 버리고 초안은 넣지 않는다. 읽은 키와 쓴 키가 같고 토큰 키가 아니다.
      expect(seenWrites()).toEqual([[SEEN_KEY, ['trip-a', 'trip-b']]]);
      expect((readIdSet as jest.Mock).mock.calls[0][0]).toBe(SEEN_KEY);
      // 저장이 끝났어도 이 화면에선 배너가 그대로다.
      expect(bar()).toBeOnTheScreen();

      first.unmount();
      renderPage();
      expect(
        await screen.findByTestId('my-trip-card-trip-a')
      ).toBeOnTheScreen();
      await settle();
      expect(bar()).toBeNull();
      expect(writeIdSet).toHaveBeenCalledTimes(1);
    });

    it('닫기(✕)는 배너만 걷고 다시 안 띄운다 — 목록·seen 쓰기는 그대로, 이동 없음', async () => {
      serve([TA], { 'trip-a': done('trip-a') });
      renderPage();
      fireEvent.press(await screen.findByTestId('generation-done-bar-close'));
      await settle();

      expect(bar()).toBeNull();
      expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
      expect(writeIdSet).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('"보기"는 배너 대상 여행(목록 첫째가 아닌 확정 B)의 목적지로 한 번 간다', async () => {
      serve([TA, TC, TB], {
        'trip-a': done('trip-a'),
        'trip-b': done('trip-b'),
        'trip-c': planned('trip-c'),
      });
      renderPage();
      fireEvent.press(await screen.findByTestId('generation-done-bar-view'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(String(mockPush.mock.calls[0][0])).toBe('/trips/trip-b/live');
    });

    it('목록을 떠나면 배너가 사라지고, 돌아와도 같은 여행은 다시 안 뜬다 (추가 쓰기 없음)', async () => {
      serve([TA], { 'trip-a': done('trip-a') });
      renderPage();
      expect(
        await screen.findByTestId('generation-done-bar')
      ).toBeOnTheScreen();

      leaveTab();
      await settle();
      expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
      expect(bar()).toBeNull();

      returnToTab();
      await settle();
      expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
      expect(bar()).toBeNull();
      expect(writeIdSet).toHaveBeenCalledTimes(1);
    });

    it('A 를 ✕ 로 닫고 떠난 사이 B 가 완성되면, 돌아왔을 때 B 가 뜬다 (닫음은 그 포커스 동안만)', async () => {
      serve([TA], { 'trip-a': done('trip-a') });
      renderPage();
      fireEvent.press(await screen.findByTestId('generation-done-bar-close'));
      await settle();
      expect(bar()).toBeNull();

      leaveTab();
      // 떠나 있는 사이 목록과 B 의 일정이 캐시에 새로 들어온다.
      await act(async () => {
        script['trip-b'] = done('trip-b');
        lastClient?.setQueryData(getGetTripsQueryKey(), [TA, TB]);
        lastClient?.setQueryData(
          getGetTripsTripIdItineraryQueryKey('trip-b'),
          done('trip-b')
        );
      });
      await settle();
      expect(screen.getByTestId('my-trip-card-trip-b')).toBeOnTheScreen();
      expect(bar()).toBeNull();
      expect(writeIdSet).toHaveBeenCalledTimes(1);

      returnToTab();
      await settle();
      expect(barText()).toHaveTextContent('부산 여행 일정이 완성됐어요');
      expect(seenWrites()[1]).toEqual([SEEN_KEY, ['trip-a', 'trip-b']]);
    });

    it('이미 알린 여행은 다시 안 띄우고 쓰지도 않는다', async () => {
      mockSeen = ['trip-a'];
      serve([TA], { 'trip-a': done('trip-a') });
      renderPage();

      expect(
        await screen.findByTestId('my-trip-card-trip-a')
      ).toBeOnTheScreen();
      await settle();
      expect(readIdSet).toHaveBeenCalled();
      expect(bar()).toBeNull();
      expect(writeIdSet).not.toHaveBeenCalled();
    });

    it.each<[string, () => Promise<string[]>]>([
      ['읽기가 끝나지 않으면', () => new Promise(() => {})],
      ['읽기가 실패하면', () => Promise.reject(new Error('keychain'))],
    ])('seen %s 배너·쓰기 없이 목록만 그린다', async (_label, read) => {
      (readIdSet as jest.Mock).mockImplementation(read);
      serve([TA], { 'trip-a': done('trip-a') });
      renderPage();

      expect(
        await screen.findByTestId('my-trip-card-trip-a')
      ).toBeOnTheScreen();
      await settle();
      expect(bar()).toBeNull();
      expect(writeIdSet).not.toHaveBeenCalled();
    });

    it('seen 쓰기가 실패해도 배너는 그대로 남는다', async () => {
      (writeIdSet as jest.Mock).mockRejectedValue(new Error('keychain'));
      serve([TA], { 'trip-a': done('trip-a') });
      renderPage();

      expect(
        await screen.findByTestId('generation-done-bar')
      ).toBeOnTheScreen();
      await settle();
      expect(barText()).toHaveTextContent('제주 여행 일정이 완성됐어요');
      expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
    });

    it('여행 하나의 일정이 아직 안 왔으면 먼저 온 완성이 있어도 띄우지도 쓰지도 않고, 마저 오면 최신 완성 B 를 띄운다', async () => {
      serve([TA, TB], { 'trip-a': done('trip-a'), 'trip-b': 'held' });
      renderPage();

      expect(
        await screen.findByTestId('my-trip-card-trip-a')
      ).toBeOnTheScreen();
      await settle();
      expect(bar()).toBeNull();
      expect(writeIdSet).not.toHaveBeenCalled();

      await release('trip-b', done('trip-b'));
      expect(
        await screen.findByTestId('generation-done-bar')
      ).toBeOnTheScreen();
      expect(barText()).toHaveTextContent('부산 여행 일정이 완성됐어요');
      expect(seenWrites()).toEqual([[SEEN_KEY, ['trip-a', 'trip-b']]]);
    });

    it.each([1, 1.49])(
      '배율 %s(기본 글자) — 배너는 목록 화면(itinerary-tab-root) 밖 형제로 뜬다',
      async (fontScale) => {
        setFontScale(fontScale);
        serve([TA], { 'trip-a': done('trip-a') });
        renderPage();

        expect(
          await screen.findByTestId('generation-done-bar')
        ).toBeOnTheScreen();
        const root = screen.getByTestId('itinerary-tab-root');
        expect(within(root).queryByTestId('generation-done-bar')).toBeNull();
      }
    );

    it.each([1.5, 3.571])(
      '배율 %s(큰 글자) — 배너는 목록 스크롤 안 첫 카드 앞에 놓이고, 보기·✕ 가 그대로 동작한다',
      async (fontScale) => {
        setFontScale(fontScale);
        serve([TA, TC, TB], {
          'trip-a': done('trip-a'),
          'trip-b': done('trip-b'),
          'trip-c': planned('trip-c'),
        });
        renderPage();

        expect(
          await screen.findByTestId('generation-done-bar')
        ).toBeOnTheScreen();
        const inScroll = within(screen.UNSAFE_getByType(ScrollView))
          .queryAllByTestId(/^(generation-done-bar|my-trip-card-trip-[abc])$/)
          .map((node) => node.props.testID as string);
        expect(inScroll).toEqual([
          'generation-done-bar',
          'my-trip-card-trip-c',
          'my-trip-card-trip-b',
          'my-trip-card-trip-a',
        ]);

        fireEvent.press(screen.getByTestId('generation-done-bar-view'));
        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(String(mockPush.mock.calls[0][0])).toBe('/trips/trip-b/live');
        fireEvent.press(screen.getByTestId('generation-done-bar-close'));
        await settle();
        expect(bar()).toBeNull();
        expect(screen.getByTestId('my-trip-card-trip-b')).toBeOnTheScreen();
      }
    );

    it('배치는 isLargeText 하나로만 정한다 — 배율 1 이어도 true 면 목록 안, 3.571 이어도 false 면 밖', async () => {
      setFontScale(1);
      isLargeTextSpy = jest
        .spyOn(fontScaleModule, 'isLargeText')
        .mockReturnValue(true);
      serve([TA], { 'trip-a': done('trip-a') });
      const view = renderPage();
      expect(
        await screen.findByTestId('generation-done-bar')
      ).toBeOnTheScreen();
      expect(isLargeTextSpy).toHaveBeenCalledWith(1);
      expect(
        within(screen.UNSAFE_getByType(ScrollView)).queryByTestId(
          'generation-done-bar'
        )
      ).not.toBeNull();
      view.unmount();

      // 이번엔 시계가 큰 글자인데 판정이 아니라고 하면 목록 화면 밖이다. seen 은 앞 렌더가 써 뒀으니 비운다.
      mockSeen = [];
      setFontScale(3.571);
      isLargeTextSpy.mockReturnValue(false);
      renderPage();
      expect(
        await screen.findByTestId('generation-done-bar')
      ).toBeOnTheScreen();
      expect(isLargeTextSpy).toHaveBeenCalledWith(3.571);
      const root = screen.getByTestId('itinerary-tab-root');
      expect(within(root).queryByTestId('generation-done-bar')).toBeNull();
    });
  });

  // TRIP-1428 — 앱에서 확정에 성공한 여행은 확정 토스트가 이미 알렸다. 일정 탭으로 돌아와 "…일정이 완성됐어요"를
  // 또 띄우지 않는다(결정 2=A). 확정 쪽(useConfirmItinerary)이 seen 에 그 여행을 더하고, 목록은 **포커스마다** seen 을
  // 다시 읽는다 — 일정 탭은 탭 화면이라 다른 화면에 갔다 와도 다시 마운트되지 않는다(01 맹점 ①).
  describe('TRIP-1428 · 떠나 있는 사이 확정된 여행 — 포커스 때 seen 을 다시 읽는다', () => {
    /**
     * 무엇을 보장하나:
     *  - 🔴 목록이 이미 떠 있는 채로 떠났다가, 그 사이 seen 에 A 가 기록되고 A 가 확정되면, 돌아왔을 때 A 배너가 없다.
     *  - 🔴 같은 포커스에서 seen 밖의 다른 완성 여행 B(다른 기기 확정 등)는 지금처럼 1건 뜨고 [보기]가 된다(🟢 [닫기]).
     *    seen 은 A 를 지우지 않고 B 를 더한다.
     *  - 🟢 목록이 직접 띄운 배너는 seen 쓰기가 실패해도, 떠났다 돌아왔을 때 다시 뜨지 않는다(TRIP-1286 무회귀 —
     *    "다시 읽기"가 이 화면이 아는 값을 버리면 red).
     *
     * ⚠️ 순서가 심판이다(02a ★1): 마운트 → 떠남 → **그 사이** 저장소에 A 추가 → 돌아옴. "저장소에 A 를 먼저 넣고
     * 새로 그리기"는 마운트 때 한 번 읽는 지금 코드에서도 통과해 결함을 못 잡는다.
     *
     * 3동작: 준비(목록을 띄우고 떠난다 · 그 사이 seen·일정이 바뀐다) → 실행(돌아온다) → 단언(배너·seen 쓰기).
     */
    // A 가 B 보다 최근이다 — 낡은 seen 으로 판정하는 구현은 B 가 아니라 A 를 띄워 red 가 갈린다.
    const RA = mk('trip-a', '제주 여행', {
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    const RB = mk('trip-b', '부산 여행', {
      updatedAt: '2026-08-20T00:00:00.000Z',
    });

    /**
     * 탭으로 돌아온 뒤 탭 복귀 재조회(TRIP-1271)가 끝날 때까지 기다린다 — 안 기다리면 그 응답 알림이 테스트 밖(act 밖)에
     * 도착해 다음 테스트에 act 경고를 흘린다(02a ★17 실측).
     */
    async function returnAndSettle(): Promise<void> {
      returnToTab();
      await waitFor(() => expect(lastClient?.isFetching()).toBe(0));
      await settle();
    }

    /** 떠나 있는 사이 확정된 여행 — 서버 대본과 캐시(확정 응답이 캐시에 쓴 것과 같은 자리)를 함께 바꾼다. */
    async function confirmedWhileAway(ids: string[]): Promise<void> {
      await act(async () => {
        ids.forEach((id) => {
          script[id] = done(id);
          lastClient?.setQueryData(
            getGetTripsTripIdItineraryQueryKey(id),
            done(id)
          );
        });
      });
    }

    it('🔴 목록을 본 뒤 A 를 확정하고 돌아오면(그 사이 seen 에 A 기록) A 배너가 뜨지 않고 seen 을 다시 쓰지도 않는다', async () => {
      // 준비 ① 목록이 떠 있다 — A 는 아직 초안이라 배너가 없다(앵커).
      serve([RA], { 'trip-a': planned('trip-a') });
      renderPage();
      expect(
        await screen.findByTestId('my-trip-card-trip-a')
      ).toBeOnTheScreen();
      await settle();
      expect(bar()).toBeNull();
      expect(readIdSet).toHaveBeenCalled();

      // 준비 ② 탭을 떠난다 → 그 사이 확정 쪽이 seen 에 A 를 쓰고(useConfirmItinerary), A 가 확정된다.
      leaveTab();
      mockSeen = ['trip-a'];
      await confirmedWhileAway(['trip-a']);
      await settle();

      // 실행 — 탭으로 돌아온다.
      await returnAndSettle();

      // 단언 — 카드는 있고(짝), A 배너는 없고, 목록이 seen 을 쓰지도 않았다.
      expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
      expect(bar()).toBeNull();
      expect(writeIdSet).not.toHaveBeenCalled();
    });

    it('🔴 같은 포커스에서 seen 밖의 완성 여행 B 는 지금처럼 한 건 뜨고, seen 은 A 를 남긴 채 B 를 더한다 · [보기]는 B 로 간다', async () => {
      // 준비 — 둘 다 초안인 목록을 본 뒤 떠난다. 그 사이 A 는 이 기기에서 확정(seen 기록), B 는 다른 곳에서 확정.
      serve([RA, RB], {
        'trip-a': planned('trip-a'),
        'trip-b': planned('trip-b'),
      });
      renderPage();
      expect(
        await screen.findByTestId('my-trip-card-trip-b')
      ).toBeOnTheScreen();
      await settle();
      expect(bar()).toBeNull();

      leaveTab();
      mockSeen = ['trip-a'];
      await confirmedWhileAway(['trip-a', 'trip-b']);
      await settle();

      // 실행
      await returnAndSettle();

      // 단언 ① 배너는 B 한 건 — A(더 최근)가 아니다.
      expect(screen.getAllByTestId('generation-done-bar')).toHaveLength(1);
      expect(barText()).toHaveTextContent('부산 여행 일정이 완성됐어요');
      // 단언 ② seen 은 A 를 지우지 않고 B 를 더한다(같은 키).
      expect(seenWrites()).toEqual([[SEEN_KEY, ['trip-a', 'trip-b']]]);
      // 단언 ③ [보기]는 B 의 목적지로 한 번.
      fireEvent.press(screen.getByTestId('generation-done-bar-view'));
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(String(mockPush.mock.calls[0][0])).toBe('/trips/trip-b/live');
    });

    it('🟢 B 배너의 [닫기]는 배너만 걷는다 — 이동 0 · 카드 그대로 (선제 green · AC-7 무회귀)', async () => {
      serve([RA, RB], {
        'trip-a': planned('trip-a'),
        'trip-b': planned('trip-b'),
      });
      renderPage();
      expect(
        await screen.findByTestId('my-trip-card-trip-b')
      ).toBeOnTheScreen();
      await settle();

      leaveTab();
      mockSeen = ['trip-a'];
      await confirmedWhileAway(['trip-a', 'trip-b']);
      await returnAndSettle();
      // 앵커 — B 배너가 떠 있다(아래 "없음"이 닫기 몫임을 가른다).
      expect(
        await screen.findByTestId('generation-done-bar')
      ).toBeOnTheScreen();

      // 실행
      fireEvent.press(screen.getByTestId('generation-done-bar-close'));
      await settle();

      // 단언
      expect(bar()).toBeNull();
      expect(screen.getByTestId('my-trip-card-trip-b')).toBeOnTheScreen();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('🟢 목록이 띄운 배너는 seen 쓰기가 실패해도, 떠났다 돌아왔을 때 다시 뜨지 않는다 (TRIP-1286 무회귀 · 선제 green)', async () => {
      // 준비 — 쓰기가 실패해 저장소엔 A 가 안 남는다(다시 읽으면 빈 집합).
      (writeIdSet as jest.Mock).mockRejectedValue(new Error('keychain'));
      serve([RA], { 'trip-a': done('trip-a') });
      renderPage();
      expect(
        await screen.findByTestId('generation-done-bar')
      ).toBeOnTheScreen();
      await settle();
      expect(mockSeen).toEqual([]);

      // 실행 — 떠났다 돌아온다.
      leaveTab();
      await settle();
      await returnAndSettle();

      // 단언 — 이 화면은 A 를 이미 알렸다는 걸 안다.
      expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
      expect(bar()).toBeNull();
    });
  });

  describe('여행 중 고정', () => {
    // 시계는 흉내 내지 않는다: 기간 안 = 2020~2099, 과거 = 2026-06, 미래 = 2099-06.
    const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' };
    const PAST = { startDate: '2026-06-10', endDate: '2026-06-13' };
    const FUTURE = { startDate: '2099-06-10', endDate: '2099-06-13' };
    // 과거 확정 C(중간) · 여행 중 확정 A(가장 옛) · 미래 확정 B(최신)
    const PA = mk('A', 'A 여행', {
      ...DURING,
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const PB = mk('B', 'B 여행', {
      ...FUTURE,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    const PC = mk('C', 'C 여행', {
      ...PAST,
      updatedAt: '2026-08-15T00:00:00.000Z',
    });

    it('일정이 도착하기 전엔 최신순이고, 도착하면 여행 중 A 가 맨 위 · 배지 "여행 중" · ⋯/resume 없음', async () => {
      // 완료 배너는 이 describe 의 관심 밖 — seen 읽기를 막아 끈다.
      (readIdSet as jest.Mock).mockImplementation(() => new Promise(() => {}));
      serve([PC, PA, PB], { A: 'held', B: done('B'), C: done('C') });
      renderPage();

      // 판정 재료(A 의 일정)가 없으면 고정하지 않는다 — 최신순 B·C·A, A 배지 없음.
      expect(await screen.findByTestId('my-trip-badge-B')).toHaveTextContent(
        '완성'
      );
      expect(cardOrder()).toEqual([
        'my-trip-card-B',
        'my-trip-card-C',
        'my-trip-card-A',
      ]);
      expect(screen.queryByTestId('my-trip-badge-A')).toBeNull();

      await release('A', done('A'));
      expect(await screen.findByTestId('my-trip-badge-A')).toHaveTextContent(
        '여행 중'
      );
      expect(cardOrder()).toEqual([
        'my-trip-card-A',
        'my-trip-card-B',
        'my-trip-card-C',
      ]);
      expect(screen.queryByTestId('my-trip-menu-A')).toBeNull();
      expect(screen.queryByTestId('my-trip-resume-A')).toBeNull();
      expect(screen.getByTestId('my-trip-badge-C')).toHaveTextContent('완성');
    });

    it('기간 안 A 의 일정 조회가 500 이면 고정·배지 없음 (INV-4), 기간 안 초안·일정 없음은 "작성중"이고 고정 안 함', async () => {
      (readIdSet as jest.Mock).mockImplementation(() => new Promise(() => {}));
      const A2 = mk('A2', 'A2 여행', {
        ...DURING,
        updatedAt: '2026-07-10T00:00:00.000Z',
      });
      const A3 = mk('A3', 'A3 여행', {
        ...DURING,
        updatedAt: '2026-07-05T00:00:00.000Z',
      });
      serve([PA, A2, A3, PB], {
        A: 500,
        A2: 404,
        A3: planned('A3'),
        B: done('B'),
      });
      renderPage();

      expect(await screen.findByTestId('my-trip-badge-B')).toHaveTextContent(
        '완성'
      );
      expect(await screen.findByTestId('my-trip-badge-A3')).toHaveTextContent(
        '작성중'
      );
      expect(screen.getByTestId('my-trip-badge-A2')).toHaveTextContent(
        '작성중'
      );
      expect(screen.queryByTestId('my-trip-badge-A')).toBeNull();
      expect(cardOrder()).toEqual([
        'my-trip-card-B',
        'my-trip-card-A2',
        'my-trip-card-A3',
        'my-trip-card-A',
      ]);
      expect(screen.getByTestId('my-trip-menu-A3')).toBeOnTheScreen();
    });
  });

  describe('정렬 시트와 저장된 기준', () => {
    // 기준마다 순서가 전부 다른 세 건 — 최신순 Y X Z · 출발일순 Z X Y · 이름순 Y Z X. 시계는 흉내 내지 않는다(지난 = 2022).
    const Y = mk('Y', '강릉 여행', {
      startDate: '2022-03-01',
      endDate: '2022-03-01',
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    const X = mk('X', '제주 여행', {
      startDate: '2099-05-01',
      endDate: '2099-05-01',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    const Z = mk('Z', '부산 여행', {
      startDate: '2099-02-01',
      endDate: '2099-02-01',
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const RECENT = ['my-trip-card-Y', 'my-trip-card-X', 'my-trip-card-Z'];
    const START = ['my-trip-card-Z', 'my-trip-card-X', 'my-trip-card-Y'];
    const TITLE = ['my-trip-card-Y', 'my-trip-card-Z', 'my-trip-card-X'];

    const mockGetItem = SecureStore.getItemAsync as jest.Mock;
    const mockSetItem = SecureStore.setItemAsync as jest.Mock;

    /** 정렬 키 읽기만 대본대로, 다른 키는 영영 미도착(토큰 등 — 이 describe 관심 밖). */
    function storedSort(read: () => Promise<unknown>): void {
      mockGetItem.mockImplementation((key: string) =>
        key === SORT_KEY ? read() : new Promise(() => {})
      );
    }
    const writes = (): unknown[][] =>
      mockSetItem.mock.calls.map((call) => call.slice(0, 2));
    const trigger = () => screen.getByTestId('my-trips-sort');
    const openSheet = (): void => {
      fireEvent.press(trigger());
    };
    /** 첫 렌더 뒤 카드가 서 있을 때까지. */
    async function loaded(): Promise<void> {
      await screen.findByTestId('my-trip-card-Y');
      await settle();
    }

    beforeEach(() => {
      // 완료 배너·일정 판정은 관심 밖 — seen 읽기와 일정 응답을 막아 "여행 중 고정"이 끼지 않게 한다(S9 만 예외).
      (readIdSet as jest.Mock).mockImplementation(() => new Promise(() => {}));
      serve([Z, X, Y], { Z: 'held', X: 'held', Y: 'held' });
      storedSort(() => Promise.resolve(null));
    });

    it('처음엔 시트 없이 최신순, 이름순을 고르면 닫히고 이름순으로 서며 1회 저장 · 다시 열면 이름순이 선택돼 있다', async () => {
      renderPage();
      await loaded();
      expect(trigger()).toHaveTextContent('최신순');
      expect(screen.queryByTestId('my-trips-sort-sheet')).toBeNull();
      expect(cardOrder()).toEqual(RECENT);

      openSheet();
      expect(screen.getByTestId('my-trips-sort-option-recent')).toBeSelected();
      fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));
      await settle();

      expect(screen.queryByTestId('my-trips-sort-sheet')).toBeNull();
      expect(cardOrder()).toEqual(TITLE);
      expect(trigger()).toHaveTextContent('이름순');
      expect(writes()).toEqual([[SORT_KEY, 'title']]);
      openSheet();
      expect(screen.getByTestId('my-trips-sort-option-title')).toBeSelected();
      expect(
        screen.getByTestId('my-trips-sort-option-recent')
      ).not.toBeSelected();
    });

    it('출발일순을 고르면 Z·X·Y 로 서고, 저장이 실패해도 고른 기준은 화면에 남는다', async () => {
      mockSetItem.mockReset().mockRejectedValue(new Error('keychain'));
      renderPage();
      await loaded();
      openSheet();
      fireEvent.press(screen.getByTestId('my-trips-sort-option-start'));
      await settle();

      expect(cardOrder()).toEqual(START);
      expect(trigger()).toHaveTextContent('출발일순');
      expect(mockSetItem).toHaveBeenCalledTimes(1);
      expect(writes()).toEqual([[SORT_KEY, 'start']]);
    });

    it('스크림을 누르면 닫히기만 하고(순서·라벨 그대로 · 저장 0회) 탭바를 되돌린다', async () => {
      renderPage();
      await loaded();
      openSheet();
      expect(screen.getByTestId('my-trips-sort-sheet')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('my-trips-sort-scrim'));
      await settle();

      expect(screen.queryByTestId('my-trips-sort-sheet')).toBeNull();
      expect(cardOrder()).toEqual(RECENT);
      expect(trigger()).toHaveTextContent('최신순');
      expect(mockSetItem).not.toHaveBeenCalled();
      expect(mockSetOptions).toHaveBeenLastCalledWith({
        tabBarStyle: undefined,
      });
    });

    it('시트가 열려 있는 동안 하단 탭바를 숨기고, 옵션을 골라 닫히면 되돌린다', async () => {
      // ⚠️ 탭바가 실제로 사라지는지는 jest 사각(6-b 실기) — 옵션 호출만 잰다.
      renderPage();
      await loaded();
      expect(mockSetOptions).not.toHaveBeenCalledWith({
        tabBarStyle: { display: 'none' },
      });

      openSheet();
      expect(mockSetOptions).toHaveBeenLastCalledWith({
        tabBarStyle: { display: 'none' },
      });
      fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));
      await settle();
      expect(mockSetOptions).toHaveBeenLastCalledWith({
        tabBarStyle: undefined,
      });
    });

    it('시트가 열린 채 화면이 사라져도 탭바를 되돌린다', async () => {
      const view = renderPage();
      await loaded();
      openSheet();
      expect(mockSetOptions).toHaveBeenLastCalledWith({
        tabBarStyle: { display: 'none' },
      });
      view.unmount();
      expect(mockSetOptions).toHaveBeenLastCalledWith({
        tabBarStyle: undefined,
      });
    });

    it('기기에 남은 기준을 읽으면 그 기준으로 다시 선다 — 읽기 전엔 최신순, 저장 0회', async () => {
      let arrive!: (value: string) => void;
      storedSort(
        () =>
          new Promise<string>((resolve) => {
            arrive = resolve;
          })
      );
      renderPage();
      await loaded();
      expect(cardOrder()).toEqual(RECENT);

      await act(async () => {
        arrive('title');
      });
      await waitFor(() => expect(cardOrder()).toEqual(TITLE));
      expect(trigger()).toHaveTextContent('이름순');
      expect(mockGetItem.mock.calls.map((call) => call[0])).toContain(SORT_KEY);
      expect(mockSetItem).not.toHaveBeenCalled();
    });

    it.each<[string, () => Promise<unknown>]>([
      ['읽기 reject', () => Promise.reject(new Error('keychain'))],
      ['모르는 값', () => Promise.resolve('foo')],
      ['undefined', () => Promise.resolve(undefined)],
    ])('저장값이 %s 이면 최신순으로 접는다 (INV-4)', async (_label, read) => {
      storedSort(read);
      renderPage();
      await loaded();

      expect(cardOrder()).toEqual(RECENT);
      expect(trigger()).toHaveTextContent('최신순');
    });

    it('읽기 대기 중 사용자가 이름순을 고르면, 늦게 온 저장값("start")이 그 선택을 덮지 않는다', async () => {
      let arrive!: (value: string) => void;
      storedSort(
        () =>
          new Promise<string>((resolve) => {
            arrive = resolve;
          })
      );
      renderPage();
      await loaded();
      openSheet();
      fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));
      await act(async () => {
        arrive('start');
      });
      await settle();

      expect(cardOrder()).toEqual(TITLE);
      expect(trigger()).toHaveTextContent('이름순');
      expect(writes()).toEqual([[SORT_KEY, 'title']]);
    });

    it('여행 중은 이름순에서도 맨 위다', async () => {
      const L = mk('L', '제주 여행', {
        startDate: '2020-01-01',
        endDate: '2099-12-31',
        updatedAt: '2026-07-01T00:00:00.000Z',
      });
      // 최신순이면 L·Z2·Y2 — 이름순(L·Y2·Z2)과 구분되게 Z2 를 더 최근으로.
      const Y2 = mk('Y2', '강릉 여행', {
        startDate: '2099-03-01',
        endDate: '2099-03-01',
        updatedAt: '2026-09-10T00:00:00.000Z',
      });
      const Z2 = mk('Z2', '부산 여행', {
        startDate: '2099-04-01',
        endDate: '2099-04-01',
        updatedAt: '2026-09-20T00:00:00.000Z',
      });
      serve([Z2, L, Y2], { L: done('L'), Y2: done('Y2'), Z2: done('Z2') });
      renderPage();
      expect(await screen.findByTestId('my-trip-badge-L')).toHaveTextContent(
        '여행 중'
      );
      await settle();

      openSheet();
      fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));
      await settle();

      // 고정이 없었다면 Y2·Z2·L, 이름순이 안 먹었다면 L·Z2·Y2.
      expect(cardOrder()).toEqual([
        'my-trip-card-L',
        'my-trip-card-Y2',
        'my-trip-card-Z2',
      ]);
      expect(trigger()).toHaveTextContent('이름순');
    });

    it('고른 기준은 다시 들어와도 남는다 — 쓴 키로 읽는다', async () => {
      const vault = new Map<string, string>();
      mockGetItem.mockImplementation((key: string) =>
        key === SORT_KEY
          ? Promise.resolve(vault.get(key) ?? null)
          : new Promise(() => {})
      );
      mockSetItem
        .mockReset()
        .mockImplementation(async (k: string, v: string) => {
          vault.set(k, v);
        });
      const first = renderPage();
      await loaded();
      openSheet();
      fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));
      await settle();
      first.unmount();

      renderPage();
      await loaded();
      await waitFor(() => expect(cardOrder()).toEqual(TITLE));
      expect(trigger()).toHaveTextContent('이름순');
    });
  });
});
