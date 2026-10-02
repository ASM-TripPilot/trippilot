import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

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
 *
 * 한 파일로 합친 기록(TRIP-1151): 조회 훅을 목으로 바꾼 세 파일(옛 `.doneBar` · `.ongoing` · `.sort`)을
 * 이 파일로 합쳤다. 이 파일 최상위가 옛 `.doneBar` 다. 라우터 목은 옛 `.doneBar` 의 훅 흉내 버전(useRef
 * 1회 — 훅 순서 그물)이고, `idSet` 은 jest.fn 이라 「여행 중」·「정렬」 describe 가 beforeEach 에서 "영영 안
 * 끝나는" 구현을 심는다. `expo-secure-store` 목(옛 `.sort`)은 파일 전체에 걸린다 — 최상위 beforeEach 가
 * 비워 앞 describe 의 저장값이 새지 않는다. MSW 를 안 쓰므로 node 버킷이다(README 버킷 예외).
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

// TRIP-1055 준비부 확장(단언 무변경) — 페이지가 여행 삭제 mutation 을 물게 되어 삭제 훅 무해 스텁을 더한다.
// 없으면 `useDeleteTripsTripId is not a function` 으로 스위트 전체가 죽는다. plain 함수라 mockReset 무관.
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
  getGetTripsTripIdItineraryQueryOptions: jest.fn(),
  getGetTripsQueryKey: () => ['/trips'],
  deleteTripsTripId: () => new Promise(() => {}),
  useDeleteTripsTripId: () => ({
    mutate: () => {},
    mutateAsync: () => new Promise(() => {}),
    reset: () => {},
    isPending: false,
    isError: false,
    error: null,
  }),
}));

jest.mock('@/shared/storage/idSet', () => ({
  readIdSet: jest.fn(),
  writeIdSet: jest.fn(),
}));

// 정렬 저장값(옛 `.sort`) — 키·문자열을 페이지 수준에서 본다. 다른 describe 에선 비어 있다(최신순).
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
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
  // 정렬 저장값이 앞 describe 에서 새지 않게(02a ★).
  (SecureStore.getItemAsync as jest.Mock).mockReset();
  (SecureStore.setItemAsync as jest.Mock)
    .mockReset()
    .mockResolvedValue(undefined);
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

