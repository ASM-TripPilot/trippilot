import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-506 · AC-3·AC-4 — 일정 탭 카드의 live 분기가 "오늘"을 KST 로 판정하는가.
 *
 * 시계를 KST 경계 순간에 고정하고 카드를 눌러 push 경로를 본다. 여행은 2026-08-22~08-23.
 *  - AC-3 KST 08-22 00:30(UTC 로는 08-21) · 09:30 → `/trips/t1/live`.
 *  - AC-4 KST 08-24 00:30(UTC 로는 08-23, 아직 여행 중으로 오판되던 순간) → live 가 아닌 일정 경로.
 *
 * push 를 관찰하려고 `useRouter` 가 파일 수준 `mockPush` 하나를 돌려준다(`TripCardContainer.test.tsx`
 * 의 인라인 `jest.fn()` 은 렌더마다 새 함수라 관찰 불가). 훅을 목으로 막아 렌더가 동기라
 * fake timers 아래 `waitFor`/`findBy` 없이 돈다.
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

const TRIP: Trip = {
  tripId: 't1',
  title: '제주 여행',
  startDate: '2026-08-22',
  endDate: '2026-08-23',
  party: 2,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '제주', nights: 1 }],
  status: 'CONFIRMED',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

/** 확정 일정 — 여행 구간 밖이면 목적지가 `plan`(`/trips/t1/itinerary`)으로 정해진다. */
const CONFIRMED_ITINERARY: Itinerary = {
  itineraryId: 'itin-1',
  tripId: 't1',
  status: 'CONFIRMED',
  solveMode: 'FULL_AI',
  generationMode: 'FULLY_AI',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [],
};

beforeEach(() => {
  mockPush.mockReset();
  mockUseItinerary.mockReset();
  mockUseItinerary.mockReturnValue({
    data: CONFIRMED_ITINERARY,
    error: null,
    isPending: false,
    isError: false,
  } as unknown as ItineraryHookResult);
});

afterEach(() => {
  jest.useRealTimers();
});

function pressCardAt(instant: string): void {
  jest.useFakeTimers({ now: new Date(instant) });
  render(<TripCardContainer trip={TRIP} />);
  fireEvent.press(screen.getByTestId('my-trip-card-t1'));
}

describe('AC-3 · 여행 첫날 KST 새벽·오전 — live 로 간다', () => {
  it('KST 2026-08-22 00:30(UTC 08-21 15:30) → /trips/t1/live', () => {
    pressCardAt('2026-08-21T15:30:00Z');

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trips/t1/live');
  });

  it('KST 2026-08-22 09:30(UTC 08-22 00:30) → /trips/t1/live', () => {
    pressCardAt('2026-08-22T00:30:00Z');

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trips/t1/live');
  });
});

describe('AC-4 · 여행 끝난 다음 날 KST 새벽 — live 로 가지 않는다', () => {
  it('KST 2026-08-24 00:30(UTC 08-23 15:30) → live 아닌 /trips/t1/itinerary', () => {
    pressCardAt('2026-08-23T15:30:00Z');

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trips/t1/itinerary');
  });
});
