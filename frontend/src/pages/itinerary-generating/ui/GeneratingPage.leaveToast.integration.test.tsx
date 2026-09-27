import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StrictMode, cloneElement } from 'react';

import type { Itinerary } from '@/shared/api/generated/schemas';
import * as ToastModule from '@/shared/ui/Toast';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';

import { GeneratingPage } from './GeneratingPage';

/**
 * TRIP-1046 · 생성 중 화면을 **떠날 때** '백그라운드에서 계속 만들고 있어요' 토스트(QA #026).
 *
 * 무엇을 보장하나:
 *  - 🔴 POST 가 진행 중일 때 떠나면(앱바 ‹ 또는 스와이프 = 화면이 트리에서 빠짐) 토스트가 **정확히 1회**.
 *  - 성공해서 다음 화면으로 넘어갈 때(draft · copick 슬롯 · copick 완성 세 갈래)는 띄우지 않는다 —
 *    "계속 만들고 있어요"가 거짓이 된다.
 *  - 실패(409 포함)에서 떠날 때도, 관찰 모드(mode 없음)에서 떠날 때도 띄우지 않는다(INV-4).
 *
 * ⚠️ 목 router 는 화면을 내리지 않는다 — 그래서 "떠남"은 `leave()` 가 페이지만 트리에서 빼서 재현하고,
 *   토스트 호스트는 남겨 둔다(`unmount()` 는 호스트까지 지운다, 02a ★8·★9).
 * ⚠️ expo-router 목엔 `useNavigation` 이 없다 — 기존 GeneratingPage 테스트 8파일과 같은 조건(AC-13).
 *
 * 3동작 뼈대: 준비 = 목 phase·렌더 → 실행 = ‹ press·성공 콜백·떠나기 → 단언 = 토스트가 떴나·몇 번 불렸나.
 */

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외(02a ★19).
type MockPhase = 'idle' | 'pending' | 'success' | 'error' | 'busy';
let mockPhase: MockPhase = 'pending';

type SuccessFn = (...args: unknown[]) => void;
/** 훅 레벨 옵션(`usePostTripsTripIdItinerary({ mutation })`) — 성공 순서 재현용(02a ★13). */
let mockHookOptions: { mutation?: { onSuccess?: SuccessFn } } | undefined;
/** 마지막 mutate 의 변수·호출별 옵션. */
let mockLastCall:
  { vars: unknown; options?: { onSuccess?: SuccessFn } } | undefined;

const mockMutate = jest.fn(
  (vars: unknown, options?: { onSuccess?: SuccessFn }) => {
    mockLastCall = { vars, options };
  }
);

/** 409 GENERATION_IN_PROGRESS — axios `isAxiosError` 는 `isAxiosError === true` 만 본다(02a ★17). */
const mockBusyError = {
  isAxiosError: true,
  response: {
    status: 409,
    data: {
      error: { code: 'GENERATION_IN_PROGRESS', activeTripId: 't-other' },
    },
  },
};

/** 상태 필드를 전부 일관되게 준다(02a ★15). */
function mockMutationResult(phase: MockPhase) {
  const isError = phase === 'error' || phase === 'busy';
  return {
    mutate: mockMutate,
    status: isError ? 'error' : phase,
    isIdle: phase === 'idle',
    isPending: phase === 'pending',
    isSuccess: phase === 'success',
    isError,
    error:
      phase === 'busy'
        ? mockBusyError
        : phase === 'error'
          ? new Error('network')
          : null,
    data: undefined,
    reset: jest.fn(),
  };
}

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: (options: typeof mockHookOptions) => {
    mockHookOptions = options;
    return mockMutationResult(mockPhase);
  },
  getGetTripsTripIdItineraryQueryKey: (tripId: string) => [
    `/trips/${tripId}/itinerary`,
  ],
  useGetTripsTripIdMustVisits: () => ({
    data: [],
    isPending: false,
    isError: false,
  }),
  // 관찰 모드(mode 없음) — 아직 일정이 없고 조회도 끝나지 않았다(이동 없음).
  useGetTripsTripIdItinerary: () => ({
    data: undefined,
    error: null,
    isPending: true,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => ({ savedPlaces: [], isPending: false, isError: false }),
}));

jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    navigate: mockNavigate,
  }),
  router: {
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    navigate: mockNavigate,
  },
}));

const TRIP_ID = 't1';
const TOAST = 'itinerary-generating-background-toast';
const TOAST_MESSAGE = '백그라운드에서 계속 만들고 있어요';
const COPICK_SLOT_ROUTE = '/trips/[tripId]/itinerary/copick/[slotKey]' as const;

let showToastSpy: jest.SpyInstance;

beforeEach(() => {
  mockPhase = 'pending';
  mockHookOptions = undefined;
  mockLastCall = undefined;
  [mockMutate, mockPush, mockReplace, mockBack, mockNavigate].forEach((fn) =>
    fn.mockClear()
  );
  showToastSpy = jest.spyOn(ToastModule, 'showToast');
});