// TRIP-1121 · 옛 MyTripsListPage.ongoing.test.tsx — 라우터·trips 목은 최상위(같은 모양 + 훅 흉내)를 쓴다.
describe('여행 중 여행 맨 위 고정', () => {
  /**
   * TRIP-1121 · AC-4·AC-5·AC-6 — h06 "내 여행" 목록에서 여행 중 여행이 맨 위로 오고 배지가 "여행 중"이다.
   *
   * 규칙(01b D1·D3·D4): 여행 중 = 일정 확정 + 오늘(서울)이 기간 안. 페이지가 오늘을 한 번 만들어 정렬과
   * 카드 양쪽에 넘긴다. 일정이 아직 안 왔거나 조회가 실패한 여행은 판정할 수 없으니 고정하지 않는다(INV-4).
   *
   * 무엇을 보장하나:
   *  - 🔴 P1 일정이 도착하기 전에는 최신순, 도착한 뒤에는 여행 중 A 가 맨 위(가장 옛날에 수정됐어도).
   *    A 배지는 '여행 중'이고 ⋯·resume 이 없다. 나머지 확정 여행(과거·미래)은 '완성'.
   *  - 🟢 P2 기간 안 확정 여행이라도 일정이 영영 안 오거나 500 이면 고정·배지 없음.
   *  - 🟢 P3 기간 안 초안·일정 없음(404)은 '작성중'이고 고정 안 함, 초안은 ⋯ 유지.
   *
   * 데이터 길 두 개(02a ★1): 카드 배지는 카드 훅 목(동기), 순서는 페이지 `useQueries` 가 목 옵션 함수의
   * `queryFn` 을 진짜로 돈다. 둘 다 같은 대본에서 만든다 — 실앱에서는 같은 캐시 키라 한 값이다.
   * 시계는 흉내 내지 않는다(02a ★3): 기간 안 = 2020~2099, 과거 = 2026-06, 미래 = 2099-06.
   * 완료 배너는 이 파일의 관심 밖이라 `readIdSet` 을 영영 안 끝나게 막아 끈다(02a ★11).
   */

  // 완료 배너는 이 describe 의 관심 밖 — 옛 파일처럼 idSet 을 영영 안 끝나게 막아 끈다(TRIP-1151 합치기 스위치).
  beforeEach(() => {
    mockReadIdSet.mockImplementation(() => new Promise(() => {}));
    mockWriteIdSet.mockImplementation(() => new Promise(() => {}));
  });
  const mockUseGetTrips = useGetTrips as jest.MockedFunction<
    typeof useGetTrips
  >;
  const mockUseItinerary = useGetTripsTripIdItinerary as jest.Mock;
  const mockQueryOptions = getGetTripsTripIdItineraryQueryOptions as jest.Mock;

  // ── 픽스처 ─────────────────────────────────────────────────────────────

  const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' };
  const PAST = { startDate: '2026-06-10', endDate: '2026-06-13' };
  const FUTURE = { startDate: '2099-06-10', endDate: '2099-06-13' };

  function trip(
    tripId: string,
    updatedAt: string,
    period: { startDate: string; endDate: string }
  ): Trip {
    return {
      tripId,
      title: `${tripId} 여행`,
      ...period,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 3 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt,
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  function itin(status: Itinerary['status']): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: 'x',
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      isFallback: false,
      generationState: 'COMPLETE',
      days: [],
    };
  }

  const CONFIRMED = itin('CONFIRMED');
  const PLANNED = itin('PLANNED');
  const AXIOS_404 = { isAxiosError: true, response: { status: 404 } };
  const AXIOS_500 = { isAxiosError: true, response: { status: 500 } };

  /** 여행별 일정 대본 — 성공 · 404 · 500 · 영영 미도착. */
  type ItinScript = Itinerary | 'notFound' | 'serverError' | 'never';

  function cardHookResult(s: ItinScript) {
    if (s === 'never') {
      return { data: undefined, error: null, isPending: true, isError: false };
    }
    if (s === 'notFound' || s === 'serverError') {
      const error = s === 'notFound' ? AXIOS_404 : AXIOS_500;
      return { data: undefined, error, isPending: false, isError: true };
    }
    return { data: s, error: null, isPending: false, isError: false };
  }

  function fetchFor(s: ItinScript): Promise<Itinerary> {
    if (s === 'never') return new Promise(() => {});
    if (s === 'notFound') return Promise.reject(AXIOS_404);
    if (s === 'serverError') return Promise.reject(AXIOS_500);
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

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<MyTripsListPage />, { wrapper: Wrapper });
  }

  /** 비동기 전부 흘려보내기 — react-query 알림은 setTimeout(0)(doneBar 테스트 ★2 선례). */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  /** 카드 루트 testID 를 화면 순서(트리 순서)대로. */
  function cardOrder(): string[] {
    return screen
      .getAllByTestId(/^my-trip-card-/)
      .map((element) => element.props.testID as string);
  }

  // 과거 확정 C(중간) · 여행 중 확정 A(가장 옛) · 미래 확정 B(최신)
  const A = trip('A', '2026-07-01T00:00:00.000Z', DURING);
  const B = trip('B', '2026-09-20T00:00:00.000Z', FUTURE);
  const C = trip('C', '2026-08-15T00:00:00.000Z', PAST);

  beforeEach(() => {
    mockUseGetTrips.mockReset();
    mockUseItinerary.mockReset();
    mockQueryOptions.mockReset();
  });

  describe('🔴 P1 · 일정이 도착하면 여행 중 여행이 맨 위, 배지 "여행 중"', () => {
    it('도착 전 최신순(B·C·A) → 도착 뒤 A·B·C, A 는 "여행 중"·⋯/resume 없음, B·C 는 "완성"', async () => {
      // 준비
      scriptTrips([C, A, B], { A: CONFIRMED, B: CONFIRMED, C: CONFIRMED });

      // 실행 ① — 첫 렌더(페이지 일정 조회 미도착)
      renderPage();

      // 단언 ① — 판정 재료가 없으면 고정하지 않는다(최신순)
      expect(cardOrder()).toEqual([
        'my-trip-card-B',
        'my-trip-card-C',
        'my-trip-card-A',
      ]);

      // 실행 ② — 일정 도착
      await settle();

      // 단언 ② — 여행 중 A 가 맨 위, 나머지는 최신순
      expect(cardOrder()).toEqual([
        'my-trip-card-A',
        'my-trip-card-B',
        'my-trip-card-C',
      ]);
      expect(screen.getByTestId('my-trip-badge-A')).toHaveTextContent(
        '여행 중'
      );
      expect(screen.queryByTestId('my-trip-menu-A')).toBeNull();
      expect(screen.queryByTestId('my-trip-resume-A')).toBeNull();
      expect(screen.getByTestId('my-trip-badge-B')).toHaveTextContent('완성');
      expect(screen.getByTestId('my-trip-badge-C')).toHaveTextContent('완성');
    });
  });

  describe('🟢 P2 · 일정을 모르면 고정·배지 없음 (INV-4)', () => {
    it.each([
      ['영영 미도착', 'never'],
      ['500 조회 실패', 'serverError'],
    ] as const)(
      '기간 안 A 의 일정이 %s → settle 뒤에도 B·A, A 배지 없음',
      async (_label, script) => {
        scriptTrips([A, B], { A: script, B: CONFIRMED });

        renderPage();
        await settle();

        expect(cardOrder()).toEqual(['my-trip-card-B', 'my-trip-card-A']);
        expect(screen.queryByTestId('my-trip-badge-A')).toBeNull();
        // 긍정 앵커 — B 는 판정이 끝나 배지가 있다(빈 화면 공짜 통과 차단)
        expect(screen.getByTestId('my-trip-badge-B')).toHaveTextContent('완성');
      }
    );
  });

  describe('🟢 P3 · 기간 안 초안·일정 없음은 "작성중"이고 고정 안 함', () => {
    it('초안 A(PLANNED)·일정 없음 A2(404) + 확정 B → 최신순 그대로, 초안 ⋯ 유지', async () => {
      const A2 = trip('A2', '2026-07-10T00:00:00.000Z', DURING);
      scriptTrips([A, A2, B], { A: PLANNED, A2: 'notFound', B: CONFIRMED });

      renderPage();
      await settle();

      expect(cardOrder()).toEqual([
        'my-trip-card-B',
        'my-trip-card-A2',
        'my-trip-card-A',
      ]);
      expect(screen.getByTestId('my-trip-badge-A')).toHaveTextContent('작성중');
      expect(screen.getByTestId('my-trip-badge-A2')).toHaveTextContent(
        '작성중'
      );
      expect(screen.getByTestId('my-trip-menu-A')).toBeOnTheScreen();
    });
  });
});

