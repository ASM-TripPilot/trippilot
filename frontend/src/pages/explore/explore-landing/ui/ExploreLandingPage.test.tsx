import type { ReactElement } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type {
  Place,
  Region,
  StayItem,
  StayPrice,
} from '@/shared/api/index.schemas';
import { RegionLevel } from '@/shared/api/index.schemas';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { formatPrice } from '@/entities/stay';
import { stayKey } from '@/features/save-stay';
import { regionPickerHref } from '@/features/explore';
import { useTripWizardStore } from '@/features/create-trip';
import {
  captureDraftAtNextCall,
  freshWizardDraft,
  leavePreviousTripDraft,
  resetWizardDraft,
  wizardDraftData,
} from '@/test-support/wizardDraftFixture';
import { ExploreLandingPage } from '@/pages/explore/explore-landing';

/**
 * 탐색 d01 랜딩 page — 숙소·장소 조회를 물어 카드 VM 을 조립하고 항법 콜백을 순수 화면
 * (`ExploreLandingScreen`)에 내린다. 주소에 `region`(지역 코드)이 있으면 그 지역으로 좁힌다.
 *
 * 왜 이렇게 테스트하나: 조회 훅을 목으로 갈아 끼우고 page 를 통째로 그려, 그려진 결과와 push 인자를
 * 본다. `formatPrice`·`stayKey` 는 순수 함수라 목하지 않고 실값으로 대조한다. `jest.mock` 은 파일
 * 단위라 목은 맨 위 한 벌이고 describe 마다 반환값만 바꾼다(팩토리가 읽는 변수는 `mock` 으로 시작).
 */

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { region?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, setParams: mockSetParams }),
  useLocalSearchParams: () => ({ ...mockParams }),
}));

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

const mockUseSavedPlaces = jest.fn();
jest.mock('@/features/save-place/model/savedPlaces', () => ({
  useSavedPlaces: (...args: unknown[]) => mockUseSavedPlaces(...args),
}));

const mockUseSavedStays = jest.fn();
jest.mock('@/features/save-stay/model/savedStays', () => ({
  useSavedStays: (...args: unknown[]) => mockUseSavedStays(...args),
}));

function stayItem(
  externalSource: string,
  externalId: string,
  region: string,
  name: string,
  price: StayPrice | null
): StayItem {
  return {
    externalSource,
    externalId,
    name,
    lat: 0,
    lng: 0,
    region,
    amenities: [],
    stayType: 'HOTEL',
    price,
  };
}

// 두 카드 지역을 일부러 다르게 둔다 — "모두 보기"가 레인 **첫 카드**의 지역을 싣는지 가르려면
// 둘이 달라야 한다(같으면 하드코딩·items[1] 오답도 통과). 주소도 서로 다른 시도라 전국 d01 이
// 무언가로 거르면 한 장이 사라진다(TRIP-1300).
const CARD_A: StayItem = {
  ...stayItem('yanolja', '1', '서울', '명동 시티 호텔', {
    amount: 145000,
    currency: 'KRW',
  }),
  address: '서울특별시 중구 명동길 14',
};
const CARD_B: StayItem = {
  ...stayItem('agoda', '2', '제주', '성산 게스트하우스', null),
  address: '제주특별자치도 서귀포시 성산읍 일출로 284',
};
const KEY_A = stayKey(CARD_A);

const mockStayRefetch = jest.fn();
const mockPlacesRefetch = jest.fn();

function stayOk(items: StayItem[]) {
  return {
    data: { items, degraded: false, filterZeroReasons: [] },
    isPending: false,
    isError: false,
    refetch: mockStayRefetch,
  };
}
/** 장소 응답은 `{items, nextCursor}` 객체다(TRIP-503) — 배열이 아니다. */
function placesOk(items: unknown[]) {
  return {
    data: { items, nextCursor: null },
    isPending: false,
    isError: false,
    refetch: mockPlacesRefetch,
  };
}

beforeEach(() => {
  // 모듈 싱글턴 — 앞 테스트가 연 400ms 연타 창이 이 테스트의 첫 press 를 먹지 않게.
  resetPressGuard();
  [
    mockPush,
    mockSetParams,
    mockUseStaySearch,
    mockUseGetPlaces,
    mockUseSavedPlaces,
    mockUseSavedStays,
    mockStayRefetch,
    mockPlacesRefetch,
  ].forEach((fn) => fn.mockReset());
  // 가짜 라우터 — setParams 는 주소 파라미터를 합쳐 바꾼다. 그 뒤 rerender 하면 주소가 바뀐 것과 같다.
  mockSetParams.mockImplementation((next: Record<string, unknown>) => {
    mockParams = { ...mockParams, ...next } as { region?: string };
  });
  // 기본값 — 전국 d01 · 숙소 2곳(서울·제주) · 장소 0곳 · 담은 장소 1곳 · 담은 숙소 0곳.
  mockParams = {};
  mockUseStaySearch.mockReturnValue(stayOk([CARD_A, CARD_B]));
  mockUseGetPlaces.mockReturnValue(placesOk([]));
  mockUseSavedPlaces.mockReturnValue({ savedPoiIds: ['p1'] });
  mockUseSavedStays.mockReturnValue({
    isSaved: () => false,
    save: jest.fn(),
    remove: jest.fn(),
    savedKeys: [],
  });
});

