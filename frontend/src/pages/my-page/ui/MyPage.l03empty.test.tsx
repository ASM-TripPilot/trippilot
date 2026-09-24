import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type {
  Trip,
  TripRecordList,
  TripRecordSummary,
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
import { ChevronRightGlyph as TripChevronGlyph } from '@/entities/trip/ui/TripGlyphs';
import { ChevronRightGlyph as SettingsChevronGlyph } from '@/features/settings/ui/SettingsGlyphs';

import { MyPage } from './MyPage';

/**
 * TRIP-776 · l03 마이페이지 empty(Figma 1603:2414) — 실 MyPage 를 그려 "지난 여행" 섹션의 썸네일 카드를 본다.
 *
 * 무엇을 보장하나:
 *  - AC-3 예정 0건일 때 "지난 여행" 섹션의 종료 여행은 **썸네일형 카드**다: 제목(`trip.title`) · 날짜
 *    `2026.5.1–5.3`(연도·en dash) · 썸네일 자리 · chevron. 옛 칩 카드(`my-trip-card-*`, 숙소·일정 칩,
 *    `5.1~5.3`)는 이 섹션에 없다. 소요시간 글자 0(INV-3).
 *  - AC-3b "사진 N" 은 `GET /me/records` 의 `photoCount` 를 **tripId 로** 붙인 실데이터다. 응답 전·실패·
 *    그 여행이 목록에 없음·0장이면 사진 글자 없이 날짜만 보인다(가짜 숫자 0, INV-4).
 *  - AC-4 카드 전체가 회고 진입 버튼(`my-trip-reflection-{id}`)이고 누르면 `/trips/{id}/records` 로 1회.
 *  - AC-5 지난 여행 카드는 카드마다 숙소·일정을 조회하지 않는다(N+1 없음 — 썸네일 카드엔 두 값이 없다).
 *  - Q3=A '종료' 탭 목록은 기존 칩 카드를 유지한다(썸네일형은 "지난 여행" 섹션만).
 *
 * 왜 이렇게 테스트하나: 조회 훅만 목으로 응답을 넣고 모델·화면·카드는 실물이 돈다(775 l03parity 와 같은
 * 장치). `jest.mock` 팩토리는 파일 맨 위로 끌어올려져 먼저 실행되므로 바깥 변수를 못 쓴다 — 이름이
 * `mock` 으로 시작하는 `mockPush` 만 예외로 허용된다. 훅을 통째로 갈아 react-query 가 돌지 않으므로
 * `QueryClientProvider` 는 필요 없다.
 *
 * ⚠️ `useGetMeRecords` 목은 **가공 전 응답**(`TripRecordList`)을 그대로 돌려준다. 훅 옵션 `select` 로
 *    모양을 바꾸는 구현은 목에서 `select` 가 안 돌아 깨진다 — 페이지가 `data.items` 를 직접 읽어야 한다.
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
jest.mock('@/shared/api/generated/reflection/reflection', () => ({
  useGetMeStyle: jest.fn(),
}));
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  useGetTripsTripIdBases: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
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

type RecordsResult = ReturnType<typeof useGetMeRecords>;

function asQuery<T>(data: T) {
  return { data, isPending: false, isError: false } as unknown;
}

/** 소요시간 탐지기(TripCardContainer.test 와 같은 식) — 일수·거리는 안 걸리고 "분·시간·소요"만 걸린다. */
const DURATION = /소요|\d+\s*분|\d+\s*시간/;

function ended(tripId: string, over: Partial<Trip> = {}): Trip {
  return {
    tripId,
    title: '제주 여행',
    startDate: '2026-05-01',
    endDate: '2026-05-03',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 2 }],
    status: 'ENDED',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
    ...over,
  };
}

const JEJU = ended('e-jeju');
const GANGNEUNG = ended('e-gn', {
  title: '강릉 여행',
  startDate: '2026-04-18',
  endDate: '2026-04-20',
});
const BUSAN = ended('e-bs', {
  title: '부산 여행',
  startDate: '2025-10-03',
  endDate: '2025-10-05',
});

function summary(trip: Trip, photoCount: number): TripRecordSummary {
  return {
    tripId: trip.tripId,
    title: trip.title,
    startDate: trip.startDate,
    endDate: trip.endDate,
    regions: trip.destinations.map((d) => d.region),
    visitCount: 5,
    photoCount,
  };
}

function setTrips(data: Trip[]): void {
  mockUseTrips.mockReturnValue(asQuery(data) as ReturnType<typeof useGetTrips>);
}

function setRecords(result: {
  data: TripRecordList | undefined;
  isPending: boolean;
  isError: boolean;
}): void {
  mockUseRecords.mockReturnValue(result as unknown as RecordsResult);
}

