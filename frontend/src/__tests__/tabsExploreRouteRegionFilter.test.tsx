import type { ReactElement } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Place, Region, StayItem } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';
import { resetPressGuard } from '@/shared/press/pressGuard';
import { stayKey } from '@/features/stay/model/stayKey';
import { regionPickerHref } from '@/features/explore/model/regionPickerPurpose';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import ExploreRoute from '@/app/(tabs)/explore';
import {
  captureDraftAtNextCall,
  freshWizardDraft,
  leavePreviousTripDraft,
  resetWizardDraft,
  wizardDraftData,
} from '@/test-support/wizardDraftFixture';

/**
 * TRIP-1105 — 탐색 탭 d01 이 `region`(지역 코드) 파라미터를 받아 그 지역으로 좁힌 두 가로 레인을
 * 그린다. 목적지 상세(d05, 따로 있던 화면·복제 탭바)를 없애고 이 한 화면에 합친다(결정 1 = A).
 *
 * 무엇을 보장하나:
 *  - 코드 → 이름은 `useRegions()` 캐시에서 찾고, 두 조회에는 **이름**만 싣는다. 이름이 풀리기 전엔
 *    두 조회를 끄고(enabled=false), 코드 문자열이 region 으로 새지 않는다(목적지 상세 규칙 이관).
 *  - 카탈로그 실패·코드 없음은 스켈레톤이 아니라 재시도로 드러난다(INV-4, Q5).
 *  - 검색바 칩 ✕ → `setParams({ region: undefined })` → 전국 d01(Q2). 칩 밖 탭 → 지역 선택.
 *  - 모두 보기는 필터 지역 이름을 싣는다(Q6·Q7). 담기 하트·＋ FAB 배선은 d01 것 그대로.
 *  - 지역이 바뀌면 본문을 새로 만들어 이전 지역의 배너·saved-menu 열림이 남지 않는다(key 재마운트).
 *
 * 왜 이렇게 테스트하나(02a ★4·★5·★6):
 *  - 조회 훅 목은 react-query 처럼 **enabled=false 를 받으면 대기 모양**을 돌려준다. 고정 반환값이면
 *    "꺼진 쿼리는 영원히 isPending" 함정을 테스트가 못 본다.
 *  - 가짜 라우터의 `setParams` 는 `mockParams` 를 실제로 합친다 — 그 뒤 `rerender` 하면 URL 이 바뀐 것과
 *    같다. 지우지 않는 호출(`setParams({})`)이면 칩이 남아 red 다.
 *  - `rerender` 는 같은 컴포넌트를 재사용한다 — `key` 가 없으면 안의 `useState` 가 살아남는다.
 *
 * (개념) `jest.mock` 팩토리는 파일 맨 위로 끌어올려진다 — 팩토리가 읽는 바깥 변수는 이름이 `mock` 으로
 * 시작해야 한다(리포 규칙).
 */

const mockPush = jest.fn();
const mockSetParams = jest.fn();
const mockDismissTo = jest.fn();
let mockParams: { region?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    setParams: mockSetParams,
    dismissTo: mockDismissTo,
  }),
  useLocalSearchParams: () => ({ ...mockParams }),
}));

const mockRegionsRefetch = jest.fn();
let mockRegionsResult: {
  data: Region[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
};
jest.mock('@/features/explore/model/regions', () => ({
  ...jest.requireActual('@/features/explore/model/regions'),
  useRegions: () => mockRegionsResult,
}));

const mockUseStaySearch = jest.fn();
jest.mock('@/features/stay/model/useStaySearch', () => ({
  useStaySearch: (...args: unknown[]) => mockUseStaySearch(...args),
}));

const mockUseGetPlaces = jest.fn();
jest.mock('@/shared/api/generated/places/places', () => ({
  useGetPlaces: (...args: unknown[]) => mockUseGetPlaces(...args),
}));

const mockSavePlace = jest.fn();
const mockRemovePlace = jest.fn();
jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => ({
    savedPoiIds: [],
    isSaved: () => false,
    save: mockSavePlace,
    remove: mockRemovePlace,
  }),
}));

