import {
  fireEvent,
  render,
  screen,
  act,
  within,
} from '@testing-library/react-native';

import type { StayAddressState } from '../model/staySheetSections';
import type { BaseAssignment, SavedStay } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/create-trip/model/tripWizardStore';
import { resetPressGuard } from '@/shared/press/pressGuard';

import { TripNewStep2Page } from './TripNewStep2Page';

/**
 * TRIP-1149 — g02 거점 숙소 2/4 페이지 배선(node 버킷, README 버킷 예외). 옛 본 파일과 옛
 * `.staysheet.integration`(MSW 0 — 훅 목만 써서 node 로 옮겼다)을 합쳤다. 옛 파일 하나 = 바깥 describe 하나다.
 *
 * 공유 목은 두 옛 목의 상위 집합이다:
 *  - `useSavedStays`·`useTripBases` 는 **호출 인자를 기록**하고(옛 본 파일) 가변 결과를 돌려준다.
 *  - `useAssignBase` 는 옛 staysheet 의 useState 흉내 `mutate`(defer·fail 모드). ⚠️ 옛 본 파일 목에는 `mutate`
 *    가 없어 부르면 TypeError 로 red 였다 → `배선` describe 는 afterEach 로 "mutate 0회"를 명시해 옮겼다.
 *  - `useStayAddresses` 는 받은 숙소 목록으로 `mockAddressById` 를 거른다(기본 빈 표 = 옛 본 파일의 `{}`).
 *
 * ⚠️ `jest.mock` 팩토리가 참조하는 바깥 변수는 이름이 `mock` 으로 시작해야 한다 — 아래 이름을 바꾸지 마라.
 * ⚠️ 시트 실개폐·딤은 `@gorhom/bottom-sheet` 통과형 목이라 jest 사각 — 6-b 실기 전용.
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

/** 지정 뮤테이션이 **어떤 variables 로, 어떤 콜백과** 불렸는지 기록하는 창구. */
const mockAssignMutate = jest.fn();
let mockAssignShouldFail = false;

/**
 * S9 in-flight 잠금 검증용 deferred(비해결) 제어. 동기 onSuccess 목은 첫 press 가 시트를 닫아 이중탭·pending 을
 * 재현조차 못 한다 — 그래서 콜백을 붙잡아 두는 모드를 둔다.
 *  - `false`  : 동기 동작(onSuccess/onError 즉시 호출).
 *  - `'silent'`: 콜백만 붙잡고 `isPending` 불변 → 버튼이 안 잠겨 **ref 가드만** 이중탭을 막는다(AC-S9-1).
 *  - `'pending'`: 붙잡고 `isPending:true` 재렌더 → assignPending 이 버튼을 disable(AC-S9-2·S9-3).
 */
let mockAssignDefer: false | 'silent' | 'pending' = false;
/** 비해결로 붙잡은 지정 콜백 — 테스트가 나중에 성공(resolve)/실패(reject)로 푼다(AC-S9-3). */
const mockHeldAssigns: { resolve: () => void; reject: () => void }[] = [];

jest.mock('@/features/trip/model/useSavedStays', () => ({
  useSavedStays: (...args: unknown[]) => {
    mockUseSavedStays(...args);
    return mockSavedStaysResult;
  },
}));

/**
 * TRIP-1011 — 저장 숙소 주소 조회 훅 목. 실물은 react-query 라 QueryClientProvider 가 없는 이 파일에선 못 돈다.
 * **받은 숙소 목록으로부터** 결과를 만든다 — 배선이 숙소 목록을 넘기지 않으면 주소도 비어 섹션이 안 생긴다.
 * 기본값은 빈 표 = 전부 "모름".
 */
let mockAddressById: Record<string, StayAddressState> = {};
jest.mock('../model/useStayAddresses', () => ({
  useStayAddresses: (stays: { savedStayId: string }[]) =>
    Object.fromEntries(
      stays
        .filter((stay) => mockAddressById[stay.savedStayId] !== undefined)
        .map((stay) => [stay.savedStayId, mockAddressById[stay.savedStayId]])
    ),
}));

