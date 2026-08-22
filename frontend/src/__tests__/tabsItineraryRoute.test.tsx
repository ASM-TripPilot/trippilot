import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
  Trip,
} from '@/shared/api/generated/schemas';
import {
  useGetTrips,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import ItineraryTab from '@/app/(tabs)/itinerary';

/**
 * (tabs)/일정 진입 라우트 — TRIP-468로 "첫 여행 리다이렉트 문지기"를 **내 여행 목록 뷰**(h37)로
 * 재작성(동결 개봉 — 구 해시 6b8acc82…, TRIP-401·371 선례로 새 사이클 개봉 정당).
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-1** 여행 2건+면 **모두 카드**로 뜬다(리다이렉트 없음) — 둘째 이후 여행이 이 탭에서
 *    영영 접근 불가였던 **핵심 결함**을 잠근다.
 *  - 🔴 **AC-2** 빈 배열이면 empty + [여행 만들기]→step1(리다이렉트 없음).
 *  - 🔴 **AC-3** trips.isPending 이면 스켈레톤 카드 2장(리다이렉트도 empty도 아님).
 *  - 🔴 **AC-5** 배지·부가정보를 **카드별 itinerary GET**에서 파생(완성→"확정 장소 N곳" 슬롯 합계 ·
 *    작성중→"추천안 준비 중" · 미도착→배지 미정 degrade).
 *  - 🔴 **AC-6** 카드 탭은 **눌린 카드의 tripId** 목적지로 간다(`[0]` 고정 검출) · 오늘이 구간이면 live.
 *  - 🔴 **AC-7** 최신순(updatedAt desc) 정렬 + "최신순" 라벨.
 *
 * 왜 이렇게 테스트하나: 라우트는 `pages/itinerary-list`(페이지→컨테이너→화면→카드)를 그리고
 * 데이터는 두 훅 seam(`useGetTrips`·`useGetTripsTripIdItinerary`)으로 주입한다. **N+1 훅-per-카드**를
 * 훅 목으로 재현 — `useGetTripsTripIdItinerary` 를 tripId별 대본으로 갈아끼운다(react-query 미구동 →
 * QueryClientProvider 불필요, 02a ★5). 목록 뷰는 리다이렉트하지 않지만 `Redirect` 를 **일부러
 * 목으로 남겨** `redirect-href` 마커가 뜨면 "리다이렉트로 회귀"를 잡는 트립와이어로 쓴다(★4).
 *
 * *(개념)* `getAllByTestId(/정규식/)` = **트리 순서(pre-order)** 배열(리포 선례 stayImport §5-5) —
 *   정렬(AC-7)을 배열 비교 한 줄로 잠근다. 카드 leaf testID 를 `my-trip-{part}-` 로 루트와 다른
 *   접두로 둬 `/^my-trip-card-/` 가 자식을 안 잡는다(02a §5-b).
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/expoRouterRedirectMock'),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
}));

const mockUseGetTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;

type ItineraryHookResult = ReturnType<typeof useGetTripsTripIdItinerary>;

/** 여행 한 벌 — 케이스마다 tripId·날짜·updatedAt 만 덮어쓴다. */
function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 'trip-a',
    title: '제주 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  };
}

/** 라우트가 쓰는 필드(data·isPending·isError)만 채운 여행 목록 조회 결과. */
function tripsData(data: Trip[]) {
  return {
    data,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTrips>;
}

const tripsPending = {
  data: undefined,
  isPending: true,
  isError: false,
} as unknown as ReturnType<typeof useGetTrips>;

/** 슬롯 n개(내용 무관 — 컨테이너는 개수만 센다). */
function slots(n: number): ItineraryDaysItemSlotsItem[] {
  return Array.from({ length: n }, () => ({}) as ItineraryDaysItemSlotsItem);
}

/** 일정 한 벌 — 목적지·배지 판정에 쓰는 축(generationState·status)과 슬롯 합계만 신경. */
function itin(
  generationState: Itinerary['generationState'],
  status: Itinerary['status'],
  slotCounts: number[] = [0]
): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: 'trip-a',
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState,
    days: slotCounts.map((count, i) => ({
      date: `2026-06-1${i}`,
      slots: slots(count),
    })),
  };
}

function itinOk(data: Itinerary): ItineraryHookResult {
  return {
    data,
    error: null,
    isPending: false,
    isError: false,
  } as unknown as ItineraryHookResult;
}

