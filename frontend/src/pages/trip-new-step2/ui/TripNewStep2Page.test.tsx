import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  BaseAssignment,
  Coverage,
  SavedStay,
} from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep2Page } from './TripNewStep2Page';

/**
 * TRIP-672 g02 거점 숙소 2/4 — **배선(재작성).** 두 조회 · 스토어 · 라우터를 잇는다.
 *
 * 무엇을 보장하나 — 화면은 이 중 어느 것도 모른다:
 *  - **변형 판정(옵션 A)** `createdTripId` 부재→notrip · 조회 실패→error · 진행 중→loading · 그 밖→default.
 *    **empty 없음** — 목적지가 있으면 배정이 0이어도 Σnights 카드가 전부 "숙소 미정"으로 뜬다(★4).
 *  - **박별 카드 파생** `toBaseSections` → `nightlyBaseCards`로 배정된 밤은 숙소명, 미배정 밤은 "숙소 미정".
 *  - **제거(D2)** 후보 하트·연박 묶음·coverage/blocked·fixSheet·fallback 경고가 렌더에서 사라진다.
 *  - **CTA 목적지** 두 CTA 다 게이트 없이 활성이고 h04 method 로 replace 이동한다(AC-5).
 *
 * 카드 탭(→S9 오픈 신호)은 여기서 재지 않는다 — 배선의 onPressCard 는 S9 미착수 no-op stub 이라
 * 관측 대상이 없다. 그 계약은 화면 층(`TripWizardStep2Screen.test.tsx`)이 nightNumber 로 잠근다.
 *
 * ⚠️ `jest.mock` 팩토리는 최상단으로 끌어올려진다. 팩토리가 참조하는 바깥 변수는 이름이 `mock`으로
 * 시작해야 예외를 받는다 — **아래 변수 이름을 바꾸지 마라**(리포 확립 규칙).
 * ⚠️ 옛 배선이 아직 import 하던 훅 목(useTripCoverage·useAssignBase·useUnassignBase·useBaseFix)을
 * 남겨 둔다 — red 를 렌더 크래시가 아니라 단언 실패로 내기 위한 것이다(02a ★12). 재작성 후엔 미사용(무해).
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
};

/** 조회 훅이 **어떤 인자로 불렸는지** 기록하는 창구 — 조회 켬/끔이 여기서 관찰된다. */
const mockUseSavedStays = jest.fn();
const mockUseTripBases = jest.fn();

/** TanStack 이 돌려주는 것 중 배선이 실제로 읽는 넷만 흉내낸다(전체를 흉내내면 목이 실물보다 관대해진다). */
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
  useSavedStays: (...args: unknown[]) => {
    mockUseSavedStays(...args);
    return mockSavedStaysResult;
  },
}));

jest.mock('@/features/trip/model/useTripBases', () => ({
  useTripBases: (...args: unknown[]) => {
    mockUseTripBases(...args);
    return mockBasesResult;
  },
  // 아래 셋은 재작성 후 배선이 안 쓴다 — clean-red 용 옛 배선 호환 스텁(★12).
  useTripCoverage: () => mockCoverageResult,
  useAssignBase: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
  }),
  useUnassignBase: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
  }),
}));

// 옛 배선 호환 — useQueryClient 를 무조건 부르던 훅이라 목이 없으면 red 가 크래시로 흐려진다(★12).
jest.mock('@/features/trip/model/useBaseFix', () => ({
  useFixSavedStay: () => ({ mutateAsync: jest.fn() }),
  useExtendTripPeriod: () => ({ mutateAsync: jest.fn() }),
}));

const TRIP_ID = 'trip-1';
const TRIP_START = '2026-06-10';
const TRIP_END = '2026-06-13';

/** h04 방식 선택 목적지 — 두 CTA 의 공통 replace 대상(브리프 AC-5). */
const METHOD_ROUTE = {
  pathname: '/trips/[tripId]/itinerary/method',
  params: { tripId: TRIP_ID },
};

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

/** 6/10→6/12 배정(2박) — 밤 6/10·6/11 을 덮는다(dateTo 는 배타). */
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

function pending<T>(): QueryStub<T> {
  return {
    data: undefined,
    isPending: true,
    isError: false,
    refetch: jest.fn(),
  };
}

function failed<T>(refetch: jest.Mock): QueryStub<T> {
  return { data: undefined, isPending: false, isError: true, refetch };
}

beforeEach(() => {
  // 모듈 싱글턴 스토어를 되돌린다 — 안 하면 앞 테스트 값이 뒤 판정을 뒤집는다.
  useTripWizardStore.getState().reset();
  useTripWizardStore.getState().setPeriod(undefined, TRIP_START, TRIP_END);
  useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
  // 부산 2박 + 경주 1박 = 3밤(옵션 A 의 밤 목록·지역 출처).
  useTripWizardStore.getState().addDestination('부산', 2);
  useTripWizardStore.getState().addDestination('경주', 1);

  [
    routerMock.push,
    routerMock.back,
    routerMock.replace,
    mockUseSavedStays,
    mockUseTripBases,
  ].forEach((fn) => fn.mockClear());

  mockSavedStaysResult = loaded([stay()]);
  mockBasesResult = loaded([assignment()]);
  mockCoverageResult = loaded({ blocked: false, days: [] });
});

