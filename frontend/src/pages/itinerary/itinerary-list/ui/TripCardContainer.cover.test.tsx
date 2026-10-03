import { render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';

import type { Itinerary, Trip } from '@/shared/api/index.schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/index.hooks';
import { COVER_GRADIENTS } from '@/entities/trip';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-1208 · 컨테이너가 커버 도시·톤을 VM 에 싣는다 — 첫 목적지 region, 여행 단계(live/ended/그 외).
 */

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripIdItinerary: jest.fn(),
}));

const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;
type Hook = ReturnType<typeof useGetTripsTripIdItinerary>;

function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 't1',
    title: '제주 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [
      { seq: 2, region: '서귀포', nights: 1 },
      { seq: 1, region: '제주', nights: 2 },
    ],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
  };
}

const confirmed = {
  data: {
    itineraryId: 'i1',
    tripId: 't1',
    status: 'CONFIRMED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [],
  } as Itinerary,
  error: null,
  isPending: false,
  isError: false,
} as unknown as Hook;

beforeEach(() => mockUseItinerary.mockReset());

describe('TRIP-1208 · 컨테이너 → 커버', () => {
  it('첫 목적지(seq 최소) 도시 이름이 커버에 뜬다', () => {
    mockUseItinerary.mockReturnValue(confirmed);
    render(<TripCardContainer trip={trip()} />);
    expect(screen.getByTestId('my-trip-city-t1')).toHaveTextContent('제주');
  });

  it('목적지가 비면 글자 없이 그라데이션만', () => {
    mockUseItinerary.mockReturnValue(confirmed);
    render(<TripCardContainer trip={trip({ destinations: [] })} />);
    expect(screen.queryByTestId('my-trip-city-t1')).toBeNull();
    expect(screen.UNSAFE_getByType(LinearGradient)).toBeTruthy();
  });

  it.each([
    ['여행 중(확정 + 오늘이 기간 안)', '2026-06-11', 'live'],
    ['종료(확정 + 오늘이 종료 뒤)', '2026-06-20', 'ended'],
    ['예정(확정 + 오늘이 시작 전)', '2026-06-01', 'upcoming'],
    ['오늘 미전달', undefined, 'upcoming'],
  ] as const)('%s → %s 톤', (_n, today, tone) => {
    mockUseItinerary.mockReturnValue(confirmed);
    render(<TripCardContainer trip={trip()} today={today} />);
    expect(screen.UNSAFE_getByType(LinearGradient).props.colors).toEqual([
      ...COVER_GRADIENTS[tone],
    ]);
  });
});
