import { render } from '@testing-library/react-native';

import AddVisitRoute from '@/app/trips/[tripId]/records/add-visit';

/**
 * 🔴 TRIP-1072 · AC-3·AC-13 — 라우트 `trips/[tripId]/records/add-visit` → RecordAddVisitPage 위임.
 *
 * 라우트는 `useLocalSearchParams` 의 `tripId`·`day` 를 페이지 prop 으로 넘기기만 한다(liveHubRoute 선례).
 * `day` 는 j01 활성 일자 — 피커와 j01 이 같은 (tripId, day) 방문 캐시를 봐야 돌아왔을 때 카드가 보인다.
 */

const mockParams: Record<string, string> = {};
const mockCaptured: { props?: Record<string, unknown> } = {};

jest.mock('@/pages/record-add-visit', () => ({
  RecordAddVisitPage: (props: Record<string, unknown>) => {
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

describe('🔴 RT · add-visit 라우트 — tripId·day 를 페이지로 넘긴다', () => {
  it('RT1 쿼리의 tripId·day 가 그대로 페이지 prop 이 된다', () => {
    // 준비
    mockParams.tripId = 't1';
    mockParams.day = '2026-08-20';

    // 실행
    render(<AddVisitRoute />);

    // 단언
    expect(mockCaptured.props?.tripId).toBe('t1');
    expect(mockCaptured.props?.day).toBe('2026-08-20');
  });
});
