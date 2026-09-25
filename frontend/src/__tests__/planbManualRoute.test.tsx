import { render } from '@testing-library/react-native';

import PlanbManualRoute from '@/app/trips/[tripId]/planb/manual';

/**
 * TRIP-753 · AC-1 — i07 일정 편집 라우트 `trips/[tripId]/planb/manual` 은 h12 편집 페이지
 * (`ItineraryEditPage`)를 여행 중 모드(`inTrip`)로 그리는 얇은 위임이다.
 *
 * 무엇을 보장하나: 라우트는 `tripId` 와 리터럴 `inTrip` 만 넘긴다. 옛 `variant`(폴백 i22 / 정상 i15
 * 가르기) 축은 사라졌으므로, params 에 `variant` 가 와도 페이지 props 에 새지 않아야 한다(02a ★14 —
 * params 를 통째로 펼쳐 넘기는 구현을 잡는다). 라우트가 곧 진입 신호다 — 여행 상태로 추론하지 않는다.
 *
 * ★ `@/pages/itinerary-edit` 을 스파이 컴포넌트로 치환 — 실 페이지 렌더(조회)를 막고 위임만 본다
 *   (liveLocationRoute 선례). 옛 `@/pages/planb-manual` 은 목으로 막지 않는다 — 구현 뒤엔 그 모듈이
 *   없어서 목 자체가 해석 실패로 죽는다(02a ★13).
 *
 * 3동작: 준비(params 목 + 페이지 스파이) → 실행(라우트 렌더) → 단언(위임된 props).
 */

const mockCaptured: {
  props?: Record<string, unknown>;
  rendered: boolean;
} = { rendered: false };

jest.mock('@/pages/itinerary-edit', () => ({
  ItineraryEditPage: (props: Record<string, unknown>) => {
    mockCaptured.props = props;
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
  mockCaptured.props = undefined;
  mockCaptured.rendered = false;
});

describe('🔴 planb/manual 라우트 — ItineraryEditPage(inTrip) 위임', () => {
  it('tripId 와 inTrip=true 만 넘기고, params 의 variant 는 흘리지 않는다', () => {
    render(<PlanbManualRoute />);

    expect(mockCaptured.rendered).toBe(true);
    expect(mockCaptured.props?.tripId).toBe('trip-1');
    expect(mockCaptured.props?.inTrip).toBe(true);
    expect(Object.keys(mockCaptured.props ?? {})).not.toContain('variant');
  });
});
