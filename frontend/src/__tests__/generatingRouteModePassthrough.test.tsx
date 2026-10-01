/**
 * TRIP-1006 5-b 경고-1 — h09 라우트는 mode 를 **그대로** 넘긴다(기본값을 지어내지 않는다).
 *
 * 카드·홈은 "mode 없는 주소"를, GeneratingPage 는 "mode 없으면 관찰 모드(POST 0)"를 각각 잠갔지만
 * 그 사이 라우트가 `mode ?? 'FULLY_AI'` 로 채우면 둘 다 green 인 채 재진입이 생성을 다시 쏜다(#083).
 * 이 파일이 그 한 칸을 잠근다 — 라우트 파일을 렌더해 GeneratingPage 가 받은 prop 을 본다.
 */
import { render } from '@testing-library/react-native';

let mockParams: Record<string, string | undefined> = {};
const mockPageProps: Record<string, unknown>[] = [];

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/pages/itinerary-generating', () => ({
  GeneratingPage: (props: Record<string, unknown>) => {
    mockPageProps.push(props);
    return null;
  },
}));

// eslint-disable-next-line import/first -- 목 뒤에 라우트를 불러야 목이 물린다.
import ItineraryGeneratingRoute from '@/app/trips/[tripId]/itinerary/generating';

beforeEach(() => {
  mockPageProps.length = 0;
});

it('mode 없이 열리면(카드·홈 재진입) GeneratingPage 에 mode 가 undefined 로 간다 — 관찰 모드', () => {
  // 준비 — 일정 탭 카드처럼 tripId 만 실린 주소.
  mockParams = { tripId: 'trip-1' };
  // 실행
  render(<ItineraryGeneratingRoute />);
  // 단언 — 기본값을 채우지 않는다.
  expect(mockPageProps).toHaveLength(1);
  expect(mockPageProps[0].tripId).toBe('trip-1');
  expect(mockPageProps[0].mode).toBeUndefined();
});

it('mode 가 실리면 그대로 넘긴다 (긍정 짝)', () => {
  mockParams = { tripId: 'trip-1', mode: 'CO_PLAN' };
  render(<ItineraryGeneratingRoute />);
  expect(mockPageProps[0].mode).toBe('CO_PLAN');
});
