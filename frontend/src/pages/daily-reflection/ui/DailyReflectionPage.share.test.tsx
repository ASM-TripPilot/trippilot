import { render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';

import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import { DailyReflectionScreen } from '@/features/reflection/ui/DailyReflectionScreen';
import { DailyReflectionPage } from './DailyReflectionPage';

/**
 * TRIP-574 · AC-6b·AC-4(j03) — j03 오늘의 회고 헤더 공유 게이트·배선.
 *
 * j03 은 여행 "중" 화면이라 공유는 종료·요약된 여행에서만 열린다 — 계약에 회고 자체엔 종료 신호가 없어
 * 페이지가 추가 조회 `useGetTripsTripId(tripId).status==='ENDED'` 로 게이트를 판정하고 화면에 `canShare`/
 * `onShare` 로 내린다(Q3). 화면은 props-캡처 목으로 치환(null 반환)해 페이지 게이트·배선만 본다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-6b: status==='ENDED' → `canShare:true` + onShare 호출 시 `/trips/${tripId}/records/share` push.
 *  - 🔴 AC-4(j03): status!=='ENDED'(예: ACTIVE) → `canShare:false`(진입점 잠금 — 실제 disabled 거동은
 *    `DailyReflectionScreen.share.test.tsx` 화면 단위가 잠근다).
 *
 * (개념) `jest.fn(() => null)` 화면 목 → `mock.calls[0][0]` 이 전달 props · `toHaveBeenCalledWith` = 인자 일치.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), canGoBack: jest.fn(() => true), back: jest.fn() },
}));

jest.mock('@/features/reflection/model/useDailyReflection', () => ({
  useDailyReflection: jest.fn(),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripId: jest.fn(),
}));

jest.mock('@/features/reflection/ui/DailyReflectionScreen', () => ({
  DailyReflectionScreen: jest.fn(() => null),
}));

function mockDaily() {
  (useDailyReflection as jest.Mock).mockReturnValue({
    reflection: undefined,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
    create: jest.fn(),
    saveEdit: jest.fn(),
  });
}

function capturedProps() {
  return (DailyReflectionScreen as unknown as jest.Mock).mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('🔴 AC-6b · 종료 여행 → 공유 활성 + j06 라우트 push', () => {
  it("status==='ENDED' → canShare:true, onShare → /trips/{tripId}/records/share", () => {
    mockDaily();
    (useGetTripsTripId as jest.Mock).mockReturnValue({
      data: { status: 'ENDED' },
      isPending: false,
      isError: false,
    });

    render(<DailyReflectionPage tripId="trip-1" date="2026-06-11" />);

    const props = capturedProps();
    expect(props.canShare).toBe(true);

    props.onShare();
    expect(router.push).toHaveBeenCalledWith('/trips/trip-1/records/share');
  });
});

describe('🔴 AC-4(j03) · 종료·요약 전이면 게이트가 닫힌다(BR-U5-48)', () => {
  it("status==='ACTIVE' → canShare:false", () => {
    mockDaily();
    (useGetTripsTripId as jest.Mock).mockReturnValue({
      data: { status: 'ACTIVE' },
      isPending: false,
      isError: false,
    });

    render(<DailyReflectionPage tripId="trip-1" date="2026-06-11" />);

    expect(capturedProps().canShare).toBe(false);
  });
});