jest.mock('@/features/assign-trip-base/model/useTripBases', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    useTripBases: (...args: unknown[]) => {
      mockUseTripBases(...args);
      return mockBasesResult;
    },
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

beforeEach(() => {
  // TRIP-1013 — 연타 가드의 400ms 창은 모듈 전역이라 앞 테스트의 누름이 새지 않게 닫는다.
  resetPressGuard();
  mockUseSavedStays.mockClear();
  mockUseTripBases.mockClear();
  mockAssignMutate.mockClear();
  mockAssignShouldFail = false;
  mockAssignDefer = false;
  mockHeldAssigns.length = 0;
  mockAddressById = {};
});

afterEach(() => {
  useTripWizardStore.getState().reset();
});

/**
 * TRIP-672 g02 거점 숙소 2/4 — **배선(재작성).** 두 조회 · 스토어 · 라우터를 잇는다.
 * TRIP-674 · S10 — 그 위에 **empty 얼굴**을 얹는다(D1). 배선은 얼굴 판정에 empty 를 삽입할 뿐이다.
 *
 * 무엇을 보장하나 — 화면은 이 중 어느 것도 모른다:
 *  - **변형 판정(얼굴 순서 notrip>error>loading>empty>default)** `createdTripId` 부재→notrip ·
 *    조회 실패→error · 진행 중→loading · **저장 숙소 0→empty**(신, D1, `savedStayList.length === 0`) ·
 *    그 밖→default. ⚠️ loading 이 empty 를 이긴다 — 조회 중엔 savedStayList 가 [] 라도 loading 얼굴이다.
 *  - **박별 카드 파생** `toBaseSections` → `nightlyBaseCards`로 배정된 밤은 숙소명, 미배정 밤은 "숙소 미정".
 *  - **empty 배선(신)** 저장 숙소 0 → empty 얼굴. 보조 CTA "숙소 둘러보기"→`/stays`(첫 여행지 region 동봉, TRIP-1011),
 *    주 CTA "숙소 없이 계속"→goToMethod(default nostay 와 같은 동작).
 *  - **제거(D2)** 후보 하트·연박 묶음·coverage/blocked·fixSheet·fallback 경고가 렌더에서 사라진다.
 *  - **CTA 목적지** default·loading 의 두 CTA 다 게이트 없이 활성이고 h04 method 로 replace 이동한다(AC-5).
 *
 * 카드 탭(→S9 오픈 신호)은 여기서 재지 않는다 — 배선의 onPressCard 는 S9 미착수 no-op stub 이라
 * 관측 대상이 없다. 그 계약은 화면 층(`TripWizardStep2Screen.test.tsx`)이 nightNumber 로 잠근다.
 *
 * ⚠️ `jest.mock` 팩토리는 최상단으로 끌어올려진다. 팩토리가 참조하는 바깥 변수는 이름이 `mock`으로
 * 시작해야 예외를 받는다 — **아래 변수 이름을 바꾸지 마라**(리포 확립 규칙).
 * ⚠️ `useAssignBase` 목은 S9 카드 탭 지정 배선이 실제로 물어 남긴다(옛 clean-red 스텁 아님).
 * TRIP-675 로 고아가 된 useTripCoverage·useUnassignBase·useBaseFix 목은 제거됐다.
 */
describe('배선 — 변형 판정·박별 카드·CTA', () => {
  // 옛 목의 useAssignBase 에는 mutate 가 없어 부르면 TypeError 로 red 였다 — 그 그물을 부재 단언으로 옮긴다.
  afterEach(() => {
    expect(mockAssignMutate).not.toHaveBeenCalled();
  });

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
      linkedTripIds: [],
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

  beforeEach(() => {
    resetPressGuard(); // TRIP-1013 — 연타 가드 창(모듈 전역)이 앞 테스트에서 새지 않게 닫는다.
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
  });

  describe('변형 판정 (얼굴 순서 notrip>error>loading>empty>default)', () => {
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

    it('★ loading 이 empty 를 이긴다 — savedStays 가 진행 중이면(밤 0) 스켈레톤을 그리고 empty 로 새지 않는다', () => {
      // savedStays 진행 중 → savedStayList = undefined ?? [] = 길이 0. empty 를 loading 보다 앞에 두면
      // 조회 중에 empty 로 새는 순서 뮤턴트가 된다 — loading 얼굴을 단언해 그 뮤턴트를 잡는다(★4·§3).
      mockSavedStaysResult = pending();
      render(<TripNewStep2Page />);

      // 긍정 짝 — loading 얼굴(스켈레톤)이다.
      expect(
        screen.getAllByTestId(/^trip-base-skeleton-night-/).length
      ).toBeGreaterThan(0);
      // 부정 짝 — empty 얼굴 마커(둘러보기·미정 행)로 새지 않았다.
      expect(screen.queryByTestId('trip-base-browse')).toBeNull();
      expect(screen.queryAllByTestId(/^trip-base-empty-night-/)).toHaveLength(
        0
      );
    });

    it('★ 두 조회가 모두 진행 중이면(둘 다 빈 배열) empty 가 아니라 loading 이다 (S10 순서 급소)', () => {
      // S10 이 empty 조건에 `&& assignments.length === 0` 을 더한 뒤로는, savedStays 진행 중 단독
      // 케이스(위)는 beforeEach 기본 bases(길이 1)로 돌아 empty 조건 자체가 false 라 순서 뮤턴트를
      // 못 잡는다. 두 조회를 모두 pending 으로 두면 savedStayList=[]·assignments=[] 라 empty 조건이
      // true 가 되어, empty 를 loading 앞에 두는 뮤턴트만이 여기서 empty 얼굴을 그린다(code-critic
      // 경고-1 복원 — loading 우선 순서가 유일한 방벽임을 이 케이스가 다시 잠근다).
      mockSavedStaysResult = pending();
      mockBasesResult = pending();
      render(<TripNewStep2Page />);

      expect(
        screen.getAllByTestId(/^trip-base-skeleton-night-/).length
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId('trip-base-browse')).toBeNull();
      expect(screen.queryAllByTestId(/^trip-base-empty-night-/)).toHaveLength(
        0
      );
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
  });

  // TRIP-1010(D7) — 카드 수는 박수 합이 아니라 **여행 기간**이다. 배선이 스토어 `endDate` 를
  // `nightlyBaseCards` 에 넘겨야만 기간만큼 카드가 뜬다(AC-7). 위 기본 픽스처는 부산2+경주1 = 기간 3박이라
  // 두 규칙이 같은 답을 내므로, 여기서는 박수 합 < 기간인 드래프트로 다시 심는다.
  describe('TRIP-1010 · 카드 수 = 여행 기간 (박수 합이 모자라도 밤이 빠지지 않는다)', () => {
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

    it('서울 1박 + 기간 9/26–9/28(2박)이면 카드 2장, 둘째 밤(9/27)도 서울이다 (QA #032)', () => {
      // 준비 — 배정·저장 숙소는 기본값(6월 배정이라 9월 밤을 안 덮는다 → 전부 "숙소 미정").
      seedDraft('2026-09-26', '2026-09-28', [['서울특별시', 1]]);

      render(<TripNewStep2Page />);

      expect(screen.getAllByTestId(/^trip-base-night-card-/)).toHaveLength(2);
      const card2 = screen.getByTestId('trip-base-night-card-2');
      expect(card2).toHaveTextContent(/서울특별시/);
      expect(card2).toHaveTextContent(/9\/27/);
      expect(screen.queryByTestId('trip-base-night-card-3')).toBeNull();
    });

    it('부산1·경주1 + 기간 3박이면 카드 3장, 남은 밤(3번째)은 마지막 여행지 경주다', () => {
      seedDraft('2026-06-10', '2026-06-13', [
        ['부산', 1],
        ['경주', 1],
      ]);

      render(<TripNewStep2Page />);

      expect(screen.getAllByTestId(/^trip-base-night-card-/)).toHaveLength(3);
      expect(screen.getByTestId('trip-base-night-card-3')).toHaveTextContent(
        /경주/
      );
    });

    it('empty 얼굴(저장 숙소 0·배정 0)의 미정 행도 기간만큼 뜬다', () => {
      seedDraft('2026-06-10', '2026-06-13', [
        ['부산', 1],
        ['경주', 1],
      ]);
      mockSavedStaysResult = loaded([]);
      mockBasesResult = loaded([]);

      render(<TripNewStep2Page />);

      expect(screen.getAllByTestId(/^trip-base-empty-night-/)).toHaveLength(3);
    });
  });

  // TRIP-674 · S10 — savedStays 0 은 이제 empty 얼굴이다(구 옵션 A 의 "전부 숙소 미정 default" 를 대체,
  // D1). ⚠️ grep sweep: 여기 있던 구 ★4("savedStays 0 → default·empty 없음")가 신 계약과 정면 충돌해
  // empty 얼굴 단언으로 교체됐다(02a ★1).
  describe('empty 얼굴 (D1) — 저장 숙소 0', () => {
    beforeEach(() => {
      // beforeEach 기본값(savedStays 길이 1)을 0 으로 덮어 empty 를 강제한다. bases 도 0(무배정).
      mockSavedStaysResult = loaded([]);
      mockBasesResult = loaded([]);
    });

    it('박별 미정 행 + 둘러보기 CTA 를 그리고, default 카드·generate 는 없다', () => {
      render(<TripNewStep2Page />);

      // 긍정 짝 — empty 전용 미정 행 3개(밤 수 = Σnights).
      expect(screen.getAllByTestId(/^trip-base-empty-night-/)).toHaveLength(3);
      // empty CTAs.
      expect(screen.getByTestId('trip-base-browse')).toBeOnTheScreen();
      expect(screen.getByText('숙소 없이 계속')).toBeOnTheScreen();

      // ★2 부정 짝(같은 it) — default 카드·주 CTA 로 새지 않는다.
      expect(screen.queryAllByTestId(/^trip-base-night-card-/)).toHaveLength(0);
      expect(screen.queryByTestId('trip-base-generate')).toBeNull();
    });

    // TRIP-1011(#037) — 옛 단언 `toHaveBeenCalledWith('/stays')`(지역 없이 → 검색 화면 기본값 '부산')는
    // D8 결정과 정반대라 교체했다. 인자 **형태**(`?region=` 문자열이든 `{pathname, params}`든)가 아니라
    // **region 값**을 잰다(브리프 AC-1 주석).
    it('AC-2 · 둘러보기를 누르면 첫 여행지(seq 1) 지역을 실어 /stays 로 push 한다', () => {
      const store = useTripWizardStore.getState();
      store.reset();
      store.setPeriod(undefined, TRIP_START, TRIP_END);
      store.setCreatedTripId(TRIP_ID);
      store.addDestination('부산광역시', 2);
      store.addDestination('경주시', 1);

      render(<TripNewStep2Page />);
      fireEvent.press(screen.getByTestId('trip-base-browse'));

      expect(routerMock.push).toHaveBeenCalledTimes(1);
      expect(staysRegionOf(routerMock.push.mock.calls[0])).toBe('부산광역시');
    });

    it('주 CTA "숙소 없이 계속"은 default nostay 와 같은 동작 — h04 method 로 replace 한다', () => {
      render(<TripNewStep2Page />);

      fireEvent.press(screen.getByTestId('trip-base-nostay-start'));

      expect(routerMock.replace).toHaveBeenCalledWith(METHOD_ROUTE);
      expect(routerMock.push).not.toHaveBeenCalled();
    });
  });

  // TRIP-677 · S10 — empty 판정 축을 savedStays 단독에서 (savedStays==0 AND assignments==0) 로 좁힌다.
  // 지정 후 그 숙소를 저장 해제하면 savedStayList 는 0 이지만 서버 배정은 남는다 — empty 로 가리면 표시 불일치.
  describe('S10 empty 조건 좁히기 (AC-S10-2) — 저장 0 이지만 배정 ≥1 은 default', () => {
    beforeEach(() => {
      // 저장 숙소 0 (지정 후 저장 해제 시나리오) · 배정 1 (서버엔 거점이 남아 있다).
      mockSavedStaysResult = loaded([]);
      mockBasesResult = loaded([assignment()]);
    });

    it('배정이 남아 있으면 empty 가 아니라 박별 카드(default)를 그린다', () => {
      render(<TripNewStep2Page />);

      // 긍정 짝 — default 얼굴(박별 카드 3장 = Σnights). 현행 empty 단독 판정이면 0장이라 red.
      expect(screen.queryAllByTestId(/^trip-base-night-card-/)).toHaveLength(3);
      // 부정 짝 — empty 로 새지 않았다(미정 행·둘러보기 부재).
      expect(screen.queryAllByTestId(/^trip-base-empty-night-/)).toHaveLength(
        0
      );
      expect(screen.queryByTestId('trip-base-browse')).toBeNull();
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

  describe("TRIP-1012 Q3 · notrip '처음부터'는 위저드 안 왕복 — 드래프트를 비우지 않는다 (#074 금지)", () => {
    it('여행지·기간이 그대로 남은 채 step1 로 1회 이동한다(재제출이 쉽도록)', () => {
      // 준비 — beforeEach 드래프트(부산 2·경주 1·기간)에서 만든 여행 id 만 없다 → notrip 얼굴.
      useTripWizardStore.setState({ createdTripId: undefined });
      const snapshot = () => {
        const s = useTripWizardStore.getState();
        return {
          destinations: s.destinations,
          startDate: s.startDate,
          endDate: s.endDate,
        };
      };
      const before = snapshot();
      // 앵커 — 보존을 잴 값이 실제로 있다.
      expect(before.destinations).toHaveLength(2);
      render(<TripNewStep2Page />);

      fireEvent.press(screen.getByTestId('trip-base-notrip-restart'));

      expect(routerMock.push).toHaveBeenCalledTimes(1);
      expect(routerMock.push).toHaveBeenCalledWith('/trips/new/step1');
      // "새 진입점은 비운다"를 여기까지 넓히면 이 사용자는 여행지를 처음부터 다시 친다.
      expect(snapshot()).toEqual(before);
    });
  });
});

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
 * ⚠️ 같은 파일 「배선」 describe(TRIP-672)는 카드를 안 눌러 시트가 미마운트다(openNight=null 초기값).
 *
 * 옛 `.staysheet.integration`(int 버킷) — MSW 를 안 써서 node 버킷으로 옮겼다(TRIP-1149).
 */
describe('숙소 선택 시트 배선 (S9 · TRIP-1011 · TRIP-1074)', () => {
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
   * `-base-badge`·`-meta`·`-price`(TRIP-1074) 하위 testID를 더 달아서, 접두만 보는 `/^trip-base-staysheet-cand-/`는
   * 카드 한 장을 두 번 센다(실측 3장 → 6). 개수를 셀 때는 이 패턴을 쓴다.
   */
  const CARD_ROOT =
    /^trip-base-staysheet-cand-(?!.*-(photo|photo-placeholder|base-badge|meta|price)$)/;

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

  /**
   * TRIP-1074 — 카드 서브라인 앞에 동네 라벨(주소의 시군구 토큰)을 붙인다. 재료는 페이지가 섹션 판정용으로
   * 이미 받은 주소(`useStayAddresses` — 이 파일에선 `mockAddressById` 목)라 새 요청이 없다(요청 수는 형제
   * geocodeLazy P5 가 실물 훅으로 잰다).
   *
   * 준비: 서울특별시 1박 여행 + 저장 숙소(STAY_A 파생 = 날짜 6/10–6/13 · 3박) + 숙소별 주소 상태.
   * 실행: 1박 카드를 눌러 시트를 연다. 단언: 카드 `-meta` 줄 전체(문자열 = 완전 일치).
   */
  describe('🔴 TRIP-1074 · 시트 카드 서브라인 = 시군구 라벨 · 날짜', () => {
    const DATES = '6/10–6/13 · 3박';

    function saved(savedStayId: string, name: string, lat: number): SavedStay {
      return { ...STAY_A, savedStayId, name, lat, lng: 127 };
    }
    function undated(
      savedStayId: string,
      name: string,
      lat: number
    ): SavedStay {
      return {
        ...saved(savedStayId, name, lat),
        checkIn: null,
        checkOut: null,
      };
    }
    function known(address: string): StayAddressState {
      return { status: 'known', address };
    }
    const SEOUL = known('서울특별시 종로구 청계천로 279');

    function openSeoulNight(): void {
      seedDraft('2026-09-26', '2026-09-27', [['서울특별시', 1]]);
      render(<TripNewStep2Page />);
      fireEvent.press(screen.getByTestId('trip-base-night-card-1'));
    }

    it('AC-2 · AC-4 섹션 경로 — "그 밤 지역"과 "다른 지역" 두 섹션 카드 모두 라벨로 시작한다', () => {
      mockSavedStaysResult = loaded([
        saved('jw', 'JW 메리어트 동대문', 37.57),
        saved('denba', '덴바스타 구서점', 35.26),
        saved('para-1', '파라다이스호텔', 35.16),
      ]);
      mockAddressById = {
        jw: SEOUL,
        denba: known('부산 금정구 구서동 1'),
        'para-1': known('부산광역시 해운대구 해운대해변로 296'),
      };
      openSeoulNight();

      const here = screen.getByTestId('trip-base-staysheet-section-here');
      const other = screen.getByTestId('trip-base-staysheet-section-other');
      expect(
        within(here).getByTestId('trip-base-staysheet-cand-jw-meta')
      ).toHaveTextContent(`종로구 · ${DATES}`);
      expect(
        within(other).getByTestId('trip-base-staysheet-cand-denba-meta')
      ).toHaveTextContent(`금정구 · ${DATES}`);
      expect(
        within(other).getByTestId('trip-base-staysheet-cand-para-1-meta')
      ).toHaveTextContent(`해운대구 · ${DATES}`);
    });

    it('AC-4 · AC-3 평면 경로(섹션 없음) — 라벨이 붙고, 날짜 없는 숙소는 라벨만(꼬리 · 없음)', () => {
      mockSavedStaysResult = loaded([
        saved('jw', 'JW 메리어트 동대문', 37.57),
        undated('jw-nodate', '동대문 게스트하우스', 37.58),
      ]);
      mockAddressById = { jw: SEOUL, 'jw-nodate': SEOUL };
      openSeoulNight();

      // 전부 그 밤 지역이라 섹션이 없다 = 평면 경로를 탔다.
      expect(
        screen.queryAllByTestId(/^trip-base-staysheet-section-/)
      ).toHaveLength(0);
      expect(
        screen.getByTestId('trip-base-staysheet-cand-jw-meta')
      ).toHaveTextContent(`종로구 · ${DATES}`);
      expect(
        screen.getByTestId('trip-base-staysheet-cand-jw-nodate-meta')
      ).toHaveTextContent('종로구');
    });

    it('AC-5 · 주소 모름·조회 중이면 라벨 자리가 빈다 — 날짜만 남거나 줄이 없다 (대체 문구 0)', () => {
      mockSavedStaysResult = loaded([
        saved('jw', 'JW 메리어트 동대문', 37.57),
        undated('pending', '동대문 게스트하우스', 37.58),
        saved('known', '청계천 호텔', 37.59),
      ]);
      mockAddressById = {
        jw: { status: 'unknown' },
        pending: { status: 'loading' },
        known: SEOUL,
      };
      openSeoulNight();

      // 짝 앵커 — 주소를 아는 카드엔 라벨이 붙었다.
      expect(
        screen.getByTestId('trip-base-staysheet-cand-known-meta')
      ).toHaveTextContent(`종로구 · ${DATES}`);
      // 모름 — 완전 일치라 좌표·'위치 확인 안 됨'·시도명이 끼면 red.
      expect(
        screen.getByTestId('trip-base-staysheet-cand-jw-meta')
      ).toHaveTextContent(DATES);
      expect(
        screen.getByTestId('trip-base-staysheet-cand-jw')
      ).not.toHaveTextContent(/위치 확인|주소|서울/);
      // 조회 중 + 날짜 없음 — 줄 자체가 없다.
      expect(
        screen.queryByTestId('trip-base-staysheet-cand-pending-meta')
      ).toBeNull();
    });

    it('01b Q2 · 시군구가 없는 주소(세종 도로명·시도 없는 주소)는 라벨을 만들지 않는다', () => {
      mockSavedStaysResult = loaded([
        saved('jw', 'JW 메리어트 동대문', 37.57),
        saved('sejong', '정부청사 앞 숙소', 36.5),
        undated('bare', '첨단 게스트하우스', 35.2),
      ]);
      mockAddressById = {
        jw: SEOUL,
        sejong: known('세종특별자치시 한누리대로 2130'),
        bare: known('첨단로 242'),
      };
      openSeoulNight();

      expect(
        screen.getByTestId('trip-base-staysheet-cand-jw-meta')
      ).toHaveTextContent(`종로구 · ${DATES}`);
      expect(
        screen.getByTestId('trip-base-staysheet-cand-sejong-meta')
      ).toHaveTextContent(DATES);
      expect(
        screen.getByTestId('trip-base-staysheet-cand-sejong')
      ).not.toHaveTextContent(/세종/);
      expect(
        screen.queryByTestId('trip-base-staysheet-cand-bare-meta')
      ).toBeNull();
    });

    it('AC-1 Q1-A · AC-7 · AC-8 · AC-9 — "성남시 분당구"·"수원시 영통구"가 뜨고, 거리·가격·소요시간 문자열은 없다', () => {
      mockSavedStaysResult = loaded([
        saved('bundang', '정자역 호텔', 37.36),
        saved('suwon', '광교 호수 호텔', 37.28),
      ]);
      mockAddressById = {
        bundang: known('경기 성남시 분당구 정자동 178-1'),
        suwon: known('경기도 수원시 영통구 광교중앙로 140'),
      };
      openSeoulNight();

      expect(
        screen.getByTestId('trip-base-staysheet-cand-bundang-meta')
      ).toHaveTextContent(`성남시 분당구 · ${DATES}`);
      expect(
        screen.getByTestId('trip-base-staysheet-cand-suwon-meta')
      ).toHaveTextContent(`수원시 영통구 · ${DATES}`);

      for (const id of ['bundang', 'suwon']) {
        const card = screen.getByTestId(`trip-base-staysheet-cand-${id}`);
        // 숫자를 붙여 잰다 — 숫자 없는 /분|원/ 은 '분당구'·'수원시'에서 오탐한다.
        expect(card).not.toHaveTextContent(/\d+\s*m\b|km/); // 거리(결정 1(a))
        expect(card).not.toHaveTextContent(/\d[\d,]*\s*원|₩|가격 미확인/); // 가격(결정 4(a))
      }
      // 짝 앵커 — 위 정규식이 지명과 실제로 만났다('분'·'원'이 카드에 있다).
      expect(
        screen.getByTestId('trip-base-staysheet-cand-bundang')
      ).toHaveTextContent(/분당구/);
      expect(
        screen.getByTestId('trip-base-staysheet-cand-suwon')
      ).toHaveTextContent(/수원시/);
      expect(screen.queryAllByTestId(/-price$/)).toHaveLength(0);
    });
  });
});
