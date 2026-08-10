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
  SavedStay,
} from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep2Page } from './TripNewStep2Page';

/**
 * TRIP-226 g02 **전제 게이트 배선**. 동결된 `TripNewStep2Page.test.tsx`(225 · 33케이스)를
 * 열지 않으려고 형제 파일로 뺐다 — 리포 선례 `KakaoMapView.messages.test.tsx` 분할과 같은 형태.
 *
 * 무엇을 보장하나 — 화면은 이 중 어느 것도 모른다:
 *  - **★1 · AC-2** 좌표 차단은 **두 겹**이다. 화면 `disabled`(형제 파일이 잰다)와 배선 2선.
 *    화면만 잠그면 버튼을 안 거친 경로가 샌다 — 그 경로는 실재한다(아래 케이스가 실물로 몬다).
 *  - **★2 · AC-3** 도장은 `coordConfirmed` **하나**다. `lat`/`lng`가 없다고 막으면 계약에 없는
 *    규칙을 발명한 것이다.
 *  - **★10 · AC-10** 확인 **전에는** 아무것도 안 움직인다 — 요청도, **스토어도**.
 *  - **⭐ ★12 · AC-12** 확장 뒤 **박 번호가 다시 계산된다**(맹점 ④ — 82케이스가 안 재던 자리).
 *  - **★13 · AC-15·16** 404는 "아는 사유"라 문구를 갈라도 되고, 400·422·500은 **한 문구**다.
 *
 * 왜 node 버킷인가: 심판 대상이 "조회 **결과 조합**이 어떤 판정으로 이어지는가"다. 실제 나간
 * 요청은 `useBaseFix.integration.test.tsx`가 따로 본다.
 *
 * ⚠️ `jest.mock` 팩토리는 최상단으로 끌어올려진다. 팩토리가 참조하는 바깥 변수는 이름이
 * `mock`으로 시작해야 예외를 받는다 — **아래 변수 이름을 바꾸지 마라**(리포 확립 규칙).
 * ⚠️ `baseGate.ts`는 **목킹하지 않는다.** 순수 모듈이라 실물을 태워야 "배선이 그 판정을 실제로
 * 쓰는가"가 잡힌다 — 목으로 갈면 배선이 자체 판정을 몰래 다시 짜도 통과한다.
 * ⚠️ 모든 "막힌다"는 `toBeDisabled()` + 실제 `press` + 핸들러 0회 **3단**이다(★12).
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
const routerMock = require('expo-router').router as { push: jest.Mock };

const mockAssignMutate = jest.fn();
const mockFixMutate = jest.fn();
const mockExtendMutate = jest.fn();

/** TanStack이 돌려주는 것 중 이 배선이 **실제로 읽는** 넷만 흉내낸다 — 전체를 흉내내면
 * 목이 실물보다 관대해져 심판이 무뎌진다. */
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
  useAssignBase: () => ({ mutateAsync: mockAssignMutate }),
  useUnassignBase: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('@/features/trip/model/useBaseFix', () => ({
  useFixSavedStay: () => ({ mutateAsync: mockFixMutate }),
  useExtendTripPeriod: () => ({ mutateAsync: mockExtendMutate }),
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

function loaded<T>(data: T): QueryStub<T> {
  return { data, isPending: false, isError: false, refetch: jest.fn() };
}

/** 실패 응답. `isAxiosError`가 true여야 배선의 상태 코드 분기가 도는 경로를 탄다
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

/** 여행 기간 밖 숙소 하나만 후보로 둔 상태 — 확장 흐름의 공통 준비다. */
function outOfPeriodStay(over: Partial<SavedStay> = {}): SavedStay {
  return stay({
    savedStayId: 'stay-b',
    name: '광안리 뷰 호텔',
    checkIn: '2026-06-14',
    checkOut: '2026-06-16',
    ...over,
  });
}

beforeEach(() => {
  // 모듈 싱글턴 스토어를 되돌린다 — 안 하면 앞 테스트가 남긴 값이 뒤 테스트의 판정을 뒤집는다.
  useTripWizardStore.getState().reset();
  useTripWizardStore.getState().setPeriod(undefined, TRIP_START, TRIP_END);
  useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
  // `EditTripRequest`가 `destinations`를 필수로 요구한다 — 확장 요청 본문의 출처다.
  useTripWizardStore.getState().addDestination('부산', 3);

  [routerMock.push, mockAssignMutate, mockFixMutate, mockExtendMutate].forEach(
    (fn) => fn.mockClear()
  );

  mockAssignMutate.mockResolvedValue(undefined);
  mockFixMutate.mockResolvedValue(undefined);
  mockExtendMutate.mockResolvedValue(undefined);

  mockSavedStaysResult = loaded([stay()]);
  mockBasesResult = loaded([]);
  mockCoverageResult = loaded({ blocked: false, days: [] });
});

describe('AC-1 · ★2 — 좌표 도장 하나로만 가른다 (BR-U1-22 · INV-U1-08)', () => {
  it('🔴 coordConfirmed:false면 사유를 보이고 요청이 안 나간다', () => {
    mockSavedStaysResult = loaded([
      stay({ savedStayId: 'stay-b', coordConfirmed: false }),
    ]);
    render(<TripNewStep2Page />);

    expect(
      screen.getByTestId('trip-base-assign-blocked-stay-b')
    ).toHaveTextContent('지도에서 위치를 확인해 주세요');

    const button = screen.getByTestId('trip-base-assign-stay-b');
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(mockAssignMutate).not.toHaveBeenCalled();
  });

  it('🔴 ★2 짝 — coordConfirmed:true면 lat/lng가 없어도 막지 않는다 (AC-3)', async () => {
    // 계약이 요구하는 도장은 `coordConfirmed` 하나다 — openapi의 그 필드 설명이 문자 그대로
    // `false면 거점 배정 불가(INV-U1-08)`다. 좌표값 유무를 조건에 더하면 **계약에 없는 규칙을
    // 발명한 것**이고, 정상 픽스처는 좌표가 다 있어서 다른 케이스가 전부 통과한다.
    mockSavedStaysResult = loaded([
      stay({ savedStayId: 'stay-b', lat: null, lng: null }),
    ]);
    render(<TripNewStep2Page />);

    expect(screen.queryByTestId('trip-base-assign-blocked-stay-b')).toBeNull();
    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));

    await waitFor(() => expect(mockAssignMutate).toHaveBeenCalledTimes(1));
  });
});

describe('★1 · AC-2 — 페일클로즈 2선 (배선도 스스로 문을 잠근다)', () => {
  /**
   * 도달 경로가 실재한다(02a §2-d 프로브 실측). 지정에 실패해 인라인 오류가 떠 있는 동안
   * 목록이 갱신되면, 화면 버튼은 잠기지만 **재시도 버튼은 남는다** — 그 재시도가 배선의
   * `assign()`을 그대로 다시 부른다. 화면만 잠근 구현은 여기서 요청을 흘린다.
   *
   * RESUME B-6이 *"2차 방어선이 무심판 · 오늘 도달 경로 없음(참고 등급)"*으로 남긴 자리에
   * 경로를 찾아 붙인 것이다.
   */
  async function failThenRefreshList(next: SavedStay): Promise<void> {
    mockAssignMutate.mockRejectedValue(httpError(500));
    mockSavedStaysResult = loaded([stay({ savedStayId: 'stay-b' })]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));
    await act(async () => {});
    // 앵커 — 재시도 어포던스가 실제로 떴다(없으면 아래 press가 무엇을 재는지 모른다).
    expect(
      screen.getByTestId('trip-base-assign-retry-stay-b')
    ).toBeOnTheScreen();

    // 목록이 서버에서 갱신됐다. 스토어를 건드려 리렌더를 유발한다.
    mockSavedStaysResult = loaded([next]);
    act(() => {
      useTripWizardStore.getState().setPeriod(undefined, TRIP_START, TRIP_END);
    });
    mockAssignMutate.mockClear();
    mockAssignMutate.mockResolvedValue(undefined);
  }

  it('🔴 좌표가 풀린 뒤 재시도를 눌러도 요청이 나가지 않는다', async () => {
    await failThenRefreshList(
      stay({ savedStayId: 'stay-b', coordConfirmed: false })
    );

    fireEvent.press(screen.getByTestId('trip-base-assign-retry-stay-b'));
    await act(async () => {});

    expect(mockAssignMutate).not.toHaveBeenCalled();
  });

  it('🔴 짝 — 날짜가 사라진 뒤에도 같다 (225 구현의 회귀 가드)', async () => {
    // 이쪽은 225가 이미 무는 축이라 지금도 green이다. 그 두 줄이 지워지면 여기서 red가 난다.
    await failThenRefreshList(
      stay({ savedStayId: 'stay-b', checkIn: null, checkOut: null })
    );

    fireEvent.press(screen.getByTestId('trip-base-assign-retry-stay-b'));
    await act(async () => {});

    expect(mockAssignMutate).not.toHaveBeenCalled();
  });

  it('🔴 짝 — 멀쩡한 숙소로 갱신되면 재시도가 실제로 다시 쏜다', async () => {
    // 위 둘만 두면 "재시도를 아예 안 부르는" 구현이 통과하고, 사용자가 영영 못 누른다.
    await failThenRefreshList(stay({ savedStayId: 'stay-b' }));

    fireEvent.press(screen.getByTestId('trip-base-assign-retry-stay-b'));

    await waitFor(() => expect(mockAssignMutate).toHaveBeenCalledTimes(1));
  });
});

