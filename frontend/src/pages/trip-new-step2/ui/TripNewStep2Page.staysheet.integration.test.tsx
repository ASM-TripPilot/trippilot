import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { BaseAssignment, SavedStay } from '@/shared/api/generated/schemas';
import type { StayAddressState } from '@/features/trip/model/staySheetSections';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { resetPressGuard } from '@/shared/press/pressGuard';

import { TripNewStep2Page } from './TripNewStep2Page';

/**
 * TRIP-673 g02 숙소 선택 시트(S9) — **배선(재연결).** S8 이 no-op stub 으로 둔 박별 카드 탭을
 * 숙소 선택 시트 오픈으로 잇고, 고른 숙소를 그 밤 구간에 POST bases 로 배정한다.
 *
 * 무엇을 보장하나 — 화면·시트는 조회·라우터·구간 계산을 모른다. 배선만 잇는다:
 *  - **카드 탭 → 시트 오픈**(AC-1) `onPressCard(nightNumber)` 가 그 밤 컨텍스트로 시트를 연다.
 *  - **단일밤 구간**(★1) 지정 시 `dateFrom`=밤 ISO(`startDate+(n-1)일`)·`dateTo`=밤+1일. `NightlyBaseCard`엔
 *    `date`(ISO) 필드가 없어(계약 어긋남 ②) startDate+nightNumber 파생이 강제된다. 밤2 를 골라
 *    "항상 startDate" 뮤턴트를 잡는다.
 *  - **지정 콜백 인자**(★3) `useAssignBase.mutate({ tripId, data:{savedStayId,dateFrom,dateTo} }, {onSuccess,onError})`.
 *  - **성공 → 닫힘 / 실패 → 인라인 유지**(AC-4·INV-4).
 *  - **단일 선택 전환**(★2) A→B 선택 시 A 해제·B만 선택(드래프트는 배선 소유).
 *  - **둘러보기**(AC-3) `/stays` push — TRIP-1011 부터 그 밤 지역(region)을 싣는다(#037).
 *  - **TRIP-1011 섹션 분리**(#036 · D8) 저장 숙소를 "{그 밤 지역} 숙소" / "다른 지역"으로 나누되 숨기지 않는다.
 *
 * ⚠️ 실개폐·딤은 `@gorhom/bottom-sheet` 통과형 목이라 jest 사각(★7) — 6-b 실기 전용.
 * ⚠️ `jest.mock` 팩토리는 최상단으로 끌어올려진다 — 참조 바깥 변수는 이름이 `mock` 으로 시작해야
 * 예외를 받는다(리포 확립 규칙, 아래 변수 이름을 바꾸지 마라).
 * ⚠️ 기존 `TripNewStep2Page.test.tsx`(TRIP-672 동결)는 건드리지 않는다 — S9 배선은 이 별 파일로 격리
 * (그쪽 테스트는 카드를 안 눌러 무사, 시트는 openNight=null 초기값이라 미마운트).
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

interface QueryStub<T> {
  data?: T;
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
}

let mockSavedStaysResult: QueryStub<SavedStay[]>;
let mockBasesResult: QueryStub<BaseAssignment[]>;

/** 지정 뮤테이션이 **어떤 variables 로, 어떤 콜백과** 불렸는지 기록하는 창구. */
const mockAssignMutate = jest.fn();
let mockAssignShouldFail = false;

/**
 * S9 in-flight 잠금 검증용 deferred(비해결) 제어(02a ★1). 동기 onSuccess 목은 첫 press 가
 * 시트를 닫아 이중탭·pending 을 재현조차 못 한다 — 그래서 콜백을 붙잡아 두는 모드를 둔다.
 *  - `false`  : 기존 동기 동작(I1~I6 무회귀 — onSuccess/onError 즉시 호출).
 *  - `'silent'`: 콜백만 붙잡고 `isPending` 불변 → 버튼이 안 잠겨 **ref 가드만** 이중탭을 막는다(AC-S9-1).
 *  - `'pending'`: 붙잡고 `isPending:true` 재렌더 → assignPending 이 버튼을 disable(AC-S9-2·S9-3).
 */
let mockAssignDefer: false | 'silent' | 'pending' = false;
/** 비해결로 붙잡은 지정 콜백 — 테스트가 나중에 성공(resolve)/실패(reject)로 푼다(AC-S9-3). */
const mockHeldAssigns: { resolve: () => void; reject: () => void }[] = [];

