import { render } from '@testing-library/react-native';

import PlanbRequestRoute from '@routes/trips/[tripId]/planb/index';

/**
 * 상황 감지 FE-B · frontend-components §3.1 — 라우트 `trips/[tripId]/planb` 의 분기.
 *
 * 무엇을 보장하나: `triggerId` 가 있으면(알림 탭 · 알림함 PLAN_B 행 · i03 [대안 보기]) 진입 게이트(`PlanbEntryGate`)를,
 * 없으면 지금처럼 i04(`PlanbRequestPage`)를 그린다. 게이트에는 URL 원문(scope·targetDate)을 그대로 넘긴다 — 조회 실패·
 * 3초 초과 때 게이트가 그 값으로 기존 i04 를 연다.
 *
 * ★ 슬라이스 공개 API 를 스파이 컴포넌트로 바꿔 실 화면 렌더를 막고 위임만 본다(`liveHubRoute.test` 선례).
 * 3동작: 준비(params 목 + 스파이) → 실행(라우트 렌더) → 단언(어느 것이 어떤 props 로 그려졌나).
 */

const mockParams: Record<string, string> = {};
const mockCaptured: {
  gate?: Record<string, unknown>;
  request?: Record<string, unknown>;
} = {};

jest.mock('@/pages/live/planb-request', () => ({
  PlanbEntryGate: (props: Record<string, unknown>) => {
    mockCaptured.gate = props;
    return null;
  },
  PlanbRequestPage: (props: Record<string, unknown>) => {
    mockCaptured.request = props;
    return null;
  },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockParams }),
}));

beforeEach(() => {
  Object.keys(mockParams).forEach((key) => delete mockParams[key]);
  mockCaptured.gate = undefined;
  mockCaptured.request = undefined;
});

describe('🔴 RT · planb 라우트 — triggerId 가 있으면 진입 게이트 (§3.1)', () => {
  it('RT1 triggerId 가 있으면 게이트에 tripId·triggerId·URL 원문을 넘기고 i04 는 직접 그리지 않는다', () => {
    Object.assign(mockParams, {
      tripId: 'trip-1',
      triggerId: 'trg-1',
      scope: 'FULL_DAY',
      targetDate: '2026-10-20',
    });

    render(<PlanbRequestRoute />);

    expect(mockCaptured.gate).toEqual({
      tripId: 'trip-1',
      triggerId: 'trg-1',
      scope: 'FULL_DAY',
      targetDate: '2026-10-20',
    });
    expect(mockCaptured.request).toBeUndefined();
  });

  it('RT2 triggerId 가 없으면 지금처럼 i04 를 그린다(게이트 없음)', () => {
    Object.assign(mockParams, { tripId: 'trip-1', targetDate: '2026-10-20' });

    render(<PlanbRequestRoute />);

    expect(mockCaptured.gate).toBeUndefined();
    expect(mockCaptured.request).toMatchObject({
      tripId: 'trip-1',
      targetDate: '2026-10-20',
    });
  });

  it('RT2b triggerId 가 없으면 prefill·includePoiId 도 읽어 i04 로 내린다(§3.1 · 기회 카드 [넣어서 다시 짜기])', () => {
    Object.assign(mockParams, {
      tripId: 'trip-1',
      prefill: '하늘공원 꼭 넣어서 다시 짜 줘',
      includePoiId: 'poi-sky',
    });

    render(<PlanbRequestRoute />);

    expect(mockCaptured.gate).toBeUndefined();
    expect(mockCaptured.request).toMatchObject({
      tripId: 'trip-1',
      prefill: '하늘공원 꼭 넣어서 다시 짜 줘',
      includePoiId: 'poi-sky',
    });
  });

  it('RT3 빈 triggerId(`?triggerId=`)는 트리거가 없는 것으로 읽는다', () => {
    Object.assign(mockParams, { tripId: 'trip-1', triggerId: '' });

    render(<PlanbRequestRoute />);

    expect(mockCaptured.gate).toBeUndefined();
    expect(mockCaptured.request).toMatchObject({ tripId: 'trip-1' });
  });
});
