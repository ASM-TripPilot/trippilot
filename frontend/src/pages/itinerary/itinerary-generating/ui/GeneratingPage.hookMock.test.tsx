import {
  fireEvent,
  render,
  screen,
  waitFor,
  act,
  within,
} from '@testing-library/react-native';
import { type ReactElement, StrictMode, cloneElement } from 'react';

import type { Itinerary } from '@/shared/api/generated/schemas';
import * as ToastModule from '@/shared/ui/Toast';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';
import {
  promptAndRegisterPush,
  registerPushIfGranted,
  requestPushPermission,
} from '@/shared/push';

import { GeneratingPage } from './GeneratingPage';

/**
 * TRIP-305 · h09 배선을 **실제 페이지→화면**으로 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - 🔴 마운트 시 생성 POST 를 **1회** 쏜다(`{ generationMode:'FULLY_AI' }` 하나뿐, 여분 키 0).
 *    TRIP-1006: 이 파일은 `mode="FULLY_AI"` 를 **명시해** 연다. mode 가 없으면 이제 생성 모드를 지어내지
 *    않고 관찰 모드(POST 0)로 뜬다(A4 · INV-4) — 그쪽은 `GeneratingPage.integration.test.tsx`(관찰 모드).
 *  - 🔴 201(성공)이면 draft 로 **`router.replace` 1회**(뒤로가면 생성 화면으로 안 돌아온다).
 *  - 🔴 오류면 실패 표면을 띄우고(침묵 금지·INV-4) draft 로 안 가며, [다시 시도]가 POST 를 재발화한다.
 *  - 🔴 앱바 뒤로 셰브론이 **백그라운드 이탈**(여행/홈 forward)이지 뒤로가기(router.back)·세션 cancel 이 아니다.
 *
 * ⚠️ **TRIP-789 정합**: footer·[생성 취소]·[백그라운드로 전환] 2버튼이 제거되고 앱바 뒤로 셰브론이
 * onBackground(백그라운드 이탈)를 흡수한다(Q2). 옛 [취소](reset+router.back)는 소멸했다 — 그래서
 * 옛 I4([취소])·I5([백그라운드 버튼])는 앱바 뒤로 하나로 합쳐 다시 쓴다(제거된 testID 를 누르는 형제
 * 테스트를 방치하면 엉뚱한 red — 02a ★2). in-flight POST 는 여전히 진짜로 못 끊는다(orval customInstance
 * 가 signal 을 안 받음 ⚑D) — 이탈해도 서버는 일정을 만들 수 있다. I4 는 **관측 가능한 이탈**(forward+
 * 미전진+서버 cancel 0)만 잰다.
 *
 * 3동작 뼈대: 준비 = `mockPhase`·목 세팅 → 실행 = 페이지 렌더/버튼 press → 단언 = 나간 mutate·불린 router.
 *
 * 한 파일로 합친 기록(TRIP-1150): 생성 훅을 통째로 목으로 바꾼 네 파일(옛 `.integration` · `.coplan` ·
 * `.leaveToast` · `.push`)을 이 파일로 합쳤다. 옛 파일 하나 = 바깥 describe 하나다. trips 목은 세 모양이라
 * `mockTripsShape` 스위치로 고른다(위 목 블록 주석). MSW 를 안 쓰므로 node 버킷이다(README 버킷 예외 —
 * 실 훅 + MSW 관점은 `GeneratingPage.integration.test.tsx`).
 */