// 위저드 드래프트는 모듈 싱글턴이라 describe 밖에서 비운다 — 안에 걸면 앞 테스트 상태가 샌다.
afterEach(resetWizardDraft);

// TRIP-201 · 447 · 703 · 499/985 · 412 · 453 · 470 · 500 · 704
describe('전국 d01 — 구획·검색·레인', () => {
  it('헤딩·검색·숙소 레인·담은 곳 FAB 를 그리고, 축 세그먼트·여행자 일정 레인·내 주변은 없다', () => {
    render(<ExploreLandingPage />);

    [
      'explore-landing',
      'explore-landing-heading',
      'explore-landing-search',
      'explore-lane-stay',
      'explore-saved-menu-toggle',
    ].forEach((id) => expect(screen.getByTestId(id)).toBeOnTheScreen());
    expect(screen.queryByTestId('explore-axis-all')).toBeNull();
    expect(screen.queryByTestId('explore-lane-itin')).toBeNull();
    // 좌표 파라미터가 없어 '내 주변' 블록은 없다.
    expect(screen.queryByTestId('explore-nearby')).toBeNull();
  });

  it('검색창을 누르면 탐색용 지역 선택으로 1회 간다(입력 불가 진입 버튼)', () => {
    render(<ExploreLandingPage />);

    fireEvent.press(screen.getByTestId('explore-landing-search'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe(regionPickerHref('explore'));
  });

  it('검색창은 제출(submitEditing)에 반응하지 않는다 — 자유 문자열이 region 으로 새지 않는다', () => {
    render(<ExploreLandingPage />);

    fireEvent(screen.getByTestId('explore-landing-search'), 'submitEditing', {
      nativeEvent: { text: '성산일출봉' },
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('숙소 카드 — 금액은 formatPrice 와 정확히 같고, 지역을 보이고, "1박" 표기는 없다', () => {
    render(<ExploreLandingPage />);

    [CARD_A, CARD_B].forEach((item) => {
      const card = screen.getByTestId(`explore-stay-card-${stayKey(item)}`);
      // getByText(문자열) = 완전 일치 — 금액이 독립 Text 노드여야 통과. 145000 → '145,000원~', null → '가격 미확인'.
      expect(within(card).getByText(formatPrice(item.price))).toBeOnTheScreen();
      expect(card).toHaveTextContent(new RegExp(item.region));
      expect(within(card).queryByText(/1박/)).toBeNull();
    });
  });

  // 지역 없이 push 하면 착지 화면이 부산 폴백(빈 목록)에 걸린다(TRIP-412).
  it('숙소 "모두 보기"는 레인 첫 카드의 지역(서울)을 실어 /stays 로 간다', () => {
    render(<ExploreLandingPage />);

    fireEvent.press(screen.getByTestId('explore-lane-stay-seeall'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(decodeURIComponent(String(mockPush.mock.calls[0][0]))).toBe(
      '/stays?region=서울'
    );
  });

  // '여행자 일정'은 완전 일치 쿼리라 부제의 부분 문자열엔 안 걸리고 레인 헤더만 노린다.
  it('여행자 일정 레인·제목·"준비 중" 자리가 없다', () => {
    render(<ExploreLandingPage />);

    expect(screen.queryByTestId('explore-lane-itin')).toBeNull();
    expect(screen.queryByText('여행자 일정')).toBeNull();
    expect(screen.queryByText(/준비\s*중/)).toBeNull();
  });

  it('헤딩 부제는 "숙소·장소를 둘러보고 담아요"이고, 옛 여행자 일정 문구는 없다', () => {
    render(<ExploreLandingPage />);

    expect(screen.getByText('숙소·장소를 둘러보고 담아요')).toBeOnTheScreen();
    expect(
      screen.queryByText('숙소·장소·여행자 일정을 둘러보고 담아요')
    ).toBeNull();
  });

  it('숙소 조회가 실패해도 나머지 구획은 살고, 숙소 레인 자리에 재시도가 뜬다(INV-4)', () => {
    mockUseStaySearch.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });
    render(<ExploreLandingPage />);

    [
      'explore-landing-heading',
      'explore-landing-search',
      'explore-saved-menu-toggle',
    ].forEach((id) => expect(screen.getByTestId(id)).toBeOnTheScreen());
    expect(screen.getByTestId('explore-lane-stay-retry')).toBeOnTheScreen();
  });

  it('장소 목록 진입점을 누르면 /explore/places 로 간다', () => {
    render(<ExploreLandingPage />);

    fireEvent.press(screen.getByTestId('explore-lane-place-cta'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/explore/places');
  });

  it('장소가 있으면 카드를 그리고, 카드를 누르면 장소 상세로 간다', () => {
    mockUseGetPlaces.mockReturnValue(
      placesOk([
        { poiId: 'poi-1', nameKo: '감천문화마을', region: '사하구' },
        { poiId: 'poi-2', nameKo: '광안리 해변', region: '수영구' },
      ])
    );
    render(<ExploreLandingPage />);

    expect(screen.getByTestId('explore-place-card-poi-1')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('explore-place-card-poi-2'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/explore/places/poi-2');
  });

  it('장소 조회 오류면 장소 레인 자리에 재시도를 그린다', () => {
    mockUseGetPlaces.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: jest.fn(),
    });
    render(<ExploreLandingPage />);

    expect(screen.getByTestId('explore-lane-place-retry')).toBeOnTheScreen();
  });

  // 전량(약 2MB)을 받아 8장만 쓰던 것을 서버에 limit 을 실어 필요한 개수만 받는다(TRIP-500).
  it('장소 레인은 서버에 개수 제한(limit 8)을 실어 묻는다', () => {
    render(<ExploreLandingPage />);

    expect(mockUseGetPlaces).toHaveBeenCalledWith({ limit: 8 });
  });

  it('숙소 조회 대기 중이면 두 레인 로딩 스켈레톤을 그린다', () => {
    mockUseStaySearch.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    render(<ExploreLandingPage />);

    expect(
      screen.getByTestId('explore-landing-skeleton-stay-0')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('explore-landing-skeleton-place-0')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-lane-stay-retry')).toBeNull();
  });

  it('장소 조회만 대기여도 로딩 스켈레톤을 그린다(두 조회 중 하나라도)', () => {
    mockUseGetPlaces.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: jest.fn(),
    });
    render(<ExploreLandingPage />);

    expect(
      screen.getByTestId('explore-landing-skeleton-place-0')
    ).toBeOnTheScreen();
  });
});

// TRIP-494 · 448 · 1019 · 703 · 1012 B1
describe('담은 곳 메뉴 · ＋ 여행 만들기', () => {
  it('하트 FAB(라벨 "담은 장소 N곳")를 펼치면 담은 장소 → d02, 저장한 숙소 → e04 로 간다', () => {
    mockUseSavedPlaces.mockReturnValue({ savedPoiIds: ['p1', 'p2'] });
    render(<ExploreLandingPage />);

    const toggle = screen.getByTestId('explore-saved-menu-toggle');
    // toHaveAccessibleName(문자열) = 완전 일치. 넘기는 수는 담은 **장소** 수뿐이다(TRIP-1019).
    expect(toggle).toHaveAccessibleName('담은 장소 2곳');
    expect(screen.queryByTestId('explore-bridge-cta')).toBeNull();
    expect(screen.queryByTestId('explore-saved-places-fab')).toBeNull();
    expect(screen.queryByTestId('explore-saved-stays-fab')).toBeNull();

    fireEvent.press(toggle);
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('explore-saved-places-fab'));
    expect(mockPush).toHaveBeenLastCalledWith('/explore/saved-places');

    fireEvent.press(screen.getByTestId('explore-saved-menu-toggle'));
    fireEvent.press(screen.getByTestId('explore-saved-stays-fab'));
    expect(mockPush).toHaveBeenLastCalledWith('/stays/saved');
  });

  // 0곳 분기로 FAB 를 없애면 d02/e04 빈 상태 도달 경로가 사라진다(TRIP-448).
  it('담은 장소 0곳이어도 FAB 는 유지되고, 펼쳐 d02 빈 상태로 갈 수 있다', () => {
    mockUseSavedPlaces.mockReturnValue({ savedPoiIds: [] });
    render(<ExploreLandingPage />);

    const toggle = screen.getByTestId('explore-saved-menu-toggle');
    expect(toggle).toHaveAccessibleName('담은 장소 0곳');

    fireEvent.press(toggle);
    fireEvent.press(screen.getByTestId('explore-saved-places-fab'));
    expect(mockPush).toHaveBeenLastCalledWith('/explore/saved-places');
  });

  // 직전 여행 드래프트가 새 여행으로 새지 않게, push 가 불리는 그 순간의 드래프트를 잰다.
  it('＋ 여행 만들기 FAB 는 직전 드래프트를 비우고 step1 로 1회 간다', () => {
    leavePreviousTripDraft();
    // 앵커 — 아직 안 비었다(픽스처가 조용히 망가지면 아래 단언이 공짜로 통과한다).
    expect(wizardDraftData()).not.toEqual(freshWizardDraft());
    expect(useTripWizardStore.getState().destinations).toHaveLength(1);
    const draftAtPush = captureDraftAtNextCall(mockPush);

    render(<ExploreLandingPage />);
    fireEvent.press(screen.getByTestId('explore-create-trip-fab'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/new/step1');
    expect(draftAtPush()).toEqual(freshWizardDraft());
  });
});

// TRIP-457 AC-6·7 · TRIP-940 — 상세가 GET /stays/{stayId} 로 스스로 조회하므로 item 을 싣지 않는다.
describe('숙소 카드 press → 숙소 상세', () => {
  it('카드를 누르면 stayId 만 실어 /stays/[stayId] 로 간다(item 없음)', () => {
    render(<ExploreLandingPage />);

    fireEvent.press(screen.getByTestId(`explore-stay-card-${KEY_A}`));

    // toHaveBeenCalledWith 는 재귀 비교라 params 에 item 이 더 붙으면 red 다.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/stays/[stayId]',
      params: { stayId: KEY_A },
    });
  });
});

// TRIP-1105 — 지역 선택(purpose=explore)이 region(지역 **코드**)을 싣고 이 탭으로 돌아온다. 두 조회는
// **이름** 기반이라 코드는 카탈로그(useRegions)에서 이름으로 바꿔 싣고, 이름이 풀리기 전엔 조회를 끈다.
describe('지역 필터 — region 파라미터로 좁힌 d01', () => {
  // sidoName 은 기본값 없이 필수 — 빈 시도 픽스처는 시도 거르기를 공짜로 통과시킨다(TRIP-1300).
  function region(
    over: Partial<Region> & Pick<Region, 'regionCode' | 'name' | 'sidoName'>
  ): Region {
    return {
      level: RegionLevel.SIGUNGU,
      selectable: true,
      poiCount: 5,
      ...over,
    };
  }
  // 시도 행은 라이브 시드처럼 sidoName 이 자기 이름이다.
  const BUSAN = region({
    regionCode: '26',
    name: '부산광역시',
    sidoName: '부산광역시',
    level: RegionLevel.SIDO,
  });
  const MICHUHOL = region({
    regionCode: '28177',
    name: '미추홀구',
    sidoName: '인천광역시',
  });

  // 가격 스냅숏이 없는 숙소 — "가격 미확인"까지 한 건으로 본다.
  const STAY: StayItem = {
    ...stayItem('NAVER', 's1', '해운대', '해운대 그랜드 호텔', null),
    lat: 35.1587,
    lng: 129.1604,
    address: '부산광역시 해운대구 해운대해변로 296',
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

  /** react-query 가 enabled=false 쿼리에 주는 모양 — 데이터 없음 · 영원히 대기. */
  const DISABLED_QUERY = {
    data: undefined,
    isPending: true,
    isError: false,
    refetch: jest.fn(),
  };

  const regionsRefetch = jest.fn();
  const saveStay = jest.fn();
  const savePlace = jest.fn();
  let stayResult: Record<string, unknown>;
  let placesResult: Record<string, unknown>;

  beforeEach(() => {
    mockParams = { region: BUSAN.regionCode };
    regionsRefetch.mockReset();
    mockRegionsResult = {
      data: [BUSAN, MICHUHOL],
      isPending: false,
      isError: false,
      refetch: regionsRefetch,
    };
    stayResult = stayOk([STAY]);
    placesResult = placesOk([PLACE]);
    // 조회 목은 react-query 처럼 enabled=false 를 받으면 대기 모양을 돌려준다 — 고정 반환값이면
    // "꺼진 쿼리는 영원히 isPending" 함정을 테스트가 못 본다.
    mockUseStaySearch.mockImplementation(
      (_params?: unknown, opts?: { enabled?: boolean }) =>
        opts?.enabled === false ? DISABLED_QUERY : stayResult
    );
    mockUseGetPlaces.mockImplementation(
      (_params?: unknown, opts?: { query?: { enabled?: boolean } }) =>
        opts?.query?.enabled === false ? DISABLED_QUERY : placesResult
    );
    saveStay.mockReset().mockResolvedValue({ kind: 'saved' });
    savePlace.mockReset().mockResolvedValue({ kind: 'saved' });
    mockUseSavedPlaces.mockReturnValue({
      savedPoiIds: [],
      isSaved: () => false,
      save: savePlace,
      remove: jest.fn(),
    });
    mockUseSavedStays.mockReturnValue({
      isSaved: () => false,
      save: saveStay,
      remove: jest.fn(),
      savedKeys: [],
    });
  });

  /** 주소 모양(문자열 · {pathname, params})을 "경로 + 파라미터"로 편다. */
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

  /** 피커의 dismissTo 재현 — 같은 트리에서 region 파라미터만 바꿔 다시 그린다(재마운트 아님). */
  function switchRegionTo(
    code: string,
    rerender: (el: ReactElement) => void
  ): void {
    mockParams = { region: code };
    rerender(<ExploreLandingPage />);
  }

  /** 조회 훅이 받은 첫 인자들의 region 값 전부. */
  function regionsSentTo(mock: jest.Mock): unknown[] {
    return mock.mock.calls.map(
      (call) => (call[0] as { region?: unknown } | undefined)?.region
    );
  }

  function lastOptions(): {
    stay: { enabled?: boolean } | undefined;
    places: { query?: { enabled?: boolean } } | undefined;
  } {
    return {
      stay: mockUseStaySearch.mock.calls.at(-1)?.[1],
      places: mockUseGetPlaces.mock.calls.at(-1)?.[1],
    };
  }

  describe('한 화면 · 조회 인자 · 지역 칩', () => {
    it('숙소·장소가 둘 다 d01 가로 레인이고, 레인 제목에 지역 이름이 붙고, 목적지 상세 testID 는 0건이다', () => {
      render(<ExploreLandingPage />);

      expect(screen.getByTestId('explore-lane-stay')).toBeOnTheScreen();
      expect(screen.getByTestId('explore-lane-place')).toBeOnTheScreen();
      expect(screen.getByText('부산광역시 숙소')).toBeOnTheScreen();
      expect(screen.getByText('부산광역시 장소')).toBeOnTheScreen();
      expect(screen.getByText('무엇을 둘러볼까요?')).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/^destination-detail-/)).toHaveLength(0);
    });

    it('두 조회에 코드가 아니라 카탈로그 이름을 싣고 둘 다 켠다', () => {
      render(<ExploreLandingPage />);

      expect(mockUseStaySearch).toHaveBeenLastCalledWith(
        { region: '부산광역시' },
        { enabled: true }
      );
      expect(mockUseGetPlaces).toHaveBeenLastCalledWith(
        { region: '부산광역시', limit: 8 },
        { query: { enabled: true } }
      );
    });

    it('검색바 자리 칩에 지역 이름이 보이고, 검색 placeholder 는 없다', () => {
      render(<ExploreLandingPage />);

      const chip = screen.getByTestId('explore-region-chip');
      expect(within(chip).getByText('부산광역시')).toBeOnTheScreen();
      expect(screen.queryByText('도시 · 장소 · 숙소 검색')).toBeNull();
    });

    it('칩 ✕ 는 region 키를 비우는 setParams 1회이고, 다시 그리면 칩이 없고 두 조회가 region 없이 나간다', () => {
      const { rerender } = render(<ExploreLandingPage />);

      fireEvent.press(screen.getByTestId('explore-region-chip-clear'));

      // region 키를 **직접 가진** 객체여야 한다 — setParams({}) 는 안 지우는데
      // toHaveBeenCalledWith({ region: undefined }) 는 그것도 통과시킨다.
      expect(mockSetParams).toHaveBeenCalledTimes(1);
      const arg = mockSetParams.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(arg, 'region')).toBe(true);
      expect(arg.region).toBeUndefined();
      // 중첩 Pressable — ✕ 가 바깥 검색바(피커 진입)로 새지 않는다.
      expect(mockPush).not.toHaveBeenCalled();

      rerender(<ExploreLandingPage />);

      expect(screen.queryByTestId('explore-region-chip')).toBeNull();
      expect(screen.getByText('도시 · 장소 · 숙소 검색')).toBeOnTheScreen();
      // 전국 d01 과 같은 호출 — 장소는 인자 **하나**, 숙소는 region 없이 켜져 있다.
      expect(mockUseGetPlaces).toHaveBeenLastCalledWith({ limit: 8 });
      const [stayParams, stayOpts] = mockUseStaySearch.mock.calls.at(-1) ?? [];
      expect((stayParams as { region?: string } | undefined)?.region).toBe(
        undefined
      );
      expect((stayOpts as { enabled?: boolean } | undefined)?.enabled).not.toBe(
        false
      );
    });

    it('필터 상태에서 칩 밖 검색바를 누르면 탐색용 지역 선택으로 1회 가고, 필터는 그대로다', () => {
      render(<ExploreLandingPage />);
      // 앵커 — 정말 필터 상태다(칩이 없으면 전국 d01 을 보고 있는 것이다).
      expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('explore-landing-search'));

      expect(mockPush.mock.calls).toEqual([[regionPickerHref('explore')]]);
      expect(mockSetParams).not.toHaveBeenCalled();
    });
  });

  // 꺼진 쿼리는 영원히 대기다 — 그 대기를 로딩으로 보이면 스켈레톤이 끝나지 않는다(INV-4).
  describe('지역 이름이 안 풀리면', () => {
    it('카탈로그 조회 중 — 두 조회를 끄고, 코드 문자열은 어디에도 안 싣고, 로딩 스켈레톤을 보인다', () => {
      mockRegionsResult = {
        ...mockRegionsResult,
        data: undefined,
        isPending: true,
      };
      render(<ExploreLandingPage />);

      expect(lastOptions().stay?.enabled).toBe(false);
      expect(lastOptions().places?.query?.enabled).toBe(false);
      expect(regionsSentTo(mockUseStaySearch)).not.toContain('26');
      expect(regionsSentTo(mockUseGetPlaces)).not.toContain('26');
      expect(
        screen.getByTestId('explore-landing-skeleton-stay-0')
      ).toBeOnTheScreen();
    });

    it('카탈로그 조회 실패 — 두 레인 모두 재시도이고, 재시도는 카탈로그를 다시 부른다', () => {
      mockRegionsResult = {
        ...mockRegionsResult,
        data: undefined,
        isError: true,
      };
      render(<ExploreLandingPage />);

      expect(
        screen.queryByTestId('explore-landing-skeleton-stay-0')
      ).toBeNull();
      expect(screen.getByTestId('explore-lane-stay-retry')).toBeOnTheScreen();
      expect(screen.getByTestId('explore-lane-place-retry')).toBeOnTheScreen();
      // 이름이 없으니 칩은 코드를 그대로 보인다.
      expect(
        within(screen.getByTestId('explore-region-chip')).getByText('26')
      ).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('explore-lane-stay-retry'));
      expect(regionsRefetch).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getByTestId('explore-lane-place-retry'));
      expect(regionsRefetch).toHaveBeenCalledTimes(2);
    });

    it('카탈로그에 그 코드가 없음 — 두 레인 모두 재시도이고, 두 조회는 꺼진 채 코드가 region 으로 안 나간다', () => {
      mockParams = { region: '99' };
      render(<ExploreLandingPage />);

      expect(
        screen.queryByTestId('explore-landing-skeleton-stay-0')
      ).toBeNull();
      expect(screen.getByTestId('explore-lane-stay-retry')).toBeOnTheScreen();
      expect(screen.getByTestId('explore-lane-place-retry')).toBeOnTheScreen();
      expect(regionsSentTo(mockUseStaySearch)).not.toContain('99');
      expect(regionsSentTo(mockUseGetPlaces)).not.toContain('99');
      // region 을 빼고 켜면 전국 조회가 몰래 나간다.
      expect(lastOptions().stay?.enabled).toBe(false);
      expect(lastOptions().places?.query?.enabled).toBe(false);
    });
  });

  describe('부분 실패 · 가격', () => {
    it('장소만 실패 — 숙소 카드는 보이고 장소 레인은 재시도이며, 재시도는 장소 조회를 다시 부른다', () => {
      placesResult = { ...placesOk([]), data: undefined, isError: true };
      render(<ExploreLandingPage />);
      expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

      expect(
        screen.getByTestId(`explore-stay-card-${STAY_KEY}`)
      ).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('explore-lane-place-retry'));
      expect(mockPlacesRefetch).toHaveBeenCalledTimes(1);
    });

    // 전국·필터가 서로 다른 refetch 람다를 만든다 — 필터 쪽 숙소 람다는 여기서만 실행된다.
    it('숙소만 실패 — 장소 카드는 보이고 숙소 레인은 재시도이며, 재시도는 숙소 조회만 다시 부른다', () => {
      stayResult = { ...stayOk([]), data: undefined, isError: true };
      render(<ExploreLandingPage />);
      expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

      expect(
        screen.getByTestId(`explore-place-card-${PLACE.poiId}`)
      ).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('explore-lane-stay-retry'));
      expect(mockStayRefetch).toHaveBeenCalledTimes(1);
      expect(mockPlacesRefetch).not.toHaveBeenCalled();
    });

    it('스냅숏 없는 숙소 카드에 "가격 미확인"이 보인다', () => {
      render(<ExploreLandingPage />);
      expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

      const card = screen.getByTestId(`explore-stay-card-${STAY_KEY}`);
      expect(within(card).getByText('가격 미확인')).toBeOnTheScreen();
    });
  });

  describe('모두 보기는 필터 지역 이름을 싣는다', () => {
    // TRIP-1300 — 숙소는 피커(숙소 목적)와 같은 객체형으로 코드·시도까지 싣는다. targetOf 는 문자열
    // push 를 같은 모양으로 펴 주므로 쓰지 않고 push 원본을 본다(값은 손 인코딩 없는 원문).
    it('숙소 모두 보기를 누르면 /stays 로 지역 이름·코드·시도를 실어 1회 간다', () => {
      render(<ExploreLandingPage />);

      fireEvent.press(screen.getByTestId('explore-lane-stay-seeall'));

      expect(mockPush.mock.calls).toEqual([
        [
          {
            pathname: '/stays',
            params: {
              region: '부산광역시',
              regionCode: '26',
              sido: '부산광역시',
            },
          },
        ],
      ]);
    });

    it('장소 모두 보기를 누르면 /explore/places?region=부산광역시 로 간다', () => {
      render(<ExploreLandingPage />);

      fireEvent.press(screen.getByTestId('explore-lane-place-cta'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(targetOf(mockPush.mock.calls[0][0])).toEqual({
        path: '/explore/places',
        params: { region: '부산광역시' },
      });
    });

    it('장소 0건 폴백을 눌러도 같은 곳(/explore/places?region=부산광역시)으로 간다', () => {
      placesResult = placesOk([]);
      render(<ExploreLandingPage />);

      fireEvent.press(screen.getByTestId('explore-lane-place-empty'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(targetOf(mockPush.mock.calls[0][0])).toEqual({
        path: '/explore/places',
        params: { region: '부산광역시' },
      });
    });
  });

  // TRIP-1300 — 서버는 이름으로 지역을 풀어 서울·부산 강서구를 합쳐 준다(조회 목이 인자를 무시하고
  // 같은 응답을 주는 것이 그 흉내다). 카탈로그에서 **코드로** 찾은 행의 시도로 레인을 한 번 더 거른다.
  describe('동명 구 — 카탈로그 시도로 숙소 레인을 거른다', () => {
    // 부산 행을 서울 행보다 앞에 둔다 — 이름(강서구)으로 행을 찾으면 부산이 잡혀 서울 케이스가 깨진다.
    const BUSAN_GANGSEO = region({
      regionCode: '26440',
      name: '강서구',
      sidoName: '부산광역시',
    });
    const SEOUL_GANGSEO = region({
      regionCode: '11500',
      name: '강서구',
      sidoName: '서울특별시',
    });

    function gangseoStay(
      externalId: string,
      address?: string | null
    ): StayItem {
      const base = stayItem(
        'LOCALDATA',
        externalId,
        '강서구',
        `숙소-${externalId}`,
        null
      );
      // undefined 면 address 키 자체를 안 만든다(응답에 키가 없는 경우).
      return address === undefined ? base : { ...base, address };
    }
    // 부산 카드를 맨 앞에 — 실기 응답도 앞 4건이 부산이었다. 약칭 주소(서울 …)도 같은 시도다.
    const GS_BUSAN = gangseoStay(
      '3360000-b1',
      '부산광역시 강서구 녹산산단321로 24'
    );
    const GS_SEOUL = gangseoStay(
      '3150000-s1',
      '서울특별시 강서구 공항대로 247'
    );
    const GS_SEOUL_ABBR = gangseoStay('3150000-s2', '서울 강서구 화곡로 1');
    const NULL_ADDR = gangseoStay('unknown-null', null);
    const NO_ADDR = gangseoStay('unknown-missing');

    const cardId = (item: StayItem): string =>
      `explore-stay-card-${stayKey(item)}`;
    /** 숙소 레인에 그려진 카드 testID — 그린 순서대로. */
    function cardIds(): string[] {
      return screen
        .queryAllByTestId(/^explore-stay-card-/)
        .map((el) => el.props.testID as string);
    }

    beforeEach(() => {
      mockRegionsResult = {
        ...mockRegionsResult,
        data: [BUSAN, MICHUHOL, BUSAN_GANGSEO, SEOUL_GANGSEO],
      };
      stayResult = stayOk([GS_BUSAN, GS_SEOUL, GS_SEOUL_ABBR]);
    });

    it.each([
      ['서울 강서구(11500)', '11500', [GS_SEOUL, GS_SEOUL_ABBR]],
      ['부산 강서구(26440)', '26440', [GS_BUSAN]],
    ])(
      '%s 를 고르면 그 시도 주소의 숙소만 서버 순서대로 레인에 남는다',
      (_name, code, expected) => {
        mockParams = { region: code };

        render(<ExploreLandingPage />);
        // 앵커 — 이름이 풀린 필터 상태다(안 풀리면 레인이 재시도라 카드 0장).
        expect(screen.getByText('강서구 숙소')).toBeOnTheScreen();

        expect(cardIds()).toEqual(expected.map(cardId));
      }
    );

    it('주소를 모르는 숙소(null·키 없음)는 남기고, 다른 시도 주소만 뺀다(fail-open)', () => {
      mockParams = { region: SEOUL_GANGSEO.regionCode };
      stayResult = stayOk([GS_BUSAN, NULL_ADDR, NO_ADDR, GS_SEOUL]);

      render(<ExploreLandingPage />);
      expect(screen.getByText('강서구 숙소')).toBeOnTheScreen();

      expect(cardIds()).toEqual([NULL_ADDR, NO_ADDR, GS_SEOUL].map(cardId));
    });

    it('카탈로그 행의 시도가 빈 문자열이면 거르지 않고 서버 응답 전부를 그린다', () => {
      mockParams = { region: '11500' };
      mockRegionsResult = {
        ...mockRegionsResult,
        data: [region({ regionCode: '11500', name: '강서구', sidoName: '' })],
      };

      render(<ExploreLandingPage />);
      expect(screen.getByText('강서구 숙소')).toBeOnTheScreen();

      expect(cardIds()).toEqual(
        [GS_BUSAN, GS_SEOUL, GS_SEOUL_ABBR].map(cardId)
      );
    });

    it.each([
      ['서울 강서구', '11500', '서울특별시'],
      ['부산 강서구', '26440', '부산광역시'],
    ])(
      '%s 숙소 모두 보기는 /stays 로 이름·코드·시도를 실어 1회 간다',
      (_name, code, sido) => {
        mockParams = { region: code };
        render(<ExploreLandingPage />);

        fireEvent.press(screen.getByTestId('explore-lane-stay-seeall'));

        expect(mockPush.mock.calls).toEqual([
          [
            {
              pathname: '/stays',
              params: { region: '강서구', regionCode: code, sido },
            },
          ],
        ]);
      }
    );

    it('숙소 조회에는 시도·코드 없이 지역 이름만 싣는다', () => {
      mockParams = { region: SEOUL_GANGSEO.regionCode };

      render(<ExploreLandingPage />);

      expect(mockUseStaySearch).toHaveBeenLastCalledWith(
        { region: '강서구' },
        { enabled: true }
      );
    });

    it('장소 모두 보기는 지금처럼 이름만 싣는다(/explore/places?region=강서구)', () => {
      mockParams = { region: SEOUL_GANGSEO.regionCode };
      render(<ExploreLandingPage />);

      fireEvent.press(screen.getByTestId('explore-lane-place-cta'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(targetOf(mockPush.mock.calls[0][0])).toEqual({
        path: '/explore/places',
        params: { region: '강서구' },
      });
    });

    it('카탈로그에 그 코드가 없으면 숙소 모두 보기는 지역 없이 /stays 로만 간다(코드만 싣지 않는다)', () => {
      mockParams = { region: '99' };
      render(<ExploreLandingPage />);

      fireEvent.press(screen.getByTestId('explore-lane-stay-seeall'));

      expect(mockPush.mock.calls).toEqual([['/stays']]);
    });
  });

  // 앵커 — 각 it 이 필터 상태(칩)를 먼저 확인한다. 칩이 없으면 전국 d01 을 보고 있어 공짜로 통과한다.
  describe('카드·하트·＋ FAB 배선은 필터 상태에서도 d01 그대로', () => {
    it('장소 카드 → 장소 상세, 숙소 카드 → 숙소 상세(stayId 만)', () => {
      render(<ExploreLandingPage />);
      expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId(`explore-place-card-${PLACE.poiId}`));
      expect(mockPush).toHaveBeenLastCalledWith(
        `/explore/places/${PLACE.poiId}`
      );

      fireEvent.press(screen.getByTestId(`explore-stay-card-${STAY_KEY}`));
      expect(mockPush).toHaveBeenLastCalledWith({
        pathname: '/stays/[stayId]',
        params: { stayId: STAY_KEY },
      });
    });

    it('로그인 사용자의 숙소·장소 하트는 서버 담기를 실제로 부른다', () => {
      render(<ExploreLandingPage />);
      expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId(`explore-stay-save-${STAY_KEY}`));
      expect(saveStay).toHaveBeenCalledTimes(1);
      expect(saveStay).toHaveBeenCalledWith(STAY);

      fireEvent.press(screen.getByTestId(`explore-place-save-${PLACE.poiId}`));
      expect(savePlace).toHaveBeenCalledTimes(1);
      expect((savePlace.mock.calls[0][0] as Place).poiId).toBe(PLACE.poiId);
    });

    it('＋ 여행 만들기는 직전 드래프트를 비우고 위저드로 1회 간다', () => {
      leavePreviousTripDraft();
      expect(wizardDraftData()).not.toEqual(freshWizardDraft());
      expect(useTripWizardStore.getState().destinations).toHaveLength(1);
      const draftAtPush = captureDraftAtNextCall(mockPush);
      render(<ExploreLandingPage />);
      expect(screen.getByTestId('explore-region-chip')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('explore-create-trip-fab'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(String(mockPush.mock.calls[0][0])).toBe('/trips/new/step1');
      expect(draftAtPush()).toEqual(freshWizardDraft());
    });
  });

  // 피커의 dismissTo 는 이 탭을 재마운트하지 않고 params 만 바꾼다. rerender 는 같은 컴포넌트를
  // 재사용하므로 key 가 없으면 안의 useState(배너·메뉴 열림)가 살아남는다.
  describe('지역이 바뀌면 이전 지역의 로컬 상태가 안 남는다(key 재마운트)', () => {
    it('부산에서 뜬 숙소 담기 실패 배너는 미추홀구로 바뀐 뒤엔 없다', async () => {
      saveStay.mockResolvedValue({ kind: 'failed' });
      const { rerender } = render(<ExploreLandingPage />);

      fireEvent.press(screen.getByTestId(`explore-stay-save-${STAY_KEY}`));
      expect(
        await screen.findByTestId('explore-stay-save-error')
      ).toBeOnTheScreen();

      switchRegionTo(MICHUHOL.regionCode, rerender);

      expect(screen.getByText('미추홀구 숙소')).toBeOnTheScreen();
      expect(screen.queryByTestId('explore-stay-save-error')).toBeNull();
    });

    it('부산에서 펼친 담은 곳 메뉴는 미추홀구로 바뀐 뒤엔 접혀 있다', async () => {
      const { rerender } = render(<ExploreLandingPage />);

      fireEvent.press(screen.getByTestId('explore-saved-menu-toggle'));
      expect(screen.getByTestId('explore-saved-places-fab')).toBeOnTheScreen();

      await act(async () => {
        switchRegionTo(MICHUHOL.regionCode, rerender);
      });

      expect(screen.getByText('미추홀구 숙소')).toBeOnTheScreen();
      expect(screen.queryByTestId('explore-saved-places-fab')).toBeNull();
    });
  });
});