jest.mock('@/features/trip/model/useSavedStays', () => ({
  useSavedStays: () => mockSavedStaysResult,
}));

/**
 * TRIP-1011 — 저장 숙소 주소 조회 훅 목. 실물은 react-query 라 QueryClientProvider 가 없는 이 파일에선
 * 못 돈다(useSavedStays 선례처럼 모듈 경로를 바꿔 끼운다). **받은 숙소 목록으로부터** 결과를 만든다 —
 * 배선이 숙소 목록을 넘기지 않으면(빈 배열) 주소도 비어 섹션이 안 생긴다. 기본값은 빈 표 = 전부 "모름".
 */
let mockAddressById: Record<string, StayAddressState> = {};
jest.mock('@/features/trip/model/useStayAddresses', () => ({
  useStayAddresses: (stays: { savedStayId: string }[]) =>
    Object.fromEntries(
      stays
        .filter((stay) => mockAddressById[stay.savedStayId] !== undefined)
        .map((stay) => [stay.savedStayId, mockAddressById[stay.savedStayId]])
    ),
}));

jest.mock('@/features/trip/model/useTripBases', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    useTripBases: () => mockBasesResult,
    // 지정 성공/실패 분기는 mutate 콜백-옵션(onSuccess/onError)으로 관측한다(firm 계약).
    // isPending 은 react-query 처럼 useState 로 흉내낸다 — mutate 후 상태가 바뀌어야 다음 렌더에 반영된다.
    useAssignBase: () => {
      const [pending, setPending] = React.useState(false);
      return {
        isPending: pending,
        isError: false,
        mutate: (
          variables: unknown,
          options?: { onSuccess?: () => void; onError?: (e: unknown) => void }
        ) => {
          mockAssignMutate(variables, options);
          if (mockAssignDefer !== false) {
            // 비해결 — 콜백을 붙잡아 시트를 열어 둔 채 나중에 테스트가 푼다.
            if (mockAssignDefer === 'pending') setPending(true);
            mockHeldAssigns.push({
              resolve: () => {
                setPending(false);
                options?.onSuccess?.();
              },
              reject: () => {
                setPending(false);
                options?.onError?.(new Error('400'));
              },
            });
            return;
          }
          if (mockAssignShouldFail) options?.onError?.(new Error('400'));
          else options?.onSuccess?.();
        },
      };
    },
  };
});

const TRIP_ID = 'trip-1';
const TRIP_START = '2026-06-10';
const TRIP_END = '2026-06-13';

