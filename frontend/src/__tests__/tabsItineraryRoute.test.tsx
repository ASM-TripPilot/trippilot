import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Trip } from '@/shared/api/generated/schemas';
import { useGetTrips } from '@/shared/api/generated/trips/trips';
import ItineraryTab from '@/app/(tabs)/itinerary';

/**
 * (tabs)/일정 진입 라우트 — 죽은 껍데기가 아니라 활성 여행으로 리다이렉트하거나 빈 상태를 준다(AC9).
 *
 * 무엇을 보장하나:
 *  - 🔴 **여행이 없으면** 빈 상태 + [여행 만들기] 를 그리고(리다이렉트하지 않는다), 버튼이 여행
 *    생성으로 이동한다.
 *  - 🔴 **여행이 있으면** 그 일정으로 리다이렉트한다.
 *
 * 왜 이렇게 테스트하나: 라우트 컴포넌트는 router 가 렌더해 props 를 못 받으므로, 여행 목록은
 * `useGetTrips` 훅 seam 으로 주입하고 목으로 갈아끼운다. expo-router `Redirect` 는 라우터
 * 컨텍스트 없이 관찰하려고 마커로 목킹한다 — 목적지 href 를 'redirect-href' 텍스트로 노출한다.
 *
 * *(개념)* expo-router `<Redirect href>`: 렌더되는 즉시 href 로 보내는 선언형 리다이렉트. 실제
 *   이동 대신 "어디로 보내려 했는가"만 관찰한다. 목은 `String(href)` 를 그리므로 라우트는
 *   **문자열 href** 를 써야 관찰된다(onboarding 선례 · 02a ★12).
 *
 * 커버 밖(02a ★13): 여러 여행 중 "어느 것이 활성"인지 규칙은 정본에 없어 **0개·1개** 만 잰다.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/expoRouterRedirectMock'),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
}));

const mockUseGetTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;

const TRIP_ID = '22222222-2222-2222-2222-222222222222';

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** 라우트가 쓰는 필드(data·isPending·isError)만 채운 조회 결과. */
function tripsResult(data: Trip[]) {
  return {
    data,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTrips>;
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseGetTrips.mockReset();
});

describe('🔴 X1 · AC9 — 여행이 없으면 빈 상태 + [여행 만들기]', () => {
  it('빈 상태를 그리고 리다이렉트하지 않으며, 버튼이 여행 생성으로 이동한다', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([]));

    render(<ItineraryTab />);

    // 긍정 — 빈 상태와 만들기 버튼이 있다.
    expect(screen.getByTestId('itinerary-tab-empty')).toBeOnTheScreen();
    expect(screen.getByText('여행 만들기')).toBeOnTheScreen();
    // 부정 짝 — 아무 데로도 리다이렉트하지 않는다(빈 상태와 리다이렉트가 동시에 뜨지 않는다).
    expect(screen.queryByTestId('redirect-href')).toBeNull();

    // 버튼이 여행 생성 라우트로 이동한다(리포 확립 목적지 /trips/new/step1).
    fireEvent.press(screen.getByTestId('itinerary-tab-create-trip'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    const destination = String(mockPush.mock.calls[0][0]);
    expect(destination).toContain('/trips/new');
  });
});

describe('🔴 X2 · AC9 — 여행이 있으면 그 일정으로 리다이렉트', () => {
  it('단일 여행이면 그 여행의 일정 라우트로 Redirect 한다', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([trip()]));

    render(<ItineraryTab />);

    // 긍정 — 리다이렉트 목적지가 그 여행의 일정이다(부분 포함 · 문자열 href).
    expect(screen.getByTestId('redirect-href')).toHaveTextContent(
      new RegExp(`/trips/${TRIP_ID}/itinerary`)
    );
    // 부정 짝 — 빈 상태를 함께 그리지 않는다.
    expect(screen.queryByTestId('itinerary-tab-empty')).toBeNull();
  });
});
