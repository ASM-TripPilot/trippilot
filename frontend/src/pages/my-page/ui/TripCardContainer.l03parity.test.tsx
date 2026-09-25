import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { Trip } from '@/shared/api/generated/schemas';
import {
  useGetTripsTripIdBases,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-775 · l03 여행 카드 머리줄 ↔ Figma 1602:2388 — [D-배지][제목] 한 줄 · 배지 색 기준.
 *
 * 무엇을 보장하나:
 *  - AC-5 D-배지와 제목이 같은 가로 줄 안에 있다(지금은 배지 줄 아래에 제목이 따로 있다).
 *  - AC-5 배지 색: 출발까지 14일 이하(D-DAY 포함)면 primary, 15일 이상이면 ink.
 *    기준 14일은 Figma·계약에 값이 없어 정한 발명값이다(Seed Q3=A).
 *  - "오늘"은 서울 날짜다 — UTC 로 세면 자정 직후에 하루가 어긋난다.
 *
 * 왜 이렇게 테스트하나:
 *  - 컨테이너가 렌더 중에 `new Date()` 로 오늘을 읽으므로 `jest.useFakeTimers({ now })` 로 시계를 고정한다.
 *  - 색은 VM 필드 이름이 아니라 **렌더된 배지의 `bg-*` 클래스**로 잰다(필드 이름은 구현 자유).
 *    배지 글자에서 카드 루트 직전까지 올라가며 호스트 요소의 클래스만 모은다(합성 요소는 같은 클래스를
 *    한 번 더 들고 있어 건너뛴다).
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
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

/** KST 2026-06-01 12:00 — 여기서 출발일까지 남은 날을 센다. */
const NOON_KST_0601 = '2026-06-01T03:00:00Z';
const CARD_ROOT = /^my-trip-card-/;

function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 'busan',
    title: '부산 여행',
    startDate: '2026-06-13',
    endDate: '2026-06-15',
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

function tokens(className: unknown): string[] {
  return typeof className === 'string' ? className.split(/\s+/) : [];
}

/** 자신부터 위로, 호스트 요소만(카드 루트에서 멈춤 — 루트 포함 여부는 includeRoot). */
function hostChain(
  node: ReactTestInstance,
  includeRoot = false
): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  let cur: ReactTestInstance | null = node;
  while (cur) {
    if (typeof cur.type === 'string') {
      const isRoot =
        typeof cur.props.testID === 'string' &&
        CARD_ROOT.test(cur.props.testID);
      if (isRoot) {
        if (includeRoot) out.push(cur);
        break;
      }
      out.push(cur);
    }
    cur = cur.parent;
  }
  return out;
}

/** 배지 글자부터 카드 루트 직전까지의 bg-* 토큰. */
function badgeBgTokens(label: string): string[] {
  return hostChain(screen.getByText(label))
    .flatMap((node) => tokens(node.props.className))
    .filter((token) => token.startsWith('bg-'));
}

beforeEach(() => {
  mockUseBases.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTripsTripIdBases>);
  mockUseItinerary.mockReturnValue({
    data: undefined,
    isPending: true,
    isError: false,
  } as unknown as ReturnType<typeof useGetTripsTripIdItinerary>);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AC-5 · 머리줄 [D-배지][제목]', () => {
  it('D-12 배지와 제목 "부산 여행"이 같은 가로 줄(카드 루트가 아닌 flex-row) 안에 있다', () => {
    // 준비: 오늘 KST 06-01, 출발 06-13 → D-12.
    jest.useFakeTimers({ now: new Date(NOON_KST_0601) });

    // 실행
    render(<TripCardContainer trip={trip()} />);

    // 단언: 두 글자의 가장 가까운 공통 호스트 조상 = 가로 줄, 그리고 카드 루트 자체는 아니다.
    const badgeChain = hostChain(screen.getByText('D-12'), true);
    const titleChain = hostChain(screen.getByText('부산 여행'), true);
    const common = badgeChain.find((node) => titleChain.includes(node));

    expect(common).toBeDefined();
    expect(CARD_ROOT.test(String(common?.props.testID ?? ''))).toBe(false);
    expect(tokens(common?.props.className)).toContain('flex-row');
  });
});

describe('AC-5 · 배지 색 기준(14일 이하 primary, Seed Q3=A)', () => {
  it.each([
    ['2026-06-01', 'D-DAY', 'bg-primary', 'bg-ink'],
    ['2026-06-13', 'D-12', 'bg-primary', 'bg-ink'],
    ['2026-06-15', 'D-14', 'bg-primary', 'bg-ink'],
    ['2026-06-16', 'D-15', 'bg-ink', 'bg-primary'],
    ['2026-07-01', 'D-30', 'bg-ink', 'bg-primary'],
  ])(
    '출발 %s → %s 배지는 %s 이고 %s 가 아니다',
    (startDate, label, expected, forbidden) => {
      jest.useFakeTimers({ now: new Date(NOON_KST_0601) });

      render(
        <TripCardContainer trip={trip({ startDate, endDate: '2026-07-10' })} />
      );

      const bg = badgeBgTokens(label);
      expect(bg).toContain(expected);
      expect(bg).not.toContain(forbidden);
    }
  );

  it('오늘은 서울 날짜로 센다 — UTC 05-31 15:30(= KST 06-01 00:30)에 06-15 출발은 D-14 primary', () => {
    // UTC 로 세면 06-15 까지 15일(D-15 · ink)이 된다.
    jest.useFakeTimers({ now: new Date('2026-05-31T15:30:00Z') });

    render(<TripCardContainer trip={trip({ startDate: '2026-06-15' })} />);

    expect(screen.queryByText('D-15')).toBeNull();
    expect(badgeBgTokens('D-14')).toContain('bg-primary');
  });
});
