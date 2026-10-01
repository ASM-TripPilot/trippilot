import { render } from '@testing-library/react-native';

import LiveRoute from '@/app/trips/[tripId]/live/index';

/**
 * TRIP-754 · AC-9 — 라우트 `trips/[tripId]/live` → LiveItineraryPage 위임.
 *
 * 무엇을 보장하나: 라우트는 `useLocalSearchParams` 의 `tripId` 와 `applied`(i06 적용 성공 신호, 751 E1)를
 * `LiveItineraryPage` 의 `tripId`·`appliedSessionId` 로 넘기는 얇은 위임이다. 페이지는 라우터 파라미터를
 * 모른 채 테스트된다(`live/location.tsx` 선례).
 *
 * ★ `@/pages/live-itinerary` 를 스파이 컴포넌트로 치환 — 실 페이지 렌더를 막고 위임만 본다.
 *
 * 3동작: 준비(params 목 + 페이지 스파이) → 실행(라우트 렌더) → 단언(넘긴 props).
 */

const mockParams: Record<string, string> = {};
const mockCaptured: { props?: Record<string, unknown> } = {};

jest.mock('@/pages/live-itinerary', () => ({
  LiveItineraryPage: (props: Record<string, unknown>) => {
    mockCaptured.props = props;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockParams }),
}));

beforeEach(() => {
  Object.keys(mockParams).forEach((key) => delete mockParams[key]);
  mockCaptured.props = undefined;
});

describe('🔴 RT · live 라우트 — applied → appliedSessionId', () => {
  it('RT1 applied 쿼리를 appliedSessionId 로 넘긴다', () => {
    mockParams.tripId = 'trip-1';
    mockParams.applied = 's1';

    render(<LiveRoute />);

    expect(mockCaptured.props?.tripId).toBe('trip-1');
    expect(mockCaptured.props?.appliedSessionId).toBe('s1');
  });

  it('RT2 applied 가 없으면 appliedSessionId 도 없다', () => {
    mockParams.tripId = 'trip-1';

    render(<LiveRoute />);

    expect(mockCaptured.props?.tripId).toBe('trip-1');
    expect(mockCaptured.props?.appliedSessionId).toBeUndefined();
  });
});
