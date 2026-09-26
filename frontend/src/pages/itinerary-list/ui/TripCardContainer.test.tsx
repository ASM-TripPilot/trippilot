import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-788 · AC-1~5(급소) — `TripCardContainer` 의 VM 조립을 처음 심판한다.
 *
 * traps-itinerary: 컨테이너의 상태문·resume 조립을 실행하는 승인 심판이 **0**이었다
 * (`MyTripCard.test.tsx` 는 하드코딩 VM props-only, `tabsItineraryRoute` 는 route 통짜라 카드별
 * 파생을 정밀히 안 잰다). 그래서 컨테이너를 `useGetTripsTripIdItinerary` 목과 **직접 렌더**해
 * `deriveTripCardFace` 관통(상태문·배지·resume)을 카드별로 못박는다 — 순수 `tripCardFace.test.ts`
 * (매핑)와 짝: 순수만으론 컨테이너가 함수를 안 부르고 상수를 박아도 통과한다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-1** PARTIAL → 상태문 'AI가 일정을 짜는 중' · 배지 '작성중' · **resume 부재**(★ seam
 *    누출 트립와이어 — 배지가 '작성중'인데 resume 가 뜨면 red. 배지로 resume 를 가르는 현행이 여기서 샌다).
 *  - 🔴 **AC-2** COMPLETE/FAILED + PLANNED → 상태문 '추천안 준비 중' · resume 존재('일정 이어서 짜기').
 *  - 🔴 **AC-3** CONFIRMED → 상태문 '일정 확정' · 배지 '완성' · resume 부재(TRIP-986 Seed D2 — 구 '추천안이 준비됐어요' 교체).
 *  - 🔴 **AC-4** isPending → 배지·상태문·resume 전부 부재, 카드·(짝)는 뜬다(공짜 통과 차단).
 *
 * 왜 이렇게 테스트하나: 컨테이너는 `useGetTripsTripIdItinerary` 하나를 물어 VM 을 조립해 순수
 * `MyTripCard`(testIDPrefix="my-trip") 에 내린다. 훅을 목하면 react-query 미구동 →
 * QueryClientProvider 불필요(tabsItineraryRoute 선례). testID 는 `my-trip-{part}-{tripId}`.
 */

// TRIP-986 — 카드 탭 목적지를 관찰하려고 파일 수준 `mockPush` 로 바꿨다(인라인 `jest.fn()` 은 렌더마다
// 새 함수라 호출을 못 본다). `mock` 접두라 호이스팅된 팩토리가 호출 시점에 읽는다(02a ★B-1).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripIdItinerary: jest.fn(),
}));

const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;

type ItineraryHookResult = ReturnType<typeof useGetTripsTripIdItinerary>;

/** 여행 한 벌 — tripId 고정(카드 leaf testID 접미). 날짜·인원은 metaLine 조립용(이 테스트 무관). */
function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 't1',
    title: '제주 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
  };
}

/** 일정 한 벌 — 얼굴 판정에 쓰는 두 축(generationState·status)만 신경(슬롯은 안 셈, 완성 문구가 상수라). */
function itin(
  generationState: Itinerary['generationState'],
  status: Itinerary['status']
): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: 't1',
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState,
    days: [],
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

const itinPending = {
  data: undefined,
  error: null,
  isPending: true,
  isError: false,
} as unknown as ItineraryHookResult;

beforeEach(() => {
  mockUseItinerary.mockReset();
  mockPush.mockClear();
});

describe('🔴 AC-1 · 생성중(PARTIAL) — resume 누출 seam', () => {
  it('상태문 "AI가 일정을 짜는 중" · 배지 "작성중" · resume 부재(배지=작성중이어도 resume 안 샌다)', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('PARTIAL', 'PLANNED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      'AI가 일정을 짜는 중'
    );
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    // ★ 트립와이어 — 배지가 '작성중'(draft)인데 resume 는 없어야 한다(배지로 가르면 여기서 샌다).
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });
});

describe('🔴 AC-2 · 초안 — resume 존재', () => {
  it('COMPLETE+PLANNED → "추천안 준비 중" · "일정 이어서 짜기" resume 존재', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'PLANNED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '추천안 준비 중'
    );
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    expect(screen.getByTestId('my-trip-resume-t1')).toHaveTextContent(
      '일정 이어서 짜기'
    );
  });

  it('FAILED+PLANNED(Q3) → 초안 얼굴로 접힌다(별도 실패 얼굴 없음, resume 존재)', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('FAILED', 'PLANNED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '추천안 준비 중'
    );
    expect(screen.getByTestId('my-trip-resume-t1')).toBeOnTheScreen();
  });
});

