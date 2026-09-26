import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdItineraryQueryOptions,
  useGetTrips,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { readIdSet, writeIdSet } from '@/shared/storage/idSet';
import { MyTripsListPage } from '@/pages/itinerary-list';

/**
 * TRIP-928 · h05 "내 여행" 목록의 완료 도킹 배너 표시 조건.
 *
 * 규칙(01b): 완성(카드 배지 '완성') 여행 중 아직 배너로 알리지 않은(seen 에 없는) 여행이 있으면
 * 가장 최근 1건을 배너로 띄우고, 그 순간 완성인 여행 전부를 seen 에 저장한다. 같은 화면에 있는 동안
 * 배너는 남고, 다시 들어오면(재마운트) 뜨지 않는다. 판정 재료(여행별 일정·seen)가 다 오기 전엔
 * 띄우지 않는다.
 *
 * 데이터 길 두 개(02a ★7): 카드는 훅 목 대본(동기), 페이지는 진짜 `useQueries` 가 목 옵션 함수의
 * `queryFn` 을 돈다. 둘 다 같은 대본(`itins`)에서 만든다. seen 은 `@/shared/storage/idSet` 목 —
 * 한 칸짜리 메모리 저장소(`mockSeen`)라 쓰면 실제로 값이 바뀐다(★5).
 *
 * "없음" 단언은 전부 `settle()` 뒤 + 긍정 앵커와 짝이다. AC-1 이 같은 `settle()` 뒤 `getBy` 로
 * 배너를 잡아 "settle 이면 뜰 시간은 충분하다"를 증명한다(★2).
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/expoRouterRedirectMock'),
  // 실물 useRouter 는 훅(내부 useContext)이다. 목도 훅 1개를 불러야 "새 훅을 일찍 return 아래에
  // 두면 로딩→목록 전환 때 React 가 죽는다"가 실물처럼 드러난다(02a ★4).
  useRouter: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useRef(null);
    return { push: mockPush, replace: jest.fn(), navigate: jest.fn() };
  },
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
  getGetTripsTripIdItineraryQueryOptions: jest.fn(),
}));

jest.mock('@/shared/storage/idSet', () => ({
  readIdSet: jest.fn(),
  writeIdSet: jest.fn(),
}));

const mockUseGetTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
const mockUseItinerary = useGetTripsTripIdItinerary as jest.Mock;
const mockQueryOptions = getGetTripsTripIdItineraryQueryOptions as jest.Mock;
const mockReadIdSet = readIdSet as jest.Mock;
const mockWriteIdSet = writeIdSet as jest.Mock;

/** 한 칸짜리 seen 저장소 — 키와 무관하게 마지막으로 쓴 배열을 돌려준다(키 일치는 AC-10 에서 따로). */
let mockSeen: string[] = [];

// ── 픽스처 ─────────────────────────────────────────────────────────────

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
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt,
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

function itin(
  generationState: Itinerary['generationState'],
  status: Itinerary['status']
): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: 'trip-a',
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState,
    days: [{ date: '2099-06-10', slots: [] }],
  };
}

const DONE = itin('COMPLETE', 'CONFIRMED');
const DRAFT = itin('COMPLETE', 'PLANNED');