/** axios 상태코드 오류(404·500 등) — isNotFound 가 실제로 판정한다. */
function itinHttpError(statusCode: number): ItineraryHookResult {
  return {
    data: undefined,
    error: { isAxiosError: true, response: { status: statusCode } },
    isPending: false,
    isError: true,
  } as unknown as ItineraryHookResult;
}

const itinPending = {
  data: undefined,
  error: null,
  isPending: true,
  isError: false,
} as unknown as ItineraryHookResult;

/** tripId별로 다른 itinerary 를 준다(N+1 목). 대본에 없는 tripId 는 pending. */
function scriptItinerary(map: Record<string, ItineraryHookResult>) {
  mockUseItinerary.mockImplementation(
    (tripId: string) => map[tripId] ?? itinPending
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseGetTrips.mockReset();
  mockUseItinerary.mockReset();
});

describe('🔴 AC-1 · 여행 2건+ → 모두 카드 렌더 (리다이렉트 없음, 핵심 결함 수정)', () => {
  it('두 여행이 각각 카드로 뜨고, 아무 데로도 리다이렉트하지 않는다', () => {
    mockUseGetTrips.mockReturnValue(
      tripsData([trip({ tripId: 'trip-a' }), trip({ tripId: 'trip-b' })])
    );
    scriptItinerary({
      'trip-a': itinOk(itin('COMPLETE', 'CONFIRMED')),
      'trip-b': itinHttpError(404),
    });

    render(<ItineraryTab />);

    // ★ 둘째 여행도 카드로 접근 가능하다.
    expect(screen.getByTestId('my-trip-card-trip-a')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-card-trip-b')).toBeOnTheScreen();
    // 짝 — 아무 데로도 리다이렉트하지 않는다(Redirect 목이 마커를 안 남긴다).
    expect(screen.queryByTestId('redirect-href')).toBeNull();
  });
});

describe('🟢🔴 AC-2 · 빈 배열 → empty + [여행 만들기]→step1 (무리다이렉트)', () => {
  it('empty 상태를 그리고, 버튼이 여행 생성으로 이동하며, 리다이렉트하지 않는다', () => {
    mockUseGetTrips.mockReturnValue(tripsData([]));

    render(<ItineraryTab />);

    expect(screen.getByTestId('itinerary-tab-empty')).toBeOnTheScreen();
    expect(screen.getByText('아직 만든 여행이 없어요')).toBeOnTheScreen();
    // 짝 — 리다이렉트하지 않는다.
    expect(screen.queryByTestId('redirect-href')).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-tab-create-trip'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/new/step1');
  });
});

describe('🔴 AC-3 · trips.isPending → 스켈레톤 카드 2장 (리다이렉트도 empty도 아님)', () => {
  it('로딩 중이면 스켈레톤 2장을 그리고, 리다이렉트·empty 로 뭉개지 않는다', () => {
    mockUseGetTrips.mockReturnValue(tripsPending);

    render(<ItineraryTab />);

    expect(screen.getAllByTestId(/^my-trip-skeleton-/)).toHaveLength(2);
    // 짝 — 로딩을 리다이렉트나 "여행 없음"으로 접지 않는다.
    expect(screen.queryByTestId('redirect-href')).toBeNull();
    expect(screen.queryByTestId('itinerary-tab-empty')).toBeNull();
  });
});

describe('🔴 AC-7 · 최신순(updatedAt desc) 정렬 + "최신순" 라벨', () => {
  it('입력이 역순이어도 updatedAt 내림차순으로 그리고, 최신순 라벨을 보인다', () => {
    // 준비 — A 가 최신(2026-08-20), B 가 옛것(2026-08-10). 입력은 일부러 [B, A] 역순.
    mockUseGetTrips.mockReturnValue(
      tripsData([
        trip({ tripId: 'trip-b', updatedAt: '2026-08-10T00:00:00.000Z' }),
        trip({ tripId: 'trip-a', updatedAt: '2026-08-20T00:00:00.000Z' }),
      ])
    );
    scriptItinerary({
      'trip-a': itinOk(itin('COMPLETE', 'CONFIRMED')),
      'trip-b': itinOk(itin('COMPLETE', 'CONFIRMED')),
    });

    render(<ItineraryTab />);

    // ★ 카드 루트만 트리 순서로 뽑는다(자식 leaf 는 접두가 달라 안 걸림). 정렬 제거 시 [B, A].
    const order = screen
      .getAllByTestId(/^my-trip-card-/)
      .map((element) => element.props.testID);
    expect(order).toEqual(['my-trip-card-trip-a', 'my-trip-card-trip-b']);

    expect(screen.getByText('최신순')).toBeOnTheScreen();
  });
});