const mockSave = jest.fn();
const mockRemove = jest.fn();
jest.mock('@/features/stay/model/savedStays', () => ({
  useSavedStays: () => ({
    isSaved: () => false,
    save: mockSave,
    remove: mockRemove,
    savedKeys: [],
  }),
}));

let mockToken: string | null = 'tkn';
jest.mock('@/shared/api/tokenManager', () => ({
  getAccessToken: () => mockToken,
}));

function region(
  over: Partial<Region> & Pick<Region, 'regionCode' | 'name'>
): Region {
  return {
    sidoName: over.sidoName ?? '',
    level: over.level ?? RegionLevel.SIGUNGU,
    selectable: over.selectable ?? true,
    poiCount: over.poiCount ?? 5,
    ...over,
  };
}

const BUSAN = region({
  regionCode: '26',
  name: '부산광역시',
  level: RegionLevel.SIDO,
});
const MICHUHOL = region({
  regionCode: '28177',
  name: '미추홀구',
  sidoName: '인천광역시',
});

// 가격 스냅숏이 없는 숙소 — "가격 미확인"(BR-U1-14)까지 한 건으로 본다.
const STAY: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 그랜드 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: [],
  stayType: 'HOTEL',
  price: null,
};
const STAY_KEY = stayKey(STAY);

const PLACE: Place = {
  poiId: 'poi-1',
  nameKo: '감천문화마을',
  category: '명소',
  lat: 35.0975,
  lng: 129.0106,
  region: '사하구',
  openingHours: null,
  imageUrl: null,
  tags: [],
  savedCount: 3,
  dataStatus: 'ACTIVE',
};

/** react-query 가 enabled=false 쿼리에 주는 모양 — 데이터 없음 · 영원히 대기(02a ★4). */
const DISABLED_QUERY = {
  data: undefined,
  isPending: true,
  isError: false,
  refetch: jest.fn(),
};

const mockStayRefetch = jest.fn();
const mockPlacesRefetch = jest.fn();
let stayResult: Record<string, unknown>;
let placesResult: Record<string, unknown>;

function stayOk(items: StayItem[]) {
  return {
    data: { items, degraded: false, filterZeroReasons: [] },
    isPending: false,
    isError: false,
    refetch: mockStayRefetch,
  };
}
function placesOk(items: Place[]) {
  return {
    data: { items, nextCursor: null },
    isPending: false,
    isError: false,
    refetch: mockPlacesRefetch,
  };
}

beforeEach(() => {
  // 모듈 싱글턴 — 앞 테스트가 연 400ms 창이 이 테스트의 첫 press 를 먹지 않게(02a ★7).
  resetPressGuard();
  mockPush.mockReset();
  mockSetParams.mockReset();
  mockDismissTo.mockReset();
  // 가짜 라우터 — setParams 는 주소의 파라미터를 합쳐 바꾼다(02a ★5).
  mockSetParams.mockImplementation((next: Record<string, unknown>) => {
    mockParams = { ...mockParams, ...next } as { region?: string };
  });
  mockParams = { region: BUSAN.regionCode };
  mockToken = 'tkn';

  mockRegionsRefetch.mockReset();
  mockRegionsResult = {
    data: [BUSAN, MICHUHOL],
    isPending: false,
    isError: false,
    refetch: mockRegionsRefetch,
  };

  mockStayRefetch.mockReset();
  mockPlacesRefetch.mockReset();
  stayResult = stayOk([STAY]);
  placesResult = placesOk([PLACE]);
  mockUseStaySearch.mockReset();
  mockUseStaySearch.mockImplementation(
    (_params?: unknown, opts?: { enabled?: boolean }) =>
      opts?.enabled === false ? DISABLED_QUERY : stayResult
  );
  mockUseGetPlaces.mockReset();
  mockUseGetPlaces.mockImplementation(
    (_params?: unknown, opts?: { query?: { enabled?: boolean } }) =>
      opts?.query?.enabled === false ? DISABLED_QUERY : placesResult
  );

  mockSave.mockReset();
  mockRemove.mockReset();
  mockSave.mockResolvedValue({ kind: 'saved' });
  mockRemove.mockResolvedValue({ kind: 'removed' });
  mockSavePlace.mockReset();
  mockRemovePlace.mockReset();
  mockSavePlace.mockResolvedValue({ kind: 'saved' });
});