/** 손으로 푸는 Promise(★6) — 도착 순서를 테스트가 정한다. */
interface Deferred {
  promise: Promise<Itinerary>;
  resolve: (value: Itinerary) => void;
}
function deferred(): Deferred {
  let resolve!: (value: Itinerary) => void;
  const promise = new Promise<Itinerary>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 여행별 일정 대본 — 성공 · 404 · 영영 미도착 · 손으로 푸는 지연. */
type ItinScript =
  | Itinerary
  | { kind: 'notFound' }
  | { kind: 'never' }
  | { kind: 'deferred'; d: Deferred };

const NOT_FOUND = { kind: 'notFound' } as const;
const NEVER = { kind: 'never' } as const;
const AXIOS_404 = { isAxiosError: true, response: { status: 404 } };

function isScriptTag(s: ItinScript): s is Exclude<ItinScript, Itinerary> {
  return 'kind' in s;
}

/** 카드 훅(동기) 결과 — 지연·미도착은 pending 으로 본다(카드 얼굴은 이 파일의 관심 밖). */
function cardHookResult(s: ItinScript | undefined) {
  if (s === undefined || (isScriptTag(s) && s.kind !== 'notFound')) {
    return { data: undefined, error: null, isPending: true, isError: false };
  }
  if (isScriptTag(s)) {
    return {
      data: undefined,
      error: AXIOS_404,
      isPending: false,
      isError: true,
    };
  }
  return { data: s, error: null, isPending: false, isError: false };
}

/** 페이지 `useQueries` 가 도는 `queryFn` — 대본을 비동기로 돌려준다. */
function fetchFor(s: ItinScript | undefined): Promise<Itinerary> {
  if (s === undefined || (isScriptTag(s) && s.kind === 'never')) {
    return new Promise(() => {});
  }
  if (isScriptTag(s) && s.kind === 'deferred') return s.d.promise;
  if (isScriptTag(s)) return Promise.reject(AXIOS_404);
  return Promise.resolve(s);
}

function scriptTrips(trips: Trip[], itins: Record<string, ItinScript>) {
  mockUseGetTrips.mockReturnValue({
    data: trips,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTrips>);
  mockUseItinerary.mockImplementation((tripId: string) =>
    cardHookResult(itins[tripId])
  );
  mockQueryOptions.mockImplementation((tripId: string) => ({
    queryKey: [`/trips/${tripId}/itinerary`],
    queryFn: () => fetchFor(itins[tripId]),
  }));
}

function renderPage(client = newClient()) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<MyTripsListPage />, { wrapper: Wrapper });
}

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

