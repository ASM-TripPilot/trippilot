import { render } from '@testing-library/react-native';

import PlanbTriggersRoute from '@/app/trips/[tripId]/planb/triggers';

/**
 * TRIP-562 · AC-4 라우트 파트 — `trips/[tripId]/planb/triggers` → PlanbTriggersPage 얇은 위임.
 *
 * 무엇을 보장하나: 라우트는 `useLocalSearchParams` 로 받은 `tripId` 를 **그대로** `PlanbTriggersPage`
 * 에 넘기는 얇은 위임이다(하드코딩/드롭 차단). 진입 FAB→이 라우트가 감시 목록 화면을 연다.
 *
 * ★ `@/pages/planb-triggers` 를 스파이 컴포넌트로 치환 — 실 페이지 렌더를 차단하고 위임만 관찰
 *   (planbManualRoute·liveLocationRoute 선례). 라우트·배럴 미존재 시 모듈 미해석으로 red.
 */

const mockCaptured: { tripId?: string; rendered: boolean } = {
  rendered: false,
};

jest.mock('@/pages/planb-triggers', () => ({
  PlanbTriggersPage: (props: { tripId?: string }) => {
    mockCaptured.tripId = props.tripId;
    mockCaptured.rendered = true;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ tripId: 'trip-1' }),
}));

beforeEach(() => {
  mockCaptured.tripId = undefined;
  mockCaptured.rendered = false;
});

describe('🔴 planb/triggers 라우트 — PlanbTriggersPage 위임', () => {
  it('R1 params 의 tripId 를 그대로 PlanbTriggersPage 에 넘긴다', () => {
    render(<PlanbTriggersRoute />);

    expect(mockCaptured.rendered).toBe(true);
    expect(mockCaptured.tripId).toBe('trip-1');
  });

  it('R2 라우트 렌더 자체가 던지지 않는다 — 얇은 위임이다', () => {
    expect(() => render(<PlanbTriggersRoute />)).not.toThrow();
  });
});
