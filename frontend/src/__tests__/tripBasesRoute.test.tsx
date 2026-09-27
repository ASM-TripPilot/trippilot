import { render } from '@testing-library/react-native';

import TripBasesRoute from '@/app/trips/[tripId]/bases';

/**
 * TRIP-1011 C — 라우트 `trips/[tripId]/bases` → TripBasesPage 위임(5-b 경고-3, 오케 보강).
 *
 * 무엇을 보장하나: 라우트는 `useLocalSearchParams` 의 `tripId` 를 그대로 페이지에 넘긴다. 3/4 '거점 숙소
 * 다시 고르기'가 `{ tripId }` 로 push 하므로, 다른 키를 읽으면 페이지가 여행을 못 찾아 3/4 로 되돌아간다.
 *
 * ★ `@/pages/trip-new-step2` 를 스파이로 치환해 위임만 본다(planbRequestRoute 선례).
 */

const mockCaptured: { props?: { tripId?: string } } = {};
let mockParams: Record<string, string | undefined> = {};

jest.mock('@/pages/trip-new-step2', () => ({
  TripBasesPage: (props: { tripId?: string }) => {
    mockCaptured.props = props;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
}));

beforeEach(() => {
  mockCaptured.props = undefined;
  mockParams = {};
});

describe('거점 다시 고르기 라우트 — TripBasesPage 위임', () => {
  it('🔴 T1 tripId 를 그대로 넘긴다', () => {
    // 준비 — 3/4 링크가 싣는 파라미터
    mockParams = { tripId: 'trip-1' };
    // 실행
    render(<TripBasesRoute />);
    // 단언
    expect(mockCaptured.props?.tripId).toBe('trip-1');
  });
});