/** 후보 A — 날짜 有(체크인/아웃). */
const STAY_A: SavedStay = {
  savedStayId: 'stay-a',
  name: '해운대 오션 호텔',
  coordConfirmed: true,
  linkedTripIds: [],
  checkIn: '2026-06-10',
  checkOut: '2026-06-13',
  registerRoute: 'MAP_SEARCH',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

/** 후보 B — 날짜 無·좌표 미확정(밤이 날짜를 공급하므로 선택 가능, D3). */
const STAY_B: SavedStay = {
  savedStayId: 'stay-b',
  name: '감천문화마을 게스트하우스',
  coordConfirmed: false,
  linkedTripIds: [],
  checkIn: null,
  checkOut: null,
  registerRoute: 'MAP_SEARCH',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

function loaded<T>(data: T): QueryStub<T> {
  return { data, isPending: false, isError: false, refetch: jest.fn() };
}

/** 위저드 드래프트를 다시 심는다(기간·여행지). 파일 최상위 beforeEach 가 먼저 reset 하므로 누수 없음. */
function seedDraft(
  startDate: string,
  endDate: string,
  destinations: [string, number][]
): void {
  const store = useTripWizardStore.getState();
  store.reset();
  store.setCreatedTripId(TRIP_ID);
  destinations.forEach(([region, nights]) =>
    store.addDestination(region, nights)
  );
  // 기간은 여행지 **뒤에** 그대로 적는다 — TRIP-1027부터 시작이 있으면 담을 때마다 끝이 "시작 +
  // 박수 합"으로 다시 계산되므로, 기간 > 박수 합(서버·옛 상태)을 만들려면 이 순서여야 한다.
  store.setPeriod(undefined, startDate, endDate);
}

/**
 * push 인자에서 `/stays` 로 실은 region 값을 꺼낸다 — 문자열(`/stays?region=…`)과 객체
 * (`{ pathname: '/stays', params: { region } }`) 두 형태를 다 읽는다. `/stays` 가 아니면 undefined.
 * URLSearchParams 는 RN jest 환경의 폴리필에 기대지 않으려고 손으로 가른다.
 */
function staysRegionOf(call: unknown[] | undefined): string | undefined {
  const arg = call?.[0];
  if (typeof arg === 'string') {
    const [path, query = ''] = arg.split('?');
    if (path !== '/stays') return undefined;
    const pair = query
      .split('&')
      .map((part) => part.split('='))
      .find(([key]) => key === 'region');
    return pair?.[1] === undefined ? undefined : decodeURIComponent(pair[1]);
  }
  if (typeof arg === 'object' && arg !== null) {
    const { pathname, params } = arg as {
      pathname?: unknown;
      params?: { region?: unknown };
    };
    if (pathname !== '/stays') return undefined;
    return typeof params?.region === 'string' ? params.region : undefined;
  }
  return undefined;
}

/** push 호출 중 목적지가 `/stays` 인 것(문자열 경로 또는 객체 pathname)만 고른다. */
function staysCalls(): unknown[][] {
  return routerMock.push.mock.calls.filter((call: unknown[]) => {
    const arg = call[0];
    if (typeof arg === 'string') return arg.split('?')[0] === '/stays';
    return (
      typeof arg === 'object' &&
      arg !== null &&
      (arg as { pathname?: unknown }).pathname === '/stays'
    );
  });
}

beforeEach(() => {
  // TRIP-1013 — 연타 가드의 400ms 창은 모듈 전역이라 앞 테스트의 "지정" 누름이 새지 않게 닫는다.
  resetPressGuard();
  useTripWizardStore.getState().reset();
  useTripWizardStore.getState().setPeriod(undefined, TRIP_START, TRIP_END);
  useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
  // 부산 2박 + 경주 1박 = 3밤. 밤1·2 부산 / 밤3 경주.
  useTripWizardStore.getState().addDestination('부산', 2);
  useTripWizardStore.getState().addDestination('경주', 1);

  routerMock.push.mockClear();
  routerMock.back.mockClear();
  routerMock.replace.mockClear();
  mockAssignMutate.mockClear();
  mockAssignShouldFail = false;
  mockAssignDefer = false;
  mockHeldAssigns.length = 0;
  mockAddressById = {};

  // 배정 0 — 세 밤 모두 "숙소 미정". 후보는 저장 숙소 두 곳.
  mockSavedStaysResult = loaded([STAY_A, STAY_B]);
  mockBasesResult = loaded<BaseAssignment[]>([]);
});

describe('I1 · 카드 탭 → 시트 오픈 (AC-1 재연결)', () => {
  it('탭 전엔 시트가 없고, 밤2 카드를 누르면 그 밤 컨텍스트로 시트가 열린다', () => {
    render(<TripNewStep2Page />);

    // 재연결 전 — 시트는 트리에 없다.
    expect(screen.queryByTestId('trip-base-staysheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));

    const sheet = screen.getByTestId('trip-base-staysheet');
    // 밤2 = 6/11(목)·부산 (node 로 실측한 값 — 브리프 손베낌 아님).
    expect(sheet).toHaveTextContent(/6\/11\(목\) 밤/);
    expect(sheet).toHaveTextContent(/부산/);
  });
});

describe('I2 · 지정 커밋 구간 (AC-4 · ★1 단일밤 · ★3 인자)', () => {
  it('밤2 지정 시 {savedStayId, dateFrom=밤 ISO, dateTo=밤+1일} 로 mutate 한다', () => {
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-cand-stay-b'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));

    expect(mockAssignMutate).toHaveBeenCalledTimes(1);
    // 밤2 ISO = startDate + 1일 = 2026-06-11, dateTo = +1일 = 2026-06-12 (실측).
    // dateTo=date · +2일 · dateFrom 오프셋 뮤턴트는 전부 이 완전일치에서 red.
    expect(mockAssignMutate.mock.calls[0][0]).toEqual({
      tripId: TRIP_ID,
      data: {
        savedStayId: 'stay-b',
        dateFrom: '2026-06-11',
        dateTo: '2026-06-12',
      },
    });
  });
});

describe('I3 · 성공 → 시트 닫힘 (AC-4)', () => {
  it('지정 성공 시 시트를 닫는다', () => {
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-cand-stay-a'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));

    expect(screen.queryByTestId('trip-base-staysheet')).toBeNull();
  });
});

describe('I4 · 실패 → 인라인 · 시트 유지 (AC-4 · INV-4)', () => {
  it('POST 실패면 인라인 오류를 세우고 시트를 닫지 않는다 (침묵 금지)', () => {
    mockAssignShouldFail = true;
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-cand-stay-a'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));

    expect(screen.getByTestId('trip-base-staysheet-error')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-staysheet')).toBeOnTheScreen();
  });
});

describe('I5 · 단일 선택 전환 (AC-2 · ★2)', () => {
  it('A→B 선택 시 A 는 해제되고 B 만 선택된다 (드래프트는 배선 소유)', () => {
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));

    fireEvent.press(screen.getByTestId('trip-base-staysheet-cand-stay-a'));
    expect(
      screen.getByTestId('trip-base-staysheet-cand-stay-a')
    ).toBeSelected();
    expect(
      screen.getByTestId('trip-base-staysheet-cand-stay-b')
    ).not.toBeSelected();

    fireEvent.press(screen.getByTestId('trip-base-staysheet-cand-stay-b'));
    expect(
      screen.getByTestId('trip-base-staysheet-cand-stay-b')
    ).toBeSelected();
    expect(
      screen.getByTestId('trip-base-staysheet-cand-stay-a')
    ).not.toBeSelected();
  });
});

// TRIP-1011(#037) — 옛 단언 `toHaveBeenCalledWith('/stays')`(지역 없이 → 검색 화면 기본값 '부산')는 D8 과
// 정반대라 교체했다. 인자 형태가 아니라 **region 값**을 잰다(브리프 AC-1).
describe('I6 · 둘러보기 라우트 (AC-3 · TRIP-1011 AC-1)', () => {
  it('서울특별시 1곳 여행의 1박 시트에서 둘러보기 → region=서울특별시 로 /stays push', () => {
    seedDraft('2026-09-26', '2026-09-27', [['서울특별시', 1]]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-night-card-1'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-browse'));

    expect(routerMock.push).toHaveBeenCalledTimes(1);
    expect(staysRegionOf(routerMock.push.mock.calls[0])).toBe('서울특별시');
  });
});

/**
 * TRIP-677 · S9 지정 in-flight 잠금 복원 — S8 재작성에서 드롭된 beginLock/isPending-disable 을
 * 되살린다. 무엇을 보장하나: 서버 응답 전 재탭이 잉여 POST 를 만들지 않고, 응답 뒤엔 잠금이 풀린다.
 *
 * ⚠️ deferred(비해결) 목이 이 스위트의 전제다(02a ★1) — 동기 onSuccess 목은 첫 press 가 시트를 닫아
 * 이중탭·pending 을 재현조차 못 한다. 위 목 확장(`mockAssignDefer`·`mockHeldAssigns`)이 그 창을 연다.
 */
describe('S9L · 지정 in-flight 잠금 (AC-S9-1·S9-2·S9-3)', () => {
  /** 밤2 카드를 눌러 시트를 열고 후보를 하나 고른 상태로 만든다. */
  function openAndSelect(stayId: string): void {
    render(<TripNewStep2Page />);
    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));
    fireEvent.press(screen.getByTestId(`trip-base-staysheet-cand-${stayId}`));
  }

  it('AC-S9-1 · 미해결 지정 중 "지정"을 연속 2번 눌러도 mutate 는 정확히 1회다 (useRef 진입 가드)', () => {
    // 'silent' — isPending 을 안 켜 버튼이 안 잠긴다. 둘째 press 를 막는 것은 오직 useRef 가드다
    // ('pending' 이면 disable 이 가드를 가려 ref 제거→red 가 성립 안 한다, 02a ★1·★6).
    mockAssignDefer = 'silent';
    openAndSelect('stay-a');

    const assign = screen.getByTestId('trip-base-staysheet-assign');
    fireEvent.press(assign);
    // TRIP-1013 — 연타 가드 창을 닫아, 둘째 press 를 막는 것이 ref 가드뿐인 상황을 유지한다.
    resetPressGuard();
    fireEvent.press(assign);

    // ref 가드가 없으면 둘째 press 도 mutate 를 쏴 2회가 된다(잉여 POST).
    expect(mockAssignMutate).toHaveBeenCalledTimes(1);
  });

  it('AC-S9-2 · 지정 진행 중이면 "지정" 버튼이 disabled 라 재탭이 발화하지 않는다 (isPending → assignPending)', () => {
    // 'pending' — mutate 후 isPending true 로 재렌더 → assignPending 이 버튼을 잠근다.
    mockAssignDefer = 'pending';
    openAndSelect('stay-a');

    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
    expect(mockAssignMutate).toHaveBeenCalledTimes(1);

    // 색만 흐린 가짜가 아니라 진짜 disabled 여야 재탭이 안 먹는다(disabled prop 3단).
    expect(screen.getByTestId('trip-base-staysheet-assign')).toBeDisabled();
    resetPressGuard(); // TRIP-1013 — 막는 것이 disabled 뿐인 상황을 유지한다.
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
    expect(mockAssignMutate).toHaveBeenCalledTimes(1);
  });

  it('AC-S9-3 · 성공으로 풀리면(onSuccess) 잠금이 풀려 다른 밤에서 다시 지정된다', async () => {
    mockAssignDefer = 'pending';
    openAndSelect('stay-a');
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
    expect(mockAssignMutate).toHaveBeenCalledTimes(1);

    // 성공으로 푼다 → onSuccess=closeSheet 로 시트가 닫히고 잠금·isPending 이 풀려야 한다.
    await act(async () => {
      mockHeldAssigns[0].resolve();
    });
    expect(screen.queryByTestId('trip-base-staysheet')).toBeNull();

    // TRIP-1013 — 사람이 연타 가드 창(400ms) 밖에서 다시 누른 것과 같게 창을 닫는다.
    resetPressGuard();
    // 다른 밤(밤3)에서 다시 지정 — 잠금 리셋을 빠뜨리면 여기서 mutate 가 안 나가 1회에 머문다.
    fireEvent.press(screen.getByTestId('trip-base-night-card-3'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-cand-stay-b'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));

    expect(mockAssignMutate).toHaveBeenCalledTimes(2);
  });

  it('AC-S9-3b · 실패로 풀려도(onError) 잠금이 풀려 같은 시트에서 다시 지정된다 (영구 잠김 방지)', async () => {
    mockAssignDefer = 'pending';
    openAndSelect('stay-a');
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
    expect(mockAssignMutate).toHaveBeenCalledTimes(1);

    // 실패로 푼다 → 시트는 열린 채 인라인 오류가 서고(INV-4), 잠금·isPending 이 풀려야 한다.
    await act(async () => {
      mockHeldAssigns[0].reject();
    });
    expect(screen.getByTestId('trip-base-staysheet')).toBeOnTheScreen();

    // TRIP-1013 — 사람이 연타 가드 창(400ms) 밖에서 다시 누른 것과 같게 창을 닫는다.
    resetPressGuard();
    // 재시도 — onError 에서 잠금을 안 풀면 영구 잠김이라 여기서 mutate 가 안 나간다.
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
    expect(mockAssignMutate).toHaveBeenCalledTimes(2);
  });
});

/** 가드 판정용으로 멈춰 둘 시각(값 자체는 의미 없다 — 흐르지 않는 것이 요점). */
const FROZEN_NOW = 1_790_000_000_000;

/**
 * TRIP-1013 #038 — 거점 시트 '지정' 연타의 두 번째 탭이, 지정 성공으로 시트가 사라진 뒤 드러난
 * '이 거점으로 일정 만들기'(`trip-base-generate`)를 누르지 않는다(실기에서는 2/4 를 확인 없이 지나갔다).
 *
 * 시트는 성공 콜백에서 조건부 렌더로 즉시 빠진다(닫힘 애니메이션·`onClose` 없음) — 그래서 기준점은
 * 시트 닫힘 이벤트가 아니라 누름·성공 시각이다. "창 밖"은 `resetPressGuard()`로 만든다.
 */
describe('AC-038 · 지정 성공으로 시트가 사라진 직후, 창 안의 뒤 CTA 는 무시된다', () => {
  // 시계를 멈춘다 — 화면을 그리고 응답을 기다리는 동안 실제 시간이 흘러 "창 안"이 400ms 를 넘기면
  // 판정이 흔들린다(02a ★2). "창 밖"은 resetPressGuard() 로만 만든다.
  let clock: jest.SpyInstance;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  });
  afterEach(() => clock.mockRestore());

  /** 방식 선택(h04)으로 가는 replace 만 센다. */
  function methodReplaces(): unknown[] {
    return routerMock.replace.mock.calls.filter(
      (call: unknown[]) =>
        (call[0] as { pathname?: string } | undefined)?.pathname ===
        '/trips/[tripId]/itinerary/method'
    );
  }

  /** 밤2 시트를 열고 후보를 고른 뒤 '지정'을 누른다(첫 탭). */
  function assignNight2(): void {
    render(<TripNewStep2Page />);
    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-cand-stay-a'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
  }

  /** 창이 닫힌 뒤(=사람이 다시 누름) 뒤 CTA 가 방식 선택으로 정확히 1회 replace 한다 — 앞의
   * "0회"가 공짜 통과가 아니라는 긍정 앵커를 겸한다. */
  function expectGenerateWorksAfterWindow(): void {
    resetPressGuard();
    fireEvent.press(screen.getByTestId('trip-base-generate'));

    expect(methodReplaces()).toHaveLength(1);
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/method',
      params: { tripId: TRIP_ID },
    });
  }

  it('창 안의 "이 거점으로 일정 만들기"는 방식 선택 이동이 0회이고, 창이 지난 뒤 한 번 누르면 정확히 1회다', () => {
    // 실행 ① — 첫 탭(지정). 기본 목은 즉시 성공 → 시트가 사라진다.
    assignNight2();
    // 앵커 — 첫 탭은 제 할 일을 했다(지정 1회, 시트 사라짐).
    expect(mockAssignMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('trip-base-staysheet')).toBeNull();

    // 실행 ② — 드러난 뒤 CTA 에 떨어진 두 번째 탭.
    fireEvent.press(screen.getByTestId('trip-base-generate'));

    // 단언 — 무시된다.
    expect(methodReplaces()).toHaveLength(0);
    // 무회귀 — 창이 지난 뒤의 한 번은 정상 동작한다.
    expectGenerateWorksAfterWindow();
  });

  it('01b Q2 · 지정 응답이 창(400ms)보다 늦어도, 시트가 사라지는 순간 창이 다시 열려 무시된다', async () => {
    mockAssignDefer = 'silent';
    assignNight2();
    // 첫 탭의 창이 닫힐 만큼 응답이 늦었다(=400ms 이상 흐름).
    resetPressGuard();

    await act(async () => {
      mockHeldAssigns[0].resolve();
    });
    expect(screen.queryByTestId('trip-base-staysheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-base-generate'));

    expect(methodReplaces()).toHaveLength(0);
    expectGenerateWorksAfterWindow();
  });
});

