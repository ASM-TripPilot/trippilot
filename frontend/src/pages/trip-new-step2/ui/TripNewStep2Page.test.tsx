import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AxiosError } from 'axios';

import type {
  BaseAssignment,
  Coverage,
  DayCoverage,
  SavedStay,
} from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep2Page } from './TripNewStep2Page';

/**
 * TRIP-225 g02 거점 숙소 2/2 — **배선**. 세 조회 · 두 뮤테이션 · 스토어 · 라우터를 잇는다.
 *
 * 무엇을 보장하나 — 화면은 이 중 어느 것도 모른다:
 *  - **★1 · ★2 · D16-b (INV-2)** 막을지의 권위는 `blocked` 필드 하나다. `days`가 전부 `AUTO`인
 *    **모순 응답**에서도 `blocked:true`면 막는다 — 이 케이스가 없으면 "days를 세서 같은 결론"인
 *    구현이 정상 데이터만으로 전부 통과한다.
 *  - **★3 · D12** 같은 카드를 연타해도 POST는 1회. 짝으로 **다른** 카드는 2회(목록 전체를
 *    잠그지 않는다).
 *  - **★5 · D15** `coverage`만 실패하면 목록은 살고, 주 CTA는 막히고, 보조 CTA는 열린다 —
 *    **한 케이스 안에서 셋 다**.
 *  - **★10 · D7** `createdTripId`가 없으면 세 조회를 **보내지 않는다**(`enabled:false`).
 *  - **★20 · D13·D13-b** 409는 성공으로 접고, 그 밖의 실패는 **그 자리에** 인라인 오류를
 *    덧붙인다(전면 error로 도망가지 않는다).
 *  - **★19 · D17** 여행 기간 밖 배정도 거르지 않는다 — 숨기면 데이터 이상이 조용해진다.
 *
 * 왜 node 버킷인가: 심판 대상이 "조회 **결과 조합**이 어떤 판정으로 이어지는가"다. 성공·부분
 * 실패·전면 실패·tripId 부재를 손으로 갈아 끼워야 하므로 훅을 모듈째 목킹한다
 * (`TripNewStep1Page.stayImport.test.tsx`와 같은 형태). **실제 재요청 횟수**는
 * `features/trip/model/useTripBases.integration.test.tsx`가 따로 본다 — 이 파일은 그 거동을
 * *가정하고* 배선만 심판한다.
 *
 * ⚠️ `jest.mock` 팩토리는 파일 최상단으로 끌어올려진다. 팩토리가 참조하는 바깥 변수는 이름이
 * `mock`으로 시작해야 예외를 받는다 — **아래 변수 이름을 바꾸지 마라**(리포 확립 규칙).
 *
 * ⚠️ 모든 "막힌다" 단언은 `toBeDisabled()` + 실제 `press` + 핸들러 0회 **3단**이다(02a ★12) —
 * 매처는 접근성 상태만 읽어서, 회색이기만 하고 실제로는 눌리는 버튼을 통과시킨다(실측).
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

/** 조회 훅이 **어떤 인자로 불렸는지**를 기록하는 창구 — ★10이 여기서 관찰된다. */
const mockUseSavedStays = jest.fn();
const mockUseTripBases = jest.fn();
const mockUseTripCoverage = jest.fn();
const mockAssignMutate = jest.fn();
const mockUnassignMutate = jest.fn();

/** TanStack이 돌려주는 것 중 이 배선이 **실제로 읽는** 넷만 흉내낸다. 전체를 흉내내면 목이
 * 실물보다 관대해져 심판이 무뎌진다(02a ★14). */
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
  useTripCoverage: (...args: unknown[]) => {
    mockUseTripCoverage(...args);
    return mockCoverageResult;
  },
  useAssignBase: () => ({ mutateAsync: mockAssignMutate }),
  useUnassignBase: () => ({ mutateAsync: mockUnassignMutate }),
}));

const TRIP_ID = 'trip-1';
const TRIP_START = '2026-06-10';
const TRIP_END = '2026-06-13';

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

function day(date: string, status: DayCoverage['status']): DayCoverage {
  return { date, status };
}

function loaded<T>(data: T): QueryStub<T> {
  return { data, isPending: false, isError: false, refetch: jest.fn() };
}

function failed<T>(): QueryStub<T> {
  return {
    data: undefined,
    isPending: false,
    isError: true,
    refetch: jest.fn(),
  };
}

/** 실패 응답. `isAxiosError`가 true여야 배선의 409 판정이 도는 경로를 탄다
 * (`TripNewStep1Page.tsx`의 `isAlreadyRegistered`와 같은 형태). */
function httpError(status: number): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}

/** 세 조회가 전부 성공한 기본 상태. 케이스마다 필요한 축만 갈아 끼운다. */
function allLoaded(over: { blocked?: boolean; days?: DayCoverage[] } = {}) {
  mockSavedStaysResult = loaded([stay()]);
  mockBasesResult = loaded([assignment()]);
  mockCoverageResult = loaded({
    blocked: over.blocked ?? false,
    days: over.days ?? [
      day('2026-06-10', 'AUTO'),
      day('2026-06-11', 'AUTO'),
      day('2026-06-12', 'AUTO'),
    ],
  });
}

