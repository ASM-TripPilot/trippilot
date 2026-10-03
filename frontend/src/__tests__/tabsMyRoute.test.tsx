import { screen } from '@testing-library/react-native';

import type {
  AccountSummary,
  Profile,
  Trip,
} from '@/shared/api/generated/schemas';
import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';
import { useGetMeStyle } from '@/shared/api/generated/reflection/reflection';
import {
  getGetTripsTripIdItineraryQueryOptions,
  useGetMeRecords,
  useGetTrips,
  useGetTripsTripIdBases,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import MyScreen from '@/app/(tabs)/my';
import {
  CONFIRMED,
  DURING,
  FUTURE,
  PLANNED,
  renderWithQueryClient,
  scriptItineraryOptions,
  settle,
} from '@/test-support/myPageItineraries';

/**
 * TRIP-604 · (tabs)/my.tsx — TRIP-290 "마이 준비 중" StateNotice 셸을 l03 실화면으로 교체.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-8 라우트가 `@/pages/settings/my-page` 슬라이스를 렌더한다 — `shell-tab-placeholder-my`(구 셸) 제거.
 *  - 🔴 AC-7 testID 계약 `my-profile-card`·`my-profile-count-{upcoming|active|ended}` 존재.
 *    TRIP-1123 부터 세그(`my-trip-segment`)·여행 카드(`my-trip-card-{tripId}`)는 **없다**(일정 탭과 겹쳐 제거).
 *  - 🔴 AC-1 프로필 카드가 닉네임을 보이고 숫자 3칸을 그린다(초안은 세지 않는다 — 미래 초안 1건 → 예정 0).
 *  - 🔴 AC-5 종료 여행 0건이면 "아직 종료된 여행이 없습니다"만, **회고 진입 렌더 0**(비활성 버튼도 위반).
 *    "지난 여행" 섹션은 예정 0건일 때만 보이므로 픽스처는 **예정 0**(확정 진행 중만)이다.
 *
 * 왜 이렇게 테스트하나(02a ★1·★2): 프로필·계정·여행 목록이 orval 훅 seam 이라 훅 목으로 주입한다.
 * `jest.mock` factory는 최상단 호이스트 — 외부 변수 참조 없이 `jest.fn()`만 만들고 import 심볼을 캐스팅해 제어.
 * TRIP-1123: 페이지가 여행별 일정을 `useQueries`(목 옵션 함수의 queryFn 이 진짜로 돈다)로 부르므로 실
 * `QueryClientProvider` 아래에서 그리고 `settle()` 로 기다린다. 라우트는 얇은 배선이라 `MyScreen`을 그대로 렌더한다.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

jest.mock('@/shared/api/generated/account/account', () => ({
  useGetMe: jest.fn(),
}));
jest.mock('@/shared/api/generated/profile/profile', () => ({
  useGetMeProfile: jest.fn(),
}));
jest.mock('@/shared/api/generated/reflection/reflection', () => ({
  useGetMeStyle: jest.fn(),
}));
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  useGetTripsTripIdBases: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
  // TRIP-776 — 페이지가 지난 여행 "사진 N" 을 위해 부르는 목록 조회(이 스모크는 사진 수를 단언하지 않는다).
  useGetMeRecords: jest.fn(),
  getGetTripsTripIdItineraryQueryOptions: jest.fn(),
}));

const mockUseMe = useGetMe as jest.MockedFunction<typeof useGetMe>;
const mockUseProfile = useGetMeProfile as jest.MockedFunction<
  typeof useGetMeProfile
>;
const mockUseStyle = useGetMeStyle as jest.MockedFunction<typeof useGetMeStyle>;
const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
const mockUseBases = useGetTripsTripIdBases as jest.MockedFunction<
  typeof useGetTripsTripIdBases
>;
const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;
const mockUseRecords = useGetMeRecords as jest.MockedFunction<
  typeof useGetMeRecords
>;
const mockQueryOptions = getGetTripsTripIdItineraryQueryOptions as jest.Mock;

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
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
  };
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseMe.mockReturnValue(meResult());
  mockUseProfile.mockReturnValue(profileResult());
  // TRIP-606 l03 스타일 카드 훅 — 이 라우트 스모크는 스타일 카드를 단언하지 않으므로
  // 미달(요약 없음) 얼굴로 고정한다: `data: undefined` → styleCard 미렌더, 기존 3 it 무변.
  mockUseStyle.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetMeStyle>);
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
  // 사진 수 목록 — 응답 전(사진 글자 없음).
  mockUseRecords.mockReturnValue({
    data: undefined,
    isPending: true,
    isError: false,
  } as unknown as ReturnType<typeof useGetMeRecords>);
});

describe('🔴 AC-8 · 셸 교체 — StateNotice 제거, my-page 슬라이스 렌더', () => {
  it('구 "마이 준비 중" 셸(shell-tab-placeholder-my)이 사라지고 프로필 카드가 뜬다', () => {
    mockUseTrips.mockReturnValue(tripsResult([]));

    renderWithQueryClient(<MyScreen />);

    // 짝 — 구 셸 제거(부정)와 신 슬라이스 렌더(긍정)를 함께 단언.
    expect(screen.queryByTestId('shell-tab-placeholder-my')).toBeNull();
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
  });
});

describe('🔴 AC-7 · AC-1 구조 — 프로필 카드·숫자 3칸, 세그·여행 카드 없음', () => {
  it('프로필 카드에 닉네임과 숫자 3칸이 있고, 세그·여행 카드는 없다(미래 초안 1건 → 예정 0)', async () => {
    // 준비 — 미래 여행 1건, 일정 미확정(초안).
    mockUseProfile.mockReturnValue(profileResult({ nickname: '홍길동' }));
    mockUseTrips.mockReturnValue(
      tripsResult([trip({ tripId: 'up-1', ...FUTURE, status: 'PLANNED' })])
    );
    scriptItineraryOptions(mockQueryOptions, { 'up-1': PLANNED });

    // 실행
    renderWithQueryClient(<MyScreen />);
    await settle();

    // 단언
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
    expect(screen.getByText('홍길동')).toBeOnTheScreen();
    (['upcoming', 'active', 'ended'] as const).forEach((bucket) => {
      expect(
        screen.getByTestId(`my-profile-count-${bucket}`)
      ).toBeOnTheScreen();
    });
    expect(
      screen.getByTestId('my-profile-count-upcoming-value')
    ).toHaveTextContent('0');
    expect(screen.queryAllByTestId(/^my-trip-segment/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^my-trip-card-/)).toHaveLength(0);
  });
});

describe('🔴 AC-5 · 종료 0건 → 안내만, 회고 진입 렌더 0', () => {
  it('예정 0·종료 0(확정 진행 중만)이면 회고 진입이 어디에도 없고, 안내 문구만 뜬다', async () => {
    // 준비: 확정 진행 중 1건만 — 예정 0이라 "지난 여행" 섹션이 보이는 조건.
    mockUseTrips.mockReturnValue(
      tripsResult([trip({ tripId: 'act-1', ...DURING, status: 'ACTIVE' })])
    );
    scriptItineraryOptions(mockQueryOptions, { 'act-1': CONFIRMED });

    // 실행
    renderWithQueryClient(<MyScreen />);
    await settle();

    // 하드 락(부정) — 회고 진입 어포던스가 하나도 없다(비활성 버튼도 위반, ★7).
    expect(screen.queryAllByTestId(/^my-trip-reflection-/)).toHaveLength(0);
    // 긍정 짝1 — 판정이 끝났다(진행 중 1).
    expect(
      screen.getByTestId('my-profile-count-active-value')
    ).toHaveTextContent('1');
    // 긍정 짝2 — 종료-빈 상태를 안내한다(★12, AC-5 문구 계약).
    expect(screen.getByText('아직 종료된 여행이 없습니다')).toBeOnTheScreen();
  });
});
