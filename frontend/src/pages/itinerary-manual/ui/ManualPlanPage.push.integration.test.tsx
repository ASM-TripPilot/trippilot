import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender } from '@testing-library/react-native';

import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import type { Itinerary } from '@/shared/api/generated/schemas';
import { promptAndRegisterPush } from '@/shared/push';

import { ManualPlanPage } from './ManualPlanPage';

/**
 * TRIP-835 · AC-3(직접 짜기) — 빈 MANUAL 일정이 **처음 만들어진 순간** 알림 권한을 묻는다(01b Q2).
 *
 * 무엇을 보장하나:
 *  - MANUAL 생성 POST 가 성공하면 `promptAndRegisterPush()` 1회.
 *  - POST 가 실패하면 0회.
 *  - 기존 초안이 있어 POST 를 건너뛰면 0회 — "처음 만든" 게 아니다.
 *  - 조회가 아직 로딩 중이라 POST 를 보류하는 동안에도 0회.
 *
 * `GeneratingPage.push.integration.test.tsx` 와 대칭이다(같은 루틴, 같은 뮤테이션 목 모양 — 02a ★8).
 *
 * 3동작 뼈대: 준비=GET 상태·POST 결과 → 실행=페이지 렌더 → 단언=루틴 호출 횟수.
 */

let mockGet: {
  data: Itinerary | undefined;
  isPending: boolean;
  isError: boolean;
};
let mockPostPhase: 'pending' | 'success' | 'error' = 'pending';
const mockPostMutate = jest.fn();

type MutationCallbacks = {
  onSuccess?: (data: unknown, variables: unknown, context: unknown) => void;
  onError?: (error: unknown, variables: unknown, context: unknown) => void;
};

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
      mockPostMutate(variables);
      const data = {
        itineraryId: 'it1',
        tripId: 't1',
        status: 'PLANNED',
        solveMode: 'MINIMAL',
        generationMode: 'MANUAL',
        isFallback: false,
        generationState: 'COMPLETE',
        days: [{ date: '2026-06-10', slots: [] }],
      };
      if (mockPostPhase === 'success') {
        hookOptions?.mutation?.onSuccess?.(data, variables, undefined);
        mutateOptions?.onSuccess?.(data, variables, undefined);
      } else if (mockPostPhase === 'error') {
        const error = new Error('500');
        hookOptions?.mutation?.onError?.(error, variables, undefined);
        mutateOptions?.onError?.(error, variables, undefined);
      }
    },
    isPending: mockPostPhase === 'pending',
    isError: mockPostPhase === 'error',
  }),
  useGetTripsTripIdItinerary: () => mockGet,
  usePutTripsTripIdItinerary: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
  getGetTripsTripIdItineraryQueryKey: (tripId: string) => [
    `/trips/${tripId}/itinerary`,
  ],
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// EditorView → MapSheetShell → MapView 는 jest 에서 못 뜬다(형제 테스트 선례).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const mockPrompt = promptAndRegisterPush as jest.Mock;
const TRIP_ID = 't1';

/** 기존 AI 초안 — 이게 있으면 페이지는 POST 를 건너뛴다. */
const EXISTING_DRAFT: Itinerary = {
  itineraryId: 'it2',
  tripId: TRIP_ID,
  status: 'PLANNED',
  solveMode: 'FULL_AI',
  generationMode: 'FULLY_AI',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [
    {
      date: '2026-06-10',
      slots: [
        {
          poiId: 'p1',
          nameKo: '경복궁',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
      ],
    },
  ],
};

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return rtlRender(ui, { wrapper: Wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet = { data: undefined, isPending: true, isError: false };
  mockPostPhase = 'pending';
  // 편집 스토어는 모듈 싱글턴 — 앞 케이스의 시드가 새지 않게 비운다.
  useItineraryEditStore.getState().reset();
});

describe('TRIP-835 AC-3 · 직접 짜기 — 빈 일정이 처음 생기면 1회 묻는다', () => {
  it('M1 일정이 없어(GET 404) MANUAL POST 가 성공하면 루틴 1회', () => {
    // 준비
    mockGet = { data: undefined, isPending: false, isError: true };
    mockPostPhase = 'success';

    // 실행
    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 단언
    expect(mockPostMutate).toHaveBeenCalledTimes(1);
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-835 AC-3 · 직접 짜기 — 처음 만든 게 아니면 묻지 않는다', () => {
  it('M2 MANUAL POST 가 실패하면 루틴 0회', () => {
    mockGet = { data: undefined, isPending: false, isError: true };
    mockPostPhase = 'error';

    render(<ManualPlanPage tripId={TRIP_ID} />);

    expect(mockPostMutate).toHaveBeenCalledTimes(1);
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('M3 기존 초안이 있어 POST 를 건너뛰면 루틴 0회', () => {
    mockGet = { data: EXISTING_DRAFT, isPending: false, isError: false };
    mockPostPhase = 'success';

    render(<ManualPlanPage tripId={TRIP_ID} />);

    // 짝: POST 자체가 안 나갔다(건너뛴 경로를 실제로 탔다).
    expect(mockPostMutate).not.toHaveBeenCalled();
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('M4 조회가 아직 로딩 중이라 POST 를 보류하는 동안 루틴 0회', () => {
    mockGet = { data: undefined, isPending: true, isError: false };
    mockPostPhase = 'success';

    render(<ManualPlanPage tripId={TRIP_ID} />);

    expect(mockPostMutate).not.toHaveBeenCalled();
    expect(mockPrompt).not.toHaveBeenCalled();
  });
});