describe('AC-14 · 클라 선판정 — 보내기 전에 스스로 검사한다 (01b D5)', () => {
  it('🔴 체크아웃이 체크인보다 빠르면 요청 0건이고 사유가 남는다', () => {
    // 계약상 이런 숙소는 **저장이 가능하다**(BR-U1-26 — 날짜 없이도 저장은 된다). 그래서
    // 목록에 실제로 들어온다. 그냥 보내고 400을 받는 구현은 사유를 설명하지 못한다 —
    // `error.code`에 enum이 없어서다(D5 · 문제로그 2026-08-02).
    mockSavedStaysResult = loaded([
      stay({
        savedStayId: 'stay-b',
        checkIn: '2026-06-12',
        checkOut: '2026-06-11',
      }),
    ]);
    render(<TripNewStep2Page />);

    expect(
      screen.getByTestId('trip-base-assign-blocked-stay-b')
    ).toHaveTextContent('체크아웃이 체크인보다 빨라요');

    const button = screen.getByTestId('trip-base-assign-stay-b');
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(mockAssignMutate).not.toHaveBeenCalled();
  });
});

describe('★19 경계 · AC-9 — 기간 밖은 거르지 않되 경고한다 (D6 · D8 · D17)', () => {
  it('🔴 경고가 상주하고 · 카드는 남고 · 지정 버튼은 활성이다', () => {
    mockSavedStaysResult = loaded([outOfPeriodStay()]);
    render(<TripNewStep2Page />);

    expect(
      screen.getByTestId('trip-base-outofperiod-stay-b')
    ).toHaveTextContent('여행 기간을 벗어나요');
    expect(screen.getByTestId('trip-base-candidate-stay-b')).toBeOnTheScreen();
    // D17 — 거르는 것은 판정이고 판정은 서버 몫이다. 막지도 않는다(D8).
    expect(screen.getByTestId('trip-base-assign-stay-b')).toBeEnabled();
  });

  it('🔴 ★6 짝 — 마지막 날 아침 체크아웃은 기간 안이라 조용히 배정된다 (AC-13 · D6)', async () => {
    // D6이 등호를 포함한 이유가 이 케이스다. 클라 사본이 서버보다 엄하면 **가장 흔한 정상
    // 배정**이 막히고, 사용자는 확장할 필요도 없는 기간 확장을 권유받는다.
    mockSavedStaysResult = loaded([
      stay({
        savedStayId: 'stay-b',
        checkIn: '2026-06-12',
        checkOut: TRIP_END,
      }),
    ]);
    render(<TripNewStep2Page />);

    expect(screen.queryAllByTestId(/^trip-base-outofperiod-/)).toHaveLength(0);
    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));

    await waitFor(() => expect(mockAssignMutate).toHaveBeenCalledTimes(1));
    expect(mockExtendMutate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('trip-base-extendtrip-confirm')).toBeNull();
  });
});

