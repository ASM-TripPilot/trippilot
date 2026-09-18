import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { BaseAssignment, SavedStay } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

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
 *  - **둘러보기**(AC-3) `/stays` push.
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
  checkIn: null,
  checkOut: null,
  registerRoute: 'MAP_SEARCH',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

function loaded<T>(data: T): QueryStub<T> {
  return { data, isPending: false, isError: false, refetch: jest.fn() };
}

beforeEach(() => {
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

describe('I6 · 둘러보기 라우트 (AC-3)', () => {
  it('숙소 둘러보기 → /stays 로 push', () => {
    render(<TripNewStep2Page />);

    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));
    fireEvent.press(screen.getByTestId('trip-base-staysheet-browse'));

    expect(routerMock.push).toHaveBeenCalledWith('/stays');
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

    // 재시도 — onError 에서 잠금을 안 풀면 영구 잠김이라 여기서 mutate 가 안 나간다.
    fireEvent.press(screen.getByTestId('trip-base-staysheet-assign'));
    expect(mockAssignMutate).toHaveBeenCalledTimes(2);
  });
});
