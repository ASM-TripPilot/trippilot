import type { ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { ScrollView } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { http, HttpResponse } from 'msw';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import {
  DRAFT_POLL_INTERVAL_MS,
  ITINERARY_OPEN_FAILED_TOAST_ID,
} from '@/features/itinerary';
import { server } from '@/mocks/server';
import { getGetTripsQueryKey } from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Itinerary, Trip } from '@/shared/api/index.schemas';
import { MyTripsListPage } from '@/pages/itinerary/itinerary-list';
import * as fontScaleModule from '@/shared/lib/fontScale';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { readIdSet, writeIdSet } from '@/shared/storage';
import { describeAtFontScales, setFontScale } from '@/test-support/fontScale';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import {
  NO_ITINERARY,
  itineraryCols,
  itineraryHits,
  listHits,
  type ItineraryCols,
} from '@/test-support/tripItineraryCols';

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
 * TRIP-1618 · 생성 중 폴링은 이 페이지의 몫이 아니라 앱 셸 훅(`useGenerationWatch`)의 몫으로 옮겼다. 그래서 폴링으로 카드가 바뀌는 케이스는
 * 셸 훅 프로브(`ShellProbe`)를 페이지 옆에 함께 그려서 보고, 페이지 단독 렌더에서는 폴링이 없다는 것(AC4①)을 따로 잰다.
 *
 * ⚠️ 딤이 화면 전체를 실제로 덮는지·가운데 오는지·뒤 터치를 막는지는 jest 사각(repo-traps 오버레이 절) — 6-b.
 */

const mockPush = jest.fn();
/** TRIP-1618 — 셸 훅 프로브가 읽는 현재 경로. 이 페이지는 일정 탭이므로 기본 `/itinerary` 다(그 경로에선 토스트를 생략한다). */
let mockPathname = '/itinerary';
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
    // TRIP-1618 — 셸 훅 프로브(`ShellProbe`)가 읽는 둘: 현재 경로와 명령형 이동.
    usePathname: () => mockPathname,
    router: { push: mockPush },
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
// TRIP-1786 · 「맨 위에 고정」 저장소 — 같은 idSet 목이 키로 갈라 응답한다(안 가르면 완료 배너 seen 값이 고정 집합으로 읽혀 두 기능이 서로를 오염한다).
const PINNED_KEY = 'itinerary.myTrips.pinned';
let mockPinned: string[] = [];
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

function trip(
  tripId: string,
  title: string,
  updatedAt: string,
  /** TRIP-1677 — 서버가 `GET /trips` 에 싣는 일정 상태 네 칸. 기본은 일정 없음. */
  cols: ItineraryCols = NO_ITINERARY
): Trip {
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
    ...cols,
  };
}

const CONFIRMED_B: Itinerary = {
  itineraryId: 'itin-b',
  tripId: B,
  status: 'CONFIRMED',
  solveMode: 'FULL_AI',
  generationMode: 'FULLY_AI',
  isFallback: false,
  scoringMode: null,
  degradations: [],
  generationState: 'COMPLETE',
  generationSessionId: null,
  days: [{ date: '2099-06-10', slots: [] }],
};

/** A = 작성중(일정 없음 = 목록 네 칸 null) · B = 확정. A 가 더 최근이라 목록 맨 위. */
const TRIP_A = trip(A, '부산 여행', '2026-09-02T00:00:00Z');
const TRIP_B = trip(
  B,
  '제주 여행',
  '2026-09-01T00:00:00Z',
  itineraryCols(CONFIRMED_B)
);
/** C = 작성중(일정 없음). 셋 중 가장 오래돼 목록 맨 아래 — "첫 카드가 아닌" 삭제 대상(5-b 경고-1·4). */
const TRIP_C = trip(C, '강릉 여행', '2026-08-31T00:00:00Z');

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
  mockPathname = '/itinerary';
  mockSeen = [];
  mockPinned = [];
  (readIdSet as jest.Mock)
    .mockReset()
    .mockImplementation(async (key: string) =>
      key === PINNED_KEY ? [...mockPinned] : [...mockSeen]
    );
  (writeIdSet as jest.Mock)
    .mockReset()
    .mockImplementation(async (key: string, ids: readonly string[]) => {
      if (key === PINNED_KEY) mockPinned = [...ids];
      else mockSeen = [...ids];
    });
  (SecureStore.getItemAsync as jest.Mock).mockReset();
  (SecureStore.setItemAsync as jest.Mock)
    .mockReset()
    .mockResolvedValue(undefined);
  clearAccessToken();
  setAccessToken('valid-access');
  server.use(
    // TRIP-1677 — 일정 상태는 목록 응답의 네 칸에 실려 온다. 여행별 `GET /trips/:id/itinerary` 핸들러는 일부러 두지 않는다:
    // 페이지가 옛 길로 일정을 물으면 통합 서버(`onUnhandledRequest: 'error'`)가 그 요청에서 바로 빨갛게 만든다.
    http.get(`${BASE}/trips`, () => HttpResponse.json(serverTrips)),
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
  // 모듈 싱글턴 — 연타 가드 창과 토스트 스토어는 파일 안에서 새므로 최상위에서 되돌린다(02a ★2).
  resetPressGuard();
  resetToast();
  // TRIP-1271 — 폴링 describe 의 가짜 시계와 포커스 레지스트리가 아래 실타이머 케이스로 새지 않게.
  jest.useRealTimers();
  mockFocus.clear();
});

afterAll(() => server.close());

// TRIP-1638 — onlineManager 는 모듈 싱글턴이다. 오프라인 케이스가 어떻게 끝나든 다음 케이스는 온라인으로 시작한다(describe 안이 아니라 파일 최상위).
afterEach(() => {
  onlineManager.setOnline(true);
});

/** 마지막으로 렌더한 페이지의 QueryClient — 떠나 있는 사이 캐시가 바뀐 상황을 만들 때만 쓴다(TRIP-1352). */
let lastClient: QueryClient | null = null;

/** `cached` — 다른 탭(홈)이 이미 받아 둔 여행 목록을 캐시에 넣고 시작한다. 일정 상태도 이 목록의 네 칸에 실려 있다(TRIP-1677). */
function renderPage(
  cached?: { trips: Trip[] },
  /**
   * `staleTime` — 기본 0(앱 기본값). 탭 복귀가 "낡은 것만" 다시 묻는지 볼 때만 올린다(TRIP-1348).
   * `shell` — 앱 셸 감시 훅(`useGenerationWatch`)을 페이지 옆에 함께 그린다(TRIP-1618). 셸이 붙으면 새 관찰자가 낡은 목록을 마운트 즉시
   * 한 번 더 받으므로 요청 수를 세는 케이스는 `staleTime: 30_000` 과 함께 쓴다.
   * `toast` — 토스트 호스트를 함께 그린다(copick 누름 실패 안내를 볼 때만 — 다른 케이스의 트리를 건드리지 않는다).
   */
  options?: { staleTime?: number; shell?: boolean; toast?: boolean }
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
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {options?.toast ? <WithToastHost>{children}</WithToastHost> : children}
      </QueryClientProvider>
    );
  }
  return render(
    <>
      {options?.shell ? <ShellProbe /> : null}
      <MyTripsListPage />
    </>,
    { wrapper: Wrapper }
  );
}

/**
 * TRIP-1618 — 앱 셸(`SplashGate`)이 부르는 훅을 페이지 옆에서 부르는 프로브. 훅 모듈은 이미 있다 — 아래 `require` 와 두 번째 eslint-disable 은
 * 층 규칙(pages 는 app 을 import 하지 못한다)이 이 테스트 전용 역방향 참조를 막기 때문에 둔다. `require` 형태는 훅이 없던 red 단계의
 * 흔적이다(그때는 모듈이 없어 이 파일 전체가 import 실패로 죽는 걸 피하려 함수 안에서 늦게 불렀다).
 */
function ShellProbe(): null {
  // 테스트 전용 역방향 참조 — 셸 일원화(AC4)는 페이지와 셸 훅을 함께 그려야만 단언된다. 프로덕션 pages 는 app 을 import 하지 않는다.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-restricted-paths
  const { useGenerationWatch } = require('@/app/model/useGenerationWatch') as {
    useGenerationWatch: (drawn: boolean, destination: 'HOME') => void;
  };
  useGenerationWatch(true, 'HOME');
  return null;
}

/** 요청이 출발할 시간을 준다(02a §5-C 실측 — 30ms 한 번이면 DELETE 가 이미 잡힌다). */
async function settle(): Promise<void> {
  await act(() => new Promise((r) => setTimeout(r, 30)));
}

/** 탭을 떠난다(blur) — 등록된 포커스 콜백의 정리 함수를 부른다. 돌아올 때까지 포커스 콜백은 없는 셈이다. */
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
 * TRIP-1441 · 확정 B 의 ⋯ → '삭제' 까지 눌러 다이얼로그를 연다. B 의 일정이 도착해 배지 '확정'이 선 뒤에 ⋯ 를
 * 바로(get) 찾는다 — ⋯ 판정은 일정이 와야 의미가 있고, ⋯ 가 없으면 기다림 시간 초과가 아니라 "못 찾음"으로 바로
 * 실패한다(02a ★11).
 */
