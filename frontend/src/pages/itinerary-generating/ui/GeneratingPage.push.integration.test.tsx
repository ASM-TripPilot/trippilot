import { render } from '@testing-library/react-native';

import {
  promptAndRegisterPush,
  registerPushIfGranted,
  requestPushPermission,
} from '@/shared/push';

import { GeneratingPage } from './GeneratingPage';

/**
 * TRIP-835 · AC-3 — 일정이 **처음 만들어진 직후** 알림 권한을 묻는다(AI·같이 짜기 경로).
 *
 * 무엇을 보장하나:
 *  - 생성 POST 가 **성공**하면 `promptAndRegisterPush()` 를 1회 부른다(FULLY_AI·CO_PLAN 공통).
 *  - 실패하거나 아직 진행 중이면 0회 — 마운트하자마자 묻지 않는다.
 *  - 루틴이 끝나지 않아도 기존 `router.replace` 인자·횟수는 그대로다(화면 이동이 다이얼로그를 기다리지 않는다).
 *
 * 왜 목인가: 여기서 보는 것은 "성공 콜백에서 불렀나"뿐이다. 루틴 내부(요청 게이트·등록)는
 *  `shared/push/wiring.test.ts` 가 잰다.
 *
 * ★ 뮤테이션 목은 훅 옵션과 mutate 옵션의 onSuccess 를 **둘 다** 부른다(02a ★8) — 구현이 어느 쪽에
 *   달든 정답이다.
 * ★ 루틴 목에 reject 를 주지 않는다(02a ★9) — 루틴은 reject 하지 않는 것이 계약이라 페이지는 기다리지
 *   않고 부른다. 여기선 "영원히 안 끝남"만 넣는다.
 *
 * 3동작 뼈대: 준비=생성 결과(phase)·씨앗 → 실행=페이지 렌더(마운트가 POST 를 쏜다) → 단언=루틴·이동 호출.
 */

// jest.mock 팩토리는 파일 맨 위로 호이스팅된다 — 바깥 변수는 `mock` 으로 시작하는 이름만 볼 수 있다.
let mockPhase: 'pending' | 'success' | 'error' = 'pending';

type MutationCallbacks = {
  onSuccess?: (data: unknown, variables: unknown, context: unknown) => void;
  onError?: (error: unknown, variables: unknown, context: unknown) => void;
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
      if (mockPhase === 'success') {
        hookOptions?.mutation?.onSuccess?.(data, variables, undefined);
        mutateOptions?.onSuccess?.(data, variables, undefined);
      } else if (mockPhase === 'error') {
        const error = new Error('500');
        hookOptions?.mutation?.onError?.(error, variables, undefined);
        mutateOptions?.onError?.(error, variables, undefined);
      }
    },
    isPending: mockPhase === 'pending',
    isError: mockPhase === 'error',
  }),
  useGetTripsTripIdMustVisits: () => ({
    data: [],
    isPending: false,
    isError: false,
  }),
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

describe('TRIP-835 AC-3 · 첫 일정 생성 성공 → 권한 요청 루틴 1회', () => {
  it('G1 완전 AI 생성이 성공하면 루틴을 1회 부르고, draft 로의 replace 는 그대로 1회다', () => {
    // 준비
    mockPhase = 'success';

    // 실행
    render(<GeneratingPage tripId={TRIP_ID} />);

    // 단언
    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/draft',
      params: { tripId: TRIP_ID },
    });
  });

  it('G2 같이 짜기(CO_PLAN) 생성이 성공해도 루틴을 1회 부른다', () => {
    mockPhase = 'success';

    render(
      <GeneratingPage
        tripId={TRIP_ID}
        mode="CO_PLAN"
        successRoute="/trips/[tripId]/itinerary/copick/[slotKey]"
      />
    );

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-835 AC-3 · 성공이 아니면 묻지 않는다', () => {
  it('G3 생성이 실패하면 루틴 0회', () => {
    mockPhase = 'error';

    render(<GeneratingPage tripId={TRIP_ID} />);

    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('G4 생성이 아직 진행 중이면 루틴 0회(마운트하자마자 묻지 않는다)', () => {
    mockPhase = 'pending';

    render(<GeneratingPage tripId={TRIP_ID} />);

    expect(mockPrompt).not.toHaveBeenCalled();
  });
});

describe('TRIP-835 AC-3 · 루틴은 화면 이동을 막지 않는다', () => {
  it('G5 루틴이 영원히 끝나지 않아도 replace 인자·횟수는 그대로다', () => {
    // 준비: 다이얼로그 앞에서 사용자가 한참 망설이는 상황.
    mockPhase = 'success';
    mockPrompt.mockImplementation(() => new Promise(() => {}));

    render(<GeneratingPage tripId={TRIP_ID} />);

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary/draft',
      params: { tripId: TRIP_ID },
    });
  });

  it('G6 생성 화면은 "묻고 등록" 루틴 하나만 쓴다 — 조회 전용 등록·요청 함수를 따로 부르지 않는다', () => {
    mockPhase = 'success';

    render(<GeneratingPage tripId={TRIP_ID} />);

    expect(registerPushIfGranted).not.toHaveBeenCalled();
    expect(requestPushPermission).not.toHaveBeenCalled();
  });
});