// jest.mock 팩토리는 파일 맨 위로 호이스팅돼 바깥 변수를 못 본다 — 이름이 `mock` 으로 시작하는
// 변수만 예외다(리포 확립 규칙). 이 이름들을 바꾸지 마라.
// 생성 훅 목 관점 스위치(TRIP-1150 합치기) — 옛 네 파일이 같은 trips 모듈을 세 모양으로 목했다.
//  'callback'    옛 본 파일·`.coplan` — mutate 가 phase 에 맞춰 호출별 onSuccess/onError/onSettled 를 태운다
//  'state'       옛 `.leaveToast` — 상태 필드 5종(idle·pending·success·error·busy) + 훅 옵션·마지막 호출 기록
//  'hookContext' 옛 `.push` — 성공 시 **훅 옵션** onSuccess 에 실 QueryClient context 까지 넘긴다
// `jest.mock` 은 파일 전체에 한 번만 걸리므로, 목 함수가 **불리는 순간** 이 값을 읽어 갈래를 고른다.
// 최상위 beforeEach 가 'callback' 으로 되돌리고, 각 describe 의 beforeEach 가 자기 모양을 켠다.
type MockTripsShape = 'callback' | 'state' | 'hookContext';
let mockTripsShape: MockTripsShape = 'callback';
type MockPhase = 'idle' | 'pending' | 'success' | 'error' | 'busy';
let mockPhase: MockPhase = 'pending';
/** 'callback' 성공 콜백에 실을 일정 — 옛 본 파일은 무인자(undefined), `.coplan` 은 CO_PLAN 골격. */
let mockSuccessData: Itinerary | undefined;

type SuccessFn = (...args: unknown[]) => void;
/** 'state' — 훅 레벨 옵션(`usePostTripsTripIdItinerary({ mutation })`) — 성공 순서 재현용(옛 leaveToast 02a ★13). */
let mockHookOptions: { mutation?: { onSuccess?: SuccessFn } } | undefined;
/** 'state' — 마지막 mutate 의 변수·호출별 옵션. */
let mockLastCall:
  { vars: unknown; options?: { onSuccess?: SuccessFn } } | undefined;

const mockMutate = jest.fn(
  (
    vars: unknown,
    options?: {
      onSuccess?: SuccessFn;
      onError?: () => void;
      onSettled?: () => void;
    }
  ) => {
    if (mockTripsShape === 'state') {
      mockLastCall = { vars, options };
      return;
    }
    // 목이 배선의 콜백을 phase 에 맞춰 태운다 — pending 은 어떤 콜백도 안 부른다(in-flight 유지).
    // success/error 만 결과 콜백 + onSettled 를 부른다("아직 도는데 정산됨"의 거짓 방지, 02a ★7).
    if (mockPhase === 'success') {
      options?.onSuccess?.(mockSuccessData);
      options?.onSettled?.();
    } else if (mockPhase === 'error') {
      options?.onError?.();
      options?.onSettled?.();
    }
  }
);
/** 세션 cancel(서버 취소) — 앱바 뒤로에선 안 써야 한다. 목에 심어 두고 "0 호출"을 잰다(02a ★8).
 * (TRIP-1032 로 다른 여행 409 안내의 [취소하고 새로 만들기]만 cancel 을 쓴다 — 그쪽은 busy 파일 소관.) */
const mockCancelMutate = jest.fn();

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockNavigate = jest.fn();

/** 'state' — 409 GENERATION_IN_PROGRESS — axios `isAxiosError` 는 `isAxiosError === true` 만 본다(02a ★17). */
const mockBusyError = {
  isAxiosError: true,
  response: {
    status: 409,
    data: {
      error: { code: 'GENERATION_IN_PROGRESS', activeTripId: 't-other' },
    },
  },
};

/** 'state' — 상태 필드를 전부 일관되게 준다(옛 leaveToast 02a ★15). */
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

// 'hookContext' — 훅 옵션 콜백은 라이브러리처럼 4번째 인자(`{ client, meta, mutationKey }`)까지 받는다 —
// TRIP-1015 A 가 생성 성공을 훅 옵션 `onSuccess` 의 `context.client` 로 일정 캐시에 반영하기 때문이다(3인자만
// 주면 목이 라이브러리와 달라져 옳은 구현이 `undefined.client` 로 죽는다).
type MutationCallbacks = {
  onSuccess?: (
    data: unknown,
    variables: unknown,
    onMutateResult: unknown,
    context?: unknown
  ) => void;
  onError?: (
    error: unknown,
    variables: unknown,
    onMutateResult: unknown,
    context?: unknown
  ) => void;
};

