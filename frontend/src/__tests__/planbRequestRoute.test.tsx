import { render } from '@testing-library/react-native';

import PlanbRequestRoute from '@routes/trips/[tripId]/planb/index';

/**
 * 상황 감지 FE-B · frontend-components §3.1 — 라우트 `trips/[tripId]/planb` 의 분기.
 *
 * 무엇을 보장하나: `triggerId` 가 있으면(알림 탭 · 알림함 PLAN_B 행 · i03 [대안 보기]) 진입 게이트(`PlanbEntryGate`)를,
 * 없으면 지금처럼 i04(`PlanbRequestPage`)를 그린다. 게이트에는 URL 원문(scope·targetDate)을 그대로 넘긴다 — 조회 실패·
 * 3초 초과 때 게이트가 그 값으로 기존 i04 를 연다. 시드(`seedReasons`·`seedDirectives`·`seedExcludedPoiIds`)가 오면
 * 트리거가 있어도 게이트 대신 i04 를 그 시드·트리거로 연다(i06 대안 없음 [조건 바꿔 다시 짜기]).
 *
 * ★ 슬라이스 공개 API 를 스파이 컴포넌트로 바꿔 실 화면 렌더를 막고 위임만 본다(`routeParamMapping.test` 선례).
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

/**
 * i06 대안 없음 [조건 바꿔 다시 짜기] — 그 세션의 입력을 시드로, 같은 트리거에 이어 i04 를 연다. 시드가 오면 트리거가 있어도
 * 게이트를 지나지 않는다(게이트는 그 날의 준비된 대안으로 다시 판정해 방금 본 대안 없음 얼굴로 되돌린다).
 */
describe('🔴 RT · 시드 진입 — 트리거가 있어도 게이트 대신 i04 를 시드로 연다', () => {
  it('RT4 쉼표로 이은 시드를 배열로 갈라 트리거·범위·자유 입력·넣으려던 POI 와 함께 i04 에 내린다', () => {
    Object.assign(mockParams, {
      tripId: 'trip-1',
      triggerId: 'trg-1',
      scope: 'PARTIAL_SLOTS',
      seedReasons: 'WEATHER,TIRED',
      seedDirectives: 'INDOOR',
      seedExcludedPoiIds: 'poi-a,poi-b',
      prefill: '카페로만',
      includePoiId: 'poi-sky',
    });

    render(<PlanbRequestRoute />);

    expect(mockCaptured.gate).toBeUndefined();
    expect(mockCaptured.request).toEqual({
      tripId: 'trip-1',
      triggerId: 'trg-1',
      scope: 'PARTIAL_SLOTS',
      targetDate: undefined,
      prefill: '카페로만',
      includePoiId: 'poi-sky',
      seedReasons: ['WEATHER', 'TIRED'],
      seedDirectives: ['INDOOR'],
      seedExcludedPoiIds: ['poi-a', 'poi-b'],
    });
  });

  it('RT5 시드가 비어 있어도(`?seedReasons=`) 시드 진입이다 — 빈 배열로 내리고 게이트를 지나지 않는다', () => {
    Object.assign(mockParams, {
      tripId: 'trip-1',
      triggerId: 'trg-1',
      targetDate: '2026-10-20',
      seedReasons: '',
      seedDirectives: '',
      seedExcludedPoiIds: '',
    });

    render(<PlanbRequestRoute />);

    expect(mockCaptured.gate).toBeUndefined();
    expect(mockCaptured.request).toMatchObject({
      triggerId: 'trg-1',
      targetDate: '2026-10-20',
      seedReasons: [],
      seedDirectives: [],
      seedExcludedPoiIds: [],
    });
  });

  it('RT6 시드가 없으면 i04 에 시드를 내리지 않는다(kind 자동 시드 그대로 — 기존 동작)', () => {
    Object.assign(mockParams, { tripId: 'trip-1' });

    render(<PlanbRequestRoute />);

    expect(mockCaptured.request).toMatchObject({
      seedReasons: undefined,
      seedDirectives: undefined,
      seedExcludedPoiIds: undefined,
    });
  });
});