async function openDialogForB(): Promise<ReactTestInstance> {
  expect(await screen.findByTestId(`my-trip-badge-${B}`)).toHaveTextContent(
    '확정'
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

describe('TRIP-1508 · 삭제 확인창이 떠 있는 동안 탭바를 숨긴다', () => {
  // ⚠️ 탭바가 실제로 사라지는지·딤이 덮는지는 jest 사각(6-b 실기) — 옵션 호출만 잰다.
  it('확인창이 열리면 숨기고, 취소로 닫히면 되돌린다', async () => {
    renderPage();
    await openDialogForA();
    expect(mockSetOptions).toHaveBeenLastCalledWith({
      tabBarStyle: { display: 'none' },
    });

    fireEvent.press(screen.getByTestId('my-trip-delete-cancel'));
    await settle();
    expect(mockSetOptions).toHaveBeenLastCalledWith({ tabBarStyle: undefined });
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

// TRIP-1615 · `GET /trips` 조회 실패가 "아직 만든 여행이 없어요"로 접히던 문제(INV-4). 클라이언트 재시도 0 이라
// 실패 응답 1개 = 실패 1회다(앱 전역은 자동 재시도 3회 ≈7초 뒤 — jest 사각, 6-b).
// *(개념 — 응답 큐)* 요청이 올 때마다 줄 맨 앞 응답을 꺼내 돌려준다. 줄이 비면 평소 응답('ok')이다.
describe('TRIP-1615 · GET /trips 조회 실패 — "여행 없음"으로 접지 않고 오류 얼굴 + 다시 시도', () => {
  const ERROR = 'itinerary-tab-error';
  const RETRY = 'itinerary-tab-retry';
  const EMPTY = 'itinerary-tab-empty';
  const TRIPS_GET = 'GET /api/v1/trips';

  type TripsReply = 'ok' | 500 | 'network';
  let tripsReplies: TripsReply[] = [];

  beforeEach(() => {
    tripsReplies = [];
    // 바깥 beforeEach 의 평소 핸들러 위에 얹는다(server.use 는 앞에 끼운다) — 파일 최상위 afterEach 가 걷는다.
    server.use(
      http.get(`${BASE}/trips`, () => {
        const reply = tripsReplies.shift() ?? 'ok';
        if (reply === 'network') return HttpResponse.error();
        if (reply === 500) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: '서버 오류' } },
            { status: 500 }
          );
        }
        return HttpResponse.json(serverTrips);
      })
    );
  });

  function client(): QueryClient {
    if (!lastClient) throw new Error('renderPage 를 먼저 불러야 한다');
    return lastClient;
  }

  it.each<[string, TripsReply]>([
    ['서버 오류(500)', 500],
    ['네트워크 실패', 'network'],
  ])(
    '첫 조회가 %s 이면 오류 얼굴과 다시 시도가 보이고 empty·여행 만들기·정렬 줄·카드는 없다',
    async (_label, reply) => {
      // 준비
      tripsReplies = [reply];

      // 실행
      renderPage();

      // 단언 — 오류 얼굴이 먼저 도착해야 "empty 없음"이 의미가 있다(스켈레톤 단계에선 뭐든 없다, 02a ★1).
      const face = await screen.findByTestId(ERROR);
      expect(
        within(face).getByText('여행을 불러올 수 없어요')
      ).toBeOnTheScreen();
      expect(
        within(face).getByText('잠시 후 다시 시도해 주세요')
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId(RETRY)).getByText('다시 시도')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId(EMPTY)).toBeNull();
      expect(screen.queryByTestId('itinerary-tab-create-trip')).toBeNull();
      expect(screen.queryByTestId('my-trips-sort')).toBeNull();
      expect(screen.queryAllByTestId(/^my-trip-card-/)).toHaveLength(0);
    }
  );

  it('다시 시도를 누르면 목록을 한 번 더 받아 카드가 나타나고 오류 얼굴은 사라진다', async () => {
    // 준비 — 첫 GET 만 실패(줄이 비면 평소 응답). 오류 얼굴이 뜬 상태가 출발점이다(앵커).
    tripsReplies = [500, 'ok'];
    renderPage();
    await screen.findByTestId(ERROR);
    expect(count(TRIPS_GET)).toBe(1);

    // 실행
    fireEvent.press(screen.getByTestId(RETRY));

    // 단언 — 카드가 뜨고 오류 얼굴·버튼이 사라진다. 요청은 정확히 1번 늘었다(재시도 중 얼굴은 안 본다).
    expect(await screen.findByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`my-trip-card-${B}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(ERROR)).toBeNull();
    expect(screen.queryByTestId(RETRY)).toBeNull();
    await settle();
    expect(count(TRIPS_GET)).toBe(2);
  });

  it('다시 시도도 실패하면 오류 얼굴로 돌아오고 빈 얼굴로 접히지 않는다', async () => {
    // 준비 — 두 번 다 실패.
    tripsReplies = [500, 500];
    renderPage();
    await screen.findByTestId(ERROR);

    // 실행 — 누르고, 두 번째 500 응답이 실제로 돌아올 때까지 기다린다. 누른 직후엔 옛 오류 얼굴이 아직
    // 화면에 있어서 바로 단언하면 버튼이 아무것도 안 해도 통과한다(02a ★3).
    fireEvent.press(screen.getByTestId(RETRY));
    await waitFor(() =>
      expect(responses.filter((r) => r === `${TRIPS_GET} 500`)).toHaveLength(2)
    );
    await settle();

    // 단언
    expect(screen.getByTestId(ERROR)).toBeOnTheScreen();
    expect(screen.getByTestId(RETRY)).toBeOnTheScreen();
    expect(screen.queryByTestId(EMPTY)).toBeNull();
    expect(screen.queryAllByTestId(/^my-trip-card-/)).toHaveLength(0);
    expect(count(TRIPS_GET)).toBe(2);
  });

  it('목록을 이미 받은 뒤 재조회가 실패해도 카드는 그대로고 오류 얼굴은 없다 — 판정은 "데이터가 없다"', async () => {
    // 준비 — 첫 GET 성공(카드가 뜬다), 다음 GET 은 500.
    tripsReplies = ['ok', 500];
    renderPage();
    await screen.findByTestId(`my-trip-card-${A}`);

    // 실행 — 외부 무효화(삭제 성공·푸시 등이 하는 일)로 재조회를 일으킨다.
    await act(async () => {
      await client().invalidateQueries({ queryKey: getGetTripsQueryKey() });
    });

    // 단언 ① — 앵커: 재조회가 실제로 실패했고(error) 받아 둔 데이터는 남았다(02a ★4·★5).
    expect(count(TRIPS_GET)).toBe(2);
    expect(client().getQueryState(getGetTripsQueryKey())?.status).toBe('error');
    expect(client().getQueryData(getGetTripsQueryKey())).toHaveLength(2);
    await settle();

    // 단언 ② — 그 위에서 화면은 목록을 유지한다.
    expect(screen.getByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`my-trip-card-${B}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(ERROR)).toBeNull();
    expect(screen.queryByTestId(RETRY)).toBeNull();
    expect(screen.queryByTestId(EMPTY)).toBeNull();
  });

  it('서버가 준 진짜 0건은 오류가 아니라 빈 얼굴이다 (선제 green)', async () => {
    // 준비
    serverTrips = [];

    // 실행
    renderPage();

    // 단언
    expect(await screen.findByTestId(EMPTY)).toBeOnTheScreen();
    expect(screen.queryByTestId(ERROR)).toBeNull();
    expect(screen.queryByTestId(RETRY)).toBeNull();
    expect(count(TRIPS_GET)).toBe(1);
    // 빈 얼굴엔 정렬 줄이 없다(옛 MyTripsListScreen.test 이전 — B안).
    expect(screen.queryByTestId('my-trips-sort')).toBeNull();
  });

  // TRIP-1775 — 빈 얼굴 [여행 만들기]: 창 안의 둘째 탭은 위저드를 한 번 더 쌓지 않는다.
  it('빈 얼굴 [여행 만들기]를 빠르게 두 번 눌러도 step1 은 한 번만 쌓인다', async () => {
    serverTrips = [];

    renderPage();
    const button = await screen.findByTestId('itinerary-tab-create-trip');
    fireEvent.press(button);
    fireEvent.press(button);

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });
});

// TRIP-1638 · 오프라인으로 처음 켜면(캐시 없음) 요청이 나가지도 않은 채 `pending + paused` 가 되어 스켈레톤이 영원히 남던 문제(INV-4).
// 오프라인 지원이 아니라 정직한 표시다 — "인터넷에 연결되어 있지 않아요" 얼굴(버튼 없음, 복귀는 자동)이고, 캐시가 있으면 목록 그대로다.
// *(개념 — paused)* 상태 두 축: status=데이터를 받아 봤나(pending), fetchStatus=요청이 지금 어떤가(paused=보류). 오프라인 첫 조회는 그 조합이다.
// `renderPage` 의 QueryClient 는 retry:false 라 "NetInfo 가 늦게 알려 요청이 한 번 실패한 뒤 paused" 레이스는 재현할 수 없다 — 렌더 전에
// `setOnline(false)` 를 부르는 직접 경로만 본다(레이스는 jest 사각, 6-b).
describe('TRIP-1638 · 오프라인 콜드스타트 — 스켈레톤 대신 오프라인 얼굴, 복귀하면 자동으로 채워진다', () => {
  const OFFLINE = 'itinerary-tab-offline';
  const TITLE_OFFLINE = '인터넷에 연결되어 있지 않아요';
  const DESC_OFFLINE = '연결되면 자동으로 불러올게요';
  const TRIPS_GET = 'GET /api/v1/trips';
  const SKELETON = 'my-trip-skeleton-1';

  /** 'gate' 면 테스트가 열 때까지 `GET /trips` 응답을 붙잡는다(온라인 느림 = fetching 상태를 만든다). */
  let tripsGate: (() => void)[] = [];
  let tripsReplies: ('ok' | 500 | 'gate')[] = [];

  beforeEach(() => {
    tripsGate = [];
    tripsReplies = [];
    server.use(
      http.get(`${BASE}/trips`, async () => {
        const reply = tripsReplies.shift() ?? 'ok';
        if (reply === 500) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: '서버 오류' } },
            { status: 500 }
          );
        }
        if (reply === 'gate') {
          await new Promise<void>((resolve) => tripsGate.push(resolve));
        }
        return HttpResponse.json(serverTrips);
      })
    );
  });

  // 단언이 문을 열기 전에 실패해도 붙잡힌 요청을 남기지 않는다 — 안 풀면 jest 가 red 대신 멈춘다.
  afterEach(() => {
    const waiting = tripsGate;
    tripsGate = [];
    waiting.forEach((open) => open());
  });

  function client(): QueryClient {
    if (!lastClient) throw new Error('renderPage 를 먼저 불러야 한다');
    return lastClient;
  }

  /** 지금 여행 목록 쿼리의 두 축 — 오프라인 콜드의 증거("요청이 아예 안 나갔다"는 히트 0 과 짝). */
  function tripsAxes(): { status?: string; fetchStatus?: string } {
    const state = client().getQueryState(getGetTripsQueryKey());
    return { status: state?.status, fetchStatus: state?.fetchStatus };
  }

  /** 오프라인으로 만든 뒤 그린다. 앞 케이스의 오프라인이 새지 않았음을 먼저 확인한다(02a ★1). */
  function goOffline(): void {
    expect(onlineManager.isOnline()).toBe(true);
    onlineManager.setOnline(false);
  }

  it('M1 오프라인으로 처음 켜면 스켈레톤 대신 오프라인 얼굴이 뜨고, 요청은 한 번도 안 나간다', async () => {
    // 준비
    goOffline();

    // 실행
    renderPage();

    // 단언 — 얼굴이 먼저 도착해야 아래 "없음" 단언이 의미가 있다(02a ★4).
    const face = await screen.findByTestId(OFFLINE);
    expect(within(face).getByText(TITLE_OFFLINE)).toBeOnTheScreen();
    expect(within(face).getByText(DESC_OFFLINE)).toBeOnTheScreen();
    // 화면 틀(제목 "내 여행")은 그대로고 얼굴은 그 안에 앉는다.
    expect(
      within(screen.getByTestId('itinerary-tab-root')).getByTestId(OFFLINE)
    ).toBeOnTheScreen();
    // 보류 요청에 refetch 는 무동작이다 — 버튼을 두면 "눌렀는데 아무 일도 없는" 새 침묵 실패(D4).
    expect(within(face).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId(SKELETON)).toBeNull();
    expect(screen.queryByTestId('itinerary-tab-error')).toBeNull();
    expect(screen.queryByTestId('itinerary-tab-empty')).toBeNull();
    expect(screen.queryByTestId('itinerary-tab-create-trip')).toBeNull();
    expect(screen.queryByTestId('my-trips-sort')).toBeNull();
    expect(screen.queryAllByTestId(/^my-trip-card-/)).toHaveLength(0);
    // 증거 — 요청이 안 나갔고(보류), 데이터는 못 받았다.
    expect(count(TRIPS_GET)).toBe(0);
    expect(tripsAxes()).toEqual({ status: 'pending', fetchStatus: 'paused' });
  });

  it('M2 온라인으로 돌아오면 사용자가 아무것도 안 해도 목록이 채워지고 오프라인 얼굴은 사라진다', async () => {
    // 준비 — 오프라인 얼굴이 떠 있는 상태가 출발점(앵커).
    goOffline();
    renderPage();
    await screen.findByTestId(OFFLINE);
    expect(count(TRIPS_GET)).toBe(0);

    // 실행 — 입력 없이 연결만 돌아온다.
    act(() => {
      onlineManager.setOnline(true);
    });

    // 단언 — 복귀 후 화면 갱신은 비동기라 카드가 보일 때까지 기다린다(02a ★6).
    expect(await screen.findByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`my-trip-card-${B}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
    await settle();
    expect(count(TRIPS_GET)).toBe(1);
  });

  it('M3 (선제 green) 받아 둔 목록이 있으면 오프라인이어도 목록 그대로 — 오프라인 얼굴은 없다', async () => {
    // 준비 — 다른 탭이 이미 받아 둔 여행 목록. 상태는 success + paused(데이터 있음 + 보류).
    goOffline();

    // 실행
    renderPage({ trips: [TRIP_A, TRIP_B] });

    // 단언
    expect(await screen.findByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`my-trip-card-${B}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
    // 앵커 — "데이터가 있고 보류 중"이라는 바로 그 상태를 시험했다.
    await settle();
    expect(tripsAxes()).toEqual({ status: 'success', fetchStatus: 'paused' });
    expect(count(TRIPS_GET)).toBe(0);
  });

  it('M4 (선제 green) 온라인에서 응답이 느린 것은 오프라인이 아니다 — 스켈레톤이 정상이고 얼굴은 없다', async () => {
    // 준비 — 응답을 붙잡아 fetching 상태를 만든다.
    tripsReplies = ['gate'];

    // 실행
    renderPage();
    await waitFor(() => expect(count(TRIPS_GET)).toBe(1));

    // 단언 — 요청이 나가는 중이다(앵커: fetching ≠ paused).
    expect(tripsAxes()).toEqual({ status: 'pending', fetchStatus: 'fetching' });
    expect(screen.getByTestId(SKELETON)).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();

    // 실행 — 응답이 오면 목록으로 바뀐다.
    act(() => {
      tripsGate.forEach((open) => open());
    });
    expect(await screen.findByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
  });

  it('M5 (선제 green) 온라인 500 은 오프라인 얼굴이 아니라 기존 오류 얼굴이다', async () => {
    // 준비
    tripsReplies = [500];

    // 실행
    renderPage();

    // 단언 — 오류 얼굴은 버튼이 하나(다시 시도)다: 같은 쿼리로 M1 의 "버튼 0" 이 항상 0 이 아님을 대조한다(02a ★5).
    const error = await screen.findByTestId('itinerary-tab-error');
    expect(within(error).queryAllByRole('button')).toHaveLength(1);
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
  });

  it('M6 오류 얼굴이 떠 있다가 오프라인에서 다시 시도를 눌러도 오류 얼굴이 아니라 오프라인 얼굴이 이긴다 — 요청은 늘지 않는다', async () => {
    // 준비 — 온라인 500 으로 오류 얼굴(앵커: 히트 1).
    tripsReplies = [500];
    renderPage();
    await screen.findByTestId('itinerary-tab-error');
    expect(count(TRIPS_GET)).toBe(1);

    // 실행 — 연결이 끊긴 채 다시 시도. 데이터 없는 쿼리의 refetch 는 status 를 pending 으로 되돌려 isError 가 거짓이 된다.
    act(() => {
      onlineManager.setOnline(false);
    });
    fireEvent.press(screen.getByTestId('itinerary-tab-retry'));

    // 단언 — 판독이 오류 분기보다 앞이어야 보인다(02a ★7).
    const face = await screen.findByTestId(OFFLINE);
    expect(within(face).getByText(TITLE_OFFLINE)).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-tab-error')).toBeNull();
    expect(screen.queryByTestId('itinerary-tab-retry')).toBeNull();
    await settle();
    expect(count(TRIPS_GET)).toBe(1);

    // 실행 — 연결 복귀.
    act(() => {
      onlineManager.setOnline(true);
    });

    // 단언 — 보류돼 있던 재시도가 나가 목록이 채워진다.
    expect(await screen.findByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
    await settle();
    expect(count(TRIPS_GET)).toBe(2);
  });
});

// TRIP-1677 · 일정 상태(확정 여부·생성 상태·생성 방식·생성 중 여부)는 `GET /trips` 의 각 여행에 네 칸으로 실려 온다. 그래서 목록 화면은
// 여행마다 `GET /trips/{id}/itinerary` 를 묻지 않는다(여행이 N개면 N번 나가던 요청 → 개발 서버 429). 아래 describe 들은 그 약속을 요청 수로 잰다.
//
// *(개념)* "요청 수" — 테스트 서버(MSW)가 받은 요청을 `hits` 에 쌓고 `listHits`(목록) · `itineraryHits`(일정 단건)로 센다.
// 일정 단건 핸들러는 파일 최상위에 일부러 없다 — 나가면 통합 서버가 그 자리에서 빨갛게 만든다(copick 누름 케이스만 자기 핸들러를 건다).
describe('🔴 TRIP-1677 · 진입하면 목록 1번만 묻고 일정 단건은 묻지 않는다 (AC-1·2)', () => {
  const RUN = 'run-1';
  const DRAFT = 'draft-1';
  const mkTrip = (id: string, title: string, cols: ItineraryCols) =>
    trip(id, title, '2026-08-10T00:00:00Z', cols);
  const running = itineraryCols({
    status: 'PLANNED',
    generationState: 'PARTIAL',
    generationMode: 'FULLY_AI',
    generationSessionId: 'sess-1',
  });
  const draft = itineraryCols({
    status: 'PLANNED',
    generationState: 'COMPLETE',
    generationMode: 'FULLY_AI',
    generationSessionId: null,
  });

  it('L1 일정 없음·생성 중·완료 초안·확정 네 여행 → 목록 GET 1 · 일정 GET 0, 카드 얼굴은 목록 칸대로 선다', async () => {
    // 준비 — 네 여행: A 일정 없음(null) · RUN 생성 중 · DRAFT 완료 초안 · B 확정.
    serverTrips = [
      TRIP_A,
      mkTrip(RUN, '여수 여행', running),
      mkTrip(DRAFT, '강릉 여행', draft),
      TRIP_B,
    ];

    // 실행 — 일정 탭을 연다.
    renderPage();
    expect(await screen.findByTestId(`my-trip-card-${B}`)).toBeOnTheScreen();
    await settle();

    // 단언 — 요청: 목록 1번뿐, 일정 단건 0번(여행이 몇 개든).
    expect(listHits(hits)).toBe(1);
    expect(itineraryHits(hits)).toBe(0);
    // 단언 — 얼굴: null 행과 값 행이 모두 있어 "전부 일정 없음으로 읽는" 회귀를 가른다.
    expect(screen.getByTestId(`my-trip-extra-${A}`)).toHaveTextContent(
      '아직 일정이 없어요'
    );
    expect(screen.getByTestId(`my-trip-extra-${RUN}`)).toHaveTextContent(
      'AI가 일정을 짜는 중'
    );
    expect(screen.getByTestId(`my-trip-extra-${DRAFT}`)).toHaveTextContent(
      '추천안 준비 중'
    );
    expect(screen.getByTestId(`my-trip-extra-${B}`)).toHaveTextContent(
      '일정 확정'
    );
  });
});

describe('🔴 TRIP-1677 · 카드를 누르면 목적지로 간다 — copick 만 그 순간 일정을 1번 묻는다 (AC-3)', () => {
  const X = 'x-trip';
  const P = 'copick-trip';
  const cols = (
    generationState: ItineraryCols['itineraryGenerationState'],
    status: ItineraryCols['itineraryStatus'],
    mode: ItineraryCols['itineraryGenerationMode'] = 'FULLY_AI',
    generating = false
  ): ItineraryCols => ({
    itineraryStatus: status,
    itineraryGenerationState: generationState,
    itineraryGenerationMode: mode,
    itineraryGenerating: generating,
  });
  const one = (id: string, c: ItineraryCols) => [
    trip(id, '여수 여행', '2026-08-10T00:00:00Z', c),
  ];

  it.each<[string, ItineraryCols, string]>([
    ['일정 없음(null)', NO_ITINERARY, `/trips/${X}/itinerary/method`],
    [
      '생성 중 + 완전 AI',
      cols('PARTIAL', 'PLANNED', 'FULLY_AI', true),
      `/trips/${X}/itinerary/generating`,
    ],
    [
      '생성 중 + 직접 짜기',
      cols('PARTIAL', 'PLANNED', 'MANUAL', true),
      `/trips/${X}/itinerary/generating`,
    ],
    ['실패 FAILED', cols('FAILED', 'PLANNED'), `/trips/${X}/itinerary/draft`],
    [
      '완료 초안 COMPLETE + PLANNED',
      cols('COMPLETE', 'PLANNED'),
      `/trips/${X}/itinerary/draft`,
    ],
    ['확정 CONFIRMED', cols('COMPLETE', 'CONFIRMED'), `/trips/${X}/live`],
    [
      '같이 짜기 완성(COMPLETE + CO_PLAN + 미확정)',
      cols('COMPLETE', 'PLANNED', 'CO_PLAN'),
      `/trips/${X}/itinerary/copick/complete`,
    ],
  ])('L3 %s → push 정확히 1회 · 일정 GET 0', async (_label, c, href) => {
    // 준비
    serverTrips = one(X, c);
    renderPage();
    const card = await screen.findByTestId(`my-trip-card-${X}`);
    await settle();
    expect(mockPush).not.toHaveBeenCalled();

    // 실행
    fireEvent.press(card);
    await settle();

    // 단언 — 일정을 묻지 않고 곧바로 한 번 이동한다.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe(href);
    expect(itineraryHits(hits)).toBe(0);
  });

  describe('copick(같이 짜기 생성 중) — 첫 비고정 슬롯 키는 일정의 days 에만 있다', () => {
    const copickCols = cols('PARTIAL', 'PLANNED', 'CO_PLAN', true);
    const slot = (poiId: string, isFixed: boolean) => ({
      poiId,
      startAt: '09:00:00',
      endAt: '10:00:00',
      isFixed,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
    });
    const copickItinerary = (over: Partial<Itinerary> = {}): Itinerary => ({
      ...CONFIRMED_B,
      itineraryId: 'itin-p',
      tripId: P,
      status: 'PLANNED',
      generationMode: 'CO_PLAN',
      generationState: 'PARTIAL',
      generationSessionId: 'sess-1',
      days: [
        {
          date: '2099-06-10',
          slots: [slot('hotel', true), slot('poi-1', false)],
        },
      ],
      ...over,
    });
    const COPICK_HREF = `/trips/${P}/itinerary/copick/${encodeURIComponent('2099-06-10#poi-1')}`;

    /** 이 케이스만의 일정 단건 핸들러 — `gate` 를 열 때까지 응답을 붙잡을 수 있다. */
    let reply: Itinerary | 404 | 500 = copickItinerary();
    let openGate: () => void = () => {};
    let gate: Promise<void> | null = null;
    function holdReply(): void {
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
    }
    beforeEach(() => {
      reply = copickItinerary();
      gate = null;
      openGate = () => {};
      serverTrips = one(P, copickCols);
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
          if (gate) await gate;
          if (reply === 404 || reply === 500) {
            return HttpResponse.json(
              { error: { code: 'X', message: 'x' } },
              { status: reply }
            );
          }
          return HttpResponse.json(reply);
        })
      );
    });
    afterEach(() => openGate()); // 붙잡힌 응답을 남기지 않는다.

    it('L3 누르기 전 0 → 누르면 일정 GET 1, 응답 전엔 이동 0 → 응답 뒤 첫 비고정 슬롯(# 는 %23)으로 1회', async () => {
      // 준비 — 응답을 붙잡아 "응답 전"을 만든다.
      holdReply();
      renderPage();
      const card = await screen.findByTestId(`my-trip-card-${P}`);
      await settle();
      expect(itineraryHits(hits)).toBe(0); // 앵커 — 진입만으로는 안 묻는다.

      // 실행 ① — 누른다.
      fireEvent.press(card);
      await waitFor(() => expect(itineraryHits(hits)).toBe(1));

      // 단언 ① — 응답 전: 이동 없음(로딩 중 엉뚱한 곳으로 새지 않는다).
      expect(mockPush).not.toHaveBeenCalled();

      // 실행 ② — 응답이 온다.
      openGate();
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

      // 단언 ② — 인코딩된 리터럴을 손으로 적는다.
      expect(String(mockPush.mock.calls[0][0])).toBe(COPICK_HREF);
      expect(itineraryHits(hits)).toBe(1);
    });

    it('L3 연타 — 같은 틱에 두 번 눌러도 일정 GET 1 · push 1', async () => {
      holdReply();
      renderPage();
      const card = await screen.findByTestId(`my-trip-card-${P}`);
      await settle();
      expect(itineraryHits(hits)).toBe(0); // 앵커 — 누르기 전엔 묻지 않는다.

      fireEvent.press(card);
      fireEvent.press(card);
      openGate();
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      await settle();

      expect(itineraryHits(hits)).toBe(1);
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it('L3 잠금 — 응답을 기다리는 동안 연타 창(400ms)이 닫힌 뒤 다시 눌러도 일정 GET 1 · push 1 (W3)', async () => {
      // 준비 — 같은 틱 연타는 `guardPress` 창이 먼저 막아 처리 중 잠금(`openingRef`)을 못 겨눈다. 그래서 창을 일부러 닫고 다시 누른다.
      holdReply();
      renderPage();
      const card = await screen.findByTestId(`my-trip-card-${P}`);
      await settle();
      expect(itineraryHits(hits)).toBe(0); // 앵커 — 누르기 전엔 묻지 않는다.

      // 실행 — 한 번 누르고 응답 전에 창을 닫은 뒤 두 번 더 누른다.
      fireEvent.press(card);
      await waitFor(() => expect(itineraryHits(hits)).toBe(1));
      resetPressGuard();
      fireEvent.press(card);
      resetPressGuard();
      fireEvent.press(card);
      await settle();

      // 단언 ① — 응답 전: 일정 GET 은 그대로 1, 이동 0.
      expect(itineraryHits(hits)).toBe(1);
      expect(mockPush).not.toHaveBeenCalled();

      // 실행 ② — 응답이 온다.
      openGate();
      await waitFor(() => expect(mockPush).toHaveBeenCalled());
      await settle();

      // 단언 ② — 이동은 한 번(두 번 쌓이면 슬롯 채우기 화면이 스택에 두 번 올라간다).
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(String(mockPush.mock.calls[0][0])).toBe(COPICK_HREF);
    });

    it('L3 그사이 생성이 끝났으면(응답이 COMPLETE + CO_PLAN) 재판정해 완성 확인으로 간다 — 첫 슬롯 키로 새지 않는다', async () => {
      reply = copickItinerary({ generationState: 'COMPLETE' });
      renderPage();
      const card = await screen.findByTestId(`my-trip-card-${P}`);
      await settle();
      expect(itineraryHits(hits)).toBe(0); // 앵커 — 누르기 전엔 묻지 않는다.
      fireEvent.press(card);
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(itineraryHits(hits)).toBe(1);

      expect(String(mockPush.mock.calls[0][0])).toBe(
        `/trips/${P}/itinerary/copick/complete`
      );
    });

    it('L3 일정이 그사이 사라졌으면(404) 방식 선택으로 간다', async () => {
      reply = 404;
      renderPage();
      const card = await screen.findByTestId(`my-trip-card-${P}`);
      await settle();
      expect(itineraryHits(hits)).toBe(0); // 앵커 — 누르기 전엔 묻지 않는다.
      fireEvent.press(card);
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(itineraryHits(hits)).toBe(1);

      expect(String(mockPush.mock.calls[0][0])).toBe(
        `/trips/${P}/itinerary/method`
      );
    });

    it('L3 조회가 500 이면 이동하지 않고 안내를 띄운다(INV-4) — 다시 누르면 다시 묻는다', async () => {
      // 준비 — 500.
      reply = 500;
      renderPage(undefined, { toast: true });
      const card = await screen.findByTestId(`my-trip-card-${P}`);
      await settle();
      expect(screen.queryByTestId(ITINERARY_OPEN_FAILED_TOAST_ID)).toBeNull(); // 앵커

      // 실행 ① — 누른다.
      fireEvent.press(card);
      await waitFor(() =>
        expect(
          screen.getByTestId(ITINERARY_OPEN_FAILED_TOAST_ID)
        ).toBeOnTheScreen()
      );

      // 단언 ① — 이동 0, 요청 1(재시도 없음: 이 호출만 `retry:false`).
      expect(mockPush).not.toHaveBeenCalled();
      expect(itineraryHits(hits)).toBe(1);

      // 실행 ② — 서버가 돌아왔고(연타 창이 지난 뒤) 다시 누른다.
      reply = copickItinerary();
      resetPressGuard();
      fireEvent.press(card);
      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

      // 단언 ② — 다시 물었고(2) 이동은 한 번.
      expect(itineraryHits(hits)).toBe(2);
      expect(String(mockPush.mock.calls[0][0])).toBe(COPICK_HREF);
    });
  });
});