/** 비동기 전부 흘려보내기(★2) — react-query 알림은 setTimeout(0), seen 읽기/쓰기는 Promise. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function writtenIds(call = 0): string[] {
  return [...(mockWriteIdSet.mock.calls[call][1] as string[])].sort();
}

const A = trip('trip-a', '제주 여행', '2026-08-10T00:00:00.000Z');
const B = trip('trip-b', '부산 여행', '2026-08-20T00:00:00.000Z');
const C = trip('trip-c', '강릉 여행', '2026-08-30T00:00:00.000Z');

beforeEach(() => {
  mockPush.mockClear();
  mockUseGetTrips.mockReset();
  mockUseItinerary.mockReset();
  mockQueryOptions.mockReset();
  mockSeen = [];
  mockReadIdSet.mockReset().mockImplementation(async () => [...mockSeen]);
  mockWriteIdSet
    .mockReset()
    .mockImplementation(async (_key: string, ids: readonly string[]) => {
      mockSeen = [...ids];
    });
});

// ── 표시 ───────────────────────────────────────────────────────────────

describe('🔴 AC-1 · 알리지 않은 완성 여행이 있으면 배너를 띄운다', () => {
  it('완성 여행 A 가 seen 에 없으면 "{A 제목} 일정이 완성됐어요 · 보기" 배너가 1개 뜬다', async () => {
    scriptTrips([A], { 'trip-a': DONE });

    renderPage();
    await settle();

    // settle 뒤 getBy — "settle 이면 배너가 뜰 시간은 충분하다"의 증명(★2).
    expect(screen.getAllByTestId('generation-done-bar')).toHaveLength(1);
    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      '제주 여행 일정이 완성됐어요'
    );
    expect(screen.getByTestId('generation-done-bar-view')).toHaveTextContent(
      '보기'
    );
  });
});

describe('🔴 AC-2 · 여러 건이면 가장 최근 완성 1건만', () => {
  it('정렬상 첫째(C, 초안)도 입력 첫째(A, 옛 완성)도 아닌 최신 완성 B 를 띄운다', async () => {
    scriptTrips([A, C, B], { 'trip-a': DONE, 'trip-b': DONE, 'trip-c': DRAFT });

    renderPage();
    await settle();

    expect(screen.getAllByTestId('generation-done-bar')).toHaveLength(1);
    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      '부산 여행 일정이 완성됐어요'
    );
  });
});

// ── seen 기록 · 래치 · 재진입 ─────────────────────────────────────────

describe('🔴 AC-4 · 처음 표시될 때 seen 기록 → 같은 화면 동안 유지 → 재마운트 시 없음', () => {
  it('표시하면 seen 에 A 를 1번 쓰고, 쓰기가 끝난 뒤에도 배너가 남으며, 다시 들어오면 뜨지 않는다', async () => {
    scriptTrips([A], { 'trip-a': DONE });

    // 1차 진입
    const first = renderPage();
    await settle();

    expect(mockWriteIdSet).toHaveBeenCalledTimes(1);
    expect(writtenIds()).toContain('trip-a');
    expect(mockSeen).toContain('trip-a');
    // ★5 래치 — 저장이 끝났어도 이 화면에선 배너가 그대로다.
    expect(screen.getByTestId('generation-done-bar')).toBeOnTheScreen();

    // 2차 진입(재마운트)
    first.unmount();
    renderPage();
    await settle();

    expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen(); // 긍정 앵커
    expect(mockReadIdSet).toHaveBeenCalledTimes(2); // 2차 진입도 seen 을 읽었다
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(mockWriteIdSet).toHaveBeenCalledTimes(1); // 추가 쓰기 없음
  });

  it('그 순간 완성인 여행 전부를 쓰고, 목록에 없는 옛 id 는 버리며, 초안은 넣지 않는다 (Q2·Q5)', async () => {
    mockSeen = ['trip-gone'];
    scriptTrips([A, B, C], { 'trip-a': DONE, 'trip-b': DONE, 'trip-c': DRAFT });

    renderPage();
    await settle();

    expect(mockWriteIdSet).toHaveBeenCalledTimes(1);
    expect(writtenIds()).toEqual(['trip-a', 'trip-b']);
  });
});

describe('🔴 AC-3 · 이미 알린 여행은 다시 띄우지 않는다', () => {
  it('완성 여행 A 가 seen 에 있으면 배너가 없다 (seen 읽기 끝난 뒤, 카드는 뜸)', async () => {
    mockSeen = ['trip-a'];
    scriptTrips([A], { 'trip-a': DONE });

    renderPage();
    await settle();

    expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
    expect(mockReadIdSet).toHaveBeenCalled();
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(mockWriteIdSet).not.toHaveBeenCalled();
  });
});

// ── 보기 ───────────────────────────────────────────────────────────────

describe('🔴 AC-5 · "보기"는 배너 대상 여행의 목적지로 간다', () => {
  it('대상 B(목록 첫째 아님, 확정)의 "보기"를 누르면 /trips/trip-b/live 로 1회 push', async () => {
    scriptTrips([A, C, B], { 'trip-a': DONE, 'trip-b': DONE, 'trip-c': DRAFT });

    renderPage();
    await settle();
    fireEvent.press(screen.getByTestId('generation-done-bar-view'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/trip-b/live');
  });

  it('목록 첫째가 초안(C)이어도 대상 B 의 일정으로 목적지를 계산해 /trips/trip-b/live 로 간다', async () => {
    // 첫째를 초안으로 둬야 "목록 첫째의 일정으로 계산" 실수가 draft 경로로 드러난다.
    scriptTrips([C, B], { 'trip-c': DRAFT, 'trip-b': DONE });

    renderPage();
    await settle();
    fireEvent.press(screen.getByTestId('generation-done-bar-view'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/trip-b/live');
  });
});

// ── 배너 없음: loading · empty · 완성 없음 ────────────────────────────

describe('🔴 AC-6 · 로딩·빈 목록·완성 없음이면 배너가 없다', () => {
  it('여행 목록 로딩 중이면 배너가 없다 (스켈레톤은 뜸)', async () => {
    mockUseGetTrips.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useGetTrips>);
    mockQueryOptions.mockImplementation((tripId: string) => ({
      queryKey: [`/trips/${tripId}/itinerary`],
      queryFn: () => new Promise(() => {}),
    }));

    renderPage();
    await settle();

    expect(screen.getAllByTestId(/^my-trip-skeleton-/)).toHaveLength(2);
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(mockWriteIdSet).not.toHaveBeenCalled();
  });

  it('여행이 없으면 배너가 없다 (empty 는 뜸)', async () => {
    scriptTrips([], {});

    renderPage();
    await settle();

    expect(screen.getByTestId('itinerary-tab-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(mockWriteIdSet).not.toHaveBeenCalled();
  });

  it('생성중·초안·404 여행만 있으면 배너가 없다', async () => {
    const T1 = trip('trip-1', '가', '2026-08-10T00:00:00.000Z');
    const T2 = trip('trip-2', '나', '2026-08-11T00:00:00.000Z');
    const T3 = trip('trip-3', '다', '2026-08-12T00:00:00.000Z');
    const T4 = trip('trip-4', '라', '2026-08-13T00:00:00.000Z');
    scriptTrips([T1, T2, T3, T4], {
      'trip-1': itin('PARTIAL', 'PLANNED'),
      'trip-2': itin('COMPLETE', 'PLANNED'),
      'trip-3': itin('FAILED', 'PLANNED'),
      'trip-4': NOT_FOUND,
    });

    renderPage();
    await settle();

    expect(screen.getAllByTestId(/^my-trip-card-/)).toHaveLength(4);
    expect(mockReadIdSet).toHaveBeenCalled();
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(mockWriteIdSet).not.toHaveBeenCalled();
  });

  it('TRIP-986 C1 · 완성 여행이 이미 끝난 여행(Trip.status ENDED)뿐이면 배너가 없다 (#016 · Seed D4)', async () => {
    // BE 는 끝난 여행을 날짜로 ENDED 로 내려준다 — 확정 일정이 있어도 "완성됐어요 · 보기"는 뒷북이다.
    const ended = { ...A, status: 'ENDED' as const };
    scriptTrips([ended], { 'trip-a': DONE });

    renderPage();
    await settle();

    // 짝 — 카드는 뜨고 seen 도 읽었다(판정 재료가 다 온 뒤의 "없음", ★2).
    expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
    expect(mockReadIdSet).toHaveBeenCalled();
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
  });

  it('로딩 → 목록으로 바뀌어도 크래시 없이 배너가 뜬다 (새 훅은 일찍 return 위에, ★4)', async () => {
    mockUseGetTrips.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useGetTrips>);
    const view = renderPage();

    scriptTrips([A], { 'trip-a': DONE });
    view.rerender(<MyTripsListPage />);
    await settle();

    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      '제주 여행 일정이 완성됐어요'
    );
  });
});

// ── 판정 보류 ──────────────────────────────────────────────────────────

describe('🔴 AC-7 · 판정 재료가 다 오기 전엔 띄우지도 쓰지도 않는다', () => {
  it('여행 하나의 일정이 아직 안 오면, 먼저 온 완성이 있어도 배너·쓰기 없음', async () => {
    scriptTrips([A, B], { 'trip-a': DONE, 'trip-b': NEVER });

    renderPage();
    await settle();

    expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(mockWriteIdSet).not.toHaveBeenCalled();
  });

  it('옛 완성 A 가 먼저 와도 기다렸다가, 최신 완성 B 까지 오면 B 를 띄운다 (도착 순서 경합, ★6)', async () => {
    const dA = deferred();
    const dB = deferred();
    scriptTrips([A, B], {
      'trip-a': { kind: 'deferred', d: dA },
      'trip-b': { kind: 'deferred', d: dB },
    });

    renderPage();
    await settle();

    // A 만 도착
    await act(async () => {
      dA.resolve(DONE);
    });
    await settle();
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(mockWriteIdSet).not.toHaveBeenCalled();

    // B 도착
    await act(async () => {
      dB.resolve(DONE);
    });
    await settle();
    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      '부산 여행 일정이 완성됐어요'
    );
    expect(writtenIds()).toEqual(['trip-a', 'trip-b']);
  });

  it('seen 읽기가 끝나지 않으면 배너·쓰기 없음', async () => {
    mockReadIdSet.mockImplementation(() => new Promise(() => {}));
    scriptTrips([A], { 'trip-a': DONE });

    renderPage();
    await settle();

    expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(mockWriteIdSet).not.toHaveBeenCalled();
  });

  it('일정이 캐시에 이미 있어도 seen 을 읽기 전 첫 화면에 배너가 깜빡 뜨지 않는다 (★3)', async () => {
    mockSeen = ['trip-a'];
    scriptTrips([A], { 'trip-a': DONE });
    const client = newClient();
    client.setQueryData(['/trips/trip-a/itinerary'], DONE);

    renderPage(client);

    // 렌더 직후(동기) — 캐시 덕에 일정은 이미 완성으로 보이지만 seen 은 아직 안 읽혔다.
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();

    await settle();
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(mockWriteIdSet).not.toHaveBeenCalled();
  });
});

// ── 저장소 실패 ────────────────────────────────────────────────────────

describe('🔴 AC-8 · 저장소가 실패해도 목록은 멀쩡하다', () => {
  it('seen 읽기가 실패하면 배너 없이 목록만 그린다 (닫힌 쪽 실패, Q4)', async () => {
    mockReadIdSet.mockRejectedValue(new Error('keychain'));
    scriptTrips([A], { 'trip-a': DONE });

    renderPage();
    await settle();

    expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
    expect(screen.queryByTestId('generation-done-bar')).toBeNull();
    expect(mockWriteIdSet).not.toHaveBeenCalled();
  });

  it('seen 쓰기가 실패해도 배너는 그대로 남는다', async () => {
    mockWriteIdSet.mockRejectedValue(new Error('keychain'));
    scriptTrips([A], { 'trip-a': DONE });

    renderPage();
    await settle();

    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      '제주 여행 일정이 완성됐어요'
    );
    expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
  });
});

// ── 배치 · 키 ──────────────────────────────────────────────────────────

describe('🔴 AC-9 · 배너는 목록 화면 안이 아니라 형제로 붙는다', () => {
  it('배너가 있고, itinerary-tab-root 안에서는 찾아지지 않는다', async () => {
    scriptTrips([A], { 'trip-a': DONE });

    renderPage();
    await settle();

    expect(screen.getByTestId('generation-done-bar')).toBeOnTheScreen();
    const root = screen.getByTestId('itinerary-tab-root');
    expect(within(root).queryByTestId('generation-done-bar')).toBeNull();
  });
});

describe('🔴 AC-10 · seen 키는 읽기·쓰기가 같고 토큰 키와 다르다', () => {
  it('같은 키로 읽고 쓰며, SecureStore 키 규칙을 지키고, accessToken·refreshToken 이 아니다', async () => {
    scriptTrips([A], { 'trip-a': DONE });

    renderPage();
    await settle();

    const readKey = mockReadIdSet.mock.calls[0][0] as string;
    const writeKey = mockWriteIdSet.mock.calls[0][0] as string;
    expect(writeKey).toBe(readKey);
    expect(readKey).toMatch(/^[\w.-]+$/);
    expect(['accessToken', 'refreshToken']).not.toContain(readKey);
  });
});
