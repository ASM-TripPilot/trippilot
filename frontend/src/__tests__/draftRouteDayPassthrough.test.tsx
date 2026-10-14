/**
 * #1235 사후 리뷰 W2 — 여행 중 [다시 짜기]가 자동 반영된 뒤 생성 화면은 추천안(h11)을 **다시 짠 날**(`day`)로 연다.
 * 생성 화면(`GeneratingPage` RP2·RP2b — day 를 싣는다)과 초안(`DraftPage` P5 — day 로 연다)이 둘 다 green 이어도
 * 그 사이 라우트가 `day` 를 안 넘기면 추천안은 첫 날로 열려 바뀐 날이 안 보인다(`generatingRouteModePassthrough` 와 같은 틈).
 *
 * 3동작 뼈대: 준비=주소 파라미터 → 실행=라우트 렌더 → 단언=페이지가 받은 prop.
 */
import { render } from '@testing-library/react-native';

let mockParams: Record<string, string | undefined> = {};
const mockPageProps: Record<string, unknown>[] = [];

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/pages/itinerary/itinerary-draft', () => ({
  DraftPage: (props: Record<string, unknown>) => {
    mockPageProps.push(props);
    return null;
  },
}));

// eslint-disable-next-line import/first -- 목 뒤에 라우트를 불러야 목이 물린다.
import ItineraryDraftRoute from '@routes/trips/[tripId]/itinerary/draft';

beforeEach(() => {
  mockPageProps.length = 0;
});

it('🔴 day 가 실리면 DraftPage 에 그대로 넘기고, 없으면 undefined 다(종전 — 데이터가 있는 첫 날)', () => {
  // 준비·실행 — 재계획 자동 반영 뒤 주소와 목록·카드 재진입 주소.
  mockParams = { tripId: 'trip-1', day: '2026-10-15' };
  render(<ItineraryDraftRoute />);
  mockParams = { tripId: 'trip-1' };
  render(<ItineraryDraftRoute />);

  // 단언
  expect(mockPageProps[0].tripId).toBe('trip-1');
  expect(mockPageProps[0].day).toBe('2026-10-15');
  expect(mockPageProps[1].day).toBeUndefined();
});