function mockHookContextResult(hookOptions?: { mutation?: MutationCallbacks }) {
  return {
    mutate: (variables: unknown, mutateOptions?: MutationCallbacks) => {
      // 생성 응답 = 생성된 일정. copick 은 days 로 첫 슬롯을 찾는다 — 빈 days 면 완성 확인으로 간다.
      const data = { days: [] };
      // 라이브러리의 `MutationFunctionContext` 흉내 — 훅 옵션 콜백만 이 인자를 받는다.
      const { QueryClient } = jest.requireActual('@tanstack/react-query');
      const context = {
        client: new QueryClient(),
        meta: undefined,
        mutationKey: ['postTripsTripIdItinerary'],
      };
      if (mockPhase === 'success') {
        hookOptions?.mutation?.onSuccess?.(data, variables, undefined, context);
        mutateOptions?.onSuccess?.(data, variables, undefined);
      } else if (mockPhase === 'error') {
        const error = new Error('500');
        hookOptions?.mutation?.onError?.(error, variables, undefined, context);
        mutateOptions?.onError?.(error, variables, undefined);
      }
    },
    isPending: mockPhase === 'pending',
    isError: mockPhase === 'error',
  };
}

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: (hookOptions?: {
    mutation?: MutationCallbacks & { onSuccess?: SuccessFn };
  }) => {
    if (mockTripsShape === 'state') {
      mockHookOptions = hookOptions;
      return mockMutationResult(mockPhase);
    }
    if (mockTripsShape === 'hookContext') {
      return mockHookContextResult(hookOptions);
    }
    return {
      mutate: mockMutate,
      isPending: mockPhase === 'pending',
      isError: mockPhase === 'error',
    };
  },
  usePostTripsTripIdGenerationSessionsSessionIdCancel: () => ({
    mutate: mockCancelMutate,
    isPending: false,
    isError: false,
  }),
  // TRIP-1015 A: 생성 성공 콜백이 일정 캐시 키를 만든다 — 실물과 같은 모양(`[/trips/{id}/itinerary]`).
  getGetTripsTripIdItineraryQueryKey: (tripId: string) => [
    `/trips/${tripId}/itinerary`,
  ],
  // TRIP-929: 페이지가 지도 좌표용으로 꼭 갈 곳을 조회한다 — 빈 조회로 둔다(지도는
  // `GeneratingPage.integration.test.tsx` 소관, 이 파일은 POST·이동·실패·이탈만 본다).
  useGetTripsTripIdMustVisits: () => ({
    data: [],
    isPending: false,
    isError: false,
  }),
  // 관찰 모드(mode 없음) 스텁 — 옛 `.leaveToast` 목에만 있었다. 다른 두 모양에선 옛 목처럼 부르면 throw 한다
  // (합치며 목이 넓어져 "생성 모드에서 GET 을 부르는 회귀"가 조용히 통과하지 않게 — 02a ★ 넓어지는 목).
  useGetTripsTripIdItinerary: () => {
    if (mockTripsShape !== 'state') {
      throw new TypeError(
        'useGetTripsTripIdItinerary is not a function (옛 callback·hookContext 목엔 없었다)'
      );
    }
    return {
      data: undefined,
      error: null,
      isPending: true,
      isError: false,
      refetch: jest.fn(),
    };
  },
}));

jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

// TRIP-929: 좌표는 담은 장소에서 온다 — 빈 목록으로 둔다. 팩토리 목이라 실물(QueryClient 필요 ·
// 생성 클라이언트·인증 계층)을 로드하지 않는다.
jest.mock('@/features/save-place/model/savedPlaces', () => ({
  useSavedPlaces: () => ({
    savedPlaces: [],
    isPending: false,
    isError: false,
  }),
}));

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