beforeEach(() => {
  // 모듈 싱글턴 스토어를 되돌린다 — 안 하면 앞 테스트가 남긴 값이 뒤 테스트의 판정을 뒤집는다.
  useTripWizardStore.getState().reset();
  useTripWizardStore.getState().setPeriod(undefined, TRIP_START, TRIP_END);
  useTripWizardStore.getState().setCreatedTripId(TRIP_ID);

  [
    routerMock.push,
    // 뒤로 가기는 `push`가 아니라 `back`이다(★23) — 케이스 사이에 누적되지 않게 함께 씻는다.
    routerMock.back,
    mockUseSavedStays,
    mockUseTripBases,
    mockUseTripCoverage,
    mockAssignMutate,
    mockUnassignMutate,
  ].forEach((fn) => fn.mockClear());

  mockAssignMutate.mockResolvedValue(undefined);
  mockUnassignMutate.mockResolvedValue(undefined);
  allLoaded();
});

describe('성공 경로 — 세 조회가 화면 한 장으로 합쳐진다', () => {
  it('AC-10 · 구간과 후보가 그려지고 blocked:false면 주 CTA가 열린다', () => {
    mockSavedStaysResult = loaded([
      stay(),
      stay({ savedStayId: 'stay-b', name: '광안리 뷰 호텔' }),
    ]);
    render(<TripNewStep2Page />);

    expect(screen.getAllByTestId(/^trip-base-section-/)).toHaveLength(1);
    expect(screen.getAllByTestId(/^trip-base-candidate-/)).toHaveLength(2);
    expect(screen.getByTestId('trip-base-generate')).toBeEnabled();
  });

  it('★7 · 화면 순서는 dateFrom 오름차순이다 — 배선이 다시 정렬하지 않는다', () => {
    // 준비 — 서버가 역순으로 줬다고 가정한다. 정렬을 소유한 것은 `toBaseSections`(TRIP-224)다.
    mockBasesResult = loaded([
      assignment({
        baseAssignmentId: 'ba-2',
        savedStayId: 'stay-b',
        dateFrom: '2026-06-12',
        dateTo: '2026-06-13',
      }),
      assignment(),
    ]);
    mockSavedStaysResult = loaded([
      stay(),
      stay({ savedStayId: 'stay-b', name: '경주 한옥스테이 봄' }),
    ]);
    render(<TripNewStep2Page />);

    expect(
      screen
        .getAllByTestId(/^trip-base-section-/)
        .map((node) => node.props.testID)
    ).toEqual(['trip-base-section-ba-1', 'trip-base-section-ba-2']);
  });

  it('★19 · D17 — 여행 기간 밖 배정도 거르지 않고 그대로 그린다', () => {
    // 서버가 POST에서 기간 내를 검증하므로(INV-U1-15) 원래 나올 수 없다. 나오면 데이터
    // 이상이고, **숨기면 그 이상이 조용해진다**. 거르는 것은 판정이고 판정은 서버 몫이다.
    mockBasesResult = loaded([
      assignment({ dateFrom: '2026-06-20', dateTo: '2026-06-22' }),
    ]);
    render(<TripNewStep2Page />);

    expect(screen.getByTestId('trip-base-section-ba-1')).toBeOnTheScreen();
  });

  it('★8 · D5 — 짝 없는 저장 숙소는 대체 문구가 되고 행은 남는다', () => {
    // `toBaseSections`는 빈 문자열을 낸다(정본에 없는 문구를 발명하지 않는다). 그 빈 문자열을
    // 화면 문구로 바꾸는 것이 배선의 몫이다.
    mockSavedStaysResult = loaded([]);
    render(<TripNewStep2Page />);

    const row = screen.getByTestId('trip-base-section-ba-1');
    expect(row).toBeOnTheScreen();
    expect(row).toHaveTextContent(/숙소 정보 없음/);
  });
});