/**
 * TRIP-1011(#037 · 브리프 AC-3) — 다지역 여행의 "채운 밤"(TRIP-1010 규칙: 박수 합 밖의 밤은 마지막 여행지)
 * 에서도 그 밤 지역이 실린다. 첫 여행지(`destinations[0]`)를 싣는 구현을 이 케이스가 잡는다.
 */
describe('TRIP-1011 AC-3 · 둘러보기에 그 밤 지역이 실린다 (부산 기본값 금지)', () => {
  it('[서울특별시 1박, 강릉시 1박] + 기간 3박 → 3번째(채운) 밤 시트의 둘러보기 region=강릉시', () => {
    seedDraft('2026-06-10', '2026-06-13', [
      ['서울특별시', 1],
      ['강릉시', 1],
    ]);
    render(<TripNewStep2Page />);

    // 앵커 — 3번째 밤이 실제로 강릉시 카드다(1010 채움 규칙이 살아 있어야 이 케이스가 의미를 갖는다).
    expect(screen.getByTestId('trip-base-night-card-3')).toHaveTextContent(
      /강릉시/
    );

    fireEvent.press(screen.getByTestId('trip-base-night-card-3'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-browse'));

    expect(staysCalls()).toHaveLength(1);
    expect(staysRegionOf(staysCalls()[0])).toBe('강릉시');
  });

  it('region 없이 /stays 로 가는 push 가 0회다 (밤 두 개를 오가며 눌러도)', () => {
    seedDraft('2026-06-10', '2026-06-12', [
      ['서울특별시', 1],
      ['강릉시', 1],
    ]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-night-card-1'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-browse'));
    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-browse'));

    // 앵커 — 실제로 두 번 /stays 로 갔다(0회라서 "지역 없는 호출 0"이 공짜로 통과하는 것을 막는다).
    expect(staysCalls()).toHaveLength(2);
    expect(staysCalls().map((call) => staysRegionOf(call))).toEqual([
      '서울특별시',
      '강릉시',
    ]);
  });
});

/**
 * 후보 카드 **루트**만 고르는 testID 패턴. `SavedStayCard`는 루트 밑에 `{루트}-photo`·`-photo-placeholder`·
 * `-base-badge` 하위 testID를 더 달아서, 접두만 보는 `/^trip-base-staysheet-cand-/`는 카드 한 장을 두 번
 * 센다(실측 3장 → 6). 개수를 셀 때는 이 패턴을 쓴다.
 */
const CARD_ROOT =
  /^trip-base-staysheet-cand-(?!.*-(photo|photo-placeholder|base-badge)$)/;

/**
 * TRIP-1011(#036 · D8 · 브리프 AC-4·AC-6 · 01b Q2·Q3·Q5) — 시트 섹션 분리 배선.
 *
 * 준비: 서울 1박 여행 + QA 재현 저장 숙소 4곳(JW메리어트 동대문 1 · 부산 3). 주소는 훅 목이 준다
 * (`mockAddressById`). 실행: 1박 카드를 눌러 시트를 연다. 단언: 섹션 컨테이너 안의 카드 수·헤더 문구.
 */
describe('TRIP-1011 AC-4 · 시트가 "그 밤 지역 숙소" / "다른 지역"으로 나뉜다 (숨김 없음)', () => {
  const JW: SavedStay = {
    ...STAY_A,
    savedStayId: 'jw',
    name: 'JW 메리어트 동대문',
    lat: 37.57,
    lng: 127.009,
  };
  const DENBA: SavedStay = {
    ...STAY_A,
    savedStayId: 'denba',
    name: '덴바스타 구서점',
    lat: 35.26,
    lng: 129.09,
  };
  const PARA_1: SavedStay = {
    ...STAY_A,
    savedStayId: 'para-1',
    name: '파라다이스호텔부산',
    lat: 35.16,
    lng: 129.164,
  };
  const PARA_2: SavedStay = { ...PARA_1, savedStayId: 'para-2' };

  const SEOUL: StayAddressState = {
    status: 'known',
    address: '서울특별시 종로구 청계천로 279',
  };
  const BUSAN: StayAddressState = {
    status: 'known',
    address: '부산광역시 해운대구 해운대해변로 296',
  };

  function openSeoulNight(): void {
    seedDraft('2026-09-26', '2026-09-27', [['서울특별시', 1]]);
    render(<TripNewStep2Page />);
    fireEvent.press(screen.getByTestId('trip-base-night-card-1'));
  }

  beforeEach(() => {
    mockSavedStaysResult = loaded([DENBA, JW, PARA_1, PARA_2]);
  });

  it('QA 재현 — "서울특별시 숙소"에 JW 1장, "다른 지역"에 3장, 전체 4장 그대로', () => {
    mockAddressById = {
      jw: SEOUL,
      denba: { status: 'known', address: '부산 금정구 구서동 1' },
      'para-1': BUSAN,
      'para-2': BUSAN,
    };
    openSeoulNight();

    const here = screen.getByTestId('trip-base-staysheet-section-here');
    const other = screen.getByTestId('trip-base-staysheet-section-other');
    expect(
      screen.getByTestId('trip-base-staysheet-section-here-title')
    ).toHaveTextContent('서울특별시 숙소');
    expect(
      screen.getByTestId('trip-base-staysheet-section-other-title')
    ).toHaveTextContent('다른 지역');

    expect(
      within(here).getByTestId('trip-base-staysheet-cand-jw')
    ).toBeOnTheScreen();
    expect(within(here).queryAllByTestId(CARD_ROOT)).toHaveLength(1);
    expect(within(other).queryAllByTestId(CARD_ROOT)).toHaveLength(3);
    // fail-open — 전체 후보 수가 4에서 줄지 않는다(숨김 0 · 중복 렌더 0).
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(4);
  });

  it('"다른 지역" 섹션의 숙소를 골라도 지정이 똑같이 나간다 (D8 — 막지 않는다)', () => {
    mockAddressById = { jw: SEOUL, 'para-1': BUSAN, 'para-2': BUSAN };
    openSeoulNight();

    const other = screen.getByTestId('trip-base-staysheet-section-other');
    fireEvent.press(
      within(other).getByTestId('trip-base-staysheet-cand-para-1')
    );
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));

    expect(mockAssignMutate).toHaveBeenCalledTimes(1);
    expect(
      (mockAssignMutate.mock.calls[0][0] as { data: { savedStayId: string } })
        .data.savedStayId
    ).toBe('para-1');
  });

  it('AC-6 · 주소를 모르는 숙소가 섞이면 "다른 지역 · 위치 확인 안 됨"에 모두 보인다', () => {
    const noCoord: SavedStay = {
      ...STAY_A,
      savedStayId: 'no-coord',
      name: '좌표 없는 숙소',
      lat: null,
      lng: null,
    };
    mockSavedStaysResult = loaded([JW, noCoord, PARA_1, PARA_2]);
    mockAddressById = {
      jw: SEOUL,
      'no-coord': { status: 'unknown' }, // 좌표 없음
      'para-1': { status: 'unknown' }, // 주소 null
      'para-2': { status: 'unknown' }, // 503
    };
    openSeoulNight();

    expect(
      screen.getByTestId('trip-base-staysheet-section-other-title')
    ).toHaveTextContent('다른 지역 · 위치 확인 안 됨');
    const other = screen.getByTestId('trip-base-staysheet-section-other');
    expect(within(other).queryAllByTestId(CARD_ROOT)).toHaveLength(3);
    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(4);
  });

  it('AC-6 · 주소 조회가 전부 진행 중이면 섹션 없이 한 줄 목록(4장)', () => {
    mockAddressById = {
      jw: { status: 'loading' },
      denba: { status: 'loading' },
      'para-1': { status: 'loading' },
      'para-2': { status: 'loading' },
    };
    openSeoulNight();

    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(4);
    expect(
      screen.queryAllByTestId(/^trip-base-staysheet-section-/)
    ).toHaveLength(0);
  });

  it('01b Q3 · 전부 그 밤 지역이면 헤더 없이 한 줄 목록', () => {
    mockSavedStaysResult = loaded([JW, { ...JW, savedStayId: 'jw-2' }]);
    mockAddressById = { jw: SEOUL, 'jw-2': SEOUL };
    openSeoulNight();

    expect(screen.getAllByTestId(CARD_ROOT)).toHaveLength(2);
    expect(
      screen.queryAllByTestId(/^trip-base-staysheet-section-/)
    ).toHaveLength(0);
  });

  it('01b Q5 · "그 밤 지역"은 여행 첫 지역이 아니라 연 밤의 지역이다 (강릉 밤 → 강릉 숙소가 위)', () => {
    const GANGNEUNG: SavedStay = {
      ...STAY_A,
      savedStayId: 'gn',
      name: '강릉 씨마크',
      lat: 37.79,
      lng: 128.92,
    };
    mockSavedStaysResult = loaded([JW, GANGNEUNG]);
    mockAddressById = {
      jw: SEOUL,
      gn: { status: 'known', address: '강원특별자치도 강릉시 해안로 406' },
    };
    seedDraft('2026-06-10', '2026-06-12', [
      ['서울특별시', 1],
      ['강릉시', 1],
    ]);
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));

    expect(
      screen.getByTestId('trip-base-staysheet-section-here-title')
    ).toHaveTextContent('강릉시 숙소');
    const here = screen.getByTestId('trip-base-staysheet-section-here');
    expect(
      within(here).getByTestId('trip-base-staysheet-cand-gn')
    ).toBeOnTheScreen();
    const other = screen.getByTestId('trip-base-staysheet-section-other');
    expect(
      within(other).getByTestId('trip-base-staysheet-cand-jw')
    ).toBeOnTheScreen();
  });
});
