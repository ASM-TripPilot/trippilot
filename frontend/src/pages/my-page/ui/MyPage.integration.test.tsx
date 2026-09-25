import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { StyleAnalysisEnvelope } from '@/shared/api/generated/schemas';
import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';
import { useGetMeStyle } from '@/shared/api/generated/reflection/reflection';
import {
  useGetMeRecords,
  useGetTrips,
} from '@/shared/api/generated/trips/trips';

import { HeartGlyph } from '@/features/settings/ui/SettingsGlyphs';

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
  // TRIP-776 — 지난 여행 "사진 N" 목록 조회도 목으로 막는다(실 훅이면 MSW 없는 네트워크 요청이 샌다).
  useGetMeRecords: jest.fn(),
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
const mockUseRecords = useGetMeRecords as jest.MockedFunction<
  typeof useGetMeRecords
>;
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
  mockUseRecords.mockReturnValue(
    asQuery(undefined) as unknown as ReturnType<typeof useGetMeRecords>
  );
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

    // 기존 testID 무변경(additive prop 이 헐지 않았다). 헤더 설정 아이콘은 TRIP-775 로 복원(→ /settings).
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

  it('TRIP-775(구 TRIP-939 B-2): 헤더 설정 아이콘을 누르면 router.push("/settings") 정확히 1회', () => {
    // 준비·실행: 헤더 톱니(Figma 1602:2388 우측 24)를 누른다. 목적지가 생겨 되살렸다(Seed Q2=a).
    renderPage();
    fireEvent.press(screen.getByTestId('my-header-settings'));

    // 단언: 반응 없는 버튼이 아니다 — 설정으로, 한 번만.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
});

describe('🔴 TRIP-939 B-1·B-3·B-4 · 마이 탭에 눌러도 반응 없는 것이 없다 (심사 2.1)', () => {
  it('B-1(TRIP-775 Q1=A): 목적지가 선 메뉴 3행은 누르면 각자 이동하고, 커뮤니티 3행은 없다', () => {
    // 준비·실행: 실 마이페이지를 그린다(여행 0건).
    renderPage();

    // 단언(부재): U7 전이라 목적지가 없는 커뮤니티 3행.
    ['내 일정 공개/공유 설정', '내가 공유한 일정', '숨긴 사용자 관리'].forEach(
      (label) => {
        expect(screen.queryByText(label)).toBeNull();
      }
    );

    // 단언(존재 + 배선): 보이는 행은 전부 눌러서 이동한다 — 행마다 정확히 1회, 경로 완전일치.
    (
      [
        ['my-stays-row', '등록 숙소·예약 기록', '/my/stays'],
        ['my-style-analysis-row', '여행 스타일 분석', '/records/style'],
        ['my-settings-row', '설정', '/settings'],
      ] as const
    ).forEach(([testID, label, href]) => {
      mockPush.mockClear();
      const row = screen.getByTestId(testID);
      expect(row).toHaveTextContent(label);

      fireEvent.press(row);

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(href);
    });
  });

  it('B-3(TRIP-775 Q2=a): 프로필 [편집]이 있고 누르면 router.push("/settings") 정확히 1회', () => {
    renderPage();

    fireEvent.press(screen.getByTestId('my-profile-edit'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('B-4(TRIP-776 Q1=A): 지난 여행의 "캘린더 ›"를 누르면 router.push("/records") 정확히 1회 — 회고 하트 floating 은 여전히 없다', () => {
    // 준비·실행: 여행 0건 → 예정 0이라 '지난 여행' 섹션이 보인다(종료 0건이어도 캘린더 링크는 남는다).
    renderPage();

    // 짝 앵커: 지난 여행 섹션이 실제로 그려졌다.
    expect(screen.getByText('지난 여행')).toBeOnTheScreen();

    // 단언(존재 + 배선): 목적지(/records, j07 캘린더)가 선 링크 — 반응 없는 링크가 아니다(TRIP-939 원칙 유지).
    const calendar = screen.getByTestId('my-past-calendar');
    expect(calendar).toHaveTextContent(/캘린더/);
    fireEvent.press(calendar);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/records');

    // 단언(부재): 장식 하트 버튼은 여전히 없다.
    expect(screen.UNSAFE_queryAllByType(HeartGlyph)).toHaveLength(0);
  });
});