function recordsOf(items: TripRecordSummary[]) {
  return { data: { items }, isPending: false, isError: false };
}

/** 지난 여행 카드 루트 — `my-trip-reflection-{id}` 이되 썸네일·사진 하위 testID 는 뺀다. */
function pastCardRoots(): ReactTestInstance[] {
  return screen
    .queryAllByTestId(/^my-trip-reflection-/)
    .filter((node) => !/-(thumb|photo)$/.test(String(node.props.testID)));
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseBases.mockClear();
  mockUseItinerary.mockClear();
  mockUseMe.mockReturnValue(
    asQuery({ email: 'a@b.c' }) as ReturnType<typeof useGetMe>
  );
  mockUseProfile.mockReturnValue(
    asQuery({ nickname: '테스터' }) as ReturnType<typeof useGetMeProfile>
  );
  mockUseStyle.mockReturnValue(
    asQuery(undefined) as ReturnType<typeof useGetMeStyle>
  );
  setTrips([]);
  mockUseBases.mockReturnValue(
    asQuery([]) as ReturnType<typeof useGetTripsTripIdBases>
  );
  mockUseItinerary.mockReturnValue(
    asQuery({ days: [{ date: '2026-05-01', slots: [] }] }) as ReturnType<
      typeof useGetTripsTripIdItinerary
    >
  );
  // 기본 = 응답 전(사진 수 모름).
  setRecords({ data: undefined, isPending: true, isError: false });
});

describe('🔴 AC-3 · 지난 여행은 썸네일형 카드', () => {
  it('제목 · 날짜 2026.5.1–5.3 · 썸네일 자리 · chevron 이 있고, 옛 칩 카드는 없다', () => {
    // 준비: 예정 0 · 종료 1 → "지난 여행" 섹션이 보이는 조건(775 §F-3 A안).
    setTrips([JEJU]);

    // 실행
    render(<MyPage />);

    // 단언(긍정)
    expect(screen.getByText('지난 여행')).toBeOnTheScreen();
    const card = screen.getByTestId('my-trip-reflection-e-jeju');
    expect(within(card).getByText('제주 여행')).toBeOnTheScreen();
    expect(within(card).getByText('2026.5.1–5.3')).toBeOnTheScreen();
    expect(
      within(card).getByTestId('my-trip-reflection-e-jeju-thumb')
    ).toBeOnTheScreen();
    // chevron — 어느 층의 ChevronRightGlyph 든 하나 이상(글리프 선택은 구현 자유).
    const chevrons =
      card.findAllByType(TripChevronGlyph).length +
      card.findAllByType(SettingsChevronGlyph).length;
    expect(chevrons).toBeGreaterThanOrEqual(1);

    // 단언(부정): 옛 칩 카드 · 숙소/일정 칩 · M.D~M.D 표기가 이 섹션에 없다.
    expect(screen.queryByTestId('my-trip-card-e-jeju')).toBeNull();
    expect(within(card).queryAllByText(/숙소|일정/)).toHaveLength(0);
    expect(within(card).queryAllByText(/~/)).toHaveLength(0);
  });

  it('실제 페이지 조립이 compact 변형을 고른다 — 썸네일 64, j07 의 72 아님', () => {
    // 준비: 예정 0 · 종료 1. 프리뷰는 카드를 따로 조립하므로 MyPage 경로는 여기서만 본다.
    setTrips([JEJU]);

    // 실행
    render(<MyPage />);

    // 단언: className 을 공백으로 쪼갠 배열에 대한 toContain 은 원소 완전 일치다.
    const thumb = String(
      screen.getByTestId('my-trip-reflection-e-jeju-thumb').props.className
    ).split(/\s+/);
    expect(thumb).toContain('h-[64px]');
    expect(thumb).toContain('w-[64px]');
    expect(thumb).not.toContain('h-[72px]');
  });

  it('INV-3 — 카드 글자에 소요시간(분·시간·소요) 표기가 0건이다', () => {
    setTrips([JEJU]);
    setRecords(recordsOf([summary(JEJU, 24)]));

    render(<MyPage />);

    // 탐지기 자가검사(짝) — 실제 소요시간은 잡히고, 날짜·사진 수는 안 잡힌다.
    expect('도보 15분').toMatch(DURATION);
    expect('2026.5.1–5.3').not.toMatch(DURATION);
    expect('사진 24').not.toMatch(DURATION);

    const card = screen.getByTestId('my-trip-reflection-e-jeju');
    expect(within(card).queryAllByText(DURATION)).toHaveLength(0);
    // 짝 앵커 — 카드 글자는 실제로 있다.
    expect(within(card).getByText('제주 여행')).toBeOnTheScreen();
  });
});

