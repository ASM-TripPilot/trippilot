import { render } from '@testing-library/react-native';

import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import { DailyReflectionScreen } from '@/features/reflection/ui/DailyReflectionScreen';
import { DailyReflectionPage } from './DailyReflectionPage';

/**
 * TRIP-762 · AC-11 — j03 오늘의 회고 헤더 **공유 게이트·배선 제거**(구 TRIP-574 공유 게이트 폐기).
 *
 * 라이브 j03 에 공유가 0 이라, 페이지가 `useGetTripsTripId(...).status==='ENDED'` 로 공유를
 * 판정해 화면에 `canShare`/`onShare` 로 내리던 배선을 **제거**한다. 화면은 props-캡처 목으로 치환해
 * 페이지가 넘기는 props 만 본다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 페이지가 화면에 `onShare` 를 넘기지 않는다(공유 배선 제거 — 현행은 함수를 넘기므로 red).
 *  - 🔴 페이지가 화면에 `canShare` 를 넘기지 않는다(status 게이트 제거).
 *  - 긍정 짝 — 화면은 여전히 배선된다(narrative 등 완성 VM 이 넘어온다 — 페이지가 안 깨졌다는 앵커).
 *
 * (개념) `jest.fn(() => null)` 화면 목 → `mock.calls[0][0]` 이 전달 props · `toBeUndefined()` = 그
 *   prop 자체가 안 넘어왔음을 단언(공유 배선 부재).
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), canGoBack: jest.fn(() => true), back: jest.fn() },
}));

jest.mock('@/features/reflection/model/useDailyReflection', () => ({
  useDailyReflection: jest.fn(),
}));

// 페이지가 공유 게이트로 쓰던 trip 조회 — 제거 후엔 안 불릴 수도, 일차 조립에 쓰일 수도 있어
// 무해한 기본값으로 목한다(불리든 안 불리든 이 테스트는 화면 props 만 본다).
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripId: jest.fn(() => ({
    data: undefined,
    isPending: false,
    isError: false,
  })),
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

describe('🔴 AC-11 · 페이지가 공유를 화면에 배선하지 않는다(게이트 제거)', () => {
  it('onShare·canShare 를 넘기지 않고, 화면은 여전히 배선된다', () => {
    mockDaily();

    render(<DailyReflectionPage tripId="trip-1" date="2026-06-11" />);

    const props = capturedProps();
    // 부정 — 공유 배선 제거.
    expect(props.onShare).toBeUndefined();
    expect(props.canShare).toBeUndefined();
    // 긍정 짝 — 화면은 완성 VM 으로 배선된다(페이지가 안 깨졌다).
    expect(props.narrative).toBeDefined();
  });
});
