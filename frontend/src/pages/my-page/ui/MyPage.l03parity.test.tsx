import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

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

import { MyPage } from './MyPage';

/**
 * TRIP-775 · l03 마이페이지 배선 ↔ Figma 1602:2388 — 실 MyPage 를 그려 조회→화면 결과를 본다.
 *
 * 무엇을 보장하나:
 *  - AC-1 프로필 태그는 **정식 분석** descriptors 만 쓴다(Seed Q4=A). 미달이면 온보딩 취향 미리보기
 *    (`preview.descriptors`)가 있어도 태그를 그리지 않는다(BR-U5-40 — 미리보기를 정식처럼 보이지 않는다).
 *  - AC-4 페이지는 스타일 헤드라인을 주입하지 않는다(서버 필드 없음, 계약 공백).
 *  - AC-6 "지난 여행" 섹션은 예정 여행이 0건일 때만 보인다(§F-3 A안). 활성 탭이 '종료'면 접는다(기존).
 *  - AC-7 메뉴는 정확히 3행(등록 숙소·예약 기록 / 여행 스타일 분석 / 설정)이고, 첫 행 아이콘은
 *    북마크가 아니다(침대). 행 배선은 `MyPage.integration.test.tsx` B-1 이 진다.
 *
 * 왜 이렇게 테스트하나: 조회 훅(계정·프로필·스타일·여행 목록·카드별 숙소/일정)만 목으로 응답을 넣고
 * 나머지(모델·화면·카드)는 실물이 돈다. `jest.mock` 팩토리는 파일 맨 위로 끌어올려져 먼저 실행되므로
 * 바깥 변수를 참조하지 않고 `jest.fn()` 만 만든 뒤, import 한 훅을 캐스팅해서 값을 넣는다.
 * 훅을 통째로 갈아 react-query 가 돌지 않으므로 `QueryClientProvider` 는 필요 없다.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
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
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
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

describe('AC-1 · 프로필 태그 출처(Seed Q4=A)', () => {
  it('정식 분석이면 analysis.descriptors 가 프로필 카드 안 태그로 순서대로 뜬다', () => {
    // 준비
    setStyle(officialEnvelope());

    // 실행
    render(<MyPage />);

    // 단언: 스타일 카드 칩에도 같은 글자가 있으므로 프로필 카드 안에서만 찾는다.
    const profile = screen.getByTestId('my-profile-card');
    const tags = within(profile).getAllByTestId('my-profile-tag');
    expect(tags).toHaveLength(2);
    expect(tags[0]).toHaveTextContent('#바다');
    expect(tags[1]).toHaveTextContent('#미식');
  });

  it('미달이면 preview.descriptors 가 있어도 프로필 태그를 그리지 않는다(화면 어디에도 #바다 없음)', () => {
    setStyle(insufficientEnvelope());

    render(<MyPage />);

    expect(screen.queryAllByTestId('my-profile-tag')).toHaveLength(0);
    expect(screen.queryByText('#바다')).toBeNull();
    // 짝 앵커: 프로필 카드와 (미달 얼굴의) 스타일 카드는 그려졌다.
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
    expect(screen.getByTestId('my-style-card')).toBeOnTheScreen();
  });

  it('미달(official:false)이면 analysis.descriptors 가 차 있어도 프로필 태그를 그리지 않는다', () => {
    // 준비: 계약상 official·analysis 는 서로 독립 nullable 이라 이 조합이 올 수 있다(BR-U5-40).
    setStyle({
      ...insufficientEnvelope(),
      analysis: officialEnvelope().analysis,
    });

    // 실행
    render(<MyPage />);

    // 단언: 태그 0. 짝 앵커 = 프로필 카드는 그려졌다(카드째 사라져 공짜 통과하는 것을 막는다).
    expect(screen.queryAllByTestId('my-profile-tag')).toHaveLength(0);
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
  });

  it('스타일 응답이 없으면 태그 줄이 없다', () => {
    setStyle(undefined);

    render(<MyPage />);

    expect(screen.queryAllByTestId('my-profile-tag')).toHaveLength(0);
    expect(screen.getByTestId('my-profile-card')).toBeOnTheScreen();
  });
});

describe('AC-4 · 헤드라인은 주입하지 않는다(계약 공백)', () => {
  it('정식 스타일 카드를 그려도 헤드라인 문장 자리가 없다', () => {
    setStyle(officialEnvelope());

    render(<MyPage />);

    expect(screen.getByTestId('my-style-card')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-style-headline')).toBeNull();
  });
});

describe('AC-6 · 지난 여행은 예정 0건일 때만(§F-3 A안)', () => {
  it('예정 여행이 1건 이상이면 "지난 여행" 섹션이 없다(종료 여행이 있어도)', () => {
    // 준비: 예정 1 + 종료 1.
    setTrips([
      trip({ tripId: 'up-1', status: 'PLANNED' }),
      trip({ tripId: 'e1', status: 'ENDED' }),
    ]);

    // 실행: 기본 탭(예정).
    render(<MyPage />);

    // 단언: 섹션도, 그 안의 종료 카드도 없다. 짝 앵커 = 예정 카드.
    // TRIP-776: 지난 여행 카드는 썸네일형(루트 = my-trip-reflection-{id})이라 칩 카드 testID 대신 그것을 본다.
    expect(screen.queryByText('지난 여행')).toBeNull();
    expect(screen.queryByTestId('my-trip-reflection-e1')).toBeNull();
    expect(screen.getByTestId('my-trip-card-up-1')).toBeOnTheScreen();
  });

  it('예정이 0건이면 "지난 여행" 섹션에 종료 카드(회고 진입 포함)가 뜬다', () => {
    setTrips([trip({ tripId: 'e1', status: 'ENDED' })]);

    render(<MyPage />);

    // TRIP-776: 섹션 카드는 썸네일형 — 카드 전체가 회고 진입이고 썸네일 자리를 가진다.
    expect(screen.getByText('지난 여행')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-reflection-e1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-reflection-e1-thumb')).toBeOnTheScreen();
    expect(screen.queryByText('아직 종료된 여행이 없습니다')).toBeNull();
  });

  it('활성 탭이 "종료"면 섹션을 접고 종료 카드는 목록에 한 번만 뜬다(기존 규칙 유지)', () => {
    setTrips([trip({ tripId: 'e1', status: 'ENDED' })]);
    render(<MyPage />);

    fireEvent.press(screen.getByTestId('my-trip-segment-ended'));

    expect(screen.queryByText('지난 여행')).toBeNull();
    expect(screen.getAllByTestId('my-trip-card-e1')).toHaveLength(1);
  });
});

describe('AC-7 · 메뉴 3행(Seed Q1=A)', () => {
  it('메뉴 카드의 글자는 정확히 [등록 숙소·예약 기록, 여행 스타일 분석, 설정] 이다', () => {
    render(<MyPage />);

    const menu = screen.getByTestId('my-menu-card');
    // 호스트 Text 만 센다(합성 Text 는 type 이 객체라 'Text' 문자열과 같지 않다).
    const labels = menu
      .findAll((node) => (node.type as string) === 'Text')
      .map((node) => String(node.props.children));

    expect(labels).toEqual(['등록 숙소·예약 기록', '여행 스타일 분석', '설정']);
  });

  it('첫 행 아이콘은 북마크가 아니다(Figma 침대)', () => {
    render(<MyPage />);

    expect(screen.UNSAFE_queryAllByType(BookmarkGlyph)).toHaveLength(0);
    // 짝 앵커: 첫 행은 그려졌다.
    expect(screen.getByTestId('my-stays-row')).toBeOnTheScreen();
  });
});