beforeEach(() => {
  mockTripsShape = 'callback';
  mockSuccessData = undefined;
  mockHookOptions = undefined;
  mockLastCall = undefined;
  mockPhase = 'pending';
  mockMutate.mockClear();
  mockCancelMutate.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockNavigate.mockClear();
});

// 토스트는 모듈 싱글턴이다 — 진행 중(pending)으로 끝나는 케이스는 언마운트 때 이탈 토스트를 띄운다. 옛 본 파일엔
// 토스트 호스트가 없어 상관없었지만, 합친 뒤엔 그 토스트가 뒤 「화면을 떠날 때」 describe 로 샌다 → 최상위에서 비운다.
afterEach(() => {
  resetToast();
});

function renderPage() {
  return render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
}

/** 모든 forward nav(push/replace/navigate)의 목적지를 직렬화해 모은다 — 형태(문자열/객체)를
 * 강요하지 않고 "어디로 갔나"만 본다(02a ★4). */
function forwardDestinations(): string[] {
  return [mockPush, mockReplace, mockNavigate]
    .flatMap((fn) => fn.mock.calls)
    .map((call) =>
      typeof call[0] === 'string' ? call[0] : JSON.stringify(call[0])
    );
}

describe('🔴 I1 · AC-1 — pending 이면 진행 표면 + 마운트 POST 1회', () => {
  it('진행 표면이 뜨고 POST 가 generationMode 하나로 1회 나가며 draft 로 안 간다', () => {
    mockPhase = 'pending';
    renderPage();

    // 진행 표면이 실제로 그려진다.
    expect(
      screen.getByTestId('itinerary-generating-progress')
    ).toBeOnTheScreen();

    // POST 는 마운트 시 정확히 1회, tripId 와 mode 하나만 담아 나간다.
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const vars = mockMutate.mock.calls[0][0] as {
      tripId: string;
      data?: unknown;
    };
    expect(vars.tripId).toBe(TRIP_ID);
    // toEqual = 정확 일치 — deadlineMs 등 여분 키 0 을 잠근다(BR-U3-03).
    expect(vars.data).toEqual({ generationMode: 'FULLY_AI' });

    // 아직 도는 중이라 draft 로 안 갔다.
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 I2 · AC-5 — 201 성공이면 draft 로 replace 가 1회', () => {
  it('성공 시 draft 라우트로 replace 하고(push 아님) tripId 를 싣는다', async () => {
    mockPhase = 'success';
    renderPage();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    // 목적지 형태를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다(02a ★4).
    const destination = mockReplace.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('/itinerary/draft');
    expect(asText).toContain(TRIP_ID);

    // 뒤로 못 돌아오게 replace 여야 한다 — push 로 가면 back 이 생성 화면으로 되돌아온다.
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 I3 · AC-6 — 오류면 실패 표면 + 재시도가 POST 를 다시 쏜다 (INV-4)', () => {
  it('실패 표면이 뜨고 draft 로 안 가며, [다시 시도]가 POST 를 재발화한다', () => {
    mockPhase = 'error';
    renderPage();

    // 침묵하지 않는다 — 실패 표면이 실제로 그려진다.
    expect(screen.getByTestId('itinerary-generating-failed')).toBeOnTheScreen();
    // 실패했으니 draft 로 안 갔다.
    expect(mockReplace).not.toHaveBeenCalled();

    // 재시도 — 존재 확인이 아니라 실제 press 로 POST 재발화를 증명한다(02a ★5).
    const before = mockMutate.mock.calls.length;
    fireEvent.press(screen.getByTestId('itinerary-generating-retry'));
    expect(mockMutate.mock.calls.length).toBe(before + 1);
  });
});

describe('🔴 I4 · AC-4 — 앱바 뒤로 = 백그라운드 이탈 (취소 개념 소멸)', () => {
  it('앱바 뒤로 press → 앞으로 이탈(여행/홈, draft·generating 아님)하고 뒤로가기·세션 cancel 이 아니다', () => {
    mockPhase = 'pending';
    renderPage();

    // TRIP-789: footer·[취소]·[백그라운드로] 2버튼 제거 후 유일한 이탈구는 앱바 뒤로 셰브론이다(Q2).
    fireEvent.press(screen.getByTestId('itinerary-generating-back'));

    // 뒤로가기(router.back)가 아니다 — 옛 [취소](reset+back)가 사라졌음을 잠근다(급소).
    expect(mockBack).not.toHaveBeenCalled();

    // 앞으로 이탈이 실제로 일어났고(뮤테이션은 살린 채 화면만 이탈), 그 목적지가
    // draft 도 generating 자기 자신도 아니다(⚑A 기본 = 여행/홈).
    const destinations = forwardDestinations();
    expect(destinations.length).toBeGreaterThanOrEqual(1);
    expect(destinations.some((d) => d.includes('draft'))).toBe(false);
    expect(destinations.some((d) => d.includes('generating'))).toBe(false);
    // 유일 이탈구가 됐으므로 목적지를 정확일치로 잠근다(5-b 참고-1) — 홈이어야 한다.
    // (팀 확정 2026-09-11: 일정 탭은 trips[0] 리다이렉트로 옛 일정에 착지할 수 있어 홈으로 보낸다.)
    expect(destinations).toContain('/(tabs)');

    // 서버 오퍼레이션 없음(openapi 767) — 취소를 안 쏜다.
    expect(mockCancelMutate).not.toHaveBeenCalled();
  });
});

// TRIP-462 → TRIP-504 · 옛 GeneratingPage.coplan.integration.test.tsx — trips 목은 'callback' 모양 +
// 성공 콜백에 CO_PLAN 골격(mockItinerary)을 싣는다.
describe('CO_PLAN 씨앗 — 첫 비고정 슬롯 착지', () => {
  /**
   * TRIP-462 → **TRIP-504 재작성**(462 동결분 개봉 — 새 사이클이라 정당, 안 (가) 흐름 확정).
   *
   * 무엇이 바뀌었나: h09 CO_PLAN 씨앗의 **완료 목적지**가 h16 허브(`copick`)에서 **첫 비고정 슬롯의
   * SlotFillPage(`copick/[slotKey]`)**로 바뀌었다(01b 순회 세부·AC-6). 허브를 버리고 h13→h14 선형
   * 순회로 대체하므로, 생성이 끝나면 곧장 첫 슬롯 채우기로 착지한다.
   *
   * 무엇을 보장하나:
   *  - 🔴 GC-1(선제green·무회귀): mode='CO_PLAN' 씨앗이면 마운트 시 POST 가 `{generationMode:'CO_PLAN'}`
   *    하나로 정확히 1회 나간다(여분 키 0, BR-U3-03). 이 배선은 462에서 이미 있어 green 유지.
   *  - 🔴 GC-2: 201(성공) 응답의 days 에서 **첫 비고정 슬롯**을 골라 그 SlotFillPage 로 replace 한다.
   *    허브(slotKey 없음)로 새거나, 첫 슬롯이 아닌 고정 슬롯(#hotel)을 고르면 red(목적지 값째 잠금).
   *
   * ⚠️ 목적지가 judge blind-spot 이다(462 gate②-2 실측). mode 만 맞고 목적지가 틀리면 사용자가 엉뚱한
   *    화면에 착지한다. 그래서 목적지 문자열에 **첫 슬롯 slotKey 값**(`2026-06-10#a`)이 실제로 들어
   *    있는지를 `.toContain` 으로 잰다 — 허브·고정슬롯과 갈라지는 급소.
   *
   * ⚠️ mock 이 `onSuccess` 에 **일정(days)을 실어** 넘긴다(462 는 무인자였다). `postTripsTripIdItinerary`
   *    가 생성된 `Itinerary` 를 그대로 반환하므로(customInstance<Itinerary>), 배선은 그 응답의 days 로
   *    첫 슬롯을 계산한다 — 별도 GET 불요. 이 데이터 배선이 없으면 AC-6 은 원리적으로 검증 불가.
   *
   * ⚠️ 기본값(mode·successRoute 미지정)의 full-AI 경로 무회귀는 이 파일이 아니라 동결
   *    본 파일 최상위 I1·I2 가 잠근다(ponytail, 중복 작성 금지).
   *
   * 3동작 뼈대: 준비 = 목 세팅(성공 응답 days) → 실행 = mode=CO_PLAN 으로 렌더 → 단언 = mutate·replace 목적지.
   */

  /** 성공 응답으로 돌려줄 CO_PLAN 골격. 첫 비고정 슬롯 = 2026-06-10#a(앞에 고정 hotel 이 있어,
   * 배선이 `slots[0]` 을 맹목적으로 쓰면 #hotel 을 골라 GC-2 가 red 로 잡는다). */
  const mockItinerary: Itinerary = {
    itineraryId: 'itin-coplan',
    tripId: 't1',
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'CO_PLAN',
    generationState: 'PARTIAL',
    isFallback: false,
    days: [
      {
        date: '2026-06-10',
        slots: [
          {
            poiId: 'hotel',
            startAt: '00:00:00',
            endAt: '00:00:00',
            isFixed: true,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
          {
            poiId: 'a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
          {
            poiId: 'b',
            startAt: '13:00:00',
            endAt: '14:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            alternatives: [],
            tags: [],
          },
        ],
      },
    ],
  };
  const TRIP_ID = 't1';
  /** h05 가 실어 보내는 successRoute — 첫 슬롯 라우트 템플릿. slotKey 는 h09 가 채운다(01b 순회 세부). */
  const COPICK_SLOT_ROUTE =
    '/trips/[tripId]/itinerary/copick/[slotKey]' as const;
  /** 첫 비고정 슬롯의 키(고정 hotel 건너뜀) — 목적지에 이 값이 있어야 첫 슬롯으로 갔다는 뜻. */
  const FIRST_SLOT_KEY = '2026-06-10#a';

  beforeEach(() => {
    mockSuccessData = mockItinerary;
    mockPhase = 'pending';
    mockMutate.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockBack.mockClear();
    mockNavigate.mockClear();
  });

  describe('GC-1 · CO_PLAN 씨앗 — 마운트 시 CO_PLAN POST 1회 (선제green·무회귀)', () => {
    it('POST 가 { generationMode: "CO_PLAN" } 하나로 정확히 1회 나가고 아직 이동하지 않는다', () => {
      mockPhase = 'pending';
      render(
        <GeneratingPage
          tripId={TRIP_ID}
          mode="CO_PLAN"
          successRoute={COPICK_SLOT_ROUTE}
        />
      );

      // 진행 표면이 실제로 그려진다(full-AI 씨앗과 같은 h09 화면 재사용).
      expect(
        screen.getByTestId('itinerary-generating-progress')
      ).toBeOnTheScreen();

      // POST 는 마운트 시 정확히 1회, tripId 와 CO_PLAN 하나만 담아 나간다.
      expect(mockMutate).toHaveBeenCalledTimes(1);
      const vars = mockMutate.mock.calls[0][0] as {
        tripId: string;
        data?: unknown;
      };
      expect(vars.tripId).toBe(TRIP_ID);
      // toEqual = 재귀 정확 일치 — 여분 키 0(BR-U3-03) + FULLY_AI 하드코딩이면 red.
      expect(vars.data).toEqual({ generationMode: 'CO_PLAN' });

      // 아직 도는 중이라 어디로도 안 갔다.
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('🔴 GC-2 · CO_PLAN 완료 — 첫 비고정 슬롯 SlotFillPage 로 replace (AC-6)', () => {
    it('201 성공 시 허브가 아니라 첫 비고정 슬롯(2026-06-10#a)으로 replace 하고(push 아님) tripId 를 싣는다', async () => {
      mockPhase = 'success';
      render(
        <GeneratingPage
          tripId={TRIP_ID}
          mode="CO_PLAN"
          successRoute={COPICK_SLOT_ROUTE}
        />
      );

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

      // 목적지 형태를 강요하지 않고 직렬화해 "어디로 갔나"만 잰다.
      const destination = mockReplace.mock.calls[0][0] as unknown;
      const asText =
        typeof destination === 'string'
          ? destination
          : JSON.stringify(destination);

      // copick 영역이다.
      expect(asText).toContain('copick');
      // ★ 첫 비고정 슬롯의 slotKey 값이 실제로 목적지에 있어야 한다 — 허브(slotKey 없음)로 새거나
      //   고정 hotel(#hotel)을 고르면 이 단언이 red. AC-6 의 급소(목적지 값째 잠금).
      expect(asText).toContain(FIRST_SLOT_KEY);
      // ★ CO_PLAN 이 완전AI 초안(draft/h11)으로 새지 않는다(462 회귀 앵커 계승).
      expect(asText).not.toContain('draft');
      expect(asText).toContain(TRIP_ID);

      // 뒤로 못 돌아오게 replace 여야 한다 — push 로 가면 back 이 생성 화면으로 되돌아온다.
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});

// TRIP-1046 · 옛 GeneratingPage.leaveToast.integration.test.tsx — trips 목은 'state' 모양.
describe('화면을 떠날 때 백그라운드 토스트', () => {
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
   * ⚠️ expo-router 목엔 `useNavigation` 이 없다 — 다른 GeneratingPage 테스트와 같은 조건(AC-13).
   *
   * 3동작 뼈대: 준비 = 목 phase·렌더 → 실행 = ‹ press·성공 콜백·떠나기 → 단언 = 토스트가 떴나·몇 번 불렸나.
   */
  const TRIP_ID = 't1';
  const TOAST = 'itinerary-generating-background-toast';
  const TOAST_MESSAGE = '백그라운드에서 계속 만들고 있어요';
  const COPICK_SLOT_ROUTE =
    '/trips/[tripId]/itinerary/copick/[slotKey]' as const;

  let showToastSpy: jest.SpyInstance;

  beforeEach(() => {
    mockTripsShape = 'state';
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
      expect(
        screen.getByTestId('itinerary-generating-failed')
      ).toBeOnTheScreen();

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
      expect(
        screen.getByTestId('itinerary-generating-failed')
      ).toBeOnTheScreen();

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
      expect(
        screen.getByTestId('itinerary-generating-failed')
      ).toBeOnTheScreen();

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
});

// TRIP-1108 AC-6 · 옛 GeneratingPage.push.integration.test.tsx — trips 목은 'hookContext' 모양.
describe('생성 중 알림 권한을 묻지 않는다', () => {
  /**
   * TRIP-1108 AC-6 — 일정 생성(AI·같이 짜기) 중에는 알림 권한을 **묻지 않는다**.
   *
   * 역사: TRIP-835 는 "일정이 처음 생긴 순간" 권한을 묻게 했다(이 파일의 G1·G2·G5 가 1회를 단언했다).
   * QA 5회차에서 생성 화면 위로 설명 없는 OS 창이 튀어나와, TRIP-1108 이 묻는 자리를 온보딩 사전 안내
   * 카드(location → push → pref1)로 옮겼다. 이 파일은 지우지 않고 단언을 **0회로 뒤집어** 금지 그물로 남긴다
   * (지우면 "생성 중엔 묻지 않는다"를 지키는 행위 심판이 사라진다 — 짝이던 소스 스캔 onboardingPushStructure 는 TRIP-1145 로 지워 이 파일이 남은 그물).
   *
   * 무엇을 보장하나:
   *  - 생성 POST 가 성공해도 `promptAndRegisterPush()` 0회(FULLY_AI·CO_PLAN 공통), 마이크로태스크를 흘린 뒤에도 0회.
   *  - 성공 착지의 `router.replace` 인자·횟수는 그대로다 — "성공 콜백이 실제로 돌았다"는 앵커다.
   *  - 실패·진행 중에도 0회(원래부터).
   *
   * ★ 뮤테이션 목은 훅 옵션과 mutate 옵션의 onSuccess 를 **둘 다** 부른다(TRIP-835 02a ★8) — 구현이 어느 쪽에
   *   달든 정답이다.
   *
   * 3동작 뼈대: 준비=생성 결과(phase)·씨앗 → 실행=페이지 렌더(마운트가 POST 를 쏜다) → 단언=루틴 0회·이동 호출.
   */

  const mockPrompt = promptAndRegisterPush as jest.Mock;
  const TRIP_ID = 't1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockTripsShape = 'hookContext';
    mockPhase = 'pending';
    mockPrompt.mockImplementation(() => Promise.resolve());
  });

  describe('🔴 TRIP-1108 AC-6 · 생성 성공 착지에서 권한을 묻지 않는다', () => {
    it('G1 완전 AI 생성이 성공해도 루틴 0회이고, draft 로의 replace 는 그대로 1회다', () => {
      // 준비
      mockPhase = 'success';

      // 실행
      render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);

      // 단언 — 앵커(replace = 성공 콜백이 돌았다) + 부정(루틴 0회)
      expect(mockPrompt).toHaveBeenCalledTimes(0);
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/draft',
        params: { tripId: TRIP_ID },
      });
    });

    it('G2 같이 짜기(CO_PLAN) 생성이 성공해도 루틴 0회', () => {
      mockPhase = 'success';

      render(
        <GeneratingPage
          tripId={TRIP_ID}
          mode="CO_PLAN"
          successRoute="/trips/[tripId]/itinerary/copick/[slotKey]"
        />
      );

      expect(mockPrompt).toHaveBeenCalledTimes(0);
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });
  });

  describe('TRIP-1108 AC-6 · 성공이 아니어도 묻지 않는다(원래부터)', () => {
    it('G3 생성이 실패하면 루틴 0회', () => {
      mockPhase = 'error';

      render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);

      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('G4 생성이 아직 진행 중이면 루틴 0회(마운트하자마자 묻지 않는다)', () => {
      mockPhase = 'pending';

      render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);

      expect(mockPrompt).not.toHaveBeenCalled();
    });
  });

  describe('🔴 TRIP-1108 AC-6 · 미뤄 부르는 것도, 다른 푸시 함수도 금지', () => {
    it('G5 성공 착지 뒤 마이크로태스크를 흘려도 루틴 0회이고, replace 인자·횟수는 그대로다', async () => {
      // 준비
      mockPhase = 'success';

      // 실행 — 렌더 후 대기 중인 then/queueMicrotask 를 모두 흘린다
      render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);
      await act(async () => {});

      // 단언 — 동기든 미뤄서든 부르지 않았다
      expect(mockPrompt).toHaveBeenCalledTimes(0);
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/draft',
        params: { tripId: TRIP_ID },
      });
    });

    it('G6 생성 화면은 푸시 함수(묻고 등록·조회 등록·요청)를 하나도 부르지 않는다', () => {
      mockPhase = 'success';

      render(<GeneratingPage tripId={TRIP_ID} mode="FULLY_AI" />);

      // 앵커 — 성공 콜백이 돌았다
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(registerPushIfGranted).not.toHaveBeenCalled();
      expect(requestPushPermission).not.toHaveBeenCalled();
    });
  });
});