describe('🔴 AC-3b · "사진 N" = /me/records photoCount 를 tripId 로 붙인다', () => {
  it('카드마다 제 여행의 사진 수가 뜬다(응답 순서가 카드 순서와 달라도)', () => {
    // 준비: 응답 items 순서를 카드 순서(종료일 최근순: 제주·강릉·부산)와 일부러 어긋나게 둔다.
    setTrips([BUSAN, JEJU, GANGNEUNG]);
    setRecords(
      recordsOf([summary(BUSAN, 30), summary(JEJU, 24), summary(GANGNEUNG, 16)])
    );

    render(<MyPage />);

    (
      [
        ['e-jeju', '사진 24'],
        ['e-gn', '사진 16'],
        ['e-bs', '사진 30'],
      ] as const
    ).forEach(([tripId, label]) => {
      const card = screen.getByTestId(`my-trip-reflection-${tripId}`);
      expect(within(card).getByText(label)).toBeOnTheScreen();
      // 카드마다 사진 글자는 딱 하나(남의 수가 섞이지 않는다).
      expect(within(card).queryAllByText(/사진/)).toHaveLength(1);
    });
  });

  it.each([
    ['응답 전', { data: undefined, isPending: true, isError: false }],
    ['조회 실패', { data: undefined, isPending: false, isError: true }],
    ['그 여행이 목록에 없음', recordsOf([summary(BUSAN, 30)])],
    ['사진 0장', recordsOf([summary(JEJU, 0)])],
  ] as const)(
    '%s 이면 사진 글자 없이 날짜만 보인다(가짜 숫자 0)',
    (_label, result) => {
      setTrips([JEJU]);
      setRecords(result);

      render(<MyPage />);

      const card = screen.getByTestId('my-trip-reflection-e-jeju');
      expect(within(card).queryAllByText(/사진/)).toHaveLength(0);
      // 짝 앵커 — 카드와 날짜는 그대로다.
      expect(within(card).getByText('2026.5.1–5.3')).toBeOnTheScreen();
    }
  );
});

describe('🔴 AC-4 · 회고 진입 계약 유지(새 카드 경로로 재조준)', () => {
  it('카드 전체가 회고 진입 버튼이고, 누르면 /trips/{id}/records 로 정확히 1회', () => {
    setTrips([JEJU]);
    render(<MyPage />);

    const card = screen.getByTestId('my-trip-reflection-e-jeju');
    expect(card.props.accessibilityRole).toBe('button');
    // 썸네일형 카드다(옛 칩 카드의 작은 chevron 버튼이 아니다).
    expect(
      within(card).getByTestId('my-trip-reflection-e-jeju-thumb')
    ).toBeOnTheScreen();

    fireEvent.press(card);

    // String() — 목적지는 문자열 href 여야 한다(객체면 [object Object] 로 red).
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/e-jeju/records');
  });
});

describe('🔴 AC-5 · 지난 여행 카드는 숙소·일정을 조회하지 않는다(N+1 없음)', () => {
  it('종료 3건을 그려도 숙소·일정 조회 훅이 한 번도 불리지 않는다', () => {
    // 준비: 예정 0 · 종료 3 · 기본 탭(예정)이라 위 목록은 비고 카드는 지난 여행 섹션에만 있다.
    setTrips([JEJU, GANGNEUNG, BUSAN]);

    render(<MyPage />);

    // 짝 앵커 — 카드 3장이 실제로 그려졌다(안 그려져서 조회가 0인 것을 막는다).
    expect(pastCardRoots()).toHaveLength(3);
    expect(mockUseBases).not.toHaveBeenCalled();
    expect(mockUseItinerary).not.toHaveBeenCalled();
  });
});

describe('Q3=A · "종료" 탭 목록은 기존 칩 카드를 유지한다', () => {
  it('종료 탭을 누르면 목록 카드는 칩 카드(my-trip-card-*)이고, 썸네일·사진 글자는 없다', () => {
    setTrips([JEJU]);
    setRecords(recordsOf([summary(JEJU, 24)]));
    render(<MyPage />);

    fireEvent.press(screen.getByTestId('my-trip-segment-ended'));

    // 단언: 칩 카드 한 장 + 회고 chevron. 썸네일형 카드·사진 수는 이 목록에 없다.
    expect(screen.getAllByTestId('my-trip-card-e-jeju')).toHaveLength(1);
    expect(screen.getByTestId('my-trip-reflection-e-jeju')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-trip-reflection-e-jeju-thumb')).toBeNull();
    expect(screen.queryAllByText(/사진/)).toHaveLength(0);
    // "지난 여행" 섹션은 접혔다(775 규칙 유지).
    expect(screen.queryByText('지난 여행')).toBeNull();
  });
});
