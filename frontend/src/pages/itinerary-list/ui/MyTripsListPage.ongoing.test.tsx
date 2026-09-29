import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdItineraryQueryOptions,
  useGetTrips,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { MyTripsListPage } from '@/pages/itinerary-list';

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

const mockUseGetTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
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
    expect(screen.getByTestId('my-trip-badge-A')).toHaveTextContent('여행 중');
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
    expect(screen.getByTestId('my-trip-badge-A2')).toHaveTextContent('작성중');
    expect(screen.getByTestId('my-trip-menu-A')).toBeOnTheScreen();
  });
});
