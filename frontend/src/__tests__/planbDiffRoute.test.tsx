import { render } from '@testing-library/react-native';

import PlanbDiffRoute from '@/app/trips/[tripId]/planb/diff';

/**
 * TRIP-441 · AC-6 — 재계획 확정 라우트 `trips/[tripId]/planb/diff` — planb-diff 위임(얇은 라우트).
 *
 * 무엇을 보장하나: 라우트가 `useLocalSearchParams` 로 받은 tripId·sessionId 를 **그대로
 * `PlanbDiffPage` 에 넘기는 얇은 위임**이다. 조회·배선·판정은 라우트가 직접 지지 않는다(페이지 몫).
 * 진입 배선(어디서 이 라우트로 오는가)은 후속 — 여기선 딥링크·프리뷰 도달만 전제하고 위임만 잰다.
 *
 * ★ `@/pages/planb-diff` 를 스파이 컴포넌트로 치환한다 — 실 페이지를 렌더하면 seam 훅이 얽혀
 *   위임 관찰이 흐려진다. 라우트가 실배선을 물지 않는다는 것(위임)이 이 목으로 증명된다.
 * ⚠️ 구현 전에는 `@/app/.../diff` · `@/pages/planb-diff` 모듈이 없어 jest.mock/ import 가 경로를
 *   해석하지 못해 이 suite 는 **모듈 미해석 red** 다(placeDetailStubRoute 와 같은 신규-모듈 red).
 */

// `mock` 접두 변수만 jest.mock 팩토리가 참조할 수 있다(hoist 규칙). 위임된 페이지가 받은
// params 를 이 캡처 객체에 담고, 컴포넌트는 null 을 그려 트리를 오염시키지 않는다.
const mockCaptured: {
  tripId?: string;
  sessionId?: string;
  rendered: boolean;
} = { rendered: false };

jest.mock('@/pages/planb-diff', () => ({
  PlanbDiffPage: (props: { tripId?: string; sessionId?: string }) => {
    mockCaptured.tripId = props.tripId;
    mockCaptured.sessionId = props.sessionId;
    mockCaptured.rendered = true;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ tripId: 't1', sessionId: 's1' }),
}));

beforeEach(() => {
  mockCaptured.tripId = undefined;
  mockCaptured.sessionId = undefined;
  mockCaptured.rendered = false;
});

describe('재계획 확정 라우트 — PlanbDiffPage 위임(AC-6)', () => {
  it('R1 · useLocalSearchParams 의 tripId·sessionId 를 그대로 넘긴다', () => {
    render(<PlanbDiffRoute />);

    expect(mockCaptured.rendered).toBe(true);
    expect(mockCaptured.tripId).toBe('t1');
    expect(mockCaptured.sessionId).toBe('s1');
  });

  it('R2 · 라우트 렌더 자체가 던지지 않는다 — 얇은 위임', () => {
    expect(() => render(<PlanbDiffRoute />)).not.toThrow();
  });
});