describe('★1 · ★2 · D16-b — 막을지의 권위는 blocked 필드 하나다 (INV-2)', () => {
  it('🔴 days가 전부 AUTO여도 blocked:true면 막는다 (모순 응답)', () => {
    // 이 케이스가 **★1의 본체**다. `days.some(d => d.status !== 'AUTO')`로 막는 구현은
    // 정상 데이터에서 언제나 같은 결론에 도달해 다른 모든 케이스를 통과한다 — 서버와
    // 클라이언트가 어긋나는 이 한 지점에서만 갈린다.
    allLoaded({
      blocked: true,
      days: [
        day('2026-06-10', 'AUTO'),
        day('2026-06-11', 'AUTO'),
        day('2026-06-12', 'AUTO'),
      ],
    });
    render(<TripNewStep2Page />);

    // 3단 차단(★12).
    const generate = screen.getByTestId('trip-base-generate');
    expect(generate).toBeDisabled();
    fireEvent.press(generate);
    expect(routerMock.push).not.toHaveBeenCalled();

    // 나열은 비어 있다 — 그래도 막힌다. 나열과 차단은 서로 다른 두 출처에서 온다.
    expect(screen.queryAllByTestId(/^trip-base-coverage-day-/)).toHaveLength(0);
  });

  it('짝 — days에 GAP이 있어도 blocked:false면 열린다', () => {
    // 위 케이스의 거울. 둘을 같이 두어야 "blocked를 읽는다"가 증명된다 — 하나만 두면
    // "언제나 막는다"나 "언제나 연다"가 통과한다.
    allLoaded({
      blocked: false,
      days: [day('2026-06-11', 'GAP'), day('2026-06-12', 'AUTO')],
    });
    render(<TripNewStep2Page />);

    expect(screen.getByTestId('trip-base-generate')).toBeEnabled();
    expect(screen.queryByTestId('trip-base-blocked-notice')).toBeNull();
    // 루트 존재 짝(★17) — 렌더가 통째로 실패해서 통과한 것이 아니다.
    expect(screen.getByTestId('trip-base-step2-root')).toBeOnTheScreen();
  });

  it('D16 — 미해결 날짜를 앞 2개 + 외 N일로 나열한다', () => {
    allLoaded({
      blocked: true,
      days: [
        day('2026-06-10', 'AUTO'),
        day('2026-06-11', 'GAP'),
        day('2026-06-13', 'OVERLAP'),
        day('2026-06-14', 'GAP'),
      ],
    });
    render(<TripNewStep2Page />);

    expect(screen.getByTestId('trip-base-blocked-days')).toHaveTextContent(
      '6/11 · 6/13 · 외 1일'
    );
    // GAP·OVERLAP을 **둘 다** 셌다 — GAP만 나열하면 겹침만 있는 여행에서 안내행이 비어
    // 침묵 실패가 된다(BR-U1-55).
    expect(
      screen.getByTestId('trip-base-coverage-day-2026-06-13')
    ).toBeOnTheScreen();
  });
});

describe('AC-6 · 거점으로 지정 (US-TRIP-04 · 01b D1)', () => {
  it('저장 숙소의 체크인/아웃을 그대로 실어 보내고, 날짜를 다시 묻지 않는다', async () => {
    mockSavedStaysResult = loaded([
      stay({
        savedStayId: 'stay-b',
        name: '광안리 뷰 호텔',
        checkIn: '2026-06-12',
        checkOut: '2026-06-13',
      }),
    ]);
    mockBasesResult = loaded([]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));

    await waitFor(() => expect(mockAssignMutate).toHaveBeenCalledTimes(1));
    // 01b D1 — 날짜 선택 UI를 신설하지 않는다. 계약이 3필드 전부 필수라 출처가 필요했고,
    // BR-U1-26("날짜 없이 저장은 되나 배정은 불가")이 이 해석의 근거다.
    expect(mockAssignMutate).toHaveBeenCalledWith({
      tripId: TRIP_ID,
      data: {
        savedStayId: 'stay-b',
        dateFrom: '2026-06-12',
        dateTo: '2026-06-13',
      },
    });

    // US-TRIP-04 정상 AC의 관찰 가능한 형태 — 이름·위치를 **다시 묻는 입력이 뜨지 않는다**.
    expect(screen.queryByTestId('trip-base-date-sheet')).toBeNull();
    // 루트 존재 짝(★17).
    expect(screen.getByTestId('trip-base-step2-root')).toBeOnTheScreen();
  });

  it('🔴 ★3 — 같은 카드를 연타해도 요청은 1회다 (TRIP-224 W-2 인계)', async () => {
    // 잠금이 실제로 거는지는 "두 번 눌러 요청 수를 센다"로만 보인다. 테스트는 구현을
    // 지정하지 않고 **결과(1회)만** 잰다.
    //
    // ⚠️ **이 케이스가 실제로 재는 것은 화면의 `disabled` prop이다**(게이트①-2 정정, 03b
    // W-3 실측). RNTL `fireEvent.press`는 각각 `act()`로 감싸여 있어 **두 누름 사이에 반드시
    // 리렌더가 끼고**, 그때 이미 `disabled`가 서서 두 번째 press가 RN 레벨에서 막힌다.
    // 그래서 `useRef` 잠금을 통째로 상태 잠금으로 바꿔도 이 케이스는 green이다(실측).
    // 실기기의 같은 프레임 두 번 탭에는 그 리렌더가 없다 — 그 자리는 아래 ★25가 잰다.
    mockAssignMutate.mockReturnValue(new Promise(() => {}));
    mockSavedStaysResult = loaded([stay({ savedStayId: 'stay-b' })]);
    mockBasesResult = loaded([]);
    render(<TripNewStep2Page />);

    const button = screen.getByTestId('trip-base-assign-stay-b');
    fireEvent.press(button);
    fireEvent.press(button);

    expect(mockAssignMutate).toHaveBeenCalledTimes(1);
  });

  it('🔴 ★25 · W-3 — 리렌더가 끼지 않는 같은 틱 두 번에도 요청은 1회다', async () => {
    // 위 ★3의 사각지대를 메운다. 두 press를 **하나의 바깥 `act()`로 감싸면** 안쪽 act가
    // flush를 바깥으로 미뤄 두 누름 사이에 리렌더가 없다 — 실기기에서 한 프레임 안에
    // 두 번 탭한 것과 같은 상태이고, 그때는 `disabled`가 아직 서지 못한다.
    //
    // *(개념)* `act()` — React 상태 갱신을 언제 화면에 반영할지 묶어 주는 테스트 도구.
    // 중첩하면 안쪽이 아니라 **가장 바깥 act가 끝날 때** 한 번에 반영된다.
    //
    // 실검증(1회 실행): ref 잠금 1회 / 상태 잠금 **2회** — 두 구현이 실제로 갈린다.
    // 같은 프로브에서 평범한 press 2회는 두 구현 모두 1회였다(그래서 ★3만으로는 부족하다).
    mockAssignMutate.mockReturnValue(new Promise(() => {}));
    mockSavedStaysResult = loaded([stay({ savedStayId: 'stay-b' })]);
    mockBasesResult = loaded([]);
    render(<TripNewStep2Page />);

    const button = screen.getByTestId('trip-base-assign-stay-b');
    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    // 깨지면: 실기기 빠른 두 번 탭이 `POST /bases`를 두 번 쏘고, 둘째가 409를 받아 조용히
    // 성공으로 접힌다(D13-b). 화면 증상이 없어 서버에만 중복 요청이 쌓인다.
    expect(mockAssignMutate).toHaveBeenCalledTimes(1);
  });

  it('짝 · D12 — 잠금 범위는 누른 카드 하나뿐이다', async () => {
    // 목록 전체를 잠그면 다른 숙소를 연달아 지정할 때마다 기다려야 한다. 이 짝이 없으면
    // "전부 잠그는" 난폭한 구현도 위 케이스를 통과한다.
    mockAssignMutate.mockReturnValue(new Promise(() => {}));
    mockSavedStaysResult = loaded([
      stay({ savedStayId: 'stay-b' }),
      stay({ savedStayId: 'stay-c', name: '감천 게스트하우스' }),
    ]);
    mockBasesResult = loaded([]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));
    fireEvent.press(screen.getByTestId('trip-base-assign-stay-c'));

    expect(mockAssignMutate).toHaveBeenCalledTimes(2);
  });

  it('01b D4 · ★12 — 날짜 없는 숙소는 사유를 보이고 실제로 요청이 안 나간다', async () => {
    // BR-U1-26 · INV-U1-09 페일클로즈. 그냥 보내고 서버 400을 받는 구현은 사용자에게
    // 원인을 설명하지 못한다.
    mockSavedStaysResult = loaded([
      stay({ savedStayId: 'stay-b', checkIn: null, checkOut: null }),
    ]);
    mockBasesResult = loaded([]);
    render(<TripNewStep2Page />);

    expect(
      screen.getByTestId('trip-base-assign-blocked-stay-b')
    ).toBeOnTheScreen();

    const button = screen.getByTestId('trip-base-assign-stay-b');
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(mockAssignMutate).not.toHaveBeenCalled();
  });
});

