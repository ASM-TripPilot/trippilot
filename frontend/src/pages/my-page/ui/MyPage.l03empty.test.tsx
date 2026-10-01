import { fireEvent, screen, within } from '@testing-library/react-native';
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
  getGetTripsTripIdItineraryQueryOptions,
  useGetMeRecords,
  useGetTrips,
  useGetTripsTripIdBases,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { ChevronRightGlyph as TripChevronGlyph } from '@/entities/trip/ui/TripGlyphs';
import { ChevronRightGlyph as SettingsChevronGlyph } from '@/features/settings/ui/SettingsGlyphs';

import {
  CONFIRMED,
  renderWithQueryClient,
  scriptItineraryOptions,
  settle,
} from '@/test-support/myPageItineraries';

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
 *  - AC-5 지난 여행 카드는 카드마다 숙소·일정 **카드 훅**을 부르지 않는다(썸네일 카드엔 두 값이 없다).
 *    TRIP-1123 부터 페이지가 집계용으로 여행별 일정을 한 번씩 조회하지만(`useQueries`), 그건 카드 훅이 아니다.
 *  - (옛 Q3=A '종료' 탭 목록과 1012-B1 [새 여행 만들기]는 TRIP-1123 에서 세그·CTA 가 사라져 지웠다 —
 *    부재는 `MyPage.counts.test.tsx` AC-1·AC-2 가 잰다.)
 *
 * 왜 이렇게 테스트하나: 조회 훅만 목으로 응답을 넣고 모델·화면·카드는 실물이 돈다(775 l03parity 와 같은
 * 장치). `jest.mock` 팩토리는 파일 맨 위로 끌어올려져 먼저 실행되므로 바깥 변수를 못 쓴다 — 이름이
 * `mock` 으로 시작하는 `mockPush` 만 예외로 허용된다.
 * TRIP-1123: 지난 여행 = **일정 확정** && 종료라, 픽스처 여행마다 확정 일정을 대본으로 준다(`myPageItineraries`).
 * 페이지 `useQueries` 가 목 옵션 함수의 queryFn 을 실제로 돌므로 실 QueryClient 아래에서 그리고 `settle()` 로 기다린다.
 *
 * ⚠️ `useGetMeRecords` 목은 **가공 전 응답**(`TripRecordList`)을 그대로 돌려준다. 훅 옵션 `select` 로
 *    모양을 바꾸는 구현은 목에서 `select` 가 안 돌아 깨진다 — 페이지가 `data.items` 를 직접 읽어야 한다.
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
    baseCount: 0,
    itineraryDayCount: 0,
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

/** 여행 목록 + 여행마다 **확정** 일정(지난 여행 기준 = 확정 && 종료, TRIP-1123). */
function setTrips(data: Trip[]): void {
  mockUseTrips.mockReturnValue(asQuery(data) as ReturnType<typeof useGetTrips>);
  scriptItineraryOptions(
    mockQueryOptions,
    Object.fromEntries(data.map((trip) => [trip.tripId, CONFIRMED]))
  );
}

/** 그리고 여행별 일정 조회가 끝날 때까지 기다린다. */
async function renderPage(): Promise<void> {
  renderWithQueryClient(<MyPage />);
  await settle();
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
  it('제목 · 날짜 2026.5.1–5.3 · 썸네일 자리 · chevron 이 있고, 옛 칩 카드는 없다', async () => {
    // 준비: 예정 0 · 종료 1 → "지난 여행" 섹션이 보이는 조건(775 §F-3 A안).
    setTrips([JEJU]);

    // 실행
    await renderPage();

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

  it('실제 페이지 조립이 compact 변형을 고른다 — 썸네일 64, j07 의 72 아님', async () => {
    // 준비: 예정 0 · 종료 1. 프리뷰는 카드를 따로 조립하므로 MyPage 경로는 여기서만 본다.
    setTrips([JEJU]);

    // 실행
    await renderPage();

    // 단언: className 을 공백으로 쪼갠 배열에 대한 toContain 은 원소 완전 일치다.
    const thumb = String(
      screen.getByTestId('my-trip-reflection-e-jeju-thumb').props.className
    ).split(/\s+/);
    expect(thumb).toContain('h-[64px]');
    expect(thumb).toContain('w-[64px]');
    expect(thumb).not.toContain('h-[72px]');
  });

  it('INV-3 — 카드 글자에 소요시간(분·시간·소요) 표기가 0건이다', async () => {
    setTrips([JEJU]);
    setRecords(recordsOf([summary(JEJU, 24)]));

    await renderPage();

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
  it('카드마다 제 여행의 사진 수가 뜬다(응답 순서가 카드 순서와 달라도)', async () => {
    // 준비: 응답 items 순서를 카드 순서(종료일 최근순: 제주·강릉·부산)와 일부러 어긋나게 둔다.
    setTrips([BUSAN, JEJU, GANGNEUNG]);
    setRecords(
      recordsOf([summary(BUSAN, 30), summary(JEJU, 24), summary(GANGNEUNG, 16)])
    );

    await renderPage();

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
    async (_label, result) => {
      setTrips([JEJU]);
      setRecords(result);

      await renderPage();

      const card = screen.getByTestId('my-trip-reflection-e-jeju');
      expect(within(card).queryAllByText(/사진/)).toHaveLength(0);
      // 짝 앵커 — 카드와 날짜는 그대로다.
      expect(within(card).getByText('2026.5.1–5.3')).toBeOnTheScreen();
    }
  );
});

describe('🔴 AC-4 · 회고 진입 계약 유지(새 카드 경로로 재조준)', () => {
  it('카드 전체가 회고 진입 버튼이고, 누르면 /trips/{id}/records 로 정확히 1회', async () => {
    setTrips([JEJU]);
    await renderPage();

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

describe('🔴 AC-5 · 지난 여행 카드는 숙소·일정 카드 훅을 부르지 않는다', () => {
  it('종료 3건을 그려도 카드별 숙소·일정 훅이 한 번도 불리지 않는다', async () => {
    // 준비: 예정 0 · 종료 3(모두 확정) — 카드는 지난 여행 섹션에만 있다.
    setTrips([JEJU, GANGNEUNG, BUSAN]);

    await renderPage();

    // 짝 앵커 — 카드 3장이 실제로 그려졌다(안 그려져서 조회가 0인 것을 막는다).
    expect(pastCardRoots()).toHaveLength(3);
    expect(mockUseBases).not.toHaveBeenCalled();
    expect(mockUseItinerary).not.toHaveBeenCalled();
  });
});
