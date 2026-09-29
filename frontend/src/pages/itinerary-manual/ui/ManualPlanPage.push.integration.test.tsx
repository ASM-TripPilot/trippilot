import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender } from '@testing-library/react-native';

import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import type { Itinerary } from '@/shared/api/generated/schemas';
import { promptAndRegisterPush } from '@/shared/push';

import { ManualPlanPage } from './ManualPlanPage';

/**
 * TRIP-1108 AC-7(직접 짜기) — 빈 MANUAL 일정이 처음 만들어져도 알림 권한을 **묻지 않는다**.
 *
 * 역사: TRIP-835 는 빈 일정이 처음 생긴 순간 권한을 묻게 했다(M1 이 1회를 단언했다). TRIP-1108 이 묻는 자리를
 * 온보딩 사전 안내 카드로 옮겼으므로 M1 을 **0회로 뒤집어** 금지 그물로 남긴다(파일은 지우지 않는다).
 *
 * 무엇을 보장하나:
 *  - MANUAL 생성 POST 가 성공해도 `promptAndRegisterPush()` 0회 — 성공 콜백이 실제로 돌았다는 앵커는
 *    그 콜백이 하는 재조회(`invalidateQueries`)다.
 *  - POST 실패·기존 초안으로 건너뜀·조회 로딩 중 보류에도 0회(원래부터).
 *
 * `GeneratingPage.push.integration.test.tsx` 와 대칭이다(같은 루틴, 같은 뮤테이션 목 모양).
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
  // TRIP-1022 — 페이지가 빈 편집기 지도 중심용 거점 조회를 부른다(단언 무관 준비 — 없으면 전 케이스가
  // "is not a function" 으로 죽는다, 02a ★1).
  useGetTripsTripIdBases: () => ({
    data: [],
    isPending: false,
    isError: false,
  }),
  // TRIP-1038 B — 「저장하고 확정하기」가 확정 POST 훅을 부른다(이 파일은 저장을 누르지 않는다 · 단언 무관 준비).
  usePostTripsTripIdItineraryConfirm: () => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
    isError: false,
  }),
}));

// TRIP-1022 — 거점 숙소 좌표 조회. 실물이 돌면 msw 없는 이 파일에서 실 axios 요청이 샌다(02a ★2).
jest.mock('@/shared/api/generated/saved-stays/saved-stays', () => ({
  useGetSavedStays: () => ({ data: [], isPending: false, isError: false }),
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
          alternatives: [],
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

describe('🔴 TRIP-1108 AC-7 · 직접 짜기 — 빈 일정이 처음 생겨도 묻지 않는다', () => {
  it('M1 일정이 없어(GET 404) MANUAL POST 가 성공해도 루틴 0회', () => {
    // 준비 — 성공 콜백의 재조회를 엿본다(= onSuccess 가 실제로 돌았다는 앵커)
    const invalidate = jest.spyOn(QueryClient.prototype, 'invalidateQueries');
    mockGet = { data: undefined, isPending: false, isError: true };
    mockPostPhase = 'success';

    try {
      // 실행
      render(<ManualPlanPage tripId={TRIP_ID} />);

      // 단언 — 앵커(POST 1회 + 성공 콜백 실행) + 부정(루틴 0회)
      expect(mockPostMutate).toHaveBeenCalledTimes(1);
      expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(mockPrompt).toHaveBeenCalledTimes(0);
    } finally {
      invalidate.mockRestore();
    }
  });
});

describe('TRIP-1108 AC-7 · 직접 짜기 — 처음 만든 게 아니어도 묻지 않는다(원래부터)', () => {
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
