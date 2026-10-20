import { render } from '@testing-library/react-native';

import PlanbDraftRoute from '@routes/trips/[tripId]/planb/draft';
import PlanbSolvingRoute from '@routes/trips/[tripId]/planb/solving';

/**
 * 상황 감지 FE-B · frontend-components §3.6 — i05·i06 라우트가 `includePoiId` 를 한 줄씩 더 읽어 내린다.
 *
 * 무엇을 보장하나: 기회 카드 → i04 → i05 → i06 으로 넣으려던 POI 가 끊기지 않는다(서버엔 안 보낸다). 없으면 undefined —
 * 종전 위임 그대로다. 페이지는 스파이로 바꿔 위임만 본다(`liveHubRoute.test` 선례).
 * 3동작: 준비(params 목 + 스파이) → 실행(라우트 렌더) → 단언(받은 props).
 */

const mockParams: Record<string, string> = {};
const mockCaptured: {
  solving?: Record<string, unknown>;
  draft?: Record<string, unknown>;
} = {};

jest.mock('@/pages/live/planb-draft', () => ({
  PlanbSolvingPage: (props: Record<string, unknown>) => {
    mockCaptured.solving = props;
    return null;
  },
  PlanbDraftPage: (props: Record<string, unknown>) => {
    mockCaptured.draft = props;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockParams }),
}));

beforeEach(() => {
  Object.keys(mockParams).forEach((key) => delete mockParams[key]);
  mockCaptured.solving = undefined;
  mockCaptured.draft = undefined;
});

describe('🔴 RT · i05·i06 라우트 — includePoiId (§3.6)', () => {
  it('RT1 solving 은 tripId·sessionId·includePoiId 를 넘긴다', () => {
    Object.assign(mockParams, {
      tripId: 'trip-1',
      sessionId: 's9',
      includePoiId: 'poi-sky',
    });

    render(<PlanbSolvingRoute />);

    expect(mockCaptured.solving).toEqual({
      tripId: 'trip-1',
      sessionId: 's9',
      includePoiId: 'poi-sky',
    });
  });

  it('RT2 draft 는 tripId·sessionId·includePoiId 를 넘긴다', () => {
    Object.assign(mockParams, {
      tripId: 'trip-1',
      sessionId: 's9',
      includePoiId: 'poi-sky',
    });

    render(<PlanbDraftRoute />);

    expect(mockCaptured.draft).toEqual({
      tripId: 'trip-1',
      sessionId: 's9',
      includePoiId: 'poi-sky',
    });
  });

  it('RT3 includePoiId 가 없으면 undefined 다(종전 위임)', () => {
    Object.assign(mockParams, { tripId: 'trip-1', sessionId: 's9' });

    render(<PlanbSolvingRoute />);
    render(<PlanbDraftRoute />);

    expect(mockCaptured.solving?.includePoiId).toBeUndefined();
    expect(mockCaptured.draft?.includePoiId).toBeUndefined();
    expect(mockCaptured.draft?.sessionId).toBe('s9');
  });
});
