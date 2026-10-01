import { act, render } from '@testing-library/react-native';

import {
  promptAndRegisterPush,
  registerPushIfGranted,
  requestPushPermission,
} from '@/shared/push';

import { GeneratingPage } from './GeneratingPage';

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

// jest.mock 팩토리는 파일 맨 위로 호이스팅된다 — 바깥 변수는 `mock` 으로 시작하는 이름만 볼 수 있다.
let mockPhase: 'pending' | 'success' | 'error' = 'pending';

// 훅 옵션 콜백은 라이브러리처럼 4번째 인자(`{ client, meta, mutationKey }`)까지 받는다 — TRIP-1015 A 가
// 생성 성공을 훅 옵션 `onSuccess` 의 `context.client` 로 일정 캐시에 반영하기 때문이다(3인자만 주면 목이
// 라이브러리와 달라져 옳은 구현이 `undefined.client` 로 죽는다).
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

const mockReplace = jest.fn();

jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: (hookOptions?: {
    mutation?: MutationCallbacks;
  }) => ({
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
  }),
  // TRIP-1032: 생성 화면이 다른 여행 생성 취소(409 안내)용 cancel 훅을 물 수 있다 — 형제 두 파일처럼
  // 무해한 스텁을 둔다(없으면 페이지 최상위 호출이 `is not a function` 으로 이 파일 전체를 죽인다).
  usePostTripsTripIdGenerationSessionsSessionIdCancel: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
  useGetTripsTripIdMustVisits: () => ({
    data: [],
    isPending: false,
    isError: false,
  }),
  // TRIP-1015 A: 생성 성공 콜백이 일정 캐시 키를 만든다 — 실물과 같은 모양(`[/trips/{id}/itinerary]`).
  getGetTripsTripIdItineraryQueryKey: (tripId: string) => [
    `/trips/${tripId}/itinerary`,
  ],
}));

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => ({ savedPlaces: [], isPending: false, isError: false }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
    back: jest.fn(),
    navigate: jest.fn(),
  }),
}));

const mockPrompt = promptAndRegisterPush as jest.Mock;
const TRIP_ID = 't1';

beforeEach(() => {
  jest.clearAllMocks();
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
