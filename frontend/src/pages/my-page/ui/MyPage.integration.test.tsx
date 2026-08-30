import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { StyleAnalysisEnvelope } from '@/shared/api/generated/schemas';
import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';
import { useGetMeStyle } from '@/shared/api/generated/reflection/reflection';
import { useGetTrips } from '@/shared/api/generated/trips/trips';

import { MyPage } from './MyPage';

/**
 * TRIP-606 · l03 마이페이지 배선(AC-I1) — 화면 단위 테스트가 못 보는 **조회→모델→배치**를 real-render 로 잠근다.
 *
 * 무엇을 보장하나:
 *  - 🔴 AC-I1 배선: MyPage 가 `useGetMeStyle()` envelope 를 `buildStyleCardModel` 에 태워 `StyleSummaryCard` 로
 *    그린다(칩·게이지가 envelope 값을 관통해 실제로 렌더).
 *  - 🔴 AC-I1 배치: 그 카드가 **ProfileCard(`my-profile-card`)와 TripStatusSegment(`my-trip-segment`) 사이**에
 *    additive prop 으로 놓이고, 기존 testID 는 무변경이다.
 *
 * 왜 이렇게 테스트하나(02a ★9):
 *  - 화면 목(props-capture)이 아니라 **real MyPage 렌더** — 배치는 MyPageScreen 몫이라 목으로는 못 본다.
 *    조회 훅만 목으로 고정(envelope 주입)하고, 나머지(모델·카드·화면)는 실물이 돌아 두 반쪽을 함께 관통한다.
 *  - 이 파일은 비존재 모듈을 직접 import 하지 않아 **suite 는 로드되고**, red 는 `my-style-card` testID 부재
 *    (깨끗한 assertion red) — MyPage 배선 + MyPageScreen additive slot 둘 다 되어야 green.
 *
 * (개념) `getByTestId(id).findAll(pred)` = react-test-renderer DFS pre-order → 이 선형 레이아웃의 문서 순서
 *   (02a §5-D). 그 순서 배열에서 profile < style < segment 로 "사이" 배치를 잰다.
 */

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/account/account', () => ({
  ...jest.requireActual('@/shared/api/generated/account/account'),
  useGetMe: jest.fn(),
}));
jest.mock('@/shared/api/generated/profile/profile', () => ({
  ...jest.requireActual('@/shared/api/generated/profile/profile'),
  useGetMeProfile: jest.fn(),
}));
jest.mock('@/shared/api/generated/trips/trips', () => ({
  ...jest.requireActual('@/shared/api/generated/trips/trips'),
  useGetTrips: jest.fn(),
}));
jest.mock('@/shared/api/generated/reflection/reflection', () => ({
  ...jest.requireActual('@/shared/api/generated/reflection/reflection'),
  useGetMeStyle: jest.fn(),
}));

const mockUseMe = useGetMe as jest.MockedFunction<typeof useGetMe>;
const mockUseProfile = useGetMeProfile as jest.MockedFunction<
  typeof useGetMeProfile
>;
const mockUseTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
const mockUseStyle = useGetMeStyle as jest.MockedFunction<typeof useGetMeStyle>;

/** 정식 분석 envelope — 배선이 실제로 이 값을 카드까지 흘려보내는지 본다. */
function officialEnvelope(): StyleAnalysisEnvelope {
  return {
    official: true,
    progress: { current: 14, required: 10 },
    analysis: {
      descriptors: ['#바다', '#미식'],
      traitGauges: { easygoing: 4, foodAffinity: 4, activeness: 3 },
      categoryBreakdown: [],
      avgPlacesPerDay: 3.2,
      avgRadiusKm: 5.1,
      sampleTripCount: 6,
      updatedAt: '2026-08-28T09:00:00Z',
    },
    preview: null,
  };
}

function asQuery<T>(data: T) {
  return { data, isPending: false, isError: false } as unknown as ReturnType<
    typeof useGetMe
  >;
}

function renderPage() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MyPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseMe.mockReturnValue(asQuery({ email: 'a@b.c' }));
  mockUseProfile.mockReturnValue(asQuery({ nickname: '테스터' }));
  mockUseTrips.mockReturnValue(asQuery([])); // 여행 0건 → 카드 목록 비어 배치 확인에 집중
  mockUseStyle.mockReturnValue(asQuery(officialEnvelope()));
});

describe('🔴 AC-I1 · 조회→모델→배치', () => {
  it('useGetMeStyle envelope 가 buildStyleCardModel 을 거쳐 StyleSummaryCard 로 렌더된다', () => {
    renderPage();

    // 배선 — envelope 값이 카드까지 관통해 실제로 그려진다.
    expect(screen.getByTestId('my-style-card')).toBeOnTheScreen();
    expect(screen.getAllByTestId('my-style-chip')).toHaveLength(2);
    expect(screen.getAllByTestId('my-style-gauge')).toHaveLength(3);
  });

  it('카드는 ProfileCard 와 TripStatusSegment 사이에 놓이고 기존 testID 는 그대로다', () => {
    renderPage();

    // 기존 testID 무변경(additive prop 이 헐지 않았다).
    expect(screen.getByTestId('my-page-root')).toBeOnTheScreen();
    expect(screen.getByTestId('my-header-settings')).toBeOnTheScreen();
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-segment')).toBeOnTheScreen();

    // 배치 — DFS 문서 순서에서 profile < style < segment.
    const root = screen.getByTestId('my-page-root');
    const order = root
      .findAll((node) => typeof node.props.testID === 'string')
      .map((node) => node.props.testID as string);

    const idxProfile = order.indexOf('my-profile-card');
    const idxStyle = order.indexOf('my-style-card');
    const idxSegment = order.indexOf('my-trip-segment');

    expect(idxProfile).toBeGreaterThanOrEqual(0);
    expect(idxStyle).toBeGreaterThan(idxProfile);
    expect(idxSegment).toBeGreaterThan(idxStyle);
  });
});

describe('🔴 TRIP-618 AC-1 · 하단 설정 행 진입 배선', () => {
  it('하단 "설정" 행 press → router.push("/settings") 정확히 1회', () => {
    renderPage();

    // 실행: 설정 메뉴 하단 '설정' 행을 누른다(trips=[]라 카드는 없고 설정 메뉴는 상시 렌더).
    fireEvent.press(screen.getByTestId('my-settings-row'));

    // 단언: l05 설정 라우트로, 정확히 한 번.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('헤더 아이콘(my-header-settings)은 이번에 배선하지 않는다 — 존재만 유지', () => {
    renderPage();

    // 무배선(Q1 ⓒ, 후속 티켓): 헤더 sun 아이콘은 존재하되 목적지가 없다.
    // press→push 를 단언하지 않는다(무리 배선 금지). 존재 단언만 남겨 회귀를 막는다.
    expect(screen.getByTestId('my-header-settings')).toBeOnTheScreen();
  });
});
