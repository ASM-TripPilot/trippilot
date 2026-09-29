/**
 * TRIP-1038 C — 초안의 비우기 확인이 `fresh=1` 을 실어 직접 짜기 라우트로 보내면, 라우트는 그것을
 * `ManualPlanPage` 의 `startFresh` 로 넘긴다. 이 한 칸이 빠지면 초안 쪽(`DraftPage.manual` C2 — fresh push)과
 * 편집기 쪽(`ManualPlanPage.fresh` C3 — startFresh 면 비움)이 둘 다 green 인 채 "확인했는데 안 비워지는" 흐름이 된다
 * (`generatingRouteModePassthrough` 와 같은 틈).
 *
 * 3동작 뼈대: 준비=주소 파라미터 → 실행=라우트 렌더 → 단언=페이지가 받은 prop.
 */
import { render } from '@testing-library/react-native';

let mockParams: Record<string, string | undefined> = {};
const mockPageProps: Record<string, unknown>[] = [];

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/pages/itinerary-manual', () => ({
  ManualPlanPage: (props: Record<string, unknown>) => {
    mockPageProps.push(props);
    return null;
  },
}));

// eslint-disable-next-line import/first -- 목 뒤에 라우트를 불러야 목이 물린다.
import ManualPlanRoute from '@/app/trips/[tripId]/itinerary/manual/index';

beforeEach(() => {
  mockPageProps.length = 0;
});

it('🔴 fresh=1 로 열리면 ManualPlanPage 가 startFresh=true 를 받는다', () => {
  // 준비 — 비우기 확인 「비우고 시작」이 보낸 주소.
  mockParams = { tripId: 'trip-1', fresh: '1' };
  // 실행
  render(<ManualPlanRoute />);
  // 단언
  expect(mockPageProps).toHaveLength(1);
  expect(mockPageProps[0].tripId).toBe('trip-1');
  expect(mockPageProps[0].startFresh).toBe(true);
});

it('fresh 없이 열리면(편집하기·직접 고르기) startFresh 가 켜지지 않는다 (짝 · 선제 green)', () => {
  mockParams = { tripId: 'trip-1' };
  render(<ManualPlanRoute />);
  expect(mockPageProps[0].tripId).toBe('trip-1');
  expect(mockPageProps[0].startFresh).toBeFalsy();
});