describe('★10 · AC-10 — 확인 전에는 아무것도 움직이지 않는다 (BR-U1-27)', () => {
  it('🔴 지정을 눌러도 PATCH 0건 · 스토어 불변 · POST 0건이고, 질의만 뜬다', () => {
    // 세 부정을 **한 케이스 안에서** 잰다. 하나만 재면 나머지 둘이 샌다. 특히 스토어는
    // 네트워크를 안 타서 **요청 수 단언으로는 절대 안 잡힌다.**
    mockSavedStaysResult = loaded([outOfPeriodStay()]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));

    // 앵커 — 아무 일도 안 난 것이 아니라 **질의가 떴다**.
    expect(
      screen.getByTestId('trip-base-extendtrip-confirm')
    ).toBeOnTheScreen();

    expect(mockExtendMutate).not.toHaveBeenCalled();
    expect(mockAssignMutate).not.toHaveBeenCalled();
    expect(useTripWizardStore.getState().startDate).toBe(TRIP_START);
    expect(useTripWizardStore.getState().endDate).toBe(TRIP_END);
  });

  it('🔴 짝 — 취소하면 질의가 걷히고 셋 다 그대로다', () => {
    // 취소가 없으면 질의가 아니라 통보다(BR-U1-27은 "여부를 묻는다"까지가 원문이다).
    mockSavedStaysResult = loaded([outOfPeriodStay()]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));
    fireEvent.press(screen.getByTestId('trip-base-extendtrip-cancel'));

    expect(screen.queryByTestId('trip-base-extendtrip-confirm')).toBeNull();
    // 루트 존재 앵커(★17) — 카드는 그대로 있고 질의만 걷혔다.
    expect(screen.getByTestId('trip-base-candidate-stay-b')).toBeOnTheScreen();
    expect(mockExtendMutate).not.toHaveBeenCalled();
    expect(mockAssignMutate).not.toHaveBeenCalled();
    expect(useTripWizardStore.getState().startDate).toBe(TRIP_START);
  });
});

