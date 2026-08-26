import { render } from '@testing-library/react-native';

import LiveLocationRoute from '@/app/trips/[tripId]/live/location';

/**
 * TRIP-442 · AC-5 — 라우트 `trips/[tripId]/live/location` → LiveLocationPage 위임.
 *
 * 무엇을 보장하나: 라우트는 `useLocalSearchParams` 로 받은 `tripId`·`state` 를 **그대로**
 * `LiveLocationPage` 에 넘기는 얇은 위임이다(조회·마크업 없음). `state` 를 흘려야 딥링크/프리뷰가
 * i20/i21 얼굴을 고를 수 있다(Seed: 진입 배선 딥링크·프리뷰 전용).
 *
 * ★ `@/pages/live-location` 을 스파이 컴포넌트로 치환 — 실 페이지 렌더를 차단하고 위임만 관찰
 *   (placeDetailStubRoute 선례). 구현 전에는 라우트 파일·페이지 모듈이 없어 **모듈 미해석 red** 다.
 *
 * 3동작: 준비(params 목 + 페이지 스파이) → 실행(라우트 렌더) → 단언(위임된 props).
 */

// `mock` 접두 변수만 jest.mock 팩토리가 참조 가능(hoist 규칙). 위임받은 props 를 캡처하고
// 컴포넌트는 null 을 그려 트리를 오염시키지 않는다.
const mockCaptured: {
  tripId?: string;
  state?: string;
  rendered: boolean;
} = { rendered: false };

jest.mock('@/pages/live-location', () => ({
  LiveLocationPage: (props: { tripId?: string; state?: string }) => {
    mockCaptured.tripId = props.tripId;
    mockCaptured.state = props.state;
    mockCaptured.rendered = true;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    tripId: 'trip-1',
    state: 'permission-denied',
  }),
}));

beforeEach(() => {
  mockCaptured.tripId = undefined;
  mockCaptured.state = undefined;
  mockCaptured.rendered = false;
});

describe('live/location 라우트 — LiveLocationPage 위임', () => {
  it('params 의 tripId·state 를 그대로 LiveLocationPage 에 넘긴다', () => {
    // 준비·실행 — QueryClientProvider 없이 라우트만 렌더(위임이므로 실훅을 안 문다).
    render(<LiveLocationRoute />);

    // 단언
    expect(mockCaptured.rendered).toBe(true);
    expect(mockCaptured.tripId).toBe('trip-1');
    expect(mockCaptured.state).toBe('permission-denied');
  });

  it('라우트 렌더 자체가 던지지 않는다 — 얇은 위임이다', () => {
    expect(() => render(<LiveLocationRoute />)).not.toThrow();
  });
});