// 모듈 싱글턴(위저드 드래프트)은 describe 밖에서 비운다 — 안에 걸면 앞 테스트가 남긴 상태가 샌다.
afterEach(resetWizardDraft);

/** 주소 모양(문자열 · {pathname, params})을 "경로 + 파라미터"로 편다(02a ★16). */
function targetOf(arg: unknown): {
  path: string;
  params: Record<string, string>;
} {
  if (typeof arg === 'string') {
    const [path, query = ''] = arg.split('?');
    const params: Record<string, string> = {};
    for (const pair of query.split('&')) {
      const [k, v] = pair.split('=');
      if (k) params[k] = decodeURIComponent(v ?? '');
    }
    return { path, params };
  }
  const { pathname, params = {} } = arg as {
    pathname: string;
    params?: Record<string, unknown>;
  };
  return {
    path: pathname,
    params: Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ),
  };
}

/** 피커의 dismissTo 재현 — 같은 트리에서 region 파라미터만 바꿔 다시 그린다(02a ★6). */
function switchRegionTo(
  code: string,
  rerender: (el: ReactElement) => void
): void {
  mockParams = { region: code };
  rerender(<ExploreRoute />);
}

/** 조회 훅이 받은 첫 인자들의 region 값 전부. */
function regionsSentTo(mock: jest.Mock): unknown[] {
  return mock.mock.calls.map(
    (call) => (call[0] as { region?: unknown } | undefined)?.region
  );
}

describe('🔴 AC-2 · 필터 상태도 d01 한 화면 — 두 가로 레인 · 지역 헤딩', () => {
  it('F1 · 숙소·장소가 둘 다 d01 가로 레인이고, 레인 제목에 지역 이름이 붙고, 목적지 상세 testID 는 0건이다', () => {
    render(<ExploreRoute />);

    expect(screen.getByTestId('explore-lane-stay')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-lane-place')).toBeOnTheScreen();
    expect(screen.getByText('부산광역시 숙소')).toBeOnTheScreen();
    expect(screen.getByText('부산광역시 장소')).toBeOnTheScreen();
    // 헤딩은 필터 상태에서도 d01 그대로(Q10).
    expect(screen.getByText('무엇을 둘러볼까요?')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^destination-detail-/).length === 0).toBe(
      true
    );
  });
});

describe('🔴 AC-4 · 조회 파라미터 — 코드가 아니라 이름', () => {
  it('F2 · 두 조회에 카탈로그 이름을 싣고 둘 다 켠다', () => {
    render(<ExploreRoute />);

    expect(mockUseStaySearch).toHaveBeenLastCalledWith(
      { region: '부산광역시' },
      { enabled: true }
    );
    expect(mockUseGetPlaces).toHaveBeenLastCalledWith(
      { region: '부산광역시', limit: 8 },
      { query: { enabled: true } }
    );
  });
});

describe('🔴 AC-5 · 검색바 자리 지역 칩', () => {
  it('F3 · 칩에 고른 지역 이름이 보이고, 검색 placeholder 는 없다', () => {
    render(<ExploreRoute />);

    const chip = screen.getByTestId('explore-region-chip');
    expect(within(chip).getByText('부산광역시')).toBeOnTheScreen();
    expect(screen.queryByText('도시 · 장소 · 숙소 검색') === null).toBe(true);
  });
});