describe('🔴 AC-6 · 카드 탭은 눌린 카드의 tripId 목적지로 간다 (`[0]` 고정 검출)', () => {
  // A = 정렬상 첫 카드(최신·CONFIRMED→plan), B = 둘째 카드(옛것·404→method).
  // 둘째 카드를 눌러 목적지가 trip-b 인지 본다 — [0]/sorted[0] 고정이면 A 로 새 red.
  function renderTwoTrips() {
    mockUseGetTrips.mockReturnValue(
      tripsData([
        trip({ tripId: 'trip-a', updatedAt: '2026-08-20T00:00:00.000Z' }),
        trip({ tripId: 'trip-b', updatedAt: '2026-08-10T00:00:00.000Z' }),
      ])
    );
    scriptItinerary({
      'trip-a': itinOk(itin('COMPLETE', 'CONFIRMED')),
      'trip-b': itinHttpError(404),
    });
    render(<ItineraryTab />);
  }

  it('둘째 카드(B, 404)를 누르면 그 여행의 method 화면으로 간다', () => {
    renderTwoTrips();

    fireEvent.press(screen.getByTestId('my-trip-card-trip-b'));

    // String() — 목적지는 문자열 href 여야 한다(객체면 [object Object]로 즉시 red).
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe(
      '/trips/trip-b/itinerary/method'
    );
  });

  it('첫 카드(A, CONFIRMED)를 누르면 그 여행의 완성 일정(접미 없음)으로 간다', () => {
    renderTwoTrips();

    fireEvent.press(screen.getByTestId('my-trip-card-trip-a'));

    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/trip-a/itinerary');
  });
});

describe('🔴 AC-6b · 오늘이 여행 구간이면 live 로 (US-ONTRIP-01)', () => {
  it('오늘이 [startDate,endDate] 안이고 일정이 있으면 카드 탭이 /trips/{id}/live 로 간다', () => {
    // 오늘을 항상 포함하도록 폭을 넓게(과거~미래) 둔다.
    mockUseGetTrips.mockReturnValue(
      tripsData([
        trip({
          tripId: 'trip-live',
          startDate: '2020-01-01',
          endDate: '2099-12-31',
        }),
      ])
    );
    scriptItinerary({
      'trip-live': itinOk(itin('COMPLETE', 'CONFIRMED')),
    });

    render(<ItineraryTab />);
    fireEvent.press(screen.getByTestId('my-trip-card-trip-live'));

    // live 접미여야 한다(plan `/trips/{id}/itinerary` 가 아니다).
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/trip-live/live');
  });
});

describe('🔴 AC-5 · 배지·부가정보는 카드별 itinerary 에서 파생된다 (로딩 degrade 포함)', () => {
  it('완성→"확정 장소 N곳"(슬롯 합계) · 작성중→"추천안 준비 중" · 미도착→배지 미정', () => {
    mockUseGetTrips.mockReturnValue(
      tripsData([
        trip({ tripId: 'trip-done' }),
        trip({ tripId: 'trip-draft' }),
        trip({ tripId: 'trip-load' }),
      ])
    );
    scriptItinerary({
      // 완성 + 슬롯 2 + 1 = 3곳.
      'trip-done': itinOk(itin('COMPLETE', 'CONFIRMED', [2, 1])),
      'trip-draft': itinHttpError(404),
      'trip-load': itinPending,
    });

    render(<ItineraryTab />);

    // 완성 — "완성" 배지 + "확정 장소 3곳"(★ 슬롯 합계 파생, 상수 하드코딩이면 red).
    expect(screen.getByTestId('my-trip-badge-trip-done')).toHaveTextContent(
      '완성'
    );
    expect(screen.getByTestId('my-trip-extra-trip-done')).toHaveTextContent(
      '확정 장소 3곳'
    );

    // 작성중 — "작성중" 배지 + "추천안 준비 중".
    expect(screen.getByTestId('my-trip-badge-trip-draft')).toHaveTextContent(
      '작성중'
    );
    expect(screen.getByTestId('my-trip-extra-trip-draft')).toHaveTextContent(
      '추천안 준비 중'
    );

    // 미도착(degrade) — 배지 미정(부재) + 짝: 카드 자체는 뜬다.
    expect(screen.queryByTestId('my-trip-badge-trip-load')).toBeNull();
    expect(screen.getByTestId('my-trip-card-trip-load')).toBeOnTheScreen();
  });
});
