import { screen, within } from '@testing-library/react-native';

import type {
  StyleAnalysisEnvelope,
  Trip,
} from '@/shared/api/generated/schemas';
import { useGetMe } from '@/shared/api/generated/account/account';
import { useGetMeProfile } from '@/shared/api/generated/profile/profile';
import { useGetMeStyle } from '@/shared/api/generated/reflection/reflection';
import {
  useGetMeRecords,
  useGetTrips,
  useGetTripsTripIdBases,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { BookmarkGlyph } from '@/features/settings/ui/SettingsGlyphs';
import { renderWithQueryClient } from '@/test-support/myPageItineraries';

import { MyPage } from './MyPage';

/**
 * TRIP-775 · l03 마이페이지 배선 ↔ Figma 1602:2388 — 실 MyPage 를 그려 조회→화면 결과를 본다.
 *
 * 무엇을 보장하나:
 *  - AC-1 프로필 태그 출처: 정식이면 `analysis.descriptors`, 미달이면 온보딩 취향 미리보기
 *    (`preview.descriptors`)만 쓴다. **TRIP-1076 결정 1(A)로 TRIP-775 Seed Q4=A 를 뒤집었다** — Figma l03
 *    style-insufficient(4533:2424)가 미달에도 태그를 보인다. '정식 아님'(BR-U5-40)은 스타일 카드가 계속
 *    미달 얼굴(안내 한 줄, 칩·게이지 없음)로 말한다.
 *  - AC-4 페이지는 스타일 헤드라인을 주입하지 않는다(서버 필드 없음, 계약 공백).
 *  - (AC-6 "지난 여행" 노출 규칙은 TRIP-1123 에서 확정 && 종료 기준으로 바뀌어 `MyPage.counts.test.tsx` AC-8 로 옮겼다.)
 *  - AC-7 메뉴는 정확히 3행(등록 숙소·예약 기록 / 여행 스타일 분석 / 설정)이고, 첫 행 아이콘은
 *    북마크가 아니다(침대). 행 배선은 `MyPage.integration.test.tsx` B-1 이 진다.
 *
 * 왜 이렇게 테스트하나: 조회 훅(계정·프로필·스타일·여행 목록·카드별 숙소/일정)만 목으로 응답을 넣고
 * 나머지(모델·화면·카드)는 실물이 돈다. `jest.mock` 팩토리는 파일 맨 위로 끌어올려져 먼저 실행되므로
 * 바깥 변수를 참조하지 않고 `jest.fn()` 만 만든 뒤, import 한 훅을 캐스팅해서 값을 넣는다.
 * TRIP-1123: 페이지가 여행별 일정을 `useQueries` 로 부르므로 `QueryClientProvider` 가 필요하다(여행 0건이어도
 * `useQueries` 는 Provider 없이 던진다). 이 파일은 여행 0건만 쓰므로 일정 옵션 함수는 불리지 않는다.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
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
  // TRIP-776 — 페이지가 지난 여행 "사진 N" 을 위해 부르는 목록 조회(이 파일은 사진 수를 단언하지 않는다).
  useGetMeRecords: jest.fn(),
  // TRIP-1123 — 페이지 useQueries 의 여행별 일정 옵션(여행 0건이라 불리지 않는다).
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

function asQuery<T>(data: T) {
  return { data, isPending: false, isError: false } as unknown;
}

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

/** 미달 — 정식 분석 없음, 온보딩 취향 미리보기만 있다. */
function insufficientEnvelope(): StyleAnalysisEnvelope {
  return {
    official: false,
    progress: { current: 5, required: 10 },
    analysis: null,
    preview: { descriptors: ['#바다', '#미식', '#느긋'] },
  };
}

function setStyle(data: StyleAnalysisEnvelope | undefined): void {
  mockUseStyle.mockReturnValue(
    asQuery(data) as ReturnType<typeof useGetMeStyle>
  );
}

function setTrips(data: Trip[]): void {
  mockUseTrips.mockReturnValue(asQuery(data) as ReturnType<typeof useGetTrips>);
}

beforeEach(() => {
  mockUseMe.mockReturnValue(
    asQuery({ email: 'a@b.c' }) as ReturnType<typeof useGetMe>
  );
  mockUseProfile.mockReturnValue(
    asQuery({ nickname: '테스터' }) as ReturnType<typeof useGetMeProfile>
  );
  setStyle(undefined);
  setTrips([]);
  mockUseBases.mockReturnValue(
    asQuery([]) as ReturnType<typeof useGetTripsTripIdBases>
  );
  mockUseItinerary.mockReturnValue(
    asQuery({ days: [{ date: '2026-06-10', slots: [] }] }) as ReturnType<
      typeof useGetTripsTripIdItinerary
    >
  );
  mockUseRecords.mockReturnValue(
    asQuery(undefined) as ReturnType<typeof useGetMeRecords>
  );
});

describe('AC-1 · 프로필 태그 출처(TRIP-1076 결정 1(A) — 미달이면 preview)', () => {
  it('정식 분석이면 analysis.descriptors 가 프로필 카드 안 태그로 순서대로 뜬다', () => {
    // 준비
    setStyle(officialEnvelope());

    // 실행
    renderWithQueryClient(<MyPage />);

    // 단언: 스타일 카드 칩에도 같은 글자가 있으므로 프로필 카드 안에서만 찾는다.
    const profile = screen.getByTestId('my-profile-card');
    const tags = within(profile).getAllByTestId('my-profile-tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]).toHaveTextContent('#바다');
    expect(tags[1]).toHaveTextContent('#미식');
  });

  it('🔴 미달이면 preview.descriptors 가 프로필 태그로 뜨고, 스타일 카드는 여전히 미달 얼굴이다 (AC-5)', () => {
    // 준비: 미달 — 정식 분석 없음, 온보딩 취향 미리보기 3개.
    setStyle(insufficientEnvelope());

    // 실행
    renderWithQueryClient(<MyPage />);

    // 단언 ①: 프로필 카드 안 태그 3개, 순서 그대로.
    const profile = screen.getByTestId('my-profile-card');
    const tags = within(profile).getAllByTestId('my-profile-tag');
    expect(tags).toHaveLength(3);
    expect(tags[0]).toHaveTextContent('#바다');
    expect(tags[1]).toHaveTextContent('#미식');
    expect(tags[2]).toHaveTextContent('#느긋');

    // 단언 ②(금지 — BR-U5-40): 스타일 카드는 '정식 아님' 얼굴 그대로 — 안내 한 줄, 칩·게이지 없음.
    const card = screen.getByTestId('my-style-card');
    expect(
      within(card).getByText('10곳 이상 쌓이면 분석을 제공합니다(현재 5곳)')
    ).toBeOnTheScreen();
    expect(within(card).queryAllByTestId('my-style-chip')).toHaveLength(0);
    expect(within(card).queryAllByTestId('my-style-gauge')).toHaveLength(0);
  });

  it('🔴 미달(official:false)이면 analysis.descriptors 가 차 있어도 그 값은 안 쓰고 preview 만 쓴다', () => {
    // 준비: 계약상 official·analysis 는 서로 독립 nullable 이라 이 조합이 올 수 있다(BR-U5-40).
    // analysis 쪽 글자를 preview 와 다르게 둬야 "어느 출처에서 왔나"가 갈린다(02a ★10).
    const official = officialEnvelope();
    setStyle({
      ...insufficientEnvelope(),
      analysis: official.analysis
        ? { ...official.analysis, descriptors: ['#도심', '#쇼핑'] }
        : null,
    });

    // 실행
    renderWithQueryClient(<MyPage />);

    // 단언: 태그는 preview 3개(순서 그대로), analysis 글자는 화면 어디에도 없다.
    const tags = within(screen.getByTestId('my-profile-card')).getAllByTestId(
      'my-profile-tag'
    );
    expect(tags).toHaveLength(3);
    expect(tags[0]).toHaveTextContent('#바다');
    expect(tags[1]).toHaveTextContent('#미식');
    expect(tags[2]).toHaveTextContent('#느긋');
    expect(screen.queryByText('#도심')).toBeNull();
    expect(screen.queryByText('#쇼핑')).toBeNull();
  });

  it('미달이고 preview 가 null 이면 태그 줄이 없다', () => {
    setStyle({ ...insufficientEnvelope(), preview: null });

    renderWithQueryClient(<MyPage />);

    // 단언: 태그 0. 짝 앵커 = 프로필 카드는 그려졌다(카드째 사라져 공짜 통과하는 것을 막는다).
    expect(screen.queryAllByTestId('my-profile-tag')).toHaveLength(0);
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
  });

  it('스타일 응답이 없으면 태그 줄이 없다', () => {
    setStyle(undefined);

    renderWithQueryClient(<MyPage />);

    expect(screen.queryAllByTestId('my-profile-tag')).toHaveLength(0);
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
  });
});

describe('AC-4 · 헤드라인은 주입하지 않는다(계약 공백)', () => {
  it('정식 스타일 카드를 그려도 헤드라인 문장 자리가 없다', () => {
    setStyle(officialEnvelope());

    renderWithQueryClient(<MyPage />);

    expect(screen.getByTestId('my-style-card')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-style-headline')).toBeNull();
  });
});

describe('AC-7 · 메뉴 3행(Seed Q1=A)', () => {
  it('메뉴 카드의 글자는 정확히 [등록 숙소·예약 기록, 여행 스타일 분석, 설정] 이다', () => {
    renderWithQueryClient(<MyPage />);

    const menu = screen.getByTestId('my-menu-card');
    // 호스트 Text 만 센다(합성 Text 는 type 이 객체라 'Text' 문자열과 같지 않다).
    const labels = menu
      .findAll((node) => (node.type as string) === 'Text')
      .map((node) => String(node.props.children));

    expect(labels).toEqual(['등록 숙소·예약 기록', '여행 스타일 분석', '설정']);
  });

  it('첫 행 아이콘은 북마크가 아니다(Figma 침대)', () => {
    renderWithQueryClient(<MyPage />);

    expect(screen.UNSAFE_queryAllByType(BookmarkGlyph)).toHaveLength(0);
    // 짝 앵커: 첫 행은 그려졌다.
    expect(screen.getByTestId('my-stays-row')).toBeOnTheScreen();
  });
});