describe('🔴 AC-3 · 완성(CONFIRMED) — TRIP-986 AC-B2(#037)', () => {
  it('상태문 "일정 확정"(구 "추천안이 준비됐어요" 교체, Seed D2) · 배지 "완성" · resume 부재', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '일정 확정'
    );
    expect(screen.queryByText('추천안이 준비됐어요')).toBeNull();
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });
});

describe('🔴 AC-4 · degrade(isPending) — 배지·상태문·resume 부재, 카드는 뜬다', () => {
  it('itinerary 미도착이면 배지·부가정보·resume 이 없고 카드·제목만 남는다', () => {
    mockUseItinerary.mockReturnValue(itinPending);

    render(<TripCardContainer trip={trip()} />);

    expect(screen.queryByTestId('my-trip-badge-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-extra-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();

    // 짝 — 카드 골격(루트·제목)은 그대로 뜬다(아무것도 안 그려서 위 부정이 공짜 통과하는 것 차단).
    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-title-t1')).toBeOnTheScreen();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-986 B · 카드 상태문·목적지가 일정 상태 하나로 판정된다 (Seed D2 · D3 · Q3 · Q4 · INV-4).

/** axios 상태코드 오류 — 실 `isNotFound` 가 이 평문 shape 를 판정한다(`isAxiosError: true` 만 본다). */
function itinHttpError(statusCode: number): ItineraryHookResult {
  return {
    data: undefined,
    error: { isAxiosError: true, response: { status: statusCode } },
    isPending: false,
    isError: true,
  } as unknown as ItineraryHookResult;
}

/** 실시계 오늘을 항상 포함하는 여행 기간(fake timers 없이 "여행 중"을 만든다, 02a ★A-3). */
const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' } as const;

describe('🔴 986-B1 · 일정 없음(404, #017) — "아직 일정이 없어요" · resume 없음 · 방식 선택으로', () => {
  it('"추천안 준비 중"이 아니라 "아직 일정이 없어요" · 배지 "작성중"(Q3) · resume 부재 · 탭 → method', () => {
    mockUseItinerary.mockReturnValue(itinHttpError(404));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '아직 일정이 없어요'
    );
    expect(screen.getByTestId('my-trip-extra-t1')).not.toHaveTextContent(
      /추천안 준비 중/
    );
    // Q3 — 여행 계획이 진행 중이라는 뜻으로 배지는 남긴다(02a ★B-4: 404 를 degrade 로 접으면 red).
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    // 이어서 짤 것이 없으니 "일정 이어서 짜기"는 거짓 행동이다.
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();

    fireEvent.press(screen.getByTestId('my-trip-card-t1'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe(
      '/trips/t1/itinerary/method'
    );
  });
});

describe('986-B3 · 여행 기간 중 카드 탭 목적지 (#058 · Seed D3 — "여행 중이면 무조건 live" 특례 제거)', () => {
  it('🔴 오늘이 여행 기간 안이어도 미확정 초안이면 초안 화면(draft)으로 1회 간다 — live 아님', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'PLANNED')));

    render(<TripCardContainer trip={trip(DURING)} />);
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/t1/itinerary/draft');
  });

  it('🟢 같은 기간에 확정 일정이면 여행 중 화면(live)으로 1회 간다 (US-ONTRIP-01, 02a ★B-2)', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

    render(<TripCardContainer trip={trip(DURING)} />);
    fireEvent.press(screen.getByTestId('my-trip-card-t1'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/t1/live');
  });
});

describe('🔴 986-B4 · 404 가 아닌 조회 실패(500) — "일정 없음"이라 말하지 않는다 (INV-4 · Q4)', () => {
  it('로딩과 같은 degrade — 배지·상태문·resume 전부 없고, 카드·제목은 뜬다', () => {
    mockUseItinerary.mockReturnValue(itinHttpError(500));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.queryByText('아직 일정이 없어요')).toBeNull();
    expect(screen.queryByTestId('my-trip-badge-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-extra-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
    // 짝 — 카드 골격은 뜬다(아무것도 안 그려서 위 부정이 공짜 통과하는 것 차단, 02a ★B-3).
    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-title-t1')).toBeOnTheScreen();
  });
});

describe('986-C3 · 끝난 여행(ENDED)도 카드 얼굴은 일정 상태만 본다 (Seed D4 — 제외는 완료 바에만)', () => {
  it('Trip.status ENDED + 확정 일정 → 배지 "완성" · 상태문 "일정 확정"', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

    render(<TripCardContainer trip={trip({ status: 'ENDED' })} />);

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '일정 확정'
    );
  });
});