describe('🔴 AC-6 · 칩 ✕ → 필터 해제 = 전국 d01', () => {
  it('F4 · ✕ 는 region 키를 비우는 setParams 1회이고, 다시 그리면 칩이 없고 두 조회가 region 없이 나간다', () => {
    const { rerender } = render(<ExploreRoute />);

    fireEvent.press(screen.getByTestId('explore-region-chip-clear'));

    // setParams 1회 — region 키를 **직접 가진** 객체여야 한다. `setParams({})` 는 지우지 않는데
    // toHaveBeenCalledWith({region: undefined}) 는 그것도 통과시킨다(02a ★1).
    expect(mockSetParams).toHaveBeenCalledTimes(1);
    const arg = mockSetParams.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(arg, 'region')).toBe(true);
    expect(arg.region === undefined).toBe(true);
    // 중첩 Pressable — ✕ 가 바깥 검색바(피커 진입)로 새지 않는다(02a ★8).
    expect(mockPush).not.toHaveBeenCalled();

    // 주소가 바뀐 뒤의 화면(가짜 라우터가 mockParams 를 합쳤다).
    rerender(<ExploreRoute />);

    expect(screen.queryByTestId('explore-region-chip') === null).toBe(true);
    expect(screen.getByText('도시 · 장소 · 숙소 검색')).toBeOnTheScreen();
    // 전국 d01 과 같은 호출 — 장소는 인자 **하나**(02a ★2), 숙소는 region 없이 켜져 있다.
    expect(mockUseGetPlaces).toHaveBeenLastCalledWith({ limit: 8 });
    const lastStay = mockUseStaySearch.mock.calls.at(-1) ?? [];
    const lastStayParams = lastStay[0] as { region?: string } | undefined;
    const lastStayOpts = lastStay[1] as { enabled?: boolean } | undefined;
    expect(lastStayParams?.region === undefined).toBe(true);
    expect(lastStayOpts?.enabled !== false).toBe(true);
  });
});

