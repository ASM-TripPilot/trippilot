import { render } from '@testing-library/react-native';

import PlanbRequestRoute from '@/app/trips/[tripId]/planb';

/**
 * TRIP-750 · AC-7 — 라우트 `trips/[tripId]/planb` → PlanbRequestPage 위임.
 *
 * 무엇을 보장하나: 라우트는 `useLocalSearchParams` 의 `tripId`·`scope`·`triggerId` 를 그대로 페이지에
 * 넘긴다. 749 [대안 보기]가 `?scope=…&triggerId=…` 로 push 하므로 여기서 끊기면 감지 칩이 영영 안 뜬다.
 * 폼 초기화·시드는 페이지가 한 흐름으로 한다(02a ★9).
 *
 * ★ `@/pages/planb-request` 를 스파이로 치환해 위임만 본다(planbManualRoute 선례).
 */

const mockCaptured: {
  props?: { tripId?: string; scope?: string; triggerId?: string };
} = {};
let mockParams: Record<string, string | undefined> = {};

jest.mock('@/pages/planb-request', () => ({
  PlanbRequestPage: (props: {
    tripId?: string;
    scope?: string;
    triggerId?: string;
  }) => {
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

describe('planb 요청 라우트 — PlanbRequestPage 위임', () => {
  it('🔴 T1 tripId·scope·triggerId 를 그대로 넘긴다', () => {
    mockParams = { tripId: 'trip-1', scope: 'FULL_DAY', triggerId: 'trg-1' };

    render(<PlanbRequestRoute />);

    expect(mockCaptured.props).toEqual(
      expect.objectContaining({
        tripId: 'trip-1',
        scope: 'FULL_DAY',
        triggerId: 'trg-1',
      })
    );
  });

  it('T2 triggerId 없이 들어오면(수동 진입) 페이지의 triggerId 는 비어 있다', () => {
    mockParams = { tripId: 'trip-1' };

    render(<PlanbRequestRoute />);

    expect(mockCaptured.props?.tripId).toBe('trip-1');
    expect(mockCaptured.props?.triggerId).toBeUndefined();
  });
});
