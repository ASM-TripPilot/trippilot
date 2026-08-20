import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import { stayKey } from '@/features/stay/model/stayKey';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import ExploreRoute from '@/app/(tabs)/explore';

/**
 * TRIP-457 AC-6(배선) · AC-7 — d01 탐색 랜딩 숙소 카드 탭이 실제로 상세 라우트 push 로 이어진다.
 * 화면은 `stayLane.onPressCard?(card)` 콜백만 올린다(순수 뷰, `@/features/stay` import 금지) —
 * 그 콜백을 받아 카드 key 로 원본 `StayItem` 을 역조회해 `/stays/[stayId]` push(객체형·item JSON)
 * 하는 것은 **라우트**(`(tabs)/explore.tsx`) 몫이다. `onToggleSave` 역조회 선례와 동형.
 *
 * 목 seam(tabsExploreRoute.test 계승): `useStaySearch`·`useSavedPlaces` 딥 경로 + `useRouter`.
 * 게스트(토큰 없음)라 조건부 자식 `SavableStayLane`(useSavedStays)은 마운트되지 않는다 —
 * onPressCard 는 게스트/로그인 공통 base 에 있어야 상세 열람이 인증과 무관하게 성립한다.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/features/stay/model/useStaySearch', () => ({
  useStaySearch: jest.fn(),
}));
jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: jest.fn(),
}));

const mockUseStaySearch = useStaySearch as jest.MockedFunction<
  typeof useStaySearch
>;
const mockUseSavedPlaces = useSavedPlaces as jest.MockedFunction<
  typeof useSavedPlaces
>;

const CARD_A: StayItem = {
  externalSource: 'yanolja',
  externalId: '1',
  name: '명동 시티 호텔',
  lat: 37.56,
  lng: 126.98,
  region: '서울',
  amenities: [],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
};
const KEY_A = stayKey(CARD_A);

function stayResults(items: StayItem[]) {
  return {
    data: { items, degraded: false, filterZeroReasons: [] },
    isError: false,
    isPending: false,
  } as unknown as ReturnType<typeof useStaySearch>;
}
function savedResult(savedPoiIds: string[]) {
  return { savedPoiIds } as unknown as ReturnType<typeof useSavedPlaces>;
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseStaySearch.mockReset();
  mockUseSavedPlaces.mockReset();
  mockUseStaySearch.mockReturnValue(stayResults([CARD_A]));
  mockUseSavedPlaces.mockReturnValue(savedResult([]));
});

/** 상세 라우트로 가는 객체형 push 만 골라낸다. */
function detailPushes() {
  return mockPush.mock.calls
    .map((call) => call[0])
    .filter(
      (arg): arg is { pathname: string; params: Record<string, unknown> } =>
        typeof arg === 'object' &&
        arg !== null &&
        (arg as { pathname?: string }).pathname === '/stays/[stayId]'
    );
}

describe('X1 · d01 카드 press → 상세 push (AC-6)', () => {
  it('카드를 누르면 원본 item 을 역조회해 /stays/[stayId] 로 push 한다', () => {
    render(<ExploreRoute />);

    fireEvent.press(screen.getByTestId(`explore-stay-card-${KEY_A}`));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/stays/[stayId]',
      params: { stayId: KEY_A, item: JSON.stringify(CARD_A) },
    });
  });
});

describe('X2 · 하트 press 는 상세 push 를 삼키지 않는다 (AC-7)', () => {
  it('게스트 하트 press 는 상세 라우트 push 를 0건으로 둔다', () => {
    render(<ExploreRoute />);

    fireEvent.press(screen.getByTestId(`explore-stay-save-${KEY_A}`));

    // 게스트 하트는 로그인 유도(별개 문자열 push)로 가고, 상세 라우트 push 는 없다.
    expect(detailPushes()).toHaveLength(0);
  });
});