describe('🔴 AC-7 · 칩 밖 검색바 탭 → 지역 선택', () => {
  it('F5 · 필터 상태에서 칩 밖 검색바를 누르면 탐색용 지역 선택으로 1회 가고, 필터는 그대로다', () => {
    render(<ExploreRoute />);
    // 앵커 — 정말 필터 상태다(칩이 없으면 이 테스트는 전국 d01 을 보고 있는 것이다).
    expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('explore-landing-search'));

    expect(mockPush.mock.calls).toEqual([[regionPickerHref('explore')]]);
    expect(mockSetParams).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-9 · 이름이 아직 안 풀림(카탈로그 조회 중)', () => {
  it('F6 · 두 조회를 끄고, 코드 문자열은 어디에도 안 싣고, 로딩 스켈레톤을 보인다', () => {
    mockRegionsResult = {
      data: undefined,
      isPending: true,
      isError: false,
      refetch: mockRegionsRefetch,
    };
    render(<ExploreRoute />);

    const lastStayOpts = mockUseStaySearch.mock.calls.at(-1)?.[1] as
      { enabled?: boolean } | undefined;
    const lastPlacesOpts = mockUseGetPlaces.mock.calls.at(-1)?.[1] as
      { query?: { enabled?: boolean } } | undefined;
    expect(lastStayOpts?.enabled === false).toBe(true);
    expect(lastPlacesOpts?.query?.enabled === false).toBe(true);
    expect(regionsSentTo(mockUseStaySearch).includes('26')).toBe(false);
    expect(regionsSentTo(mockUseGetPlaces).includes('26')).toBe(false);
    expect(
      screen.getByTestId('explore-landing-skeleton-stay-0')
    ).toBeOnTheScreen();
  });
});

describe('🔴 AC-10 · 이름을 끝내 못 찾음 → 스켈레톤이 아니라 재시도 (INV-4 · Q5)', () => {
  it('F7 · 카탈로그 조회 실패면 두 레인 모두 재시도이고, 재시도는 카탈로그를 다시 부른다', () => {
    mockRegionsResult = {
      data: undefined,
      isPending: false,
      isError: true,
      refetch: mockRegionsRefetch,
    };
    render(<ExploreRoute />);

    // 꺼진 쿼리는 영원히 대기다 — 그 대기를 로딩으로 보이면 스켈레톤이 끝나지 않는다(02a ★4).
    expect(
      screen.queryByTestId('explore-landing-skeleton-stay-0') === null
    ).toBe(true);
    expect(screen.getByTestId('explore-lane-stay-retry')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-lane-place-retry')).toBeOnTheScreen();
    // 이름이 없으니 칩은 코드를 그대로 보인다(목적지 상세 displayName 선례).
    expect(
      within(screen.getByTestId('explore-region-chip')).getByText('26')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('explore-lane-stay-retry'));
    expect(mockRegionsRefetch).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('explore-lane-place-retry'));
    expect(mockRegionsRefetch).toHaveBeenCalledTimes(2);
  });

  it('F8 · 카탈로그는 받았는데 그 코드가 없으면 두 레인 모두 재시도이고, 코드는 region 으로 안 나간다', () => {
    mockParams = { region: '99' };
    render(<ExploreRoute />);

    expect(
      screen.queryByTestId('explore-landing-skeleton-stay-0') === null
    ).toBe(true);
    expect(screen.getByTestId('explore-lane-stay-retry')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-lane-place-retry')).toBeOnTheScreen();
    expect(regionsSentTo(mockUseStaySearch).includes('99')).toBe(false);
    expect(regionsSentTo(mockUseGetPlaces).includes('99')).toBe(false);
    // 두 조회 모두 꺼져 있다 — region 을 빼고 켜면 전국 조회가 몰래 나간다(Q5 · 5-b 경고-2).
    const lastStayOpts = mockUseStaySearch.mock.calls.at(-1)?.[1] as
      { enabled?: boolean } | undefined;
    const lastPlacesOpts = mockUseGetPlaces.mock.calls.at(-1)?.[1] as
      { query?: { enabled?: boolean } } | undefined;
    expect(lastStayOpts?.enabled === false).toBe(true);
    expect(lastPlacesOpts?.query?.enabled === false).toBe(true);
  });
});

describe('🔴 AC-11 · 부분 실패 — 한 레인만 실패', () => {
  it('F9 · 숙소 카드는 보이고 장소 레인은 재시도이며, 재시도는 장소 조회를 다시 부른다', () => {
    placesResult = {
      data: undefined,
      isPending: false,
      isError: true,
      refetch: mockPlacesRefetch,
    };
    render(<ExploreRoute />);
    // 앵커 — 필터 상태다(칩이 없으면 전국 d01 을 보고 있어 공짜로 통과한다).
    expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

    expect(
      screen.getByTestId(`explore-stay-card-${STAY_KEY}`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId('explore-lane-place-retry')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('explore-lane-place-retry'));
    expect(mockPlacesRefetch).toHaveBeenCalledTimes(1);
  });

  it('F9b · 숙소만 실패하면 장소 카드는 보이고 숙소 레인은 재시도이며, 재시도는 숙소 조회만 다시 부른다', () => {
    stayResult = {
      data: undefined,
      isPending: false,
      isError: true,
      refetch: mockStayRefetch,
    };
    render(<ExploreRoute />);
    // 앵커 — 필터 상태다(칩이 없으면 전국 d01 을 보고 있어 공짜로 통과한다).
    expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

    expect(
      screen.getByTestId(`explore-place-card-${PLACE.poiId}`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId('explore-lane-stay-retry')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('explore-lane-stay-retry'));
    // 전국·필터가 서로 다른 refetch 람다를 만든다 — 필터 쪽 숙소 람다는 여기서만 실행된다(5-b 경고-1).
    expect(mockStayRefetch).toHaveBeenCalledTimes(1);
    expect(mockPlacesRefetch).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-12 · 숙소 스냅숏 없음 → 가격 미확인 (BR-U1-14)', () => {
  it('F10 · 필터 상태 숙소 카드에 "가격 미확인" 이 보인다', () => {
    render(<ExploreRoute />);
    // 앵커 — 필터 상태다(칩이 없으면 전국 d01 을 보고 있어 공짜로 통과한다).
    expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

    const card = screen.getByTestId(`explore-stay-card-${STAY_KEY}`);
    expect(within(card).getByText('가격 미확인')).toBeOnTheScreen();
  });
});

describe('🔴 AC-13 · 모두 보기는 필터 지역 이름을 싣는다 (Q6 · Q7)', () => {
  it('F11a · 숙소 모두 보기 → /stays?region=부산광역시', () => {
    render(<ExploreRoute />);

    fireEvent.press(screen.getByTestId('explore-lane-stay-seeall'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(targetOf(mockPush.mock.calls[0][0])).toEqual({
      path: '/stays',
      params: { region: '부산광역시' },
    });
  });

  it('F11b · 장소 모두 보기 → /explore/places?region=부산광역시', () => {
    render(<ExploreRoute />);

    fireEvent.press(screen.getByTestId('explore-lane-place-cta'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(targetOf(mockPush.mock.calls[0][0])).toEqual({
      path: '/explore/places',
      params: { region: '부산광역시' },
    });
  });

  it('F11c · 장소 0건 폴백을 눌러도 같은 곳(/explore/places?region=부산광역시)으로 간다', () => {
    placesResult = placesOk([]);
    render(<ExploreRoute />);

    fireEvent.press(screen.getByTestId('explore-lane-place-empty'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(targetOf(mockPush.mock.calls[0][0])).toEqual({
      path: '/explore/places',
      params: { region: '부산광역시' },
    });
  });
});

describe('🔴 배선 이관 — 카드·하트·＋ FAB 는 필터 상태에서도 d01 그대로', () => {
  it('F12 · 장소 카드 → d06, 숙소 카드 → 숙소 상세(stayId 만)', () => {
    render(<ExploreRoute />);
    // 앵커 — 필터 상태다(칩이 없으면 전국 d01 을 보고 있어 공짜로 통과한다).
    expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(`explore-place-card-${PLACE.poiId}`));
    expect(mockPush).toHaveBeenLastCalledWith(`/explore/places/${PLACE.poiId}`);

    fireEvent.press(screen.getByTestId(`explore-stay-card-${STAY_KEY}`));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/stays/[stayId]',
      params: { stayId: STAY_KEY },
    });
  });

  it('F13 · 로그인 사용자의 숙소·장소 하트는 서버 담기를 실제로 부른다', () => {
    render(<ExploreRoute />);
    // 앵커 — 필터 상태다(칩이 없으면 전국 d01 을 보고 있어 공짜로 통과한다).
    expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(`explore-stay-save-${STAY_KEY}`));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(STAY);

    fireEvent.press(screen.getByTestId(`explore-place-save-${PLACE.poiId}`));
    expect(mockSavePlace).toHaveBeenCalledTimes(1);
    const savedPlace = mockSavePlace.mock.calls[0][0] as Place;
    expect(savedPlace.poiId).toBe(PLACE.poiId);
  });

  it('F14 · ＋ 여행 만들기는 직전 드래프트를 비우고 위저드로 1회 간다', () => {
    leavePreviousTripDraft();
    // 앵커 — 아직 안 비었다(픽스처가 망가지면 아래 단언이 공짜로 통과한다).
    expect(wizardDraftData()).not.toEqual(freshWizardDraft());
    expect(useTripWizardStore.getState().destinations).toHaveLength(1);
    const draftAtPush = captureDraftAtNextCall(mockPush);
    render(<ExploreRoute />);
    // 앵커 — 필터 상태다(칩이 없으면 전국 d01 을 보고 있어 공짜로 통과한다).
    expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('explore-create-trip-fab'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/new/step1');
    expect(draftAtPush()).toEqual(freshWizardDraft());
  });
});

describe('🔴 AC-15 · 지역이 바뀌면 이전 지역의 로컬 상태가 안 남는다 (key 재마운트)', () => {
  it('R-1 · 부산에서 뜬 숙소 담기 실패 배너는 미추홀구로 바뀐 뒤엔 없다', async () => {
    mockSave.mockResolvedValue({ kind: 'failed' });
    const { rerender } = render(<ExploreRoute />);

    fireEvent.press(screen.getByTestId(`explore-stay-save-${STAY_KEY}`));
    // 전제 — 부산 화면에 배너가 떴다.
    expect(
      await screen.findByTestId('explore-stay-save-error')
    ).toBeOnTheScreen();

    switchRegionTo(MICHUHOL.regionCode, rerender);

    // 전제 — 정말 미추홀구 화면이다.
    expect(screen.getByText('미추홀구 숙소')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-stay-save-error') === null).toBe(true);
  });

  it('R-2 · 부산에서 펼친 담은 곳 메뉴는 미추홀구로 바뀐 뒤엔 접혀 있다', async () => {
    const { rerender } = render(<ExploreRoute />);

    fireEvent.press(screen.getByTestId('explore-saved-menu-toggle'));
    // 전제 — 부산에서 펼쳤다.
    expect(screen.getByTestId('explore-saved-places-fab')).toBeOnTheScreen();

    await act(async () => {
      switchRegionTo(MICHUHOL.regionCode, rerender);
    });

    expect(screen.getByText('미추홀구 숙소')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-saved-places-fab') === null).toBe(
      true
    );
  });
});