describe('AC-11 · 확인 후 경로 — 순서까지 잰다 (01b D4)', () => {
  it('🔴 PATCH /trips → 스토어 갱신 → POST /bases 순서로 간다', async () => {
    mockSavedStaysResult = loaded([outOfPeriodStay()]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));
    fireEvent.press(screen.getByTestId('trip-base-extendtrip-confirm'));

    await waitFor(() => expect(mockAssignMutate).toHaveBeenCalledTimes(1));

    // ① 확장 요청 — `EditTripRequest`가 세 필드를 전부 필수로 요구한다(생성물 실측).
    //    `destinations`의 출처는 위저드 스토어다.
    expect(mockExtendMutate).toHaveBeenCalledTimes(1);
    expect(mockExtendMutate).toHaveBeenCalledWith({
      tripId: TRIP_ID,
      data: {
        startDate: TRIP_START,
        endDate: '2026-06-16',
        destinations: [{ seq: 1, region: '부산', nights: 3 }],
      },
    });

    // ② 스토어도 함께 갱신됐다 — 안 하면 박 번호가 옛 시작일로 계산된다(맹점 ④).
    expect(useTripWizardStore.getState().endDate).toBe('2026-06-16');

    // ③ 그 **뒤에** 배정이 나갔다. 순서를 안 재면 두 요청을 동시에 쏘는 구현이 통과하고,
    //    서버가 아직 옛 기간을 들고 있어 POST가 400으로 되받는다.
    expect(mockExtendMutate.mock.invocationCallOrder[0]).toBeLessThan(
      mockAssignMutate.mock.invocationCallOrder[0]
    );
    expect(mockAssignMutate).toHaveBeenCalledWith({
      tripId: TRIP_ID,
      data: {
        savedStayId: 'stay-b',
        dateFrom: '2026-06-14',
        dateTo: '2026-06-16',
      },
    });
  });

  it('🔴 ★11 — 확장이 실패하면 배정도 안 나가고 스토어도 안 움직인다', async () => {
    // 부분 진행 금지. `await patch(); await post();`를 `try` 없이 나란히 쓴 구현은 성공
    // 케이스만으로 통과하고, 실패하면 서버가 옛 기간을 들고 있는 채 POST가 날아가 400을 받는다
    // — 사용자는 "확인을 눌렀는데 실패했습니다"만 본다.
    mockExtendMutate.mockRejectedValue(httpError(500));
    mockSavedStaysResult = loaded([outOfPeriodStay()]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));
    fireEvent.press(screen.getByTestId('trip-base-extendtrip-confirm'));
    await act(async () => {});

    expect(mockAssignMutate).not.toHaveBeenCalled();
    expect(useTripWizardStore.getState().endDate).toBe(TRIP_END);
    // 침묵하지 않는다(BR-U1-55 · INV-4) — 실패했다는 사실이 그 카드 자리에 남는다.
    expect(
      screen.getByTestId('trip-base-assign-error-stay-b')
    ).toBeOnTheScreen();
  });
});

describe('⭐ ★12 · AC-12 — 확장 뒤 박 번호가 다시 계산된다 (맹점 ④ · BR-U1-28)', () => {
  it('🔴 시작일이 앞당겨지면 기존 구간 라벨이 새 기준으로 밀린다', async () => {
    // **82케이스 중 이 조합을 재는 것이 0개였다.** 산식은 `firstNight = dateFrom −
    // trip.startDate + 1`이고 `trip.startDate`는 **위저드 스토어** 값이다. `PATCH /trips`만
    // 하고 `setPeriod`를 빠뜨리면 서버 데이터는 맞는데 **화면 라벨이 전부 거짓말한다** —
    // 그리고 그 뮤테이션은 네트워크 단언·스토어 미변경 단언 어디에도 안 걸린다.
    //
    // 시작일이 **앞당겨지는** 방향을 고른 이유: 그때만 기존 배정의 라벨이 움직인다.
    mockBasesResult = loaded([assignment()]); // 6/10~6/12
    mockSavedStaysResult = loaded([
      stay(),
      outOfPeriodStay({ checkIn: '2026-06-08', checkOut: '2026-06-09' }),
    ]);
    render(<TripNewStep2Page />);

    // 앵커 — 확장 전 라벨. 여행 6/10 기준이라 1박째부터 2박째다.
    expect(screen.getByText('1–2박')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));
    fireEvent.press(screen.getByTestId('trip-base-extendtrip-confirm'));
    await waitFor(() => expect(mockAssignMutate).toHaveBeenCalledTimes(1));

    // 여행이 6/08로 앞당겨졌으니 같은 배정이 3박째~4박째가 된다.
    expect(useTripWizardStore.getState().startDate).toBe('2026-06-08');
    expect(screen.getByText('3–4박')).toBeOnTheScreen();
    // 짝 — 옛 라벨이 남아 있지 않다(두 라벨이 동시에 보이는 어중간한 상태가 아니다).
    expect(screen.queryByText('1–2박')).toBeNull();
  });
});

