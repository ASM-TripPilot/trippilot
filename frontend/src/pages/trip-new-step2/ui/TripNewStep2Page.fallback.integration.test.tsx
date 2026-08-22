import { render, screen } from '@testing-library/react-native';

import type {
  BaseAssignment,
  Coverage,
  SavedStay,
} from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep2Page } from './TripNewStep2Page';

/**
 * TRIP-490 — 날짜 없는 숙소로 거점 0인 채 진행하면 결과가 폴백(INV-4)이 되는데, step2가 그
 * 사실을 사용자에게 안 보인다. "숙소 없이 시작하기"(`trip-base-nostay-start`)가 거점 개수를
 * 전혀 안 보고 항상 활성이라 조용히 0-base로 h09까지 흘러 422 폴백에 도달한다.
 *
 * 무엇을 보장하나:
 *  - **담은 숙소가 있는데 거점이 0**이면(= 지정 못 했거나 안 함) 경고 문구가 뜬다.
 *  - **거점을 하나라도 지정**하면 경고가 사라진다(폴백 위험이 없다).
 *  - **애초에 담은 숙소가 없는** 정당한 no-stay 사용자(empty 얼굴)에겐 경고를 안 띄운다 —
 *    그 사용자는 "숙소 없이 시작해도 돼요" 온램프가 정본 흐름이라, 경고는 거짓 경보가 된다.
 *
 * 목 패턴은 형제 `TripNewStep2Page.gate.test.tsx`와 같다(파일-로컬 `jest.mock`이라 복제).
 * ⚠️ 아래 `mock*` 변수 이름을 바꾸지 마라 — `jest.mock` 팩토리 호이스팅 예외 규칙.
 */

jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, back, replace }),
    router: { push, back, replace },
  };
});

interface QueryStub<T> {
  data?: T;
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
}

let mockSavedStaysResult: QueryStub<SavedStay[]>;
let mockBasesResult: QueryStub<BaseAssignment[]>;
let mockCoverageResult: QueryStub<Coverage>;

jest.mock('@/features/trip/model/useSavedStays', () => ({
  useSavedStays: () => mockSavedStaysResult,
}));

jest.mock('@/features/trip/model/useTripBases', () => ({
  useTripBases: () => mockBasesResult,
  useTripCoverage: () => mockCoverageResult,
  useAssignBase: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
  }),
  useUnassignBase: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('@/features/trip/model/useBaseFix', () => ({
  useFixSavedStay: () => ({ mutateAsync: jest.fn() }),
  useExtendTripPeriod: () => ({ mutateAsync: jest.fn() }),
}));

const TRIP_ID = 'trip-1';
const TRIP_START = '2026-06-10';
const TRIP_END = '2026-06-13';

const FALLBACK_WARNING =
  '거점 숙소를 지정하지 않으면 추천 없이 최소한의 일정만 만들어져요';

function stay(over: Partial<SavedStay> = {}): SavedStay {
  return {
    savedStayId: 'stay-a',
    name: '해운대 오션 호텔',
    coordConfirmed: true,
    checkIn: '2026-06-10',
    checkOut: '2026-06-12',
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

function assignment(over: Partial<BaseAssignment> = {}): BaseAssignment {
  return {
    baseAssignmentId: 'ba-1',
    savedStayId: 'stay-a',
    dateFrom: '2026-06-10',
    dateTo: '2026-06-12',
    ...over,
  };
}

function loaded<T>(data: T): QueryStub<T> {
  return { data, isPending: false, isError: false, refetch: jest.fn() };
}

beforeEach(() => {
  useTripWizardStore.getState().reset();
  useTripWizardStore.getState().setPeriod(undefined, TRIP_START, TRIP_END);
  useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
  useTripWizardStore.getState().addDestination('부산', 3);

  mockSavedStaysResult = loaded([stay()]);
  mockBasesResult = loaded([]);
  mockCoverageResult = loaded({ blocked: false, days: [] });
});

describe('TRIP-490 — 거점 0 진행 시 폴백 경고', () => {
  it('🔴 날짜 없는 숙소만 담겨 거점이 0이면 폴백 경고가 뜬다', () => {
    // 티켓 시나리오: 하트로 담아 날짜·좌표가 비어 거점 지정이 막힌 숙소 하나.
    mockSavedStaysResult = loaded([
      stay({ coordConfirmed: false, checkIn: undefined, checkOut: undefined }),
    ]);
    mockBasesResult = loaded([]);

    render(<TripNewStep2Page />);

    expect(screen.getByTestId('trip-base-fallback-warning')).toHaveTextContent(
      FALLBACK_WARNING
    );
  });

  it('🔴 거점을 하나라도 지정하면 경고가 사라진다', () => {
    mockSavedStaysResult = loaded([stay()]);
    mockBasesResult = loaded([assignment()]);

    render(<TripNewStep2Page />);

    expect(screen.queryByTestId('trip-base-fallback-warning')).toBeNull();
  });

  it('🔴 담은 숙소가 없는 정당한 no-stay 사용자에겐 경고를 안 띄운다', () => {
    mockSavedStaysResult = loaded([]);
    mockBasesResult = loaded([]);

    render(<TripNewStep2Page />);

    expect(screen.queryByTestId('trip-base-fallback-warning')).toBeNull();
  });

  it('🔴 로딩 중(거점 미도착)에는 경고를 미리 띄우지 않는다', () => {
    // loading 얼굴은 CtaBlock을 렌더하지만 담은 목록·거점이 아직 안 왔다(둘 다 []).
    // 이 케이스가 `savedStayList.length>0` 가드를 잠근다 — 가드를 지우면 `assignments.length===0`
    // 만 보고 경고가 조기 점멸하는 거짓 INV-4가 되는데(code-critic 경고-1), empty 얼굴은
    // CtaBlock을 안 그려 그 뮤테이션을 못 잡는다. loading 얼굴에서만 사각이 드러난다.
    const pending = {
      data: undefined,
      isPending: true,
      isError: false,
      refetch: jest.fn(),
    };
    mockSavedStaysResult = pending;
    mockBasesResult = pending;
    mockCoverageResult = pending;

    render(<TripNewStep2Page />);

    expect(screen.queryByTestId('trip-base-fallback-warning')).toBeNull();
  });
});
