import { render } from '@testing-library/react-native';

import ItineraryEditRoute from '@routes/trips/[tripId]/itinerary/edit';

/**
 * TRIP-1233 · AC-2a·2b — h12 일정 편집 라우트 `trips/[tripId]/itinerary/edit` 는 `ItineraryEditPage` 로
 * 넘기는 얇은 위임이다. 확정 일정(h16)이 보고 있던 날을 `date` 로 싣고 오면, 라우트가 그것을 이름으로
 * 꺼내 `initialDate` 로 내린다 — 편집기가 1일차가 아니라 그 날로 열린다.
 *
 * 무엇을 보장하나: `tripId`·`initialDate` 만 넘긴다. params 를 통째로 펼치지 않는다(모르는 키·`date` 라는
 * 이름이 props 에 새지 않는다 — planbManualRoute ★14 와 같은 장치). 이 라우트는 h12 라 `inTrip` 이 없다.
 *
 * ★ 페이지를 스파이 컴포넌트로 치환 — 실 페이지 렌더(조회)를 막고 위임만 본다(planbManualRoute 선례).
 *
 * 3동작: 준비(params 목 + 페이지 스파이) → 실행(라우트 렌더) → 단언(위임된 props).
 */

const mockCaptured: { props?: Record<string, unknown> } = {};

jest.mock('@/pages/itinerary/itinerary-edit', () => ({
  ItineraryEditPage: (props: Record<string, unknown>) => {
    mockCaptured.props = props;
    return null;
  },
}));

const mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockParams }),
}));

beforeEach(() => {
  mockCaptured.props = undefined;
  Object.keys(mockParams).forEach((key) => delete mockParams[key]);
  mockParams.tripId = 'trip-1';
});

describe('🔴 itinerary/edit 라우트 — date → initialDate', () => {
  it('RE1 date 쿼리를 initialDate 로 넘기고, 다른 params 는 흘리지 않는다', () => {
    mockParams.date = '2026-06-11';
    mockParams.stray = 'x';

    render(<ItineraryEditRoute />);

    expect(mockCaptured.props?.tripId).toBe('trip-1');
    expect(mockCaptured.props?.initialDate).toBe('2026-06-11');
    const keys = Object.keys(mockCaptured.props ?? {});
    expect(keys).not.toContain('date');
    expect(keys).not.toContain('stray');
    // h12 라우트는 여행 중 얼굴이 아니다.
    expect(mockCaptured.props?.inTrip).toBeUndefined();
  });

  it('RE2 date 가 없으면 initialDate 도 없다(편집기는 1일차로 연다)', () => {
    render(<ItineraryEditRoute />);

    expect(mockCaptured.props?.tripId).toBe('trip-1');
    expect(mockCaptured.props?.initialDate).toBeUndefined();
  });
});
