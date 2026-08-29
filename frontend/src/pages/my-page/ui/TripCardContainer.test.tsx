import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  BaseAssignment,
  Itinerary,
  Trip,
} from '@/shared/api/generated/schemas';
import {
  useGetTripsTripIdBases,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-604 · l03 여행 1건 담당 컨테이너 — 그 여행의 bases·itinerary GET을 물어 대표정보를
 * 조립해 순수 카드에 내린다(h37 `pages/itinerary-list/TripCardContainer` 동형, bases 축 하나 추가).
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-3 등록 숙소 0건→`숙소 미등록` 칩, N건→`숙소 N`.
 *  - 🔴 AC-1 카드가 목적지·기간·숙소 수·일정 수를 그린다.
 *  - 🔴 AC-4 **종료** 여행 카드에만 회고 진입(`my-trip-reflection-{id}`) — press→`/trips/{id}/records`.
 *  - 🔴 AC-6 카드 어디에도 소요시간 문자열(분·시간·소요)이 없다(INV-3).
 *
 * 왜 이렇게 테스트하나(02a ★1·★2): bases·itinerary는 orval 훅 seam이라 훅 목으로 응답을 주입한다.
 * `jest.mock` factory는 최상단 호이스트라 **외부 변수 참조 없이** `jest.fn()`만 만들고, 제어는
 * import한 심볼을 `as jest.MockedFunction`으로 캐스팅해 한다. 훅을 통째로 목으로 갈아 react-query가
 * 안 돌므로 `QueryClientProvider`는 필요 없다(itineraryRoute 선례).
 *
 * (개념) `getByText(문자열)`=leaf 완전일치 · `getByText(/정규식/)`/`queryAllByText(/정규식/)`=부분포함
 *   (node_modules `matches.js` 실검증, 02a §5-A). 칩·문구 leaf는 값 하나만 담는다(리포 관례).
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripIdBases: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
}));

const mockUseBases = useGetTripsTripIdBases as jest.MockedFunction<
  typeof useGetTripsTripIdBases
>;
const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;

/** 등록 숙소 n건 조회 결과(컨테이너는 배열 길이만 센다). */
function basesResult(n: number) {
  const data: BaseAssignment[] = Array.from({ length: n }, (_, i) => ({
    baseAssignmentId: `ba-${i}`,
    savedStayId: `stay-${i}`,
    dateFrom: '2026-06-10',
    dateTo: '2026-06-11',
  }));
  return { data, isPending: false, isError: false } as unknown as ReturnType<
    typeof useGetTripsTripIdBases
  >;
}

/** 일정 days일 조회 결과("일정 N일" = days.length, Q1). */
function itineraryResult(days: number) {
  const data = {
    days: Array.from({ length: days }, (_, i) => ({
      date: `2026-06-1${i}`,
      slots: [],
    })),
  } as unknown as Itinerary;
  return {
    data,
    error: null,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTripsTripIdItinerary>;
}

/** 최소 Trip — 케이스마다 tripId·status·목적지·기간만 덮어쓴다. */
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

/** 소요시간 표기 탐지기(INV-3) — 부분포함 정규식(HomeScreen·DraftScreen 선례 동형). */
const DURATION = /소요|\d+\s*분|\d+\s*시간/;

beforeEach(() => {
  mockPush.mockClear();
  mockUseBases.mockReset();
  mockUseItinerary.mockReset();
  // 기본 응답 — 케이스가 필요하면 덮어쓴다.
  mockUseBases.mockReturnValue(basesResult(0));
  mockUseItinerary.mockReturnValue(itineraryResult(1));
});

describe('🔴 AC-3 · 등록 숙소 칩', () => {
  it('bases 0건이면 "숙소 미등록" 칩을 그리고 수 표기는 없다', () => {
    mockUseBases.mockReturnValue(basesResult(0));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByText('숙소 미등록')).toBeOnTheScreen();
    // 짝 — 0건은 "숙소 N"(수 표기)이 아니다.
    expect(screen.queryByText(/^숙소 \d/)).toBeNull();
  });

  it('bases 3건이면 "숙소 3" 칩을 그린다', () => {
    mockUseBases.mockReturnValue(basesResult(3));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByText('숙소 3')).toBeOnTheScreen();
    // 짝 — 미등록 문구는 없다.
    expect(screen.queryByText('숙소 미등록')).toBeNull();
  });
});

describe('🔴 AC-1 · 카드 대표정보(목적지·기간·숙소 수·일정 수)', () => {
  it('목적지 region · 날짜범위 · 일정 N일 · 숙소 N을 모두 그린다', () => {
    mockUseBases.mockReturnValue(basesResult(1));
    mockUseItinerary.mockReturnValue(itineraryResult(2));

    render(
      <TripCardContainer
        trip={trip({
          title: '여름 휴가',
          destinations: [{ seq: 1, region: '부산', nights: 2 }],
          startDate: '2026-06-10',
          endDate: '2026-06-12',
        })}
      />
    );

    // 목적지 — title('여름 휴가')엔 '부산'이 없어 이 매치는 목적지 leaf만 잡는다(★9).
    expect(screen.getByText(/부산/)).toBeOnTheScreen();
    // 기간 — 점·물결 형식은 잠그되 공백은 관대(★10, 근거 브리프 §재사용색인 "6.10~6.12").
    expect(screen.getByText(/6\.10\s*~\s*6\.12/)).toBeOnTheScreen();
    // 일정 수 — days.length(Q1). INV-3상 시간 아님.
    expect(screen.getByText('일정 2일')).toBeOnTheScreen();
    // 숙소 수.
    expect(screen.getByText('숙소 1')).toBeOnTheScreen();
  });
});

describe('🔴 AC-4 · 회고 진입은 종료 카드에만', () => {
  it('종료 여행 카드는 회고 진입 어포던스를 그리고, press하면 /trips/{id}/records로 간다', () => {
    render(
      <TripCardContainer trip={trip({ tripId: 'ended-1', status: 'ENDED' })} />
    );

    const reflection = screen.getByTestId('my-trip-reflection-ended-1');
    expect(reflection).toBeOnTheScreen();
    expect(reflection.props.accessibilityRole).toBe('button');

    fireEvent.press(reflection);

    // String() — 목적지는 문자열 href여야 한다(객체면 [object Object]로 즉시 red).
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/ended-1/records');
  });

  it('종료가 아닌 여행 카드에는 회고 진입 어포던스가 없다(짝)', () => {
    render(
      <TripCardContainer trip={trip({ tripId: 'up-1', status: 'PLANNED' })} />
    );

    // 짝 — 카드 자체는 뜨는데 회고 진입만 없다.
    expect(screen.getByTestId('my-trip-card-up-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-trip-reflection-up-1')).toBeNull();
  });
});

describe('🔴 AC-6 · INV-3 소요시간 미표시', () => {
  it('이름·목적지·날짜·숙소·일정은 보이는데 분·시간·소요 표기는 0건이다', () => {
    mockUseBases.mockReturnValue(basesResult(1));
    mockUseItinerary.mockReturnValue(itineraryResult(2));

    render(<TripCardContainer trip={trip()} />);

    // 탐지기 자가검사(짝) — 실제 소요시간은 잡히고, 일수/거리 표현은 무시한다.
    expect('도보 15분').toMatch(DURATION);
    expect('일정 2일').not.toMatch(DURATION);

    // 렌더 결과(소스 아님)를 훑는다 — 소요시간 문자열 0건.
    expect(screen.queryAllByText(DURATION)).toHaveLength(0);
  });
});
