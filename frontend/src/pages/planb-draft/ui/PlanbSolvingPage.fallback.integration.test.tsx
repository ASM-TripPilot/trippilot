import { render, screen } from '@testing-library/react-native';

import { PlanbSolvingPage } from './PlanbSolvingPage';

/**
 * TRIP-443 · AC-5(106-A · INV-4) — 재계획 세션이 FAILED 면 침묵 실패 없이 수동 편집 화면으로
 * 전환한다: `resolveReplanState` FAILED → `planb/manual?variant=error`(i22) push.
 *
 * 무엇을 보장하나:
 *  - 🔴 FAILED 폴링이면 `router.push({pathname:'/trips/[tripId]/planb/manual', params:{tripId, variant:'error'}})`
 *    가 정확히 1회 나간다(진입 신호 = variant, isFallback/solveMode 아님).
 *  - 🔴 FAILED 는 i12 solving 얼굴을 그리지 않는다(폴백 전환이지 로딩 지속 아님).
 *  - 🔴 back·cancel 은 안 불린다(엉뚱한 항법 없음).
 *
 * ★ 별 파일(02a) — 동결 `PlanbSolvingPage.integration.test.tsx`(SOLVING)는 module 목이 SOLVING 을
 *   고정해 FAILED 를 못 태운다. `ItineraryPlanPage.escape.integration` 선례처럼 새 파일로 갈래를 연다.
 *   106-A 는 SOLVING 얼굴에 무영향(effect 가 failed 에서만 발화) — 동결 파일 무수정.
 *
 * red 판정: 현행 PlanbSolvingPage 는 non-solving 을 null 로 접어 push 가 없다 → mockPush 미호출 → red.
 */

const TRIP_ID = 't1';
const SESSION_ID = 's9';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCancel = jest.fn();

// 세션 조회 seam — FAILED 를 준다(폴링 결과 shape 은 codegen useQuery 반환의 부분집합).
jest.mock('@/features/planb/model/useReplanSession', () => ({
  useReplanSession: () => ({
    data: { status: 'FAILED', sessionId: 's9', tripId: 't1' },
    isPending: false,
    isError: false,
  }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdReplanSessionsSessionIdCancel: () => ({
    mutate: mockCancel,
    isPending: false,
    isError: false,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: mockPush,
    replace: mockReplace,
  }),
  router: { back: mockBack, push: mockPush, replace: mockReplace },
}));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCancel.mockClear();
});

describe('🔴 106-A · AC-5 — FAILED → planb/manual?variant=error 로 전환한다', () => {
  it('router.push 가 manual 라우트로 variant=error 를 담아 1회 나간다', () => {
    render(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/planb/manual',
      params: { tripId: TRIP_ID, variant: 'error' },
    });
  });

  it('FAILED 는 i12 solving 얼굴을 안 그리고, back·cancel 도 안 부른다', () => {
    render(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);

    expect(screen.queryByTestId('planb-solving-progress')).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