describe('변형 판정 (옵션 A — empty 없음)', () => {
  it('★10 · createdTripId 가 없으면 조회를 끄고 notrip 을 그린다', () => {
    // `trips/new/**`는 Stack.Protected 밖이라 딥링크로 tripId 없이 열릴 수 있다.
    useTripWizardStore.getState().reset();
    render(<TripNewStep2Page />);

    // 안내 렌더만 재면 "조회는 보내면서 안내도 그림"이 통과 — 껐는지 함께 잰다.
    expect(mockUseTripBases).toHaveBeenCalledWith(undefined);
    expect(mockUseSavedStays).toHaveBeenCalledWith({ enabled: false });

    expect(screen.getByTestId('trip-base-notrip')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('trip-base-notrip-restart'));
    expect(routerMock.push).toHaveBeenCalledWith('/trips/new/step1');
  });

  it('짝 · tripId 가 있으면 조회를 켜고 default 를 그린다', () => {
    render(<TripNewStep2Page />);

    expect(mockUseTripBases).toHaveBeenCalledWith(TRIP_ID);
    expect(mockUseSavedStays).toHaveBeenCalledWith({ enabled: true });
    expect(screen.queryByTestId('trip-base-notrip')).toBeNull();
    expect(screen.getByTestId('trip-base-step2-root')).toBeOnTheScreen();
  });

  it('조회가 실패하면 error 얼굴로 간다', () => {
    mockBasesResult = failed(jest.fn());
    render(<TripNewStep2Page />);

    expect(screen.getByTestId('trip-base-error')).toBeOnTheScreen();
  });

  it('조회가 진행 중이면 박별 행 스켈레톤을 그린다', () => {
    mockBasesResult = pending();
    render(<TripNewStep2Page />);

    expect(
      screen.getAllByTestId(/^trip-base-skeleton-night-/).length
    ).toBeGreaterThan(0);
  });
});

describe('박별 카드 배선 — toBaseSections → nightlyBaseCards', () => {
  it('배정된 밤은 숙소명을, 미배정 밤은 "숙소 미정"을 그린다 (밤 수 = Σnights)', () => {
    // 부산 2박(배정 있음) + 경주 1박(배정 없음). 배정은 6/10·6/11 만 덮는다.
    render(<TripNewStep2Page />);

    // 밤 3개 = 카드 3장.
    expect(screen.getAllByTestId(/^trip-base-night-card-/)).toHaveLength(3);

    // 카드1 — 배정된 밤(부산·해운대). 카드 텍스트가 이어붙으므로 RegExp(부분 포함)로 잰다(★1).
    const card1 = screen.getByTestId('trip-base-night-card-1');
    expect(card1).toHaveTextContent(/부산/);
    expect(card1).toHaveTextContent(/해운대 오션 호텔/);

    // 카드3 — 미배정 밤(경주). 지역은 destinations 에서, 숙소는 없어 "숙소 미정".
    const card3 = screen.getByTestId('trip-base-night-card-3');
    expect(card3).toHaveTextContent(/경주/);
    expect(card3).toHaveTextContent(/숙소 미정/);
  });

  it('★4 · 담은 숙소·배정이 0이어도 default 로 밤 수만큼 카드가 뜬다 (empty 얼굴 없음)', () => {
    mockSavedStaysResult = loaded([]);
    mockBasesResult = loaded([]);
    render(<TripNewStep2Page />);

    // 옵션 A — 목적지 3밤이 전부 "숙소 미정" 카드로. empty 얼굴로 새지 않는다.
    expect(screen.getAllByTestId(/^trip-base-night-card-/)).toHaveLength(3);
    expect(screen.queryByTestId('trip-base-empty')).toBeNull();
  });
});

describe('제거 확인 (D2) — 실데이터 렌더에서 옛 요소가 사라졌다', () => {
  it('박별 카드는 뜨고(긍정 짝) 후보·묶음·coverage·fix·폴백 testID 는 0건이다', () => {
    render(<TripNewStep2Page />);

    // 긍정 짝 — 카드가 실제로 그려졌다.
    expect(screen.getByTestId('trip-base-night-card-1')).toBeOnTheScreen();

    expect(screen.queryAllByTestId(/^trip-base-candidate-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^trip-base-section-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/trip-base-fixsheet/)).toHaveLength(0);
    expect(screen.queryByTestId('trip-base-blocked-notice')).toBeNull();
    expect(screen.queryByTestId('trip-base-fallback-warning')).toBeNull();
  });
});

describe('CTA 목적지 — 게이트 없이 둘 다 h04 로 replace', () => {
  it('주 CTA 는 활성이고 누르면 방식 선택(h04)으로 replace 이동한다 (push 아님)', () => {
    render(<TripNewStep2Page />);

    const generate = screen.getByTestId('trip-base-generate');
    // 게이트 제거 — coverage 로 잠기던 자리가 항상 활성이다(뮤턴트 red).
    expect(generate).toBeEnabled();
    fireEvent.press(generate);

    // 1회로만 재면 "아무 데나 1회 가는" 배선이 통과 — 목적지까지 잰다.
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledWith(METHOD_ROUTE);
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('보조 CTA("숙소 없이 시작하기")도 h04 로 replace 이동한다', () => {
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));

    expect(routerMock.replace).toHaveBeenLastCalledWith(METHOD_ROUTE);
  });
});

describe('헤더 뒤로 가기', () => {
  it('뒤로 가기는 히스토리를 되감는다 (push 가 아니다)', () => {
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-back'));

    expect(routerMock.back).toHaveBeenCalledTimes(1);
    expect(routerMock.push).not.toHaveBeenCalled();
  });
});