// 토스트는 모듈 싱글턴이라 테스트 사이로 샌다 — describe 밖 최상위에서 지운다(02a ★10).
afterEach(() => {
  showToastSpy.mockRestore();
  resetToast();
});

/** 슬롯 하나 — 고정 여부만 다르게 쓴다. */
function slot(poiId: string, isFixed: boolean) {
  return {
    poiId,
    startAt: '09:00:00',
    endAt: '10:00:00',
    isFixed,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
  };
}

function itinerary(
  generationMode: Itinerary['generationMode'],
  slots: ReturnType<typeof slot>[]
): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode,
    generationState: 'PARTIAL',
    isFallback: false,
    days: [{ date: '2026-06-10', slots }],
  } as Itinerary;
}

/** 페이지를 토스트 호스트와 함께 그린다. `leave()` = 페이지만 트리에서 뺀다(호스트는 남음).
 * `rerender()` 는 새 엘리먼트로 복제해 넘긴다 — 같은 엘리먼트 객체를 다시 주면 React 가 재렌더를
 * 건너뛰어 목 phase 변경이 화면에 안 닿는다(02a ★20). */
function mount(page: ReactElement) {
  const view = render(<WithToastHost>{page}</WithToastHost>);
  return {
    rerender: () =>
      view.rerender(<WithToastHost>{cloneElement(page)}</WithToastHost>),
    leave: () => view.rerender(<WithToastHost>{null}</WithToastHost>),
  };
}

/** 성공 도착 — react-query 순서대로 훅 레벨 → 호출별 onSuccess. 목 phase 는 그대로 둬
 * "재렌더 전에 화면이 빠지는" 실기 순서를 재현한다(02a ★13). */
function succeed(data: Itinerary): void {
  const context = { client: { setQueryData: jest.fn() } };
  act(() => {
    mockHookOptions?.mutation?.onSuccess?.(
      data,
      mockLastCall?.vars,
      undefined,
      context
    );
    mockLastCall?.options?.onSuccess?.(
      data,
      mockLastCall?.vars,
      undefined,
      context
    );
  });
}

function replaceTargets(): string[] {
  return mockReplace.mock.calls.map((call) =>
    typeof call[0] === 'string' ? call[0] : JSON.stringify(call[0])
  );
}

function expectNoToast(): void {
  expect(screen.queryByTestId(TOAST)).toBeNull();
  expect(showToastSpy).not.toHaveBeenCalled();
}

function expectToastOnce(): void {
  const toast = screen.getByTestId(TOAST);
  expect(within(toast).getByText(TOAST_MESSAGE)).toBeOnTheScreen();
  expect(showToastSpy).toHaveBeenCalledTimes(1);
}