describe('★20 · 지정 실패 처리 (01b D13)', () => {
  it('성공하면 아무 오류도 남기지 않는다 — 앵커', async () => {
    // 아래 실패 케이스의 짝이다. 이게 없으면 "언제나 오류를 그리는" 구현과 구별되지 않는다.
    //
    // ⚠️ **409(이미 배정됨)는 이 층의 관심사가 아니다**(01b D13-b). 409를 성공으로 접는 것은
    // `useAssignBase`가 지고(재조회 경로와 한 몸이라 그쪽이 유일한 자리다), 그 계약은
    // `useTripBases.integration.test.tsx`가 **실제 409 응답으로** 심판한다. 여기서 목을
    // 409로 거부시키면 배선에 409 분기가 하나 더 생기고 판정이 두 층으로 갈린다.
    mockSavedStaysResult = loaded([stay({ savedStayId: 'stay-b' })]);
    mockBasesResult = loaded([]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));
    await act(async () => {});

    expect(screen.queryByTestId('trip-base-assign-error-stay-b')).toBeNull();
    // 루트 존재 짝(★17) — 렌더가 죽어서 통과한 것이 아니다.
    expect(screen.getByTestId('trip-base-candidate-stay-b')).toBeOnTheScreen();
  });

  it('🔴 실패는 그 자리에 오류 한 줄 + 다시 시도를 덧붙인다', async () => {
    // 01b D13 — 전면 error로 **안 간다**. 얼굴을 갈아 끼우면 사용자가 방금까지 보던 목록을
    // 잃는다(선례: TRIP-208 `StayImportRow`). 자리가 곧 대상 지시라 문구에 숙소 이름이 없다.
    mockAssignMutate.mockRejectedValue(httpError(500));
    mockSavedStaysResult = loaded([stay({ savedStayId: 'stay-b' })]);
    mockBasesResult = loaded([]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));

    await waitFor(() =>
      expect(
        screen.getByTestId('trip-base-assign-error-stay-b')
      ).toBeOnTheScreen()
    );
    // 전면 얼굴로 도망가지 않았다 — 목록이 그대로 있다.
    expect(screen.queryByTestId('trip-base-error')).toBeNull();
    expect(screen.getByTestId('trip-base-candidate-stay-b')).toBeOnTheScreen();

    // 잠금이 풀렸다 — 다시 시도가 실제로 다시 쏜다. 안 풀면 사용자가 영영 못 누른다.
    mockAssignMutate.mockResolvedValue(undefined);
    fireEvent.press(screen.getByTestId('trip-base-assign-retry-stay-b'));
    await waitFor(() => expect(mockAssignMutate).toHaveBeenCalledTimes(2));
  });
});