describe('★13 · 서버 실패 — 아는 사유와 모르는 사유를 가른다 (01b D5 · D8)', () => {
  it.each([400, 422, 500])(
    '🔴 %i은 사유를 단정하지 않는 한 문구다 (AC-15)',
    async (status) => {
      // 계약의 `error.code`·`fields[].reason`에 **enum이 없다.** 응답에서 사유를 읽어 문구를
      // 가르는 것은 `TripNewStep1Page.tsx:91-95`가 5-c W-1에서 *"계약이 말하지 않은 원인을
      // 화면이 단정하는 거짓 설명"*으로 판정하고 되돌린 형태다. 셋을 한 문구로 묶는 이 단언이
      // 없으면 그 회귀를 아무도 못 막는다.
      mockAssignMutate.mockRejectedValue(httpError(status));
      mockSavedStaysResult = loaded([stay({ savedStayId: 'stay-b' })]);
      render(<TripNewStep2Page />);

      fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));

      await waitFor(() =>
        expect(
          screen.getByTestId('trip-base-assign-error-stay-b')
        ).toHaveTextContent('지정하지 못했어요')
      );
      // 404와 갈린다 — 이 셋은 목록이 낡았다는 증거가 아니므로 재조회하지 않는다.
      expect(mockSavedStaysResult.refetch).not.toHaveBeenCalled();
    }
  );

  it('🔴 ★14 · AC-16 — 404는 전용 문구를 쓰고 목록만 다시 받아온다', async () => {
    // 404는 **계약이 뜻을 정해 둔** 상태다(BR-U1-56 — 타 계정·삭제된 리소스). 그래서 문구를
    // 갈라도 "단정"이 아니다 — 서버가 말해 준 사유와 클라가 추측한 사유의 경계가 여기다.
    mockAssignMutate.mockRejectedValue(httpError(404));
    mockSavedStaysResult = loaded([stay({ savedStayId: 'stay-b' })]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));

    await waitFor(() =>
      expect(
        screen.getByTestId('trip-base-assign-error-stay-b')
      ).toHaveTextContent('목록에서 사라진 숙소예요')
    );

    // 사정거리 — 낡은 것은 목록뿐이다. 긍정만 두면 "전부 다시 쏘는" 난폭한 구현이 통과해
    // 멀쩡히 그려진 구간·커버리지가 통째로 다시 로딩된다(T4 ★4 · 225 ★28 짝과 같은 계열).
    expect(mockSavedStaysResult.refetch).toHaveBeenCalledTimes(1);
    expect(mockBasesResult.refetch).not.toHaveBeenCalled();
    expect(mockCoverageResult.refetch).not.toHaveBeenCalled();
  });
});

describe('AC-18 · 외부 출처 숙소도 캐시 값 그대로 배정한다 (US-TRIP-04 예외의 가능한 절반)', () => {
  it('🔴 externalSource가 있어도 지정 경로가 같고, 추가 조회가 0건이다', () => {
    // US-TRIP-04 예외의 **나머지 절반**(`최신 정보 확인 불가` 표시)은 `SavedStay` 13필드에
    // 신선도 근거가 없어 미충족이다(02a §9). 가능한 절반을 여기서 박제한다 — "외부 출처가
    // 있으면 다시 조회해 보자"는 구현이 슬쩍 들어오는 것을 막는 자리다.
    mockSavedStaysResult = loaded([
      stay({
        savedStayId: 'stay-b',
        externalSource: 'yanolja',
        externalId: 'ext-77',
      }),
    ]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));

    expect(mockAssignMutate).toHaveBeenCalledWith({
      tripId: TRIP_ID,
      data: {
        savedStayId: 'stay-b',
        dateFrom: '2026-06-10',
        dateTo: '2026-06-12',
      },
    });
    // 외부를 다시 두드리는 경로가 없다 — 저장 숙소는 이미 우리 DB의 값이다.
    expect(mockSavedStaysResult.refetch).not.toHaveBeenCalled();
    expect(mockFixMutate).not.toHaveBeenCalled();
  });
});

