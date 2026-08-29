import { render } from '@testing-library/react-native';

import { PlanbDraftPage } from './PlanbDraftPage';

/**
 * TRIP-563 · AC-6·AC-7 — i13/i16 재계획안 페이지 dispatch·배선 심판.
 *
 * 무엇을 보장하나(자식 화면은 스텁 목이라 "어느 화면을 고르나 + 콜백이 어디로 가나"만 잰다):
 *  - 🔴 DRAFT→i13 셸(reasons·excludedPoiIds 계약필드 바인딩 + slots=[] 정직 degrade), NO_SOLUTION→i16,
 *    FAILED→router.push(planb/manual?variant=error) 1회, SOLVING·closed·미도착→렌더 없음(AC-6).
 *  - 🔴 i16/i13 onManualEdit 만 planb/manual 실배선(variant 없음=정상 i15), onSkip·onRestMode no-op(AC-7).
 *  - 🔴 i13 onApply→planb/diff 배선(brief §CTA).
 *
 * ★ 왜 자식 화면을 스텁 목하나: 실 ReplanDraftScreen·NoAlternativeScreen 은 지도를 그려 통합 버킷에서
 *   무겁고, 자식 내부는 컴포넌트 테스트가 이미 잼. 페이지의 책임은 **dispatch + 콜백 배선**뿐이라 스텁으로
 *   격리한다(placeDetailStubRoute·liveLocationRoute 목 선례 계열).
 * ★ jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다(이름이 mock 으로 시작하는 것만 예외).
 *   그래서 세션 데이터·캡처 props 를 mock 접두 홀더에 담고, useReplanSession 목이 매 렌더 시점에 지연
 *   읽기 하도록 짠다 — 한 파일에서 5상태를 태우기 위함(선례 PlanbSolvingPage 는 상태별 별도 파일).
 * ★ 스텁이 RN 엘리먼트(<View/>·createElement(View))를 만들면 NativeWind babel 이 주입하는
 *   `_ReactNativeCSSInterop` 참조가 호이스팅된 팩토리 스코프 밖으로 걸려 변환이 죽는다(repo-traps
 *   드래그리스트/바텀시트 목 계열 — 실측으로 재현). 그래서 스텁은 **null 을 반환**하고, dispatch 는
 *   렌더된 testID 가 아니라 **캡처된 props 의 존재/부재**로 판정한다(더 정밀 — 그 화면 함수가 실제로
 *   props 를 받아 호출됐는지를 잰다).
 */

const TRIP_ID = 't1';
const SESSION_ID = 's9';

// 세션 조회 seam — data 를 render 시점에 지연 읽기(각 테스트가 갈아끼운다).
const mockSession: { data: Record<string, unknown> | undefined } = {
  data: undefined,
};
jest.mock('@/features/planb/model/useReplanSession', () => ({
  useReplanSession: () => ({
    data: mockSession.data,
    isPending: mockSession.data === undefined,
    isError: false,
  }),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
}));

// 자식 화면 스텁 + props 캡처(RN 엘리먼트 미생성 → null 반환, ★ NativeWind interop 함정 회피).
const mockI13: { props: Record<string, unknown> | undefined } = {
  props: undefined,
};
jest.mock('@/features/planb/ui/ReplanDraftScreen', () => ({
  ReplanDraftScreen: (props: Record<string, unknown>) => {
    mockI13.props = props;
    return null;
  },
}));

const mockI16: { props: Record<string, unknown> | undefined } = {
  props: undefined,
};
jest.mock('@/features/planb/ui/NoAlternativeScreen', () => ({
  NoAlternativeScreen: (props: Record<string, unknown>) => {
    mockI16.props = props;
    return null;
  },
}));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockSession.data = undefined;
  mockI13.props = undefined;
  mockI16.props = undefined;
});