describe('🔴 T-7 · AC-7 — 진행 중 앱바 ‹ 로 떠나면 토스트 1회', () => {
  it('‹ press → 홈으로 replace, 화면이 빠지면 토스트가 한 번 뜬다', () => {
    const page = mount(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    // 앵커 — 진입만으로는 토스트가 없다.
    expect(screen.queryByTestId(TOAST)).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-generating-back'));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');

    page.leave();

    expectToastOnce();
  });

  it('실패 후 [다시 시도]로 다시 진행 중이 된 뒤 떠나도 토스트가 한 번 뜬다', () => {
    mockPhase = 'error';
    const page = mount(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    expect(screen.getByTestId('itinerary-generating-failed')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-generating-retry'));
    mockPhase = 'pending';
    page.rerender();
    // 짝 — 재시도가 실제로 POST 를 다시 쐈고, 실패 얼굴은 내려갔다.
    expect(mockMutate).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();
    expect(screen.queryByTestId(TOAST)).toBeNull();

    page.leave();

    expectToastOnce();
  });
});

describe('🔴 T-8 · AC-8 — 진행 중 버튼 없이 화면이 빠지면(스와이프 pop) 토스트 1회', () => {
  it('press 없이 떠나도 토스트가 한 번 뜨고, 라우터는 부르지 않는다', () => {
    const page = mount(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    expect(screen.queryByTestId(TOAST)).toBeNull();

    page.leave();

    expectToastOnce();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('T-9 · AC-9 — 성공해서 넘어갈 때는 토스트가 없다 (세 갈래)', () => {
  it('draft 로 넘어가면 떠나도 토스트가 없다', () => {
    const page = mount(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    expect(screen.queryByTestId(TOAST)).toBeNull();

    succeed(itinerary('FULLY_AI', [slot('a', false)]));
    // 짝 — 성공 갈래가 실제로 돌았다.
    expect(replaceTargets().some((t) => t.includes('/itinerary/draft'))).toBe(
      true
    );

    page.leave();

    expectNoToast();
  });

  it('copick 첫 슬롯으로 넘어가면 떠나도 토스트가 없다', () => {
    const page = mount(
      <GeneratingPage
        tripId={TRIP_ID}
        mode="CO_PLAN"
        successRoute={COPICK_SLOT_ROUTE}
      />
    );
    expect(screen.queryByTestId(TOAST)).toBeNull();

    succeed(itinerary('CO_PLAN', [slot('hotel', true), slot('a', false)]));
    const targets = replaceTargets();
    expect(targets.some((t) => t.includes('copick/[slotKey]'))).toBe(true);
    expect(targets.some((t) => t.includes('2026-06-10#a'))).toBe(true);

    page.leave();

    expectNoToast();
  });

  it('copick 슬롯이 전부 고정이라 완성 확인으로 넘어가면 떠나도 토스트가 없다', () => {
    const page = mount(
      <GeneratingPage
        tripId={TRIP_ID}
        mode="CO_PLAN"
        successRoute={COPICK_SLOT_ROUTE}
      />
    );
    expect(screen.queryByTestId(TOAST)).toBeNull();

    succeed(itinerary('CO_PLAN', [slot('hotel', true)]));
    expect(replaceTargets().some((t) => t.includes('copick/complete'))).toBe(
      true
    );

    page.leave();

    expectNoToast();
  });
});

describe('T-F · AC-10 — 실패(409 포함)에서 떠날 때는 토스트가 없다 (INV-4)', () => {
  it('실패 얼굴에서 ‹ 로 떠나면 토스트가 없다', () => {
    mockPhase = 'error';
    const page = mount(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    expect(screen.getByTestId('itinerary-generating-failed')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-generating-back'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    page.leave();

    expectNoToast();
  });

  it('진행 중이다가 실패로 바뀐 뒤 떠나면 토스트가 없다(마지막 상태를 본다)', () => {
    const page = mount(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    expect(screen.queryByTestId('itinerary-generating-failed')).toBeNull();

    mockPhase = 'error';
    page.rerender();
    // 짝 — 실패 얼굴이 실제로 그려진 뒤에 떠난다.
    expect(screen.getByTestId('itinerary-generating-failed')).toBeOnTheScreen();

    page.leave();

    expectNoToast();
  });

  it('409(다른 여행 생성 중)에서 [기다리기]로 떠나면 토스트가 없다', () => {
    mockPhase = 'busy';
    const page = mount(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    expect(screen.getByTestId('itinerary-generation-busy')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-generation-busy-wait'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    page.leave();

    expectNoToast();
  });
});

describe('T-11 · AC-11 — 관찰 모드(mode 없음)에서 떠날 때는 토스트가 없다', () => {
  it('POST 를 쏘지 않은 관찰 화면에서 ‹ 로 떠나면 토스트가 없다', () => {
    mockPhase = 'idle';
    const page = mount(<GeneratingPage tripId={TRIP_ID} />);
    // 짝 — 정말 관찰 모드다(POST 0).
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.queryByTestId(TOAST)).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-generating-back'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    page.leave();

    expectNoToast();
  });
});

describe('🔴 T-12 · AC-12 — 떠날 때 정확히 1회, 떠나기 전엔 0회', () => {
  it('‹ 를 두 번 눌러도(연타) 떠날 때 토스트 호출은 1회다', () => {
    const page = mount(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    expect(screen.queryByTestId(TOAST)).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-generating-back'));
    fireEvent.press(screen.getByTestId('itinerary-generating-back'));
    page.leave();

    expectToastOnce();
  });

  it('떠난 뒤 서버가 완성해도(훅 레벨 onSuccess 만 불림) 토스트 호출은 1회 그대로다', () => {
    const page = mount(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
    expect(screen.queryByTestId(TOAST)).toBeNull();

    page.leave();
    // 화면이 빠진 뒤엔 호출별 onSuccess 가 안 불린다 — 훅 레벨만(02a ★14).
    act(() => {
      mockHookOptions?.mutation?.onSuccess?.(
        itinerary('FULLY_AI', [slot('a', false)]),
        mockLastCall?.vars,
        undefined,
        { client: { setQueryData: jest.fn() } }
      );
    });

    expectToastOnce();
  });

  it('StrictMode 로 마운트해도(이중 effect) 진입만으로는 토스트가 없다', () => {
    // 실제 react-query 는 첫 렌더가 idle 이다 — mutate 는 effect 에서 나간다(02a ★18).
    mockPhase = 'idle';
    // StrictMode 는 **루트 바깥**에 둔다 — 안쪽(호스트 래퍼 아래)에 두면 이 렌더러에선 이중 effect 가
    // 재현되지 않아 공허 통과한다(02a ★18 실측).
    render(
      <StrictMode>
        <WithToastHost>
          <GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />
        </WithToastHost>
      </StrictMode>
    );

    // 짝 — 마운트 POST 가 실제로 나갔다.
    expect(mockMutate).toHaveBeenCalled();
    expectNoToast();
  });
});
