import { render } from '@testing-library/react-native';

import PlanbManualRoute from '@/app/trips/[tripId]/planb/manual';

/**
 * TRIP-443 · AC-5 진입 신호 — 라우트 `trips/[tripId]/planb/manual` → PlanbManualPage 위임.
 *
 * 무엇을 보장하나: 라우트는 `useLocalSearchParams` 로 받은 `tripId`·`variant` 를 **그대로**
 * `PlanbManualPage` 에 넘기는 얇은 위임이다. `variant` 를 흘려야 폴백 진입(error=i22)과 정상
 * [직접 고르기] 진입(미지정=i15)이 갈린다(신호 겹침을 라우트 파라미터로 가름).
 *
 * ★ `@/pages/planb-manual` 을 스파이 컴포넌트로 치환 — 실 페이지 렌더를 차단하고 위임만 관찰
 *   (liveLocationRoute·placeDetailStubRoute 선례). 스텁 라우트는 페이지를 안 렌더해 red.
 *
 * 3동작: 준비(params 목 + 페이지 스파이) → 실행(라우트 렌더) → 단언(위임된 props).
 */

const mockCaptured: {
  tripId?: string;
  variant?: string;
  rendered: boolean;
} = { rendered: false };

jest.mock('@/pages/planb-manual', () => ({
  PlanbManualPage: (props: { tripId?: string; variant?: string }) => {
    mockCaptured.tripId = props.tripId;
    mockCaptured.variant = props.variant;
    mockCaptured.rendered = true;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    tripId: 'trip-1',
    variant: 'error',
  }),
}));

beforeEach(() => {
  mockCaptured.tripId = undefined;
  mockCaptured.variant = undefined;
  mockCaptured.rendered = false;
});

describe('🔴 planb/manual 라우트 — PlanbManualPage 위임', () => {
  it('params 의 tripId·variant 를 그대로 PlanbManualPage 에 넘긴다', () => {
    render(<PlanbManualRoute />);

    expect(mockCaptured.rendered).toBe(true);
    expect(mockCaptured.tripId).toBe('trip-1');
    expect(mockCaptured.variant).toBe('error');
  });

  it('라우트 렌더 자체가 던지지 않는다 — 얇은 위임이다', () => {
    expect(() => render(<PlanbManualRoute />)).not.toThrow();
  });
});
