import { render } from '@testing-library/react-native';

import TripBasesRoute from '@/app/trips/[tripId]/bases';

/**
 * TRIP-1011 C — 라우트 `trips/[tripId]/bases` → TripBasesPage 위임(5-b 경고-3, 오케 보강).
 *
 * 무엇을 보장하나: 라우트는 `useLocalSearchParams` 의 `tripId` 를 그대로 페이지에 넘긴다. 3/4 '거점 숙소
 * 다시 고르기'가 `{ tripId }` 로 push 하므로, 다른 키를 읽으면 페이지가 여행을 못 찾아 3/4 로 되돌아간다.
 *
 * ★ `@/pages/trip-new-step2` 를 스파이로 치환해 위임만 본다(planbRequestRoute 선례).
 */

const mockCaptured: { props?: { tripId?: string; mode?: string } } = {};
let mockParams: Record<string, string | undefined> = {};

jest.mock('@/pages/trip-new-step2', () => ({
  TripBasesPage: (props: { tripId?: string; mode?: string }) => {
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

describe('거점 다시 고르기 라우트 — TripBasesPage 위임', () => {
  it('🔴 T1 tripId 를 그대로 넘긴다', () => {
    // 준비 — 3/4 링크가 싣는 파라미터
    mockParams = { tripId: 'trip-1' };
    // 실행
    render(<TripBasesRoute />);
    // 단언
    expect(mockCaptured.props?.tripId).toBe('trip-1');
  });
});

/**
 * TRIP-1082 · 한 라우트 두 입구 — l04 '출발점 변경'은 `{ tripId, mode: 'edit' }` 로, h04 '거점 숙소 다시
 * 고르기'는 `{ tripId }` 로 같은 라우트에 온다. 라우트는 `mode` 가 정확히 'edit' 일 때만 편집 모드를 내린다.
 * 다른 값·부재에 편집 얼굴이 새면 h04 에서 들어온 사용자가 생성 CTA 를 잃는다(AC-13 무회귀).
 */
describe('TRIP-1082 · mode=edit 일 때만 편집 모드를 내린다', () => {
  it('mode=edit 이면 tripId 와 mode "edit" 을 넘긴다 — 다른 키는 없다', () => {
    // 준비 — l04 가 싣는 파라미터
    mockParams = { tripId: 'trip-1', mode: 'edit' };
    // 실행
    render(<TripBasesRoute />);
    // 단언 — props 전체를 잰다(다른 키가 새도 red)
    expect(mockCaptured.props).toEqual({ tripId: 'trip-1', mode: 'edit' });
  });

  it('mode 가 없으면(h04 입구) mode 를 넘기지 않는다', () => {
    mockParams = { tripId: 'trip-1' };
    render(<TripBasesRoute />);
    expect(mockCaptured.props?.tripId).toBe('trip-1');
    expect(mockCaptured.props?.mode).toBeUndefined();
  });

  it('mode 가 edit 이 아닌 값이면 mode 를 넘기지 않는다', () => {
    mockParams = { tripId: 'trip-1', mode: 'wizard' };
    render(<TripBasesRoute />);
    expect(mockCaptured.props?.tripId).toBe('trip-1');
    expect(mockCaptured.props?.mode).toBeUndefined();
  });
});