function renderPage() {
  render(<PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
}

describe('🔴 I1 · AC-6 — DRAFT → i13 셸(계약필드 바인딩 + slots=[] degrade)', () => {
  it('i13 을 그리고 push 는 안 하며, reasons·excludedPoiIds 를 넘기고 slots 는 []', () => {
    mockSession.data = {
      status: 'DRAFT',
      sessionId: SESSION_ID,
      tripId: TRIP_ID,
      reasons: ['비 예보 반영'],
      excludedPoiIds: ['x1'],
    };
    renderPage();

    // i13 이 호출됨(props 존재) · i16 미호출 · push 없음.
    expect(mockI13.props).toBeDefined();
    expect(mockI16.props).toBeUndefined();
    expect(mockPush).not.toHaveBeenCalled();

    // 계약 존재 필드는 그대로 바인딩.
    expect(mockI13.props?.reasons).toEqual(['비 예보 반영']);
    expect(mockI13.props?.excludedPoiIds).toEqual(['x1']);
    // draft 계약 갭 — 페이지가 슬롯을 지어내지 않는다(정직 degrade).
    expect(mockI13.props?.slots).toEqual([]);
  });
});

describe('🔴 I2 · AC-6 — NO_SOLUTION → i16', () => {
  it('i16 을 그리고 push·i13 은 없다', () => {
    mockSession.data = {
      status: 'NO_SOLUTION',
      sessionId: SESSION_ID,
      tripId: TRIP_ID,
    };
    renderPage();

    expect(mockI16.props).toBeDefined();
    expect(mockI13.props).toBeUndefined();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 I3 · AC-6 — FAILED → planb/manual?variant=error push', () => {
  it('router.push 가 manual 로 variant=error 를 담아 1회, 화면은 안 그린다', () => {
    mockSession.data = {
      status: 'FAILED',
      sessionId: SESSION_ID,
      tripId: TRIP_ID,
    };
    renderPage();

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/planb/manual',
      params: { tripId: TRIP_ID, variant: 'error' },
    });
    expect(mockI13.props).toBeUndefined();
    expect(mockI16.props).toBeUndefined();
  });
});

describe('🔴 I4 · AC-6 — SOLVING·closed·미도착 → 렌더 없음', () => {
  it.each([
    ['SOLVING', 'SOLVING'],
    ['APPLIED(closed)', 'APPLIED'],
  ])('%s 이면 두 화면 미호출 + push 없음', (_label, status) => {
    mockSession.data = { status, sessionId: SESSION_ID, tripId: TRIP_ID };
    renderPage();

    expect(mockI13.props).toBeUndefined();
    expect(mockI16.props).toBeUndefined();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('세션 미도착(data undefined)이면 두 화면 미호출 + push 없음', () => {
    mockSession.data = undefined;
    renderPage();

    expect(mockI13.props).toBeUndefined();
    expect(mockI16.props).toBeUndefined();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 I5 · AC-7 — i16 배선: onManualEdit 실, onSkip·onRestMode no-op', () => {
  it('onManualEdit→planb/manual(variant 없음), onSkip·onRestMode 는 push 0', () => {
    mockSession.data = {
      status: 'NO_SOLUTION',
      sessionId: SESSION_ID,
      tripId: TRIP_ID,
    };
    renderPage();

    (mockI16.props?.onManualEdit as () => void)();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/planb/manual',
      params: { tripId: TRIP_ID },
    });

    mockPush.mockClear();
    (mockI16.props?.onSkip as () => void)();
    (mockI16.props?.onRestMode as () => void)();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 I6 · AC-6/AC-7 — i13 배선: onManualEdit→manual, onApply→diff', () => {
  it('onManualEdit→planb/manual(variant 없음), onApply→planb/diff', () => {
    mockSession.data = {
      status: 'DRAFT',
      sessionId: SESSION_ID,
      tripId: TRIP_ID,
      reasons: [],
      excludedPoiIds: [],
    };
    renderPage();

    (mockI13.props?.onManualEdit as () => void)();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/planb/manual',
      params: { tripId: TRIP_ID },
    });

    mockPush.mockClear();
    (mockI13.props?.onApply as () => void)();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/planb/diff',
      params: { tripId: TRIP_ID, sessionId: SESSION_ID },
    });
  });
});