// TRIP-1271 · 생성이 끝났는데 카드가 "AI가 일정을 짜는 중"으로 남던 문제 — 목록이 스스로 갱신된다.
// TRIP-1618 · 생성 중 폴링은 앱 셸 훅(`useGenerationWatch`)의 몫이다 — 이 describe 의 폴링 케이스는 셸 프로브(`shell: true`)를 함께 그려서 본다.
// TRIP-1677 · 셸은 이제 일정 캐시가 아니라 **목록 한 건**을 간격 폴링한다(목록에 생성 중 여행이 있을 때만). 탭 복귀 재조회도 목록 한 건이다.
describe('생성 중 여행 — 셸 감시(목록 폴링)와 페이지의 탭 복귀 재조회', () => {
  const POLL = DRAFT_POLL_INTERVAL_MS;
  const RUNNING_TEXT = 'AI가 일정을 짜는 중';
  const R = 'run-1';
  const D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  const colsOf = (
    generationState: NonNullable<ItineraryCols['itineraryGenerationState']>,
    status: NonNullable<ItineraryCols['itineraryStatus']>,
    generating: boolean
  ): ItineraryCols =>
    itineraryCols({
      status,
      generationState,
      generationMode: 'FULLY_AI',
      generationSessionId: generating ? 'sess-1' : null,
    });
  const RUNNING = colsOf('PARTIAL', 'PLANNED', true);
  const DRAFT = colsOf('COMPLETE', 'PLANNED', false);
  const FAILED = colsOf('FAILED', 'PLANNED', false);
  const CONFIRMED = colsOf('COMPLETE', 'CONFIRMED', false);
  const tripR = (cols: ItineraryCols) =>
    trip(R, '여수 여행', '2026-08-30T00:00:00Z', cols);

  beforeEach(() => {
    jest.useFakeTimers();
  });

  /** 가짜 시계를 ms 만큼 흘리고, 그 사이 요청·응답(msw→axios→TanStack) 약속을 함께 푼다. */
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  /** 셸 감시를 함께 그리는 옵션 — staleTime 30초는 운영 전역과 같고, 셸의 새 관찰자가 첫 응답을 곧바로 다시 받지 않게 한다. */
  const WITH_SHELL = { shell: true, staleTime: 30_000 };

  /** 렌더 + 첫 조회 왕복 — 100ms 는 폴링 간격(2초)보다 한참 짧다. */
  async function load(options?: {
    staleTime?: number;
    shell?: boolean;
  }): Promise<void> {
    renderPage(undefined, options);
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

  describe('🔴 AC-6 · (셸 감시와 함께) 생성이 끝나면 화면을 떠나지 않아도 카드가 바뀌고, 그 뒤엔 더 묻지 않는다', () => {
    it.each<[string, ItineraryCols, string, boolean]>([
      ['완료(COMPLETE + PLANNED)', DRAFT, '추천안 준비 중', true],
      ['실패(FAILED + PLANNED)', FAILED, '추천안 준비 중', true],
      ['확정(COMPLETE + CONFIRMED)', CONFIRMED, '일정 확정', false],
    ])(
      '%s 로 끝나면 낡은 "짜는 중"이 끝난 얼굴로 바뀐다',
      async (_label, terminal, faceText, hasResume) => {
        // 준비 — R 은 생성 중. 첫 조회 1번에 "짜는 중" 얼굴(앵커). 셸 훅 프로브가 옆에서 목록을 감시한다.
        serverTrips = [tripR(RUNNING), TRIP_B];
        await load(WITH_SHELL);
        expect(screen.getByTestId(`my-trip-extra-${R}`)).toHaveTextContent(
          RUNNING_TEXT
        );
        expect(listHits(hits)).toBe(1);

        // 실행 ① — 서버에서 생성이 끝나고, 폴링 간격 하나가 지난다.
        serverTrips = [tripR(terminal), TRIP_B];
        await advance(POLL + 100);

        // 단언 ① — 낡은 "짜는 중"이 내려가고 끝난 얼굴이 된다. 목록만 한 번 더 물었다.
        expect(screen.getByTestId(`my-trip-extra-${R}`)).toHaveTextContent(
          faceText
        );
        expect(screen.queryByText(RUNNING_TEXT)).toBeNull();
        if (hasResume) {
          expect(screen.getByTestId(`my-trip-resume-${R}`)).toBeOnTheScreen();
        } else {
          expect(screen.queryByTestId(`my-trip-resume-${R}`)).toBeNull();
        }
        expect(listHits(hits)).toBe(2);

        // 실행 ② — 간격 세 번이 더 지난다.
        await advance(POLL * 3);

        // 단언 ② — 종착에 닿았으니 더 묻지 않는다. 일정 단건은 처음부터 끝까지 0.
        expect(listHits(hits)).toBe(2);
        expect(itineraryHits(hits)).toBe(0);
      }
    );
  });

  describe('AC-6 · 생성이 도는 여행이 없으면 첫 조회 뒤에 더 묻지 않는다', () => {
    it('일정 없음·확정·완료 초안·실패 초안(전부 세션 없음) → (셸이 있어도) 간격 세 번이 지나도 목록은 1번', async () => {
      // 준비
      serverTrips = [
        TRIP_A,
        TRIP_B,
        trip(C, '강릉 여행', '2026-08-31T00:00:00Z', DRAFT),
        trip(D, '여수 여행', '2026-08-30T00:00:00Z', FAILED),
      ];
      await load(WITH_SHELL);
      expect(screen.getByTestId(`my-trip-card-${D}`)).toBeOnTheScreen();

      // 실행
      await advance(POLL * 3);

      // 단언
      expect(listHits(hits)).toBe(1);
      expect(itineraryHits(hits)).toBe(0);
    });
  });

  describe('AC-5 · 탭 복귀 재조회는 목록 한 건이다 (첫 포커스는 건너뜀)', () => {
    it('처음 열 때(첫 포커스) 첫 조회를 겹쳐 보내지 않는다 — 홈이 받아 둔 목록이 캐시에 있어도 목록 GET 정확히 1', async () => {
      // 준비 — 다른 탭이 받아 둔 목록(낡음: staleTime 0).
      serverTrips = [TRIP_A, TRIP_B];

      // 실행
      renderPage({ trips: [TRIP_A, TRIP_B] });
      await advance(100);

      // 단언 — 마운트 재조회 1번. 첫 포커스 재조회가 더해지면 2.
      expect(screen.getByTestId(`my-trip-card-${A}`)).toBeOnTheScreen();
      expect(listHits(hits)).toBe(1);
      expect(itineraryHits(hits)).toBe(0);
    });

    it('🔴 다른 곳에서 확정된 초안 B 는 폴링으론 안 바뀌고, 탭 복귀 때 목록을 한 번 다시 받아 "일정 확정"으로 바뀐다', async () => {
      // 준비 — A 는 일정 없음, B 는 초안.
      const draftB = trip(B, '제주 여행', '2026-09-01T00:00:00Z', DRAFT);
      serverTrips = [TRIP_A, draftB];
      await load();
      expect(screen.getByTestId(`my-trip-extra-${B}`)).toHaveTextContent(
        '추천안 준비 중'
      );
      expect(listHits(hits)).toBe(1);

      // 실행 ① — 상세 화면 등에서 B 가 확정되고, 목록은 다른 탭 뒤에서 간격 두 번을 보낸다.
      serverTrips = [TRIP_A, TRIP_B];
      await advance(POLL * 2);

      // 단언 ① — 생성 중이 아니라 폴링하지 않는다 → 아직 옛 얼굴(앵커).
      expect(screen.getByTestId(`my-trip-extra-${B}`)).toHaveTextContent(
        '추천안 준비 중'
      );
      expect(listHits(hits)).toBe(1);

      // 실행 ② — 일정 탭으로 돌아온다.
      refocus();
      await advance(100);

      // 단언 ② — 여행 수와 무관하게 목록 한 건만 다시 묻고, B 는 확정 얼굴이 된다. 일정 단건은 0.
      expect(screen.getByTestId(`my-trip-extra-${B}`)).toHaveTextContent(
        '일정 확정'
      );
      expect(listHits(hits)).toBe(2);
      expect(itineraryHits(hits)).toBe(0);
    });

    it('TRIP-1348 · 방금 받은(신선한) 목록은 복귀해도 다시 묻지 않는다', async () => {
      // 준비 — staleTime 1분이면 방금 받은 목록은 신선하다.
      serverTrips = [TRIP_A, TRIP_B];
      renderPage(undefined, { staleTime: 60_000 });
      await advance(100);
      expect(listHits(hits)).toBe(1);

      // 실행 — 탭을 떠났다가 곧바로 돌아온다.
      refocus();
      await advance(100);

      // 단언
      expect(listHits(hits)).toBe(1);
    });
  });

  describe('🔴 AC-6 · (셸 감시와 함께) 폴링 틱이 실패해도 받아 둔 목록을 그대로 그리고, 멈추지 않고 천천히 계속 묻는다 (INV-4)', () => {
    it('500 → 카드 유지(오류 얼굴 없음) · 5초 간격으로 계속 시도 · 서버가 돌아오면 끝난 얼굴', async () => {
      // 준비 — R 은 생성 중(앵커). 틱이 500 을 받게 목록 핸들러를 바꿀 수 있게 한다.
      let status: 200 | 500 = 200;
      server.use(
        http.get(`${BASE}/trips`, () =>
          status === 500
            ? HttpResponse.json(
                { error: { code: 'INTERNAL', message: '서버 오류' } },
                { status: 500 }
              )
            : HttpResponse.json(serverTrips)
        )
      );
      serverTrips = [tripR(RUNNING), TRIP_B];
      await load(WITH_SHELL);
      expect(screen.getByTestId(`my-trip-extra-${R}`)).toHaveTextContent(
        RUNNING_TEXT
      );

      // 실행 ① — 다음 폴링이 500 을 받는다.
      status = 500;
      await advance(POLL + 100);

      // 단언 ① — 실패 요청이 나갔고(2번), 카드는 옛 값 그대로, 오류 얼굴로 뒤집히지 않는다.
      expect(listHits(hits)).toBe(2);
      expect(screen.getByTestId(`my-trip-extra-${R}`)).toHaveTextContent(
        RUNNING_TEXT
      );
      expect(screen.queryByTestId('itinerary-tab-error')).toBeNull();

      // 실행 ② — 2.1초 뒤엔 아직(느린 간격 5초), 5초가 차면 다시 시도한다.
      await advance(POLL + 100);
      expect(listHits(hits)).toBe(2);
      await advance(3_000);

      // 단언 ② — 멈추지 않는다.
      expect(listHits(hits)).toBe(3);

      // 실행 ③ — 서버가 돌아와 생성이 끝났다.
      status = 200;
      serverTrips = [tripR(DRAFT), TRIP_B];
      await advance(5_100);

      // 단언 ③ — 따라잡았다.
      expect(screen.getByTestId(`my-trip-extra-${R}`)).toHaveTextContent(
        '추천안 준비 중'
      );
    });
  });

  // TRIP-1618 AC4 · 폴링은 페이지가 아니라 셸이 한다. 페이지는 타이머를 두지 않고, 셸은 탭 포커스를 모른다 — 그래서 일정 탭을 떠나도 셸은 계속 묻는다.
  describe('🔴 TRIP-1618 AC4 · 폴링은 페이지가 아니라 셸이 한다', () => {
    const STALE_30S = { staleTime: 30_000 };

    it('AC4① 페이지만 렌더하면(셸 없음) 생성 중 R 이 있어도 간격 세 번 동안 목록 GET 이 늘지 않는다', async () => {
      // 준비 — 생성 중 R·확정 B. 첫 조회 1번(앵커).
      serverTrips = [tripR(RUNNING), TRIP_B];
      renderPage(undefined, STALE_30S);
      await advance(100);
      expect(listHits(hits)).toBe(1);
      expect(screen.getByTestId(`my-trip-extra-${R}`)).toHaveTextContent(
        RUNNING_TEXT
      );

      // 실행 — 폴링 간격 세 번이 지난다.
      await advance(POLL * 3 + 100);

      // 단언 — 페이지는 스스로 묻지 않는다.
      expect(listHits(hits)).toBe(1);
    });

    it('AC4② 셸과 함께 렌더하면 간격 하나마다 목록 GET 은 정확히 1건씩이다 (이중 폴링 없음 · 여행 수와 무관)', async () => {
      // 준비 — 생성 중이 두 여행이어도 목록은 1건이다.
      serverTrips = [
        tripR(RUNNING),
        trip(C, '강릉 여행', '2026-08-31T00:00:00Z', RUNNING),
        TRIP_B,
      ];
      await load(WITH_SHELL);
      expect(listHits(hits)).toBe(1);

      // 실행 ① — 간격 하나.
      await advance(POLL + 100);

      // 단언 ① — 페이지 관찰자 + 셸 관찰자가 같은 목록을 물어도 한 건이다.
      expect(listHits(hits)).toBe(2);

      // 실행 ② — 간격 하나 더.
      await advance(POLL);

      // 단언 ② — 또 한 건. 일정 단건은 없다.
      expect(listHits(hits)).toBe(3);
      expect(itineraryHits(hits)).toBe(0);
    });

    it('AC4③ 일정 탭을 떠나 다른 탭에 있어도 셸은 계속 묻는다 (TRIP-1614 T1 의 뒤집기)', async () => {
      // 준비 — 셸 + 페이지, 포커스 중 폴링이 도는 것까지 확인(앵커).
      serverTrips = [tripR(RUNNING), TRIP_B];
      await load(WITH_SHELL);
      await advance(POLL + 100);
      expect(listHits(hits)).toBe(2);
      const base = listHits(hits);

      // 실행 — 탭을 떠난다(blur). 간격 세 번이 지난다.
      mockPathname = '/';
      leaveTab();
      await advance(POLL * 3 + 300);

      // 단언 — 떠난 뒤에도 간격마다 한 건씩 늘었다.
      expect(listHits(hits)).toBe(base + 3);
    });
  });

  describe('🔴 AC-7 · 목록이 무효화되면 카드·완료 배너가 새 값을 보인다', () => {
    it('B 가 초안에서 확정으로 바뀐 서버 상태에서 목록 키를 무효화하면, 카드가 바뀌고 완료 배너가 B 로 뜬다', async () => {
      // 준비 — B 는 초안이라 배너가 없다(앵커).
      serverTrips = [
        TRIP_A,
        trip(B, '제주 여행', '2026-09-01T00:00:00Z', DRAFT),
      ];
      await load();
      expect(screen.queryByTestId('generation-done-bar')).toBeNull();
      expect(screen.getByTestId(`my-trip-extra-${B}`)).toHaveTextContent(
        '추천안 준비 중'
      );

      // 실행 — 서버에서 확정됐고(확정 훅이 하는 일), 목록 무효화가 일어난다.
      serverTrips = [TRIP_A, TRIP_B];
      await act(async () => {
        await lastClient?.invalidateQueries({
          queryKey: getGetTripsQueryKey(),
        });
      });
      await advance(100);

      // 단언 — 카드는 새 값, 배너는 B.
      expect(screen.getByTestId(`my-trip-extra-${B}`)).toHaveTextContent(
        '일정 확정'
      );
      expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
        new RegExp(TRIP_B.title)
      );
      expect(itineraryHits(hits)).toBe(0);
    });
  });
});