describe('AC-7 · AC-8 — 보완 시트가 카드를 실제로 풀어 준다 (01b D1·D3)', () => {
  /** 좌표는 멀쩡하고 날짜만 없는 숙소 — 시트가 지도를 안 띄우는 갈래라(★7 짝)
   * 이 파일은 지도 env 키를 세울 필요가 없다. */
  function datelessStay(): SavedStay {
    return stay({
      savedStayId: 'stay-b',
      name: '광안리 뷰 호텔',
      checkIn: null,
      checkOut: null,
    });
  }

  it('🔴 진입 → 날짜 두 개 선택 → 저장이 PATCH를 부른다', async () => {
    mockSavedStaysResult = loaded([datelessStay()]);
    render(<TripNewStep2Page />);

    // 앵커 — 지금은 막혀 있다.
    expect(screen.getByTestId('trip-base-assign-stay-b')).toBeDisabled();

    fireEvent.press(screen.getByTestId('trip-base-fix-stay-b'));
    expect(screen.getByTestId('trip-base-fixsheet')).toBeOnTheScreen();

    // 날짜 칩은 여행 기간에서 나온다 — 배선이 `tripDayOptions`로 만들어 내린다.
    fireEvent.press(screen.getByTestId('trip-base-fixsheet-day-2026-06-11'));
    // 한쪽만 채운 상태에서는 아직 막힌다(AC-6① — 배선이 게이트를 실제로 계산한다).
    expect(screen.getByTestId('trip-base-fixsheet-save')).toBeDisabled();

    fireEvent.press(screen.getByTestId('trip-base-fixsheet-day-2026-06-12'));

    const save = screen.getByTestId('trip-base-fixsheet-save');
    expect(save).toBeEnabled();
    fireEvent.press(save);

    await waitFor(() => expect(mockFixMutate).toHaveBeenCalledTimes(1));
    // 정확한 전선 모양은 `useBaseFix.integration.test.tsx`가 MSW로 잰다. 여기서는
    // **배선의 의도**(어느 숙소를 어떤 날짜로 고치려 하는가)만 본다.
    expect(mockFixMutate).toHaveBeenCalledWith({
      savedStayId: 'stay-b',
      data: expect.objectContaining({
        name: '광안리 뷰 호텔',
        coordConfirmed: true,
        checkIn: '2026-06-11',
        checkOut: '2026-06-12',
      }),
    });
  });

  it('🔴 AC-7③ — 저장이 성공하면 같은 카드의 지정이 열린다 (D3의 관찰 가능한 형태)', async () => {
    // D3의 본문이 *"저장 성공 = 즉시 지정 가능. '고쳤는데 여전히 막힌다'를 원리적으로
    // 없앤다"*다. 그 "즉시"를 여기서 관찰한다 — 시트가 닫히고, 무효화로 다시 받아온 목록의
    // 값으로 같은 카드가 풀린다.
    mockSavedStaysResult = loaded([datelessStay()]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-fix-stay-b'));
    fireEvent.press(screen.getByTestId('trip-base-fixsheet-day-2026-06-11'));
    fireEvent.press(screen.getByTestId('trip-base-fixsheet-day-2026-06-12'));

    // 서버가 고쳐진 숙소를 돌려준 상태 — 무효화 → 재조회가 끝난 시점이다.
    mockSavedStaysResult = loaded([
      stay({
        savedStayId: 'stay-b',
        name: '광안리 뷰 호텔',
        checkIn: '2026-06-11',
        checkOut: '2026-06-12',
      }),
    ]);
    fireEvent.press(screen.getByTestId('trip-base-fixsheet-save'));
    await act(async () => {});

    // 시트가 닫혔다.
    expect(screen.queryByTestId('trip-base-fixsheet')).toBeNull();
    // 그리고 같은 카드가 실제로 풀렸다 — 사유도 걷혔다.
    expect(screen.getByTestId('trip-base-assign-stay-b')).toBeEnabled();
    expect(screen.queryByTestId('trip-base-assign-blocked-stay-b')).toBeNull();
    // 루트 존재 앵커(★17) — 위 두 `null`이 렌더 실패로 통과한 것이 아니다.
    expect(screen.getByTestId('trip-base-candidate-stay-b')).toBeOnTheScreen();
  });

  it('🔴 AC-8 — 저장이 실패하면 시트가 닫히지 않고 목록도 안 건드린다', async () => {
    mockFixMutate.mockRejectedValue(httpError(400));
    mockSavedStaysResult = loaded([datelessStay()]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-fix-stay-b'));
    fireEvent.press(screen.getByTestId('trip-base-fixsheet-day-2026-06-11'));
    fireEvent.press(screen.getByTestId('trip-base-fixsheet-day-2026-06-12'));
    fireEvent.press(screen.getByTestId('trip-base-fixsheet-save'));

    await waitFor(() =>
      expect(screen.getByTestId('trip-base-fixsheet-error')).toHaveTextContent(
        '저장하지 못했어요'
      )
    );
    // 닫으면 방금 고른 날짜를 전부 잃는다.
    expect(screen.getByTestId('trip-base-fixsheet')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-base-fixsheet-day-2026-06-11')
    ).toBeOnTheScreen();
    // 실패했으므로 목록은 다시 받아올 이유가 없다.
    expect(mockSavedStaysResult.refetch).not.toHaveBeenCalled();
  });

  it('🔴 짝 — 닫기를 누르면 시트만 걷히고 목록은 그대로다', () => {
    mockSavedStaysResult = loaded([datelessStay()]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-fix-stay-b'));
    fireEvent.press(screen.getByTestId('trip-base-fixsheet-close'));

    expect(screen.queryByTestId('trip-base-fixsheet')).toBeNull();
    expect(screen.getByTestId('trip-base-candidate-stay-b')).toBeOnTheScreen();
    expect(mockFixMutate).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * 게이트①-3 심판 보강 — **좌표 축이 배선 층에서 한 번도 안 돌고 있었다.**
 *
 * 위 시트 케이스들이 쓰는 `datelessStay()`는 `coordConfirmed: true`(날짜만 없음)라,
 * 시트가 지도를 안 그리는 갈래(★7 짝)만 탄다. 그래서 배선이 지도에 내려보내는 것
 * (`center`·`mapUnavailable`)과 지도가 올려보내는 것(`onPinDrop`·`onConfirmCoord`), 그리고
 * **시트 저장 게이트의 좌표 축**이 전부 무심판이었다. 03b가 뮤테이션 6개를 심어 확인했고
 * 그중 최악 하나는 리포 전체 1,222케이스가 전원 green이었다:
 *
 *   `TripNewStep2Page.tsx:437`의 `baseBlockReason({ coordConfirmed: fixDraft.coordConfirmed, … })`
 *   에서 `coordConfirmed`를 `true`로 고정 → **좌표 미확정 숙소에서 날짜만 채워도 저장이 열린다.**
 *   저장에 성공하면 시트는 닫히는데 카드는 여전히 `지도에서 위치를 확인해 주세요`로 잠긴다 —
 *   01b D3가 *"원리적으로 없앤다"*고 선언한 바로 그 증상이다.
 *
 * 아래 두 케이스가 **좌표 축을 배선 층에서 끝까지 완주**시킨다(지도 → 핀 → 확인 → 저장).
 *
 * ⚠️ **env 규율(02a §2-a 실측).** `KakaoMapView`는 `EXPO_PUBLIC_KAKAO_MAP_JS_KEY`가 없으면
 * WebView 대신 실패 표면을 그리고, 배선은 그 키로 `mapUnavailable`을 판정한다
 * (`TripNewStep2Page.tsx:453`). 키를 안 세우면 `map-webview` 조회가 throw해서 이 갈래가
 * **원리적으로 못 돈다** — 02a §2-a가 세운 이 규율을 N2 시트 파일에만 적용하고 이 배선
 * 파일에 적용하지 않은 것이 사정거리 구멍의 원인이었다. 아래 describe 안에서만 키를 세워
 * 위 22케이스의 환경을 건드리지 않는다(describe 스코프 `beforeEach`는 그 안의 it에만 돈다).
 * ------------------------------------------------------------------ */

describe('★21 · 좌표 축 완주 — 지도 → 핀 → 확인 → 저장 (01b D2·D3 · INV-U1-08)', () => {
  const ENV_KEY = 'EXPO_PUBLIC_KAKAO_MAP_JS_KEY';
  // computed 접근이 선언과 한 문장이면 eslint-plugin-expo의 no-dynamic-env-var에 걸린다 —
  // 선언과 대입을 분리한다(`KakaoMapView.test.tsx:38-40` 선례).
  let ORIGINAL_ENV: string | undefined;
  ORIGINAL_ENV = process.env[ENV_KEY];

  /** 배선이 대체 중심으로 쓰는 값(`TripNewStep2Page.tsx`의 `FIX_MAP_DEFAULT_CENTER`).
   * 숙소에 좌표가 없을 때 지도를 어디에 놓는지가 계약이다. */
  const FALLBACK_LAT = '37.5665';
  const FALLBACK_LNG = '126.978';
  /** 사용자가 지도에서 찍은 핀. 대체 중심과 **다른 값**이라야 "찍은 좌표가 실려 갔는가"가 갈린다. */
  const PINNED = { lat: 35.1587, lng: 129.1604 };

  /** 좌표만 미확정인 숙소 — 날짜는 여행 기간 안이라 확장 질의가 끼어들지 않는다. */
  function coordlessStay(): SavedStay {
    return stay({
      savedStayId: 'stay-b',
      name: '광안리 뷰 호텔',
      coordConfirmed: false,
      lat: null,
      lng: null,
      checkIn: '2026-06-11',
      checkOut: '2026-06-12',
    });
  }

  /** WebView가 문자열 하나를 보낸 상황을 만든다. `fireEvent`가 아니라 props 직접 호출 +
   * `act`가 리포 정본이다 — `'message'` → `onMessage` 이름 변환이 검증되지 않았다
   * (`KakaoMapView.messages.test.tsx:47-58`의 같은 판단). */
  function dropPin(): void {
    const webview = screen.getByTestId('map-webview');
    act(() => {
      webview.props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'PIN_DROP', ...PINNED }) },
      });
    });
  }

  beforeEach(() => {
    process.env[ENV_KEY] = 'test-js-key';
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = ORIGINAL_ENV;
    }
  });

  it('🔴 지도를 띄우고 · 핀을 받고 · **확인 전에는 저장이 막히고** · 확인 뒤 좌표째 저장한다', async () => {
    mockSavedStaysResult = loaded([coordlessStay()]);
    render(<TripNewStep2Page />);

    // 앵커 — 지금 이 카드는 **좌표 때문에** 막혀 있다(날짜는 멀쩡하다).
    expect(screen.getByTestId('trip-base-assign-stay-b')).toBeDisabled();
    expect(
      screen.getByTestId('trip-base-assign-blocked-stay-b')
    ).toHaveTextContent('지도에서 위치를 확인해 주세요');

    fireEvent.press(screen.getByTestId('trip-base-fix-stay-b'));
    expect(screen.getByTestId('trip-base-fixsheet')).toBeOnTheScreen();

    // ① 지도가 실제로 떴다 — 실패 표면이 아니다. `mapUnavailable`을 항상 `true`로 박은
    //    배선은 여기서 죽는다(그 구현은 좌표를 고칠 길을 영영 안 준다).
    expect(screen.queryByTestId('trip-base-fixsheet-mapfail')).toBeNull();
    expect(screen.getByTestId('map-webview')).toBeOnTheScreen();

    // ② 배선이 내려보낸 중심이 지도 문서에 실려 있다. 숙소에 좌표가 없으므로 대체 중심이다.
    //    `center`를 `{lat:0,lng:0}`으로 박은 배선은 여기서 죽는다 — 사용자가 엉뚱한 바다
    //    한가운데에서 자기 숙소를 찾아야 한다.
    //    *(개념)* `source.html` — `KakaoMapView`가 WebView에 넘기는 지도 문서 문자열.
    //    중심 좌표가 그 안에 `LatLng(위도, 경도)`로 박혀 나간다.
    const mapHtml = screen.getByTestId('map-webview').props.source
      .html as string;
    expect(mapHtml).toContain(FALLBACK_LAT);
    expect(mapHtml).toContain(FALLBACK_LNG);

    // ③ 핀을 찍기 전 — 확정도 저장도 3단으로 막힌다. 확인할 좌표가 없는데 눌리면 반응 없는
    //    버튼이 된다(INV-4).
    const confirmBefore = screen.getByTestId('trip-base-fixsheet-confirmcoord');
    expect(confirmBefore).toBeDisabled();
    fireEvent.press(confirmBefore);
    const saveBeforePin = screen.getByTestId('trip-base-fixsheet-save');
    expect(saveBeforePin).toBeDisabled();
    fireEvent.press(saveBeforePin);
    expect(mockFixMutate).not.toHaveBeenCalled();

    // ④ 지도가 핀 좌표를 올려보냈다 → 그제서야 확정이 열린다.
    dropPin();
    expect(screen.getByTestId('trip-base-fixsheet-confirmcoord')).toBeEnabled();

    // ⑤ ⭐ **핵심.** 핀을 찍었을 뿐 아직 확인은 안 눌렀다 — 저장은 **여전히** 막혀야 한다.
    //    시트 저장 게이트에서 `coordConfirmed`를 `true`로 고정한 배선이 여기서 죽는다
    //    (03b 실측: 그 뮤테이션은 리포 전체 1,222케이스가 전원 green이었다).
    //    깨지면 사용자는 좌표를 확정하지 않은 채 저장에 성공하고, 시트가 닫힌 뒤에도
    //    카드가 `지도에서 위치를 확인해 주세요`로 잠긴 것을 본다 — D3가 *"원리적으로
    //    없앤다"*고 한 바로 그 증상이다.
    const saveAfterPin = screen.getByTestId('trip-base-fixsheet-save');
    expect(saveAfterPin).toBeDisabled();
    fireEvent.press(saveAfterPin);
    expect(mockFixMutate).not.toHaveBeenCalled();

    // ⑥ 확인을 눌러야 비로소 저장이 열리고, **찍은 좌표가 그대로** 실려 나간다.
    //    `onConfirmCoord`가 무동작인 배선은 저장이 영영 안 열려 여기서 죽고,
    //    `onPinDrop`이 좌표를 버리는 배선은 `lat`/`lng`가 `null`로 나가 여기서 죽는다.
    fireEvent.press(screen.getByTestId('trip-base-fixsheet-confirmcoord'));
    const saveOpen = screen.getByTestId('trip-base-fixsheet-save');
    expect(saveOpen).toBeEnabled();
    fireEvent.press(saveOpen);

    await waitFor(() => expect(mockFixMutate).toHaveBeenCalledTimes(1));
    expect(mockFixMutate).toHaveBeenCalledWith({
      savedStayId: 'stay-b',
      data: expect.objectContaining({
        name: '광안리 뷰 호텔',
        coordConfirmed: true,
        lat: PINNED.lat,
        lng: PINNED.lng,
        checkIn: '2026-06-11',
        checkOut: '2026-06-12',
      }),
    });
  });

  it('🔴 짝 — 지도를 띄울 수 없으면 그 사실을 말하고, 저장은 여전히 막힌다 (INV-4)', () => {
    // 위 케이스의 거울. 둘을 같이 두어야 `mapUnavailable`이 **판정**이라는 것이 증명된다 —
    // 하나만 두면 "언제나 지도" 또는 "언제나 실패 표면"인 배선이 통과한다.
    //
    // 이 상태에서는 핀을 찍을 방법 자체가 없어 좌표가 영영 확정되지 않는다. 이유를 안 적으면
    // 회색 저장 버튼만 남고 사용자는 무엇이 부족한지 알 수 없다(BR-U1-55 침묵 실패 금지).
    delete process.env[ENV_KEY];
    mockSavedStaysResult = loaded([coordlessStay()]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-fix-stay-b'));

    expect(screen.getByTestId('trip-base-fixsheet-mapfail')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-webview')).toBeNull();
    expect(screen.queryByTestId('trip-base-fixsheet-confirmcoord')).toBeNull();

    // 저장은 3단으로 막힌다 — 좌표를 확정할 길이 없으니 게이트가 열려서는 안 된다.
    const save = screen.getByTestId('trip-base-fixsheet-save');
    expect(save).toBeDisabled();
    fireEvent.press(save);
    expect(mockFixMutate).not.toHaveBeenCalled();

    // 루트 존재 앵커(★17) — 위 세 `null`이 시트가 통째로 안 떠서 통과한 것이 아니다.
    expect(screen.getByTestId('trip-base-fixsheet')).toBeOnTheScreen();
  });
});