describe('AC-13 · 변경 = 해제 (01b D6)', () => {
  it('DELETE를 배정 id로 보내고, 재배정 시트를 띄우지 않는다', async () => {
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-change-ba-1'));

    await waitFor(() => expect(mockUnassignMutate).toHaveBeenCalledTimes(1));
    expect(mockUnassignMutate).toHaveBeenCalledWith({
      tripId: TRIP_ID,
      baseAssignmentId: 'ba-1',
    });
    // 해제만 하고 후보 목록에서 다시 고른다(D6). 시트는 TRIP-190 경계다.
    expect(screen.queryByTestId('trip-base-date-sheet')).toBeNull();
    expect(screen.getByTestId('trip-base-step2-root')).toBeOnTheScreen();
  });
});

describe('★5 · 실패 규칙 (01b D14 · D15)', () => {
  it('🔴 coverage만 실패 — 목록은 살고 · 주 CTA는 막히고 · 보조 CTA는 열린다', () => {
    // 셋을 **한 케이스 안에서** 잰다. 하나만 재면 "둘 다 막음"이나 "둘 다 열음"이 통과한다.
    // 모를 때는 막는다(INV-U1-16 페일클로즈) — 선례: `tripDraft.ts` 5-c 페일오픈→페일클로즈 반전.
    mockCoverageResult = failed<Coverage>();
    render(<TripNewStep2Page />);

    // ① 목록은 정상이다 — 전면 error로 도망가지 않았다.
    expect(screen.getByTestId('trip-base-section-ba-1')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-candidate-stay-a')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-base-error')).toBeNull();

    // ② 침묵하지 않는다(BR-U1-55).
    expect(screen.getByTestId('trip-base-coverage-error')).toBeOnTheScreen();

    // ③ 주 CTA는 3단 차단.
    const generate = screen.getByTestId('trip-base-generate');
    expect(generate).toBeDisabled();
    fireEvent.press(generate);
    expect(routerMock.push).not.toHaveBeenCalled();

    // ④ 보조 CTA는 어느 실패에서도 활성이다(BR-U1-40 · BR-U1-47).
    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });

  it('🔴 D14 — bases가 실패하면 전면 error 얼굴로 간다', () => {
    // 화면의 두 목록이 saved-stays·bases에서 나오므로 하나만 죽어도 골격이 없다. 부분 표시를
    // 시도하면 상태 조합이 폭발한다.
    mockBasesResult = failed<BaseAssignment[]>();
    render(<TripNewStep2Page />);

    expect(screen.getByTestId('trip-base-error')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^trip-base-section-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^trip-base-candidate-/)).toHaveLength(0);
    // 보조 CTA는 전면 error에서도 살아 있다(Figma 2456:1511 실측).
    expect(screen.getByTestId('trip-base-error-nostay')).toBeOnTheScreen();
  });

  it('D14 짝 — saved-stays가 실패해도 같은 얼굴이다', () => {
    mockSavedStaysResult = failed<SavedStay[]>();
    render(<TripNewStep2Page />);

    expect(screen.getByTestId('trip-base-error')).toBeOnTheScreen();
  });

  it('AC-12 · D3 — 저장 숙소가 0개면 empty 얼굴이고, 진행이 막히지 않는다', () => {
    // BR-U1-47 — 등록 숙소 0개인 여행은 차단 대상이 아니다(BR-U1-40과 짝).
    mockSavedStaysResult = loaded([]);
    mockBasesResult = loaded([]);
    render(<TripNewStep2Page />);

    expect(screen.getByTestId('trip-base-empty')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});

describe('★10 · D7 — createdTripId가 없으면 조회를 보내지 않는다', () => {
  it('🔴 세 조회가 전부 꺼진 채로 안내와 처음부터를 그린다', () => {
    // `trips/new/**`는 `Stack.Protected` 밖이라 딥링크·앱 재시작으로 실제로 열린다
    // (`docs/structure.md` 경고). 그때 tripId 없이 세 조회를 쏘면 전부 404가 된다.
    useTripWizardStore.getState().reset();
    render(<TripNewStep2Page />);

    // 안내 렌더만 재면 "조회는 보내면서 안내도 그림"이 통과한다 — 껐는지를 함께 잰다.
    expect(mockUseTripBases).toHaveBeenCalledWith(undefined);
    expect(mockUseTripCoverage).toHaveBeenCalledWith(undefined);
    expect(mockUseSavedStays).toHaveBeenCalledWith({ enabled: false });

    expect(screen.getByTestId('trip-base-notrip')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('trip-base-notrip-restart'));
    expect(routerMock.push).toHaveBeenCalledWith('/trips/new/step1');
  });

  it('짝 — tripId가 있으면 세 조회가 켜진다', () => {
    // 이 짝이 없으면 "언제나 꺼 두는" 구현이 위 케이스를 통과하고 화면이 영영 안 뜬다.
    render(<TripNewStep2Page />);

    expect(mockUseTripBases).toHaveBeenCalledWith(TRIP_ID);
    expect(mockUseTripCoverage).toHaveBeenCalledWith(TRIP_ID);
    expect(mockUseSavedStays).toHaveBeenCalledWith({ enabled: true });
    expect(screen.queryByTestId('trip-base-notrip')).toBeNull();
    expect(screen.getByTestId('trip-base-step2-root')).toBeOnTheScreen();
  });
});

describe('loading — 세 조회 중 하나라도 진행 중이면 자리를 잡는다', () => {
  it('스켈레톤을 그리고 보조 CTA는 살려 둔다', () => {
    mockBasesResult = {
      data: undefined,
      isPending: true,
      isError: false,
      refetch: jest.fn(),
    };
    render(<TripNewStep2Page />);

    expect(
      screen.getAllByTestId(/^trip-base-skeleton-card-/).length
    ).toBeGreaterThan(0);
    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ *
 * 게이트①-2 심판 보강 — 03b 적대적 리뷰의 생존 뮤테이션을 죽인다.
 * 공통 성격: 위 케이스들은 **판정 결과**를 촘촘히 재는데, 그 판정이 화면과 라우터까지
 * 실제로 **실려 가는지**(배선)를 재는 자리가 비어 있었다. 핸들러를 무동작으로 바꿔도
 * 전원 green이던 자리들이다.
 * ------------------------------------------------------------------ */

describe('★22 · B-1 — 주 CTA는 실제로 위저드를 벗어난다 (03b 차단)', () => {
  it('🔴 활성 상태의 주 CTA를 누르면 일정 화면으로 이동한다', () => {
    // 03b 실측: 화면·페이지 두 층의 핸들러를 동시에 끊고 리포 전체 1,302케이스를 돌렸더니
    // 전원 green이었다. 거점을 정성껏 고른 사용자가 분홍 버튼을 눌러도 아무 일이 안 나고,
    // 남는 출구가 그 아래 회색 글씨뿐인 상태를 심판이 통과시킨다.
    allLoaded({ blocked: false });
    render(<TripNewStep2Page />);

    const generate = screen.getByTestId('trip-base-generate');
    expect(generate).toBeEnabled();
    fireEvent.press(generate);

    // ★26(W-6) — 1회로만 재면 "아무 데나 1회 가는" 배선이 통과한다. 목적지까지 잰다.
    expect(routerMock.push).toHaveBeenCalledTimes(1);
    expect(routerMock.push).toHaveBeenCalledWith('/(tabs)/itinerary');
  });
});

describe('★26 · W-6 — 이탈 목적지 (03b 경고)', () => {
  it('🔴 두 보조 CTA가 각자 제 목적지로 간다', () => {
    // `router.push`가 1회 불렸다만 재면 `숙소 없이 시작하기`를 방금 지나온 step1로 되돌려도
    // 통과한다 — 그러면 사용자가 step1↔step2 고리에 갇혀 위저드에서 나갈 수 없다.
    mockSavedStaysResult = loaded([]);
    mockBasesResult = loaded([]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));
    expect(routerMock.push).toHaveBeenLastCalledWith('/(tabs)/itinerary');

    fireEvent.press(screen.getByTestId('trip-base-explore-stays'));
    expect(routerMock.push).toHaveBeenLastCalledWith('/stays');

    expect(routerMock.push).toHaveBeenCalledTimes(2);
  });

  it('🔴 ★23 · W-7 — 헤더 뒤로 가기는 히스토리를 되감는다 (push가 아니다)', () => {
    // `push`로 구현하면 뒤로 갈수록 스택이 쌓여 하드웨어 백이 step2로 되돌아온다.
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-back'));

    expect(routerMock.back).toHaveBeenCalledTimes(1);
    expect(routerMock.push).not.toHaveBeenCalled();
  });
});

describe('★27 · W-1 — 거점 배지와 지정 상태는 배정 응답에서 파생된다 (BR-U1-20 · INV-U1-07)', () => {
  it('🔴 배정된 숙소만 배지·지정 pill을 갖고, 지정 버튼을 잃는다', () => {
    // 이 변환(배정 응답 → 카드 상태)을 재는 곳이 없었다. `isBase: false` 고정, `assignedLabel:
    // undefined` 고정 뮤테이션이 각각 57케이스 전원 green이었다(03b 실측). 깨지면 이미
    // 지정한 숙소가 배지도 pill도 없이 `거점으로 지정` 버튼을 단 채 남고, 눌러도 409를
    // 성공으로 접어(D13-b) 화면이 한 글자도 안 바뀌어 사용자가 계속 다시 누른다.
    //
    // ★16과 짝이다 — 배지가 SVG `fill`로만 갈리면 리포의 카드 지문 가드가 못 본다. 그래서
    // testID와 텍스트로 드러나는지를 잰다.
    mockBasesResult = loaded([assignment()]);
    mockSavedStaysResult = loaded([
      stay(),
      stay({ savedStayId: 'stay-b', name: '광안리 뷰 호텔' }),
    ]);
    render(<TripNewStep2Page />);

    // 긍정 짝(★17) — 두 카드가 실제로 그려졌다.
    expect(screen.getByTestId('trip-base-candidate-stay-a')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-candidate-stay-b')).toBeOnTheScreen();

    expect(screen.getByTestId('trip-base-badge-stay-a')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-base-badge-stay-b')).toBeNull();

    // 박수 라벨까지 배정에서 파생된다 — 단일 Text 노드라 문자열 완전 일치를 쓴다(★11).
    expect(screen.getByTestId('trip-base-assigned-stay-a')).toHaveTextContent(
      '1–2박에 지정됨'
    );
    expect(screen.queryByTestId('trip-base-assigned-stay-b')).toBeNull();

    // 이미 지정한 숙소에는 다시 누를 어포던스를 주지 않는다.
    expect(screen.queryByTestId('trip-base-assign-stay-a')).toBeNull();
    expect(screen.getByTestId('trip-base-assign-stay-b')).toBeOnTheScreen();
  });
});

describe('★28 · W-2 — 두 재시도 버튼이 실제로 다시 부른다 (03b 경고)', () => {
  it('🔴 전면 error의 다시 시도가 세 조회를 모두 다시 부른다', () => {
    // 화면 테스트는 `onRetryAll` **prop이 불렸는지**만 재고, 그 prop이 `refetch()`를 부르는지는
    // 아무도 안 봤다. `() => {}`로 바꿔도 57케이스 green(03b 실측). 깨지면 신호가 끊겼다
    // 돌아온 사용자가 `다시 시도`를 눌러도 화면이 그대로고, 앱을 껐다 켜면 위저드 스토어가
    // 날아가 notrip으로 떨어진다 — **한 번 실패하면 그 여행의 거점 화면으로 영영 못 돌아온다.**
    mockBasesResult = failed<BaseAssignment[]>();
    render(<TripNewStep2Page />);

    // 앵커 — 그 얼굴이 실제로 서 있다(★17).
    expect(screen.getByTestId('trip-base-error')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('trip-base-error-retry'));

    expect(mockBasesResult.refetch).toHaveBeenCalledTimes(1);
    expect(mockSavedStaysResult.refetch).toHaveBeenCalledTimes(1);
    expect(mockCoverageResult.refetch).toHaveBeenCalledTimes(1);
  });

  it('🔴 짝 — coverage 재시도는 coverage만 다시 부른다 (사정거리)', () => {
    // ★4와 같은 계열의 부정 짝이다. 긍정 단언만 두면 "실패한 것 하나가 아니라 전부 다시
    // 쏘는" 난폭한 구현도 통과하는데, 그러면 멀쩡히 그려진 목록이 통째로 다시 로딩된다.
    mockCoverageResult = failed<Coverage>();
    render(<TripNewStep2Page />);

    expect(screen.getByTestId('trip-base-coverage-error')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('trip-base-coverage-retry'));

    expect(mockCoverageResult.refetch).toHaveBeenCalledTimes(1);
    expect(mockBasesResult.refetch).not.toHaveBeenCalled();
    expect(mockSavedStaysResult.refetch).not.toHaveBeenCalled();
  });
});

describe('★24 · W-4 · BR-U1-55 — 나열이 비어도 막힌 이유는 남는다 (03b 경고)', () => {
  it('🔴 blocked:true인데 days가 전부 AUTO여도 안내행 제목이 선다', () => {
    // ★2(위)는 "CTA가 막힌다"만 재고 **"왜 막혔는지 보인다"는 안 잰다.** 서버가 이 모순
    // 응답을 주면 주 CTA는 회색인데 그 위에 안내행도 오류 줄도 없어, 왜 못 누르는지
    // 알려 주는 것이 화면에 하나도 없다 — 앱이 멈춘 것으로 읽힌다.
    allLoaded({
      blocked: true,
      days: [
        day('2026-06-10', 'AUTO'),
        day('2026-06-11', 'AUTO'),
        day('2026-06-12', 'AUTO'),
      ],
    });
    render(<TripNewStep2Page />);

    expect(screen.getByTestId('trip-base-blocked-notice')).toHaveTextContent(
      /아직 정리되지 않은 날짜가 있어요/
    );
    // 나열은 여전히 비어 있다 — 없는 날짜를 지어내 채우는 것은 해법이 아니다.
    expect(screen.queryAllByTestId(/^trip-base-coverage-day-/)).toHaveLength(0);

    // 차단은 그대로 3단(★12).
    const generate = screen.getByTestId('trip-base-generate');
    expect(generate).toBeDisabled();
    fireEvent.press(generate);
    expect(routerMock.push).not.toHaveBeenCalled();
  });
});

describe('★29 · W-5 — 두 날짜 문자열이 화면까지 실려 간다 (03b 경고)', () => {
  it('🔴 구간 날짜와 섹션 부제가 순수 함수 결과 그대로 그려진다', () => {
    // 순수 함수 자체는 `baseScreen.test.ts`가 잘 재지만 **페이지가 그 함수를 부르는지**는
    // 아무도 안 봤다. `dateLabel: ''`·`subtitle: ''` 고정이 각각 57케이스 green(03b 실측).
    // 깨지면 구간 행이 `1–2박` 뱃지만 달고 날짜가 비어, 거점이 둘 이상일 때 어느 행이 어느
    // 날인지 구별할 수 없어 `변경`으로 엉뚱한 구간을 해제한다.
    //
    // 둘 다 **단일 Text 노드**라 완전 일치를 쓴다(실검증 1회 실행). 컨테이너 정규식보다
    // 강하다 — 앞뒤에 군더더기가 붙어도 잡힌다.
    render(<TripNewStep2Page />);

    expect(screen.getByText('박별 거점 · 6월 10일–13일')).toBeOnTheScreen();
    expect(screen.getByText('6/10–6/12')).toBeOnTheScreen();
  });

  it('🔴 짝 — 기간과 배정 날짜가 바뀌면 두 문자열도 따라 바뀐다', () => {
    // 이 짝이 없으면 두 문자열을 **상수로 박은** 구현이 위 케이스를 통과한다. 달을 넘는
    // 갈래(`6월 30일–7월 2일`)까지 함께 태워, Figma가 그리지 않은 그 경로도 배선을 탄다는
    // 것을 본다(02a §5-6 I-6).
    useTripWizardStore
      .getState()
      .setPeriod(undefined, '2026-06-30', '2026-07-02');
    mockBasesResult = loaded([
      assignment({ dateFrom: '2026-07-01', dateTo: '2026-07-03' }),
    ]);
    render(<TripNewStep2Page />);

    expect(screen.getByText('박별 거점 · 6월 30일–7월 2일')).toBeOnTheScreen();
    expect(screen.getByText('7/1–7/3')).toBeOnTheScreen();
  });
});

/* ------------------------------------------------------------------ *
 * 게이트①-3 심판 보강 — `지정` 경로는 촘촘한데 대칭인 `변경(해제 · DELETE)`이
 * 통째로 비어 있었다. 03b 2차 실측: 지정 쪽 뮤테이션 4개 전부 사망, 해제 쪽 8개 전부 생존.
 * ------------------------------------------------------------------ */

describe('★31 · W2-1 — 해제 실패 처리 (01b D13 · BR-U1-55)', () => {
  it('🔴 실패는 그 자리에 오류 한 줄 + 다시 시도를 덧붙이고, 성공하면 사라진다', async () => {
    // 지정 쪽 대칭 짝(★20)을 해제 경로로 옮긴 것이다. 해제가 실패하는 케이스 자체가 리포
    // 전체에 0건이라, 실패 지선을 통째로 끊는 뮤테이션 5개가 전부 79/79 green이었다
    // (03b 2차 실측). 깨지면 `변경`을 눌러 DELETE가 500을 받아도 **화면이 한 글자도 안
    // 바뀐다** — 다시 눌러도 조용하다. BR-U1-55가 금지하는 침묵 실패(INV-4)다.
    mockUnassignMutate.mockRejectedValue(httpError(500));
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-change-ba-1'));

    await waitFor(() =>
      expect(
        screen.getByTestId('trip-base-change-error-ba-1')
      ).toBeOnTheScreen()
    );
    // 01b D13 — 전면 error 얼굴로 도망가지 않는다. 얼굴을 갈아 끼우면 방금까지 보던 목록을
    // 잃는다(선례: TRIP-208 `StayImportRow`).
    expect(screen.queryByTestId('trip-base-error')).toBeNull();
    expect(screen.getByTestId('trip-base-section-ba-1')).toBeOnTheScreen();

    // 잠금이 풀렸다 — 다시 시도가 실제로 다시 쏜다. 안 풀면 사용자가 영영 못 누른다.
    mockUnassignMutate.mockResolvedValue(undefined);
    fireEvent.press(screen.getByTestId('trip-base-change-retry-ba-1'));
    await waitFor(() => expect(mockUnassignMutate).toHaveBeenCalledTimes(2));

    // 오류 줄이 **사라지는 것까지** 재야 한 바퀴가 닫힌다. 뜨는 것만 재면 "언제나 오류를
    // 그리는" 구현과 구별되지 않고, 재시도 때 옛 오류를 안 지우는 구현도 통과한다.
    await waitFor(() =>
      expect(screen.queryByTestId('trip-base-change-error-ba-1')).toBeNull()
    );
    // 루트 존재 짝(★17) — 오류가 사라진 것이지 행이 사라진 것이 아니다.
    expect(screen.getByTestId('trip-base-section-ba-1')).toBeOnTheScreen();
  });
});

describe('★33 · W2-2 — 해제 연타 잠금 두 겹 (01b D12)', () => {
  it('🔴 리렌더가 끼지 않는 같은 틱 두 번에도 DELETE는 1회이고, 그동안 버튼이 잠긴다', async () => {
    // 지정 쪽 ★25의 해제 판. 두 press를 **하나의 바깥 `act()`로 감싸면** 안쪽 act가 flush를
    // 바깥으로 미뤄 두 누름 사이에 리렌더가 없다 — 실기기에서 한 프레임 안에 두 번 탭한
    // 것과 같은 상태다(게이트①-2에서 전용 프로브로 실검증했다).
    //
    // 깨지면: DELETE가 두 번 나가고 둘째가 404를 받는다(그 엔드포인트 응답은 204/404
    // 둘뿐이고 `useUnassignBase`는 404를 접지 않는다) → **해제는 성공했는데 `해제하지
    // 못했어요`가 뜬다.**
    mockUnassignMutate.mockReturnValue(new Promise(() => {}));
    render(<TripNewStep2Page />);

    const change = screen.getByTestId('trip-base-change-ba-1');
    act(() => {
      fireEvent.press(change);
      fireEvent.press(change);
    });

    expect(mockUnassignMutate).toHaveBeenCalledTimes(1);
    // 두 번째 단언이 다른 것을 잡는다 — 요청 수만 재면 ref가 걸러 주므로 진행 중 표시
    // (`changePending`)를 상수 `false`로 박은 배선이 통과한다(03b 2차 N6 실측).
    expect(screen.getByTestId('trip-base-change-ba-1')).toBeDisabled();
  });
});
