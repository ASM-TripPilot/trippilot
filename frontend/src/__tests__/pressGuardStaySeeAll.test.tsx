import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Region, StayItem } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';
import { resetPressGuard } from '@/shared/press/pressGuard';
import { StaySearchPage } from '@/pages/stay/stay-search';
import ExploreRoute from '@/app/(tabs)/explore';

/**
 * TRIP-1013 #012 — 탐색 d01 숙소 '모두 보기' 연타의 두 번째 탭이 숙소 검색 첫 카드를
 * 누르지 않는다(실기에서는 숙소 상세까지 두 화면을 건너뛰었다).
 *
 * TRIP-1105 — 관찰 자리였던 목적지 상세가 d01 지역 필터로 합쳐졌다. 송신 쪽을 탐색 탭 라우트로
 * 옮기고, 필터 상태(옛 목적지 상세 자리)와 전국 상태 둘 다 창을 연다(브리프 Q6).
 *
 * 두 페이지를 차례로 그리고 이어 누른다 — 둘을 잇는 것은 모듈 하나에 든 400ms 창뿐이다.
 * 데이터 훅은 동기 목으로 둔다: 네트워크를 기다리는 동안 실제 시간이 흘러 "창 안"이 400ms 를
 * 넘기면 판정이 흔들린다(02a ★4). "창 밖"은 `resetPressGuard()`로 만든다.
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: { region?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    setParams: jest.fn(),
  }),
  useLocalSearchParams: () => ({ ...mockParams }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: jest.fn(),
    setParams: jest.fn(),
  },
}));

const mockItemA: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 그랜드 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
};
const KEY_A = `${mockItemA.externalSource}:${mockItemA.externalId}`;

const mockBusan: Region = {
  regionCode: '26',
  name: '부산광역시',
  sidoName: '',
  level: RegionLevel.SIDO,
  selectable: true,
  poiCount: 5,
};

// 두 페이지가 같은 모듈의 훅을 문다 — 한 번 목킹으로 둘 다 동기로 채워진다.
jest.mock('@/features/stay/model/useStaySearch', () => ({
  useStaySearch: () => ({
    data: { items: [mockItemA], degraded: false, filterZeroReasons: [] },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/features/save-stay/model/savedStays', () => ({
  useSavedStays: () => ({
    isSaved: () => false,
    save: jest.fn(),
    remove: jest.fn(),
    savedKeys: [],
  }),
}));

jest.mock('@/features/explore/model/regions', () => ({
  ...jest.requireActual('@/features/explore/model/regions'),
  useRegions: () => ({ data: [mockBusan] }),
}));

jest.mock('@/shared/api/generated/places/places', () => ({
  useGetPlaces: () => ({
    data: { items: [] },
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/features/save-place/model/savedPlaces', () => ({
  useSavedPlaces: () => ({ savedPoiIds: [] }),
}));

jest.mock('@/shared/api/tokenManager', () => ({
  getAccessToken: () => 'tkn',
}));

beforeEach(() => {
  resetPressGuard();
  mockPush.mockClear();
  mockReplace.mockClear();
});

/** push 인자 중 숙소 상세 라우트로 가는 객체형 push 만 골라낸다. */
function detailPushes(): unknown[] {
  return mockPush.mock.calls
    .map((call) => call[0])
    .filter(
      (arg) =>
        typeof arg === 'object' &&
        arg !== null &&
        (arg as { pathname?: string }).pathname === '/stays/[stayId]'
    );
}

/** 탐색 탭(params)을 그리고 숙소 '모두 보기'를 누른 뒤 치운다(=숙소 검색으로 넘어간 순간). */
function pressStaySeeAll(params: { region?: string }): void {
  mockParams = params;
  const landing = render(<ExploreRoute />);
  fireEvent.press(screen.getByTestId('explore-lane-stay-seeall'));
  landing.unmount();
}

/** 가드 판정용으로 멈춰 둘 시각(값 자체는 의미 없다 — 흐르지 않는 것이 요점). */
const FROZEN_NOW = 1_790_000_000_000;

describe('AC-012 · 숙소 모두 보기 → 창 안의 첫 카드는 무시된다', () => {
  // 시계를 멈춘다 — 화면을 그리고 응답을 기다리는 동안 실제 시간이 흘러 "창 안"이 400ms 를 넘기면
  // 판정이 흔들린다(02a ★2). "창 밖"은 resetPressGuard() 로만 만든다.
  let clock: jest.SpyInstance;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  });
  afterEach(() => clock.mockRestore());

  it.each([
    // 필터 상태 — 옛 목적지 상세 자리. 모두 보기는 필터 지역 이름을 싣는다.
    ['필터(부산)', { region: '26' }, '부산광역시'],
    // 전국 상태 — 모두 보기는 레인 첫 카드 지역을 싣는다(TRIP-412).
    ['전국', {}, '해운대'],
  ] as const)(
    '%s — 창 안의 첫 카드는 숙소 상세 push 가 0회이고, 창이 지난 뒤 한 번 누르면 그 카드 상세로 정확히 1회다',
    (_, params, laneRegion) => {
      // 실행 ① — 첫 탭.
      pressStaySeeAll({ ...params });
      // 앵커 — 첫 탭은 제 할 일을 했다(숙소 검색으로 push).
      expect(mockPush).toHaveBeenCalledWith(
        `/stays?region=${encodeURIComponent(laneRegion)}`
      );

      // 실행 ② — 두 번째 탭이 검색 결과 첫 카드에 떨어진다.
      mockParams = { region: laneRegion };
      render(<StaySearchPage />);
      fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`));

      // 단언 — 무시된다.
      expect(detailPushes()).toHaveLength(0);

      // 무회귀·인자 전달 — 창이 닫힌 뒤의 한 번은 그 카드의 상세로 간다.
      resetPressGuard();
      fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`));

      expect(detailPushes()).toHaveLength(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/stays/[stayId]',
        params: { stayId: KEY_A },
      });
    }
  );
});
