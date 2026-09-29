import { render, screen } from '@testing-library/react-native';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-1121 · AC-4·AC-6 — 컨테이너가 페이지에서 받은 `today` 로 "여행 중" 배지를 낸다.
 *
 * 규칙(01b D4·D5·D6): 페이지가 오늘(서울)을 한 번 만들어 `today` prop 으로 내린다. 컨테이너는 시계를
 * 읽지 않는다(TRIP-986 에서 지운 패턴). 확정 + 오늘이 기간 안이면 배지 '여행 중', ⋯ 삭제 메뉴 없음.
 *
 * 무엇을 보장하나:
 *  - 🔴 K1 확정 + 기간 안 → '여행 중' · 상태문 '일정 확정' · ⋯·resume 없음(삭제 콜백을 줘도).
 *  - 🟢 K2 같은 기간 초안 → '작성중' · ⋯ 있음(US-TRIP-10 — 작성중만 삭제).
 *  - 🟢 K3 확정이어도 기간 밖이면 '완성'(지난 여행 배지는 범위 밖, D8).
 *  - 🟢 K4 today 를 안 주면 기간 안 확정이어도 '완성' — 컨테이너가 몰래 시계를 읽으면 red(02a ★4).
 *  - 🟢 K5 일정 미도착·500 이면 today 가 있어도 배지 없음(INV-4 degrade).
 *
 * 시계를 흉내 내지 않는다 — today 를 문자열로 준다(K1~K3·K5). K4 만 일부러 항상 참인 기간(2020~2099)을 쓴다.
 */

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

const TODAY = '2026-09-29';
const IN = { startDate: '2026-09-28', endDate: '2026-10-01' } as const;
const DURING = { startDate: '2020-01-01', endDate: '2099-12-31' } as const;

function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 't1',
    title: '부산 여행',
    ...IN,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 3 }],
    status: 'ACTIVE',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
  };
}

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

const itin500 = {
  data: undefined,
  error: { isAxiosError: true, response: { status: 500 } },
  isPending: false,
  isError: true,
} as unknown as ItineraryHookResult;

beforeEach(() => {
  mockUseItinerary.mockReset();
  mockPush.mockClear();
});

describe('🔴 K1 · 확정 + 오늘이 기간 안 → "여행 중"', () => {
  it('배지 "여행 중" · 상태문 "일정 확정" · 삭제 콜백을 줘도 ⋯·resume 없음', () => {
    // 준비
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

    // 실행
    render(
      <TripCardContainer
        trip={trip()}
        today={TODAY}
        onPressDelete={jest.fn()}
      />
    );

    // 단언
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('여행 중');
    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '일정 확정'
    );
    expect(screen.queryByTestId('my-trip-menu-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });
});

describe('🟢 K2 · 같은 기간 초안은 "작성중" + ⋯ 유지 (US-TRIP-10)', () => {
  it('PLANNED 초안 → 배지 "작성중" · ⋯ 있음 · resume 있음', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'PLANNED')));

    render(
      <TripCardContainer
        trip={trip()}
        today={TODAY}
        onPressDelete={jest.fn()}
      />
    );

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    expect(screen.getByTestId('my-trip-menu-t1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-resume-t1')).toBeOnTheScreen();
  });
});

describe('🟢 K3 · 확정이어도 기간 밖이면 "완성" (D8)', () => {
  it.each([
    ['끝난 뒤', '2026-10-05'],
    ['시작 전', '2026-09-20'],
  ])('오늘이 %s(%s) → 배지 "완성"', (_label, today) => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

    render(<TripCardContainer trip={trip()} today={today} />);

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
  });
});

describe('🟢 K4 · today 가 없으면 여행 중 판정을 안 한다 — 시계를 읽지 않는다 (D4)', () => {
  it('항상 참인 기간(2020~2099) 확정 여행이어도 today 없으면 "완성"', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

    render(<TripCardContainer trip={trip(DURING)} />);

    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
  });
});

describe('🟢 K5 · 일정을 모르면 today 가 있어도 배지 없음 (INV-4)', () => {
  it.each([
    ['미도착(pending)', itinPending],
    ['500 조회 실패', itin500],
  ])('%s → 배지·상태문 없음, 카드는 뜬다', (_label, hook) => {
    mockUseItinerary.mockReturnValue(hook);

    render(<TripCardContainer trip={trip()} today={TODAY} />);

    expect(screen.queryByTestId('my-trip-badge-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-extra-t1')).toBeNull();
    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
  });
});