// TRIP-1271 · 결정 1=A — 생성 중인 여행도 지울 수 있다(US-TRIP-10 개정의 "생성 중 ⋯ 숨김"을 뒤집는다).
describe('🔴 AC-7 · 생성 중 카드도 ⋯ → 삭제 → 확인 다이얼로그로 지운다', () => {
  it('생성 중 A 의 ⋯ 와 "삭제"를 눌러도 DELETE 0번, 확인하면 DELETE /trips/{A} 1번', async () => {
    // 준비 — A 는 생성 중(PARTIAL · 세션 있음), B 는 확정. 일정 상태는 목록 네 칸에 실려 온다.
    serverTrips = [
      {
        ...TRIP_A,
        ...itineraryCols({
          status: 'PLANNED',
          generationState: 'PARTIAL',
          generationMode: 'FULLY_AI',
          generationSessionId: 'sess-1',
        }),
      },
      TRIP_B,
    ];
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

  /**
   * 여행별 일정 상태 대본 — 일정 조회 응답 모양(`Itinerary`)으로 적으면 서버처럼 목록 네 칸으로 옮겨 실린다(`itineraryCols`).
   * `404` 는 일정 없음(네 칸 null). TRIP-1677 로 여행별 일정 단건 핸들러는 없다.
   */
  type Script = Itinerary | 404;
  let script: Record<string, Script> = {};

  /** 대본을 읽어 여행에 네 칸을 실은다 — 요청마다 읽으므로 테스트 중간에 대본을 바꾸면 "서버가 바뀌었다"가 된다. */
  function withCols(t: Trip): Trip {
    const reply = script[t.tripId];
    return {
      ...t,
      ...(reply === undefined || reply === 404
        ? NO_ITINERARY
        : itineraryCols(reply)),
    };
  }

  /** 서버가 지금 내려 주는 여행들 — 테스트 중간에 바꾸면 "서버에 새 여행이 생겼다"가 된다(탭 복귀 재조회가 이걸 받는다). */
  let servedList: Trip[] = [];

  function serve(list: Trip[], itins: Record<string, Script>): void {
    script = itins;
    servedList = list;
    server.use(
      http.get(`${BASE}/trips`, () =>
        HttpResponse.json(servedList.map(withCols))
      )
    );
  }

  let isLargeTextSpy: jest.SpyInstance | null = null;

  beforeEach(() => {
    setFontScale(1);
    lastClient = null;
  });
  afterEach(() => {
    // 아직 마운트된 화면이 배율 변화를 듣는다 — 헬퍼의 setFontScale 이 act 로 감싼다.
    setFontScale(1);
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
      // TRIP-1786 — 고정 키 읽기가 섞여도 되므로 "첫 호출"이 아니라 읽은 키 목록으로 본다(seen 읽기가 있었고, 토큰 키는 아니다).
      const readKeys = (readIdSet as jest.Mock).mock.calls.map(
        ([key]: [string]) => key
      );
      expect(readKeys).toContain(SEEN_KEY);
      expect(
        readKeys.every((key: string) => key === SEEN_KEY || key === PINNED_KEY)
      ).toBe(true);
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
      // TRIP-1677 — 배너 [보기]는 COMPLETE/FAILED/CONFIRMED 여행이라 copick 이 아니다: 일정 단건을 묻지 않는다.
      expect(itineraryHits(hits)).toBe(0);
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
      // 떠나 있는 사이 새 여행 B(확정)가 들어온 목록이 캐시에 쓰인다.
      await act(async () => {
        script['trip-b'] = done('trip-b');
        servedList = [TA, TB];
        lastClient?.setQueryData(getGetTripsQueryKey(), [TA, TB].map(withCols));
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

  // TRIP-1629 — 배율 매트릭스(1·1.353·1.786·3.571). 동작만 본다: 어느 배율에서도 배너 글자·카드가 그려지고 보기·✕ 가 동작한다.
  // 배너가 목록 안/밖 어디에 놓이는지(생김새)는 위 배율 분기 테스트가 맡고, 잘림·겹침은 실화면 캡처(6-b)가 맡는다.
  describeAtFontScales('완료 배너 · 배율 매트릭스 (TRIP-1629)', () => {
    const serveBannerForB = () =>
      serve([TA, TC, TB], {
        'trip-a': done('trip-a'),
        'trip-b': done('trip-b'),
        'trip-c': planned('trip-c'),
      });

    it('M4 배너 글자와 카드 3장이 그려지고 "보기"를 누르면 확정 여행으로 한 번 간다', async () => {
      serveBannerForB();
      renderPage();

      expect(
        await screen.findByTestId('generation-done-bar')
      ).toBeOnTheScreen();
      expect(barText()).toHaveTextContent('부산 여행 일정이 완성됐어요');
      for (const tripId of ['trip-a', 'trip-b', 'trip-c']) {
        expect(screen.getByTestId(`my-trip-card-${tripId}`)).toBeOnTheScreen();
      }
      fireEvent.press(screen.getByTestId('generation-done-bar-view'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(String(mockPush.mock.calls[0][0])).toBe('/trips/trip-b/live');
    });

    it('M5 ✕ 를 누르면 배너만 걷히고 카드는 그대로다', async () => {
      serveBannerForB();
      renderPage();

      fireEvent.press(await screen.findByTestId('generation-done-bar-close'));
      await settle();

      expect(bar()).toBeNull();
      expect(screen.getByTestId('my-trip-card-trip-b')).toBeOnTheScreen();
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

    /**
     * 떠나 있는 사이 확정된 여행 — 서버 대본을 바꾸고, 확정 쪽이 목록 캐시에 반영한 것과 같은 자리(`GET /trips` 키)에
     * 새 네 칸을 쓴다. 돌아오면 탭 복귀 재조회가 같은 값을 다시 받는다.
     */
    async function confirmedWhileAway(ids: string[]): Promise<void> {
      await act(async () => {
        ids.forEach((id) => {
          script[id] = done(id);
        });
        const cached = lastClient?.getQueryData<Trip[]>(getGetTripsQueryKey());
        lastClient?.setQueryData(
          getGetTripsQueryKey(),
          (cached ?? []).map(withCols)
        );
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
    // 시계는 흉내 내지 않는다: 기간 안 = 2020~2099, 미래 = 2099-06 · 2099-03.
    // TRIP-1785 — 끝난 여행은 기본 세그 「예정」에 안 보이므로(「지난」 세그 소관) 이 describe 의 C 는 먼 미래 확정으로 둔다.
    const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' };
    const FUTURE = { startDate: '2099-06-10', endDate: '2099-06-13' };
    const LATER = { startDate: '2099-03-10', endDate: '2099-03-13' };
    // 먼 미래 확정 C(중간) · 여행 중 확정 A(가장 옛) · 미래 확정 B(최신)
    const PA = mk('A', 'A 여행', {
      ...DURING,
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const PB = mk('B', 'B 여행', {
      ...FUTURE,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    const PC = mk('C', 'C 여행', {
      ...LATER,
      updatedAt: '2026-08-15T00:00:00.000Z',
    });

    it('목록이 도착하면 여행 중 A 가 처음부터 맨 위 · 배지 "여행 중" · resume 없음 · ⋯ 는 있다(TRIP-1786) — 일정이 따로 올 때까지 기다리지 않는다', async () => {
      // 완료 배너는 이 describe 의 관심 밖 — seen 읽기를 막아 끈다.
      (readIdSet as jest.Mock).mockImplementation(() => new Promise(() => {}));
      serve([PC, PA, PB], { A: done('A'), B: done('B'), C: done('C') });
      renderPage();

      // 일정 상태가 목록에 실려 오니 첫 렌더부터 판정이 선다(옛: A 일정이 올 때까지 최신순 B·C·A → 도착 뒤 A 가 올라옴).
      expect(await screen.findByTestId('my-trip-badge-A')).toHaveTextContent(
        '여행 중'
      );
      expect(cardOrder()).toEqual([
        'my-trip-card-A',
        'my-trip-card-B',
        'my-trip-card-C',
      ]);
      // TRIP-1786 — ⋯ 는 모든 카드에 있다(여행 중도). 「삭제」가 없는 것은 아래 TRIP-1786 describe 가 잰다.
      expect(screen.getByTestId('my-trip-menu-A')).toBeOnTheScreen();
      expect(screen.queryByTestId('my-trip-resume-A')).toBeNull();
      expect(screen.getByTestId('my-trip-badge-C')).toHaveTextContent('확정');
      expect(itineraryHits(hits)).toBe(0);
    });

    it('기간 안 초안·일정 없음은 "작성중"이고 여행 중으로 고정하지 않는다', async () => {
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
        A: done('A'),
        A2: 404,
        A3: planned('A3'),
        B: done('B'),
      });
      renderPage();

      expect(await screen.findByTestId('my-trip-badge-B')).toHaveTextContent(
        '확정'
      );
      expect(await screen.findByTestId('my-trip-badge-A3')).toHaveTextContent(
        '작성중'
      );
      expect(screen.getByTestId('my-trip-badge-A2')).toHaveTextContent(
        '작성중'
      );
      // 확정+기간 안인 A 만 고정되고, 초안 A3·일정 없음 A2 는 최신순 자리를 지킨다.
      expect(screen.getByTestId('my-trip-badge-A')).toHaveTextContent(
        '여행 중'
      );
      expect(cardOrder()).toEqual([
        'my-trip-card-A',
        'my-trip-card-B',
        'my-trip-card-A2',
        'my-trip-card-A3',
      ]);
      expect(screen.getByTestId('my-trip-menu-A3')).toBeOnTheScreen();
    });
  });

  // TRIP-1639
  describe('🔴 일정 탭을 연 채 자정(KST)을 넘기면 끝난 여행이 「예정」에서 「지난」으로 옮겨 간다', () => {
    // 여행 중이던 O(가장 옛 갱신)와 먼 미래 N(최신 갱신), 둘 다 확정. 자정 전엔 O 가 「예정」 맨 위로 고정되고, 자정 뒤엔 O 가 「예정」에서 빠져 「지난」으로 간다.
    const OVERNIGHT = mk('O', 'O 여행', {
      startDate: '2026-10-11',
      endDate: '2026-10-13',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const LATER = mk('N', 'N 여행', {
      startDate: '2099-06-10',
      endDate: '2099-06-13',
      updatedAt: '2026-09-20T00:00:00.000Z',
    });

    /** 가짜 시계를 ms 만큼 흘리고 그 사이 요청·응답(msw→axios→TanStack) 약속을 함께 푼다. */
    async function advance(ms: number): Promise<void> {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    }

    it('10-13 23:59 에 「예정」 맨 위 "여행 중"이던 여행이 61초 뒤(10-14)엔 「예정」에서 빠져 「지난」으로 가고(배지는 "여행 중"이 아님), 일정은 다시 받지 않는다', async () => {
      // 준비 — KST 2026-10-13 23:59:00 (= UTC 14:59). 완료 배너는 관심 밖이라 seen 읽기를 막아 끈다.
      (readIdSet as jest.Mock).mockImplementation(() => new Promise(() => {}));
      jest.useFakeTimers({ now: new Date('2026-10-13T14:59:00Z') });
      try {
        serve([OVERNIGHT, LATER], { O: done('O'), N: done('N') });
        renderPage();
        await advance(100);

        // 앵커 — 자정 전: O 가 「예정」에서 "여행 중"으로 맨 위에 고정이다(이게 서야 아래 "이동"이 의미를 갖는다).
        expect(screen.getByTestId('my-trip-badge-O')).toHaveTextContent(
          '여행 중'
        );
        expect(cardOrder()).toEqual(['my-trip-card-O', 'my-trip-card-N']);
        const listBefore = listHits(hits);

        // 실행 — 자정을 넘긴다.
        await advance(61_000);

        // 단언 ① 오늘이 10-14 가 되어 O 는 종료 — 「예정」에서 빠진다(분할이 새 오늘로 다시 계산된다).
        expect(cardOrder()).toEqual(['my-trip-card-N']);
        expect(screen.queryByTestId('my-trip-card-O')).toBeNull();
        // 단언 ② 「지난」으로 가면 O 가 있고 배지는 "여행 중"에서 바뀐다(배지 문구 자체는 이 테스트의 관심 밖).
        fireEvent.press(screen.getByTestId('my-trips-seg-past'));
        expect(cardOrder()).toEqual(['my-trip-card-O']);
        expect(screen.getByTestId('my-trip-badge-O')).not.toHaveTextContent(
          '여행 중'
        );
        // 단언 ③ — 오늘이 바뀌어도 서버에 다시 묻지 않는다(목록도, 일정 단건도): 판정은 받아 둔 칸 + 새 오늘로 다시 계산할 뿐이다.
        expect(listHits(hits)).toBe(listBefore);
        expect(itineraryHits(hits)).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // TRIP-1785 · 내 여행 「예정 / 지난」 세그 — 실 목록 응답(msw) 위에서 분할·정렬 공유·기억·기록 보기 링크·빈 안내를 잰다.
  describe('TRIP-1785 · 「예정 / 지난」 세그', () => {
    const SEGMENT_KEY = 'itinerary.myTrips.segment';
    const PAST = { startDate: '2026-06-10', endDate: '2026-06-13' };
    const FUTURE = { startDate: '2099-06-10', endDate: '2099-06-13' };
    const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' };

    // 예정: U1(확정·미래, 부산, 최신) · U2(작성중인데 날짜는 지남, 강릉) — 날짜가 지났어도 확정 전이면 「예정」이다(D1).
    const U1 = mk('U1', '부산 여행', {
      ...FUTURE,
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    const U2 = mk('U2', '강릉 여행', {
      ...PAST,
      updatedAt: '2026-09-10T00:00:00.000Z',
    });
    // 지난: P1(제주, 더 최근 갱신) · P2(속초, 더 옛 갱신) — 최신순 P1·P2, 이름순 P2(속초)·P1(제주)
    const P1 = mk('P1', '제주 여행', {
      ...PAST,
      updatedAt: '2026-08-20T00:00:00.000Z',
    });
    const P2 = mk('P2', '속초 여행', {
      ...PAST,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    // 여행 중(가장 옛 갱신) — 예정 맨 위에 고정돼야 한다.
    const ONG = mk('ONG', '양양 여행', {
      ...DURING,
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const SCRIPT = {
      U1: done('U1'),
      U2: 404 as const,
      P1: done('P1'),
      P2: done('P2'),
      ONG: done('ONG'),
    };

    const mockGetItem = SecureStore.getItemAsync as jest.Mock;
    const mockSetItem = SecureStore.setItemAsync as jest.Mock;
    const none = (): Promise<unknown> => Promise.resolve(null);
    /**
     * 키별로 응답한다(키를 구분하지 않는 목이면 세그·정렬 기억이 서로 오염돼 둘 다 거짓 green 이 난다).
     * 표에 없는 키는 영영 미도착(이 파일의 정렬 describe 와 같은 규칙).
     */
    function storage(table: Record<string, () => Promise<unknown>>): void {
      mockGetItem.mockImplementation((key: string) =>
        key in table ? table[key]() : new Promise(() => {})
      );
    }
    const writesOf = (key: string): unknown[][] =>
      mockSetItem.mock.calls
        .filter((call) => call[0] === key)
        .map((call) => call.slice(0, 2));
    const seg = (name: 'upcoming' | 'past') =>
      screen.getByTestId(`my-trips-seg-${name}`);
    const cardIds = (): string[] =>
      screen
        .queryAllByTestId(/^my-trip-card-/)
        .map((element) => element.props.testID as string);
    /** 목록(세그 줄)이 선 뒤 — 세그 줄이 앵커다. */
    async function listed(): Promise<void> {
      await screen.findByTestId('my-trips-seg-upcoming');
      await settle();
    }

    beforeEach(() => {
      (readIdSet as jest.Mock).mockImplementation(() => new Promise(() => {}));
      storage({ [SORT_KEY]: none, [SEGMENT_KEY]: none });
      mockSetItem.mockReset().mockResolvedValue(undefined);
    });

    describe('AC-1 · 분할 — 예정 선택으로 열리고, 지난 카드는 예정에 없다', () => {
      it('예정 2장(확정 미래 · 날짜 지난 작성중)만 — 지난 1장은 안 보이고, 「지난」을 누르면 지난 1장만 보인다', async () => {
        serve([P1, U1, U2], SCRIPT);
        renderPage();
        await listed();

        // 처음 — 예정 선택, 예정 카드 둘(최신순 U1·U2), 지난 카드는 없다(분할을 빼먹으면 P1 이 보여 red).
        expect(seg('upcoming')).toBeSelected();
        expect(seg('past')).not.toBeSelected();
        expect(cardIds()).toEqual(['my-trip-card-U1', 'my-trip-card-U2']);
        expect(screen.queryByTestId('my-trip-card-P1')).toBeNull();

        fireEvent.press(seg('past'));

        expect(seg('past')).toBeSelected();
        expect(seg('upcoming')).not.toBeSelected();
        expect(cardIds()).toEqual(['my-trip-card-P1']);
        expect(screen.queryByTestId('my-trip-card-U1')).toBeNull();
        expect(screen.queryByTestId('my-trip-card-U2')).toBeNull();

        // 되돌아오면 다시 예정 둘.
        fireEvent.press(seg('upcoming'));
        expect(cardIds()).toEqual(['my-trip-card-U1', 'my-trip-card-U2']);
      });

      it('세그를 눌러도 서버에 다시 묻지 않는다 (목록 1번 · 일정 단건 0번)', async () => {
        serve([P1, U1], SCRIPT);
        renderPage();
        await listed();
        const before = listHits(hits);

        fireEvent.press(seg('past'));
        fireEvent.press(seg('upcoming'));
        await settle();

        expect(listHits(hits)).toBe(before);
        expect(itineraryHits(hits)).toBe(0);
      });
    });

    describe('AC-2 · 정렬 — 여행 중이 예정 맨 위, 정렬 시트는 두 세그가 같이 쓴다', () => {
      it.each<[string, string | null]>([
        ['최신순(기본)', null],
        ['출발일순', 'start'],
        ['이름순', 'title'],
      ])('%s 에서도 여행 중이 예정 맨 위다', async (_label, stored) => {
        storage({
          [SORT_KEY]: () => Promise.resolve(stored),
          [SEGMENT_KEY]: none,
        });
        serve([U1, U2, ONG, P1], SCRIPT);
        renderPage();
        await listed();
        await screen.findByTestId('my-trip-card-ONG');

        expect(cardIds()[0]).toBe('my-trip-card-ONG');
        expect(cardIds()).toHaveLength(3);
      });

      it('지난 세그에서 이름순을 고르면 지난 순서가 바뀌고, 예정으로 돌아가도 같은 기준(이름순)이다 — 세그가 정렬 기억을 건드리지 않는다', async () => {
        serve([P1, P2, U1, U2], SCRIPT);
        renderPage();
        await listed();

        fireEvent.press(seg('past'));
        expect(cardIds()).toEqual(['my-trip-card-P1', 'my-trip-card-P2']);
        fireEvent.press(screen.getByTestId('my-trips-sort'));
        fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));
        await settle();

        // 지난: 속초(P2) → 제주(P1). 줄 라벨은 선택 키 이름 그대로.
        expect(cardIds()).toEqual(['my-trip-card-P2', 'my-trip-card-P1']);
        expect(screen.getByTestId('my-trips-sort')).toHaveTextContent('이름순');

        fireEvent.press(seg('upcoming'));
        // 예정: 강릉(U2) → 부산(U1) — 최신순이었다면 U1·U2.
        expect(cardIds()).toEqual(['my-trip-card-U2', 'my-trip-card-U1']);
        expect(screen.getByTestId('my-trips-sort')).toHaveTextContent('이름순');
        // 정렬 키는 정렬 키로만, 세그 키는 세그 키로만 쓴다.
        expect(writesOf(SORT_KEY)).toEqual([[SORT_KEY, 'title']]);
        expect(writesOf(SEGMENT_KEY)).toEqual([
          [SEGMENT_KEY, 'past'],
          [SEGMENT_KEY, 'upcoming'],
        ]);
      });
    });

    describe('AC-3 · 기억 — 고른 세그를 기기에 남기고, 다시 열면 그 세그다', () => {
      it('「지난」을 누르면 세그 키에 "past" 를 쓰고, 「예정」으로 돌아오면 "upcoming" 을 쓴다 (정렬 키는 안 쓴다)', async () => {
        serve([P1, U1], SCRIPT);
        renderPage();
        await listed();

        fireEvent.press(seg('past'));
        await settle();
        expect(writesOf(SEGMENT_KEY)).toEqual([[SEGMENT_KEY, 'past']]);

        fireEvent.press(seg('upcoming'));
        await settle();
        expect(writesOf(SEGMENT_KEY)).toEqual([
          [SEGMENT_KEY, 'past'],
          [SEGMENT_KEY, 'upcoming'],
        ]);
        expect(writesOf(SORT_KEY)).toEqual([]);
      });

      it('저장값이 "past" 이고 정렬 저장값이 "title" 이면 지난 세그 · 이름순으로 열린다 — 두 키를 따로 읽는다', async () => {
        storage({
          [SORT_KEY]: () => Promise.resolve('title'),
          [SEGMENT_KEY]: () => Promise.resolve('past'),
        });
        serve([P1, P2, U1], SCRIPT);
        renderPage();
        await listed();

        await waitFor(() => expect(seg('past')).toBeSelected());
        // 이름순(속초 P2 → 제주 P1) — 정렬 키 값을 세그에 잘못 넘기거나 그 반대면 순서·선택 중 하나가 어긋난다.
        await waitFor(() =>
          expect(cardIds()).toEqual(['my-trip-card-P2', 'my-trip-card-P1'])
        );
        expect(screen.getByTestId('my-trips-sort')).toHaveTextContent('이름순');
        // 읽기만 했다 — 쓰지 않는다.
        expect(mockSetItem).not.toHaveBeenCalled();
      });

      it('읽기가 오기 전엔 예정, 오면 "past" 로 바뀐다', async () => {
        let arrive!: (value: string) => void;
        storage({
          [SORT_KEY]: none,
          [SEGMENT_KEY]: () =>
            new Promise<string>((resolve) => {
              arrive = resolve;
            }),
        });
        serve([P1, U1], SCRIPT);
        renderPage();
        await listed();
        expect(seg('upcoming')).toBeSelected();

        await act(async () => {
          arrive('past');
        });

        await waitFor(() => expect(seg('past')).toBeSelected());
        expect(cardIds()).toEqual(['my-trip-card-P1']);
      });

      it.each<[string, () => Promise<unknown>]>([
        ['읽기 reject', () => Promise.reject(new Error('keychain'))],
        ['모르는 값', () => Promise.resolve('foo')],
        ['null(저장 없음)', () => Promise.resolve(null)],
        ['undefined', () => Promise.resolve(undefined)],
      ])('저장값이 %s 이면 예정으로 연다 (INV-4)', async (_label, read) => {
        storage({ [SORT_KEY]: none, [SEGMENT_KEY]: read });
        serve([P1, U1], SCRIPT);
        renderPage();
        await listed();

        expect(seg('upcoming')).toBeSelected();
        expect(cardIds()).toEqual(['my-trip-card-U1']);
      });

      it('읽기 대기 중 사용자가 「지난」을 먼저 누르면, 늦게 온 저장값("upcoming")이 그 선택을 덮지 않는다', async () => {
        let arrive!: (value: string) => void;
        storage({
          [SORT_KEY]: none,
          [SEGMENT_KEY]: () =>
            new Promise<string>((resolve) => {
              arrive = resolve;
            }),
        });
        serve([P1, U1], SCRIPT);
        renderPage();
        await listed();

        fireEvent.press(seg('past'));
        await act(async () => {
          arrive('upcoming');
        });
        await settle();

        expect(seg('past')).toBeSelected();
        expect(cardIds()).toEqual(['my-trip-card-P1']);
        expect(writesOf(SEGMENT_KEY)).toEqual([[SEGMENT_KEY, 'past']]);
      });

      it('저장이 실패해도 고른 세그는 화면에 남는다 (쓰기 실패는 삼킨다)', async () => {
        mockSetItem.mockReset().mockRejectedValue(new Error('keychain'));
        serve([P1, U1], SCRIPT);
        renderPage();
        await listed();

        fireEvent.press(seg('past'));
        await settle();

        expect(mockSetItem).toHaveBeenCalledTimes(1);
        expect(seg('past')).toBeSelected();
        expect(cardIds()).toEqual(['my-trip-card-P1']);
      });

      it('고른 세그는 다시 들어와도 남는다 — 쓴 키로 읽는다', async () => {
        const vault = new Map<string, string>();
        storage({
          [SORT_KEY]: none,
          [SEGMENT_KEY]: () => Promise.resolve(vault.get(SEGMENT_KEY) ?? null),
        });
        mockSetItem
          .mockReset()
          .mockImplementation(async (key: string, value: string) => {
            vault.set(key, value);
          });
        serve([P1, U1], SCRIPT);
        const first = renderPage();
        await listed();
        fireEvent.press(seg('past'));
        await settle();
        first.unmount();

        renderPage();
        await listed();

        await waitFor(() => expect(seg('past')).toBeSelected());
        expect(cardIds()).toEqual(['my-trip-card-P1']);
      });
    });

    describe('AC-4 · 「기록 보기 ›」 — 지난 카드에만, 기록 요약으로', () => {
      it('지난 카드마다 링크가 있고 예정 카드엔 없다', async () => {
        serve([P1, P2, U1, ONG], SCRIPT);
        renderPage();
        await listed();
        await screen.findByTestId('my-trip-card-ONG');

        for (const id of ['U1', 'ONG']) {
          expect(screen.queryByTestId(`my-trip-records-link-${id}`)).toBeNull();
        }
        // 예정 카드는 상태문이 그대로다(D4).
        expect(screen.getByTestId('my-trip-extra-U1')).toHaveTextContent(
          '일정 확정'
        );

        fireEvent.press(seg('past'));

        for (const id of ['P1', 'P2']) {
          expect(
            screen.getByTestId(`my-trip-records-link-${id}`)
          ).toHaveTextContent(/^기록 보기/);
          // 링크가 상태문 자리를 대신한다.
          expect(screen.queryByTestId(`my-trip-extra-${id}`)).toBeNull();
        }
      });

      it('링크를 누르면 그 여행의 기록 요약으로 정확히 1번 — 연타해도 1번, 카드 본문 이동(허브)은 없다', async () => {
        serve([P1, P2], SCRIPT);
        renderPage();
        await listed();
        fireEvent.press(seg('past'));

        fireEvent.press(screen.getByTestId('my-trip-records-link-P2'));
        fireEvent.press(screen.getByTestId('my-trip-records-link-P2'));

        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(String(mockPush.mock.calls[0][0])).toBe(
          '/trips/P2/records/summary'
        );
      });

      it('지난 카드 본문을 누르면 목적지는 현행 그대로 /live (D9)', async () => {
        serve([P1], SCRIPT);
        renderPage();
        await listed();
        fireEvent.press(seg('past'));

        fireEvent.press(screen.getByTestId('my-trip-card-P1'));

        expect(mockPush).toHaveBeenCalledTimes(1);
        expect(String(mockPush.mock.calls[0][0])).toBe('/trips/P1/live');
      });
    });

    describe('AC-5 · 빈 안내 — 비어 있는 세그는 한 줄 안내, 만들기 CTA는 없다', () => {
      it('지난 0건: 「지난」을 누르면 안내(my-trips-past-empty) · 카드 0 · [여행 만들기] 없음, 세그 줄은 그대로', async () => {
        serve([U1, U2], SCRIPT);
        renderPage();
        await listed();
        // 앵커 — 지난 안내는 지난 세그에서만 뜬다.
        expect(screen.queryByTestId('my-trips-past-empty')).toBeNull();

        fireEvent.press(seg('past'));

        expect(screen.getByTestId('my-trips-past-empty')).toBeOnTheScreen();
        expect(cardIds()).toEqual([]);
        expect(screen.queryByTestId('itinerary-tab-create-trip')).toBeNull();
        expect(screen.queryByTestId('itinerary-tab-empty')).toBeNull();
        expect(seg('past')).toBeSelected();
        expect(screen.getByTestId('my-trips-sort')).toBeOnTheScreen();
      });

      it('예정 0건·지난 n건(D8): 저장값이 없으면 예정으로 열려 예정 안내(my-trips-upcoming-empty)가 뜨고, 지난으로 자동 전환하지 않는다', async () => {
        serve([P1, P2], SCRIPT);
        renderPage();
        await listed();

        expect(seg('upcoming')).toBeSelected();
        expect(screen.getByTestId('my-trips-upcoming-empty')).toBeOnTheScreen();
        expect(cardIds()).toEqual([]);
        expect(screen.queryByTestId('itinerary-tab-create-trip')).toBeNull();

        fireEvent.press(seg('past'));
        expect(screen.queryByTestId('my-trips-upcoming-empty')).toBeNull();
        expect(cardIds()).toEqual(['my-trip-card-P1', 'my-trip-card-P2']);
      });

      it('카드가 있는 세그에는 안내가 없다', async () => {
        serve([P1, U1], SCRIPT);
        renderPage();
        await listed();

        expect(screen.queryByTestId('my-trips-upcoming-empty')).toBeNull();
        expect(screen.queryByTestId('my-trips-past-empty')).toBeNull();
        fireEvent.press(seg('past'));
        expect(screen.queryByTestId('my-trips-past-empty')).toBeNull();
      });
    });

    describe('D9 · 세그 줄은 목록 얼굴에서만 (전체 0건·로딩·오류 얼굴엔 없다)', () => {
      it('전체 0건이면 기존 empty 얼굴이고 세그가 없다', async () => {
        serve([], {});
        renderPage();

        expect(
          await screen.findByTestId('itinerary-tab-empty')
        ).toBeOnTheScreen();
        expect(screen.queryByTestId('my-trips-seg-upcoming')).toBeNull();
        expect(screen.queryByTestId('my-trips-seg-past')).toBeNull();
      });

      it('로딩 스켈레톤에는 세그가 없고, 목록이 오면 선다', async () => {
        serve([U1], SCRIPT);
        renderPage();

        expect(screen.getByTestId('my-trip-skeleton-1')).toBeOnTheScreen();
        expect(screen.queryByTestId('my-trips-seg-upcoming')).toBeNull();
        expect(
          await screen.findByTestId('my-trips-seg-upcoming')
        ).toBeOnTheScreen();
      });

      it('조회 실패(받아 둔 목록 없음) 오류 얼굴에는 세그가 없다', async () => {
        server.use(
          http.get(`${BASE}/trips`, () =>
            HttpResponse.json(
              { error: { code: 'INTERNAL', message: '서버 오류' } },
              { status: 500 }
            )
          )
        );
        renderPage();

        expect(
          await screen.findByTestId('itinerary-tab-error')
        ).toBeOnTheScreen();
        expect(screen.queryByTestId('my-trips-seg-upcoming')).toBeNull();
        expect(screen.queryByTestId('my-trips-seg-past')).toBeNull();
      });
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
      // 완료 배너·일정 판정은 관심 밖 — seen 읽기를 막고 여행을 전부 일정 없음으로 둬 "여행 중 고정"이 끼지 않게 한다(S9 만 예외).
      (readIdSet as jest.Mock).mockImplementation(() => new Promise(() => {}));
      serve([Z, X, Y], {}); // 일정 없음(네 칸 null)이라 여행 중 고정이 끼지 않는다.
      storedSort(() => Promise.resolve(null));
    });

    it('처음엔 시트 없이 최신순, 이름순을 고르면 닫히고 이름순으로 서며 1회 저장 · 다시 열면 이름순이 선택돼 있다', async () => {
      renderPage();
      await loaded();
      expect(trigger()).toHaveTextContent('최신순');
      // 정렬 줄이 곧 버튼이다(스크린리더 역할 — 옛 MyTripsListScreen.test 이전).
      expect(screen.getAllByRole('button')).toContain(trigger());
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

  // TRIP-1786 · 내 여행 카드 ⋯ 메뉴 — 고정 목록은 기기 저장(키 `itinerary.myTrips.pinned`, idSet 목은 맨 위에서 키별로 응답한다).
  describe('TRIP-1786 · ⋯ 메뉴 — 맨 위에 고정 · 저장 · 삭제 정리', () => {
    /**
     * 무엇을 보장하나:
     *  - ⋯ 는 모든 카드에 있고 「삭제」는 지금 조건(작성중 · 확정+시작 전)일 때만 — 여행 중 카드는 설정·고정만(AC-1·2).
     *  - 고정하면 [여행 중] 다음 맨 위로 서고 메뉴는 닫히며 라벨이 「고정 해제」로 바뀐다. 저장은 고정 키에 한 번, 해제하면 다시 한 번(AC-3).
     *  - 저장값으로 다시 열면 그 자리다. 읽기 전엔 고정 항목이 막히고(눌러도 쓰기 0), 읽기가 실패하면 고정 없이 시작한다(AC-4 · INV-4).
     *  - 읽기가 늦게 와도 저장돼 있던 다른 고정이 사라지지 않는다. 쓰기가 실패해도 이번 화면은 고정이 유지된다.
     *  - 삭제가 끝나면(404 포함) 그 id 만 고정 저장값에서 빠진다 — 고정 아닌 여행을 지울 땐 고정 키를 쓰지 않는다(AC-5 · D7).
     *
     * *(개념 — 막힌 항목 3단)* 막힘 표시(`toBeDisabled`)만 보면 "표시만 막고 동작은 되는" 구현이 통과한다. 그래서 실제로 눌러 보고 저장 쓰기 0회까지 본다.
     * 고정 목록은 완료 배너 seen 과 같은 저장 함수(`readIdSet`/`writeIdSet`)를 쓰므로 키로 가른다 — 아래 `pinnedWrites` 는 고정 키 쓰기만 센다.
     */
    const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' };
    const PAST = { startDate: '2026-06-10', endDate: '2026-06-13' };
    const ONG = mk('ONG', '양양 여행', {
      ...DURING,
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const N1 = mk('N1', '부산 여행', {
      startDate: '2099-06-10',
      endDate: '2099-06-13',
      updatedAt: '2026-09-20T00:00:00.000Z',
    });
    const N2 = mk('N2', '제주 여행', {
      startDate: '2099-05-10',
      endDate: '2099-05-13',
      updatedAt: '2026-09-10T00:00:00.000Z',
    });
    const N3 = mk('N3', '강릉 여행', {
      startDate: '2099-04-10',
      endDate: '2099-04-13',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    const P1 = mk('P1', '속초 여행', {
      ...PAST,
      updatedAt: '2026-08-20T00:00:00.000Z',
    });
    const P2 = mk('P2', '여수 여행', {
      ...PAST,
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const ALL = ['ONG', 'N1', 'N2', 'N3', 'P1', 'P2'];
    const SCRIPT = Object.fromEntries(ALL.map((id) => [id, done(id)]));
    const card = (id: string) => `my-trip-card-${id}`;
    /** 예정 세그 기본 순서(최신순, 여행 중 맨 위): ONG · N1 · N2 · N3. */
    const BASE = [card('ONG'), card('N1'), card('N2'), card('N3')];

    const pinnedWrites = (): unknown[][] =>
      (writeIdSet as jest.Mock).mock.calls
        .filter(([key]: [string]) => key === PINNED_KEY)
        .map(([key, ids]: [string, string[]]) => [key, [...ids].sort()]);
    /** 고정 키 읽기만 대본대로, 다른 키(완료 배너 seen)는 기본 메모리. */
    function pinnedRead(read: () => Promise<string[]>): void {
      (readIdSet as jest.Mock).mockImplementation((key: string) =>
        key === PINNED_KEY ? read() : Promise.resolve([...mockSeen])
      );
    }
    const openMenu = (id: string): void => {
      fireEvent.press(screen.getByTestId(`my-trip-menu-${id}`));
    };
    const pinItem = (id: string) =>
      screen.getByTestId(`my-trip-menu-pin-${id}`);
    const hasItem = (part: string, id: string): boolean =>
      screen.queryByTestId(`my-trip-menu-${part}-${id}`) !== null;
    const mark = (id: string) => screen.queryByTestId(`my-trip-pinned-${id}`);
    /** 목록이 서고 저장값 읽기까지 끝난 뒤. */
    async function listed(): Promise<void> {
      await screen.findByTestId(card('ONG'));
      await settle();
    }

    beforeEach(() => {
      // 완료 배너는 관심 밖 — 전부 이미 알린 것으로 둔다(배너가 seen 을 쓰면 쓰기 목록이 시끄럽다).
      mockSeen = [...ALL];
      serve([N3, N1, P2, ONG, N2, P1], SCRIPT);
    });

    it('AC-1·2 · ⋯ 는 여행 중 카드에도 있다 — 여행 중은 설정·고정만, 시작 전 확정은 구분선과 삭제까지', async () => {
      renderPage();
      await listed();

      openMenu('ONG');
      expect(hasItem('settings', 'ONG')).toBe(true);
      expect(hasItem('pin', 'ONG')).toBe(true);
      expect(hasItem('delete', 'ONG')).toBe(false);
      expect(hasItem('divider', 'ONG')).toBe(false);

      openMenu('N1');
      expect(hasItem('settings', 'N1')).toBe(true);
      expect(hasItem('pin', 'N1')).toBe(true);
      expect(hasItem('divider', 'N1')).toBe(true);
      expect(hasItem('delete', 'N1')).toBe(true);
    });

    it('AC-2 · 지난 세그의 끝난 카드도 ⋯ 가 있고 삭제는 없다', async () => {
      renderPage();
      await listed();
      fireEvent.press(screen.getByTestId('my-trips-seg-past'));

      openMenu('P1');

      expect(hasItem('settings', 'P1')).toBe(true);
      expect(hasItem('pin', 'P1')).toBe(true);
      expect(hasItem('delete', 'P1')).toBe(false);
    });

    it('AC-3 · 3번째 카드(N2)를 고정하면 여행 중 다음 맨 위로 서고, 토스트 · 메뉴 닫힘 · 「고정」 표식 · 한 번 저장 — 해제하면 원래 자리', async () => {
      renderPage(undefined, { toast: true });
      await listed();
      expect(cardOrder()).toEqual(BASE);
      expect(mark('N2')).toBeNull();

      // 실행 ① — 고정.
      openMenu('N2');
      expect(pinItem('N2')).toHaveTextContent('맨 위에 고정');
      expect(pinItem('N2')).not.toBeDisabled();
      fireEvent.press(pinItem('N2'));
      await settle();

      // 단언 ① — 여행 중 ONG 다음 N2, 나머지는 원래 순서. 저장 한 번.
      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N2'),
        card('N1'),
        card('N3'),
      ]);
      expect(pinnedWrites()).toEqual([[PINNED_KEY, ['N2']]]);
      expect(screen.getByText('맨 위에 고정했어요')).toBeOnTheScreen();
      expect(hasItem('pin', 'N2')).toBe(false);
      expect(mark('N2')).toHaveTextContent('고정');
      expect(mark('N1')).toBeNull();
      openMenu('N2');
      expect(pinItem('N2')).toHaveTextContent('고정 해제');

      // 실행 ② — 해제(연타 가드 창은 이 칸의 몫이 아니라 닫고 간다).
      resetPressGuard();
      fireEvent.press(pinItem('N2'));
      await settle();

      // 단언 ② — 원래 순서, 표식 없음, 빈 집합 저장.
      expect(cardOrder()).toEqual(BASE);
      expect(mark('N2')).toBeNull();
      expect(pinnedWrites()).toEqual([
        [PINNED_KEY, ['N2']],
        [PINNED_KEY, []],
      ]);
      expect(screen.getByText('고정을 풀었어요')).toBeOnTheScreen();
    });

    it('연속으로 두 장을 고정하면 저장값은 둘 다 담고, 고정 묶음 안은 현재 정렬 기준(최신순)이다', async () => {
      renderPage();
      await listed();

      openMenu('N3');
      fireEvent.press(pinItem('N3'));
      resetPressGuard();
      openMenu('N2');
      fireEvent.press(pinItem('N2'));
      await settle();

      // 고정 N2(9/10)·N3(9/01) 는 최신순으로, 나머지 N1 은 그 뒤.
      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N2'),
        card('N3'),
        card('N1'),
      ]);
      expect(pinnedWrites().at(-1)).toEqual([PINNED_KEY, ['N2', 'N3']]);
    });

    it('AC-4 · 저장값 [N3] 으로 열면 N3 가 처음부터 고정 자리 · 표식 · 「고정 해제」 — 완료 배너 seen 은 섞이지 않는다', async () => {
      mockPinned = ['N3'];
      renderPage();
      await listed();

      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N3'),
        card('N1'),
        card('N2'),
      ]);
      expect(mark('N3')).toHaveTextContent('고정');
      openMenu('N3');
      expect(pinItem('N3')).toHaveTextContent('고정 해제');
      // seen 값(전 여행 id)이 고정으로 읽혔다면 표식이 다른 카드에도 붙는다.
      expect(mark('N1')).toBeNull();
      expect(mark('N2')).toBeNull();
    });

    it('AC-4 · 고정하고 화면을 닫았다 다시 열어도(새 마운트) 그 자리다', async () => {
      const first = renderPage();
      await listed();
      openMenu('N2');
      fireEvent.press(pinItem('N2'));
      await settle();
      first.unmount();

      renderPage();
      await listed();

      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N2'),
        card('N1'),
        card('N3'),
      ]);
      expect(mark('N2')).toHaveTextContent('고정');
    });

    it('AC-4 · 읽기 전: 고정 항목은 막혀 있다 — 막힘 표시 · 눌러도 순서 그대로 · 고정 키 쓰기 0회 · 토스트 없음', async () => {
      pinnedRead(() => new Promise(() => {}));
      renderPage(undefined, { toast: true });
      await listed();

      openMenu('N2');
      expect(pinItem('N2')).toBeDisabled();
      fireEvent.press(pinItem('N2'));
      await settle();

      expect(cardOrder()).toEqual(BASE);
      expect(pinnedWrites()).toEqual([]);
      expect(screen.queryByText('맨 위에 고정했어요')).toBeNull();
      expect(hasItem('settings', 'N2')).toBe(true);
    });

    it('읽기가 늦게 와도 저장돼 있던 다른 고정(N3)은 사라지지 않는다 — 도착 뒤 N2 를 고정하면 저장값은 둘이다', async () => {
      let arrive!: (ids: string[]) => void;
      pinnedRead(
        () =>
          new Promise<string[]>((resolve) => {
            arrive = resolve;
          })
      );
      renderPage();
      await listed();
      openMenu('N2');
      expect(pinItem('N2')).toBeDisabled();

      await act(async () => {
        arrive(['N3']);
      });
      await settle();

      // 도착하자 저장돼 있던 N3 가 고정 자리로 서고, 막혔던 항목이 풀린다.
      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N3'),
        card('N1'),
        card('N2'),
      ]);
      expect(pinItem('N2')).not.toBeDisabled();
      fireEvent.press(pinItem('N2'));
      await settle();

      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N2'),
        card('N3'),
        card('N1'),
      ]);
      expect(pinnedWrites()).toEqual([[PINNED_KEY, ['N2', 'N3']]]);
    });

    it('INV-4 · 읽기가 실패하면 고정 없이 열리고, 항목은 막히지 않으며, 고정하면 저장한다', async () => {
      pinnedRead(() => Promise.reject(new Error('keychain')));
      renderPage();
      await listed();

      expect(cardOrder()).toEqual(BASE);
      openMenu('N2');
      expect(pinItem('N2')).not.toBeDisabled();
      fireEvent.press(pinItem('N2'));
      await settle();

      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N2'),
        card('N1'),
        card('N3'),
      ]);
      expect(pinnedWrites()).toEqual([[PINNED_KEY, ['N2']]]);
    });

    it('목록에 없는 고정 id(다른 기기에서 지운 여행)가 섞여 있어도 오류 없이, 있는 카드만 고정 자리에 선다', async () => {
      mockPinned = ['ghost', 'N3'];
      renderPage();
      await listed();

      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N3'),
        card('N1'),
        card('N2'),
      ]);
      expect(mark('N3')).toBeOnTheScreen();
    });

    it('여행 중이면서 고정(ONG)인 카드는 한 번만, 여행 중 자리에 서고 표식과 「고정 해제」가 뜬다', async () => {
      mockPinned = ['ONG', 'N3'];
      renderPage();
      await listed();

      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N3'),
        card('N1'),
        card('N2'),
      ]);
      expect(mark('ONG')).toHaveTextContent('고정');
      openMenu('ONG');
      expect(pinItem('ONG')).toHaveTextContent('고정 해제');
    });

    it('세그마다 따로 선다 — 예정의 고정(N2)과 지난의 고정(P2)은 서로의 순서를 건드리지 않는다', async () => {
      mockPinned = ['N2', 'P2'];
      renderPage();
      await listed();

      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N2'),
        card('N1'),
        card('N3'),
      ]);
      fireEvent.press(screen.getByTestId('my-trips-seg-past'));
      // 고정 없이는 최신순 P1·P2.
      expect(cardOrder()).toEqual([card('P2'), card('P1')]);
      expect(mark('P2')).toHaveTextContent('고정');
    });

    it('저장 쓰기가 실패해도 이번 화면은 고정이 유지된다 (삼킨다)', async () => {
      (writeIdSet as jest.Mock).mockRejectedValue(new Error('keychain'));
      renderPage();
      await listed();

      openMenu('N2');
      fireEvent.press(pinItem('N2'));
      await settle();

      expect(cardOrder()).toEqual([
        card('ONG'),
        card('N2'),
        card('N1'),
        card('N3'),
      ]);
      expect(mark('N2')).toBeOnTheScreen();
      expect(pinnedWrites()).toEqual([[PINNED_KEY, ['N2']]]);
    });

    describe('AC-5 · 삭제 — 확인 뒤에만, 끝나면 고정 저장값에서 그 id 만 빠진다', () => {
      const confirmDelete = async (id: string): Promise<void> => {
        await openDialogFor(id);
        fireEvent.press(screen.getByTestId('my-trip-delete-confirm'));
        await settle();
      };

      it('고정한 N1 을 지우면(204) 고정 키를 [] 로 다시 쓴다', async () => {
        mockPinned = ['N1'];
        renderPage();
        await listed();
        servedList = servedList.filter((t) => t.tripId !== 'N1');

        await confirmDelete('N1');

        expect(deletes()).toEqual([`DELETE /api/v1/trips/N1`]);
        expect(pinnedWrites()).toEqual([[PINNED_KEY, []]]);
        await waitFor(() =>
          expect(screen.queryByTestId(card('N1'))).toBeNull()
        );
      });

      it('이미 없는 여행(404)도 성공처럼 고정에서 뺀다', async () => {
        mockPinned = ['N1', 'N3'];
        deleteMode = 404;
        renderPage();
        await listed();
        servedList = servedList.filter((t) => t.tripId !== 'N1');

        await confirmDelete('N1');

        expect(pinnedWrites()).toEqual([[PINNED_KEY, ['N3']]]);
      });

      it('고정 아닌 N2 를 지울 땐 고정 키를 쓰지 않는다', async () => {
        mockPinned = ['N3'];
        renderPage();
        await listed();
        servedList = servedList.filter((t) => t.tripId !== 'N2');

        await confirmDelete('N2');

        expect(deletes()).toEqual([`DELETE /api/v1/trips/N2`]);
        expect(pinnedWrites()).toEqual([]);
      });

      it('삭제가 실패하면(500) 카드도 고정도 그대로 — 고정 키 쓰기 0회', async () => {
        mockPinned = ['N1'];
        deleteMode = 500;
        renderPage();
        await listed();

        await confirmDelete('N1');

        expect(screen.getByTestId('my-trip-delete-dialog')).toBeOnTheScreen();
        expect(pinnedWrites()).toEqual([]);
        expect(mark('N1')).toBeOnTheScreen();
      });

      it('「삭제」 항목만으로는 요청이 나가지 않고 확인창이 뜬다 — 메뉴는 닫힌다', async () => {
        renderPage();
        await listed();

        const dialog = await openDialogFor('N1');
        await settle();

        expect(within(dialog).getByText(TITLE)).toBeOnTheScreen();
        expect(deletes()).toEqual([]);
        expect(hasItem('delete', 'N1')).toBe(false);
      });
    });
  });
});