// TRIP-1122 · 옛 MyTripsListPage.sort.test.tsx
describe('정렬 시트와 저장된 기준', () => {
  /**
   * TRIP-1122 · AC-2~AC-5·AC-11·AC-14~AC-17 — h06 정렬 시트를 열고 고르면 목록이 다시 서고, 고른 기준이
   * 기기에 남는다.
   *
   * 규칙(01b): 페이지가 기준·시트 열림을 쥐고 시트는 열릴 때만 그린다. 마운트 때 기기에서 한 번 읽는다 —
   * 읽기 전엔 최신순, 오면 그 기준(결정 2(a)). 읽기 실패·모르는 값은 최신순(INV-4). 사용자가 먼저 고르면
   * 늦게 온 저장값은 무시. 고르면 1회 쓴다(쓰기 실패는 조용히 무시 — 화면은 고른 대로).
   *
   * 무엇을 보장하나(픽스처 3건 — 기준마다 순서가 전부 다르다):
   *   Y `강릉 여행` 2022-03-01 출발(지난) · 09-20 수정
   *   X `제주 여행` 2099-05-01 출발 · 09-01 수정
   *   Z `부산 여행` 2099-02-01 출발 · 08-01 수정
   *   최신순 Y X Z · 출발일순 Z X Y · 이름순 Y Z X
   *
   * 저장소는 `expo-secure-store` 층에서 목으로 간다(02a ★5) — 어떤 키에 어떤 **문자열**이 저장되는지를
   * 페이지 수준에서 본다. 완료 배너는 관심 밖이라 `idSet` 읽기를 영영 안 끝나게 막아 끈다(SecureStore
   * 호출 목록도 오염되지 않는다). 일정 조회도 영영 안 끝나게 둬서 "여행 중 고정"이 끼지 않는다(S9 만 예외).
   *
   * *(개념 — deferred)* 손으로 푸는 Promise. 저장값이 **언제** 도착하는지를 테스트가 정해, "읽기보다
   *   사용자 선택이 먼저"(경합) 같은 순서를 재현한다(02a ★4).
   */

  // 완료 배너는 이 describe 의 관심 밖 — 옛 파일처럼 idSet 을 영영 안 끝나게 막아 끈다(TRIP-1151 합치기 스위치).
  beforeEach(() => {
    mockReadIdSet.mockImplementation(() => new Promise(() => {}));
    mockWriteIdSet.mockImplementation(() => new Promise(() => {}));
  });
  const mockUseGetTrips = useGetTrips as jest.MockedFunction<
    typeof useGetTrips
  >;
  const mockUseItinerary = useGetTripsTripIdItinerary as jest.Mock;
  const mockQueryOptions = getGetTripsTripIdItineraryQueryOptions as jest.Mock;
  const mockGetItem = SecureStore.getItemAsync as jest.Mock;
  const mockSetItem = SecureStore.setItemAsync as jest.Mock;

  const SORT_KEY = 'itinerary.myTrips.sort';

  // ── 픽스처 ─────────────────────────────────────────────────────────────

  function trip(
    tripId: string,
    title: string,
    startDate: string,
    updatedAt: string,
    endDate = startDate
  ): Trip {
    return {
      tripId,
      title,
      startDate,
      endDate,
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 1 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt,
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  // 시계는 흉내 내지 않는다(02a ★16) — 지난 = 2022, 예정 = 2099.
  const Y = trip('Y', '강릉 여행', '2022-03-01', '2026-09-20T00:00:00.000Z');
  const X = trip('X', '제주 여행', '2099-05-01', '2026-09-01T00:00:00.000Z');
  const Z = trip('Z', '부산 여행', '2099-02-01', '2026-08-01T00:00:00.000Z');

  const RECENT = ['my-trip-card-Y', 'my-trip-card-X', 'my-trip-card-Z'];
  const START = ['my-trip-card-Z', 'my-trip-card-X', 'my-trip-card-Y'];
  const TITLE = ['my-trip-card-Y', 'my-trip-card-Z', 'my-trip-card-X'];

  const CONFIRMED: Itinerary = {
    itineraryId: 'itin-1',
    tripId: 'x',
    status: 'CONFIRMED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [],
  };

  /** 여행 목록 + 여행별 일정(기본: 영영 미도착 → 고정 없음). */
  function scriptTrips(
    trips: Trip[],
    itinerary: Itinerary | 'never' = 'never'
  ) {
    mockUseGetTrips.mockReturnValue({
      data: trips,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useGetTrips>);
    mockUseItinerary.mockImplementation(() =>
      itinerary === 'never'
        ? { data: undefined, error: null, isPending: true, isError: false }
        : { data: itinerary, error: null, isPending: false, isError: false }
    );
    mockQueryOptions.mockImplementation((tripId: string) => ({
      queryKey: [`/trips/${tripId}/itinerary`],
      queryFn: () =>
        itinerary === 'never'
          ? new Promise(() => {})
          : Promise.resolve(itinerary),
    }));
  }

  interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
  }
  function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  /** 정렬 키 읽기만 대본대로, 다른 키는 영영 미도착(토큰 등 — 이 파일 관심 밖). */
  function scriptStoredSort(read: () => Promise<unknown>) {
    mockGetItem.mockImplementation((key: string) =>
      key === SORT_KEY ? read() : new Promise(() => {})
    );
  }

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<MyTripsListPage />, { wrapper: Wrapper });
  }

  /** 비동기 전부 흘려보내기 — react-query 알림은 setTimeout(0)(1121 ongoing 선례). */
  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  /** 카드 루트 testID 를 화면 순서(트리 순서)대로. */
  function cardOrder(): string[] {
    return screen
      .getAllByTestId(/^my-trip-card-/)
      .map((element) => element.props.testID as string);
  }

  /** 트리거 글자 — 시트가 열리면 `최신순` 이 둘이라 getByText 대신 testID 로(02a ★2). */
  function triggerLabel() {
    return screen.getByTestId('my-trips-sort');
  }

  function openSheet(): void {
    fireEvent.press(screen.getByTestId('my-trips-sort'));
  }

  /** SecureStore 에 쓴 [키, 값] 전부. */
  function writes(): unknown[][] {
    return mockSetItem.mock.calls.map((call) => call.slice(0, 2));
  }

  beforeEach(() => {
    mockUseGetTrips.mockReset();
    mockUseItinerary.mockReset();
    mockQueryOptions.mockReset();
    mockGetItem.mockReset();
    mockSetItem.mockReset().mockResolvedValue(undefined);
    scriptTrips([Z, X, Y]);
  });

  describe('🔴 S1 · 처음엔 시트가 없고, 저장값이 없으면 최신순 (AC-1·AC-2 · 02a ★1)', () => {
    it('트리거는 "최신순", 시트는 트리에 없다, 카드 Y·X·Z', async () => {
      // 준비
      scriptStoredSort(() => Promise.resolve(null));

      // 실행
      renderPage();
      await settle();

      // 단언 — 트리거(긍정 짝)는 있고 시트는 없다
      expect(triggerLabel()).toHaveTextContent('최신순');
      expect(screen.queryByTestId('my-trips-sort-sheet')).toBeNull();
      expect(cardOrder()).toEqual(RECENT);
    });
  });

  describe('🔴 S2 · 시트에서 이름순을 고르면 바로 닫히고 이름순으로 선다 (AC-3·AC-4·AC-16)', () => {
    it('열림(최신순 선택) → 이름순 탭 → 닫힘 · Y·Z·X · "이름순" · 1회 저장 · 다시 열면 이름순 선택', async () => {
      // 준비
      scriptStoredSort(() => Promise.resolve(null));
      renderPage();
      await settle();

      // 실행 ① — 트리거 누름
      openSheet();

      // 단언 ① — 시트가 열리고 지금 기준(최신순)이 선택돼 있다
      expect(screen.getByTestId('my-trips-sort-sheet')).toBeOnTheScreen();
      expect(screen.getByTestId('my-trips-sort-option-recent')).toBeSelected();

      // 실행 ② — 이름순 탭
      fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));
      await settle();

      // 단언 ② — 닫힘 · 재정렬 · 라벨 · 저장 1회(정렬 키에 문자열 그대로)
      expect(screen.queryByTestId('my-trips-sort-sheet')).toBeNull();
      expect(cardOrder()).toEqual(TITLE);
      expect(triggerLabel()).toHaveTextContent('이름순');
      expect(writes()).toEqual([[SORT_KEY, 'title']]);

      // 실행 ③·단언 ③ — 다시 열면 이름순이 선택돼 있다
      openSheet();
      expect(screen.getByTestId('my-trips-sort-option-title')).toBeSelected();
      expect(
        screen.getByTestId('my-trips-sort-option-recent')
      ).not.toBeSelected();
    });
  });

  describe('🔴 S3 · 출발일순 — 오늘 이후 가까운 순 먼저, 지난 여행은 뒤 (AC-8·AC-16)', () => {
    it('출발일순 탭 → Z·X·Y · "출발일순" · setItemAsync(정렬 키, "start") 1회만', async () => {
      scriptStoredSort(() => Promise.resolve(null));
      renderPage();
      await settle();

      openSheet();
      fireEvent.press(screen.getByTestId('my-trips-sort-option-start'));
      await settle();

      expect(cardOrder()).toEqual(START);
      expect(triggerLabel()).toHaveTextContent('출발일순');
      // 전체 일치 — 완료 배너 키 등 다른 쓰기가 섞이면 red(02a ★5)
      expect(writes()).toEqual([[SORT_KEY, 'start']]);
    });
  });

  describe('🔴 S4 · 스크림을 누르면 닫히기만 한다 (AC-5)', () => {
    it('닫힘 · 순서·라벨 그대로 · 저장 0회', async () => {
      scriptStoredSort(() => Promise.resolve(null));
      renderPage();
      await settle();

      openSheet();
      expect(screen.getByTestId('my-trips-sort-sheet')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('my-trips-sort-scrim'));
      await settle();

      expect(screen.queryByTestId('my-trips-sort-sheet')).toBeNull();
      expect(cardOrder()).toEqual(RECENT);
      expect(triggerLabel()).toHaveTextContent('최신순');
      expect(mockSetItem).not.toHaveBeenCalled();
    });
  });

  describe('🔴 S5 · 기기에 남은 기준을 읽으면 그 기준으로 다시 선다 (AC-14 · 02a ★3)', () => {
    it('읽기 전 최신순 → "title" 도착 → 이름순 · 저장 0회 · 읽은 키 = 정렬 키', async () => {
      // 준비 — 읽기를 손으로 쥔다
      const stored = deferred<string | null>();
      scriptStoredSort(() => stored.promise);

      // 실행 ① — 첫 렌더(저장값 미도착)
      renderPage();

      // 단언 ① — 먼저 최신순으로 그린다(결정 2(a))
      expect(cardOrder()).toEqual(RECENT);
      expect(triggerLabel()).toHaveTextContent('최신순');

      // 실행 ② — 저장값 도착
      await act(async () => {
        stored.resolve('title');
      });
      await settle();

      // 단언 ② — 같은 settle 뒤 이름순(= settle 이면 반영될 시간은 충분하다)
      expect(cardOrder()).toEqual(TITLE);
      expect(triggerLabel()).toHaveTextContent('이름순');
      expect(mockGetItem.mock.calls.map((call) => call[0])).toContain(SORT_KEY);
      expect(mockSetItem).not.toHaveBeenCalled();
    });
  });

  describe('🔴 S6 · 읽기 실패·모르는 값은 최신순으로 접는다 (AC-15 · INV-4)', () => {
    it.each([
      [
        '읽기 reject(웹·키체인 오류)',
        () => Promise.reject(new Error('keychain')),
      ],
      ['모르는 값', () => Promise.resolve('foo')],
      ['undefined(jest-expo 자동 목 모양)', () => Promise.resolve(undefined)],
    ])('%s → 카드 3장 Y·X·Z · "최신순"', async (_label, read) => {
      scriptStoredSort(read);

      renderPage();
      await settle();

      expect(cardOrder()).toEqual(RECENT);
      expect(triggerLabel()).toHaveTextContent('최신순');
    });
  });

  describe('🔴 S7 · 저장이 실패해도 고른 기준은 화면에 남는다 (AC-16 · 02a ★8)', () => {
    it('setItemAsync reject → 출발일순 탭 뒤 Z·X·Y · "출발일순" 유지', async () => {
      scriptStoredSort(() => Promise.resolve(null));
      mockSetItem.mockReset().mockRejectedValue(new Error('keychain'));
      renderPage();
      await settle();

      openSheet();
      fireEvent.press(screen.getByTestId('my-trips-sort-option-start'));
      await settle();

      expect(cardOrder()).toEqual(START);
      expect(triggerLabel()).toHaveTextContent('출발일순');
      expect(mockSetItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔴 S8 · 늦게 온 저장값은 방금 고른 기준을 덮지 않는다 (AC-17 · 02a ★4)', () => {
    it('읽기 대기 중 이름순 선택 → 읽기가 "start" 로 도착 → 여전히 이름순 · 저장은 title 1회', async () => {
      // 준비 — 읽기를 손으로 쥔다
      const stored = deferred<string | null>();
      scriptStoredSort(() => stored.promise);
      renderPage();

      // 실행 ① — 저장값보다 먼저 사용자가 고른다
      openSheet();
      fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));

      // 실행 ② — 옛 저장값이 뒤늦게 도착
      await act(async () => {
        stored.resolve('start');
      });
      await settle();

      // 단언
      expect(cardOrder()).toEqual(TITLE);
      expect(triggerLabel()).toHaveTextContent('이름순');
      expect(writes()).toEqual([[SORT_KEY, 'title']]);
    });
  });

  describe('🔴 S9 · 여행 중은 이름순에서도 맨 위 (AC-11)', () => {
    it('여행 중 L(제주) + 예정 Y′(강릉)·Z′(부산) → 이름순 탭 → L·Y′·Z′', async () => {
      // 준비 — 전부 확정 일정, L 만 오늘이 기간 안(2020~2099)
      const L = trip(
        'L',
        '제주 여행',
        '2020-01-01',
        '2026-07-01T00:00:00.000Z',
        '2099-12-31'
      );
      // 최신순이면 L·Z2·Y2 — 이름순(L·Y2·Z2)과 구분되게 Z2 를 더 최근으로.
      const Y2 = trip(
        'Y2',
        '강릉 여행',
        '2099-03-01',
        '2026-09-10T00:00:00.000Z'
      );
      const Z2 = trip(
        'Z2',
        '부산 여행',
        '2099-04-01',
        '2026-09-20T00:00:00.000Z'
      );
      scriptTrips([Z2, L, Y2], CONFIRMED);
      scriptStoredSort(() => Promise.resolve(null));
      renderPage();
      await settle();

      // 실행
      openSheet();
      fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));
      await settle();

      // 단언 — 고정이 없었다면 Y2·Z2·L, 이름순이 안 먹었다면 L·Z2·Y2
      expect(cardOrder()).toEqual([
        'my-trip-card-L',
        'my-trip-card-Y2',
        'my-trip-card-Z2',
      ]);
      expect(triggerLabel()).toHaveTextContent('이름순');
    });
  });

  describe('🔴 S10 · 다시 들어와도 고른 기준이 남는다 (DoD 재실행의 jest 대리)', () => {
    it('메모리 금고에 이름순 저장 → 페이지를 내렸다 다시 올리면 이름순', async () => {
      // 준비 — 쓴 값을 그대로 읽어 주는 금고
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

      // 실행 ① — 첫 방문에서 이름순을 고르고 떠난다
      const first = renderPage();
      await settle();
      openSheet();
      fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));
      await settle();
      first.unmount();

      // 실행 ② — 다시 들어온다
      renderPage();
      await settle();

      // 단언 — 쓴 키 = 읽는 키라 기준이 살아 있다
      expect(cardOrder()).toEqual(TITLE);
      expect(triggerLabel()).toHaveTextContent('이름순');
    });
  });
});
