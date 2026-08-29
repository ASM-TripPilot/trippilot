import { render, screen } from '@testing-library/react-native';

import type {
  AccountSummary,
  Profile,
  Trip,
} from '@/shared/api/generated/schemas';
import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';
import {
  useGetTrips,
  useGetTripsTripIdBases,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import MyScreen from '@/app/(tabs)/my';

/**
 * TRIP-604 · (tabs)/my.tsx — TRIP-290 "마이 준비 중" StateNotice 셸을 l03 실화면으로 교체.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-8 라우트가 `@/pages/my-page` 슬라이스를 렌더한다 — `shell-tab-placeholder-my`(구 셸) 제거.
 *  - 🔴 AC-7 testID 계약 `my-profile-card`·`my-trip-segment`·`my-trip-card-{tripId}` 존재.
 *  - 🔴 AC-1 프로필 카드가 닉네임을 보이고 세그먼트·카드를 그린다.
 *  - 🔴 AC-5 종료 여행 0건이면 "아직 종료된 여행이 없습니다"만, **회고 진입 렌더 0**(비활성 버튼도 위반).
 *
 * 왜 이렇게 테스트하나(02a ★1·★2): 프로필·계정·여행 목록·카드별 bases/itinerary가 전부 orval 훅
 * seam이라 훅 목으로 주입한다. `jest.mock` factory는 최상단 호이스트 — 외부 변수 참조 없이
 * `jest.fn()`만 만들고 import 심볼을 캐스팅해 제어(호이스팅 규칙). 훅 전체 목이라 react-query 미구동
 * → `QueryClientProvider` 불필요. 라우트는 얇은 배선이라 `MyScreen`을 그대로 렌더한다.
 *
 * ⚠️ 이 파일은 구현 전엔 현 StateNotice 셸을 렌더하므로 AC-8/7/1/5 단언이 red다(셸이 아직 교체 안 됨).
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/account/account', () => ({
  useGetMe: jest.fn(),
}));
jest.mock('@/shared/api/generated/profile/profile', () => ({
  useGetMeProfile: jest.fn(),
}));
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  useGetTripsTripIdBases: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
}));

const mockUseMe = useGetMe as jest.MockedFunction<typeof useGetMe>;
const mockUseProfile = useGetMeProfile as jest.MockedFunction<
  typeof useGetMeProfile
>;
const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
const mockUseBases = useGetTripsTripIdBases as jest.MockedFunction<
  typeof useGetTripsTripIdBases
>;
const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;

function meResult(over: Partial<AccountSummary> = {}) {
  return {
    data: { email: 'user@example.com', ...over },
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetMe>;
}

function profileResult(over: Partial<Profile> = {}) {
  return {
    data: { nickname: '홍길동', ...over },
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetMeProfile>;
}

function tripsResult(data: Trip[]) {
  return { data, isPending: false, isError: false } as unknown as ReturnType<
    typeof useGetTrips
  >;
}

function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 'trip-a',
    title: '여름 휴가',
    startDate: '2026-06-10',
    endDate: '2026-06-12',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseMe.mockReturnValue(meResult());
  mockUseProfile.mockReturnValue(profileResult());
  mockUseTrips.mockReturnValue(tripsResult([]));
  // 카드별 N+1 훅 기본값(빈 숙소·1일 일정) — 카드가 크래시 없이 렌더된다.
  mockUseBases.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTripsTripIdBases>);
  mockUseItinerary.mockReturnValue({
    data: { days: [{ date: '2026-06-10', slots: [] }] },
    error: null,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTripsTripIdItinerary>);
});

describe('🔴 AC-8 · 셸 교체 — StateNotice 제거, my-page 슬라이스 렌더', () => {
  it('구 "마이 준비 중" 셸(shell-tab-placeholder-my)이 사라지고 프로필 카드가 뜬다', () => {
    mockUseTrips.mockReturnValue(tripsResult([]));

    render(<MyScreen />);

    // 짝 — 구 셸 제거(부정)와 신 슬라이스 렌더(긍정)를 함께 단언.
    expect(screen.queryByTestId('shell-tab-placeholder-my')).toBeNull();
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
  });
});

describe('🔴 AC-7 · AC-1 구조 — 프로필 카드·세그먼트·여행 카드', () => {
  it('프로필 카드에 닉네임을 보이고, 세그먼트와 여행 카드를 그린다', () => {
    mockUseProfile.mockReturnValue(profileResult({ nickname: '홍길동' }));
    mockUseTrips.mockReturnValue(
      tripsResult([trip({ tripId: 'up-1', status: 'PLANNED' })])
    );

    render(<MyScreen />);

    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
    expect(screen.getByText('홍길동')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-segment')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-card-up-1')).toBeOnTheScreen();
  });
});

describe('🔴 AC-5 · 종료 0건 → 안내만, 회고 진입 렌더 0', () => {
  it('종료 여행이 없으면 회고 진입이 어디에도 없고, 안내 문구만 뜬다', () => {
    // 종료(ENDED) 0건 — 예정·진행 중만.
    mockUseTrips.mockReturnValue(
      tripsResult([
        trip({ tripId: 'up-1', status: 'PLANNED' }),
        trip({ tripId: 'act-1', status: 'ACTIVE' }),
      ])
    );

    render(<MyScreen />);

    // 하드 락(부정) — 회고 진입 어포던스가 하나도 없다(비활성 버튼도 위반, ★7).
    expect(screen.queryAllByTestId(/^my-trip-reflection-/)).toHaveLength(0);

    // 긍정 짝1 — 화면이 통째로 안 그려져 우연 통과하는 것을 막는다(루트 생존).
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-card-up-1')).toBeOnTheScreen();

    // 긍정 짝2 — 종료-빈 상태를 초기 렌더에 안내한다(★12, AC-5 문구 계약).
    expect(screen.getByText('아직 종료된 여행이 없습니다')).toBeOnTheScreen();
  });
});
