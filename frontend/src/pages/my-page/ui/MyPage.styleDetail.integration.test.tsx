import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { StyleAnalysisEnvelope } from '@/shared/api/generated/schemas';
import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';
import { useGetMeStyle } from '@/shared/api/generated/reflection/reflection';
import { useGetTrips } from '@/shared/api/generated/trips/trips';

import { MyPage } from './MyPage';

/**
 * TRIP-573 · AC-7(Q4) — 요약카드 상세진입 활성화 배선.
 *
 * 무엇을 보장하나:
 *  - 🔴 j05 라우트(`records/style`)가 생겼으니 TRIP-606 이 `disabled` 로 둔 `my-style-detail`
 *    Pressable 을 활성화해 press → `router.push('/records/style')`(완전일치, 오타·교차 배선 검출).
 *
 * 왜 real MyPage 렌더인가:
 *  - 배선(StyleSummaryCard onPressDetail prop 활성화 + MyPage 가 라우트 문자열 주입)을 한 번에 관통.
 *    조회 훅만 목(official envelope 주입)하고 나머지는 실물이 돈다(`MyPage.integration.test.tsx` 선례).
 *  - **backward-compat**: prop 미주입이던 기존 `StyleSummaryCard.test.tsx` AC-S6(`toBeDisabled()`)·
 *    기존 `MyPage.integration.test.tsx`(배선·배치)는 무회귀여야 한다(implementer 는 prop-gated 로 활성화).
 *
 * (별 파일 신설 — 기존 `MyPage.integration.test.tsx` 는 수정하지 않는다. `DailyReflectionScreen.share.test.tsx`
 *  선례 동형: 동결 테스트를 안 건드리고 새 배선만 별 파일에 잠근다.)
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

/** 정식 envelope — 카드가 official 얼굴로 그려져 my-style-detail 이 렌더된다. */
function officialEnvelope(): StyleAnalysisEnvelope {
  return {
    official: true,
    progress: { current: 14, required: 10 },
    analysis: {
      descriptors: ['#바다', '#미식'],
      traitGauges: { easygoing: 4, foodAffinity: 4, activeness: 3 },
      categoryBreakdown: [],
      avgPlacesPerDay: 4,
      avgRadiusKm: 1.2,
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
  mockUseTrips.mockReturnValue(asQuery([]));
  mockUseStyle.mockReturnValue(asQuery(officialEnvelope()));
});

describe('🔴 TRIP-573 AC-7 · 요약카드 상세진입 활성화', () => {
  it('my-style-detail press → router.push("/records/style") 정확히 1회', () => {
    renderPage();

    fireEvent.press(screen.getByTestId('my-style-detail'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/records/style');
  });
});
