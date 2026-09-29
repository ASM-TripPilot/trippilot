import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdItineraryQueryOptions,
  useGetTrips,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { MyTripsListPage } from '@/pages/itinerary-list';

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

jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/expoRouterRedirectMock'),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
  }),
}));

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
  readIdSet: () => new Promise(() => {}),
  writeIdSet: () => new Promise(() => {}),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockUseGetTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
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
function scriptTrips(trips: Trip[], itinerary: Itinerary | 'never' = 'never') {
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
    mockSetItem.mockReset().mockImplementation(async (k: string, v: string) => {
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
